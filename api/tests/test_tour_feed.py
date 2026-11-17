"""The lister's calendar feed (spec 0018d): AC1-AC8, AC10-AC12 (AC9 in `test_account_deletion.py`,
AC12's 503 log in `test_db_errors.py`, AC13 in `test_ics.py`).

`O` ("Noa") owns an apartment `A` (כצנלסון, גבעתיים) and a room `R` (הרצל, תל אביב); `S` ("Dana")
and `Y` ("Yael") have shortlisted applications to them. Tours are inserted with SQL (0018a's
`make_tour`), at offsets from the database's now. The feed is fetched with the bare `client` (no
cookie), as a calendar server would."""

import datetime as dt
import hashlib
import logging
import re
import uuid
from collections.abc import Iterator
from decimal import Decimal
from typing import Any

import httpx
import pytest
import redis
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text

from app import limits
from app.config import get_settings
from app.main import create_app
from app.services import ics
from app.services.tour_feed import RedactFeedToken, redact_path
from tests.conftest import Outbox, make_listing, make_owner, make_seeker, signup
from tests.test_tours import _execute, _ok, _scalar, _user_id, db_now, make_tour, shortlisted

pytestmark = pytest.mark.usefixtures("redis_clean")

DAY = dt.timedelta(days=1)
HOUR = dt.timedelta(hours=1)
UNAUTHENTICATED = {"detail": "unauthenticated"}


@pytest.fixture
def owner(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "o@example.com", "owner", display_name="Noa")


@pytest.fixture
def owner_id(owner: TestClient) -> uuid.UUID:
    return _user_id(owner)


@pytest.fixture
def dana(db_engine: Engine) -> uuid.UUID:
    return make_seeker(db_engine, "dana@example.com", "Dana")


@pytest.fixture
def yael(db_engine: Engine) -> uuid.UUID:
    return make_seeker(db_engine, "yael@example.com", "Yael")


@pytest.fixture
def apartment(owner_id: uuid.UUID, gush_dan: uuid.UUID, db_engine: Engine) -> uuid.UUID:
    return make_listing(db_engine, owner_id, gush_dan)


@pytest.fixture
def room(owner_id: uuid.UUID, gush_dan: uuid.UUID, db_engine: Engine) -> uuid.UUID:
    return make_listing(
        db_engine,
        owner_id,
        gush_dan,
        listing_type="room",
        rooms=Decimal("2.5"),
        flatmates_count=2,
        gender_preference="women",
        street="הרצל",
        city="תל אביב",
    )


@pytest.fixture
def now(db_engine: Engine) -> dt.datetime:
    return db_now(db_engine).replace(microsecond=0)


@pytest.fixture
def statements(db_engine: Engine) -> Iterator[list[str]]:
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(db_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine, "before_cursor_execute", record)


def _create(caller: TestClient) -> str:
    response = caller.post("/me/tour-feed")
    token: str = _ok(response, 201)["token"]
    return token


def _feed(caller: TestClient, token: str) -> httpx.Response:
    response: httpx.Response = caller.get(f"/tour-feed/{token}.ics")
    return response


def _body(caller: TestClient, token: str) -> str:
    response = _feed(caller, token)
    assert response.status_code == 200, response.text
    return response.text


def _lines(body: str) -> list[str]:
    return body.replace("\r\n ", "").split("\r\n")


def _uids(body: str) -> list[str]:
    return [line.removeprefix("UID:") for line in _lines(body) if line.startswith("UID:")]


def _tour(
    engine: Engine, owner_id: uuid.UUID, listing: uuid.UUID, seeker: uuid.UUID, at: dt.datetime
) -> uuid.UUID:
    """A booked tour on `listing` (one shortlisted application per seeker and listing)."""
    application = _scalar(
        engine,
        "SELECT id FROM applications WHERE listing_id = :l AND seeker_id = :s",
        l=listing,
        s=seeker,
    ) or shortlisted(engine, listing, seeker, owner_id)
    return make_tour(engine, listing, application, seeker, at)


