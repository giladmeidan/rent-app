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

from app import limits
from app.db import get_sessionmaker
from app.models import User
from app.schemas.listing import ListingIn
from app.schemas.profile import LIFESTYLE_KEYS
from app.services import listings as listings_service
from tests.conftest import Outbox, make_listing, signup

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
    assert dt.timedelta(days=89) <= expires - created <= dt.timedelta(days=91)
    assert _count(db_engine) == 1
    row = _row(db_engine, body["id"])
    assert str(row["rooms"]) == "3.5"
    assert row["city"] == "גבעתיים"


def test_ac2_rooms_for_any_account_apartments_for_owners(
    client: TestClient,
    outbox: Outbox,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    statements: list[str],
) -> None:
    """Spec 0010b AC1: a seeker posts, lists, edits and pauses a room; the cap of 3 live listings is
    shared with apartments; an apartment by a non-owner is 403 before anything is locked."""
    some_id = uuid.uuid4()
    for response in (
        client.post("/listings", json=_room(gush_dan)),
        client.get("/me/listings"),
        client.patch(f"/listings/{some_id}", json={"price_ils": 7000}),
    ):
        assert response.status_code == 401
        assert response.json() == {"detail": "unauthenticated"}

    seeker = signup(client, outbox, "seeker@example.com", "seeker")
    owner = signup(client, outbox, "owner@example.com", "owner")
    seeker_id = seeker.get("/me").json()["id"]

    # An apartment by a seeker: 403, no row, and the cap's row lock is never taken.
    statements.clear()
    response = seeker.post("/listings", json=_body(gush_dan))
    assert response.status_code == 403
    assert response.json() == {"detail": "owner_only"}
    assert not any("FOR UPDATE" in statement for statement in statements), statements
    assert _count(db_engine) == 0

    room = _create_room(seeker, gush_dan)
    assert room["owner_id"] == seeker_id
    mine = seeker.get("/me/listings")
    assert mine.status_code == 200
    assert [item["id"] for item in mine.json()] == [room["id"]]

    patched = _patch(seeker, room["id"], {"price_ils": 3900})
    assert patched.status_code == 200, patched.text
    assert patched.json()["price_ils"] == 3900
    paused = _patch(seeker, room["id"], {"status": "paused"})
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"

    # Another account's PATCH is the unknown id's 404.
    other = _patch(owner, room["id"], {"price_ils": 1000})
    assert other.status_code == 404
    assert other.json() == {"detail": "not_found"}
    assert _row(db_engine, room["id"])["price_ils"] == 3900

    # The cap is shared by both types: one live apartment (inserted directly; a seeker cannot post
    # one) and two live rooms make three, so the fourth live listing is refused.
    make_listing(db_engine, uuid.UUID(seeker_id), gush_dan)
    _create_room(seeker, gush_dan)
    _create_room(seeker, gush_dan)
    response = seeker.post("/listings", json=_room(gush_dan))
    assert response.status_code == 409
    assert response.json() == {"detail": "listing_cap_reached"}
    # Resuming the paused room would be a fourth live one too.
    assert _patch(seeker, room["id"], {"status": "active"}).status_code == 409
    assert len(seeker.get("/me/listings").json()) == 4


