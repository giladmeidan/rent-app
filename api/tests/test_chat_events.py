"""Chat events (spec 0005c): the `GET /me/events` stream, the per-process hub and the publish
points. AC1-AC7 drive the stream at the ASGI level (`Stream`, below) on the test's own event loop;
AC8-AC9 use the sync `TestClient`.

The tests share the dev Redis with the spec stack, so they only ever look at their own users'
channels (`chat:u:{id}`, fresh uuids per test) and at the hub client named `chat-hub:<this pid>`."""

import asyncio
import json
import os
import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any

import fastapi.routing
import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from starlette.types import Message

from app.db import get_engine
from app.main import create_app
from app.redis_client import get_redis
from app.routers import events as events_router
from app.services import chat_events
from tests.conftest import Outbox, signup

pytestmark = pytest.mark.usefixtures("redis_clean")

WAIT_S = 1.0  # an expected event arrives within this
ABSENT_S = 0.3  # an absent event is checked for this long
HUB_NAME = f"chat-hub:{os.getpid()}"


# --- the ASGI stream helper -------------------------------------------------------------------


class Stream:
    """`GET /me/events` run straight on the ASGI app, as uvicorn would (ASGI spec 2.3, so Starlette
    listens for `http.disconnect`), with no server, thread or network. `receive` returns the request
    once, then blocks until `disconnect()`; `send` collects the response start and body chunks."""

    def __init__(self, app: FastAPI, token: str | None) -> None:
        headers = [(b"host", b"testserver")]
        if token is not None:
            headers.append((b"cookie", f"rent_session={token}".encode()))
        self._scope: dict[str, Any] = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/me/events",
            "raw_path": b"/me/events",
            "root_path": "",
            "query_string": b"",
            "headers": headers,
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
            "state": {},
        }
        self._app = app
        self._requested = False
        self._disconnected = asyncio.Event()
        self._changed = asyncio.Event()
        self.status: int | None = None
        self.headers: dict[str, str] = {}
        self.body = bytearray()
        self.complete = False
        self.task: asyncio.Task[None] = asyncio.create_task(self._run())

    async def _run(self) -> None:
        await self._app(self._scope, self._receive, self._send)

    async def _receive(self) -> Message:
        if not self._requested:
            self._requested = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await self._disconnected.wait()
        return {"type": "http.disconnect"}

    async def _send(self, message: Message) -> None:
        if message["type"] == "http.response.start":
            self.status = message["status"]
            self.headers = {k.decode().lower(): v.decode() for k, v in message["headers"]}
        elif message["type"] == "http.response.body":
            self.body += message.get("body", b"")
            self.complete = not message.get("more_body", False)
        self._changed.set()

    async def wait(self, predicate: Callable[["Stream"], bool], timeout: float = WAIT_S) -> None:
        """Wait until `predicate(self)` holds (fails after `timeout`)."""
        async with asyncio.timeout(timeout):
            while not predicate(self):
                self._changed.clear()
                await self._changed.wait()

    async def started(self) -> "Stream":
        """Wait for the response start and, on a 200, for the first event (`retry:`)."""
        await self.wait(lambda s: s.status is not None and (s.status != 200 or bool(s.body)))
        return self

    def leave(self) -> None:
        """The client goes away (without waiting for the app)."""
        self._disconnected.set()

    async def disconnect(self) -> None:
        """The client goes away; waits for the app (and its cleanup) to finish."""
        self.leave()
        async with asyncio.timeout(WAIT_S):
            await self.task

    def frames(self) -> list[dict[str, str]]:
        """The body as SSE frames: `{field: value}` per frame (a comment is `{"comment": …}`)."""
        frames: list[dict[str, str]] = []
        for raw in bytes(self.body).decode().split("\n\n"):
            if not raw:
                continue
            frame: dict[str, str] = {}
            for line in raw.split("\n"):
                name, _, value = line.partition(": ")
                frame[name or "comment"] = value
            frames.append(frame)
        return frames

    def chat_events(self) -> list[dict[str, Any]]:
        return [json.loads(f["data"]) for f in self.frames() if f.get("event") == "chat"]

    def json(self) -> Any:
        return json.loads(bytes(self.body))


