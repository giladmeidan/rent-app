"""The tours agenda, `GET /tours` (spec 0018b): AC1-AC8.

`O` ("Noa") owns an apartment `A` and a room `R`; `S` ("Dana") and `Y` ("Yael") have shortlisted
applications to them. `T` ("Tal") is a third account with no tour. Every tour is inserted with
SQL (0018a's `make_tour`), at offsets from the database's now."""

import datetime as dt
import uuid
from collections.abc import Iterator
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event

from tests.conftest import Outbox, make_listing, make_seeker, signup
from tests.test_tours import _execute, _ok, _user_id, db_now, make_tour, shortlisted

pytestmark = pytest.mark.usefixtures("redis_clean")

HOUR = dt.timedelta(hours=1)


@pytest.fixture
def owner(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "o@example.com", "owner", display_name="Noa")


@pytest.fixture
def seeker(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "s@example.com", "seeker", display_name="Dana")


@pytest.fixture
def third(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "t@example.com", "seeker", display_name="Tal")


@pytest.fixture
def owner_id(owner: TestClient) -> uuid.UUID:
    return _user_id(owner)


@pytest.fixture
def seeker_id(seeker: TestClient) -> uuid.UUID:
    return _user_id(seeker)


@pytest.fixture
def yael_id(db_engine: Engine) -> uuid.UUID:
    return make_seeker(db_engine, "y@example.com", "Yael")


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


def _tour(
    engine: Engine,
    owner_id: uuid.UUID,
    listing: uuid.UUID,
    seeker_id: uuid.UUID,
    starts_at: dt.datetime,
) -> tuple[uuid.UUID, uuid.UUID]:
    """A booked tour of `seeker_id` on `listing` (shortlisted, chat open): (tour, application)."""
    application = shortlisted(engine, listing, seeker_id, owner_id)
    return make_tour(engine, listing, application, seeker_id, starts_at), application


def test_ac1_lister_sees_tours_across_listings(
    owner: TestClient,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    yael_id: uuid.UUID,
    apartment: uuid.UUID,
    room: uuid.UUID,
    now: dt.datetime,
    db_engine: Engine,
) -> None:
    flat_tour, flat_chat = _tour(db_engine, owner_id, apartment, seeker_id, now + 3 * HOUR)
    room_tour, room_chat = _tour(db_engine, owner_id, room, yael_id, now + 2 * HOUR)
    rows = _ok(owner.get("/tours"))
    assert [r["id"] for r in rows] == [str(room_tour), str(flat_tour)]
    assert [r["role"] for r in rows] == ["lister", "lister"]
    assert [r["other_name"] for r in rows] == ["Yael", "Dana"]
    assert [r["conversation_id"] for r in rows] == [str(room_chat), str(flat_chat)]
    assert rows[0]["listing"] == {
        "id": str(room),
        "listing_type": "room",
        "rooms": 2.5,
        "street": "הרצל",
        "city": "תל אביב",
    }
    assert rows[1]["listing"] == {
        "id": str(apartment),
        "listing_type": "apartment",
        "rooms": 3.5,
        "street": "כצנלסון",
        "city": "גבעתיים",
    }
    starts = [dt.datetime.fromisoformat(r["starts_at"]) for r in rows]
    assert starts == [now + 2 * HOUR, now + 3 * HOUR]
    assert all(
        dt.datetime.fromisoformat(r["ends_at"]) - s == dt.timedelta(minutes=30)
        for r, s in zip(rows, starts, strict=True)
    )


def test_ac2_seeker_sees_own_tour(
    owner_id: uuid.UUID,
    seeker: TestClient,
    seeker_id: uuid.UUID,
    yael_id: uuid.UUID,
    apartment: uuid.UUID,
    room: uuid.UUID,
    now: dt.datetime,
    db_engine: Engine,
) -> None:
    tour, chat = _tour(db_engine, owner_id, apartment, seeker_id, now + 3 * HOUR)
    _tour(db_engine, owner_id, room, yael_id, now + 2 * HOUR)
    rows = _ok(seeker.get("/tours"))
    assert len(rows) == 1
    assert (rows[0]["id"], rows[0]["role"], rows[0]["other_name"]) == (str(tour), "seeker", "Noa")
    assert rows[0]["conversation_id"] == str(chat)
    assert rows[0]["listing"]["id"] == str(apartment)


def test_ac3_only_own_upcoming_booked_tours(
    owner: TestClient,
    seeker: TestClient,
    third: TestClient,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    yael_id: uuid.UUID,
    apartment: uuid.UUID,
    gush_dan: uuid.UUID,
    now: dt.datetime,
    db_engine: Engine,
) -> None:
    kept, _ = _tour(db_engine, owner_id, apartment, seeker_id, now + 5 * HOUR)
    cancelled, _ = _tour(db_engine, owner_id, apartment, yael_id, now + 6 * HOUR)
    _execute(
        db_engine,
        "UPDATE tours SET status = 'cancelled', cancelled_by = 'lister', cancelled_at = now()"
        " WHERE id = :id",
        id=cancelled,
    )
    # Over already: started 2 h ago, 30 minutes long.
    _tour(db_engine, owner_id, apartment, make_seeker(db_engine, "z@example.com"), now - 2 * HOUR)
    # Someone else's listing and seeker.
    stranger = make_seeker(db_engine, "w@example.com", "Wali")
    stranger_listing = make_listing(db_engine, stranger, gush_dan)
    _tour(db_engine, stranger, stranger_listing, yael_id, now + 4 * HOUR)

    assert [r["id"] for r in _ok(owner.get("/tours"))] == [str(kept)]
    assert [r["id"] for r in _ok(seeker.get("/tours"))] == [str(kept)]
    assert _ok(third.get("/tours")) == []


