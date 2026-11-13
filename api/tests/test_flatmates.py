"""Flatmates and group chat (spec 0008d): AC1-AC10, AC12 and AC13's non-member send (AC11 is in
`test_migrations.py`, AC13's one-to-one asserts in `test_chat.py`).

`O` ("Noa") owns room `R` (`test_people`'s women-only room for two). `S` ("Dana") is a seeker with
a woman's room section whose application to `R` is shortlisted, so its conversation is open. `F`
("Fay") is a seeker with a woman's room section who joins `R`'s flat through its invite link."""

import datetime as dt
import hashlib
import threading
import time
import uuid
from collections.abc import Callable, Iterable, Iterator
from functools import partial
from typing import Any, cast

import httpx
import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text
from sqlalchemy.orm import Session

from app.db import get_sessionmaker
from app.models import User
from app.redis_client import get_redis
from app.services import applications as applications_service
from app.services import chat as chat_service
from app.services import chat_events
from app.services import flatmates as flatmates_service
from app.services import people as people_service
from app.services.flatmates import FLATMATES_MAX
from tests.conftest import (
    Outbox,
    make_application,
    make_flatmate,
    make_listing,
    make_pair,
    make_seeker,
    signup,
)
from tests.test_matching import _user_id
from tests.test_people import _like_person, _like_room, _page, _room, _seeker

pytestmark = pytest.mark.usefixtures("redis_clean")

NOT_FOUND = {"detail": "not_found"}
CHAT_CLOSED = {"detail": "chat_closed"}
TOKEN_LENGTH = 43  # `secrets.token_urlsafe(32)`


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _ok(response: httpx.Response, code: int = 200) -> Any:
    assert response.status_code == code, response.text
    return response.json() if response.content else None


def _invite(owner: TestClient, listing_id: Any) -> str:
    body = _ok(owner.post(f"/listings/{listing_id}/flatmate-invite"), 201)
    assert set(body) == {"token"}
    token: str = body["token"]
    return token


def _preview(caller: TestClient, token: str) -> httpx.Response:
    response: httpx.Response = caller.post("/flatmate-invites/preview", json={"token": token})
    return response


def _join(caller: TestClient, token: str) -> httpx.Response:
    response: httpx.Response = caller.post("/flatmate-invites/join", json={"token": token})
    return response


def _flatmates(owner: TestClient, listing_id: Any) -> list[dict[str, Any]]:
    body: list[dict[str, Any]] = _ok(owner.get(f"/listings/{listing_id}/flatmates"))
    return body


def _my_listing(owner: TestClient, listing_id: Any) -> dict[str, Any]:
    (item,) = (i for i in _ok(owner.get("/me/listings")) if i["id"] == str(listing_id))
    return cast(dict[str, Any], item)


def _list(caller: TestClient) -> list[dict[str, Any]]:
    body: list[dict[str, Any]] = _ok(caller.get("/me/conversations"))
    return body


def _ids(caller: TestClient) -> list[str]:
    return [item["id"] for item in _list(caller)]


def _item(caller: TestClient, conversation_id: Any) -> dict[str, Any]:
    (item,) = (c for c in _list(caller) if c["id"] == str(conversation_id))
    return item


def _thread(caller: TestClient, conversation_id: Any) -> httpx.Response:
    response: httpx.Response = caller.get(f"/conversations/{conversation_id}")
    return response


def _send(caller: TestClient, conversation_id: Any, body: str = "Hello") -> httpx.Response:
    response: httpx.Response = caller.post(
        f"/conversations/{conversation_id}/messages", json={"body": body}
    )
    return response


def _set_status(owner: TestClient, listing_id: Any, application_id: Any, status: str) -> None:
    response = owner.patch(
        f"/listings/{listing_id}/applications/{application_id}", json={"status": status}
    )
    assert response.status_code == 200, response.text


def _message(
    engine: Engine, conversation_id: Any, sender_id: uuid.UUID, body: str, ago_s: float
) -> None:
    """Insert a message `ago_s` seconds old by SQL and move `last_message_at` up to it."""
    with engine.begin() as conn:
        created_at = conn.execute(
            text(
                "INSERT INTO messages (conversation_id, sender_id, body, created_at)"
                " VALUES (:c, :s, :b, now() - make_interval(secs => :ago)) RETURNING created_at"
            ),
            {"c": conversation_id, "s": sender_id, "b": body, "ago": ago_s},
        ).scalar_one()
        conn.execute(
            text(
                "UPDATE conversations SET last_message_at = greatest(last_message_at, :t)"
                " WHERE application_id = :c"
            ),
            {"c": conversation_id, "t": created_at},
        )


def _bodies(response: httpx.Response) -> list[str]:
    body = _ok(response)
    return [m["body"] for m in body["messages"]]


def _joined_at(engine: Engine, listing_id: Any, user_id: uuid.UUID) -> dt.datetime:
    value: dt.datetime = _scalar(
        engine,
        "SELECT joined_at FROM listing_flatmates WHERE listing_id = :l AND user_id = :u",
        l=str(listing_id),
        u=user_id,
    )
    return value


def _reads(engine: Engine, user_id: uuid.UUID) -> int:
    count: int = _scalar(
        engine, "SELECT count(*) FROM conversation_reads WHERE user_id = :u", u=user_id
    )
    return count


def _members(owner: str, flatmates: list[str], seeker: str, me: str) -> list[dict[str, Any]]:
    roles = [(owner, "owner")] + [(name, "flatmate") for name in flatmates] + [(seeker, "seeker")]
    return [
        {"name": name, "photo_url": None, "role": role, "is_me": name == me} for name, role in roles
    ]


class Published:
    """Stands in for `chat_events.publish`: every call as (set of user ids, conversation id,
    kind)."""

    def __init__(self) -> None:
        self.calls: list[tuple[set[uuid.UUID], uuid.UUID, str]] = []

    def __call__(self, _r: Any, user_ids: Any, conversation_id: uuid.UUID, kind: str) -> None:
        self.calls.append((set(user_ids), conversation_id, kind))


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> Published:
    recorder = Published()
    monkeypatch.setattr(chat_events, "publish", recorder)
    return recorder


