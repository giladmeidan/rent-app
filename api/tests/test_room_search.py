"""Rooms in search, on the map, on their page and in apply (spec 0007b): AC1-AC6 (AC2's 422 half
is also in `test_search.py::test_ac7_validation_rejects_bad_params`, AC6's migration half is
`test_migrations.py::test_ac6_application_listing_type_backfill_and_downgrade`).

Every listing date comes from `test_matching`'s UTC `TODAY` (`_l0`). `R0` is `L0` as a room for
two flatmates, for anyone unless a test says otherwise. A room section is `make_profile(...,
gender=..., flatmate_gender=...)`."""

import datetime as dt
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text

from app.redis_client import get_redis
from tests.conftest import (
    Outbox,
    make_application,
    make_owner,
    make_profile,
    set_location,
    signup,
)
from tests.test_matching import _area, _execute, _ids, _l0, _search, _seeker, _user_id
from tests.test_search import PUBLIC_KEYS

pytestmark = pytest.mark.usefixtures("redis_clean")

NOT_FOUND = {"detail": "not_found"}
BOX = "west=34.75&south=32.00&east=34.85&north=32.10"
INSIDE = (34.80, 32.05)
OUTSIDE = (34.90, 32.20)


@pytest.fixture
def owner(db_engine: Engine) -> uuid.UUID:
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


def _r0(engine: Engine, owner: uuid.UUID, area: uuid.UUID, **overrides: Any) -> str:
    """`R0`: `L0` as a room for two flatmates (`gender_preference` 'any' unless overridden)."""
    return _l0(engine, owner, area, listing_type="room", flatmates_count=2, **overrides)


def _located(engine: Engine, listing_id: str, point: tuple[float, float] = INSIDE) -> str:
    set_location(engine, uuid.UUID(listing_id), *point)
    return listing_id


def _id_set(caller: TestClient, query: str) -> set[str]:
    """The ids of one page of up to 50 matching `query`, checking `total` against them."""
    body = _search(caller, f"{query}&limit=50" if query else "limit=50")
    assert body["total"] == len(body["items"]), (query, body["total"])
    ids = _ids(body)
    assert len(ids) == len(set(ids)), query
    return set(ids)


def _detail(caller: TestClient, listing_id: str) -> dict[str, Any]:
    response = caller.get(f"/listings/{listing_id}")
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _apply(caller: TestClient, listing_id: Any) -> httpx.Response:
    response: httpx.Response = caller.post(
        f"/listings/{listing_id}/applications", json={"message": "Hello there"}
    )
    return response


def _counters(seeker_id: uuid.UUID) -> tuple[int, int]:
    """The seeker's hourly and daily apply counters."""
    r = get_redis()
    values = (r.get(f"rl:apply:user:{seeker_id}"), r.get(f"rl:apply:user:day:{seeker_id}"))
    return (int(values[0] or 0), int(values[1] or 0))


def _applications(engine: Engine, listing_id: Any, seeker_id: uuid.UUID) -> int:
    with engine.connect() as conn:
        count: int = conn.execute(
            text(
                "SELECT count(*) FROM applications WHERE listing_id = :listing"
                " AND seeker_id = :seeker"
            ),
            {"listing": listing_id, "seeker": seeker_id},
        ).scalar_one()
    return count


def _keys(value: Any) -> set[str]:
    """Every dict key at any depth of a JSON body."""
    if isinstance(value, dict):
        return set(value) | {key for item in value.values() for key in _keys(item)}
    if isinstance(value, list):
        return {key for item in value for key in _keys(item)}
    return set()