@pytest_asyncio.fixture
async def hub_reset() -> AsyncIterator[None]:
    """The hub is bound to the test's event loop: close it after each test."""
    yield
    await chat_events.close_hub()


@pytest_asyncio.fixture
async def open_stream(hub_reset: None) -> AsyncIterator[Callable[[str | None], Stream]]:
    """`open_stream(token)` starts a `Stream`; every stream still open is disconnected after the
    test (before `hub_reset` closes the hub)."""
    app = create_app()
    streams: list[Stream] = []

    def start(token: str | None) -> Stream:
        stream = Stream(app, token)
        streams.append(stream)
        return stream

    yield start
    for stream in streams:
        if not stream.task.done():
            await stream.disconnect()


# --- helpers --------------------------------------------------------------------------------------


def _token(caller: TestClient) -> str:
    token: str = caller.cookies["rent_session"]
    return token


def _user_id(caller: TestClient) -> uuid.UUID:
    return uuid.UUID(caller.get("/me").json()["id"])


def _numsub(user_id: uuid.UUID) -> int:
    ((_name, count),) = get_redis().pubsub_numsub(chat_events.channel(user_id))
    return int(count)


async def _until(predicate: Callable[[], bool], timeout: float = WAIT_S) -> None:
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.01)


async def _subscribed(user_id: uuid.UUID, count: int = 1) -> None:
    """Wait until Redis has processed the hub's SUBSCRIBE / UNSUBSCRIBE for `user_id`."""
    await _until(lambda: _numsub(user_id) == count)


def _hub_clients() -> list[dict[str, Any]]:
    clients = get_redis().client_list(_type="pubsub")
    return [c for c in clients if c.get("name") == HUB_NAME]


def _publish(user_ids: list[uuid.UUID], conversation_id: uuid.UUID) -> None:
    chat_events.publish(get_redis(), user_ids, conversation_id, "message")


def _peek(queue: "asyncio.Queue[chat_events.Item]") -> list[chat_events.Item]:
    """The queue's items, left in place."""
    items = [queue.get_nowait() for _ in range(queue.qsize())]
    for item in items:
        queue.put_nowait(item)
    return items


def _two_users(client: TestClient, outbox: Outbox) -> tuple[TestClient, TestClient]:
    a = signup(client, outbox, "a@example.com", "seeker", display_name="Avi")
    b = signup(client, outbox, "b@example.com", "owner", display_name="Ben")
    return a, b


# --- AC1-AC7: the stream ------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ac1_stream_auth_holds_no_db_connection(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    open_stream: Callable[[str | None], Stream],
) -> None:
    a = signup(client, outbox, "a@example.com", "seeker")
    expired = signup(client, outbox, "x@example.com", "seeker")
    with db_engine.begin() as conn:
        conn.execute(
            text("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = :u"),
            {"u": _user_id(expired)},
        )

    for token in (None, "not-a-session-token", _token(expired)):
        stream = await open_stream(token).started()
        await stream.wait(lambda s: s.complete)
        assert stream.status == 401
        assert stream.headers["content-type"] == "application/json"
        assert stream.json() == {"detail": "unauthenticated"}

    stream = await open_stream(_token(a)).started()
    assert stream.status == 200
    assert stream.headers["content-type"].startswith("text/event-stream")
    assert stream.headers["cache-control"] == "no-cache"
    assert b"retry: 3000" in stream.body
    assert not stream.complete
    assert get_engine().pool.checkedout() == 0  # type: ignore[attr-defined]  # Pool stub