def test_ac3_cap_counts_live_listings_only(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The create limit is not under test here (spec 0011c).
    monkeypatch.setattr(limits, "CREATE", limits.Bucket("create", 100, 100))
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


_INVISIBLE = "contains control or invisible characters"


@pytest.mark.parametrize(
    ("field", "value", "msg"),
    [
        (
            "description",
            "\u05d3\u05d9\u05e8\u05d4 \u3164 \u05de\u05d5\u05d0\u05e8\u05ea",
            f"description {_INVISIBLE}",
        ),
        ("city", "...", "city must contain a letter or digit"),
        ("street", "\u05db\u05e6\u05e0\u05dc\u05e1\u05d5\u05df\ue000", f"street {_INVISIBLE}"),
        ("description", "a" + "\u0301" * 5, "description has too many combining marks in a row"),
    ],
    ids=[
        "description-hangul-filler",
        "city-punctuation-only",
        "street-private-use",
        "description-zalgo",
    ],
)
def test_ac6_text_rules_are_value_error_at_field(
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    field: str,
    value: str,
    msg: str,
) -> None:
    response = owner.post("/listings", json=_body(gush_dan, **{field: value}))

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail[0]["type"] == "value_error"
    assert detail[0]["loc"] == ["body", field]
    assert detail[0]["msg"] == f"Value error, {msg}"
    assert "input" not in detail[0]
    assert _count(db_engine) == 0


def test_ac6_patch_rejects_blank_letter_city(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing = _create(owner, gush_dan)
    row_before = _row(db_engine, listing["id"])

    response = _patch(owner, listing["id"], {"city": "\u3164"})

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail[0]["type"] == "value_error"
    assert detail[0]["loc"] == ["body", "city"]
    assert detail[0]["msg"] == f"Value error, city {_INVISIBLE}"
    assert _row(db_engine, listing["id"]) == row_before


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
    assert all("liked_me_count" not in item for item in body)  # spec 0010l: removed
    # 0008d, in the same statement: no flatmates, no invite link.
    assert [(item["flatmate_count"], item["flatmate_invite_active"]) for item in body] == [
        (0, False),
        (0, False),
    ]
    assert all("flatmate_invite_hash" not in item for item in body)
    assert [item["photos"] for item in body] == [[], []]  # spec 0010d
    # NF1 (spec 0014b): the closure answer is two columns of the same row, unanswered here.
    assert [(item["close_reason"], item["final_rent_ils"]) for item in body] == [
        (None, None),
        (None, None),
    ]
    # The session, the listings, their photos (spec 0010d: one statement for the whole list).
    assert len(sent) == 3, sent
    assert sum("FROM listings" in statement for statement in sent) == 1
    assert "FROM listing_photos" in sent[2]

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


ALL_HOUSEHOLDS = ["single", "couple", "family", "roommates"]
PREFERENCES = ("accepted_households", "smoking_allowed", "min_contract_months")


def _preferences(item: dict[str, Any]) -> tuple[Any, ...]:
    return tuple(item[name] for name in PREFERENCES)


def test_ac7_owner_preferences_on_create_and_reads(
    client: TestClient, owner: TestClient, gush_dan: uuid.UUID
) -> None:
    plain = _create(owner, gush_dan)
    assert _preferences(plain) == (ALL_HOUSEHOLDS, True, None)

    chosen = _create(
        owner,
        gush_dan,
        accepted_households=["couple", "single"],
        smoking_allowed=False,
        min_contract_months=12,
    )

    expected = (["single", "couple"], False, 12)
    assert _preferences(chosen) == expected
    mine = {item["id"]: item for item in owner.get("/me/listings").json()}
    assert _preferences(mine[chosen["id"]]) == expected
    assert _preferences(mine[plain["id"]]) == (ALL_HOUSEHOLDS, True, None)
    client.cookies.clear()
    detail = client.get(f"/listings/{chosen['id']}")
    assert detail.status_code == 200
    assert _preferences(detail.json()) == expected
    items = {item["id"]: item for item in client.get("/listings").json()["items"]}
    assert _preferences(items[chosen["id"]]) == expected
    assert _preferences(items[plain["id"]]) == (ALL_HOUSEHOLDS, True, None)


def test_ac8_owner_preferences_patch(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing = _create(
        owner,
        gush_dan,
        accepted_households=["couple", "single"],
        smoking_allowed=False,
        min_contract_months=12,
    )
    listing_id = listing["id"]

    cleared = _patch(owner, listing_id, {"min_contract_months": None})

    assert cleared.status_code == 200, cleared.text
    body = cleared.json()
    assert body["min_contract_months"] is None
    unchanged = {"min_contract_months", "updated_at"}
    assert {k: v for k, v in body.items() if k not in unchanged} == {
        k: v for k, v in listing.items() if k not in unchanged
    }
    assert _row(db_engine, listing_id)["min_contract_months"] is None

    family = _patch(owner, listing_id, {"accepted_households": ["family"]})
    assert family.status_code == 200, family.text
    assert family.json()["accepted_households"] == ["family"]
    assert family.json()["smoking_allowed"] is False

    row_before = _row(db_engine, listing_id)
    bad_patches: list[dict[str, Any]] = [
        {"accepted_households": []},
        {"accepted_households": ["single", "single"]},
        {"accepted_households": ["group"]},
        {"accepted_households": None},
        {"smoking_allowed": None},
        {"min_contract_months": 18},
    ]
    for bad in bad_patches:
        response = _patch(owner, listing_id, bad)
        assert response.status_code == 422, (bad, response.text)
        assert isinstance(response.json()["detail"], list), bad
        assert _row(db_engine, listing_id) == row_before, bad


# --- 0007a: room fields ----------------------------------------------------------------------

ROOM_FIELDS = ("gender_preference", "flatmates_count", "flatmate_ages", "lifestyle")
ROOM_DEFAULTS: tuple[Any, ...] = ("any", None, [], {})


def _room(area_id: uuid.UUID, **overrides: Any) -> dict[str, Any]:
    """`R` (spec 0007a): `_body` as a 4-room room for women, two flatmates aged 27 and 30, and two
    questionnaire answers."""
    room: dict[str, Any] = {
        "listing_type": "room",
        "rooms": 4,
        "flatmates_count": 2,
        "flatmate_ages": [27, 30],
        "gender_preference": "women",
        "lifestyle": {"cleanliness": 3, "night": 1},
    }
    return _body(area_id, **{**room, **overrides})


def _create_room(owner: TestClient, area_id: uuid.UUID, **overrides: Any) -> dict[str, Any]:
    response = owner.post("/listings", json=_room(area_id, **overrides))
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


def _room_fields(item: dict[str, Any]) -> tuple[Any, ...]:
    return tuple(item[name] for name in ROOM_FIELDS)


def test_ac1_room_fields_on_create_and_reads(
    client: TestClient, owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    expected = ("women", 2, [27, 30], {"cleanliness": 3, "night": 1})
    room = _create_room(owner, gush_dan)
    assert _room_fields(room) == expected
    assert room["listing_type"] == "room"
    assert _room_fields(_row(db_engine, room["id"])) == expected

    apartment = _create(owner, gush_dan)
    assert _room_fields(apartment) == ROOM_DEFAULTS
    assert _room_fields(_row(db_engine, apartment["id"])) == ROOM_DEFAULTS

    # Three creates = the default cap of 3.
    some_ages = _create_room(owner, gush_dan, flatmates_count=3, flatmate_ages=[41])
    assert _room_fields(some_ages) == ("women", 3, [41], {"cleanliness": 3, "night": 1})

    mine = {item["id"]: item for item in owner.get("/me/listings").json()}
    assert _room_fields(mine[room["id"]]) == expected
    assert _room_fields(mine[apartment["id"]]) == ROOM_DEFAULTS
    assert _room_fields(mine[some_ages["id"]]) == _room_fields(some_ages)

    # Rooms are public from 0007b, with the four room fields and no fit for a visitor; the ages
    # and answers go only to a signed-in seeker (0007b AC7).
    client.cookies.clear()
    detail = client.get(f"/listings/{room['id']}")
    assert detail.status_code == 200
    assert _room_fields(detail.json()) == ("women", 2, [], {})
    assert detail.json()["room_fit"] is None
    # Rooms are asked for explicitly; the default is apartments only (spec 0010a).
    search = client.get("/listings?listing_type=room")
    assert search.status_code == 200
    ids = {item["id"] for item in search.json()["items"]}
    assert room["id"] in ids
    assert some_ages["id"] in ids
    assert apartment["id"] not in ids
    apartments = client.get("/listings")
    assert apartments.status_code == 200
    assert {item["id"] for item in apartments.json()["items"]} == {apartment["id"]}


def _without_key(body: dict[str, Any], key: str) -> dict[str, Any]:
    return {k: v for k, v in body.items() if k != key}


# (case id, how to build the bad body from the area id)
_ROOM_CASES: list[tuple[str, Any]] = [
    ("count-missing", lambda a: _without_key(_room(a), "flatmates_count")),
    ("count-0", lambda a: _room(a, flatmates_count=0)),
    ("count-8", lambda a: _room(a, flatmates_count=8)),
    ("count-null", lambda a: _room(a, flatmates_count=None)),
    ("ages-17", lambda a: _room(a, flatmate_ages=[17])),
    ("ages-100", lambda a: _room(a, flatmate_ages=[100])),
    ("ages-three-for-two", lambda a: _room(a, flatmate_ages=[27, 30, 31])),
    ("ages-null-element", lambda a: _room(a, flatmate_ages=[27, None])),
    ("gender-female", lambda a: _room(a, gender_preference="female")),
    ("gender-null", lambda a: _room(a, gender_preference=None)),
    ("lifestyle-unknown-key", lambda a: _room(a, lifestyle={"pets": 2})),
    ("lifestyle-0", lambda a: _room(a, lifestyle={"night": 0})),
    ("lifestyle-4", lambda a: _room(a, lifestyle={"night": 4})),
    ("lifestyle-string", lambda a: _room(a, lifestyle={"night": "2"})),
    ("lifestyle-fraction", lambda a: _room(a, lifestyle={"night": 2.5})),
    ("lifestyle-null-value", lambda a: _room(a, lifestyle={"night": None})),
    ("lifestyle-list", lambda a: _room(a, lifestyle=[])),
    ("lifestyle-string-body", lambda a: _room(a, lifestyle="often")),
    ("lifestyle-null", lambda a: _room(a, lifestyle=None)),
    ("apartment-gender", lambda a: _body(a, gender_preference="women")),
    ("apartment-count", lambda a: _body(a, flatmates_count=2)),
    ("apartment-ages", lambda a: _body(a, flatmate_ages=[30])),
    ("apartment-lifestyle", lambda a: _body(a, lifestyle={"night": 2})),
]


# Rules (1)-(3) of `_room_fields` are model-level, at `["body"]` (0007e relies on it).
_BODY_LEVEL = {"count-missing", "ages-three-for-two"} | {
    i for i, _ in _ROOM_CASES if i.startswith("apartment-")
}


@pytest.mark.parametrize("make_body", [m for _, m in _ROOM_CASES], ids=[i for i, _ in _ROOM_CASES])
def test_ac2_room_fields_validation(
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    make_body: Any,
    request: pytest.FixtureRequest,
) -> None:
    response = owner.post("/listings", json=make_body(gush_dan))

    assert response.status_code == 422, response.text
    assert isinstance(response.json()["detail"], list)
    if request.node.callspec.id in _BODY_LEVEL:
        assert response.json()["detail"][0]["loc"] == ["body"]
    assert _count(db_engine) == 0


def _assert_refused(
    owner: TestClient, engine: Engine, listing_id: str, bodies: list[dict[str, Any]]
) -> None:
    """Each PATCH is a 422 with a list `detail` and leaves the row unchanged."""
    row_before = _row(engine, listing_id)
    for body in bodies:
        response = _patch(owner, listing_id, body)
        assert response.status_code == 422, (body, response.text)
        assert isinstance(response.json()["detail"], list), body
        assert _row(engine, listing_id) == row_before, body


def _patched(owner: TestClient, listing_id: str, body: dict[str, Any]) -> dict[str, Any]:
    response = _patch(owner, listing_id, body)
    assert response.status_code == 200, (body, response.text)
    patched: dict[str, Any] = response.json()
    return patched


def test_ac3_room_fields_patch(owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine) -> None:
    room = _create_room(owner, gush_dan)
    room_id = room["id"]

    anyone = _patched(owner, room_id, {"gender_preference": "any"})
    assert anyone["gender_preference"] == "any"
    unchanged = {"gender_preference", "updated_at"}
    assert {k: v for k, v in anyone.items() if k not in unchanged} == {
        k: v for k, v in room.items() if k not in unchanged
    }

    _assert_refused(owner, db_engine, room_id, [{"flatmates_count": 1}])  # two ages stored

    three = _patched(owner, room_id, {"flatmates_count": 3, "flatmate_ages": [27, 30, 35]})
    assert (three["flatmates_count"], three["flatmate_ages"]) == (3, [27, 30, 35])

    _assert_refused(owner, db_engine, room_id, [{"flatmate_ages": [27, 30, 35, 40]}])

    replaced = _patched(owner, room_id, {"lifestyle": {"guests": 2}})
    assert replaced["lifestyle"] == {"guests": 2}
    assert _row(db_engine, room_id)["lifestyle"] == {"guests": 2}

    assert _patched(owner, room_id, {"lifestyle": {}})["lifestyle"] == {}
    assert _patched(owner, room_id, {"flatmate_ages": []})["flatmate_ages"] == []
    assert _room_fields(_row(db_engine, room_id)) == ("any", 3, [], {})

    _assert_refused(
        owner,
        db_engine,
        room_id,
        [
            *({name: None} for name in ROOM_FIELDS),
            {"lifestyle": {"pets": 1}},
            {"gender_preference": "female"},
        ],
    )


def test_ac2_patch_cannot_switch_type(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    """Spec 0010a AC2: `ListingPatch` has no `listing_type` and forbids unknown keys, so a PATCH
    that tries to switch the type is a 422 `extra_forbidden` that echoes nothing and writes
    nothing. Replaces 0007a's `test_ac4_type_switch_room_fields`."""
    room = _create_room(owner, gush_dan)
    room_id = room["id"]
    assert owner.post(f"/listings/{room_id}/flatmate-invite").status_code == 201
    row_before = _row(db_engine, room_id)
    assert row_before["flatmate_invite_hash"] is not None

    for body in ({"listing_type": "apartment"}, {"listing_type": "room", "price_ils": 5000}):
        response = _patch(owner, room_id, body)
        _assert_clean_422(response)
        assert response.json()["detail"] == [
            {
                "type": "extra_forbidden",
                "loc": ["body", "listing_type"],
                "msg": "Extra inputs are not permitted",
            }
        ], body
        assert _row(db_engine, room_id) == row_before, body

    patched = _patched(owner, room_id, {"price_ils": 5000})
    assert (patched["listing_type"], patched["price_ils"]) == ("room", 5000)
    row = _row(db_engine, room_id)
    assert (row["listing_type"], row["price_ils"]) == ("room", 5000)
    assert _room_fields(row) == _room_fields(row_before)
    assert row["flatmate_invite_hash"] == row_before["flatmate_invite_hash"]


def test_ac5_legacy_room_fills_count_on_next_edit(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    owner_id = uuid.UUID(owner.get("/me").json()["id"])
    legacy_1 = str(make_listing(db_engine, owner_id, gush_dan, listing_type="room"))
    legacy_2 = str(make_listing(db_engine, owner_id, gush_dan, listing_type="room"))

    mine = {item["id"]: item for item in owner.get("/me/listings").json()}
    assert _room_fields(mine[legacy_1]) == ROOM_DEFAULTS
    assert _room_fields(mine[legacy_2]) == ROOM_DEFAULTS

    _assert_refused(owner, db_engine, legacy_1, [{"price_ils": 3000}])

    # A pause or resume is not an edit.
    assert _patched(owner, legacy_1, {"status": "paused"})["status"] == "paused"
    assert _patched(owner, legacy_1, {"status": "active"})["status"] == "active"

    filled = _patched(owner, legacy_1, {"price_ils": 3000, "flatmates_count": 2})
    assert (filled["price_ils"], filled["flatmates_count"]) == (3000, 2)


def _many_unknown_keys() -> dict[str, int]:
    """4,000 unknown questionnaire keys, one of them a sensitive sentence (spec 0011c: 20,000 is
    now a 413 `body_too_large`, `test_hardening.py::test_ac12_body_size_cap`)."""
    keys = {f"k{n}": 2 for n in range(3_999)}
    return {**keys, "I am pregnant": 2}


def test_nf2_lifestyle_unknown_keys_one_error_no_echo(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    # Review round 1 (security): one error at the field, never one per key, never naming a key.
    eight: dict[str, int] = {**dict.fromkeys(LIFESTYLE_KEYS, 1), "I am pregnant": 1}
    for lifestyle in (_many_unknown_keys(), eight):
        response = owner.post("/listings", json=_room(gush_dan, lifestyle=lifestyle))

        assert response.status_code == 422, response.text[:500]
        detail = response.json()["detail"]
        assert [entry["loc"] for entry in detail] == [["body", "lifestyle"]]
        assert "I am pregnant" not in response.text
    assert _count(db_engine) == 0


# --- Spec 0014b: the four facts ----------------------------------------------------------------

FACTS: dict[str, Any] = {
    "balcony": True,
    "shelter": "mamad",
    "air_conditioning": False,
    "condition": "renovated",
}


def _facts(item: dict[str, Any]) -> dict[str, Any]:
    return {name: item[name] for name in FACTS}


def test_ac4_apartment_facts(owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine) -> None:
    created = _create(owner, gush_dan, **FACTS)
    assert _facts(created) == FACTS
    assert _facts(_row(db_engine, created["id"])) == FACTS
    plain = _create(owner, gush_dan)
    assert _facts(plain) == dict.fromkeys(FACTS)

    changed = {"balcony": False, "shelter": "none", "air_conditioning": True, "condition": "new"}
    assert _facts(_patched(owner, plain["id"], changed)) == changed
    assert _facts(_row(db_engine, plain["id"])) == changed
    # An explicit `null` clears each one.
    for name in FACTS:
        assert _patched(owner, created["id"], {name: None})[name] is None
    assert _facts(_row(db_engine, created["id"])) == dict.fromkeys(FACTS)

    response = owner.post("/listings", json=_body(gush_dan, condition="old"))
    assert response.status_code == 422, response.text
    assert [entry["loc"] for entry in response.json()["detail"]] == [["body", "condition"]]
    _assert_refused(owner, db_engine, plain["id"], [{"condition": "old"}, {"shelter": "maybe"}])
    assert _count(db_engine) == 2


def test_ac5_facts_on_a_room_and_room_fields_still_room_only(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    room = _create_room(owner, gush_dan, **FACTS)
    assert _facts(room) == FACTS
    assert _facts(_row(db_engine, room["id"])) == FACTS
    assert _facts(_patched(owner, room["id"], {"condition": "needs_work"})) == {
        **FACTS,
        "condition": "needs_work",
    }

    # The other room-only fields are still refused on an apartment.
    for name, value in {
        "room_size_sqm": 12,
        "private_bathroom": True,
        "bills_included": True,
        "poster": "lives_here",
        "flatmates_count": 2,
    }.items():
        response = owner.post("/listings", json=_body(gush_dan, **{name: value}))
        assert response.status_code == 422, (name, response.text)
        assert "are for a room only" in response.text
    assert _count(db_engine) == 1


# --- Spec 0015a: the flat's protected space ----------------------------------------------------


def test_ac1_create_listing_shelter(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    created = _create(owner, gush_dan, shelter="mamad")
    assert created["shelter"] == "mamad"
    assert _row(db_engine, created["id"])["shelter"] == "mamad"
    plain = _create(owner, gush_dan)
    assert plain["shelter"] is None
    assert _row(db_engine, plain["id"])["shelter"] is None
    # A room has it too (a fact of the flat).
    room = _create_room(owner, gush_dan, shelter="building")
    assert room["shelter"] == "building"
    mine = {item["id"]: item["shelter"] for item in owner.get("/me/listings").json()}
    assert mine == {created["id"]: "mamad", plain["id"]: None, room["id"]: "building"}


def test_ac2_patch_listing_shelter(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing_id = _create(owner, gush_dan, shelter="mamak")["id"]

    assert _patched(owner, listing_id, {"shelter": "none"})["shelter"] == "none"
    assert _row(db_engine, listing_id)["shelter"] == "none"
    # A PATCH without the key leaves it as it was.
    untouched = _patched(owner, listing_id, {"price_ils": 7300})
    assert (untouched["price_ils"], untouched["shelter"]) == (7300, "none")
    assert _row(db_engine, listing_id)["shelter"] == "none"
    # `none` and NULL stay distinct: an explicit `null` clears it to "not said".
    assert _patched(owner, listing_id, {"shelter": None})["shelter"] is None
    assert _row(db_engine, listing_id)["shelter"] is None
    assert _patched(owner, listing_id, {"price_ils": 7200})["shelter"] is None


def test_ac3_shelter_rejects_unknown_value(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    response = owner.post("/listings", json=_body(gush_dan, shelter="bunker"))
    assert response.status_code == 422, response.text
    assert [entry["loc"] for entry in response.json()["detail"]] == [["body", "shelter"]]
    assert _count(db_engine) == 0

    listing_id = _create(owner, gush_dan, shelter="mamad")["id"]
    _assert_refused(owner, db_engine, listing_id, [{"shelter": "bunker"}, {"shelter": True}])
    assert _row(db_engine, listing_id)["shelter"] == "mamad"


def test_ac12_safe_room_removed(owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine) -> None:
    # Spec 0015a replaced 0014b's ממ״ד yes/no: a POST ignores the key (extra keys are ignored),
    # a PATCH refuses it (`extra="forbid"`), no response and no column has it.
    response = owner.post("/listings", json=_body(gush_dan, safe_room=True))
    assert response.status_code == 201, response.text
    created = response.json()
    listing_id = created["id"]
    assert "safe_room" not in created
    assert created["shelter"] is None
    row = _row(db_engine, listing_id)
    assert "safe_room" not in row
    assert row["shelter"] is None

    _assert_refused(owner, db_engine, listing_id, [{"safe_room": True}])
    patched = _patched(owner, listing_id, {"shelter": "mamad"})
    with db_engine.begin() as conn:  # Into the renewal window (spec 0011a).
        conn.execute(
            text("UPDATE listings SET expires_at = now() + interval '3 days' WHERE id = :id"),
            {"id": listing_id},
        )
    renewed = owner.post(f"/listings/{listing_id}/renew")
    assert renewed.status_code == 200, renewed.text
    detail = owner.get(f"/listings/{listing_id}")
    assert detail.status_code == 200, detail.text
    for item in (patched, renewed.json(), detail.json(), *owner.get("/me/listings").json()):
        assert "safe_room" not in item
        assert item["shelter"] == "mamad"
