"""Self-serve account deletion and the re-signup block (spec 0013c): AC1-AC9, AC13-AC15, NF1, NF2
(AC9's settings rules are in `test_config.py`, AC10 in `test_admin.py`, AC11 in
`test_migrations.py`, AC12 in `test_hardening.py`).

`U` is the account deleted. Sessions are inserted directly (`_session`, a fresh one unless aged),
so only the re-signup checks spend OTP codes (3 per email per 15 min)."""

import datetime as dt
import hashlib
import logging
import os
import secrets
import threading
import time
import uuid
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import Engine, event, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Base, User
from app.services import accounts
from app.services import auth as auth_service
from app.services import photos as photos_service
from app.services.photo_store import FilePhotoStore
from tests.conftest import (
    Outbox,
    jpeg,
    make_application,
    make_card,
    make_direct_chat,
    make_flatmate,
    make_listing,
    make_owner,
    make_pair,
    make_person_like,
    make_photo,
    make_seeker,
    set_location,
)
from tests.test_listings import _body
from tests.test_moderation import _request_code, _verify
from tests.test_profiles import _p

pytestmark = pytest.mark.usefixtures("redis_clean")

U_EMAIL = "u-deleted@example.com"
U_NAME = "UMARK-name"
UNAUTHENTICATED = {"detail": "unauthenticated"}


# --- helpers -----------------------------------------------------------------------------------


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _session(
    client: TestClient, engine: Engine, user_id: uuid.UUID, age_s: float = 0
) -> TestClient:
    """A new `TestClient` holding a session of `user_id` created `age_s` seconds ago."""
    token = secrets.token_urlsafe(32)
    _execute(
        engine,
        "INSERT INTO sessions (user_id, token_hash, created_at, expires_at)"
        " VALUES (:u, :h, now() - make_interval(secs => :age), now() + interval '30 days')",
        u=user_id,
        h=hashlib.sha256(token.encode()).hexdigest(),
        age=age_s,
    )
    return TestClient(client.app, cookies={"rent_session": token})


def _snapshot(engine: Engine) -> dict[str, list[str]]:
    """Every row of every app table, as JSON text, sorted: "no row anywhere changed"."""
    with engine.connect() as conn:
        return {
            table: sorted(
                conn.execute(text(f"SELECT row_to_json(t)::text FROM {table} t")).scalars()
            )
            for table in Base.metadata.tables
        }


def _action(engine: Engine, action: str, target_type: str, target_id: uuid.UUID) -> None:
    _execute(
        engine,
        "INSERT INTO admin_actions (action, target_type, target_id) VALUES (:a, :t, :id)",
        a=action,
        t=target_type,
        id=target_id,
    )


def _report(engine: Engine, reporter: uuid.UUID, reported: uuid.UUID, target: uuid.UUID) -> None:
    _execute(
        engine,
        "INSERT INTO reports (reporter_id, reported_user_id, target_type, target_id, reason)"
        " VALUES (:a, :b, 'chat', :t, 'other')",
        a=reporter,
        b=reported,
        t=target,
    )


def _chat(engine: Engine, application_id: uuid.UUID) -> uuid.UUID:
    """The application's conversation (its id is the application's), inserted directly."""
    _execute(
        engine,
        "INSERT INTO conversations (id, application_id, owner_id, seeker_id)"
        " SELECT a.id, a.id, l.owner_id, a.seeker_id FROM applications a"
        " JOIN listings l ON l.id = a.listing_id WHERE a.id = :id",
        id=application_id,
    )
    return application_id


def _message(engine: Engine, conversation_id: uuid.UUID, sender: uuid.UUID, body: str) -> None:
    _execute(
        engine,
        "INSERT INTO messages (conversation_id, sender_id, body) VALUES (:c, :s, :b)",
        c=conversation_id,
        s=sender,
        b=body,
    )


def _put(store: FilePhotoStore, key: str) -> None:
    for name in photos_service.object_names(key):
        store.put(name, b"webp")


def _files(store: FilePhotoStore) -> set[str]:
    return set(os.listdir(store.photo_dir)) if store.photo_dir.exists() else set()


def _delete(caller: TestClient) -> httpx.Response:
    response: httpx.Response = caller.delete("/me")
    return response


def _ok(response: httpx.Response, code: int = 200) -> Any:
    assert response.status_code == code, response.text
    return response.json() if response.content else None


