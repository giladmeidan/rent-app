"""Public search and listing page API (spec 0003a): AC1-AC9."""

import datetime as dt
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text

from scripts.seed import GUSH_DAN_WKT
from tests.conftest import Outbox, make_listing, make_owner, signup

pytestmark = pytest.mark.usefixtures("redis_clean")

PUBLIC_KEYS = {
    "id",
    "listing_type",
    "city",
    "street",
    "rooms",
    "floor",
    "total_floors",
    "size_sqm",
    "price_ils",
    "available_from",
    "entry_flexible",
    "elevator",
    "parking_spots",
    "furnished",
    "pets_allowed",
    "arnona_ils",
    "vaad_ils",
    "description",
    "accepted_households",
    "smoking_allowed",
    "min_contract_months",
    "created_at",
    "lat",
    "lng",
    "match",  # spec 0006b: null unless the caller is a seeker with a profile
}

TODAY = dt.date.today()


def _search(client: TestClient, query: str = "") -> dict[str, Any]:
    response = client.get(f"/listings?{query}" if query else "/listings")
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _ids(body: dict[str, Any]) -> list[str]:
    return [item["id"] for item in body["items"]]


def _id_set(client: TestClient, query: str = "") -> set[str]:
    """The ids matching `query` (one page of up to 50), checking `total` against them."""
    body = _search(client, f"{query}&limit=50" if query else "limit=50")
    assert body["total"] == len(body["items"])
    return set(_ids(body))