@pytest.fixture
def statements(db_engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement the app engine sends while the test records (`.clear()` to start)."""
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(db_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine, "before_cursor_execute", record)


@pytest.fixture
def owner(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "o@example.com", "owner", display_name="Noa")


@pytest.fixture
def owner_id(owner: TestClient) -> uuid.UUID:
    return _user_id(owner)


@pytest.fixture
def seeker(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID
) -> TestClient:
    return _seeker(client, outbox, db_engine, gush_dan, "s@example.com", "Dana")


@pytest.fixture
def seeker_id(seeker: TestClient) -> uuid.UUID:
    return _user_id(seeker)


@pytest.fixture
def mate(client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID) -> TestClient:
    return _seeker(client, outbox, db_engine, gush_dan, "f@example.com", "Fay")


@pytest.fixture
def mate_id(mate: TestClient) -> uuid.UUID:
    return _user_id(mate)


@pytest.fixture
def room(owner_id: uuid.UUID, gush_dan: uuid.UUID, db_engine: Engine) -> str:
    return _room(db_engine, owner_id, gush_dan)


@pytest.fixture
def chat(owner: TestClient, seeker_id: uuid.UUID, room: str, db_engine: Engine) -> uuid.UUID:
    """S's application to R, shortlisted by O through `0004c`'s PATCH: the conversation's id."""
    application_id = make_application(db_engine, uuid.UUID(room), seeker_id)
    _set_status(owner, room, application_id, "shortlisted")
    return application_id


def test_ac1_invite_create_rotate_disable(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    owner_id: uuid.UUID,
    seeker: TestClient,
    mate: TestClient,
    room: str,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    assert _my_listing(owner, room)["flatmate_invite_active"] is False

    created = owner.post(f"/listings/{room}/flatmate-invite")
    assert created.status_code == 201, created.text
    assert created.headers["Cache-Control"] == "no-store"
    first: str = created.json()["token"]
    assert len(first) == TOKEN_LENGTH
    stored = _scalar(db_engine, "SELECT flatmate_invite_hash FROM listings WHERE id = :id", id=room)
    assert stored == hashlib.sha256(first.encode()).hexdigest()
    # The token itself is in no column of the row.
    assert first not in _scalar(db_engine, "SELECT l::text FROM listings l WHERE id = :id", id=room)
    assert _my_listing(owner, room)["flatmate_invite_active"] is True
    assert "flatmate_invite_hash" not in _my_listing(owner, room)
    assert stored not in owner.get("/me/listings").text
    assert _ok(_preview(mate, first))["member"] is False

    second = _invite(owner, room)
    assert len(second) == TOKEN_LENGTH
    assert second != first
    assert _preview(mate, first).json() == NOT_FOUND
    assert _preview(mate, first).status_code == 404
    assert _ok(_preview(mate, second))["member"] is False

    assert _ok(owner.delete(f"/listings/{room}/flatmate-invite"), 204) is None
    for token in (first, second):
        response = _preview(mate, token)
        assert response.status_code == 404
        assert response.json() == NOT_FOUND
    assert _my_listing(owner, room)["flatmate_invite_active"] is False
    # Disabling twice is a no-op.
    assert owner.delete(f"/listings/{room}/flatmate-invite").status_code == 204

    apartment = make_listing(db_engine, owner_id, gush_dan)
    response = owner.post(f"/listings/{apartment}/flatmate-invite")
    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    other_owner = signup(client, outbox, "o2@example.com", "owner", display_name="Avi")
    for path in (f"/listings/{room}/flatmate-invite", f"/listings/{uuid.uuid4()}/flatmate-invite"):
        for method in ("post", "delete"):
            response = getattr(other_owner, method)(path)
            assert response.status_code == 404, (method, path)
            assert response.json() == NOT_FOUND
    for method in ("post", "delete"):
        # Spec 0010b: no role gate; a seeker on another's room is the unknown id's 404.
        response = getattr(seeker, method)(f"/listings/{room}/flatmate-invite")
        assert response.status_code == 404
        assert response.json() == NOT_FOUND
        assert getattr(client, method)(f"/listings/{room}/flatmate-invite").status_code == 401
    assert (
        _scalar(db_engine, "SELECT flatmate_invite_hash FROM listings WHERE id = :id", id=room)
        is None
    )

    # Any listing status: a paused room gets a link too.
    paused = _room(db_engine, owner_id, gush_dan, status="paused")
    assert len(_invite(owner, paused)) == TOKEN_LENGTH


def test_ac5b_any_lister_manages_flatmates(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    """Spec 0010b AC5: a seeker who lists a room creates, rotates and disables its invite link,
    and lists and removes its flatmates; another account gets the unknown id's 404 on each."""
    lister = _seeker(client, outbox, db_engine, gush_dan, "lister@example.com", "Noa")
    room = _room(db_engine, _user_id(lister), gush_dan)
    mate = _seeker(client, outbox, db_engine, gush_dan, "f@example.com", "Fay")

    first = _invite(lister, room)
    token = _invite(lister, room)  # rotated: the first link stops working
    assert token != first
    assert _preview(mate, first).json() == NOT_FOUND
    assert _ok(_join(mate, token)) == {"listing_id": room}
    (membership,) = _flatmates(lister, room)
    assert membership["display_name"] == "Fay"

    for other in (
        signup(client, outbox, "o2@example.com", "owner"),
        signup(client, outbox, "s2@example.com", "seeker"),
    ):
        for response in (
            other.post(f"/listings/{room}/flatmate-invite"),
            other.delete(f"/listings/{room}/flatmate-invite"),
            other.get(f"/listings/{room}/flatmates"),
            other.delete(f"/listings/{room}/flatmates/{membership['id']}"),
        ):
            assert response.status_code == 404
            assert response.json() == NOT_FOUND
    assert [f["display_name"] for f in _flatmates(lister, room)] == ["Fay"]
    assert _my_listing(lister, room)["flatmate_invite_active"] is True

    assert _ok(lister.delete(f"/listings/{room}/flatmates/{membership['id']}"), 204) is None
    assert _flatmates(lister, room) == []
    _invite(lister, room)
    assert _ok(lister.delete(f"/listings/{room}/flatmate-invite"), 204) is None
    assert _my_listing(lister, room)["flatmate_invite_active"] is False


def _api_routes(routes: Iterable[Any]) -> Iterator[APIRoute]:
    """Every endpoint, through the included routers (FastAPI wraps each `include_router`)."""
    for route in routes:
        if isinstance(route, APIRoute):
            yield route
        elif hasattr(route, "original_router"):
            yield from _api_routes(route.original_router.routes)


def _concurrent_joins(
    db_engine: Engine, listing_id: str, user_ids: list[uuid.UUID], token: str
) -> list[str]:
    """Join `listing_id` as each of `user_ids` at once, each through the service on its own
    connection, while the test holds the listing's row lock: every join blocks until it is
    released, then they run one by one. Returns each outcome, in order."""
    outcomes = ["" for _ in user_ids]
    started = threading.Barrier(len(user_ids) + 1, timeout=10)

    def run(index: int, user_id: uuid.UUID) -> None:
        with get_sessionmaker()() as db:
            user = db.get(User, user_id)
            assert user is not None
            db.rollback()
            started.wait()
            try:
                flatmates_service.join(db, get_redis(), user, token)
                outcomes[index] = "joined"
            except flatmates_service.FlatmatesFullError:
                outcomes[index] = "flatmates_full"
            except Exception as exc:  # pragma: no cover - reported by the assertions
                outcomes[index] = repr(exc)

    with db_engine.connect() as lock:
        lock.execute(text("SELECT id FROM listings WHERE id = :id FOR UPDATE"), {"id": listing_id})
        threads = [
            threading.Thread(target=run, args=(i, user_id)) for i, user_id in enumerate(user_ids)
        ]
        for thread in threads:
            thread.start()
        started.wait()
        time.sleep(0.5)  # both joins are now waiting on the lock
        assert outcomes == ["" for _ in user_ids]
        lock.commit()
    for thread in threads:
        thread.join(timeout=15)
    return outcomes


def test_ac2_preview_and_join(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    owner_id: uuid.UUID,
    seeker: TestClient,
    seeker_id: uuid.UUID,
    mate: TestClient,
    mate_id: uuid.UUID,
    room: str,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    token = _invite(owner, room)

    preview = _ok(_preview(mate, token))
    assert preview == {
        "listing": {
            "id": room,
            "listing_type": "room",
            "city": preview["listing"]["city"],
            "street": preview["listing"]["street"],
            "rooms": preview["listing"]["rooms"],
            "price_ils": preview["listing"]["price_ils"],
        },
        "owner_name": "Noa",
        "member": False,
    }
    assert _flatmates(owner, room) == []

    assert _ok(_join(mate, token)) == {"listing_id": room}
    joined_at = _joined_at(db_engine, room, mate_id)
    assert _ok(_preview(mate, token))["member"] is True
    assert _ok(_join(mate, token)) == {"listing_id": room}  # idempotent
    assert _joined_at(db_engine, room, mate_id) == joined_at
    (listed,) = _flatmates(owner, room)
    assert listed["display_name"] == "Fay"
    assert dt.datetime.fromisoformat(listed["joined_at"]) == joined_at
    assert set(listed) == {"id", "display_name", "photo_url", "joined_at"}  # photo_url: 0010j
    assert str(mate_id) not in owner.get(f"/listings/{room}/flatmates").text
    assert _my_listing(owner, room)["flatmate_count"] == 1

    # Any role may join; the owner may not.
    other_owner = signup(client, outbox, "o2@example.com", "owner", display_name="Avi")
    assert _ok(_join(other_owner, token)) == {"listing_id": room}
    for call in (_preview, _join):
        response = call(owner, token)
        assert response.status_code == 409
        assert response.json() == {"detail": "own_listing"}

    # A non-withdrawn application must be withdrawn first.
    application_id = make_application(db_engine, uuid.UUID(room), seeker_id)
    assert _ok(_preview(seeker, token))["member"] is False
    response = _join(seeker, token)
    assert response.status_code == 409
    assert response.json() == {"detail": "already_applied"}
    _ok(seeker.post(f"/me/applications/{application_id}/withdraw"))
    assert _ok(_join(seeker, token)) == {"listing_id": room}

    # Surrounding whitespace is trimmed; a blank or non-URL-safe token is a 422, never counted.
    assert _ok(_preview(mate, f"  {token}\n"))["member"] is True
    assert _ok(_join(mate, f" {token} ")) == {"listing_id": room}
    counter = f"rl:flatmate:user:{mate_id}"
    counted = int(get_redis().get(counter) or 0)
    for bad in ("   ", "a b", "x" * 42 + "=", "../x"):
        assert _preview(mate, bad).status_code == 422, bad
        assert _join(mate, bad).status_code == 422, bad
    assert int(get_redis().get(counter) or 0) == counted

    # Unknown and malformed tokens.
    assert _preview(mate, "x" * 43).json() == NOT_FOUND
    assert _join(mate, "x" * 43).status_code == 404
    for bad in ("", "x" * 101):
        assert _preview(mate, bad).status_code == 422
        assert _join(mate, bad).status_code == 422
    assert mate.post("/flatmate-invites/join", json={}).status_code == 422
    assert client.post("/flatmate-invites/preview", json={"token": token}).status_code == 401
    assert client.post("/flatmate-invites/join", json={"token": token}).status_code == 401

    # Up to FLATMATES_MAX: three members so far, four more join, the eighth is refused.
    for n in range(4):
        joiner = signup(client, outbox, f"j{n}@example.com", "seeker", display_name=f"J{n}")
        assert _ok(_join(joiner, token)) == {"listing_id": room}
    assert len(_flatmates(owner, room)) == FLATMATES_MAX
    eighth = signup(client, outbox, "j8@example.com", "seeker", display_name="J8")
    response = _join(eighth, token)
    assert response.status_code == 409
    assert response.json() == {"detail": "flatmates_full"}
    assert _ok(_join(mate, token)) == {"listing_id": room}  # a member still gets 200

    # The 7th and the 8th joining at once on two connections: exactly one gets in.
    second_room = _room(db_engine, owner_id, gush_dan)
    for n in range(FLATMATES_MAX - 1):
        make_flatmate(db_engine, uuid.UUID(second_room), make_seeker(db_engine, f"m{n}@x.com"))
    second_token = _invite(owner, second_room)
    racers = [make_seeker(db_engine, f"r{n}@example.com") for n in range(2)]
    outcomes = _concurrent_joins(db_engine, second_room, racers, second_token)
    assert sorted(outcomes) == ["flatmates_full", "joined"], outcomes
    assert len(_flatmates(owner, second_room)) == FLATMATES_MAX

    # The 21st preview or join in an hour, found or not, is a 429.
    r = get_redis()
    scanner = signup(client, outbox, "scan@example.com", "seeker", display_name="Scan")
    for n in range(20):
        response = (_preview if n % 2 else _join)(scanner, f"guess-{n}")
        assert response.status_code == 404, (n, response.text)
    assert int(r.get(f"rl:flatmate:user:{_user_id(scanner)}") or 0) == 20
    for call in (_preview, _join):
        limited = call(scanner, token)
        assert limited.status_code == 429
        assert limited.json() == {"detail": "rate_limited"}
        assert 1 <= int(limited.headers["Retry-After"]) <= 3600

    # No route takes the token in its path or query; the token calls are POSTs with a body.
    app = cast(FastAPI, client.app)
    routes = list(_api_routes(app.routes))
    assert len(routes) > 30  # the walk reaches every router (none is mounted with a prefix)
    for route in routes:
        assert "token" not in route.path.lower(), route.path
        assert "token" not in {param.name for param in route.dependant.path_params}, route.path
    token_routes = {
        route.path: route for route in routes if route.path.startswith("/flatmate-invites")
    }
    assert set(token_routes) == {"/flatmate-invites/preview", "/flatmate-invites/join"}
    for route in token_routes.values():
        assert route.methods == {"POST"}
        assert route.dependant.query_params == []
        assert route.dependant.path_params == []
        assert [param.name for param in route.dependant.body_params] == ["body"]


def test_ac3_history_from_join(
    owner: TestClient,
    owner_id: uuid.UUID,
    seeker: TestClient,
    seeker_id: uuid.UUID,
    mate: TestClient,
    mate_id: uuid.UUID,
    room: str,
    chat: uuid.UUID,
    db_engine: Engine,
) -> None:
    _message(db_engine, chat, seeker_id, "m1", 20)
    _message(db_engine, chat, owner_id, "m2", 10)
    assert _list(mate) == []
    assert _thread(mate, chat).status_code == 404

    _ok(_join(mate, _invite(owner, room)))
    joined_at = _joined_at(db_engine, room, mate_id)
    _ok(_send(seeker, chat, "m3"), 201)

    (item,) = _list(mate)
    assert item["id"] == str(chat)
    assert item["my_role"] == "flatmate"
    assert item["other_name"] == "Dana"
    assert item["member_count"] == 3
    assert item["unread_count"] == 1
    assert item["is_new"] is True
    assert item["can_send"] is True
    assert item["last_message"]["body"] == "m3"
    assert item["last_message"]["mine"] is False

    body = _ok(_thread(mate, chat))
    assert body["my_role"] == "flatmate"
    assert body["other_name"] == "Dana"
    assert dt.datetime.fromisoformat(body["visible_from"]) == joined_at
    assert [m["body"] for m in body["messages"]] == ["m3"]
    assert body["messages"][0]["sender_name"] == "Dana"
    assert body["messages"][0]["mine"] is False
    assert body["members"] == _members("Noa", ["Fay"], "Dana", me="Fay")
    for key in ("owner_id", "seeker_id", "user_id", "email"):
        assert key not in _thread(mate, chat).text
    assert str(seeker_id) not in _thread(mate, chat).text

    for caller, me, other in ((seeker, "Dana", "Noa"), (owner, "Noa", "Dana")):
        thread = _ok(_thread(caller, chat))
        assert [m["body"] for m in thread["messages"]] == ["m1", "m2", "m3"]
        assert [m["sender_name"] for m in thread["messages"]] == ["Dana", "Noa", "Dana"]
        assert thread["members"] == _members("Noa", ["Fay"], "Dana", me=me)
        assert thread["other_name"] == other
        assert thread["visible_from"] is None
        assert _item(caller, chat)["member_count"] == 3
    assert _ok(_thread(seeker, chat))["my_role"] == "seeker"
    assert _ok(_thread(owner, chat))["my_role"] == "owner"

    # A withdrawn seeker who joins the flat stays the seeker of their own chat, listed once.
    _ok(seeker.post(f"/me/applications/{chat}/withdraw"))
    _ok(_join(seeker, _invite(owner, room)))
    own = _ok(_thread(seeker, chat))
    assert (own["my_role"], own["visible_from"]) == ("seeker", None)
    assert [m["body"] for m in own["messages"]] == ["m1", "m2", "m3"]
    assert own["members"] == _members("Noa", ["Fay"], "Dana", me="Dana")
    assert _item(seeker, chat)["member_count"] == 3
    assert _item(mate, chat)["member_count"] == 3


def test_ac4_flatmate_sends_and_hears_events(
    owner: TestClient,
    owner_id: uuid.UUID,
    seeker: TestClient,
    seeker_id: uuid.UUID,
    mate: TestClient,
    mate_id: uuid.UUID,
    room: str,
    chat: uuid.UUID,
    db_engine: Engine,
    published: Published,
) -> None:
    _ok(_join(mate, _invite(owner, room)))
    for caller in (owner, seeker):
        _ok(_thread(caller, chat))  # both read: unread 0
    everyone = {owner_id, seeker_id, mate_id}
    published.calls.clear()  # the fixtures' shortlist

    sent = _ok(_send(mate, chat, "m4"), 201)
    assert sent["mine"] is True
    assert sent["sender_name"] == "Fay"
    assert (
        _scalar(db_engine, "SELECT sender_id FROM messages WHERE id = :id", id=sent["id"])
        == mate_id
    )
    assert published.calls == [(everyone, chat, "message")]
    for caller in (owner, seeker):
        item = _item(caller, chat)
        assert item["unread_count"] == 1
        assert item["last_message"] == {
            "body": "m4",
            "mine": False,
            "created_at": sent["created_at"],
        }
    thread = _ok(_thread(owner, chat))
    assert [(m["body"], m["sender_name"], m["mine"]) for m in thread["messages"]] == [
        ("m4", "Fay", False)
    ]
    # The flatmate's own send is read for them; the owner's and seeker's columns did not move.
    assert _item(mate, chat)["unread_count"] == 0
    assert _item(mate, chat)["is_new"] is False
    assert _item(seeker, chat)["unread_count"] == 1

    published.calls.clear()
    _set_status(owner, room, chat, "submitted")
    assert published.calls == [(everyone, chat, "status")]
    for caller in (mate, owner, seeker):
        response = _send(caller, chat)
        assert response.status_code == 409
        assert response.json() == CHAT_CLOSED
        assert _item(caller, chat)["can_send"] is False
    assert _ok(_thread(mate, chat))["can_send"] is False

    published.calls.clear()
    _set_status(owner, room, chat, "shortlisted")
    assert published.calls == [(everyone, chat, "status")]
    for caller in (mate, owner, seeker):
        _ok(_send(caller, chat), 201)
    assert [call[0] for call in published.calls[1:]] == [everyone] * 3

    # The seeker's withdraw reaches every member too.
    published.calls.clear()
    _ok(seeker.post(f"/me/applications/{chat}/withdraw"))
    assert published.calls == [(everyone, chat, "status")]

    # A room application without a chat has no flatmate audience: its events reach the two sides.
    published.calls.clear()
    other_id = make_seeker(db_engine, "q@example.com", "Quinn")
    unopened = make_application(db_engine, uuid.UUID(room), other_id)
    _set_status(owner, room, unopened, "declined")
    assert published.calls == [({owner_id, other_id}, unopened, "status")]


def test_ac5_apartment_applications_have_no_flatmates(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    owner_id: uuid.UUID,
    mate: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    apartment = make_listing(db_engine, owner_id, gush_dan)
    old_seeker = make_seeker(db_engine, "old@example.com", "Old")
    old = make_application(db_engine, apartment, old_seeker)
    _set_status(owner, apartment, old, "shortlisted")
    _message(db_engine, old, old_seeker, "about the apartment", 1)

    # A listing switched before spec 0010a (an edit can no longer switch the type).
    _execute(
        db_engine,
        "UPDATE listings SET listing_type = 'room', flatmates_count = 2 WHERE id = :id",
        id=apartment,
    )
    _ok(_join(mate, _invite(owner, apartment)))

    assert old not in [uuid.UUID(i) for i in _ids(mate)]
    assert _list(mate) == []
    assert _thread(mate, old).json() == NOT_FOUND
    response = _send(mate, old)
    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    owner_thread = _ok(_thread(owner, old))
    assert owner_thread["members"] == _members("Noa", [], "Old", me="Noa")
    assert _item(owner, old)["member_count"] == 2

    new_seeker = make_seeker(db_engine, "new@example.com", "New")
    new = make_application(db_engine, apartment, new_seeker)  # a room application now
    _set_status(owner, apartment, new, "shortlisted")
    assert _ids(mate) == [str(new)]
    assert _ok(_thread(mate, new))["members"] == _members("Noa", ["Fay"], "New", me="Fay")


def test_ac6_remove_and_rejoin(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    owner_id: uuid.UUID,
    seeker: TestClient,
    seeker_id: uuid.UUID,
    mate: TestClient,
    mate_id: uuid.UUID,
    room: str,
    chat: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    old_token = _invite(owner, room)
    _ok(_join(mate, old_token))
    _ok(_send(seeker, chat, "while a member"), 201)
    _ok(_thread(mate, chat))
    assert _reads(db_engine, mate_id) == 1
    other = _seeker(client, outbox, db_engine, gush_dan, "g@example.com", "Gil")
    _ok(_join(other, old_token))
    (membership,) = (f for f in _flatmates(owner, room) if f["display_name"] == "Fay")

    # Another listing's membership, through this listing's path: 404, nothing removed.
    second_room = _room(db_engine, owner_id, gush_dan)
    elsewhere = make_flatmate(db_engine, uuid.UUID(second_room), make_seeker(db_engine, "e@x.com"))
    response = owner.delete(f"/listings/{room}/flatmates/{elsewhere}")
    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    other_owner = signup(client, outbox, "o2@example.com", "owner", display_name="Avi")
    for caller, path in (
        (other_owner, f"/listings/{room}/flatmates/{membership['id']}"),
        (owner, f"/listings/{room}/flatmates/{uuid.uuid4()}"),
        (owner, f"/listings/{uuid.uuid4()}/flatmates/{membership['id']}"),
    ):
        response = caller.delete(path)
        assert response.status_code == 404, path
        assert response.json() == NOT_FOUND
    assert other_owner.get(f"/listings/{room}/flatmates").status_code == 404
    # Spec 0010b: no role gate; a seeker on another's listing is the unknown id's 404.
    assert seeker.get(f"/listings/{room}/flatmates").json() == NOT_FOUND
    assert seeker.delete(f"/listings/{room}/flatmates/{membership['id']}").status_code == 404
    assert client.get(f"/listings/{room}/flatmates").status_code == 401
    assert len(_flatmates(owner, second_room)) == 1
    assert len(_flatmates(owner, room)) == 2

    assert _ok(owner.delete(f"/listings/{room}/flatmates/{membership['id']}"), 204) is None
    assert _thread(mate, chat).json() == NOT_FOUND
    response = _send(mate, chat)
    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    assert _list(mate) == []
    assert _reads(db_engine, mate_id) == 0
    assert [f["display_name"] for f in _flatmates(owner, room)] == ["Gil"]
    assert _ok(_thread(other, chat))["can_send"] is True  # the others keep their access
    assert _ok(_thread(seeker, chat))["members"] == _members("Noa", ["Gil"], "Dana", me="Dana")
    # The link is off: the removed flatmate's old token is dead.
    assert _my_listing(owner, room)["flatmate_invite_active"] is False
    for call in (_preview, _join):
        response = call(mate, old_token)
        assert response.status_code == 404
        assert response.json() == NOT_FOUND
    assert _my_listing(owner, room)["flatmate_count"] == 1

    time.sleep(0.01)  # a new `joined_at`, strictly later than the message above
    _ok(_join(mate, _invite(owner, room)))
    rejoined_at = _joined_at(db_engine, room, mate_id)
    _ok(_send(owner, chat, "after the re-join"), 201)
    body = _ok(_thread(mate, chat))
    assert dt.datetime.fromisoformat(body["visible_from"]) == rejoined_at
    assert [m["body"] for m in body["messages"]] == ["after the re-join"]
    assert body["members"] == _members("Noa", ["Gil", "Fay"], "Dana", me="Fay")


def test_ac7_leave(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    owner_id: uuid.UUID,
    seeker: TestClient,
    mate: TestClient,
    mate_id: uuid.UUID,
    room: str,
    chat: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    token = _invite(owner, room)
    _ok(_join(mate, token))
    other_owner = signup(client, outbox, "o2@example.com", "owner", display_name="Avi")
    other_room = _room(db_engine, _user_id(other_owner), gush_dan)
    time.sleep(0.01)
    _ok(_join(mate, _invite(other_owner, other_room)))
    _ok(_send(seeker, chat, "hi"), 201)
    _ok(_thread(mate, chat))
    assert _reads(db_engine, mate_id) == 1

    flats = _ok(mate.get("/me/flats"))
    assert [flat["listing"]["id"] for flat in flats] == [other_room, room]  # newest join first
    assert [flat["owner_name"] for flat in flats] == ["Avi", "Noa"]
    assert set(flats[0]) == {"listing", "owner_name", "joined_at"}
    assert dt.datetime.fromisoformat(flats[1]["joined_at"]) == _joined_at(db_engine, room, mate_id)
    assert _ok(seeker.get("/me/flats")) == []
    assert client.get("/me/flats").status_code == 401

    assert _ok(mate.delete(f"/me/flats/{room}"), 204) is None
    assert _thread(mate, chat).json() == NOT_FOUND
    response = _send(mate, chat)
    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    assert _list(mate) == []
    assert _reads(db_engine, mate_id) == 0
    assert _flatmates(owner, room) == []
    assert [flat["listing"]["id"] for flat in _ok(mate.get("/me/flats"))] == [other_room]
    # Leaving does not touch the link.
    assert _my_listing(owner, room)["flatmate_invite_active"] is True
    assert _ok(_preview(mate, token))["member"] is False

    for listing_id in (room, uuid.uuid4()):  # no longer a member, unknown: 204 either way
        assert mate.delete(f"/me/flats/{listing_id}").status_code == 204
    assert seeker.delete(f"/me/flats/{other_room}").status_code == 204
    assert [flat["listing"]["id"] for flat in _ok(mate.get("/me/flats"))] == [other_room]
    assert client.delete(f"/me/flats/{room}").status_code == 401


def test_ac8_flatmate_cannot_apply_or_like_own_flat(
    owner: TestClient,
    owner_id: uuid.UUID,
    mate: TestClient,
    mate_id: uuid.UUID,
    room: str,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    _execute(
        db_engine,
        "UPDATE seeker_profiles SET people_visible = true WHERE user_id = :id",
        id=mate_id,
    )
    assert _ok(_like_room(mate, room)) == {"liked": True, "application_id": None}
    (card,) = _page(owner, room)["items"]
    assert card["display_name"] == "Fay"
    assert _my_listing(owner, room)["liked_me_count"] == 1

    _ok(_join(mate, _invite(owner, room)))
    assert _my_listing(owner, room)["liked_me_count"] == 0  # a flatmate's like is not pending
    response = mate.post(f"/listings/{room}/applications", json={"message": "Hello there"})
    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    response = _like_room(mate, room)
    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    assert _page(owner, room) == {"items": [], "total": 0}
    response = _like_person(owner, room, card["id"])
    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    assert _scalar(db_engine, "SELECT count(*) FROM applications") == 0

    # Another room of the same owner is open to them as before.
    other_room = _room(db_engine, owner_id, gush_dan)
    applied = mate.post(f"/listings/{other_room}/applications", json={"message": "Hello there"})
    assert applied.status_code == 201, applied.text

    # After leaving, they are a candidate again.
    assert mate.delete(f"/me/flats/{room}").status_code == 204
    assert [item["display_name"] for item in _page(owner, room)["items"]] == ["Fay"]


def _while_joining(
    db_engine: Engine, listing_id: str, user_id: uuid.UUID, call: Callable[[], str]
) -> str:
    """Run `call` in a thread while connection A is in the middle of `user_id`'s join, as
    `flatmates.join` does it: the listing locked `FOR UPDATE` and the membership inserted, not yet
    committed. Asserts that `call` waits for A, then commits A and returns `call`'s outcome."""
    outcome = [""]

    def run() -> None:
        try:
            outcome[0] = call()
        except Exception as exc:
            outcome[0] = type(exc).__name__

    with db_engine.connect() as join:
        join.execute(text("SELECT id FROM listings WHERE id = :id FOR UPDATE"), {"id": listing_id})
        join.execute(
            text("INSERT INTO listing_flatmates (listing_id, user_id) VALUES (:l, :u)"),
            {"l": listing_id, "u": user_id},
        )
        thread = threading.Thread(target=run)
        thread.start()
        time.sleep(0.5)
        assert outcome == [""], outcome  # it waits for the join's lock
        join.commit()
    thread.join(timeout=15)
    return outcome[0]


def _as(user_id: uuid.UUID, action: Callable[[Any, User], Any]) -> Callable[[], str]:
    """`action(db, user)` on a session of its own, as `user_id`; "ok" when it returns."""

    def call() -> str:
        with get_sessionmaker()() as db:
            user = db.get(User, user_id)
            assert user is not None
            db.rollback()
            action(db, user)
            return "ok"

    return call


def _open_applications(engine: Engine, listing_id: str, user_id: uuid.UUID) -> int:
    count: int = _scalar(
        engine,
        "SELECT count(*) FROM applications WHERE listing_id = :l AND seeker_id = :u"
        " AND status <> 'withdrawn'",
        l=listing_id,
        u=user_id,
    )
    return count


def test_ac8_join_racing_apply_is_never_both(
    client: TestClient,
    outbox: Outbox,
    room: str,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    fresh = _user_id(_seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi"))
    reopening = _user_id(_seeker(client, outbox, db_engine, gush_dan, "b@example.com", "Bat"))
    make_application(db_engine, uuid.UUID(room), reopening, status="withdrawn")
    for user_id in (fresh, reopening):  # a new application, and a withdrawn one reopened
        apply = _as(
            user_id,
            lambda db, user: applications_service.apply(
                db, get_redis(), user, uuid.UUID(room), "Hello there"
            ),
        )
        outcome = _while_joining(db_engine, room, user_id, apply)
        assert outcome == "ListingNotFoundError", outcome  # the router's 404
        assert _open_applications(db_engine, room, user_id) == 0
        assert _scalar(db_engine, "SELECT count(*) FROM room_pairs") == 0


def test_ac8_join_racing_like_is_never_both(
    client: TestClient,
    outbox: Outbox,
    owner_id: uuid.UUID,
    room: str,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    # The seeker's like would make it mutual: the lister liked them first.
    a = _user_id(_seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi"))
    make_pair(db_engine, uuid.UUID(room), a, price_ils_seen=4500, lister_liked=True)
    like_room = _as(
        a, lambda db, user: people_service.like_room(db, get_redis(), user, uuid.UUID(room))
    )
    assert _while_joining(db_engine, room, a, like_room) == "ListingNotFoundError"
    assert _open_applications(db_engine, room, a) == 0

    # The lister's like would make it mutual: the seeker liked first.
    b = _user_id(_seeker(client, outbox, db_engine, gush_dan, "b@example.com", "Bat"))
    pair = make_pair(db_engine, uuid.UUID(room), b, price_ils_seen=4500, seeker_liked=True)
    like_person = _as(
        owner_id,
        lambda db, user: people_service.like_person(db, get_redis(), user, uuid.UUID(room), pair),
    )
    assert _while_joining(db_engine, room, b, like_person) == "ListingNotFoundError"
    assert _open_applications(db_engine, room, b) == 0
    assert _scalar(db_engine, "SELECT count(*) FROM conversations") == 0


def test_join_after_decline(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    room: str,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    token = _invite(owner, room)
    callers = {
        name: _seeker(client, outbox, db_engine, gush_dan, f"{name}@example.com", name.title())
        for name in ("straight", "later", "submitted", "shortlisted", "withdrawn")
    }
    applications = {
        name: make_application(db_engine, uuid.UUID(room), _user_id(caller))
        for name, caller in callers.items()
    }
    _set_status(owner, room, applications["straight"], "declined")  # from submitted
    _set_status(owner, room, applications["later"], "shortlisted")
    _set_status(owner, room, applications["later"], "declined")  # after a shortlist
    _set_status(owner, room, applications["shortlisted"], "shortlisted")
    _ok(callers["withdrawn"].post(f"/me/applications/{applications['withdrawn']}/withdraw"))

    for name, detail in (
        ("straight", "declined"),
        ("later", "declined"),
        ("submitted", "already_applied"),
        ("shortlisted", "already_applied"),
    ):
        response = _join(callers[name], token)
        assert response.status_code == 409, (name, response.text)
        assert response.json() == {"detail": detail}
    assert _ok(_join(callers["withdrawn"], token)) == {"listing_id": room}
    assert [f["display_name"] for f in _flatmates(owner, room)] == ["Withdrawn"]
    assert _scalar(db_engine, "SELECT count(*) FROM listing_flatmates") == 1


def test_ac9_flatmate_read_marker(
    owner: TestClient,
    seeker: TestClient,
    seeker_id: uuid.UUID,
    mate: TestClient,
    mate_id: uuid.UUID,
    room: str,
    chat: uuid.UUID,
    db_engine: Engine,
    statements: list[str],
) -> None:
    _ok(_join(mate, _invite(owner, room)))
    _ok(_send(seeker, chat, "hi all"), 201)

    def party_markers() -> tuple[Any, ...]:
        with db_engine.connect() as conn:
            return tuple(
                conn.execute(
                    text(
                        "SELECT owner_read_at, seeker_read_at FROM conversations"
                        " WHERE application_id = :a"
                    ),
                    {"a": chat},
                ).one()
            )

    before = party_markers()
    item = _item(mate, chat)
    assert (item["is_new"], item["unread_count"]) == (True, 1)
    assert _reads(db_engine, mate_id) == 0

    mate.get("/me")  # warm-up
    statements.clear()
    _ok(_thread(mate, chat))
    first = list(statements)
    assert any(s.lstrip().startswith("INSERT INTO conversation_reads") for s in first), first
    assert _reads(db_engine, mate_id) == 1
    item = _item(mate, chat)
    assert (item["is_new"], item["unread_count"]) == (False, 0)

    statements.clear()
    _ok(_thread(mate, chat))
    again = list(statements)
    assert not any("INSERT" in s or "UPDATE" in s for s in again), again
    assert party_markers() == before

    # Something new: the marker moves forward, and only F's.
    read_at = _scalar(
        db_engine, "SELECT read_at FROM conversation_reads WHERE user_id = :u", u=mate_id
    )
    _ok(_send(owner, chat, "news"), 201)
    before = party_markers()
    assert _item(mate, chat)["unread_count"] == 1
    _ok(_thread(mate, chat))
    assert (
        _scalar(db_engine, "SELECT read_at FROM conversation_reads WHERE user_id = :u", u=mate_id)
        > read_at
    )
    assert _item(mate, chat)["unread_count"] == 0
    assert party_markers() == before
    assert _item(seeker, chat)["unread_count"] == 1


def test_ac10_mutual_match_includes_flatmates(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    owner_id: uuid.UUID,
    mate: TestClient,
    mate_id: uuid.UUID,
    room: str,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    published: Published,
) -> None:
    _ok(_join(mate, _invite(owner, room)))
    liker = _seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")
    assert _ok(_like_room(liker, room)) == {"liked": True, "application_id": None}
    assert published.calls == []
    (card,) = _page(owner, room)["items"]
    application_id = _ok(_like_person(owner, room, card["id"]))["application_id"]
    assert application_id is not None
    conversation = uuid.UUID(application_id)
    assert published.calls == [({owner_id, _user_id(liker), mate_id}, conversation, "status")]

    item = _item(mate, conversation)
    assert (item["my_role"], item["other_name"], item["member_count"]) == ("flatmate", "Avi", 3)
    assert _ok(_thread(mate, conversation))["members"] == _members("Noa", ["Fay"], "Avi", me="Fay")

    # The mirror case: the lister likes first, the seeker's like makes it mutual.
    published.calls.clear()
    second = _seeker(client, outbox, db_engine, gush_dan, "b@example.com", "Bat")
    (card,) = (c for c in _page(owner, room)["items"] if c["display_name"] == "Bat")
    assert _ok(_like_person(owner, room, card["id"]))["application_id"] is None
    mirrored = _ok(_like_room(second, room))["application_id"]
    assert published.calls == [
        ({owner_id, _user_id(second), mate_id}, uuid.UUID(mirrored), "status")
    ]
    assert mirrored in _ids(mate)


def test_ac12_statement_counts(
    owner: TestClient,
    owner_id: uuid.UUID,
    seeker: TestClient,
    seeker_id: uuid.UUID,
    mate: TestClient,
    room: str,
    chat: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    statements: list[str],
) -> None:
    _ok(_join(mate, _invite(owner, room)))
    apartment = make_listing(db_engine, owner_id, gush_dan)
    flat = make_application(db_engine, apartment, seeker_id)
    _set_status(owner, apartment, flat, "shortlisted")
    for n in range(3):
        other = make_seeker(db_engine, f"x{n}@example.com", f"X{n}")
        extra = make_application(db_engine, uuid.UUID(room), other)
        _set_status(owner, room, extra, "shortlisted")
        _message(db_engine, extra, other, f"hi {n}", 1)

    def measure(call: Callable[[], httpx.Response], code: int = 200) -> list[str]:
        statements.clear()
        response = call()
        sent = list(statements)
        assert response.status_code == code, response.text
        return sent

    for caller, expected in ((owner, 5), (seeker, 2), (mate, 4)):
        caller.get("/me")  # warm-up: a first connect sends its own setup statements
        sent = measure(partial(caller.get, "/me/conversations"))
        assert len(_list(caller)) == expected
        assert len(sent) == 2, sent  # the session lookup, then the list
        assert "FROM conversations" in sent[1]

    # The thread: session, header, messages, the flatmates (room only), the marker when new.
    for caller, sender in ((owner, seeker), (seeker, owner), (mate, seeker)):
        _ok(_send(sender, chat, "new"), 201)
        first = measure(partial(_thread, caller, chat))
        assert len(first) == 5, first
        assert "FROM listing_flatmates" in first[3]
        assert first[4].lstrip().startswith(("UPDATE conversations", "INSERT INTO conversation"))
        again = measure(partial(_thread, caller, chat))
        assert len(again) == 4, again
    for caller in (owner, seeker):
        _ok(_thread(caller, flat))
        apartment_thread = measure(partial(_thread, caller, flat))
        assert len(apartment_thread) == 3, apartment_thread  # as before 0008d: no flatmates SELECT

    # A send adds none: session, the INSERT, the UPDATE (members from its RETURNING).
    for caller, conversation in ((owner, chat), (seeker, chat), (mate, chat), (owner, flat)):
        sent = measure(partial(_send, caller, conversation), 201)
        assert len(sent) == 3, sent
        assert sent[1].lstrip().startswith("INSERT INTO messages")
        assert "UPDATE conversations" in sent[2]

    # A room status change adds one (`member_ids`); an apartment's does not.
    def patch(listing_id: Any, application_id: Any, status: str) -> httpx.Response:
        response: httpx.Response = owner.patch(
            f"/listings/{listing_id}/applications/{application_id}", json={"status": status}
        )
        return response

    room_change = measure(partial(patch, room, chat, "submitted"))
    assert len(room_change) == 4, room_change  # session, UPDATE, response row, member ids
    assert "FROM applications" in room_change[3]
    assert len(measure(partial(patch, room, chat, "shortlisted"))) == 5  # plus the chat INSERT
    assert len(measure(partial(patch, apartment, flat, "submitted"))) == 3


def _scans_of(node: dict[str, Any], relation: str) -> Iterator[dict[str, Any]]:
    """Every plan node of an `EXPLAIN (FORMAT JSON)` tree that reads `relation`."""
    if node.get("Relation Name") == relation:
        yield node
    for child in node.get("Plans", []):
        yield from _scans_of(child, relation)


def test_ac12_list_uses_indexes_for_every_role(
    owner: TestClient,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    mate: TestClient,
    mate_id: uuid.UUID,
    room: str,
    chat: uuid.UUID,
    db_engine: Engine,
) -> None:
    """The list's membership must drive an index (perf review major 1). With sequential scans
    priced out, every read of `conversations` must still be bounded by an index condition: a seq
    scan, or a primary-key index scan without a condition (a full scan in index order, what the
    planner picks for the bare OR), fails."""
    _ok(_join(mate, _invite(owner, room)))
    with Session(db_engine) as db:
        for user_id in (owner_id, seeker_id, mate_id):
            user = db.get(User, user_id)
            assert user is not None
            compiled = chat_service.list_statement(user).compile(dialect=db_engine.dialect)
            with db_engine.connect() as conn:
                conn.exec_driver_sql("SET LOCAL enable_seqscan = off")
                (plan,) = conn.exec_driver_sql(
                    "EXPLAIN (FORMAT JSON) " + str(compiled), compiled.params
                ).scalar_one()
                conn.rollback()
            scans = list(_scans_of(plan["Plan"], "conversations"))
            assert scans, plan
            for scan in scans:
                assert scan["Node Type"] != "Seq Scan", scan
                if scan["Node Type"] in ("Index Scan", "Index Only Scan"):
                    assert "Index Cond" in scan, scan
                else:
                    assert scan["Node Type"] == "Bitmap Heap Scan", scan


def test_ac13_non_member_send_is_404(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    mate: TestClient,
    room: str,
    chat: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    other_room = _room(db_engine, owner_id, gush_dan)
    stranger = _seeker(client, outbox, db_engine, gush_dan, "g@example.com", "Gil")
    _ok(_join(stranger, _invite(owner, other_room)))  # a flatmate of another room
    _ok(_join(mate, _invite(owner, room)))
    apartment = make_listing(db_engine, owner_id, gush_dan)
    flat = make_application(db_engine, apartment, seeker_id)
    _set_status(owner, apartment, flat, "shortlisted")

    for status in ("shortlisted", "submitted"):  # open, then closed: never a 409
        _set_status(owner, room, chat, status)
        for caller, conversation in ((stranger, chat), (mate, flat)):
            response = _send(caller, conversation)
            assert response.status_code == 404, (status, response.text)
            assert response.json() == NOT_FOUND
            assert _thread(caller, conversation).json() == NOT_FOUND
    assert _scalar(db_engine, "SELECT count(*) FROM messages") == 0
    assert _ids(stranger) == []
    assert _ids(mate) == [str(chat)]