def _wait_for_lock_waiter(engine: Engine, timeout_s: float = 20) -> None:
    """Until some backend of this database waits on a lock."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if _scalar(
            engine,
            "SELECT count(*) FROM pg_stat_activity"
            " WHERE datname = current_database() AND wait_event_type = 'Lock'",
        ):
            return
        time.sleep(0.02)
    raise AssertionError("no backend waited on a lock")


def _in_threads(*targets: Callable[[], None]) -> None:
    threads = [threading.Thread(target=target) for target in targets]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    assert not any(thread.is_alive() for thread in threads)


@dataclass
class World:
    """AC3's U with every footprint, and the people around U."""

    u: uuid.UUID
    u_card: uuid.UUID
    p: uuid.UUID  # U's direct chat and market like
    o2: uuid.UUID  # the other owner (U applied to two of their listings; U is their flatmate)
    s: uuid.UUID  # the seeker of O2's room chat
    s2: uuid.UUID  # U's applicant (U's apartment and U's room)
    f: uuid.UUID  # a flatmate of U's room
    x: uuid.UUID  # a seeker who liked U's room and U's card
    apartment: uuid.UUID  # U's
    room: uuid.UUID  # U's
    o2_apartment: uuid.UUID  # U applied, no chat
    o2_chat_apartment: uuid.UUID  # U applied, shortlisted, chat
    o2_room: uuid.UUID  # U is a flatmate
    u_no_chat_app: uuid.UUID
    u_chat: uuid.UUID  # U's shortlisted application's chat
    received_chat: uuid.UUID  # S2 on U's apartment
    room_chat: uuid.UUID  # S2 on U's room (F reads it)
    o2_room_chat: uuid.UUID  # S on O2's room, U a flatmate there
    direct: uuid.UUID
    u_room_pair: uuid.UUID  # U's like of O2's room
    invite_token: str
    u_keys: list[str]  # 4 listing photos and the person photo
    other_key: str  # O2's photo: never deleted


def _world(client: TestClient, engine: Engine, store: FilePhotoStore, area: uuid.UUID) -> World:
    u = make_owner(engine, U_EMAIL)
    _execute(engine, "UPDATE users SET display_name = :n WHERE id = :id", n=U_NAME, id=u)
    u_card = make_card(engine, u, area, gender="woman")
    p = make_seeker(engine, "p@example.com")
    o2 = make_owner(engine, "o2@example.com")
    s = make_seeker(engine, "s@example.com")
    s2 = make_seeker(engine, "s2@example.com")
    f = make_seeker(engine, "f@example.com")
    x = make_seeker(engine, "x@example.com")
    make_card(engine, x, area, gender="woman")

    apartment = make_listing(engine, u, area)
    set_location(engine, apartment, 34.81, 32.07)
    room = make_listing(engine, u, area, listing_type="room", flatmates_count=2)
    o2_apartment = make_listing(engine, o2, area)
    o2_chat_apartment = make_listing(engine, o2, area)
    o2_room = make_listing(engine, o2, area, listing_type="room", flatmates_count=2)
    keys = []
    for listing in (apartment, room):
        for position in range(2):
            key = secrets.token_urlsafe(32)
            make_photo(engine, listing, position=position, key=key)
            _put(store, key)
            keys.append(key)
    person_key = secrets.token_urlsafe(32)
    _execute(engine, "UPDATE users SET photo_key = :k WHERE id = :id", k=person_key, id=u)
    _put(store, person_key)
    other_key = secrets.token_urlsafe(32)
    make_photo(engine, o2_apartment, position=0, key=other_key)
    _put(store, other_key)
    invite = _session(client, engine, u).post(f"/listings/{room}/flatmate-invite")
    token = _ok(invite, 201)["token"]

    u_no_chat_app = make_application(engine, o2_apartment, u)
    u_chat = _chat(engine, make_application(engine, o2_chat_apartment, u, status="shortlisted"))
    _message(engine, u_chat, u, "hello from U")
    received_chat = _chat(engine, make_application(engine, apartment, s2, status="shortlisted"))
    _message(engine, received_chat, s2, "hello U")
    _message(engine, received_chat, u, "hello S2")
    room_chat = _chat(engine, make_application(engine, room, s2, status="shortlisted"))
    direct = make_direct_chat(engine, u, p)
    _message(engine, direct, u, "hi P")
    make_flatmate(engine, room, f)

    o2_room_chat = _chat(engine, make_application(engine, o2_room, s, status="shortlisted"))
    make_flatmate(
        engine, o2_room, u, joined_at=dt.datetime.now(dt.UTC) - dt.timedelta(hours=1), shown=True
    )
    _message(engine, o2_room_chat, u, "U as a flatmate")
    _execute(
        engine,
        "INSERT INTO conversation_reads (conversation_id, user_id, read_at) VALUES (:c, :u, now())",
        c=o2_room_chat,
        u=u,
    )
    u_room_pair = make_pair(engine, o2_room, u, price_ils_seen=7200)
    make_pair(engine, room, x, price_ils_seen=7200)
    make_card(engine, p, area, gender="woman")
    make_person_like(engine, u, p)
    make_person_like(engine, p, u)  # a match: U shows on P's people-likes
    make_person_like(engine, x, u)
    _report(engine, u, p, direct)
    _report(engine, p, u, direct)
    return World(
        u=u,
        u_card=u_card,
        p=p,
        o2=o2,
        s=s,
        s2=s2,
        f=f,
        x=x,
        apartment=apartment,
        room=room,
        o2_apartment=o2_apartment,
        o2_chat_apartment=o2_chat_apartment,
        o2_room=o2_room,
        u_no_chat_app=u_no_chat_app,
        u_chat=u_chat,
        received_chat=received_chat,
        room_chat=room_chat,
        o2_room_chat=o2_room_chat,
        direct=direct,
        u_room_pair=u_room_pair,
        invite_token=token,
        u_keys=[*keys, person_key],
        other_key=other_key,
    )