@pytest.fixture
def statements(db_engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement the app engine sends while the test records (`.clear()` to start)."""
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(db_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine, "before_cursor_execute", record)


@dataclass
class World:
    """AC1's rows: only `a` is public."""

    a: str  # live apartment
    b: str  # paused apartment (owned by `owner_b`)
    c: str  # apartment expired an hour ago
    d: str  # live room
    e: str  # live apartment in an inactive area
    owner_b: TestClient
    seeker: TestClient


@pytest.fixture
def world(client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine) -> World:
    with db_engine.begin() as conn:
        closed_area: uuid.UUID = conn.execute(
            text(
                "INSERT INTO areas (slug, name_he, geom, is_active) "
                "VALUES ('closed-area', 'סגור', ST_GeomFromText(:wkt, 4326), false) RETURNING id"
            ),
            {"wkt": GUSH_DAN_WKT},
        ).scalar_one()
    owner_b = signup(client, outbox, "owner-b@example.com", "owner")
    seeker = signup(client, outbox, "seeker@example.com", "seeker")
    owner_b_id = uuid.UUID(owner_b.get("/me").json()["id"])
    owner = make_owner(db_engine, "owner@example.com")
    an_hour_ago = dt.datetime.now(dt.UTC) - dt.timedelta(hours=1)
    return World(
        a=str(make_listing(db_engine, owner, gush_dan)),
        b=str(make_listing(db_engine, owner_b_id, gush_dan, status="paused")),
        c=str(make_listing(db_engine, owner, gush_dan, expires_at=an_hour_ago)),
        d=str(make_listing(db_engine, owner, gush_dan, listing_type="room")),
        e=str(make_listing(db_engine, owner, closed_area)),
        owner_b=owner_b,
        seeker=seeker,
    )


def test_ac1_only_live_apartments_in_active_areas(client: TestClient, world: World) -> None:
    anonymous = client.get("/listings")

    assert anonymous.status_code == 200
    body = anonymous.json()
    assert _ids(body) == [world.a]
    assert body["total"] == 1

    for caller in (world.seeker, world.owner_b):
        response = caller.get("/listings")
        assert response.status_code == 200
        assert response.json() == body


def test_ac2_public_shape_hides_owner_and_lifecycle(client: TestClient, world: World) -> None:
    item = _search(client)["items"][0]

    assert set(item) == PUBLIC_KEYS
    assert type(item["rooms"]) is float
    assert item["rooms"] == 3.5
    assert {k: v for k, v in item.items() if k not in {"id", "created_at"}} == {
        "listing_type": "apartment",
        "city": "גבעתיים",
        "street": "כצנלסון",
        "rooms": 3.5,
        "floor": 3,
        "total_floors": 5,
        "size_sqm": 95,
        "price_ils": 7200,
        "available_from": (TODAY + dt.timedelta(days=30)).isoformat(),
        "entry_flexible": True,
        "elevator": True,
        "parking_spots": 1,
        "furnished": "partial",
        "pets_allowed": True,
        "arnona_ils": 480,
        "vaad_ils": 150,
        "description": "דירה מוארת",
        # The owner's preferences (spec 0006a): the DB defaults, "no preference".
        "accepted_households": ["single", "couple", "family", "roommates"],
        "smoking_allowed": True,
        "min_contract_months": None,
        "lat": None,  # not located yet (spec 0003c)
        "lng": None,
        "match": None,  # a visitor (spec 0006b)
    }

    response = client.get(f"/listings/{world.a}")
    assert response.status_code == 200
    one = response.json()
    assert set(one) == PUBLIC_KEYS | {"applicant_count"}  # spec 0004a
    assert one == {**item, "applicant_count": 0}


def test_ac3_price_and_rooms_ranges(
    client: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    ids = {
        price: str(make_listing(db_engine, owner, gush_dan, price_ils=price, rooms=Decimal(rooms)))
        for price, rooms in ((5000, "2"), (6500, "3"), (8000, "3.5"), (9000, "5"))
    }

    assert _id_set(client, "price_min=6500&price_max=8000") == {ids[6500], ids[8000]}
    assert _id_set(client, "rooms_min=3&rooms_max=3.5") == {ids[6500], ids[8000]}
    assert _id_set(client, "rooms_min=5") == {ids[9000]}


def test_ac4_feature_filters_true_only(
    client: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    bare = {"pets_allowed": False, "furnished": "none", "elevator": False, "parking_spots": 0}

    def row(**features: Any) -> str:
        return str(make_listing(db_engine, owner, gush_dan, **{**bare, **features}))

    none = row()
    pets = row(pets_allowed=True)
    partial = row(furnished="partial")
    full = row(furnished="full")
    elevator = row(elevator=True)
    parking = row(parking_spots=2)
    every = row(pets_allowed=True, furnished="full", elevator=True, parking_spots=2)
    all_rows = {none, pets, partial, full, elevator, parking, every}

    assert _id_set(client) == all_rows
    assert _id_set(client, "pets=true") == {pets, every}
    assert _id_set(client, "furnished=true") == {partial, full, every}
    assert _id_set(client, "elevator=true") == {elevator, every}
    assert _id_set(client, "parking=true") == {parking, every}
    assert _id_set(client, "pets=true&furnished=true&elevator=true&parking=true") == {every}
    assert _id_set(client, "pets=false") == all_rows
    assert _id_set(client, "pets=false&furnished=false&elevator=false&parking=false") == all_rows


def test_ac5_available_by_honours_flexible_entry(
    client: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    owner = make_owner(db_engine, "owner@example.com")

    def row(days: int, flexible: bool) -> str:
        day = TODAY + dt.timedelta(days=days)
        return str(
            make_listing(db_engine, owner, gush_dan, available_from=day, entry_flexible=flexible)
        )

    immediate = row(-1, False)
    fixed_20 = row(20, False)
    flexible_20 = row(20, True)
    flexible_40 = row(40, True)

    def by(days: int) -> set[str]:
        return _id_set(client, f"available_by={(TODAY + dt.timedelta(days=days)).isoformat()}")

    assert by(10) == {immediate, flexible_20}
    assert by(20) == {immediate, fixed_20, flexible_20}
    assert by(25) == {immediate, fixed_20, flexible_20}  # 40 - 14 = 26 > 25
    assert by(26) == {immediate, fixed_20, flexible_20, flexible_40}


def test_ac6_sort_and_paging_are_deterministic(
    client: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    start = dt.datetime.now(dt.UTC) - dt.timedelta(hours=1)
    rows: list[tuple[str, int, dt.datetime]] = []
    for i in range(25):
        created = start + dt.timedelta(seconds=i)
        price = 5000 + (i % 6) * 500  # six prices over 25 rows: every price is tied
        listing_id = make_listing(db_engine, owner, gush_dan, price_ils=price, created_at=created)
        rows.append((str(listing_id), price, created))
    newest = [r[0] for r in sorted(rows, key=lambda r: r[2], reverse=True)]
    price_asc = [r[0] for r in sorted(rows, key=lambda r: (r[1], -r[2].timestamp()))]
    price_of = {r[0]: r[1] for r in rows}

    first = _search(client)
    assert _ids(first) == newest[:20]
    assert first["total"] == 25
    second = _search(client, "offset=20")
    assert _ids(second) == newest[20:]
    assert second["total"] == 25
    assert not set(_ids(first)) & set(_ids(second))
    assert set(_ids(first)) | set(_ids(second)) == set(newest)
    past_end = _search(client, "offset=25")
    assert past_end == {"items": [], "total": 25, "sort": "newest"}

    ascending = _search(client, "sort=price_asc&limit=50")
    prices = [item["price_ils"] for item in ascending["items"]]
    assert prices == sorted(prices)
    assert _ids(ascending) == price_asc  # ties newest first
    assert _ids(_search(client, "sort=price_asc")) == price_asc[:20]

    descending = _search(client, "sort=price_desc&limit=50")
    prices = [item["price_ils"] for item in descending["items"]]
    assert prices == sorted(prices, reverse=True)
    assert [price_of[i] for i in _ids(descending)] == prices
    tied = [i for i in _ids(descending) if price_of[i] == 7500]
    assert tied == [i for i in newest if price_of[i] == 7500]

    window = _search(client, "limit=5&offset=5&sort=price_asc")
    assert _ids(window) == price_asc[5:10]
    assert window["total"] == 25


_BAD_QUERIES = (
    "price_min=9000&price_max=8000",
    "rooms_min=4&rooms_max=3",
    "rooms_min=2.3",
    "rooms_max=0.5",
    "price_max=100001",
    "price_min=-1",
    "price_max=8000.5",
    "limit=0",
    "limit=51",
    "offset=-1",
    "offset=10001",
    "available_by=2027-02-30",
    "pets=maybe",
)


def test_ac7_validation_rejects_bad_params(
    client: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    make_listing(db_engine, make_owner(db_engine, "owner@example.com"), gush_dan)

    for query in _BAD_QUERIES:
        response = client.get(f"/listings?{query}")
        assert response.status_code == 422, (query, response.text)
        detail = response.json()["detail"]
        assert isinstance(detail, list) and detail, (query, detail)

    # Unknown params are ignored; extreme dates are valid dates, never a 500 (SQL-side arithmetic).
    for query, total in (
        ("price_max=8000&colour=red", 1),
        ("available_by=9999-12-31", 1),
        ("available_by=0001-01-01", 0),
    ):
        response = client.get(f"/listings?{query}")
        assert response.status_code == 200, (query, response.text)
        assert response.json()["total"] == total, query


@pytest.mark.parametrize("query", ["price_min=1&rooms_min=1&pets=true&sort=price_asc", ""])
def test_ac8_search_is_two_statements(
    client: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    statements: list[str],
    query: str,
) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    for _ in range(25):
        make_listing(db_engine, owner, gush_dan)
    _search(client)  # warm the connection: a first connect sends its own setup statements

    statements.clear()
    body = _search(client, query)
    sent = list(statements)

    assert (len(body["items"]), body["total"]) == (20, 25)
    assert len(sent) == 2, sent
    assert all("FROM listings" in statement for statement in sent), sent


def test_ac9_public_listing_by_id(client: TestClient, world: World) -> None:
    assert client.get(f"/listings/{world.a}").status_code == 200

    hidden = [world.b, world.c, world.d, world.e, str(uuid.uuid4())]
    responses = [client.get(f"/listings/{listing_id}") for listing_id in hidden]
    for response in responses:
        assert response.status_code == 404
        assert response.json() == {"detail": "not_found"}
    assert len({response.content for response in responses}) == 1

    own_paused = world.owner_b.get(f"/listings/{world.b}")
    assert own_paused.status_code == 404
    assert own_paused.content == responses[0].content

    assert client.get("/listings/not-a-uuid").status_code == 422
