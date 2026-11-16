"""The admin dashboard (spec 0012b): AC1-AC9, NF2-NF5 (NF1 is `test_admin_isolation.py`).

The admin app runs through Starlette's `TestClient` on `create_admin_app`, connected as the
`homie_admin` role to the test database, on `http://localhost` (the default `testserver` host
fails the allowlist), sending `Sec-Fetch-Site: same-origin` as Gilad's browser does. Reports,
conversations and messages are direct inserts. Spec 0013e (sessions and the lock in
`admin_logins`, same-origin writes) adds AC1-AC9 of its own, named after its ACs."""

import asyncio
import base64
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import uuid
from collections.abc import Iterator
from typing import Any
from urllib.parse import urlencode

import httpx
import pytest
from fastapi.testclient import TestClient
from psycopg.errors import InsufficientPrivilege
from pydantic import ValidationError
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.types import ASGIApp, Message

import admin.auth
from admin import actions
from admin.auth import PasswordAuth
from admin.config import AdminSettings
from admin.main import create_admin_app, main
from admin.views import UserView
from app.db import make_engine
from app.models import User
from app.services import passwords
from scripts.admin_role import apply_admin_role
from tests import test_tours as tours_tests
from tests.conftest import (
    API_DIR,
    TEST_DATABASE_URL,
    Outbox,
    make_application,
    make_direct_chat,
    make_flatmate,
    make_listing,
    make_owner,
    make_seeker,
)
from tests.test_market_people import _login
from tests.test_moderation import _request_code, _room, _verify

PASSWORD = "correct horse battery staple"
SECRET = "test-admin-secret-0123456789abcdef-xyz"
XSS = "<script>alert(1)</script>"
ESCAPED = "&lt;script&gt;alert(1)&lt;/script&gt;"


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _rows(engine: Engine, sql: str, **params: Any) -> list[Any]:
    with engine.connect() as conn:
        return list(conn.execute(text(sql), params).all())


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _log(engine: Engine) -> list[tuple[str, str, uuid.UUID, str | None]]:
    return [
        (r.action, r.target_type, r.target_id, r.detail)
        for r in _rows(
            engine,
            "SELECT action, target_type, target_id, detail FROM admin_actions"
            " ORDER BY created_at, id",
        )
    ]


def _report(
    engine: Engine,
    reporter: uuid.UUID,
    reported: uuid.UUID,
    target_type: str,
    target_id: uuid.UUID,
    *,
    note: str | None = None,
    resolved: bool = False,
) -> uuid.UUID:
    with engine.begin() as conn:
        report_id: uuid.UUID = conn.execute(
            text(
                "INSERT INTO reports (reporter_id, reported_user_id, target_type, target_id,"
                " reason, note, resolved_at) VALUES (:a, :b, :t, :id, 'other', :note,"
                " CASE WHEN :resolved THEN now() - interval '1 day' END) RETURNING id"
            ),
            {
                "a": reporter,
                "b": reported,
                "t": target_type,
                "id": target_id,
                "note": note,
                "resolved": resolved,
            },
        ).scalar_one()
    return report_id


def _message(
    engine: Engine, conversation: uuid.UUID, sender: uuid.UUID, body: str, minutes_ago: int
) -> None:
    _execute(
        engine,
        "INSERT INTO messages (conversation_id, sender_id, body, created_at)"
        " VALUES (:c, :s, :b, now() - make_interval(mins => :m))",
        c=conversation,
        s=sender,
        b=body,
        m=minutes_ago,
    )


def _live_session(engine: Engine, user_id: uuid.UUID) -> uuid.UUID:
    with engine.begin() as conn:
        session_id: uuid.UUID = conn.execute(
            text(
                "INSERT INTO sessions (user_id, token_hash, expires_at)"
                " VALUES (:u, :h, now() + interval '1 day') RETURNING id"
            ),
            {"u": user_id, "h": uuid.uuid4().hex},
        ).scalar_one()
    return session_id


def _settings(database_url: str) -> AdminSettings:
    return AdminSettings(database_url=database_url, password=PASSWORD, secret_key=SECRET)


SAME_ORIGIN = {"sec-fetch-site": "same-origin"}


def _client(app: ASGIApp, **kwargs: Any) -> TestClient:
    return TestClient(app, base_url="http://localhost", follow_redirects=False, **kwargs)


@pytest.fixture
def admin_client(db_engine: Engine, admin_role: str) -> Iterator[TestClient]:
    with _client(create_admin_app(_settings(admin_role)), headers=SAME_ORIGIN) as test_client:
        yield test_client


def _session(cookie: str) -> dict[str, Any]:
    """The signed session cookie's payload (Starlette: base64 JSON, then the signature)."""
    data = cookie.split(".")[0]
    payload: dict[str, Any] = json.loads(base64.b64decode(data + "=" * (-len(data) % 4)))
    return payload


def _login_admin(admin_client: TestClient, password: str = PASSWORD) -> httpx.Response:
    response: httpx.Response = admin_client.post(
        "/admin/login", data={"username": "", "password": password}
    )
    return response


@pytest.fixture
def signed_in(admin_client: TestClient) -> TestClient:
    assert _login_admin(admin_client).status_code == 302
    return admin_client


def _to_login(response: httpx.Response) -> bool:
    return response.status_code == 302 and response.headers["location"].endswith("/admin/login")


