"""Public search and listing page API (spec 0003a): AC1-AC9; spec 0010a AC1 (the type default);
spec 0023a AC1-AC4 and NF1 (the area filter)."""

import datetime as dt
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event

from tests.conftest import (
    Outbox,
    insert_neighbourhood,
    insert_settlement,
    make_listing,
    make_owner,
    make_pair,
    make_profile,
    set_location,
    signup,
)

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
    "gender_preference",  # spec 0007b: the four room fields
    "flatmates_count",
    "flatmate_ages",
    "lifestyle",
    "room_size_sqm",  # spec 0010f: the five flat facts, public
    "private_bathroom",
    "balcony",
    "bills_included",
    "poster",
    "shelter",  # spec 0015a: the flat's protected space, public
    "air_conditioning",  # spec 0014b: the apartment facts, public
    "condition",
    "created_at",
    "lat",
    "lng",
    "match",  # spec 0006b: null unless the caller is a seeker with a profile
    "cover",  # spec 0010d: the position-0 photo, null without photos
    "is_mine",  # spec 0010b: the caller owns it
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
    """AC1's rows: `a` and `d` are public."""

    a: str  # live apartment
    b: str  # paused apartment (owned by `owner_b`)
    c: str  # apartment expired an hour ago
    d: str  # live room
    e: str  # live apartment in an inactive area
    owner_b: TestClient
    seeker: TestClient


@pytest.fixture
def world(client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine) -> World:
    closed_area = insert_settlement(db_engine, 6300, "סגור", active=False)
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


def test_ac1_only_live_listings_in_active_areas(client: TestClient, world: World) -> None:
    anonymous = client.get("/listings")

    assert anonymous.status_code == 200
    body = anonymous.json()
    assert _ids(body) == [world.a]  # apartments only by default (spec 0010a)
    assert body["total"] == 1
    rooms = _search(client, "listing_type=room")
    assert _ids(rooms) == [world.d]  # rooms are public (spec 0007b), asked for explicitly
    assert rooms["total"] == 1

    for caller in (world.seeker, world.owner_b):
        response = caller.get("/listings")
        assert response.status_code == 200
        assert response.json() == body
        assert _search(caller, "listing_type=room") == rooms


MAP_BOX = "west=34.75&south=32.00&east=34.85&north=32.10"


def test_ac1_listing_type_defaults_to_apartment(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    """Spec 0010a AC1: `listing_type` omitted means `apartment`, in the list and on the map, for
    a visitor and for a seeker with a room section; each type is asked for explicitly."""
    owner = make_owner(db_engine, "owner@example.com")
    apartment = make_listing(db_engine, owner, gush_dan)
    room = make_listing(db_engine, owner, gush_dan, listing_type="room", flatmates_count=2)
    for listing_id in (apartment, room):
        set_location(db_engine, listing_id, 34.80, 32.05)
    seeker = signup(client, outbox, "seeker@example.com", "seeker")
    seeker_id = uuid.UUID(seeker.get("/me").json()["id"])
    make_profile(db_engine, seeker_id, gush_dan, gender="woman", flatmate_gender="any")

    for name, caller in (("visitor", client), ("seeker with a room section", seeker)):
        for box in ("", MAP_BOX):
            default = _search(caller, box)
            assert _ids(default) == [str(apartment)], (name, box)
            assert default["total"] == 1, (name, box)
            for listing_type, expected in (("room", room), ("apartment", apartment)):
                query = (
                    f"listing_type={listing_type}&{box}" if box else f"listing_type={listing_type}"
                )
                body = _search(caller, query)
                assert _ids(body) == [str(expected)], (name, query)
                assert body["total"] == 1, (name, query)
    for bad in ("listing_type=", "listing_type=house"):
        response = client.get(f"/listings?{bad}")
        assert response.status_code == 422, bad


def test_ac2_public_shape_hides_owner_and_lifecycle(client: TestClient, world: World) -> None:
    item = next(item for item in _search(client)["items"] if item["id"] == world.a)

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
        # The room fields (spec 0007b): an apartment's defaults.
        "gender_preference": "any",
        "flatmates_count": None,
        "flatmate_ages": [],
        "lifestyle": {},
        # The flat facts (spec 0010f): an apartment's nulls.
        "room_size_sqm": None,
        "private_bathroom": None,
        "balcony": None,
        "bills_included": None,
        "poster": None,
        # The flat's protected space (spec 0015a): not said.
        "shelter": None,
        # The apartment facts (spec 0014b): not said.
        "air_conditioning": None,
        "condition": None,
        "lat": None,  # not located yet (spec 0003c)
        "lng": None,
        "match": None,  # a visitor (spec 0006b)
        "cover": None,  # no photos (spec 0010d)
        "is_mine": False,  # a visitor (spec 0010b)
    }

    response = client.get(f"/listings/{world.a}")
    assert response.status_code == 200
    one = response.json()
    # specs 0004a, 0007b, 0008a, 0010d
    assert set(one) == PUBLIC_KEYS | {"applicant_count", "room_fit", "like", "photos", "people"}
    assert one == {
        **item,
        "applicant_count": 0,
        "room_fit": None,
        "like": None,
        "photos": [],
        "people": [],
    }


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


