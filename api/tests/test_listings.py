"""Owner listings API (spec 0002a): AC1-AC9."""

import datetime as dt
import json
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
from app.models import User
from app.schemas.listing import ListingIn
from app.services import listings as listings_service
from tests.conftest import Outbox, signup

pytestmark = pytest.mark.usefixtures("redis_clean")


def _body(area_id: uuid.UUID, **overrides: Any) -> dict[str, Any]:
    """The AC1 body: a full valid apartment listing."""
    body: dict[str, Any] = {
        "listing_type": "apartment",
        "area_id": str(area_id),
        "city": " גבעתיים ",
        "street": "כצנלסון",
        "rooms": 3.5,
        "floor": 3,
        "total_floors": 5,
        "size_sqm": 95,
        "price_ils": 7200,
        "available_from": (dt.date.today() + dt.timedelta(days=30)).isoformat(),
        "entry_flexible": True,
        "elevator": True,
        "parking_spots": 1,
        "furnished": "partial",
        "pets_allowed": True,
        "arnona_ils": 480,
        "vaad_ils": 150,
        "description": "דירה מוארת",
    }
    body.update(overrides)
    return body


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _create(owner: TestClient, area_id: uuid.UUID, **overrides: Any) -> dict[str, Any]:
    response = owner.post("/listings", json=_body(area_id, **overrides))
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


def _patch(owner: TestClient, listing_id: str, body: dict[str, Any]) -> httpx.Response:
    response: httpx.Response = owner.patch(f"/listings/{listing_id}", json=body)
    return response


def _row(engine: Engine, listing_id: str) -> dict[str, Any]:
    with engine.connect() as conn:
        return dict(
            conn.execute(text("SELECT * FROM listings WHERE id = :id"), {"id": listing_id})
            .mappings()
            .one()
        )


def _count(engine: Engine) -> int:
    count: int = _scalar(engine, "SELECT count(*) FROM listings")
    return count


@pytest.fixture
def owner(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "owner@example.com", "owner")