def test_ac1_rooms_are_public_with_room_fields(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    owner: uuid.UUID,
) -> None:
    room = _r0(
        db_engine,
        owner,
        gush_dan,
        gender_preference="women",
        flatmate_ages=[27, 30],
        lifestyle={"night": 3, "kosher": 2},
    )
    apartment = _l0(db_engine, owner, gush_dan)
    closed = _area(db_engine, "closed", active=False)
    an_hour_ago = dt.datetime.now(dt.UTC) - dt.timedelta(hours=1)
    hidden = [
        _r0(db_engine, owner, gush_dan, status="paused"),
        _r0(db_engine, owner, gush_dan, expires_at=an_hour_ago),
        _r0(db_engine, owner, closed),
    ]
    callers = {
        "owner": signup(client, outbox, "owner2@example.com", "owner"),
        "seeker without a profile": signup(client, outbox, "seeker@example.com", "seeker"),
        "visitor": client,
    }

    unknown = client.get(f"/listings/{uuid.uuid4()}")
    assert unknown.status_code == 404
    assert unknown.json() == NOT_FOUND
    for name, caller in callers.items():
        body = _search(caller)
        assert set(_ids(body)) == {room, apartment}, name
        assert body["total"] == 2, name
        items = {item["id"]: item for item in body["items"]}
        assert set(items[room]) == PUBLIC_KEYS, name
        assert items[room]["listing_type"] == "room"
        assert items[room]["gender_preference"] == "women"
        assert items[room]["flatmates_count"] == 2
        assert items[room]["flatmate_ages"] == [27, 30]
        assert items[room]["lifestyle"] == {"night": 3, "kosher": 2}  # answered keys only
        assert set(items[apartment]) == PUBLIC_KEYS, name
        assert (
            items[apartment]["gender_preference"],
            items[apartment]["flatmates_count"],
            items[apartment]["flatmate_ages"],
            items[apartment]["lifestyle"],
        ) == ("any", None, [], {})

        page = _detail(caller, room)
        assert page["room_fit"] is None, name
        assert {k: v for k, v in page.items() if k not in {"applicant_count", "room_fit"}} == (
            items[room]
        )

        for listing_id in hidden:
            response = caller.get(f"/listings/{listing_id}")
            assert response.status_code == 404, (name, listing_id)
            assert response.content == unknown.content, (name, listing_id)


def test_ac2_listing_type_filter(
    client: TestClient, db_engine: Engine, gush_dan: uuid.UUID, owner: uuid.UUID
) -> None:
    apartments = {_located(db_engine, _l0(db_engine, owner, gush_dan)) for _ in range(2)}
    rooms_inside = {_located(db_engine, _r0(db_engine, owner, gush_dan)) for _ in range(2)}
    room_outside = _located(db_engine, _r0(db_engine, owner, gush_dan), OUTSIDE)

    assert _id_set(client, "listing_type=apartment") == apartments
    assert _id_set(client, "listing_type=room") == {*rooms_inside, room_outside}
    assert _id_set(client, "") == {*apartments, *rooms_inside, room_outside}
    assert _id_set(client, f"listing_type=room&{BOX}") == rooms_inside
    for bad in ("listing_type=house", "listing_type="):
        response = client.get(f"/listings?{bad}")
        assert response.status_code == 422, bad


# AC3's table: a caller with a room section, (gender, flatmates preference) -> the `room_fit` of
# W, M and A (`true` = visible, `false` = hidden from all three searches). Every other caller
# (`_NO_FIT_CALLERS`) sees all four, each with `room_fit` null.
_FIT_TABLE: dict[str, tuple[str, str, tuple[bool, bool, bool]]] = {
    "woman-any": ("woman", "any", (True, False, True)),
    "woman-women": ("woman", "women", (True, False, True)),
    "woman-men": ("woman", "men", (False, False, True)),
    "man-any": ("man", "any", (False, True, True)),
    "man-women": ("man", "women", (False, False, True)),
    "man-men": ("man", "men", (False, True, True)),
    "other-any": ("other", "any", (False, False, True)),
    "other-women": ("other", "women", (False, False, True)),
    "other-men": ("other", "men", (False, False, True)),
}
_NO_FIT_CALLERS = ("no-room-section", "no-profile", "owner", "visitor")


def _caller(
    kind: str, client: TestClient, outbox: Outbox, engine: Engine, area: uuid.UUID
) -> TestClient:
    if kind in _FIT_TABLE:
        gender, flatmates, _ = _FIT_TABLE[kind]
        return _seeker(client, outbox, engine, area, gender=gender, flatmate_gender=flatmates)
    if kind == "no-room-section":
        return _seeker(client, outbox, engine, area)
    if kind == "no-profile":
        return signup(client, outbox, "seeker@example.com", "seeker")
    if kind == "owner":
        return signup(client, outbox, "owner2@example.com", "owner")
    return client