def test_ac4_search_shelter_filter(
    client: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    # Spec 0015a: `shelter=true` is a flat with a protected space; `none` and NULL never match.
    owner = make_owner(db_engine, "owner@example.com")
    values = ("mamad", "mamak", "building", "none", None)
    ids = {value: str(make_listing(db_engine, owner, gush_dan, shelter=value)) for value in values}
    room = str(make_listing(db_engine, owner, gush_dan, listing_type="room", shelter="mamak"))
    bare_room = str(make_listing(db_engine, owner, gush_dan, listing_type="room", shelter="none"))

    sheltered = _search(client, "shelter=true&limit=50")
    assert sheltered["total"] == 3
    assert {item["id"]: item["shelter"] for item in sheltered["items"]} == {
        ids["mamad"]: "mamad",
        ids["mamak"]: "mamak",
        ids["building"]: "building",
    }
    every = _search(client, "limit=50")["items"]
    assert {item["id"]: item["shelter"] for item in every} == {v: k for k, v in ids.items()}
    assert _id_set(client, "shelter=false") == set(ids.values())
    # The market's rooms use the same filter.
    assert _id_set(client, "listing_type=room") == {room, bare_room}
    assert _id_set(client, "listing_type=room&shelter=true") == {room}
    # The listing page carries it too.
    expected = {**{v: k for k, v in ids.items()}, room: "mamak", bare_room: "none"}
    for listing_id, value in expected.items():
        assert client.get(f"/listings/{listing_id}").json()["shelter"] == value


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
    "listing_type=house",  # spec 0007b
    "listing_type=",
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
    assert client.get(f"/listings/{world.d}").status_code == 200  # a live room (spec 0007b)

    hidden = [world.b, world.c, world.e, str(uuid.uuid4())]
    responses = [client.get(f"/listings/{listing_id}") for listing_id in hidden]
    for response in responses:
        assert response.status_code == 404
        assert response.json() == {"detail": "not_found"}
    assert len({response.content for response in responses}) == 1

    own_paused = world.owner_b.get(f"/listings/{world.b}")
    assert own_paused.status_code == 404
    assert own_paused.content == responses[0].content

    assert client.get("/listings/not-a-uuid").status_code == 422


def test_ac8_is_mine_and_own_room_never_hidden(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    """Spec 0010b AC8: `is_mine` on search, map and the listing page; no `match` or `like` on the
    caller's own listing; `/me/likes` says false; a room that does not fit its own lister is still
    shown to them (labelled, not hidden), and to no one else it does not fit."""
    lister = signup(client, outbox, "w@example.com", "seeker")
    other_woman = signup(client, outbox, "w2@example.com", "seeker")
    for caller in (lister, other_woman):
        user_id = uuid.UUID(caller.get("/me").json()["id"])
        make_profile(db_engine, user_id, gush_dan, gender="woman", flatmate_gender="any")
    lister_id = uuid.UUID(lister.get("/me").json()["id"])
    owner = make_owner(db_engine, "owner@example.com")
    own = str(
        make_listing(
            db_engine,
            lister_id,
            gush_dan,
            listing_type="room",
            flatmates_count=2,
            gender_preference="men",
        )
    )
    theirs = str(make_listing(db_engine, owner, gush_dan, listing_type="room", flatmates_count=2))
    for listing_id in (own, theirs):
        set_location(db_engine, uuid.UUID(listing_id), 34.80, 32.05)
    box = "west=34.75&south=32.00&east=34.85&north=32.10"

    for query in ("listing_type=room", f"listing_type=room&{box}"):
        body = _search(lister, query)
        assert body["total"] == 2, query
        items = {item["id"]: item for item in body["items"]}
        assert (items[own]["is_mine"], items[own]["match"]) == (True, None), query
        assert items[theirs]["is_mine"] is False, query
        assert items[theirs]["match"] is not None, query

        # The men-only room does not fit another woman: hidden from her page and total.
        body = _search(other_woman, query)
        assert (_ids(body), body["total"]) == ([theirs], 1), query
        assert body["items"][0]["is_mine"] is False, query

        body = _search(client, query)
        assert {item["id"]: item["is_mine"] for item in body["items"]} == {
            own: False,
            theirs: False,
        }

    page = lister.get(f"/listings/{own}").json()
    assert (page["is_mine"], page["match"], page["like"]) == (True, None, None)
    page = lister.get(f"/listings/{theirs}").json()
    assert page["is_mine"] is False
    assert page["match"] is not None
    assert page["like"] == {"liked_me": False}
    assert client.get(f"/listings/{own}").json()["is_mine"] is False
    assert other_woman.get(f"/listings/{own}").json()["is_mine"] is False

    # Spec 0010l: `/me/likes` lists invites; the other room's lister invites them.
    make_pair(db_engine, uuid.UUID(theirs), lister_id, price_ils_seen=7000, lister_liked=True)
    likes = lister.get("/me/likes")
    assert likes.status_code == 200
    rooms = [entry["listing"] for entry in likes.json()["liked_me"]]
    assert [room["id"] for room in rooms] == [theirs]
    assert all(room["is_mine"] is False for room in rooms)


# --- Spec 0023a: the area filter ------------------------------------------------------------------


def _areas(*ids: object) -> str:
    return "&".join(f"area_ids={area_id}" for area_id in ids)


def test_ac1_area_filter_by_city(
    client: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    other_city = insert_settlement(db_engine, 6300, "חיפה")
    closed_city = insert_settlement(db_engine, 6400, "סגורה", active=False)
    owner = make_owner(db_engine, "owner@example.com")
    hood = insert_neighbourhood(db_engine, gush_dan, 1, [])
    in_city = str(make_listing(db_engine, owner, gush_dan))
    in_hood = str(make_listing(db_engine, owner, gush_dan, neighbourhood_id=hood))
    elsewhere = str(make_listing(db_engine, owner, other_city))
    make_listing(db_engine, owner, closed_city)

    # A city id holds its listings with or without a known neighbourhood; `_id_set` checks `total`.
    assert _id_set(client, _areas(gush_dan)) == {in_city, in_hood}
    assert _id_set(client, _areas(other_city)) == {elsewhere}
    assert _id_set(client) == {in_city, in_hood, elsewhere}
    # An inactive city matches nothing: its listings are not public.
    assert _id_set(client, _areas(closed_city)) == set()


def test_ac2_area_filter_by_neighbourhood(
    client: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    hood = insert_neighbourhood(db_engine, gush_dan, 1, [])
    other_hood = insert_neighbourhood(db_engine, gush_dan, 2, [])
    closed_hood = insert_neighbourhood(db_engine, gush_dan, 3, [], active=False)
    placed = str(make_listing(db_engine, owner, gush_dan, neighbourhood_id=hood))
    other = str(make_listing(db_engine, owner, gush_dan, neighbourhood_id=other_hood))
    in_closed = str(make_listing(db_engine, owner, gush_dan, neighbourhood_id=closed_hood))
    unknown_hood = str(make_listing(db_engine, owner, gush_dan))

    assert _id_set(client, _areas(hood)) == {placed}
    # Strict (Gilad 2026-11-18): no neighbourhood never matches one, but the city still shows it.
    assert unknown_hood in _id_set(client, _areas(gush_dan))
    assert other in _id_set(client, _areas(other_hood))
    # An inactive neighbourhood still matches the public listings placed in it.
    assert _id_set(client, _areas(closed_hood)) == {in_closed}


def test_ac3_area_filter_union_with_filters_and_bbox(
    client: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    other_city = insert_settlement(db_engine, 6300, "חיפה")
    third_city = insert_settlement(db_engine, 6400, "עכו")
    owner = make_owner(db_engine, "owner@example.com")
    hood = insert_neighbourhood(db_engine, other_city, 1, [])
    in_city = make_listing(db_engine, owner, gush_dan, price_ils=5000)
    in_hood = make_listing(db_engine, owner, other_city, neighbourhood_id=hood, price_ils=5000)
    dear = make_listing(db_engine, owner, gush_dan, price_ils=9000)
    no_hood = make_listing(db_engine, owner, other_city, price_ils=5000)
    third = make_listing(db_engine, owner, third_city, price_ils=5000)
    for listing in (in_city, dear, no_hood, third):
        set_location(db_engine, listing, 34.80, 32.05)
    set_location(db_engine, in_hood, 34.99, 32.80)  # outside the box
    both = _areas(gush_dan, hood)

    assert _id_set(client, both) == {str(in_city), str(in_hood), str(dear)}
    assert _id_set(client, f"{both}&price_max=6000") == {str(in_city), str(in_hood)}
    box = "west=34.75&south=32.00&east=34.85&north=32.10"
    assert _id_set(client, f"{both}&{box}") == {str(in_city), str(dear)}
    assert _id_set(client, f"{both}&{box}&price_max=6000") == {str(in_city)}


def test_ac4_area_ids_validation(
    client: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing = str(make_listing(db_engine, make_owner(db_engine, "owner@example.com"), gush_dan))

    # An id outside the catalogue is no error, it matches nothing.
    body = _search(client, _areas(uuid.uuid4()))
    assert (body["items"], body["total"]) == ([], 0)
    # A repeated id is harmless.
    assert _id_set(client, _areas(gush_dan, gush_dan)) == {listing}
    # The limit is 20 ids, repeats included.
    assert _id_set(client, _areas(gush_dan, *(uuid.uuid4() for _ in range(19)))) == {listing}
    for query in (
        "area_ids=not-a-uuid",
        "area_ids=",
        _areas(gush_dan, "not-a-uuid"),
        _areas(gush_dan, *(uuid.uuid4() for _ in range(20))),
    ):
        response = client.get(f"/listings?{query}")
        assert response.status_code == 422, (query, response.text)


def test_nf1_area_filter_two_statements(
    client: TestClient, gush_dan: uuid.UUID, db_engine: Engine, statements: list[str]
) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    hood = insert_neighbourhood(db_engine, gush_dan, 1, [])
    for _ in range(25):
        make_listing(db_engine, owner, gush_dan, neighbourhood_id=hood)
    _search(client)  # warm the connection: a first connect sends its own setup statements

    statements.clear()
    body = _search(client, _areas(gush_dan, hood))
    sent = list(statements)

    assert (len(body["items"]), body["total"]) == (20, 25)
    assert len(sent) == 2, sent
    assert all("FROM listings" in statement for statement in sent), sent
