"""Seeker applications API, applicant count and view counter (spec 0004a): AC1-AC9. Spec 0010l
(one room interest: the message optional on a room, an invite answered by an application) is at
the end: its AC1-AC5."""

import datetime as dt
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text
from sqlalchemy.orm import Session

from app.db import get_sessionmaker
from app.models import Application, Listing, User
from app.redis_client import get_redis
from app.services import applications as applications_service
from app.services import chat_events, listing_views
from app.services import people as people_service
from scripts.seed import GUSH_DAN_WKT
from tests import test_people as people_tests
from tests import test_tours as tours_tests
from tests.conftest import (
    NO_LOOKING,
    Outbox,
    make_application,
    make_flatmate,
    make_listing,
    make_owner,
    make_pair,
    make_profile,
    make_seeker,
    signup,
)
from tests.test_search import PUBLIC_KEYS

pytestmark = pytest.mark.usefixtures("redis_clean")

# `source` (0008a): "apply" on every application made here.
APPLICATION_KEYS = {"id", "status", "source", "message", "created_at", "updated_at", "listing"}
LISTING_SUMMARY_KEYS = {"id", "listing_type", "city", "street", "rooms", "price_ils"}
OWNER_KEYS = {"owner_id", "display_name", "email"}
NOT_FOUND = {"detail": "not_found"}


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _count(engine: Engine) -> int:
    count: int = _scalar(engine, "SELECT count(*) FROM applications")
    return count


def _user_id(caller: TestClient) -> uuid.UUID:
    return uuid.UUID(caller.get("/me").json()["id"])


def _apply(caller: TestClient, listing_id: Any, message: Any = "Hello there") -> httpx.Response:
    response: httpx.Response = caller.post(
        f"/listings/{listing_id}/applications", json={"message": message}
    )
    return response


def _applied(caller: TestClient, listing_id: Any, message: str = "Hello there") -> dict[str, Any]:
    response = _apply(caller, listing_id, message)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def _withdraw(caller: TestClient, application_id: Any) -> httpx.Response:
    response: httpx.Response = caller.post(f"/me/applications/{application_id}/withdraw")
    return response


def _keys(value: Any) -> set[str]:
    """Every key in a JSON value, at any depth."""
    if isinstance(value, dict):
        return set(value).union(*(_keys(v) for v in value.values()))
    if isinstance(value, list):
        return set().union(*(_keys(v) for v in value))
    return set()


def _assert_application_shape(item: dict[str, Any]) -> None:
    assert set(item) == APPLICATION_KEYS
    assert item["source"] == "apply"  # 0008a
    assert set(item["listing"]) == LISTING_SUMMARY_KEYS
    assert not _keys(item) & (OWNER_KEYS | {"seeker_id"})


def _status(engine: Engine, application_id: Any) -> str:
    status: str = _scalar(
        engine, "SELECT status FROM applications WHERE id = :id", id=str(application_id)
    )
    return status


def _view_count(engine: Engine, listing_id: Any) -> int:
    count: int = _scalar(
        engine, "SELECT view_count FROM listings WHERE id = :id", id=str(listing_id)
    )
    return count


def _seeker_with_profile(
    client: TestClient, outbox: Outbox, email: str, area_id: uuid.UUID, db_engine: Engine
) -> TestClient:
    """A signed-up seeker who has a housing profile, so the apply gate (0006a) lets them through."""
    caller = signup(client, outbox, email, "seeker")
    make_profile(db_engine, _user_id(caller), area_id)
    return caller