def test_ac1_everything_needs_login(
    admin_client: TestClient, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    listing = make_listing(db_engine, owner, gush_dan)
    reporter = make_seeker(db_engine, "reporter@example.com")
    chat = make_direct_chat(db_engine, owner, reporter)
    report = _report(db_engine, reporter, owner, "chat", chat)
    pages = [
        "/admin/report/list",
        f"/admin/report/details/{report}",
        f"/admin/report/chat/{report}",
        f"/admin/report/action/resolve?pks={report}",
        f"/admin/report/action/suspend-reported-user?pks={report}",
        f"/admin/report/action/hide-listing?pks={report}",
        "/admin/user/list",
        f"/admin/user/details/{owner}",
        f"/admin/user/edit/{owner}",
        f"/admin/user/action/suspend?pks={owner}",
        f"/admin/user/action/unsuspend?pks={owner}",
        "/admin/listing/list",
        f"/admin/listing/details/{listing}",
        f"/admin/listing/action/hide?pks={listing}",
        "/admin/admin-action/list",
    ]
    for path in pages:
        assert _to_login(admin_client.get(path)), path
    assert _to_login(admin_client.post(f"/admin/user/edit/{owner}", data={"listing_cap": "10"}))
    assert _scalar(db_engine, "SELECT count(*) FROM users WHERE suspended_at IS NOT NULL") == 0
    assert _scalar(db_engine, "SELECT listing_cap FROM users WHERE id = :id", id=owner) == 3
    assert _scalar(db_engine, "SELECT resolved_at FROM reports") is None
    assert _scalar(db_engine, "SELECT removed_at FROM listings") is None
    assert _log(db_engine) == []

    assert admin_client.get("/admin/login").status_code == 200
    assert admin_client.get("/admin/statics/css/main.css").status_code == 200
    for path in ("/", "/admin/"):
        response = admin_client.get(path)
        assert response.status_code == 302
        assert response.headers["location"] == "/admin/report/list"


def test_ac2_password_login_session_age_and_lockout(
    admin_client: TestClient, db_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = [1_800_000_000.0]
    monkeypatch.setattr(admin.auth, "_now", lambda: clock[0])

    wrong = _login_admin(admin_client, "not the password at all")
    assert wrong.status_code == 400
    assert "Invalid credentials." in wrong.text
    assert "homie_admin" not in admin_client.cookies
    assert [(r.ok, r.token_hash) for r in _rows(db_engine, "SELECT * FROM admin_logins")] == [
        (False, None)
    ]

    right = _login_admin(admin_client)
    assert right.status_code == 302
    cookie = right.headers["set-cookie"].lower()
    assert cookie.startswith("homie_admin=")
    for flag in ("path=/admin;", "samesite=strict", "httponly"):
        assert flag in cookie
    assert admin_client.get("/admin/report/list").status_code == 200
    # Spec 0013e AC3: the cookie holds only the session id; the row only its sha256.
    session = _session(admin_client.cookies["homie_admin"])
    assert list(session) == ["sid"]
    ok_hash = _scalar(db_engine, "SELECT token_hash FROM admin_logins WHERE ok")
    assert re.fullmatch("[0-9a-f]{64}", ok_hash)
    assert ok_hash == hashlib.sha256(session["sid"].encode()).hexdigest()

    clock[0] += 8 * 60 * 60 - 1
    assert admin_client.get("/admin/report/list").status_code == 200
    clock[0] += 1  # 8 hours after login_at, however often it was used
    assert _to_login(admin_client.get("/admin/report/list"))

    for _ in range(5):
        clock[0] += 60
        assert _login_admin(admin_client, "still not the password!").status_code == 400
    fifth = clock[0]
    for password in (PASSWORD, "wrong again, wrong again"):
        locked = _login_admin(admin_client, password)
        assert locked.status_code == 400
        assert "set-cookie" not in locked.headers
    assert _to_login(admin_client.get("/admin/report/list"))
    clock[0] = fifth + 15 * 60 - 1
    assert _login_admin(admin_client).status_code == 400
    clock[0] = fifth + 15 * 60
    assert _login_admin(admin_client).status_code == 302
    assert admin_client.get("/admin/report/list").status_code == 200

    # Non-ASCII passwords compare as bytes instead of raising.
    assert _login_admin(admin_client, "סיסמה שגויה לגמרי בעברית").status_code == 400
    rows = _rows(db_engine, "SELECT admin_logins::text AS row FROM admin_logins")
    assert len(rows) == 9  # 1 + 1 + 5 + 1 + 1: the two locked attempts wrote nothing
    assert not any(PASSWORD in r.row for r in rows)
    assert PASSWORD not in json.dumps(_session(admin_client.cookies["homie_admin"]))


def test_ac2_lock_survives_a_restart(
    admin_client: TestClient, admin_role: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = [1_800_000_000.0]
    monkeypatch.setattr(admin.auth, "_now", lambda: clock[0])
    for _ in range(5):
        clock[0] += 1
        assert _login_admin(admin_client, "five wrong make a lock").status_code == 400
    fifth = clock[0]
    with _client(create_admin_app(_settings(admin_role)), headers=SAME_ORIGIN) as restarted:
        clock[0] = fifth + 15 * 60 - 1
        assert _login_admin(restarted).status_code == 400
        clock[0] = fifth + 15 * 60
        assert _login_admin(restarted).status_code == 302
        assert restarted.get("/admin/report/list").status_code == 200


def _logs_out(client: TestClient) -> bool:
    """`/admin/logout` answers 302 and its redirects (SQLAdmin's to `/admin/`) end on the login."""
    response: httpx.Response = client.get("/admin/logout", follow_redirects=True)
    return (
        response.history[0].status_code == 302
        and response.status_code == 200
        and response.url.path == "/admin/login"
    )


def test_ac1_logout_ends_a_copied_cookie(signed_in: TestClient, db_engine: Engine) -> None:
    copy = _client(signed_in.app, cookies={"homie_admin": signed_in.cookies["homie_admin"]})
    assert copy.get("/admin/report/list").status_code == 200
    assert _logs_out(signed_in)
    assert _scalar(db_engine, "SELECT ended_at IS NOT NULL FROM admin_logins WHERE ok") is True
    assert _to_login(copy.get("/admin/report/list"))
    assert _to_login(signed_in.get("/admin/report/list"))
    assert _login_admin(signed_in).status_code == 302
    assert signed_in.get("/admin/report/list").status_code == 200


def test_ac1_logout_without_a_session(signed_in: TestClient, db_engine: Engine) -> None:
    before = _rows(db_engine, "SELECT admin_logins::text AS row FROM admin_logins ORDER BY id")
    stranger = _client(signed_in.app)
    assert _logs_out(stranger)
    after = _rows(db_engine, "SELECT admin_logins::text AS row FROM admin_logins ORDER BY id")
    assert after == before
    assert signed_in.get("/admin/report/list").status_code == 200


def test_ac2_lock_counts_five_wrong_within_15_minutes(
    admin_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = [1_800_000_000.0]
    monkeypatch.setattr(admin.auth, "_now", lambda: clock[0])
    for _ in range(4):
        assert _login_admin(admin_client, "four wrong are not a lock").status_code == 400
    assert _login_admin(admin_client).status_code == 302

    # Five wrong, but the first is more than 15 minutes older than the fifth: no lock.
    for minutes in (0, 4, 8, 12):
        clock[0] = 1_800_100_000.0 + minutes * 60
        assert _login_admin(admin_client, "spread over the window!!").status_code == 400
    clock[0] = 1_800_100_000.0 + 15 * 60 + 1
    assert _login_admin(admin_client, "spread over the window!!").status_code == 400
    assert _login_admin(admin_client).status_code == 302

    # Five within the window: the right password is refused.
    for _ in range(5):
        clock[0] += 1
        assert _login_admin(admin_client, "five wrong make a lock").status_code == 400
    assert _login_admin(admin_client).status_code == 400


def test_ac2_lock_holds_for_logins_whose_bodies_arrive_late(
    db_engine: Engine, admin_role: str
) -> None:
    """Six logins start at once and their bodies arrive later, the right password last: the five
    wrong ones lock it (the lock is checked after the body is read)."""
    engine = make_engine(admin_role)
    backend = PasswordAuth(_settings(admin_role), engine)

    def request(password: str, gate: asyncio.Event) -> Request:
        body = urlencode({"password": password}).encode()

        async def receive() -> Message:
            await gate.wait()
            return {"type": "http.request", "body": body, "more_body": False}

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/admin/login",
            "query_string": b"",
            "headers": [(b"content-type", b"application/x-www-form-urlencoded")],
            "session": {},
        }
        return Request(scope, receive)

    async def scenario() -> list[bool]:
        wrong, right = asyncio.Event(), asyncio.Event()
        logins = [
            asyncio.create_task(backend.login(request("wrong password, held", wrong)))
            for _ in range(5)
        ]
        last = asyncio.create_task(backend.login(request(PASSWORD, right)))
        await asyncio.sleep(0)  # every login is now waiting for its body
        wrong.set()
        results = list(await asyncio.gather(*logins))
        right.set()
        return [*results, await last]

    try:
        assert asyncio.run(scenario()) == [False] * 6
    finally:
        engine.dispose()
    assert (
        _scalar(db_engine, "SELECT count(*) FROM admin_logins WHERE locks_until IS NOT NULL") == 1
    )


def test_ac3_resolve_closes_the_whole_target(signed_in: TestClient, db_engine: Engine) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    r1 = make_seeker(db_engine, "r1@example.com")
    r2 = make_seeker(db_engine, "r2@example.com")
    listing_a, listing_c = uuid.uuid4(), uuid.uuid4()  # no FK on target_id
    a1 = _report(db_engine, r1, owner, "listing", listing_a)
    a2 = _report(db_engine, r2, owner, "listing", listing_a)
    b = _report(db_engine, r1, owner, "person", uuid.uuid4())
    c = _report(db_engine, r1, owner, "listing", listing_c, resolved=True)
    c_resolved = _scalar(db_engine, "SELECT resolved_at FROM reports WHERE id = :id", id=c)

    response = signed_in.get(f"/admin/report/action/resolve?pks={a1}")
    assert response.status_code == 302
    open_ids = {r.id for r in _rows(db_engine, "SELECT id FROM reports WHERE resolved_at IS NULL")}
    assert open_ids == {b}
    assert {a1, a2} <= {r.id for r in _rows(db_engine, "SELECT id FROM reports")}
    assert _log(db_engine) == [("resolve_reports", "report", a1, "2")]

    assert signed_in.get(f"/admin/report/action/resolve?pks={c}").status_code == 302
    assert _scalar(db_engine, "SELECT resolved_at FROM reports WHERE id = :id", id=c) == c_resolved
    assert len(_log(db_engine)) == 1

    # Two selected on one target: one row, on the first selected.
    d1 = _report(db_engine, r1, owner, "applicant", owner)
    d2 = _report(db_engine, r2, owner, "applicant", owner)
    assert signed_in.get(f"/admin/report/action/resolve?pks={d2},{d1}").status_code == 302
    assert _log(db_engine)[1:] == [("resolve_reports", "report", d2, "2")]
    assert signed_in.get("/admin/report/action/resolve?pks=nope").status_code == 400


def test_ac4_suspend_and_lift(
    signed_in: TestClient,
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    redis_clean: None,
) -> None:
    email = "noa@example.com"
    user = make_seeker(db_engine, email)
    reporter = make_seeker(db_engine, "reporter@example.com")
    bystander = make_seeker(db_engine, "bystander@example.com")
    api_1, api_2 = _login(client, db_engine, user), _login(client, db_engine, user)
    api_bystander = _login(client, db_engine, bystander)
    assert api_1.get("/me").status_code == 200

    def live_sessions() -> int:
        return int(
            _scalar(
                db_engine,
                "SELECT count(*) FROM sessions WHERE user_id = :u AND revoked_at IS NULL",
                u=user,
            )
        )

    def suspended() -> bool:
        return bool(
            _scalar(db_engine, "SELECT suspended_at IS NOT NULL FROM users WHERE id = :u", u=user)
        )

    assert live_sessions() == 2
    assert signed_in.get(f"/admin/user/action/suspend?pks={user}").status_code == 302
    assert suspended() and live_sessions() == 0
    # Already suspended: left as it is, nothing logged.
    assert signed_in.get(f"/admin/user/action/suspend?pks={user}").status_code == 302
    assert signed_in.get(f"/admin/user/action/unsuspend?pks={user}").status_code == 302
    assert not suspended()
    assert api_1.get("/me").status_code == 401
    assert api_2.get("/me").status_code == 401

    response = _verify(client, email, _request_code(client, outbox, email))
    assert response.status_code == 200, response.text
    fresh = TestClient(client.app, cookies={"rent_session": response.cookies["rent_session"]})
    assert fresh.get("/me").status_code == 200
    assert live_sessions() == 1

    report = _report(db_engine, reporter, user, "person", uuid.uuid4())
    path = f"/admin/report/action/suspend-reported-user?pks={report}"
    assert signed_in.get(path).status_code == 302
    assert suspended() and live_sessions() == 0
    assert fresh.get("/me").status_code == 401
    assert api_bystander.get("/me").status_code == 200
    assert (
        _scalar(
            db_engine,
            "SELECT count(*) FROM sessions WHERE user_id = :u AND revoked_at IS NULL",
            u=bystander,
        )
        == 1
    )
    assert _log(db_engine) == [
        ("suspend", "user", user, None),
        ("unsuspend", "user", user, None),
        ("suspend", "user", user, None),
    ]


def test_ac5_hide_and_unhide_listing(
    signed_in: TestClient, client: TestClient, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    listing = make_listing(db_engine, owner, gush_dan)

    def public_ids() -> set[str]:
        return {item["id"] for item in client.get("/listings").json()["items"]}

    def row() -> Any:
        return _rows(
            db_engine, "SELECT status, removed_at FROM listings WHERE id = :id", id=listing
        )[0]

    assert str(listing) in public_ids()
    details = signed_in.get(f"/admin/listing/details/{listing}")
    assert details.status_code == 200
    assert "בעלים &lt;owner@example.com&gt;" in details.text
    assert signed_in.get(f"/admin/listing/action/hide?pks={listing}").status_code == 302
    assert row().status == "paused" and row().removed_at is not None
    assert str(listing) not in public_ids()
    assert signed_in.get(f"/admin/listing/action/unhide?pks={listing}").status_code == 302
    assert row().status == "paused" and row().removed_at is None
    assert _log(db_engine) == [
        ("hide_listing", "listing", listing, None),
        ("unhide_listing", "listing", listing, None),
    ]

    # From a report: only listing targets; others are skipped with a message.
    reporter = make_seeker(db_engine, "reporter@example.com")
    on_listing = _report(db_engine, reporter, owner, "listing", listing)
    on_person = _report(db_engine, reporter, owner, "person", uuid.uuid4())
    path = f"/admin/report/action/hide-listing?pks={on_listing},{on_person}"
    assert signed_in.get(path).status_code == 302
    assert row().removed_at is not None
    toasts = signed_in.get("/admin/report/list").text
    assert "Skipped reports that are not on a listing." in toasts
    assert "Hid 1 listing(s)." in toasts
    assert _log(db_engine)[2:] == [("hide_listing", "listing", listing, None)]


def test_ac6_edit_listing_cap(signed_in: TestClient, db_engine: Engine) -> None:
    user = make_owner(db_engine, "owner@example.com")
    form = signed_in.get(f"/admin/user/edit/{user}")
    assert form.status_code == 200
    assert 'name="listing_cap"' in form.text
    for other in ("email", "display_name", "role", "suspended_at"):
        assert f'name="{other}"' not in form.text

    saved = signed_in.post(f"/admin/user/edit/{user}", data={"listing_cap": "10", "save": "Save"})
    assert saved.status_code == 302, saved.text
    assert _scalar(db_engine, "SELECT listing_cap FROM users WHERE id = :id", id=user) == 10
    assert _log(db_engine) == [("set_listing_cap", "user", user, "3→10")]

    for bad in ("101", "-1", ""):
        refused = signed_in.post(f"/admin/user/edit/{user}", data={"listing_cap": bad})
        assert refused.status_code == 400
        assert "invalid-feedback" in refused.text
    assert _scalar(db_engine, "SELECT listing_cap FROM users WHERE id = :id", id=user) == 10
    assert len(_log(db_engine)) == 1


def test_ac6_edit_listing_cap_edges(signed_in: TestClient, db_engine: Engine) -> None:
    user = make_owner(db_engine, "owner@example.com")
    before = _rows(
        db_engine, "SELECT email, display_name, suspended_at FROM users WHERE id = :id", id=user
    )

    def edit(data: dict[str, str]) -> None:
        saved = signed_in.post(f"/admin/user/edit/{user}", data={**data, "save": "Save"})
        assert saved.status_code == 302, saved.text

    def cap() -> int:
        return int(_scalar(db_engine, "SELECT listing_cap FROM users WHERE id = :id", id=user))

    edit({"listing_cap": "0"})
    assert cap() == 0
    edit({"listing_cap": "100"})
    assert cap() == 100
    edit({"listing_cap": "100"})  # the current value: no log row
    edit(
        {
            "listing_cap": "5",
            "email": "evil@example.com",
            "display_name": "Evil",
            "suspended_at": "2026-01-01 00:00:00",
        }
    )
    assert cap() == 5
    after = _rows(
        db_engine, "SELECT email, display_name, suspended_at FROM users WHERE id = :id", id=user
    )
    assert after == before
    assert _log(db_engine) == [
        ("set_listing_cap", "user", user, "3→0"),
        ("set_listing_cap", "user", user, "0→100"),
        ("set_listing_cap", "user", user, "100→5"),
    ]


def test_ac7_reported_chat_only(
    signed_in: TestClient, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    a = make_seeker(db_engine, "a@example.com", display_name="אורי")
    b = make_seeker(db_engine, "b@example.com", display_name="בתיה")
    c = make_seeker(db_engine, "c@example.com", display_name="גלעד")
    chat = make_direct_chat(db_engine, a, b)
    _message(db_engine, chat, b, "second\nline two", minutes_ago=5)
    _message(db_engine, chat, a, "first", minutes_ago=60)
    report = _report(db_engine, a, b, "chat", chat)

    page = signed_in.get(f"/admin/report/chat/{report}")
    assert page.status_code == 200
    assert f"Opened because of report {report}. This open is logged." in page.text
    assert "אורי" in page.text and "בתיה" in page.text
    assert page.text.index(">first<") < page.text.index(">second\nline two<")
    assert signed_in.get(f"/admin/report/chat/{report}").status_code == 200
    assert _log(db_engine) == [("read_chat", "chat", chat, str(report))] * 2

    empty = make_direct_chat(db_engine, a, c)
    empty_report = _report(db_engine, a, c, "chat", empty)
    page = signed_in.get(f"/admin/report/chat/{empty_report}")
    assert page.status_code == 200
    assert "No messages in this conversation." in page.text
    assert _log(db_engine)[2:] == [("read_chat", "chat", empty, str(empty_report))]

    # A room application's chat lists the room's flatmates too (not the seeker twice).
    owner = make_owner(db_engine, "owner@example.com")
    room = uuid.UUID(_room(db_engine, owner, gush_dan))
    application = make_application(db_engine, room, c, status="shortlisted")
    make_flatmate(db_engine, room, a)
    _execute(
        db_engine,
        "INSERT INTO conversations (id, application_id, owner_id, seeker_id)"
        " VALUES (:id, :id, :o, :s)",
        id=application,
        o=owner,
        s=c,
    )
    room_report = _report(db_engine, c, owner, "chat", application)
    page = signed_in.get(f"/admin/report/chat/{room_report}")
    assert page.status_code == 200
    assert all(f'dir="auto">{name}<' in page.text for name in ("בעלים", "גלעד", "אורי"))

    rows = len(_log(db_engine))
    listing_report = _report(db_engine, a, b, "listing", uuid.uuid4())
    details = signed_in.get(f"/admin/report/details/{report}").text
    assert f'href="http://localhost/admin/report/chat/{report}">Open reported chat</a>' in details
    assert f'href="http://localhost/admin/user/details/{b}"' in details
    details = signed_in.get(f"/admin/report/details/{listing_report}").text
    assert 'href="http://localhost/admin/listing/details/' in details
    _execute(db_engine, "DELETE FROM conversations WHERE id = :id", id=empty)
    for target in (listing_report, uuid.uuid4(), "not-a-uuid", empty_report):
        assert signed_in.get(f"/admin/report/chat/{target}").status_code == 404, target
    assert len(_log(db_engine)) == rows


def test_ac8_user_text_is_escaped(signed_in: TestClient, db_engine: Engine) -> None:
    a = make_seeker(db_engine, "a@example.com", display_name=XSS)
    b = make_seeker(db_engine, "b@example.com")
    chat = make_direct_chat(db_engine, a, b)
    _message(db_engine, chat, a, XSS, minutes_ago=1)
    report = _report(db_engine, a, b, "chat", chat, note=XSS)

    for path in (
        "/admin/report/list",
        f"/admin/report/details/{report}",
        f"/admin/report/chat/{report}",
        "/admin/user/list",
    ):
        page = signed_in.get(path)
        assert page.status_code == 200, path
        assert "<script>alert(1)" not in page.text, path
        assert ESCAPED in page.text, path
    chat_page = signed_in.get(f"/admin/report/chat/{report}").text
    assert f'<td dir="auto" style="white-space: pre-wrap">{ESCAPED}</td>' in chat_page
    assert f'<td dir="auto">{ESCAPED}</td>' in chat_page


def test_ac9_read_only_views(signed_in: TestClient, db_engine: Engine) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    reporter = make_seeker(db_engine, "reporter@example.com")
    _report(db_engine, reporter, owner, "person", uuid.uuid4())
    assert signed_in.get(f"/admin/user/action/suspend?pks={owner}").status_code == 302

    for identity in ("report", "user", "listing", "admin-action"):
        page = signed_in.get(f"/admin/{identity}/list")
        assert page.status_code == 200
        for offered in (f"/admin/{identity}/create", "/export/", 'id="action-delete"', "import"):
            assert offered not in page.text, (identity, offered)
        assert (f"/admin/{identity}/edit/" in page.text) is (identity == "user")
        pk = uuid.uuid4()
        assert signed_in.get(f"/admin/{identity}/create").status_code == 403
        assert signed_in.post(f"/admin/{identity}/create", data={}).status_code == 403
        assert signed_in.delete(f"/admin/{identity}/delete?pks={pk}").status_code == 403
        for export in ("csv", "json"):
            assert signed_in.get(f"/admin/{identity}/export/{export}").status_code == 403
        assert signed_in.post(f"/admin/{identity}/import").status_code == 403
        if identity != "user":
            assert signed_in.get(f"/admin/{identity}/edit/{pk}").status_code == 403
            assert signed_in.post(f"/admin/{identity}/edit/{pk}", data={}).status_code == 403
    assert _scalar(db_engine, "SELECT count(*) FROM users") == 2


_TABLES = ("reports", "users", "listings", "admin_actions")


def _snapshot(engine: Engine) -> dict[str, list[Any]]:
    return {
        table: [r.row for r in _rows(engine, f"SELECT t::text AS row FROM {table} t ORDER BY id")]
        for table in _TABLES
    }


def test_ac7_read_only_views_with_rows(
    signed_in: TestClient, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    reporter = make_seeker(db_engine, "reporter@example.com")
    listing = make_listing(db_engine, owner, gush_dan)
    report = _report(db_engine, reporter, owner, "listing", listing)
    assert signed_in.get(f"/admin/user/action/suspend?pks={reporter}").status_code == 302
    action = _scalar(db_engine, "SELECT id FROM admin_actions")
    before = _snapshot(db_engine)
    assert all(before.values())

    for identity, pk in (
        ("report", report),
        ("user", owner),
        ("listing", listing),
        ("admin-action", action),
    ):
        refused = [
            signed_in.get(f"/admin/{identity}/create"),
            signed_in.post(f"/admin/{identity}/create", data={}),
            signed_in.delete(f"/admin/{identity}/delete?pks={pk}"),
            signed_in.get(f"/admin/{identity}/export/csv"),
            signed_in.get(f"/admin/{identity}/export/json"),
            signed_in.post(f"/admin/{identity}/import"),
        ]
        if identity != "user":
            refused += [
                signed_in.get(f"/admin/{identity}/edit/{pk}"),
                signed_in.post(f"/admin/{identity}/edit/{pk}", data={"status": "paused"}),
            ]
        for response in refused:
            assert response.status_code == 403, (identity, response.request.url)
    assert _snapshot(db_engine) == before


def test_ac8_reported_chat_many_messages_members_and_time(
    signed_in: TestClient, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    seeker = make_seeker(db_engine, "seeker@example.com", display_name="שירה")
    flatmates = [
        make_seeker(db_engine, "f1@example.com", display_name="דנה"),
        make_seeker(db_engine, "f2@example.com", display_name="יואב"),
    ]
    room = uuid.UUID(_room(db_engine, owner, gush_dan))
    application = make_application(db_engine, room, seeker, status="shortlisted")
    for flatmate in flatmates:
        make_flatmate(db_engine, room, flatmate)
    _execute(
        db_engine,
        "INSERT INTO conversations (id, application_id, owner_id, seeker_id)"
        " VALUES (:id, :id, :o, :s)",
        id=application,
        o=owner,
        s=seeker,
    )
    senders = [owner, seeker, *flatmates]
    for i in reversed(range(55)):  # stored newest first
        _execute(
            db_engine,
            "INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES"
            " (:c, :s, :b, timestamptz '2026-07-01T21:30:00Z' + make_interval(mins => :i))",
            c=application,
            s=senders[i % 4],
            b=f"message {i:02d}",
            i=i,
        )
    report = _report(db_engine, seeker, owner, "chat", application)

    page = signed_in.get(f"/admin/report/chat/{report}")
    assert page.status_code == 200
    bodies = re.findall(r'style="white-space: pre-wrap">(message \d\d)</td>', page.text)
    assert bodies == [f"message {i:02d}" for i in range(55)]
    members = page.text.split("<h4>Members</h4>")[1].split("</ul>")[0]
    assert re.findall(r'<li dir="auto">([^<]+)</li>', members) == ["בעלים", "שירה", "דנה", "יואב"]
    assert '<td class="text-nowrap">2026-07-02 00:30</td>' in page.text


def _check_role(admin_role: str, owner: uuid.UUID) -> None:
    engine = create_engine(admin_role)
    try:
        for statement in (
            "DELETE FROM reports",
            "UPDATE users SET email = 'x@example.com'",
            "UPDATE listings SET price_ils = 1000",
            "UPDATE sessions SET expires_at = now()",
            "DELETE FROM sessions",
            "DELETE FROM admin_actions",
            "UPDATE admin_actions SET detail = 'x'",
            "UPDATE admin_logins SET ok = false",
            "UPDATE admin_logins SET token_hash = 'x'",
            "UPDATE admin_logins SET locks_until = now()",
            "UPDATE admin_logins SET at = now()",
            "DELETE FROM admin_logins",
            "CREATE TABLE x()",
            "INSERT INTO users (email, display_name, role) VALUES ('y@example.com', 'yy', 'owner')",
            "SELECT hash FROM user_passwords",  # 0016a
        ):
            with engine.connect() as conn, pytest.raises(ProgrammingError) as error:
                conn.execute(text(statement))
            assert isinstance(error.value.orig, InsufficientPrivilege), statement
        with engine.begin() as conn:  # its own columns are writable
            conn.execute(
                text("UPDATE users SET listing_cap = 4, suspended_at = NULL WHERE id = :id"),
                {"id": owner},
            )
            token_hash = uuid.uuid4().hex
            conn.execute(
                text("INSERT INTO admin_logins (at, ok, token_hash) VALUES (now(), true, :h)"),
                {"h": token_hash},
            )
            ended = conn.execute(
                text("UPDATE admin_logins SET ended_at = now() WHERE token_hash = :h"),
                {"h": token_hash},
            )
            assert ended.rowcount == 1
        flags = _rows(
            engine,
            "SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles"
            " WHERE rolname = 'homie_admin'",
        )
    finally:
        engine.dispose()
    assert flags == [(False, False, False, False)]


def test_nf2_role_has_only_its_grants(admin_role: str, db_engine: Engine) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    _check_role(admin_role, owner)
    password = os.environ.get("ADMIN_DB_PASSWORD") or "dev-only-admin-db-password"
    apply_admin_role(TEST_DATABASE_URL, password)
    apply_admin_role(TEST_DATABASE_URL, password)
    _check_role(admin_role, owner)  # a re-run converges on the same rights


def test_nf3_host_and_fetch_site_guards(admin_client: TestClient, db_engine: Engine) -> None:
    assert admin_client.get("/admin/login", headers={"host": "evil.example"}).status_code == 400
    for site in ("cross-site", "same-site"):
        refused = admin_client.post(
            "/admin/login",
            data={"username": "", "password": PASSWORD},
            headers={"sec-fetch-site": site},
        )
        assert refused.status_code == 400, site
        assert "set-cookie" not in refused.headers
    for site in ("same-origin", "none"):
        assert admin_client.get("/admin/login", headers={"sec-fetch-site": site}).status_code == 200
    # Spec 0013e: a client that sends no `Sec-Fetch-Site` (curl, an old browser) only reads.
    bare = _client(admin_client.app)
    assert bare.get("/admin/login").status_code == 200
    refused = bare.post("/admin/login", data={"username": "", "password": PASSWORD})
    assert refused.status_code == 400
    assert "set-cookie" not in refused.headers
    assert _scalar(db_engine, "SELECT count(*) FROM admin_logins") == 0
    assert _login_admin(admin_client).status_code == 302
    user = make_owner(db_engine, "owner@example.com")
    suspend = f"/admin/user/action/suspend?pks={user}"
    bare.cookies.set("homie_admin", admin_client.cookies["homie_admin"])
    assert bare.get("/admin/user/list").status_code == 200
    assert bare.get(suspend).status_code == 400
    assert bare.post(f"/admin/user/edit/{user}", data={"listing_cap": "9"}).status_code == 400
    # An action or a write needs `same-origin`: `none` is a link opened from mail or chat.
    for site in ("same-site", "cross-site", "none"):
        assert admin_client.get(suspend, headers={"sec-fetch-site": site}).status_code == 400
    refused = admin_client.post(
        f"/admin/user/edit/{user}", data={"listing_cap": "9"}, headers={"sec-fetch-site": "none"}
    )
    assert refused.status_code == 400
    assert _scalar(db_engine, "SELECT suspended_at FROM users WHERE id = :id", id=user) is None
    assert _scalar(db_engine, "SELECT listing_cap FROM users WHERE id = :id", id=user) == 3
    assert _log(db_engine) == []
    assert (
        admin_client.get("/admin/user/list", headers={"sec-fetch-site": "none"}).status_code == 200
    )
    done = admin_client.get(suspend, headers={"sec-fetch-site": "same-origin"})
    assert done.status_code == 302
    assert _log(db_engine) == [("suspend", "user", user, None)]


def test_nf4_settings_refuse_weak_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    env = {k: v for k, v in os.environ.items() if not k.startswith("ADMIN_")}
    imported = subprocess.run(
        [sys.executable, "-c", "import admin.main"], cwd=API_DIR, env=env, capture_output=True
    )
    assert imported.returncode == 0, imported.stderr

    good = {
        "ADMIN_DATABASE_URL": "postgresql+psycopg://homie_admin:x@localhost:1/rent",
        "ADMIN_PASSWORD": "p" * 16,
        "ADMIN_SECRET_KEY": "s" * 32,
    }
    for name in [k for k in os.environ if k.startswith("ADMIN_")]:
        monkeypatch.delenv(name)
    bad_values: list[dict[str, str | None]] = [
        {"ADMIN_PASSWORD": "p" * 15},
        {"ADMIN_SECRET_KEY": "s" * 31},
        {"ADMIN_PASSWORD": ""},
        {"ADMIN_SECRET_KEY": ""},
        {"ADMIN_DATABASE_URL": ""},
        {"ADMIN_PASSWORD": None},
        {"ADMIN_SECRET_KEY": None},
        {"ADMIN_DATABASE_URL": None},
    ]
    for bad in bad_values:
        for name, value in {**good, **bad}.items():
            if value is None:
                monkeypatch.delenv(name, raising=False)
            else:
                monkeypatch.setenv(name, value)
        with pytest.raises(ValidationError):
            main()
    for name, value in good.items():
        monkeypatch.setenv(name, value)
    assert isinstance(main(), Starlette)


def test_nf5_action_and_log_are_one_transaction(
    signed_in: TestClient,
    db_engine: Engine,
    admin_role: str,
    gush_dan: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_owner(db_engine, "owner@example.com")
    suspended = make_owner(db_engine, "suspended@example.com")
    reporter = make_seeker(db_engine, "reporter@example.com")
    session_id = _live_session(db_engine, user)
    _execute(db_engine, "UPDATE users SET suspended_at = now() WHERE id = :id", id=suspended)
    live = make_listing(db_engine, user, gush_dan)
    hidden = make_listing(db_engine, user, gush_dan, status="paused")
    _execute(db_engine, "UPDATE listings SET removed_at = now() WHERE id = :id", id=hidden)
    report = _report(db_engine, reporter, user, "person", uuid.uuid4())

    def broken_log(*args: Any) -> None:
        raise RuntimeError("log insert failed")

    # Every action: its UPDATE runs, its log insert fails, and neither is committed.
    # (read_chat writes only its log row, so it has no UPDATE to roll back.)
    engine = create_engine(admin_role)
    try:
        with monkeypatch.context() as patch:
            patch.setattr(actions, "_log", broken_log)
            for action, target in (
                (actions.suspend, user),
                (actions.unsuspend, suspended),
                (actions.hide_listings, live),
                (actions.unhide_listings, hidden),
                (actions.resolve_reports, report),
            ):
                with Session(engine) as session, pytest.raises(RuntimeError):
                    action(session, [target])
    finally:
        engine.dispose()

    def one(sql: str, row_id: uuid.UUID) -> Any:
        return _rows(db_engine, sql, id=row_id)[0]

    assert one("SELECT suspended_at FROM users WHERE id = :id", user).suspended_at is None
    assert one("SELECT revoked_at FROM sessions WHERE id = :id", session_id).revoked_at is None
    assert one("SELECT suspended_at FROM users WHERE id = :id", suspended).suspended_at is not None
    live_row = one("SELECT status, removed_at FROM listings WHERE id = :id", live)
    assert (live_row.status, live_row.removed_at) == ("active", None)
    hidden_row = one("SELECT status, removed_at FROM listings WHERE id = :id", hidden)
    assert hidden_row.status == "paused" and hidden_row.removed_at is not None
    assert one("SELECT resolved_at FROM reports WHERE id = :id", report).resolved_at is None

    # The reverse, through UserView's real edit: the log row is added, then the UPDATE fails at
    # the DB CHECK (the form's range check is lifted so 101 reaches it).
    monkeypatch.setattr(UserView, "form_args", {"listing_cap": {"validators": []}})
    failed = signed_in.post(f"/admin/user/edit/{user}", data={"listing_cap": "101"})
    assert failed.status_code == 400
    assert "ck_users_listing_cap" in failed.text
    assert _scalar(db_engine, "SELECT listing_cap FROM users WHERE id = :id", id=user) == 3
    assert _log(db_engine) == []


def test_deleted_account_in_reports_and_chat(signed_in: TestClient, db_engine: Engine) -> None:
    # Spec 0013c AC10: a report about a deleted account and its reported chat.
    a = make_seeker(db_engine, "a@example.com", display_name="אורי")
    b = make_seeker(db_engine, "b@example.com", display_name="בתיה")
    chat = make_direct_chat(db_engine, a, b)
    _message(db_engine, chat, b, "from the deleted one", minutes_ago=5)
    _message(db_engine, chat, a, "from the one left", minutes_ago=1)
    report = _report(db_engine, a, b, "chat", chat)
    # The tombstone `delete_account` leaves.
    _execute(
        db_engine,
        "UPDATE users SET deleted_at = now(), email = NULL, display_name = NULL, photo_key = NULL"
        " WHERE id = :id",
        id=b,
    )

    reports = signed_in.get("/admin/report/list")
    assert reports.status_code == 200
    assert f"deleted account ({b})" in reports.text
    details = signed_in.get(f"/admin/report/details/{report}")
    assert details.status_code == 200
    assert f"deleted account ({b})" in details.text
    page = signed_in.get(f"/admin/report/chat/{report}")
    assert page.status_code == 200
    assert 'dir="auto">(deleted account)<' in page.text
    assert page.text.count("(deleted account)") >= 2  # the member and the sender
    assert "אורי" in page.text
    assert signed_in.get("/admin/user/list").status_code == 200
    assert signed_in.get(f"/admin/user/details/{b}").status_code == 200


def test_0016a_ac11_admin_cannot_read_passwords(
    signed_in: TestClient, admin_role: str, db_engine: Engine
) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    reporter = make_seeker(db_engine, "reporter@example.com")
    _execute(
        db_engine,
        "INSERT INTO user_passwords (user_id, hash) VALUES (:u, :h)",
        u=owner,
        h=passwords.hash_password("a-valid-password"),
    )
    _execute(db_engine, "UPDATE users SET google_sub = 'g-sub-1' WHERE id = :u", u=owner)
    _report(db_engine, reporter, owner, "chat", make_direct_chat(db_engine, owner, reporter))
    engine = create_engine(admin_role)
    try:
        with engine.connect() as conn, pytest.raises(ProgrammingError) as error:
            conn.execute(text("SELECT hash FROM user_passwords"))
        assert isinstance(error.value.orig, InsufficientPrivilege)
        columns = ", ".join(c.name for c in User.__table__.columns)
        assert _rows(engine, f"SELECT {columns} FROM users WHERE id = :id", id=owner)[
            0
        ].google_sub == ("g-sub-1")
    finally:
        engine.dispose()

    for page in ("/admin/user/list", f"/admin/user/details/{owner}", "/admin/report/list"):
        assert signed_in.get(page).status_code == 200, page


def test_ac13_admin_actions_cancel_tours(
    db_engine: Engine, admin_role: str, gush_dan: uuid.UUID
) -> None:
    # Spec 0018a AC13: as `homie_admin`, hiding a listing cancels its upcoming tours, suspending a
    # user cancels the upcoming tours they book or host; `system`, no chat line; past tours and
    # other listings' tours stay booked.
    now = tours_tests.db_now(db_engine)
    hour = dt.timedelta(hours=1)

    def booked(email: str, at: dt.timedelta, **listing: Any) -> tuple[uuid.UUID, ...]:
        owner = make_owner(db_engine, f"owner-{email}")
        seeker = make_seeker(db_engine, f"seeker-{email}")
        listing_id = make_listing(db_engine, owner, gush_dan, **listing)
        application = tours_tests.shortlisted(db_engine, listing_id, seeker, owner)
        tour = tours_tests.make_tour(db_engine, listing_id, application, seeker, now + at)
        return owner, seeker, listing_id, application, tour

    _, _, hidden, hidden_app, hidden_tour = booked("h@example.com", 3 * hour)
    past = tours_tests.make_tour(
        db_engine, hidden, hidden_app, make_seeker(db_engine, "p@example.com"), now - 3 * hour
    )
    host, _, _, _, hosted_tour = booked("o@example.com", 4 * hour)
    _, guest, _, _, guest_tour = booked("g@example.com", 5 * hour)
    *_, untouched = booked("u@example.com", 6 * hour)

    engine = create_engine(admin_role)
    try:
        with Session(engine) as session:
            assert actions.hide_listings(session, [hidden]) == 1
        with Session(engine) as session:
            assert actions.suspend(session, [host, guest]) == 2
    finally:
        engine.dispose()

    for tour in (hidden_tour, hosted_tour, guest_tour):
        row = tours_tests.tour_row(db_engine, tour)
        assert (row.status, row.cancelled_by, row.cancelled_at is not None) == (
            "cancelled",
            "system",
            True,
        )
    for tour in (past, untouched):
        assert tours_tests.tour_row(db_engine, tour).status == "booked"
    assert _scalar(db_engine, "SELECT count(*) FROM messages WHERE tour_id IS NOT NULL") == 0


def test_ac13_read_chat_shows_tour_lines(
    signed_in: TestClient, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    # Spec 0018a AC13: a reported chat shows a tour line as "Tour <change>: <Israel time>".
    owner = make_owner(db_engine, "owner@example.com")
    seeker = make_seeker(db_engine, "seeker@example.com")
    listing = make_listing(db_engine, owner, gush_dan)
    chat = tours_tests.shortlisted(db_engine, listing, seeker, owner)
    starts_at = dt.datetime(2026, 11, 18, 16, 20, tzinfo=dt.UTC)  # 18:20 in Israel (+02)
    tour = tours_tests.make_tour(db_engine, listing, chat, seeker, starts_at)
    _message(db_engine, chat, seeker, "hello", minutes_ago=10)
    _execute(
        db_engine,
        "INSERT INTO messages (conversation_id, sender_id, tour_id, tour_change, tour_starts_at)"
        " VALUES (:c, :s, :t, 'cancelled_by_lister', :at)",
        c=chat,
        s=owner,
        t=tour,
        at=starts_at,
    )
    report = _report(db_engine, seeker, owner, "chat", chat)
    page = signed_in.get(f"/admin/report/chat/{report}")
    assert page.status_code == 200
    assert ">hello<" in page.text
    assert ">Tour cancelled by lister: 2026-11-18 18:20<" in page.text
