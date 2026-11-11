"""Chat events (spec 0005c): "this conversation changed" pushed to the participants' open tabs.

Publishing (`publish`, sync, called by the routers **after** the service committed): one
`PUBLISH chat:u:{user_id}` per participant with `{"conversation_id", "kind"}`, ids only (NF3). A
Redis failure is logged and swallowed: the request has already succeeded, and the clients refetch
on their next reconnect (NF2).

Receiving (`ChatHub`, one per process and event loop, `get_hub()`): one `redis.asyncio` client and
one `PubSub` connection for every `GET /me/events` stream of the process (NF4). A user's first
local subscription SUBSCRIBEs their channel, the last one to leave UNSUBSCRIBEs it; one reader task
routes each message to that user's local queues. A full queue is emptied to one `RESYNC` (the
stream sends `event: resync` and the client refetches everything). When the reader fails (Redis
gone, connection killed) every local queue is emptied to a `None` sentinel, the streams end, the
browsers reconnect and refetch, and the next `get_hub()` builds a fresh hub."""

import asyncio
import enum
import json
import logging
import os
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Final, Literal

import redis
import redis.asyncio as aioredis
from redis.asyncio.client import PubSub

from app.config import get_settings
from app.redis_client import RedisClient

log = logging.getLogger(__name__)

EventKind = Literal["message", "status"]

QUEUE_MAX = 100
MAX_STREAMS_PER_USER = 5
# The reader's `get_message` timeout: an explicit timeout returns None when idle (`listen()` would
# exit while nothing is subscribed). Local timer only, no Redis traffic.
READ_TIMEOUT_S = 1.0
CONNECT_TIMEOUT_S = 1


class _Marker(enum.Enum):
    RESYNC = "resync"


RESYNC: Final = _Marker.RESYNC

# A queue item: the published JSON text, `RESYNC` (events were dropped: refetch everything) or
# `None` (the hub failed: end the stream).
Item = str | Literal[_Marker.RESYNC] | None


class TooManyStreamsError(Exception):
    """The user already has `MAX_STREAMS_PER_USER` streams in this process."""


def channel(user_id: uuid.UUID) -> str:
    return f"chat:u:{user_id}"


def publish(
    r: RedisClient, user_ids: Iterable[uuid.UUID], conversation_id: uuid.UUID, kind: EventKind
) -> None:
    """Tell each of `user_ids`' open streams that `conversation_id` changed. Never raises a Redis
    error: logs a warning and returns (called after the commit)."""
    payload = json.dumps({"conversation_id": str(conversation_id), "kind": kind})
    try:
        for user_id in user_ids:
            r.publish(channel(user_id), payload)
    except redis.RedisError as exc:
        log.warning(
            "chat event %s for conversation %s not published: %s",
            kind,
            conversation_id,
            type(exc).__name__,
        )


@dataclass(eq=False)
class Subscription:
    """One stream's local subscription: its user's channel and its own bounded queue."""

    user_id: uuid.UUID
    channel: str
    queue: "asyncio.Queue[Item]" = field(default_factory=lambda: asyncio.Queue(maxsize=QUEUE_MAX))


def _empty(queue: "asyncio.Queue[Item]") -> None:
    while not queue.empty():
        queue.get_nowait()


def _deliver(sub: Subscription, item: str) -> None:
    """Queue `item`; a full queue is emptied to one `RESYNC` instead (later items queue
    normally)."""
    try:
        sub.queue.put_nowait(item)
    except asyncio.QueueFull:
        _empty(sub.queue)
        sub.queue.put_nowait(RESYNC)