@pytest.mark.asyncio
async def test_ac2_events_reach_only_their_user(
    client: TestClient, outbox: Outbox, open_stream: Callable[[str | None], Stream]
) -> None:
    a, b = _two_users(client, outbox)
    a_id, b_id = _user_id(a), _user_id(b)
    stream_a = await open_stream(_token(a)).started()
    stream_b = await open_stream(_token(b)).started()
    await _subscribed(a_id)
    await _subscribed(b_id)
    cid = uuid.uuid4()

    _publish([a_id], cid)
    expected = {"conversation_id": str(cid), "kind": "message"}
    await stream_a.wait(lambda s: len(s.chat_events()) == 1)
    await asyncio.sleep(ABSENT_S)
    assert stream_a.chat_events() == [expected]
    assert stream_b.chat_events() == []

    _publish([a_id, b_id], cid)
    await stream_a.wait(lambda s: len(s.chat_events()) == 2)
    await stream_b.wait(lambda s: len(s.chat_events()) == 1)
    assert stream_b.chat_events() == [expected]

    second_a = await open_stream(_token(a)).started()
    _publish([a_id], cid)
    await stream_a.wait(lambda s: len(s.chat_events()) == 3)
    await second_a.wait(lambda s: len(s.chat_events()) == 1)
    await asyncio.sleep(ABSENT_S)
    assert second_a.chat_events() == [expected]
    assert len(stream_b.chat_events()) == 1
    assert all("id" not in frame for frame in stream_a.frames())  # nothing is replayed


@pytest.mark.asyncio
async def test_ac3_one_connection_refcounted_channels(
    client: TestClient, outbox: Outbox, open_stream: Callable[[str | None], Stream]
) -> None:
    a, b = _two_users(client, outbox)
    a_id, b_id = _user_id(a), _user_id(b)

    first_a = await open_stream(_token(a)).started()
    await _subscribed(a_id)
    assert _numsub(a_id) == 1
    (hub_client,) = _hub_clients()

    second_a = await open_stream(_token(a)).started()
    await asyncio.sleep(ABSENT_S)
    assert _numsub(a_id) == 1

    stream_b = await open_stream(_token(b)).started()
    await _subscribed(b_id)
    assert [c["id"] for c in _hub_clients()] == [hub_client["id"]]  # the same connection
    (hub_client,) = _hub_clients()
    assert int(hub_client["sub"]) == 2  # chat:u:{A} and chat:u:{B}

    await first_a.disconnect()
    await asyncio.sleep(ABSENT_S)
    assert _numsub(a_id) == 1
    # The last one leaves while another stream's SUBSCRIBE holds the hub: its cleanup must wait,
    # not be cancelled with the stream (the UNSUBSCRIBE would never go out).
    async with chat_events.get_hub()._lock:
        second_a.leave()
        await asyncio.sleep(ABSENT_S)
    await second_a.disconnect()
    await _subscribed(a_id, 0)

    cid = uuid.uuid4()
    _publish([b_id], cid)
    await stream_b.wait(lambda s: len(s.chat_events()) == 1)
    assert stream_b.chat_events() == [{"conversation_id": str(cid), "kind": "message"}]
    assert len(_hub_clients()) == 1


@pytest.mark.asyncio
async def test_ac4_stream_limits(
    client: TestClient, outbox: Outbox, open_stream: Callable[[str | None], Stream]
) -> None:
    a, b = _two_users(client, outbox)
    a_id = _user_id(a)
    assert chat_events.MAX_STREAMS_PER_USER == 5
    assert events_router.EVENTS_OPEN_LIMIT_MINUTE == 30

    five = [await open_stream(_token(a)).started() for _ in range(5)]
    assert all(s.status == 200 for s in five)
    sixth = await open_stream(_token(a)).started()
    await sixth.wait(lambda s: s.complete)
    assert sixth.status == 429
    assert sixth.json() == {"detail": "too_many_streams"}
    for stream in five:
        await stream.disconnect()

    r = get_redis()
    for key in r.scan_iter(match="rl:*"):  # redis_clean, again
        r.delete(key)
    r.set(f"rl:events:user:{a_id}", 30, ex=60)
    limited = await open_stream(_token(a)).started()
    await limited.wait(lambda s: s.complete)
    assert limited.status == 429
    assert limited.json() == {"detail": "rate_limited"}
    assert 1 <= int(limited.headers["retry-after"]) <= 60

    other = await open_stream(_token(b)).started()
    assert other.status == 200