def _empty_body(client: TestClient, outbox: Outbox) -> str:
    """The feed of an active account with no tours: the reference empty calendar."""
    lonely = signup(client, outbox, "lonely@example.com", "owner", display_name="Lonely")
    return _body(client, _create(lonely))


def test_ac1_create_returns_token_once_stores_hash(
    owner: TestClient, owner_id: uuid.UUID, db_engine: Engine
) -> None:
    response = owner.post("/me/tour-feed")
    body = _ok(response, 201)
    assert list(body) == ["token"]
    token = body["token"]
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", token)
    assert response.headers["cache-control"] == "no-store"
    assert "set-cookie" not in response.headers
    stored = _scalar(db_engine, "SELECT token_hash FROM tour_feeds WHERE user_id = :u", u=owner_id)
    assert stored == hashlib.sha256(token.encode()).hexdigest()
    for table in ("tour_feeds", "users"):
        rows = _scalar(db_engine, f"SELECT string_agg(row_to_json(t)::text, '') FROM {table} t")
        assert token not in rows


def test_ac2_feed_lists_own_booked_tours_in_window(
    client: TestClient,
    owner: TestClient,
    owner_id: uuid.UUID,
    dana: uuid.UUID,
    yael: uuid.UUID,
    apartment: uuid.UUID,
    room: uuid.UUID,
    gush_dan: uuid.UUID,
    now: dt.datetime,
    db_engine: Engine,
) -> None:
    expired = make_listing(db_engine, owner_id, gush_dan, expires_at=now - DAY)
    flat_tour = _tour(db_engine, owner_id, apartment, dana, now + 2 * HOUR)
    room_tour = _tour(db_engine, owner_id, room, yael, now + HOUR)
    recent = _tour(db_engine, owner_id, room, yael, now - 29 * DAY)
    _tour(db_engine, owner_id, apartment, dana, now - 31 * DAY)  # out of the window
    expired_tour = _tour(db_engine, owner_id, expired, dana, now + 3 * HOUR)
    cancelled = _tour(db_engine, owner_id, apartment, yael, now + 4 * HOUR)
    _execute(
        db_engine,
        "UPDATE tours SET status = 'cancelled', cancelled_by = 'lister', cancelled_at = now()"
        " WHERE id = :t",
        t=cancelled,
    )
    gone = make_seeker(db_engine, "gone@example.com", "Gone")
    _tour(db_engine, owner_id, apartment, gone, now - 2 * DAY)
    _execute(
        db_engine,
        "UPDATE users SET deleted_at = now(), email = NULL, display_name = NULL WHERE id = :u",
        u=gone,
    )
    other = make_owner(db_engine, "other@example.com")
    other_listing = make_listing(db_engine, other, gush_dan)
    _tour(db_engine, other, other_listing, dana, now + 5 * HOUR)
    token = _create(owner)

    response = _feed(client, token)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "text/calendar; charset=utf-8"
    assert response.headers["cache-control"] == "private, max-age=300"
    assert response.headers["content-disposition"] == 'inline; filename="homie-tours.ics"'
    assert "set-cookie" not in response.headers
    assert _uids(response.text) == [
        ics.tour_uid(t) for t in (recent, room_tour, flat_tour, expired_tour)
    ]
    lines = _lines(response.text)
    assert lines.count("BEGIN:VEVENT") == lines.count("END:VEVENT") == 4
    assert lines.count("STATUS:CONFIRMED") == 4