@pytest.fixture
def world(
    client: TestClient, db_engine: Engine, photo_store: FilePhotoStore, gush_dan: uuid.UUID
) -> World:
    return _world(client, db_engine, photo_store, gush_dan)


def _deleted(client: TestClient, engine: Engine, user_id: uuid.UUID) -> None:
    response = _delete(_session(client, engine, user_id))
    assert response.status_code == 204, response.text


def _count(engine: Engine, sql: str, **params: Any) -> int:
    return int(_scalar(engine, f"SELECT count(*) FROM {sql}", **params))


# --- AC1, AC2 ----------------------------------------------------------------------------------


def test_ac1_delete_signs_out_everywhere(
    client: TestClient, db_engine: Engine, photo_store: FilePhotoStore
) -> None:
    u = make_seeker(db_engine, U_EMAIL)
    phone, laptop = _session(client, db_engine, u), _session(client, db_engine, u)
    assert phone.get("/me").status_code == 200
    tokens = [device.cookies["rent_session"] for device in (phone, laptop)]

    response = _delete(phone)

    assert response.status_code == 204
    logout = TestClient(client.app).post("/auth/logout")
    # Logout's exact attributes (`Expires` is the clock's, so it is compared without it).
    cleared, logged_out = (
        "; ".join(
            part for part in r.headers["set-cookie"].split("; ") if not part.startswith("expires=")
        )
        for r in (response, logout)
    )
    assert cleared == logged_out
    assert cleared.startswith('rent_session=""')
    assert _count(db_engine, "sessions WHERE user_id = :u", u=u) == 0
    for token in tokens:  # the phone's cookie jar dropped it; send it anyway
        again = TestClient(client.app, cookies={"rent_session": token}).get("/me")
        assert (again.status_code, again.json()) == (401, UNAUTHENTICATED)
    assert _delete(TestClient(client.app)).status_code == 401


def test_ac2_old_session_needs_fresh_sign_in(
    client: TestClient, db_engine: Engine, photo_store: FilePhotoStore
) -> None:
    u = make_seeker(db_engine, U_EMAIL)
    old = _session(client, db_engine, u, age_s=16 * 60)
    before = _snapshot(db_engine)

    response = _delete(old)

    assert (response.status_code, response.json()) == (403, {"detail": "reauth_required"})
    assert "set-cookie" not in response.headers
    assert _snapshot(db_engine) == before
    assert _delete(_session(client, db_engine, u, age_s=14 * 60)).status_code == 204
    assert _scalar(db_engine, "SELECT deleted_at FROM users WHERE id = :id", id=u) is not None


# --- AC3 ---------------------------------------------------------------------------------------


