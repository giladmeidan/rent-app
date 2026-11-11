"""Seeker applications API, applicant count and view counter (spec 0004a): AC1-AC9."""

import datetime as dt
import threading
import time
import uuid
from collections.abc import Iterator
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
from scripts.seed import GUSH_DAN_WKT
from tests.conftest import (
    Outbox,
    make_application,
    make_listing,
    make_owner,
    make_profile,
    make_seeker,
    signup,
)
from tests.test_search import PUBLIC_KEYS

pytestmark = pytest.mark.usefixtures("redis_clean")

APPLICATION_KEYS = {"id", "status", "message", "created_at", "updated_at", "listing"}
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
    }


def test_ac2_only_seekers_apply_never_to_own_listing(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    own_owner = signup(client, outbox, "own@example.com", "owner")
    other_owner = signup(client, outbox, "other@example.com", "owner")
    seeker = _seeker_with_profile(client, outbox, "s@example.com", gush_dan, db_engine)
    created = own_owner.post("/listings", json=_listing_body(gush_dan))
    assert created.status_code == 201, created.text
    listing_a = created.json()["id"]

    anonymous = _apply(client, listing_a)
    assert anonymous.status_code == 401
    assert anonymous.json() == {"detail": "unauthenticated"}
    for owner in (other_owner, own_owner):
        response = _apply(owner, listing_a)
        assert response.status_code == 403
        assert response.json() == {"detail": "seeker_only"}

    # A listing owned by the seeker (their role switched later) is never theirs to apply to.
    listing_b = make_listing(db_engine, _user_id(seeker), gush_dan)
    own = _apply(seeker, listing_b)
    assert own.status_code == 404
    assert own.json() == NOT_FOUND

    assert _count(db_engine) == 0


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


_BAD_MESSAGES: list[tuple[str, Any]] = [
    ("spaces", "   "),
    ("empty", ""),
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
    _assert_clean_422(seeker.post(url, json={}), ["body", "message"])
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
    owner = signup(client, outbox, "o@example.com", "owner")
    forbidden = owner.get("/me/applications")
    assert forbidden.status_code == 403
    assert forbidden.json() == {"detail": "seeker_only"}


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
    owner = signup(client, outbox, "o@example.com", "owner")
    forbidden = _withdraw(owner, others)
    assert forbidden.status_code == 403
    assert forbidden.json() == {"detail": "seeker_only"}
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
    assert set(body) == PUBLIC_KEYS | {"applicant_count", "room_fit"}
    assert body["applicant_count"] == 3
    assert _view_count(db_engine, listing_a) == 1
    assert client.get(f"/listings/{listing_a}").status_code == 200
    assert _view_count(db_engine, listing_a) == 2

    for missing in (paused, uuid.uuid4()):
        assert client.get(f"/listings/{missing}").status_code == 404
    assert _view_count(db_engine, paused) == 0
    assert _view_count(db_engine, listing_a) == 2

    search = client.get("/listings")
    assert search.status_code == 200
    assert [set(item) for item in search.json()["items"]] == [PUBLIC_KEYS]
    assert _view_count(db_engine, listing_a) == 2

    client.get(f"/listings/{listing_a}")  # warm-up: a first connect sends its own setup statements
    statements.clear()
    measured = client.get(f"/listings/{listing_a}")
    sent = list(statements)
    assert measured.status_code == 200
    assert measured.json()["applicant_count"] == 3
    assert len(sent) == 3, sent
    assert "FROM listings" in sent[0]
    assert "FROM applications" in sent[1]
    assert sent[2].lstrip().startswith("UPDATE listings")


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