def test_ac3_event_content_reveals_only_name_and_address(
    client: TestClient,
    owner: TestClient,
    owner_id: uuid.UUID,
    yael: uuid.UUID,
    room: uuid.UUID,
    now: dt.datetime,
    db_engine: Engine,
) -> None:
    tour = _tour(db_engine, owner_id, room, yael, now + HOUR)
    _execute(db_engine, "UPDATE applications SET message = 'MESSAGE-CANARY'")
    starts_at, ends_at = (
        _scalar(db_engine, f"SELECT {column} FROM tours WHERE id = :t", t=tour)
        for column in ("starts_at", "ends_at")
    )
    body = _body(client, _create(owner))
    lines = _lines(body)
    url = f"{get_settings().web_origin}/tours"

    event_lines = lines[lines.index("BEGIN:VEVENT") : lines.index("END:VEVENT") + 1]
    assert f"UID:{ics.tour_uid(tour)}" in event_lines
    assert f"DTSTART:{ics.fmt_utc(starts_at)}" in event_lines
    assert f"DTEND:{ics.fmt_utc(ends_at)}" in event_lines
    assert all(line.endswith("Z") for line in event_lines if line.startswith(("DTSTART", "DTEND")))
    assert "SUMMARY:סיור: רחוב הרצל\\, תל אביב" in event_lines
    assert "LOCATION:רחוב הרצל\\, תל אביב" in event_lines
    assert f"DESCRIPTION:סיור עם Yael\\nלפרטים ולצ'אט: {url}" in event_lines
    assert f"URL:{url}" in event_lines
    assert not any(line.startswith("ORGANIZER") for line in lines)
    assert "yael@example.com" not in body and "MESSAGE-CANARY" not in body


def test_ac4_rotate_kills_old_token(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    owner_id: uuid.UUID,
    dana: uuid.UUID,
    apartment: uuid.UUID,
    now: dt.datetime,
    db_engine: Engine,
) -> None:
    tour = _tour(db_engine, owner_id, apartment, dana, now + HOUR)
    old = _create(owner)
    assert _uids(_body(client, old)) == [ics.tour_uid(tour)]
    new = _create(owner)

    assert new != old
    assert _body(client, old) == _empty_body(client, outbox)
    assert _uids(_body(client, new)) == [ics.tour_uid(tour)]


def test_ac5_disable_is_idempotent(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    owner_id: uuid.UUID,
    dana: uuid.UUID,
    apartment: uuid.UUID,
    now: dt.datetime,
    db_engine: Engine,
) -> None:
    _tour(db_engine, owner_id, apartment, dana, now + HOUR)
    token = _create(owner)

    assert owner.delete("/me/tour-feed").status_code == 204
    assert _scalar(db_engine, "SELECT count(*) FROM tour_feeds WHERE user_id = :u", u=owner_id) == 0
    assert _body(client, token) == _empty_body(client, outbox)
    assert owner.delete("/me/tour-feed").status_code == 204
    assert _ok(owner.get("/me/tour-feed")) == {"active": False}


def test_ac6_dead_tokens_get_identical_empty_calendar(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    statements: list[str],
) -> None:
    empty = _empty_body(client, outbox)
    assert "BEGIN:VEVENT" not in empty and "DTSTAMP" not in empty
    disabled = _create(owner)
    assert owner.delete("/me/tour-feed").status_code == 204

    statements.clear()
    for malformed in ("a" * 42, "a" * 20 + "." + "a" * 22):
        response = _feed(client, malformed)
        assert (response.status_code, response.json()) == (404, {"detail": "not_found"})
    assert statements == []

    assert _body(client, "b" * 43) == empty
    assert _body(client, disabled) == empty


def test_ac7_suspended_owner_feed_empty(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    owner_id: uuid.UUID,
    dana: uuid.UUID,
    apartment: uuid.UUID,
    now: dt.datetime,
    db_engine: Engine,
) -> None:
    tour = _tour(db_engine, owner_id, apartment, dana, now + HOUR)
    token = _create(owner)
    empty = _empty_body(client, outbox)

    _execute(db_engine, "UPDATE users SET suspended_at = now() WHERE id = :u", u=owner_id)
    assert _body(client, token) == empty
    _execute(db_engine, "UPDATE users SET suspended_at = NULL WHERE id = :u", u=owner_id)
    assert _uids(_body(client, token)) == [ics.tour_uid(tour)]