@pytest.mark.parametrize("kind", [*_FIT_TABLE, *_NO_FIT_CALLERS])
def test_ac3_misfit_rooms_hidden_per_seeker(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    owner: uuid.UUID,
    kind: str,
) -> None:
    rooms = {
        name: _located(db_engine, _r0(db_engine, owner, gush_dan, gender_preference=preference))
        for name, preference in (("W", "women"), ("M", "men"), ("A", "any"))
    }
    apartment = _located(db_engine, _l0(db_engine, owner, gush_dan))
    caller = _caller(kind, client, outbox, db_engine, gush_dan)
    if kind in _FIT_TABLE:
        fits: dict[str, bool | None] = dict(zip(rooms, _FIT_TABLE[kind][2], strict=True))
    else:
        fits = dict.fromkeys(rooms)
    visible_rooms = {rooms[name] for name, fit in fits.items() if fit is not False}

    assert _id_set(caller, "") == {*visible_rooms, apartment}
    assert _id_set(caller, BOX) == {*visible_rooms, apartment}  # the map
    assert _id_set(caller, "listing_type=room") == visible_rooms

    for name, listing_id in rooms.items():
        assert _detail(caller, listing_id)["room_fit"] is fits[name], name
    assert _detail(caller, apartment)["room_fit"] is None


def test_ac4_fit_filter_pages_counts_and_adds_no_statement(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    owner: uuid.UUID,
    statements: list[str],
) -> None:
    start = dt.datetime.now(dt.UTC) - dt.timedelta(hours=1)
    fitting: set[str] = set()
    men_rooms: set[str] = set()
    for i in range(30):
        created = start + dt.timedelta(seconds=i)
        # Prices around the 7500 budget, so scores differ and some are capped.
        price = 6000 + (i % 4) * 700
        if i % 6 == 5:  # 5, 11, 17, 23, 29: interleaved with the rest
            men_rooms.add(
                _r0(db_engine, owner, gush_dan, gender_preference="men", created_at=created)
            )
            continue
        kind = i % 3
        if kind == 0:
            listing_id = _l0(db_engine, owner, gush_dan, price_ils=price, created_at=created)
        else:
            listing_id = _r0(
                db_engine,
                owner,
                gush_dan,
                price_ils=price,
                created_at=created,
                gender_preference="any" if kind == 1 else "women",
            )
        fitting.add(listing_id)
    assert (len(fitting), len(men_rooms)) == (25, 5)
    seeker = _seeker(client, outbox, db_engine, gush_dan, gender="woman", flatmate_gender="any")

    whole = _search(seeker, "sort=match&limit=50")
    assert whole["total"] == 25
    assert set(_ids(whole)) == fitting
    paged: list[str] = []
    for offset in (0, 10, 20):
        page = _search(seeker, f"sort=match&limit=10&offset={offset}")
        assert page["total"] == 25, offset
        paged.extend(_ids(page))
    assert paged == _ids(whole)
    assert len(paged) == len(set(paged)) == 25
    assert _search(client)["total"] == 30

    _search(client)  # warm the connection: a first connect sends its own setup statements
    _search(seeker, "limit=10")
    statements.clear()
    body = _search(seeker, "limit=10")
    assert (len(body["items"]), body["total"]) == (10, 25)
    assert len(statements) == 4, statements
    assert "seeker_profiles" in statements[2], statements  # the count
    assert "seeker_profiles" in statements[3], statements  # the page

    statements.clear()
    visitor = _search(client, "limit=10")
    assert (len(visitor["items"]), visitor["total"]) == (10, 30)
    assert len(statements) == 2, statements