@pytest.mark.asyncio
async def test_ac5_keepalive_and_max_lifetime(
    client: TestClient,
    outbox: Outbox,
    open_stream: Callable[[str | None], Stream],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    a = signup(client, outbox, "a@example.com", "seeker")
    a_id = _user_id(a)
    monkeypatch.setattr(fastapi.routing, "_PING_INTERVAL", 0.05)

    idle = await open_stream(_token(a)).started()
    await idle.wait(lambda s: s.body.count(b": ping\n\n") >= 2)
    await idle.disconnect()
    await _subscribed(a_id, 0)

    monkeypatch.setattr(events_router, "STREAM_MAX_S", 0.2)
    monkeypatch.setattr(events_router, "STREAM_JITTER_S", 0)
    short = await open_stream(_token(a)).started()
    assert short.status == 200
    await short.wait(lambda s: s.complete)
    async with asyncio.timeout(WAIT_S):
        await short.task  # ended by itself, cleanup included (no disconnect from the client)
    await _subscribed(a_id, 0)


@pytest.mark.asyncio
async def test_ac6_overflow_sends_resync(
    client: TestClient,
    outbox: Outbox,
    open_stream: Callable[[str | None], Stream],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    a, b = _two_users(client, outbox)
    a_id, b_id = _user_id(a), _user_id(b)
    monkeypatch.setattr(chat_events, "QUEUE_MAX", 2)
    sub = await chat_events.get_hub().connect(a_id)
    # B's subscription is a fence: every publish goes through one connection in order, so once B
    # has its event every earlier event for A has been routed.
    fence = await chat_events.get_hub().connect(b_id)
    await _subscribed(a_id)
    await _subscribed(b_id)
    cid = uuid.uuid4()

    for _ in range(5):
        _publish([a_id], cid)
    _publish([b_id], cid)
    await _until(lambda: fence.queue.qsize() == 1)
    assert _peek(sub.queue) == [chat_events.RESYNC]

    _publish([a_id], cid)
    _publish([b_id], cid)
    await _until(lambda: fence.queue.qsize() == 2)
    chat_item = json.dumps({"conversation_id": str(cid), "kind": "message"})
    assert _peek(sub.queue) == [chat_events.RESYNC, chat_item]
    await chat_events.get_hub().disconnect(sub)
    await chat_events.get_hub().disconnect(fence)

    # Through the stream: its subscription receives RESYNC, then a normal event.
    subs: list[chat_events.Subscription] = []
    connect = chat_events.ChatHub.connect

    async def capture(hub: chat_events.ChatHub, user_id: uuid.UUID) -> chat_events.Subscription:
        captured = await connect(hub, user_id)
        subs.append(captured)
        return captured

    monkeypatch.setattr(chat_events.ChatHub, "connect", capture)
    stream = await open_stream(_token(a)).started()
    await _subscribed(a_id)
    (stream_sub,) = subs
    stream_sub.queue.put_nowait(chat_events.RESYNC)
    await stream.wait(lambda s: any(f.get("event") == "resync" for f in s.frames()))
    _publish([a_id], cid)
    await stream.wait(lambda s: len(s.chat_events()) == 1)
    events = [f for f in stream.frames() if "event" in f]
    assert events == [
        {"event": "resync", "data": "{}"},
        {"event": "chat", "data": chat_item},
    ]


@pytest.mark.asyncio
async def test_ac7_redis_failure_ends_streams_and_recovers(
    client: TestClient, outbox: Outbox, open_stream: Callable[[str | None], Stream]
) -> None:
    a, b = _two_users(client, outbox)
    a_id, b_id = _user_id(a), _user_id(b)
    stream_a = await open_stream(_token(a)).started()
    stream_b = await open_stream(_token(b)).started()
    await _subscribed(a_id)
    await _subscribed(b_id)

    (hub_client,) = _hub_clients()  # only this process's hub, never every pubsub client
    get_redis().client_kill_filter(_id=hub_client["id"])
    await stream_a.wait(lambda s: s.complete)
    await stream_b.wait(lambda s: s.complete)
    async with asyncio.timeout(WAIT_S):
        await asyncio.gather(stream_a.task, stream_b.task)

    again = await open_stream(_token(a)).started()
    assert again.status == 200
    await _subscribed(a_id)
    cid = uuid.uuid4()
    _publish([a_id], cid)
    await again.wait(lambda s: len(s.chat_events()) == 1)
    assert again.chat_events() == [{"conversation_id": str(cid), "kind": "message"}]
    (new_client,) = _hub_clients()
    assert new_client["id"] != hub_client["id"]