def test_ac8_status_and_auth(
    client: TestClient,
    owner: TestClient,
    owner_id: uuid.UUID,
    dana: uuid.UUID,
    apartment: uuid.UUID,
    now: dt.datetime,
    db_engine: Engine,
) -> None:
    assert _ok(owner.get("/me/tour-feed")) == {"active": False}
    _tour(db_engine, owner_id, apartment, dana, now + HOUR)
    token = _create(owner)
    assert _ok(owner.get("/me/tour-feed")) == {"active": True}

    for method in ("GET", "POST", "DELETE"):
        response = client.request(method, "/me/tour-feed")
        assert (response.status_code, response.json()) == (401, UNAUTHENTICATED)
    with_cookie, without = _feed(owner, token), _feed(client, token)
    assert with_cookie.status_code == without.status_code == 200
    # DTSTAMP is the request time: equal up to it.
    stamp = re.compile(r"DTSTAMP:\d{8}T\d{6}Z")
    assert stamp.sub("", with_cookie.text) == stamp.sub("", without.text)
    assert "set-cookie" not in with_cookie.headers


def test_ac10_feed_read_limit(
    client: TestClient, owner: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = _create(owner)
    monkeypatch.setattr(limits, "READ", limits.IpBucket("read", 2, 100))
    for _ in range(2):
        assert _feed(client, token).status_code == 200
    response = _feed(client, token)
    assert (response.status_code, response.json()) == (429, {"detail": "rate_limited"})
    assert int(response.headers["retry-after"]) >= 1

    def down(*_: Any, **__: Any) -> None:
        raise redis.exceptions.ConnectionError("redis is down")

    monkeypatch.setattr(limits, "count_or_raise", down)
    assert _feed(client, token).status_code == 200


def test_ac11_feed_capped(
    client: TestClient,
    owner: TestClient,
    owner_id: uuid.UUID,
    dana: uuid.UUID,
    apartment: uuid.UUID,
    now: dt.datetime,
    db_engine: Engine,
) -> None:
    application = shortlisted(db_engine, apartment, dana, owner_id)
    _execute(
        db_engine,
        "INSERT INTO tours (listing_id, application_id, seeker_id, starts_at, ends_at)"
        " SELECT :l, :a, :s, :t + i * interval '1 hour', :t + i * interval '1 hour'"
        " + interval '30 minutes' FROM generate_series(0, 500) i",
        l=apartment,
        a=application,
        s=dana,
        t=now - DAY,
    )
    with db_engine.connect() as conn:
        earliest = conn.execute(
            text("SELECT id FROM tours ORDER BY starts_at, id LIMIT 500")
        ).scalars()
        expected = [ics.tour_uid(t) for t in earliest]
    assert _scalar(db_engine, "SELECT count(*) FROM tours") == 501

    assert _uids(_body(client, _create(owner))) == expected


def test_ac12_access_log_redacts_feed_token(caplog: pytest.LogCaptureFixture) -> None:
    create_app()
    create_app()
    access = logging.getLogger("uvicorn.access")
    assert sum(isinstance(f, RedactFeedToken) for f in access.filters) == 1

    token = "T" * 43
    with caplog.at_level(logging.INFO, logger="uvicorn.access"):
        access.info(
            '%s - "%s %s HTTP/%s" %d', "1.2.3.4:5", "GET", f"/tour-feed/{token}.ics?x=1", "1.1", 200
        )
        access.info('%s - "%s %s HTTP/%s" %d', "1.2.3.4:5", "GET", "/listings?city=x", "1.1", 200)
    assert token not in caplog.text
    assert [r.getMessage() for r in caplog.records] == [
        '1.2.3.4:5 - "GET /tour-feed/[redacted] HTTP/1.1" 200',
        '1.2.3.4:5 - "GET /listings?city=x HTTP/1.1" 200',
    ]
    assert redact_path(f"/tour-feed/{token}.ics") == "/tour-feed/[redacted]"
    assert redact_path("/tours") == "/tours"