def test_ac1_owner_creates_listing(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    response = owner.post("/listings", json=_body(gush_dan))

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "active"
    assert body["rooms"] == 3.5
    assert body["city"] == "גבעתיים"
    assert body["owner_id"] == owner.get("/me").json()["id"]
    assert body["area_id"] == str(gush_dan)
    assert (body["price_ils"], body["arnona_ils"], body["vaad_ils"], body["size_sqm"]) == (
        7200,
        480,
        150,
        95,
    )
    created = dt.datetime.fromisoformat(body["created_at"])
    expires = dt.datetime.fromisoformat(body["expires_at"])
    assert dt.timedelta(days=29) <= expires - created <= dt.timedelta(days=31)
    assert _count(db_engine) == 1
    row = _row(db_engine, body["id"])
    assert str(row["rooms"]) == "3.5"
    assert row["city"] == "גבעתיים"


def test_ac2_requires_owner_session(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    some_id = uuid.uuid4()

    def calls(c: TestClient) -> list[httpx.Response]:
        return [
            c.post("/listings", json=_body(gush_dan)),
            c.get("/me/listings"),
            c.patch(f"/listings/{some_id}", json={"price_ils": 7000}),
        ]

    for response in calls(client):
        assert response.status_code == 401
        assert response.json() == {"detail": "unauthenticated"}

    seeker = signup(client, outbox, "seeker@example.com", "seeker")
    for response in calls(seeker):
        assert response.status_code == 403
        assert response.json() == {"detail": "owner_only"}
    assert _count(db_engine) == 0


def test_ac3_cap_counts_live_listings_only(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listings = [_create(owner, gush_dan) for _ in range(3)]

    response = owner.post("/listings", json=_body(gush_dan))
    assert response.status_code == 409
    assert response.json() == {"detail": "listing_cap_reached"}
    assert _count(db_engine) == 3

    assert _patch(owner, listings[0]["id"], {"status": "paused"}).status_code == 200
    _create(owner, gush_dan)  # 3 live, 1 paused

    _execute(db_engine, "UPDATE users SET listing_cap = 5")
    _create(owner, gush_dan)  # 4 live
    _create(owner, gush_dan)  # 5 live: at the raised cap
    assert owner.post("/listings", json=_body(gush_dan)).status_code == 409

    _execute(
        db_engine,
        "UPDATE listings SET expires_at = now() - interval '1 second' WHERE id = :id",
        id=listings[1]["id"],
    )
    assert owner.post("/listings", json=_body(gush_dan)).status_code == 201
    assert _count(db_engine) == 7


def _long(n: int) -> str:
    return "א" * n


_TOO_FAR = (dt.date.today() + dt.timedelta(days=3 * 365)).isoformat()


@pytest.mark.parametrize(
    "overrides",
    [
        {"rooms": 2.3},
        {"rooms": 0.5},
        {"rooms": 20.5},
        {"price_ils": 100},
        {"price_ils": 7200.5},
        {"size_sqm": 3},
        {"floor": 3, "total_floors": 2},
        {"city": _long(41)},
        {"city": " "},
        {"street": _long(81)},
        {"description": _long(2001)},
        {"available_from": _TOO_FAR},
        {"listing_type": "villa"},
        {"furnished": "yes"},
        {"parking_spots": 6},
        {"description": "דירה \u202eמוארת"},
        {"city": "גבעת\nיים"},
        {"elevator": None},  # removed from the body below
    ],
    ids=[
        "rooms-2.3",
        "rooms-0.5",
        "rooms-20.5",
        "price-100",
        "price-fractional",
        "size-3",
        "total-floors-below-floor",
        "city-41-code-points",
        "city-blank",
        "street-81",
        "description-2001",
        "available-from-3-years",
        "type-villa",
        "furnished-yes",
        "parking-6",
        "description-bidi-override",
        "city-newline",
        "missing-elevator",
    ],
)
def test_ac4_validation_rejects_bad_input(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine, overrides: dict[str, Any]
) -> None:
    body = _body(gush_dan, **overrides)
    if overrides == {"elevator": None}:
        del body["elevator"]

    response = owner.post("/listings", json=body)

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
    assert _count(db_engine) == 0


def test_ac4_description_crlf_is_stored_as_lf(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    response = owner.post(
        "/listings", json=_body(gush_dan, description="שורה 1\r\nשורה 2\r\nשורה 3")
    )

    assert response.status_code == 201
    assert response.json()["description"] == "שורה 1\nשורה 2\nשורה 3"
    assert _row(db_engine, response.json()["id"])["description"] == "שורה 1\nשורה 2\nשורה 3"


def test_ac4_blank_description_is_null(owner: TestClient, gush_dan: uuid.UUID) -> None:
    assert _create(owner, gush_dan, description="  ")["description"] is None


def test_ac5_unknown_or_inactive_area_rejected(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    response = owner.post("/listings", json=_body(uuid.uuid4()))
    assert response.status_code == 422
    assert response.json() == {"detail": "unknown_area"}
    assert _count(db_engine) == 0

    _execute(db_engine, "UPDATE areas SET is_active = false WHERE id = :id", id=gush_dan)
    response = owner.post("/listings", json=_body(gush_dan))
    assert response.status_code == 422
    assert response.json() == {"detail": "unknown_area"}
    assert _count(db_engine) == 0


@pytest.fixture
def statements(db_engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement the app engine sends while the test records (`.clear()` to start)."""
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(db_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine, "before_cursor_execute", record)


def test_ac6_me_listings_is_own_newest_first(
    client: TestClient,
    outbox: Outbox,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    statements: list[str],
) -> None:
    owner_a = signup(client, outbox, "a@example.com", "owner")
    owner_b = signup(client, outbox, "b@example.com", "owner")
    fresh = signup(client, outbox, "fresh@example.com", "owner")
    first = _create(owner_a, gush_dan, street="ראשון")
    # Created 1 s apart, without sleeping: move the first one back.
    _execute(
        db_engine,
        "UPDATE listings SET created_at = created_at - interval '1 second' WHERE id = :id",
        id=first["id"],
    )
    second = _create(owner_a, gush_dan, street="שני")
    assert _patch(owner_a, second["id"], {"status": "paused"}).status_code == 200
    _create(owner_b, gush_dan, street="של ב")

    statements.clear()
    response = owner_a.get("/me/listings")
    sent = list(statements)

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == [second["id"], first["id"]]
    assert [item["status"] for item in body] == ["paused", "active"]
    assert len(sent) == 2, sent
    assert sum("FROM listings" in statement for statement in sent) == 1

    empty = fresh.get("/me/listings")
    assert empty.status_code == 200
    assert empty.json() == []


def test_ac7_patch_own_listing_only(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    owner_a = signup(client, outbox, "a@example.com", "owner")
    owner_b = signup(client, outbox, "b@example.com", "owner")
    listing = _create(owner_a, gush_dan)
    listing_id = listing["id"]

    response = _patch(owner_a, listing_id, {"price_ils": 7500, "status": "paused"})
    assert response.status_code == 200
    patched = response.json()
    assert (patched["price_ils"], patched["status"]) == (7500, "paused")
    assert dt.datetime.fromisoformat(patched["updated_at"]) > dt.datetime.fromisoformat(
        patched["created_at"]
    )
    changed = {"price_ils", "status", "updated_at"}
    assert {k: v for k, v in patched.items() if k not in changed} == {
        k: v for k, v in listing.items() if k not in changed
    }

    row_before = _row(db_engine, listing_id)
    foreign = _patch(owner_b, listing_id, {"price_ils": 9000})
    assert foreign.status_code == 404
    assert foreign.json() == {"detail": "not_found"}
    assert _row(db_engine, listing_id) == row_before
    unknown = _patch(owner_a, str(uuid.uuid4()), {"price_ils": 9000})
    assert unknown.status_code == 404
    assert unknown.content == foreign.content

    empty = _patch(owner_a, listing_id, {})
    assert empty.status_code == 422
    assert isinstance(empty.json()["detail"], list)

    cross_field = _patch(owner_a, listing_id, {"total_floors": 1})  # floor is 3
    assert cross_field.status_code == 422
    assert isinstance(cross_field.json()["detail"], list)
    assert cross_field.json()["detail"][0]["loc"][0] == "body"

    cleared = _patch(owner_a, listing_id, {"arnona_ils": None})
    assert cleared.status_code == 200
    assert cleared.json()["arnona_ils"] is None
    assert cleared.json()["vaad_ils"] == 150

    null_price = _patch(owner_a, listing_id, {"price_ils": None})
    assert null_price.status_code == 422
    assert isinstance(null_price.json()["detail"], list)
    assert _row(db_engine, listing_id)["price_ils"] == 7500


def test_ac7_patch_rechecks_area_and_strips_text(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing = _create(owner, gush_dan)

    response = _patch(owner, listing["id"], {"area_id": str(uuid.uuid4())})
    assert response.status_code == 422
    assert response.json() == {"detail": "unknown_area"}

    response = _patch(owner, listing["id"], {"city": "  רמת גן ", "description": ""})
    assert response.status_code == 200
    assert (response.json()["city"], response.json()["description"]) == ("רמת גן", None)
    assert _row(db_engine, listing["id"])["area_id"] == gush_dan


def test_ac8_resume_reapplies_cap(owner: TestClient, gush_dan: uuid.UUID) -> None:
    listings = [_create(owner, gush_dan) for _ in range(3)]
    paused = listings[0]
    assert _patch(owner, paused["id"], {"status": "paused"}).status_code == 200
    _create(owner, gush_dan)  # back at the cap, with one paused

    response = _patch(owner, paused["id"], {"status": "active"})
    assert response.status_code == 409
    assert response.json() == {"detail": "listing_cap_reached"}
    by_id = {item["id"]: item for item in owner.get("/me/listings").json()}
    assert by_id[paused["id"]]["status"] == "paused"

    assert _patch(owner, listings[1]["id"], {"status": "paused"}).status_code == 200
    response = _patch(owner, paused["id"], {"status": "active"})
    assert response.status_code == 200
    assert response.json()["status"] == "active"
    assert response.json()["expires_at"] == paused["expires_at"]


def test_ac9_concurrent_creates_respect_cap(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner_id = uuid.UUID(owner.get("/me").json()["id"])
    cap: int = _scalar(db_engine, "SELECT listing_cap FROM users WHERE id = :id", id=owner_id)
    for _ in range(cap - 1):
        _create(owner, gush_dan)
    data = ListingIn.model_validate(_body(gush_dan))
    real_count = listings_service._count_live_listings

    def slow_count(db: Session, owner_id: uuid.UUID) -> int:
        count = real_count(db, owner_id)
        time.sleep(0.3)  # widen the count-then-insert window so the two calls overlap
        return count

    monkeypatch.setattr(listings_service, "_count_live_listings", slow_count)
    # Before the call, never inside the locked section: the second thread waits on the row lock.
    start = threading.Barrier(2, timeout=10)
    outcomes: list[str] = []

    def create() -> None:
        with get_sessionmaker()() as db:
            user = db.get(User, owner_id)
            assert user is not None
            start.wait()
            try:
                listings_service.create_listing(db, user, data)
                outcomes.append("created")
            except listings_service.ListingCapReachedError:
                outcomes.append("cap_reached")
            except Exception as exc:  # pragma: no cover - reported by the assertion below
                outcomes.append(repr(exc))

    threads = [threading.Thread(target=create) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)

    assert sorted(outcomes) == ["cap_reached", "created"]
    live: int = _scalar(
        db_engine,
        "SELECT count(*) FROM listings"
        " WHERE owner_id = :id AND status = 'active' AND expires_at > now()",
        id=owner_id,
    )
    assert live == cap


_RAW_HEADERS = {"Content-Type": "application/json"}


def _raw(body: dict[str, Any], **literals: str) -> bytes:
    """JSON bytes with `literals` (field -> raw JSON token such as NaN) spliced in; non-ASCII and
    lone surrogates stay as \\u escapes, so the parser, not the client, produces them."""
    sent = {**body, **{key: f"__{key}__" for key in literals}}
    text_ = json.dumps(sent)
    for key, token in literals.items():
        text_ = text_.replace(f'"__{key}__"', token)
    return text_.encode("utf-8", "surrogatepass")


def _assert_clean_422(response: httpx.Response) -> None:
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert isinstance(detail, list) and detail
    for entry in detail:
        assert "input" not in entry
        assert {"type", "loc", "msg"} <= entry.keys()


@pytest.mark.parametrize(
    ("field", "token"),
    [("price_ils", "1e999999"), ("rooms", "NaN"), ("size_sqm", "Infinity")],
)
def test_review_nonfinite_number_is_422_not_500(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine, field: str, token: str
) -> None:
    response = owner.post(
        "/listings", content=_raw(_body(gush_dan), **{field: token}), headers=_RAW_HEADERS
    )
    _assert_clean_422(response)
    assert _count(db_engine) == 0

    listing = _create(owner, gush_dan)
    response = owner.patch(
        f"/listings/{listing['id']}", content=_raw({}, **{field: token}), headers=_RAW_HEADERS
    )
    _assert_clean_422(response)
    assert _row(db_engine, listing["id"])["description"] == listing["description"]


def test_review_lone_surrogate_is_422_not_500(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    response = owner.post(
        "/listings", content=_raw(_body(gush_dan, city="ab\ud800")), headers=_RAW_HEADERS
    )
    _assert_clean_422(response)
    assert _count(db_engine) == 0

    listing = _create(owner, gush_dan)
    response = owner.patch(
        f"/listings/{listing['id']}",
        content=_raw({"description": "\ud800"}),
        headers=_RAW_HEADERS,
    )
    _assert_clean_422(response)
    assert _row(db_engine, listing["id"])["description"] == listing["description"]
    assert _count(db_engine) == 1


def test_review_validation_error_never_echoes_request_body(client: TestClient) -> None:
    response = client.post(
        "/auth/otp/verify",
        content=b'{"email":"x@example.com","x":NaN}',
        headers=_RAW_HEADERS,
    )
    _assert_clean_422(response)
    assert "x@example.com" not in response.text