def test_ac5_room_apply_gate(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    owner: uuid.UUID,
    statements: list[str],
) -> None:
    w = _r0(db_engine, owner, gush_dan, gender_preference="women")
    m = _r0(db_engine, owner, gush_dan, gender_preference="men")
    a = _r0(db_engine, owner, gush_dan)
    p = _l0(db_engine, owner, gush_dan)

    def refused(caller: TestClient, listing_id: str, detail: str) -> None:
        """A 409 `detail` that writes no application and costs no rate-limit budget."""
        seeker_id = _user_id(caller)
        before = _counters(seeker_id)
        response = _apply(caller, listing_id)
        assert response.status_code == 409, response.text
        assert response.json() == {"detail": detail}
        assert _applications(db_engine, listing_id, seeker_id) == 0
        assert _counters(seeker_id) == before

    def applied(caller: TestClient, listing_id: str) -> None:
        response = _apply(caller, listing_id)
        assert response.status_code == 201, response.text

    no_section = _seeker(client, outbox, db_engine, gush_dan, "plain@example.com")
    refused(no_section, w, "seeker_gender_required")
    applied(no_section, a)
    applied(no_section, p)

    woman_any = _seeker(client, outbox, db_engine, gush_dan, "w-any@example.com", gender="woman")
    refused(woman_any, m, "room_gender_mismatch")
    applied(woman_any, w)

    woman_men = _seeker(
        client,
        outbox,
        db_engine,
        gush_dan,
        "w-men@example.com",
        gender="woman",
        flatmate_gender="men",
    )
    refused(woman_men, w, "room_gender_mismatch")  # the flatmates contradiction

    no_profile = signup(client, outbox, "none@example.com", "seeker")
    refused(no_profile, w, "seeker_profile_required")

    woman_any_id = _user_id(woman_any)
    before = _counters(woman_any_id)
    unknown = _apply(woman_any, uuid.uuid4())
    assert unknown.status_code == 404
    assert unknown.json() == NOT_FOUND
    assert _counters(woman_any_id) == (before[0] + 1, before[1] + 1)

    # The gate runs before the counter.
    limited = _seeker(client, outbox, db_engine, gush_dan, "limited@example.com", gender="woman")
    limited_id = _user_id(limited)
    get_redis().set(f"rl:apply:user:{limited_id}", 10, ex=3600)
    refused(limited, m, "room_gender_mismatch")
    too_many = _apply(limited, w)
    assert too_many.status_code == 429
    assert too_many.json() == {"detail": "rate_limited"}

    fresh = _r0(db_engine, owner, gush_dan)
    woman_any.get("/me")  # warm-up: a first connect sends its own setup statements
    statements.clear()
    assert _apply(woman_any, m).status_code == 409
    assert len(statements) == 3, statements  # session, profile check, listing row
    assert "FROM listings" in statements[2], statements
    statements.clear()
    applied(woman_any, fresh)
    assert len(statements) == 4, statements  # plus the upsert
    assert statements[3].lstrip().startswith("INSERT INTO applications"), statements


def test_ac6_listing_type_snapshot_on_apply_and_reapply(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
) -> None:
    owner_client = signup(client, outbox, "owner2@example.com", "owner")
    owner_id = _user_id(owner_client)
    room = _r0(db_engine, owner_id, gush_dan)
    apartment = _l0(db_engine, owner_id, gush_dan)
    seeker = _seeker(client, outbox, db_engine, gush_dan)
    seeker_id = _user_id(seeker)

    def snapshot(listing_id: str) -> str:
        with db_engine.connect() as conn:
            value: str = conn.execute(
                text(
                    "SELECT listing_type_at_apply FROM applications"
                    " WHERE listing_id = :listing AND seeker_id = :seeker"
                ),
                {"listing": listing_id, "seeker": seeker_id},
            ).scalar_one()
        return value

    bodies: list[Any] = []
    for listing_id in (room, apartment):
        response = _apply(seeker, listing_id)
        assert response.status_code == 201, response.text
        bodies.append(response.json())
    assert snapshot(room) == "room"
    assert snapshot(apartment) == "apartment"

    withdrawn = seeker.post(f"/me/applications/{bodies[1]['id']}/withdraw")
    assert withdrawn.status_code == 200, withdrawn.text
    _execute(
        db_engine,
        "UPDATE listings SET listing_type = 'room', flatmates_count = 2 WHERE id = :id",
        id=apartment,
    )
    reopened = _apply(seeker, apartment)
    assert reopened.status_code == 201, reopened.text
    assert reopened.json()["id"] == bodies[1]["id"]  # the same row, reopened
    bodies.append(reopened.json())
    assert snapshot(apartment) == "room"

    other_apartment = uuid.UUID(_l0(db_engine, owner_id, gush_dan))
    other_seekers = [
        _user_id(signup(client, outbox, f"s{i}@example.com", "seeker")) for i in range(3)
    ]
    for other in other_seekers:
        make_profile(db_engine, other, gush_dan)
    made = {
        "room": make_application(db_engine, uuid.UUID(room), other_seekers[0]),
        "apartment": make_application(db_engine, other_apartment, other_seekers[1]),
        "override": make_application(
            db_engine, other_apartment, other_seekers[2], listing_type_at_apply="room"
        ),
    }
    with db_engine.connect() as conn:
        stored = {
            name: conn.execute(
                text("SELECT listing_type_at_apply FROM applications WHERE id = :id"),
                {"id": application_id},
            ).scalar_one()
            for name, application_id in made.items()
        }
    assert stored == {"room": "room", "apartment": "apartment", "override": "room"}

    mine = seeker.get("/me/applications")
    assert mine.status_code == 200
    bodies.append(mine.json())
    for listing_id in (room, apartment):
        inbox = owner_client.get(f"/listings/{listing_id}/applications")
        assert inbox.status_code == 200, inbox.text
        assert inbox.json()
        bodies.append(inbox.json())
    assert "listing_type_at_apply" not in _keys(bodies)