def test_ac3_footprint_after_deletion(
    client: TestClient, db_engine: Engine, photo_store: FilePhotoStore, world: World
) -> None:
    w = world
    u_files = {name for key in w.u_keys for name in photos_service.object_names(key)}
    assert len(u_files) == 10 and u_files <= _files(photo_store)
    messages = _scalar(db_engine, "SELECT array_agg(id ORDER BY id) FROM messages")
    reports = _scalar(db_engine, "SELECT array_agg(row_to_json(r)::text) FROM reports r")
    assert _count(db_engine, "reports") == 2

    _deleted(client, db_engine, w.u)

    assert _files(photo_store) == set(photos_service.object_names(w.other_key))
    assert _count(db_engine, "listing_photos") == 1  # O2's
    mine = [w.apartment, w.room]
    listings = {
        row.id: row
        for row in _rows(
            db_engine,
            "SELECT id, status, description, flatmate_invite_hash FROM listings"
            " WHERE id = ANY(:ids)",
            ids=mine,
        )
    }
    assert set(listings) == set(mine)
    for row in listings.values():
        assert (row.status, row.description, row.flatmate_invite_hash) == ("paused", None, None)
    assert _count(db_engine, "applications WHERE id = :id", id=w.u_no_chat_app) == 0
    assert _scalar(db_engine, "SELECT status FROM applications WHERE id = :id", id=w.u_chat) == (
        "withdrawn"
    )
    assert (
        _scalar(db_engine, "SELECT message FROM applications WHERE id = :id", id=w.u_chat) is None
    )
    # Applications received on U's listings stay as they were.
    assert _scalar(
        db_engine, "SELECT status FROM applications WHERE id = :id", id=w.received_chat
    ) == ("shortlisted")
    assert _count(db_engine, "room_pairs WHERE seeker_id = :u", u=w.u) == 0
    assert _count(db_engine, "room_pairs WHERE listing_id = ANY(:ids)", ids=mine) == 0
    assert _count(db_engine, "person_pairs WHERE :u IN (user_low, user_high)", u=w.u) == 0
    assert _count(db_engine, "listing_flatmates WHERE user_id = :u", u=w.u) == 0
    assert _count(db_engine, "listing_flatmates WHERE user_id = :f", f=w.f) == 1  # F stays in
    assert _count(db_engine, "conversation_reads WHERE user_id = :u", u=w.u) == 0
    assert _count(db_engine, "seeker_profiles WHERE user_id = :u", u=w.u) == 0
    assert _count(db_engine, "sessions WHERE user_id = :u", u=w.u) == 0
    tombstone = _rows(
        db_engine,
        "SELECT deleted_at, email, display_name, photo_key, last_login_at FROM users"
        " WHERE id = :id",
        id=w.u,
    )[0]
    assert tombstone.deleted_at is not None
    assert (tombstone.email, tombstone.display_name, tombstone.photo_key) == (None, None, None)
    assert tombstone.last_login_at is None
    assert _scalar(db_engine, "SELECT array_agg(id ORDER BY id) FROM messages") == messages
    assert _scalar(db_engine, "SELECT array_agg(row_to_json(r)::text) FROM reports r") == reports


def _rows(engine: Engine, sql: str, **params: Any) -> Sequence[Any]:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).all()


# --- AC4 ---------------------------------------------------------------------------------------


def _thread(caller: TestClient, conversation_id: uuid.UUID) -> dict[str, Any]:
    body: dict[str, Any] = _ok(caller.get(f"/conversations/{conversation_id}"))
    return body


def _send(caller: TestClient, conversation_id: uuid.UUID) -> httpx.Response:
    response: httpx.Response = caller.post(
        f"/conversations/{conversation_id}/messages", json={"body": "still there?"}
    )
    return response


def test_ac4_others_keep_threads_and_sending_closes(
    client: TestClient, db_engine: Engine, photo_store: FilePhotoStore, world: World
) -> None:
    w = world
    _deleted(client, db_engine, w.u)

    for reader, conversation_id, u_body in (
        (w.p, w.direct, "hi P"),
        (w.s2, w.received_chat, "hello S2"),
        (w.o2, w.u_chat, "hello from U"),
    ):
        caller = _session(client, db_engine, reader)
        listed = {item["id"]: item for item in _ok(caller.get("/me/conversations"))}
        item = listed[str(conversation_id)]
        assert (item["other_name"], item["can_send"]) == (None, False)
        thread = _thread(caller, conversation_id)
        assert (thread["other_name"], thread["can_send"]) == (None, False)
        others = [member for member in thread["members"] if not member["is_me"]]
        assert [member["name"] for member in others] == [None]
        from_u = [message for message in thread["messages"] if message["body"] == u_body]
        assert len(from_u) == 1
        assert (from_u[0]["sender_name"], from_u[0]["mine"]) == (None, False)
        refused = _send(caller, conversation_id)
        assert (refused.status_code, refused.json()) == (409, {"detail": "chat_closed"})

    # O2's room chat, where U was a flatmate: the owner and the seeker still send.
    for member in (w.o2, w.s):
        caller = _session(client, db_engine, member)
        _ok(_send(caller, w.o2_room_chat), 201)
        thread = _thread(caller, w.o2_room_chat)
        assert thread["can_send"] is True
        assert all(m["name"] is not None for m in thread["members"])
        from_u = [m for m in thread["messages"] if m["body"] == "U as a flatmate"]
        assert [(m["sender_name"], m["mine"]) for m in from_u] == [(None, False)]


# --- AC5, AC6 ----------------------------------------------------------------------------------