def test_ac4_in_progress_tour_listed(
    owner: TestClient,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    apartment: uuid.UUID,
    now: dt.datetime,
    db_engine: Engine,
) -> None:
    tour, _ = _tour(db_engine, owner_id, apartment, seeker_id, now - dt.timedelta(minutes=10))
    assert [r["id"] for r in _ok(owner.get("/tours"))] == [str(tour)]


def test_ac5_expired_listing_stays_people_drop_out(
    owner: TestClient,
    seeker: TestClient,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    yael_id: uuid.UUID,
    apartment: uuid.UUID,
    room: uuid.UUID,
    now: dt.datetime,
    db_engine: Engine,
) -> None:
    flat_tour, _ = _tour(db_engine, owner_id, apartment, seeker_id, now + 2 * HOUR)
    room_tour, _ = _tour(db_engine, owner_id, room, yael_id, now + 3 * HOUR)
    # Still booked, so still listed: an expired listing, an inactive area.
    _execute(
        db_engine,
        "UPDATE listings SET expires_at = now() - interval '1 day' WHERE id = :id",
        id=apartment,
    )
    _execute(
        db_engine,
        "UPDATE areas SET is_active = false"
        " WHERE id = (SELECT area_id FROM listings WHERE id = :id)",
        id=room,
    )
    assert [r["id"] for r in _ok(owner.get("/tours"))] == [str(flat_tour), str(room_tour)]
    assert [r["id"] for r in _ok(seeker.get("/tours"))] == [str(flat_tour)]

    # A suspended seeker drops out of the lister's list (Yael's tour); a deleted one too.
    _execute(db_engine, "UPDATE users SET suspended_at = now() WHERE id = :id", id=yael_id)
    assert [r["id"] for r in _ok(owner.get("/tours"))] == [str(flat_tour)]
    _execute(
        db_engine,
        "UPDATE users SET deleted_at = now(), email = NULL, display_name = NULL WHERE id = :id",
        id=seeker_id,
    )
    # (The deleted seeker has no session now; the owner's list is what matters.)
    assert _ok(owner.get("/tours")) == []


def test_ac5_lister_gone_drops_out_of_seekers_list(
    seeker: TestClient,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    apartment: uuid.UUID,
    now: dt.datetime,
    db_engine: Engine,
) -> None:
    _tour(db_engine, owner_id, apartment, seeker_id, now + 2 * HOUR)
    assert len(_ok(seeker.get("/tours"))) == 1
    _execute(db_engine, "UPDATE users SET suspended_at = now() WHERE id = :id", id=owner_id)
    assert _ok(seeker.get("/tours")) == []
    _execute(
        db_engine,
        "UPDATE users SET suspended_at = NULL, deleted_at = now(), email = NULL,"
        " display_name = NULL WHERE id = :id",
        id=owner_id,
    )
    assert _ok(seeker.get("/tours")) == []


def test_ac6_requires_login(client: TestClient) -> None:
    response = client.get("/tours")
    assert (response.status_code, response.json()) == (401, {"detail": "unauthenticated"})


def test_ac7_capped_at_limit(
    owner: TestClient,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    apartment: uuid.UUID,
    now: dt.datetime,
    db_engine: Engine,
) -> None:
    application = shortlisted(db_engine, apartment, seeker_id, owner_id)
    _execute(
        db_engine,
        "INSERT INTO tours (listing_id, application_id, seeker_id, starts_at, ends_at)"
        " SELECT :l, :a, :s, :t + make_interval(mins => 60 * n),"
        " :t + make_interval(mins => 60 * n + 30)"
        " FROM generate_series(1, 201) AS n",
        l=apartment,
        a=application,
        s=seeker_id,
        t=now,
    )
    rows = _ok(owner.get("/tours"))
    assert len(rows) == 200
    assert [dt.datetime.fromisoformat(r["starts_at"]) for r in rows] == [
        now + n * HOUR for n in range(1, 201)
    ]


def test_ac8_one_statement(
    owner: TestClient,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    apartment: uuid.UUID,
    room: uuid.UUID,
    yael_id: uuid.UUID,
    now: dt.datetime,
    db_engine: Engine,
    statements: list[str],
) -> None:
    _tour(db_engine, owner_id, apartment, seeker_id, now + 2 * HOUR)
    _tour(db_engine, owner_id, room, yael_id, now + 3 * HOUR)
    statements.clear()
    assert len(_ok(owner.get("/tours"))) == 2
    # The session lookup is the other one; the agenda itself is a single `tours` read.
    agenda = [s for s in statements if "FROM tours" in s]
    assert len(agenda) == 1
    assert sum("UNION ALL" in s for s in statements) == 1