@pytest.fixture
def seeker(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> TestClient:
    return _seeker_with_profile(client, outbox, "s@example.com", gush_dan, db_engine)


@pytest.fixture
def owner_id(db_engine: Engine) -> uuid.UUID:
    return make_owner(db_engine, "owner@example.com")


@pytest.fixture
def statements(db_engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement the app engine sends while the test records (`.clear()` to start)."""
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(db_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine, "before_cursor_execute", record)


def test_ac1_seeker_applies_to_live_listing(
    seeker: TestClient, owner_id: uuid.UUID, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing_a = make_listing(db_engine, owner_id, gush_dan)

    response = _apply(seeker, listing_a, "  Hi, we are a quiet couple  ")

    assert response.status_code == 201, response.text
    body = response.json()
    _assert_application_shape(body)
    assert body["status"] == "submitted"
    assert body["message"] == "Hi, we are a quiet couple"
    assert body["listing"] == {
        "id": str(listing_a),
        "listing_type": "apartment",
        "city": "\u05d2\u05d1\u05e2\u05ea\u05d9\u05d9\u05dd",
        "street": "\u05db\u05e6\u05e0\u05dc\u05e1\u05d5\u05df",
        "rooms": 3.5,
        "price_ils": 7200,
    }
    assert type(body["listing"]["rooms"]) is float
    assert str(owner_id) not in response.text
    assert "owner@example.com" not in response.text
    with db_engine.connect() as conn:
        rows = conn.execute(text("SELECT id, seeker_id, listing_id FROM applications")).all()
    assert [(str(r.id), r.seeker_id, r.listing_id) for r in rows] == [
        (body["id"], _user_id(seeker), listing_a)
    ]


def _listing_body(area_id: uuid.UUID) -> dict[str, Any]:
    return {
        "listing_type": "apartment",
        "area_id": str(area_id),
        "city": "\u05d2\u05d1\u05e2\u05ea\u05d9\u05d9\u05dd",
        "street": "\u05db\u05e6\u05e0\u05dc\u05e1\u05d5\u05df",
        "rooms": 3.5,
        "floor": 3,
        "size_sqm": 95,
        "price_ils": 7200,
        "available_from": (dt.date.today() + dt.timedelta(days=30)).isoformat(),
        "elevator": True,
        "furnished": "partial",
        "pets_allowed": True,
        "shelter": "none",
    }


def test_ac2_apartments_need_a_seeker_rooms_anyone(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    """Spec 0010b AC2: any account applies to someone else's room; only a seeker applies to an
    apartment (403 `seeker_only`, checked before the profile and never counted); never the
    caller's own listing; an unknown or non-public id stays the counted 404."""
    lister = signup(client, outbox, "own@example.com", "owner")
    owner = signup(client, outbox, "other@example.com", "owner")
    make_profile(db_engine, _user_id(owner), gush_dan)
    bare_owner = signup(client, outbox, "bare@example.com", "owner")  # no profile
    seeker = _seeker_with_profile(client, outbox, "s@example.com", gush_dan, db_engine)
    created = lister.post("/listings", json=_listing_body(gush_dan))
    assert created.status_code == 201, created.text
    apartment = created.json()["id"]
    room = make_listing(
        db_engine, _user_id(lister), gush_dan, listing_type="room", flatmates_count=2
    )
    paused = make_listing(db_engine, _user_id(lister), gush_dan, status="paused")

    anonymous = _apply(client, apartment)
    assert anonymous.status_code == 401
    assert anonymous.json() == {"detail": "unauthenticated"}

    # An owner applies to someone else's room, lists it and withdraws it.
    applied = _applied(owner, room)
    _assert_application_shape(applied)
    assert _hourly(_user_id(owner)) == 1
    mine = owner.get("/me/applications")
    assert mine.status_code == 200
    assert [item["id"] for item in mine.json()] == [applied["id"]]
    assert _withdraw(owner, applied["id"]).status_code == 200

    # An apartment needs the seeker role: 403 for an owner, with or without a profile (the role
    # is checked first), and the hourly counter does not move.
    for caller in (owner, bare_owner, lister):
        response = _apply(caller, apartment)
        assert response.status_code == 403
        assert response.json() == {"detail": "seeker_only"}
        assert _hourly(_user_id(caller)) == (1 if caller is owner else 0)

    # An unknown id, or a paused apartment, has no public type: the counted 404, never a 403.
    for missing in (uuid.uuid4(), paused):
        response = _apply(owner, missing)
        assert response.status_code == 404
        assert response.json() == NOT_FOUND
    assert _hourly(_user_id(owner)) == 3

    # A seeker still applies to an apartment.
    _applied(seeker, apartment)
    # The caller's own listing, of either type, is never theirs to apply to.
    for own_listing in (
        make_listing(db_engine, _user_id(seeker), gush_dan),
        make_listing(db_engine, _user_id(seeker), gush_dan, listing_type="room", flatmates_count=1),
    ):
        own = _apply(seeker, own_listing)
        assert own.status_code == 404
        assert own.json() == NOT_FOUND

    assert _count(db_engine) == 2  # the owner's withdrawn one and the seeker's


def test_ac3_non_public_listing_is_404(
    seeker: TestClient, owner_id: uuid.UUID, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    with db_engine.begin() as conn:
        closed_area: uuid.UUID = conn.execute(
            text(
                "INSERT INTO areas (slug, name_he, geom, is_active) "
                "VALUES ('closed-area', 'closed', ST_GeomFromText(:wkt, 4326), false) RETURNING id"
            ),
            {"wkt": GUSH_DAN_WKT},
        ).scalar_one()
    an_hour_ago = dt.datetime.now(dt.UTC) - dt.timedelta(hours=1)
    hidden = [
        make_listing(db_engine, owner_id, gush_dan, status="paused"),
        make_listing(db_engine, owner_id, gush_dan, expires_at=an_hour_ago),
        make_listing(db_engine, owner_id, closed_area),
        uuid.uuid4(),
    ]

    responses = [_apply(seeker, listing_id) for listing_id in hidden]

    assert [r.status_code for r in responses] == [404] * len(hidden)
    assert {r.content for r in responses} == {responses[0].content}
    assert responses[0].json() == NOT_FOUND
    assert _count(db_engine) == 0
    assert _apply(seeker, "not-a-uuid").status_code == 422


def test_ac4_one_application_per_seeker_and_listing(
    seeker: TestClient,
    owner_id: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    listing_a = make_listing(db_engine, owner_id, gush_dan)
    first = _applied(seeker, listing_a, "First message")

    again = _apply(seeker, listing_a, "Changed my mind")
    assert again.status_code == 409
    assert again.json() == {"detail": "already_applied"}
    stored = _scalar(db_engine, "SELECT message FROM applications WHERE id = :id", id=first["id"])
    assert stored == "First message"

    for status in ("shortlisted", "declined"):
        _execute(
            db_engine,
            "UPDATE applications SET status = :s WHERE id = :id",
            s=status,
            id=first["id"],
        )
        response = _apply(seeker, listing_a, "Please")
        assert response.status_code == 409, status
        assert response.json() == {"detail": "already_applied"}
        assert _status(db_engine, first["id"]) == status

    # Back to submitted (a decline is final; this only sets up the withdrawal path).
    _execute(
        db_engine, "UPDATE applications SET status = 'submitted' WHERE id = :id", id=first["id"]
    )
    assert _withdraw(seeker, first["id"]).status_code == 200
    reopened = _applied(seeker, listing_a, "Second try")
    assert reopened["id"] == first["id"]
    assert reopened["status"] == "submitted"
    assert reopened["message"] == "Second try"
    assert reopened["source"] == "apply"  # 0008a
    assert dt.datetime.fromisoformat(reopened["created_at"]) > dt.datetime.fromisoformat(
        first["created_at"]
    )
    assert _count(db_engine) == 1

    # Two concurrent applies of one fresh seeker to one fresh listing.
    fresh_seeker = make_seeker(db_engine, "fresh@example.com")
    make_profile(db_engine, fresh_seeker, gush_dan)
    fresh_listing = make_listing(db_engine, owner_id, gush_dan)
    real_upsert = applications_service._upsert

    def slow_upsert(
        db: Session, listing: Listing, seeker_id: uuid.UUID, message: str
    ) -> Application | None:
        application = real_upsert(db, listing, seeker_id, message)
        time.sleep(0.3)  # hold the uncommitted row so the other INSERT waits on it
        return application

    monkeypatch.setattr(applications_service, "_upsert", slow_upsert)
    start = threading.Barrier(2, timeout=10)
    outcomes: list[str] = []

    def apply() -> None:
        with get_sessionmaker()() as db:
            user = db.get(User, fresh_seeker)
            assert user is not None
            start.wait()
            try:
                applications_service.apply(db, get_redis(), user, fresh_listing, "Hello")
                outcomes.append("201")
            except applications_service.AlreadyAppliedError:
                outcomes.append("409")
            except Exception as exc:  # pragma: no cover - reported by the assertion below
                outcomes.append(repr(exc))

    threads = [threading.Thread(target=apply) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)

    assert sorted(outcomes) == ["201", "409"]
    rows = _scalar(
        db_engine,
        "SELECT count(*) FROM applications WHERE listing_id = :l AND seeker_id = :s",
        l=fresh_listing,
        s=fresh_seeker,
    )
    assert rows == 1


# A blank message ("", "   ") is no message since spec 0010l (`test_ac2_apartment_needs_message`).
_BAD_MESSAGES: list[tuple[str, Any]] = [
    ("too long", "x" * 501),
    ("no letter or digit", "..."),
    ("bidi override", "hi\u202ethere"),
    ("zero-width only", "\u200b\u200b"),
    ("hangul filler", "a\u3164b"),
    ("five combining marks", "\u05d0" + "\u05b8" * 5),
]


def _assert_clean_422(response: httpx.Response, loc: list[str]) -> None:
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert isinstance(detail, list) and detail
    for entry in detail:
        assert entry["loc"] == loc
        assert "input" not in entry


def test_ac5_message_text_rules(
    seeker: TestClient, owner_id: uuid.UUID, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing_a = make_listing(db_engine, owner_id, gush_dan)
    url = f"/listings/{listing_a}/applications"

    for name, message in _BAD_MESSAGES:
        response = _apply(seeker, listing_a, message)
        assert response.status_code == 422, name
        _assert_clean_422(response, ["body", "message"])
    _assert_clean_422(seeker.post(url, json="just a string"), ["body"])
    assert _count(db_engine) == 0

    longest = _applied(seeker, listing_a, "x" * 500)
    assert longest["message"] == "x" * 500

    listing_b = make_listing(db_engine, owner_id, gush_dan)
    crlf = _applied(seeker, listing_b, "line one\r\nline two")
    assert crlf["message"] == "line one\nline two"
    stored = _scalar(db_engine, "SELECT message FROM applications WHERE id = :id", id=crlf["id"])
    assert stored == "line one\nline two"


def test_ac6_my_applications_own_only_newest_first(
    client: TestClient,
    seeker: TestClient,
    outbox: Outbox,
    owner_id: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    statements: list[str],
) -> None:
    listing_a, listing_b, listing_c = (make_listing(db_engine, owner_id, gush_dan) for _ in "abc")
    app_a = _applied(seeker, listing_a)["id"]
    assert _withdraw(seeker, app_a).status_code == 200
    app_b = _applied(seeker, listing_b)["id"]
    _execute(db_engine, "UPDATE listings SET status = 'paused' WHERE id = :id", id=listing_b)
    app_c = _applied(seeker, listing_c)["id"]
    _execute(db_engine, "UPDATE applications SET status = 'declined' WHERE id = :id", id=app_c)
    for application_id, seconds in ((app_a, 3), (app_b, 2), (app_c, 1)):
        _execute(
            db_engine,
            "UPDATE applications SET created_at = now() - make_interval(secs => :s) WHERE id = :id",
            s=seconds,
            id=application_id,
        )
    make_application(db_engine, listing_a, make_seeker(db_engine, "other@example.com"))

    response = seeker.get("/me/applications")

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == [app_c, app_b, app_a]
    assert [item["status"] for item in body] == ["declined", "submitted", "withdrawn"]
    for item in body:
        _assert_application_shape(item)
    assert str(owner_id) not in response.text

    seeker.get("/me/applications")  # warm-up: a first connect sends its own setup statements
    statements.clear()
    measured = seeker.get("/me/applications")
    sent = list(statements)
    assert measured.status_code == 200
    assert len(sent) == 2, sent
    assert sum("FROM applications" in statement for statement in sent) == 1

    fresh = signup(client, outbox, "fresh@example.com", "seeker")
    assert fresh.get("/me/applications").json() == []
    anonymous = client.get("/me/applications")
    assert anonymous.status_code == 401
    assert anonymous.json() == {"detail": "unauthenticated"}
    # Spec 0010b: any account lists its own applications; an owner with none gets [].
    owner = signup(client, outbox, "o@example.com", "owner")
    own_only = owner.get("/me/applications")
    assert own_only.status_code == 200
    assert own_only.json() == []


def test_ac7_withdraw_own_application(
    client: TestClient,
    seeker: TestClient,
    outbox: Outbox,
    owner_id: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    listing_x, listing_s, listing_d = (make_listing(db_engine, owner_id, gush_dan) for _ in "xsd")
    x = _applied(seeker, listing_x)

    withdrawn = _withdraw(seeker, x["id"])
    assert withdrawn.status_code == 200
    body = withdrawn.json()
    _assert_application_shape(body)
    assert body["status"] == "withdrawn"
    assert body["id"] == x["id"]
    assert dt.datetime.fromisoformat(body["updated_at"]) > dt.datetime.fromisoformat(
        x["updated_at"]
    )
    again = _withdraw(seeker, x["id"])
    assert again.status_code == 409
    assert again.json() == {"detail": "not_withdrawable"}

    shortlisted = _applied(seeker, listing_s)["id"]
    _execute(
        db_engine, "UPDATE applications SET status = 'shortlisted' WHERE id = :id", id=shortlisted
    )
    _execute(db_engine, "UPDATE listings SET status = 'paused' WHERE id = :id", id=listing_s)
    from_shortlist = _withdraw(seeker, shortlisted)
    assert from_shortlist.status_code == 200
    assert from_shortlist.json()["status"] == "withdrawn"

    declined = make_application(db_engine, listing_d, _user_id(seeker), status="declined")
    refused = _withdraw(seeker, declined)
    assert refused.status_code == 409
    assert refused.json() == {"detail": "not_withdrawable"}
    assert _status(db_engine, declined) == "declined"

    others = make_application(db_engine, listing_x, make_seeker(db_engine, "other@example.com"))
    not_mine = _withdraw(seeker, others)
    unknown = _withdraw(seeker, uuid.uuid4())
    assert (not_mine.status_code, unknown.status_code) == (404, 404)
    assert not_mine.content == unknown.content
    assert not_mine.json() == NOT_FOUND
    assert _status(db_engine, others) == "submitted"

    assert _withdraw(client, others).status_code == 401
    # Spec 0010b: an owner withdrawing another account's application is the unknown id's 404.
    owner = signup(client, outbox, "o@example.com", "owner")
    not_theirs = _withdraw(owner, others)
    assert not_theirs.status_code == 404
    assert not_theirs.json() == NOT_FOUND
    assert _withdraw(seeker, "not-a-uuid").status_code == 422
    assert _status(db_engine, others) == "submitted"


def test_ac8_applicant_count_and_view_counter(
    client: TestClient,
    owner_id: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    statements: list[str],
) -> None:
    listing_a = make_listing(db_engine, owner_id, gush_dan)
    paused = make_listing(db_engine, owner_id, gush_dan, status="paused")
    for status in ("submitted", "shortlisted", "declined", "withdrawn"):
        applicant = make_seeker(db_engine, f"{status}@example.com")
        make_application(db_engine, listing_a, applicant, status=status)
    assert _view_count(db_engine, listing_a) == 0

    response = client.get(f"/listings/{listing_a}")

    assert response.status_code == 200
    body = response.json()
    # `like`: 0008a; `photos`: 0010d
    assert set(body) == PUBLIC_KEYS | {"applicant_count", "room_fit", "like", "photos", "people"}
    assert body["applicant_count"] == 3
    assert client.get(f"/listings/{listing_a}").status_code == 200

    for missing in (paused, uuid.uuid4()):
        assert client.get(f"/listings/{missing}").status_code == 404

    search = client.get("/listings")
    assert search.status_code == 200
    assert [set(item) for item in search.json()["items"]] == [PUBLIC_KEYS]
    # Spec 0011e: views reach `view_count` through the worker's flush, one per viewer per hour.
    with get_sessionmaker()() as db:
        assert listing_views.flush_views(db, get_redis()) == 1
    assert _view_count(db_engine, listing_a) == 1
    assert _view_count(db_engine, paused) == 0

    client.get(f"/listings/{listing_a}")  # warm-up: a first connect sends its own setup statements
    statements.clear()
    measured = client.get(f"/listings/{listing_a}")
    sent = list(statements)
    assert measured.status_code == 200
    assert measured.json()["applicant_count"] == 3
    assert len(sent) == 3, sent
    assert "FROM listings" in sent[0]
    assert "FROM applications" in sent[1]
    assert "FROM listing_photos" in sent[2]  # spec 0010d: the photos, last


def _hourly(seeker_id: uuid.UUID) -> int:
    value = get_redis().get(f"rl:apply:user:{seeker_id}")
    return int(value) if value is not None else 0


def test_ac9_apply_rate_limits(
    client: TestClient,
    seeker: TestClient,
    outbox: Outbox,
    owner_id: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    listings = [make_listing(db_engine, owner_id, gush_dan) for _ in range(11)]
    for listing_id in listings[:10]:
        _applied(seeker, listing_id)

    limited = _apply(seeker, listings[10])
    assert limited.status_code == 429
    assert limited.json() == {"detail": "rate_limited"}
    assert 1 <= int(limited.headers["Retry-After"]) <= 3600
    assert _count(db_engine) == 10

    other = _seeker_with_profile(client, outbox, "other@example.com", gush_dan, db_engine)
    _applied(other, listings[10])

    daily = _seeker_with_profile(client, outbox, "daily@example.com", gush_dan, db_engine)
    daily_id = _user_id(daily)
    get_redis().set(f"rl:apply:user:day:{daily_id}", 30, ex=3600)
    assert _hourly(daily_id) == 0
    day_limited = _apply(daily, listings[0])
    assert day_limited.status_code == 429
    assert day_limited.json() == {"detail": "rate_limited"}

    counted = _seeker_with_profile(client, outbox, "counted@example.com", gush_dan, db_engine)
    counted_id = _user_id(counted)
    assert _apply(counted, listings[0], "").status_code == 422
    assert _hourly(counted_id) == 0
    assert _apply(client, listings[0]).status_code == 401
    assert _hourly(counted_id) == 0
    owner = signup(client, outbox, "o@example.com", "owner")
    assert _apply(owner, listings[0]).status_code == 403
    assert _hourly(_user_id(owner)) == 0
    assert _apply(counted, uuid.uuid4()).status_code == 404
    assert _hourly(counted_id) == 1
    _applied(counted, listings[1])
    assert _hourly(counted_id) == 2
    assert _apply(counted, listings[1]).status_code == 409
    assert _hourly(counted_id) == 3


def _profile_body(area_id: uuid.UUID) -> dict[str, Any]:
    """`P` (spec 0006a): a valid housing profile, move-in 30 days after today (UTC)."""
    return {
        "budget_max_ils": 7500,
        "move_in_date": (dt.datetime.now(dt.UTC).date() + dt.timedelta(days=30)).isoformat(),
        "move_in_flexible": False,
        "area_ids": [str(area_id)],
        "household": "couple",
        "has_pets": False,
        "smoker": False,
        "contract_months": 24,
        "parking_needed": 1,
    }


def test_ac5_apply_requires_profile(
    client: TestClient,
    outbox: Outbox,
    owner_id: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    listing_l = make_listing(db_engine, owner_id, gush_dan)
    no_profile = signup(client, outbox, "s@example.com", "seeker")
    seeker_id = _user_id(no_profile)

    refused = _apply(no_profile, listing_l)

    assert refused.status_code == 409
    assert refused.json() == {"detail": "seeker_profile_required"}
    assert _count(db_engine) == 0
    r = get_redis()
    assert not r.exists(f"rl:apply:user:{seeker_id}")
    assert not r.exists(f"rl:apply:user:day:{seeker_id}")
    # Checked before the listing lookup: an unknown listing is the same 409, not a 404.
    assert _apply(no_profile, uuid.uuid4()).json() == {"detail": "seeker_profile_required"}

    saved = no_profile.put("/me/profile", json=_profile_body(gush_dan))
    assert saved.status_code == 200, saved.text
    applied = _apply(no_profile, listing_l)
    assert applied.status_code == 201, applied.text
    assert _count(db_engine) == 1
    assert _hourly(seeker_id) == 1


def test_ac4_personal_only_cannot_apply(
    client: TestClient,
    outbox: Outbox,
    owner_id: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    """Spec 0010c AC4: a personal-only profile counts as no profile at the apply gate."""
    listing_l = make_listing(db_engine, owner_id, gush_dan)
    personal = signup(client, outbox, "s@example.com", "seeker")
    seeker_id = _user_id(personal)
    make_profile(db_engine, seeker_id, gush_dan, gender="woman", **NO_LOOKING)

    refused = _apply(personal, listing_l)

    assert refused.status_code == 409
    assert refused.json() == {"detail": "seeker_profile_required"}
    assert _count(db_engine) == 0
    assert not get_redis().exists(f"rl:apply:user:{seeker_id}")

    saved = personal.put("/me/profile", json={**_profile_body(gush_dan), "gender": "woman"})
    assert saved.status_code == 200, saved.text
    assert _apply(personal, listing_l).status_code == 201


def test_ac6_existing_application_needs_no_profile(
    client: TestClient,
    outbox: Outbox,
    owner_id: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    listing_a = make_listing(db_engine, owner_id, gush_dan)
    no_profile = signup(client, outbox, "s@example.com", "seeker")
    # Made as before Slice 6: no profile was needed then.
    application_id = make_application(db_engine, listing_a, _user_id(no_profile))

    withdrawn = _withdraw(no_profile, application_id)
    listed = no_profile.get("/me/applications")

    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["status"] == "withdrawn"
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [str(application_id)]
    assert _scalar(db_engine, "SELECT count(*) FROM seeker_profiles") == 0


# --- 0010l: one room interest ------------------------------------------------------------------

Published = list[tuple[set[uuid.UUID], uuid.UUID, str]]


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> Published:
    """Every `chat_events.publish` call, as (user ids, conversation id, kind); nothing is sent."""
    calls: Published = []

    def record(_r: Any, user_ids: Any, conversation_id: uuid.UUID, kind: str) -> None:
        calls.append((set(user_ids), conversation_id, kind))

    monkeypatch.setattr(chat_events, "publish", record)
    return calls


def _invited(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    lister: TestClient,
    room: str,
    area: uuid.UUID,
    email: str,
    name: str,
) -> TestClient:
    """A seeker on `room`'s people page whom its lister liked (an invite, spec 0010l)."""
    caller = people_tests._seeker(client, outbox, db_engine, area, email, name)
    person = people_tests._card(lister, room, name)["id"]
    assert people_tests._ok(people_tests._like_person(lister, room, person)) == {"liked": True}
    return caller


def test_ac1_room_apply_without_message(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    """Spec 0010l AC1: on a room the message is optional (absent, null or blank is none)."""
    lister = signup(client, outbox, "o@example.com", "owner")
    rooms = [people_tests._room(db_engine, _user_id(lister), gush_dan) for _ in range(3)]
    seeker = people_tests._seeker(client, outbox, db_engine, gush_dan, "s@example.com", "Avi")

    for room, body in zip(rooms, ({}, {"message": None}, {"message": "   "}), strict=True):
        response = seeker.post(f"/listings/{room}/applications", json=body)
        assert response.status_code == 201, (body, response.text)
        applied = response.json()
        _assert_application_shape(applied)
        assert (applied["status"], applied["source"], applied["message"]) == (
            "submitted",
            "apply",
            None,
        )
        stored = _scalar(
            db_engine, "SELECT message FROM applications WHERE id = :id", id=applied["id"]
        )
        assert stored is None
        [applicant] = people_tests._ok(lister.get(f"/listings/{room}/applications"))
        assert (applicant["source"], applicant["message"]) == ("apply", None)
    assert _scalar(db_engine, "SELECT count(*) FROM conversations") == 0
    assert _hourly(_user_id(seeker)) == 3


def test_ac2_apartment_needs_message(
    client: TestClient,
    seeker: TestClient,
    outbox: Outbox,
    owner_id: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    """Spec 0010l AC2: a public apartment without a message is a 422 `message_required` (a string
    detail), with no row and no rate-limit count; a non-public one is the counted 404."""
    apartment = make_listing(db_engine, owner_id, gush_dan)
    url = f"/listings/{apartment}/applications"
    for body in ({}, {"message": None}, {"message": ""}, {"message": "   "}):
        response = seeker.post(url, json=body)
        assert response.status_code == 422, (body, response.text)
        assert response.json() == {"detail": "message_required"}
    assert _count(db_engine) == 0
    assert _hourly(_user_id(seeker)) == 0

    # The role goes first (spec 0010b): a non-seeker gets the 403, as with a message.
    owner = signup(client, outbox, "o@example.com", "owner")
    assert owner.post(url, json={}).json() == {"detail": "seeker_only"}
    # A paused apartment reveals nothing: the unknown id's counted 404.
    paused = make_listing(db_engine, owner_id, gush_dan, status="paused")
    hidden = seeker.post(f"/listings/{paused}/applications", json={})
    assert hidden.status_code == 404
    assert hidden.json() == NOT_FOUND
    assert _hourly(_user_id(seeker)) == 1

    assert _applied(seeker, apartment, "Hello there")["message"] == "Hello there"


def test_ac3_apply_answers_invite(
    client: TestClient,
    outbox: Outbox,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    published: Published,
) -> None:
    """Spec 0010l AC3: an application to a room whose lister liked the caller is shortlisted at
    once, `source: 'like'`, the message as sent, at the pair's frozen price, with its chat open
    (the seeker's marker set, the lister's not) and one `status` event to the lister, the
    flatmates and the seeker; the invite is consumed. With and without a message; the room has a
    flatmate (replaces 0008d's `test_ac10_mutual_match_includes_flatmates`)."""
    lister = signup(client, outbox, "o@example.com", "owner", display_name="Noa")
    lister_id = _user_id(lister)
    room = people_tests._room(db_engine, lister_id, gush_dan)
    mate_id = make_seeker(db_engine, "f@example.com", "Fay")
    make_flatmate(db_engine, uuid.UUID(room), mate_id)
    with_message = _invited(client, outbox, db_engine, lister, room, gush_dan, "a@ex.com", "Avi")
    without = _invited(client, outbox, db_engine, lister, room, gush_dan, "b@ex.com", "Bat")
    # The pairs froze 7000 at browse; the live price moves after.
    _execute(db_engine, "UPDATE listings SET price_ils = 6500 WHERE id = :id", id=room)

    for caller, body, message in (
        (with_message, {"message": "  Hi, I'm in  "}, "Hi, I'm in"),
        (without, {}, None),
    ):
        caller_id = _user_id(caller)
        published.clear()
        response = caller.post(f"/listings/{room}/applications", json=body)
        assert response.status_code == 201, response.text
        applied = response.json()
        assert (applied["status"], applied["source"], applied["message"]) == (
            "shortlisted",
            "like",
            message,
        )
        x = applied["id"]
        row = people_tests._application(db_engine, x)
        assert (row.status, row.source, row.message) == ("shortlisted", "like", message)
        assert (row.price_ils_at_apply, row.listing_type_at_apply) == (7000, "room")
        conversation = people_tests._conversation(db_engine, x)
        assert conversation is not None
        assert (conversation.owner_id, conversation.seeker_id) == (lister_id, caller_id)
        assert conversation.seeker_read_at is not None
        assert conversation.owner_read_at is None
        assert people_tests._pair(db_engine, room, caller_id).lister_liked_at is None
        assert published == [({lister_id, caller_id, mate_id}, uuid.UUID(x), "status")]

        mine = people_tests._ok(caller.get("/me/conversations"))
        assert [(item["id"], item["can_send"]) for item in mine] == [(x, True)]
        lister_item = next(
            item for item in people_tests._ok(lister.get("/me/conversations")) if item["id"] == x
        )
        assert lister_item["is_new"] is True
        assert people_tests._likes(caller) == []

    inbox = people_tests._ok(lister.get(f"/listings/{room}/applications"))
    assert sorted((item["source"], item["status"], item["message"] or "") for item in inbox) == [
        ("like", "shortlisted", ""),
        ("like", "shortlisted", "Hi, I'm in"),
    ]
    assert _scalar(db_engine, "SELECT count(*) FROM conversations") == 2


def test_ac4_reapply_after_invite_withdrawn(
    client: TestClient,
    outbox: Outbox,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    published: Published,
) -> None:
    """Spec 0010l AC4: the application consumed the invite, so after a withdraw the seeker's next
    application is a plain one (`submitted`, `source: 'apply'`, the live price)."""
    lister = signup(client, outbox, "o@example.com", "owner")
    room = people_tests._room(db_engine, _user_id(lister), gush_dan)
    seeker = _invited(client, outbox, db_engine, lister, room, gush_dan, "a@ex.com", "Avi")
    x = people_tests._apply(seeker, room)["id"]
    _execute(db_engine, "UPDATE listings SET price_ils = 6500 WHERE id = :id", id=room)
    assert _withdraw(seeker, x).status_code == 200
    published.clear()

    again = _applied(seeker, room, "Still keen")
    assert (again["id"], again["status"], again["source"], again["message"]) == (
        x,
        "submitted",
        "apply",
        "Still keen",
    )
    assert people_tests._application(db_engine, x).price_ils_at_apply == 6500
    assert published == []  # a submitted apply publishes nothing


def _run_named(calls: dict[str, Callable[[], str]]) -> dict[str, str]:
    """Run each call in its own thread named after its key; return the outcomes by name ("409"
    for `AlreadyAppliedError`, the exception's repr for anything else)."""
    outcomes = dict.fromkeys(calls, "")

    def run(name: str, call: Callable[[], str]) -> None:
        try:
            outcomes[name] = call()
        except applications_service.AlreadyAppliedError:
            outcomes[name] = "409"
        except Exception as exc:  # pragma: no cover - reported by the assertions
            outcomes[name] = repr(exc)

    threads = [
        threading.Thread(target=run, args=(name, call), name=name) for name, call in calls.items()
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=20)
    return outcomes


def _like_call(owner_id: uuid.UUID, room: str, person: uuid.UUID) -> Callable[[], str]:
    def call() -> str:
        with get_sessionmaker()() as db:
            user = db.get(User, owner_id)
            assert user is not None
            db.rollback()
            people_service.like_person(db, get_redis(), user, uuid.UUID(room), person)
            return "liked"

    return call


def _apply_call(seeker_id: uuid.UUID, room: str) -> Callable[[], str]:
    def call() -> str:
        with get_sessionmaker()() as db:
            user = db.get(User, seeker_id)
            assert user is not None
            db.rollback()
            application, _ = applications_service.apply(
                db, get_redis(), user, uuid.UUID(room), None
            )
            return application.status

    return call


def test_ac5_apply_racing_lister_like(
    owner_id: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Spec 0010l AC5 (replaces 0008a's `test_ac8_apply_racing_a_lister_like`): the lister's like
    and the seeker's apply on an existing pair, in both lock orders, 20 rounds: no deadlock,
    exactly one application, a shortlisted one has its conversation, and the invite is never left
    on the pair next to an application. The second side starts only once the first holds the
    pair's lock (an event, not a head start); the first holds it a moment so the second waits."""
    real_has_application = people_service._has_application
    real_consume_invite = people_service.consume_invite
    held = threading.Event()

    def holding(first: str) -> None:
        if threading.current_thread().name == first:
            held.set()
            time.sleep(0.1)  # still holding the pair's lock: the other side queues behind it

    def has_application(db: Session, listing_id: uuid.UUID, seeker_id: uuid.UUID) -> bool:
        holding("lister")  # runs after the like's UPDATE took the pair's lock
        return real_has_application(db, listing_id, seeker_id)

    def consume_invite(db: Session, listing_id: uuid.UUID, seeker_id: uuid.UUID) -> Any:
        pair = real_consume_invite(db, listing_id, seeker_id)
        holding("apply")  # the apply holds the pair's lock, before its application row
        return pair

    monkeypatch.setattr(people_service, "_has_application", has_application)
    monkeypatch.setattr(people_service, "consume_invite", consume_invite)

    def after_held(call: Callable[[], str]) -> Callable[[], str]:
        def second() -> str:
            assert held.wait(10)
            return call()

        return second

    # first -> the outcomes: the first to take the pair's lock wins.
    expected = {"lister": {"lister": "liked", "apply": "shortlisted"}}
    expected["apply"] = {"lister": "409", "apply": "submitted"}
    for n in range(20):
        first = "lister" if n % 2 == 0 else "apply"
        held.clear()
        get_redis().delete(f"rl:like:user:{owner_id}", f"rl:like:user:day:{owner_id}")
        room = people_tests._room(db_engine, owner_id, gush_dan)
        a = make_seeker(db_engine, f"a{n}@example.com", "Avi")
        people_tests._visible(db_engine, a, gush_dan)
        person = make_pair(db_engine, uuid.UUID(room), a, price_ils_seen=7000)
        like, applying = _like_call(owner_id, room, person), _apply_call(a, room)
        outcomes = _run_named(
            {
                "lister": like if first == "lister" else after_held(like),
                "apply": applying if first == "apply" else after_held(applying),
            }
        )
        assert outcomes == expected[first], (n, first, outcomes)
        applications = "SELECT count(*) FROM applications WHERE listing_id = :l"
        assert _scalar(db_engine, applications, l=room) == 1
        conversations = (
            "SELECT count(*) FROM conversations c JOIN applications a ON a.id = c.application_id"
            " WHERE a.listing_id = :l"
        )
        shortlisted = outcomes["apply"] == "shortlisted"
        assert _scalar(db_engine, conversations, l=room) == (1 if shortlisted else 0)
        assert people_tests._pair(db_engine, room, a).lister_liked_at is None


def test_ac5_invite_never_outlives_an_apply(
    client: TestClient,
    outbox: Outbox,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Spec 0010l AC5 (security review): an apply that started before the pair existed. It finds
    no pair and stalls before its application row; meanwhile the lister's browse creates the pair
    and the lister likes it. The like waits on the (listing, seeker) key until the apply commits,
    then gets 409: never a submitted application beside a live invite (which a later re-apply
    would turn into a chat without a fresh like)."""
    lister = signup(client, outbox, "o@example.com", "owner")
    lister_id = _user_id(lister)
    room = people_tests._room(db_engine, lister_id, gush_dan)
    seeker = people_tests._seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")
    seeker_id = _user_id(seeker)
    assert people_tests._pair(db_engine, room, seeker_id) is None

    real_consume_invite = people_service.consume_invite
    held, go = threading.Event(), threading.Event()

    def stalled(db: Session, listing_id: uuid.UUID, seeker: uuid.UUID) -> Any:
        pair = real_consume_invite(db, listing_id, seeker)
        held.set()
        assert go.wait(10)
        return pair

    monkeypatch.setattr(people_service, "consume_invite", stalled)
    outcomes: dict[str, str] = {}
    applying = threading.Thread(
        target=lambda: outcomes.update(_run_named({"apply": _apply_call(seeker_id, room)}))
    )
    applying.start()
    assert held.wait(10)

    # The apply found no pair; the lister's browse creates it now, and the lister likes it.
    person = people_tests._card(lister, room, "Avi")["id"]
    liking = threading.Thread(
        target=lambda: outcomes.update(
            _run_named({"lister": _like_call(lister_id, room, uuid.UUID(person))})
        )
    )
    liking.start()
    liking.join(timeout=0.5)
    assert liking.is_alive(), outcomes  # waits on the (listing, seeker) key the apply holds
    go.set()
    applying.join(timeout=20)
    liking.join(timeout=20)

    assert outcomes == {"apply": "submitted", "lister": "409"}
    assert people_tests._pair(db_engine, room, seeker_id).lister_liked_at is None
    assert _count(db_engine) == 1


def test_ac11_status_change_cancels_tour(
    client: TestClient,
    outbox: Outbox,
    seeker: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    published: Published,
) -> None:
    # Spec 0018a AC11: un-shortlisting, declining and withdrawing each cancel that application's
    # upcoming tour (`system`), with a line from whoever acted; other applications' tours stay.
    lister = signup(client, outbox, "own@example.com", "owner")
    owner_id = uuid.UUID(lister.get("/me").json()["id"])
    listing = make_listing(db_engine, owner_id, gush_dan)
    now = tours_tests.db_now(db_engine)
    seekers = {
        "unshortlist": make_seeker(db_engine, "a@example.com", "Avi"),
        "decline": make_seeker(db_engine, "b@example.com", "Ben"),
        "withdraw": uuid.UUID(seeker.get("/me").json()["id"]),
        "untouched": make_seeker(db_engine, "c@example.com", "Cai"),
    }
    applications, tour_ids = {}, {}
    for i, (name, seeker_id) in enumerate(seekers.items()):
        applications[name] = tours_tests.shortlisted(db_engine, listing, seeker_id, owner_id)
        tour_ids[name] = tours_tests.make_tour(
            db_engine, listing, applications[name], seeker_id, now + dt.timedelta(hours=3 + i)
        )

    def patch(name: str, status: str) -> None:
        response = lister.patch(
            f"/listings/{listing}/applications/{applications[name]}", json={"status": status}
        )
        assert response.status_code == 200, response.text

    patch("unshortlist", "submitted")
    patch("decline", "declined")
    assert _withdraw(seeker, applications["withdraw"]).status_code == 200
    for name, actor in (("unshortlist", owner_id), ("decline", owner_id), ("withdraw", None)):
        row = tours_tests.tour_row(db_engine, tour_ids[name])
        assert (row.status, row.cancelled_by) == ("cancelled", "system"), name
        lines = _scalar(
            db_engine,
            "SELECT array_agg(tour_change) FROM messages WHERE tour_id = :t AND sender_id = :s",
            t=tour_ids[name],
            s=actor or seekers[name],
        )
        assert lines == ["cancelled_by_system"], name
        assert ({owner_id, seekers[name]}, applications[name], "message") in published, name
    assert tours_tests.tour_row(db_engine, tour_ids["untouched"]).status == "booked"