def test_ac5_deleted_account_is_gone_everywhere(
    client: TestClient, db_engine: Engine, photo_store: FilePhotoStore, world: World
) -> None:
    w = world
    visitor = TestClient(client.app)
    x = _session(client, db_engine, w.x)
    o2 = _session(client, db_engine, w.o2)
    p = _session(client, db_engine, w.p)
    bbox = {"west": 34.7, "south": 32.0, "east": 34.9, "north": 32.2}
    calls: list[tuple[TestClient, str, str, dict[str, Any] | None]] = [
        (caller, "GET", "/listings", params)
        for caller in (visitor, x)
        for params in ({}, {"listing_type": "room"}, bbox)
    ]
    calls += [
        (caller, "GET", f"/listings/{listing}", None)
        for caller in (visitor, x)
        for listing in (w.apartment, w.room, w.o2_room)
    ]
    calls += [(x, "GET", path, None) for path in ("/people", "/me/likes", "/me/people-likes")]
    calls += [(p, "GET", "/me/people-likes", None)]  # U and P matched
    calls += [
        (o2, "GET", f"/listings/{w.o2_room}/people", None),
        (o2, "GET", f"/listings/{w.o2_room}/flatmates", None),
        *(
            (o2, "GET", f"/listings/{listing}/applications", None)
            for listing in (w.o2_apartment, w.o2_chat_apartment)
        ),
    ]
    markers = [
        str(marker) for marker in (w.u, w.u_card, w.apartment, w.room, w.u_chat, w.u_no_chat_app)
    ]
    markers += [str(w.u_room_pair), U_NAME, U_EMAIL]

    def texts() -> list[str]:
        out = []
        for caller, method, path, params in calls:
            response = caller.request(method, path, params=params)
            assert response.status_code < 500, (path, response.text)
            out.append(response.text)
        preview = x.post("/flatmate-invites/preview", json={"token": w.invite_token})
        assert preview.status_code < 500
        out.append(preview.text if preview.status_code == 200 else "")
        return out

    before = "\n".join(texts())
    # The check is not vacuous: U shows up on these before the deletion.
    for marker in (str(w.apartment), str(w.u_chat), str(w.u_no_chat_app), str(w.u_card), U_NAME):
        assert marker in before, marker

    _deleted(client, db_engine, w.u)

    for path_text in texts():
        for marker in markers:
            assert marker not in path_text, (marker, path_text)
    for caller in (visitor, x):
        for listing in (w.apartment, w.room):
            assert caller.get(f"/listings/{listing}").status_code == 404
    preview = x.post("/flatmate-invites/preview", json={"token": w.invite_token})
    assert preview.status_code == 404
    applicants = _ok(o2.get(f"/listings/{w.o2_chat_apartment}/applications"))
    assert all(item["id"] != str(w.u_chat) for item in applicants)


def test_ac6_my_flats_owner_deleted(
    client: TestClient, db_engine: Engine, photo_store: FilePhotoStore, world: World
) -> None:
    w = world
    f = _session(client, db_engine, w.f)
    assert [flat["owner_name"] for flat in _ok(f.get("/me/flats"))] == [U_NAME]

    _deleted(client, db_engine, w.u)

    flats = _ok(f.get("/me/flats"))
    assert [(flat["listing"]["id"], flat["owner_name"]) for flat in flats] == [(str(w.room), None)]
    thread = _thread(f, w.room_chat)
    assert thread["my_role"] == "flatmate"
    assert thread["can_send"] is False  # U, the owner, is gone


# --- AC7, AC8 ----------------------------------------------------------------------------------