class ChatHub:
    """The process's pub/sub fan-out, bound to the event loop that created it."""

    def __init__(self, url: str) -> None:
        self.loop = asyncio.get_running_loop()
        self.closed = False
        self._client: aioredis.Redis[bytes] = aioredis.Redis.from_url(
            url,
            socket_connect_timeout=CONNECT_TIMEOUT_S,
            client_name=f"chat-hub:{os.getpid()}",
        )
        self._pubsub: PubSub = self._client.pubsub()
        self._subs: dict[str, set[Subscription]] = {}
        # Serialises SUBSCRIBE / UNSUBSCRIBE with their refcount bookkeeping.
        self._lock = asyncio.Lock()
        # Resolved once the reader holds the pub/sub connection; `connect()` waits on it, so the
        # PubSub never opens a second connection.
        self._connected: asyncio.Future[None] = self.loop.create_future()
        self._connected.add_done_callback(_retrieve)
        self._reader = asyncio.create_task(self._read(), name="chat-hub-reader")

    async def _read(self) -> None:
        try:
            await self._pubsub.connect()  # type: ignore[attr-defined]  # missing from types-redis
            self._connected.set_result(None)
            while True:
                message = await self._pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=READ_TIMEOUT_S
                )
                if message is None or message["type"] != "message":
                    continue
                name = message["channel"]
                key = name.decode() if isinstance(name, bytes) else str(name)
                data = message["data"]
                text = data.decode() if isinstance(data, bytes) else str(data)
                for sub in self._subs.get(key, ()):
                    _deliver(sub, text)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("chat hub reader failed: %s", type(exc).__name__)
            if not self._connected.done():
                self._connected.set_exception(exc)
            self._fail()
            await self._close_connections()

    def _fail(self) -> None:
        """End every local stream (`None` after an emptied queue) and mark the hub closed."""
        self.closed = True
        for subs in self._subs.values():
            for sub in subs:
                _empty(sub.queue)
                sub.queue.put_nowait(None)
        self._subs.clear()

    async def _close_connections(self) -> None:
        try:
            await self._pubsub.aclose()  # type: ignore[attr-defined]  # missing from types-redis
            await self._client.aclose()  # type: ignore[attr-defined]  # missing from types-redis
        except Exception as exc:
            log.warning("chat hub close failed: %s", type(exc).__name__)

    async def connect(self, user_id: uuid.UUID) -> Subscription:
        """A new local subscription to `user_id`'s channel. Raises `TooManyStreamsError`, or a
        `redis.ConnectionError` when Redis is unreachable or the hub has failed (a 503)."""
        await asyncio.shield(self._connected)
        async with self._lock:
            if self.closed:
                raise redis.ConnectionError("chat hub closed")
            key = channel(user_id)
            subs = self._subs.setdefault(key, set())
            if len(subs) >= MAX_STREAMS_PER_USER:
                raise TooManyStreamsError
            sub = Subscription(user_id=user_id, channel=key)
            subs.add(sub)
            if len(subs) == 1:
                try:
                    await self._pubsub.subscribe(key)
                except Exception:
                    subs.discard(sub)
                    if not subs:
                        self._subs.pop(key, None)
                    raise
            return sub

    async def disconnect(self, sub: Subscription) -> None:
        """Drop `sub`; the user's last local subscription UNSUBSCRIBEs the channel. Never raises a
        Redis error (it runs as a stream's cleanup)."""
        async with self._lock:
            subs = self._subs.get(sub.channel)
            if subs is None or sub not in subs:
                return  # the hub failed (and forgot every subscription) or already dropped it
            subs.discard(sub)
            if subs:
                return
            del self._subs[sub.channel]
            try:
                await self._pubsub.unsubscribe(sub.channel)
            except redis.RedisError as exc:
                log.warning("chat hub unsubscribe failed: %s", type(exc).__name__)

    async def aclose(self) -> None:
        """Stop the reader, end every local stream and close the connections."""
        self._reader.cancel()
        await asyncio.wait([self._reader])  # waits without re-raising the reader's cancellation
        if not self._connected.done():
            self._connected.set_exception(redis.ConnectionError("chat hub closed"))
        if not self.closed:
            self._fail()
            await self._close_connections()


def _retrieve(future: "asyncio.Future[None]") -> None:
    """Mark a failed connect future's exception as retrieved (no "never retrieved" warning when no
    stream was waiting on it)."""
    if not future.cancelled():
        future.exception()


_hub: ChatHub | None = None


def get_hub() -> ChatHub:
    """The process's hub; a new one when there is none yet, the cached one has closed (failed),
    or it is bound to another event loop (tests run one loop per test). Sync, so no creation
    race; call it from a coroutine."""
    global _hub
    if _hub is None or _hub.closed or _hub.loop is not asyncio.get_running_loop():
        _hub = ChatHub(get_settings().redis_url.get_secret_value())
    return _hub


async def close_hub() -> None:
    """Close and forget the hub (tests: the hub is bound to the test's loop)."""
    global _hub
    hub, _hub = _hub, None
    if hub is not None and hub.loop is asyncio.get_running_loop():
        await hub.aclose()