def _blocked(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        return set(conn.execute(text("SELECT email_hmac FROM blocked_emails")).scalars())


def test_ac7_admin_action_blocks_re_signup(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    photo_store: FilePhotoStore,
    gush_dan: uuid.UUID,
) -> None:
    u = make_seeker(db_engine, U_EMAIL)
    _action(db_engine, "suspend", "user", u)
    _action(db_engine, "unsuspend", "user", u)
    v_email = "v@example.com"
    v = make_owner(db_engine, v_email)
    v_listing = make_listing(db_engine, v, gush_dan)
    _action(db_engine, "hide_listing", "listing", v_listing)

    _deleted(client, db_engine, u)
    _deleted(client, db_engine, v)

    assert _blocked(db_engine) == {accounts.email_hmac(U_EMAIL), accounts.email_hmac(v_email)}
    users = _count(db_engine, "users")
    profile = {"display_name": "שוב", "role": "seeker"}
    for email, body in ((" U-Deleted@Example.COM ", {"profile": profile}), (U_EMAIL, {})):
        code = _request_code(client, outbox, email)
        refused = client.post("/auth/otp/verify", json={"email": email, "code": code, **body})
        assert (refused.status_code, refused.json()) == (403, {"detail": "signup_blocked"})
        assert "set-cookie" not in refused.headers
        # The code is consumed.
        again = client.post("/auth/otp/verify", json={"email": email, "code": code, **body})
        assert (again.status_code, again.json()) == (401, {"detail": "invalid_code"})
    assert _count(db_engine, "users") == users
    assert _count(db_engine, "sessions") == 0
    assert client.post("/auth/otp/request", json={"email": U_EMAIL}).status_code == 204
    code = _request_code(client, outbox, v_email)
    assert _verify(client, v_email, code).json() == {"detail": "signup_blocked"}


def test_ac8_reports_alone_do_not_block(
    client: TestClient, outbox: Outbox, db_engine: Engine, photo_store: FilePhotoStore
) -> None:
    w_email = "w@example.com"
    w = make_seeker(db_engine, w_email)
    a = make_seeker(db_engine, "a@example.com")
    b = make_seeker(db_engine, "b@example.com")
    chats = [make_direct_chat(db_engine, w, other) for other in (a, b)]
    _report(db_engine, a, w, chats[0])
    _report(db_engine, b, w, chats[1])
    _action(db_engine, "set_listing_cap", "user", w)
    _action(db_engine, "read_chat", "chat", chats[0])

    _deleted(client, db_engine, w)

    assert _blocked(db_engine) == set()
    code = _request_code(client, outbox, w_email)
    profile = {"display_name": "חוזר", "role": "seeker"}
    response = client.post(
        "/auth/otp/verify", json={"email": w_email, "code": code, "profile": profile}
    )
    assert response.status_code == 201
    assert response.json()["id"] != str(w)
    assert _scalar(db_engine, "SELECT array_agg(DISTINCT reported_user_id) FROM reports") == [w]


# --- AC9 ---------------------------------------------------------------------------------------


def test_ac9_block_hash_is_keyed(monkeypatch: pytest.MonkeyPatch) -> None:
    email = "someone@example.com"
    keyed = accounts.email_hmac(email)

    assert keyed != hashlib.sha256(email.encode()).hexdigest()
    assert accounts.email_hmac("  SomeOne@Example.com ") == keyed
    assert len(keyed) == 64
    settings = get_settings()
    monkeypatch.setattr(
        accounts,
        "get_settings",
        lambda: settings.model_copy(update={"email_block_key": SecretStr("k" * 32)}),
    )
    assert accounts.email_hmac(email) != keyed
    monkeypatch.setattr(
        accounts,
        "get_settings",
        lambda: settings.model_copy(update={"secret_key": SecretStr("s" * 32)}),
    )
    assert accounts.email_hmac(email) == keyed


# --- AC13-AC15 ---------------------------------------------------------------------------------


class RecordingStore(FilePhotoStore):
    """A file store that records every delete."""

    def __init__(self, store: FilePhotoStore) -> None:
        super().__init__(store.photo_dir)
        self.deleted: list[str] = []

    def delete(self, names: Sequence[str]) -> None:
        self.deleted += names
        super().delete(names)


def test_ac13_concurrent_deletes_are_one_deletion(
    client: TestClient,
    db_engine: Engine,
    photo_store: FilePhotoStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    u = make_seeker(db_engine, U_EMAIL)
    _action(db_engine, "suspend", "user", u)
    _action(db_engine, "unsuspend", "user", u)
    devices = [_session(client, db_engine, u) for _ in range(2)]
    barrier = threading.Barrier(2, timeout=20)
    real_delete = accounts.delete_account

    def delete_together(db: Session, store: Any, user: User) -> None:
        barrier.wait()
        real_delete(db, store, user)

    monkeypatch.setattr(accounts, "delete_account", delete_together)
    results: list[httpx.Response] = []
    _in_threads(*(lambda device=device: results.append(_delete(device)) for device in devices))

    assert [response.status_code for response in results] == [204, 204]
    assert _count(db_engine, "users WHERE deleted_at IS NOT NULL") == 1
    assert _blocked(db_engine) == {accounts.email_hmac(U_EMAIL)}
    stamped = _scalar(db_engine, "SELECT deleted_at FROM users WHERE id = :id", id=u)

    before = _snapshot(db_engine)
    store = RecordingStore(photo_store)
    with Session(db_engine) as db:
        tombstone = db.get(User, u)
        assert tombstone is not None
        real_delete(db, store, tombstone)
    assert _snapshot(db_engine) == before
    assert _scalar(db_engine, "SELECT deleted_at FROM users WHERE id = :id", id=u) == stamped
    assert store.deleted == []


def test_ac14_late_login_session_is_refused(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    photo_store: FilePhotoStore,
    gush_dan: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    u = make_owner(db_engine, U_EMAIL)
    device = _session(client, db_engine, u)
    code = _request_code(client, outbox, U_EMAIL)
    found, deleted = threading.Event(), threading.Event()
    real_find = auth_service._find_user

    def find_then_wait(db: Session, email: str) -> User | None:
        user = real_find(db, email)
        found.set()
        assert deleted.wait(20)
        return user

    monkeypatch.setattr(auth_service, "_find_user", find_then_wait)
    login: list[httpx.Response] = []
    late = TestClient(client.app)

    def sign_in() -> None:
        login.append(late.post("/auth/otp/verify", json={"email": U_EMAIL, "code": code}))

    def delete() -> None:
        assert found.wait(20)
        assert _delete(device).status_code == 204
        deleted.set()

    _in_threads(sign_in, delete)

    assert login[0].status_code == 200  # answered with the names it read before the commit
    token = login[0].cookies["rent_session"]
    assert _count(db_engine, "sessions WHERE user_id = :u", u=u) == 1
    caller = TestClient(client.app, cookies={"rent_session": token})
    for response in (
        caller.get("/me"),
        caller.post("/listings", json=_body(gush_dan)),
        caller.get("/me/events"),
    ):
        assert (response.status_code, response.json()) == (401, UNAUTHENTICATED)
    row = _rows(db_engine, "SELECT email, display_name, photo_key FROM users WHERE id = :id", id=u)[
        0
    ]
    assert tuple(row) == (None, None, None)


def test_ac14_write_racing_deletion_adds_nothing(
    client: TestClient,
    db_engine: Engine,
    photo_store: FilePhotoStore,
    gush_dan: uuid.UUID,
) -> None:
    """Review blocker: a PUT /me/profile that resolved its session before DELETE /me committed
    waits on the deletion's row lock (`accounts.lock_live_account`), then answers 401 and writes
    no profile; the people browse stays a 200 without U."""
    u = make_owner(db_engine, U_EMAIL)
    u_card = make_card(db_engine, u, gush_dan, gender="woman")
    x = make_seeker(db_engine, "x@example.com")
    make_card(db_engine, x, gush_dan, gender="woman")
    body = _p(gush_dan, gender="woman", birth_year=1995, people_visible=True, about_me="שלום")
    assert _session(client, db_engine, x).put("/me/profile", json=body).status_code == 200
    writer, deleter = _session(client, db_engine, u), _session(client, db_engine, u)
    held = threading.Event()
    results: list[httpx.Response] = []

    def hold(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        # Inside DELETE /me, its users row locked: wait until the profile write waits on it.
        if statement.startswith("DELETE FROM listing_photos") and not held.is_set():
            held.set()
            _wait_for_lock_waiter(db_engine)

    def write() -> None:
        assert held.wait(20)
        results.append(writer.put("/me/profile", json=body))

    event.listen(db_engine, "before_cursor_execute", hold)
    try:
        _in_threads(lambda: results.append(_delete(deleter)), write)
    finally:
        event.remove(db_engine, "before_cursor_execute", hold)

    assert sorted((r.status_code, r.content) for r in results) == [
        (204, b""),
        (401, b'{"detail":"unauthenticated"}'),
    ]
    assert _count(db_engine, "seeker_profiles WHERE user_id = :u", u=u) == 0
    people = _session(client, db_engine, x).get("/people")
    assert people.status_code == 200
    assert str(u_card) not in people.text


def test_ac13_second_delete_without_its_session_is_204(
    client: TestClient,
    db_engine: Engine,
    photo_store: FilePhotoStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review minor: the second of two racing DELETE /me passed `current_user`, then the first
    committed (deleting its session too) before its `session_created_at`: 204, not 403."""
    u = make_seeker(db_engine, U_EMAIL)
    first, second = _session(client, db_engine, u), _session(client, db_engine, u)
    real = auth_service.session_created_at

    def first_wins(db: Session, token: str) -> dt.datetime | None:
        monkeypatch.setattr(auth_service, "session_created_at", real)
        assert _delete(first).status_code == 204
        return real(db, token)

    monkeypatch.setattr(auth_service, "session_created_at", first_wins)
    response = _delete(second)

    assert response.status_code == 204
    assert response.headers["set-cookie"].startswith('rent_session=""')
    # Nothing but the session check: a session that is simply gone still answers 403.
    other = make_seeker(db_engine, "other@example.com")
    live = _session(client, db_engine, other)
    monkeypatch.setattr(auth_service, "session_created_at", lambda db, token: None)
    refused = _delete(live)
    assert (refused.status_code, refused.json()) == (403, {"detail": "reauth_required"})


def _upload(caller: TestClient, listing_id: uuid.UUID) -> httpx.Response:
    response: httpx.Response = caller.post(
        f"/listings/{listing_id}/photos", content=jpeg(), headers={"Content-Type": "image/jpeg"}
    )
    return response


@pytest.fixture
def at_photo_step(db_engine: Engine) -> Iterator[Callable[[Callable[[], None]], None]]:
    """Run a callback inside DELETE /me just before its step 4 (the listing locks held)."""
    hooks: list[Callable[[], None]] = []

    def before(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        if statement.startswith("DELETE FROM listing_photos") and hooks:
            hooks.pop()()

    event.listen(db_engine, "before_cursor_execute", before)
    yield hooks.append
    event.remove(db_engine, "before_cursor_execute", before)


def test_ac15_upload_racing_deletion_leaves_no_photo(
    client: TestClient,
    db_engine: Engine,
    photo_store: FilePhotoStore,
    gush_dan: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
    at_photo_step: Callable[[Callable[[], None]], None],
) -> None:
    real_lock = photos_service._lock_own_listing
    results: list[httpx.Response] = []

    # 1. The deletion holds step 3's listing locks; the upload waits on one, then is refused.
    u = make_owner(db_engine, U_EMAIL)
    listing = make_listing(db_engine, u, gush_dan)
    uploader, deleter = _session(client, db_engine, u), _session(client, db_engine, u)
    locks_held = threading.Event()

    def lock_after_step_3(db: Session, owner_id: uuid.UUID, listing_id: uuid.UUID) -> None:
        assert locks_held.wait(20)
        real_lock(db, owner_id, listing_id)

    monkeypatch.setattr(photos_service, "_lock_own_listing", lock_after_step_3)

    def hold_until_upload_waits() -> None:
        locks_held.set()
        _wait_for_lock_waiter(db_engine)

    at_photo_step(hold_until_upload_waits)
    _in_threads(
        lambda: results.append(_upload(uploader, listing)),
        lambda: results.append(_delete(deleter)),
    )

    assert sorted(response.status_code for response in results) == [204, 404]
    refused = next(response for response in results if response.status_code == 404)
    assert refused.json() == {"detail": "not_found"}
    assert _count(db_engine, "listing_photos") == 0
    assert _files(photo_store) == set()

    # 2. The upload takes the listing lock first: the deletion waits for its commit, then deletes
    # that photo row and its objects.
    results.clear()
    u2 = make_owner(db_engine, "u2@example.com")
    listing2 = make_listing(db_engine, u2, gush_dan)
    uploader, deleter = _session(client, db_engine, u2), _session(client, db_engine, u2)
    locked = threading.Event()

    def lock_then_wait(db: Session, owner_id: uuid.UUID, listing_id: uuid.UUID) -> None:
        real_lock(db, owner_id, listing_id)
        locked.set()
        _wait_for_lock_waiter(db_engine)

    monkeypatch.setattr(photos_service, "_lock_own_listing", lock_then_wait)

    def delete_after_lock() -> None:
        assert locked.wait(20)
        results.append(_delete(deleter))

    _in_threads(lambda: results.append(_upload(uploader, listing2)), delete_after_lock)

    assert sorted(response.status_code for response in results) == [201, 204]
    assert _count(db_engine, "listing_photos") == 0
    assert _files(photo_store) == set()


# --- NF1, NF2 ----------------------------------------------------------------------------------


def test_nf1_failure_rolls_back_everything(
    client: TestClient, db_engine: Engine, photo_store: FilePhotoStore, world: World
) -> None:
    _action(db_engine, "suspend", "user", world.u)  # so step 2 writes too
    before, files = _snapshot(db_engine), _files(photo_store)

    def fail_at_step_11(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        if statement.startswith("DELETE FROM sessions"):
            raise RuntimeError("injected after step 10")

    event.listen(db_engine, "before_cursor_execute", fail_at_step_11)
    try:
        with Session(db_engine) as db:
            user = db.get(User, world.u)
            assert user is not None
            with pytest.raises(RuntimeError, match="injected"):
                accounts.delete_account(db, photo_store, user)
    finally:
        event.remove(db_engine, "before_cursor_execute", fail_at_step_11)

    assert _snapshot(db_engine) == before
    assert _files(photo_store) == files


def test_nf2_no_pii_in_logs(
    client: TestClient,
    db_engine: Engine,
    photo_store: FilePhotoStore,
    world: World,
    caplog: pytest.LogCaptureFixture,
) -> None:
    _action(db_engine, "suspend", "user", world.u)
    caplog.set_level(logging.DEBUG)

    _deleted(client, db_engine, world.u)

    assert any(
        record.getMessage() == "account deleted: 10 photo objects" for record in caplog.records
    )
    for record in caplog.records:
        line = record.getMessage()
        assert U_EMAIL not in line.lower(), line
        assert U_NAME not in line, line
