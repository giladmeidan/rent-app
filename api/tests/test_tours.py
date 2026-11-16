"""Tours API (spec 0018a): AC1-AC9, AC18, NF1 and the unit tests of window validation, DST
conversion and slot computation. AC10-AC17 are in the files their ACs name.

`O` ("Noa") owns live apartment `L`; `S` ("Dana") has a `shortlisted` application `A` to it (its
chat open). `W` is a window of `L` from `base - 55 min` to `base + 185 min` in 30-minute slots
(`base` = the database's now, to the minute), so its slots start at base -55, -25, +5, +35, +65,
+95, +125 and +155 minutes, and the free ones (at least 60 minutes ahead) are +65 ... +155."""

import datetime as dt
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from functools import partial
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text
from sqlalchemy.exc import IntegrityError

from app.db import get_sessionmaker
from app.models import User
from app.schemas.tours import TourWindowIn
from app.services import chat_events
from app.services import tours as tours_service
from app.services.tours import ISRAEL, InvalidWindowError, _check_shape, _israel, _slots
from tests.conftest import Outbox, make_application, make_flatmate, make_listing, signup
from tests.test_people import _room

pytestmark = pytest.mark.usefixtures("redis_clean")

NOT_FOUND = {"detail": "not_found"}
MIN = dt.timedelta(minutes=1)


def _err(code: str) -> dict[str, str]:
    return {"detail": code}


def _ok(response: httpx.Response, code: int = 200) -> Any:
    assert response.status_code == code, response.text
    return response.json() if response.content else None


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _user_id(caller: TestClient) -> uuid.UUID:
    return uuid.UUID(caller.get("/me").json()["id"])


def _t(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value)


def db_now(engine: Engine) -> dt.datetime:
    now: dt.datetime = _scalar(engine, "SELECT now()")
    return now


def shortlisted(
    engine: Engine, listing_id: uuid.UUID, seeker_id: uuid.UUID, owner_id: uuid.UUID
) -> uuid.UUID:
    """A `shortlisted` application of `seeker_id` to `listing_id` with its chat open (as the
    shortlist opens it, spec 0005a): the application's (and the conversation's) id."""
    application_id = make_application(engine, listing_id, seeker_id, status="shortlisted")
    _execute(
        engine,
        "INSERT INTO conversations (id, application_id, owner_id, seeker_id, owner_read_at)"
        " VALUES (:a, :a, :o, :s, now())",
        a=application_id,
        o=owner_id,
        s=seeker_id,
    )
    return application_id


def make_window(
    engine: Engine,
    listing_id: uuid.UUID,
    starts_at: dt.datetime,
    ends_at: dt.datetime,
    slot_minutes: int = 30,
) -> uuid.UUID:
    """Insert a `tour_windows` row directly (any time, past ones too) and return its id."""
    with engine.begin() as conn:
        window_id: uuid.UUID = conn.execute(
            text(
                "INSERT INTO tour_windows (listing_id, starts_at, ends_at, slot_minutes)"
                " VALUES (:l, :s, :e, :m) RETURNING id"
            ),
            {"l": listing_id, "s": starts_at, "e": ends_at, "m": slot_minutes},
        ).scalar_one()
    return window_id


def make_tour(
    engine: Engine,
    listing_id: uuid.UUID,
    application_id: uuid.UUID,
    seeker_id: uuid.UUID,
    starts_at: dt.datetime,
    minutes: int = 30,
) -> uuid.UUID:
    """Insert a `booked` tour directly (any time, past ones too) and return its id."""
    with engine.begin() as conn:
        tour_id: uuid.UUID = conn.execute(
            text(
                "INSERT INTO tours (listing_id, application_id, seeker_id, starts_at, ends_at)"
                " VALUES (:l, :a, :s, :t, :t + make_interval(mins => :m)) RETURNING id"
            ),
            {"l": listing_id, "a": application_id, "s": seeker_id, "t": starts_at, "m": minutes},
        ).scalar_one()
    return tour_id


def tour_row(engine: Engine, tour_id: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT status, cancelled_by, cancelled_at, starts_at, ends_at, reminder_sent_at,"
                " updated_at FROM tours WHERE id = :id"
            ),
            {"id": tour_id},
        ).one()


def tour_lines(caller: TestClient, conversation_id: Any) -> list[tuple[str, dt.datetime, Any]]:
    """The thread's tour lines as (change, starts_at, sender_name), oldest first."""
    body = _ok(caller.get(f"/conversations/{conversation_id}"))
    lines = []
    for m in body["messages"]:
        if m["tour"] is not None:
            assert m["body"] is None
            lines.append((m["tour"]["change"], _t(m["tour"]["starts_at"]), m["sender_name"]))
        else:
            assert m["body"] is not None
    return lines


def _slots_of(caller: TestClient, application_id: Any) -> list[dt.datetime]:
    body = _ok(caller.get(f"/applications/{application_id}/tour-slots"))
    return [_t(s["starts_at"]) for s in body["slots"]]


def _book(caller: TestClient, application_id: Any, starts_at: dt.datetime) -> httpx.Response:
    response: httpx.Response = caller.post(
        f"/applications/{application_id}/tour", json={"starts_at": starts_at.isoformat()}
    )
    return response


def _reschedule(caller: TestClient, tour_id: Any, starts_at: dt.datetime) -> httpx.Response:
    response: httpx.Response = caller.post(
        f"/tours/{tour_id}/reschedule", json={"starts_at": starts_at.isoformat()}
    )
    return response


def _cancel(caller: TestClient, tour_id: Any) -> httpx.Response:
    response: httpx.Response = caller.post(f"/tours/{tour_id}/cancel")
    return response


def _israel_day(days: int) -> dt.date:
    return (dt.datetime.now(ISRAEL) + dt.timedelta(days=days)).date()


def _window_body(
    day: dt.date, start: str = "18:00", end: str = "20:00", slot: int = 20
) -> dict[str, Any]:
    return {"date": day.isoformat(), "start": start, "end": end, "slot_minutes": slot}


class Published:
    """Stands in for `chat_events.publish`: every call as (set of user ids, conversation id,
    kind)."""

    def __init__(self) -> None:
        self.calls: list[tuple[set[uuid.UUID], uuid.UUID, str]] = []

    def __call__(self, _r: Any, user_ids: Any, conversation_id: uuid.UUID, kind: str) -> None:
        self.calls.append((set(user_ids), conversation_id, kind))


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> Published:
    recorder = Published()
    monkeypatch.setattr(chat_events, "publish", recorder)
    return recorder


@pytest.fixture
def statements(db_engine: Engine) -> Iterator[list[str]]:
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(db_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine, "before_cursor_execute", record)


@pytest.fixture
def owner(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "o@example.com", "owner", display_name="Noa")


@pytest.fixture
def owner_id(owner: TestClient) -> uuid.UUID:
    return _user_id(owner)


@pytest.fixture
def seeker(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "s@example.com", "seeker", display_name="Dana")


@pytest.fixture
def seeker_id(seeker: TestClient) -> uuid.UUID:
    return _user_id(seeker)


@pytest.fixture
def other(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "t@example.com", "seeker", display_name="Tal")


@pytest.fixture
def other_id(other: TestClient) -> uuid.UUID:
    return _user_id(other)


@pytest.fixture
def listing(owner_id: uuid.UUID, gush_dan: uuid.UUID, db_engine: Engine) -> uuid.UUID:
    return make_listing(db_engine, owner_id, gush_dan)


@pytest.fixture
def application(
    listing: uuid.UUID, seeker_id: uuid.UUID, owner_id: uuid.UUID, db_engine: Engine
) -> uuid.UUID:
    return shortlisted(db_engine, listing, seeker_id, owner_id)


@pytest.fixture
def base(db_engine: Engine) -> dt.datetime:
    return db_now(db_engine).replace(second=0, microsecond=0)


@pytest.fixture
def window(listing: uuid.UUID, base: dt.datetime, db_engine: Engine) -> uuid.UUID:
    return make_window(db_engine, listing, base - 55 * MIN, base + 185 * MIN, 30)


def _at(base: dt.datetime, minutes: int) -> dt.datetime:
    return base + minutes * MIN


# --- unit: window validation, DST conversion, slots -------------------------------------------


def test_unit_israel_conversion_and_dst() -> None:
    # Winter is UTC+2, summer UTC+3.
    assert _israel(dt.date(2027, 1, 12), dt.time(18, 0)) == dt.datetime(
        2027, 1, 12, 16, 0, tzinfo=dt.UTC
    )
    assert _israel(dt.date(2027, 7, 12), dt.time(18, 0)) == dt.datetime(
        2027, 7, 12, 15, 0, tzinfo=dt.UTC
    )
    # 2027-03-26: clocks jump 02:00 -> 03:00 (02:30 does not exist); 2027-10-31: 01:00-02:00
    # happens twice (01:30 is ambiguous).
    with pytest.raises(InvalidWindowError):
        _israel(dt.date(2027, 3, 26), dt.time(2, 30))
    with pytest.raises(InvalidWindowError):
        _israel(dt.date(2027, 10, 31), dt.time(1, 30))
    assert _israel(dt.date(2027, 3, 26), dt.time(3, 0)) == dt.datetime(
        2027, 3, 26, 0, 0, tzinfo=dt.UTC
    )


@pytest.mark.parametrize(
    ("start", "end", "slot"),
    [
        ("18:00", "18:00", 20),  # end = start
        ("18:00", "17:00", 20),  # end before start
        ("06:00", "18:15", 15),  # over 12 hours
        ("18:00", "18:50", 20),  # not whole slots
        ("18:03", "19:03", 15),  # a minute not divisible by 5
        ("18:00:30", "19:00", 15),  # seconds
        ("18:00+02:00", "19:00", 15),  # a zone on a wall time
    ],
)
def test_unit_window_shape_refused(start: str, end: str, slot: int) -> None:
    data = TourWindowIn.model_validate(
        {"date": "2027-01-12", "start": start, "end": end, "slot_minutes": slot}
    )
    with pytest.raises(InvalidWindowError):
        _check_shape(data)


def test_unit_window_shape_accepted() -> None:
    for start, end, slot in (
        ("06:00", "18:00", 45),
        ("18:00", "18:15", 15),
        ("00:05", "00:25", 20),
    ):
        _check_shape(
            TourWindowIn.model_validate(
                {"date": "2027-01-12", "start": start, "end": end, "slot_minutes": slot}
            )
        )


def test_unit_slots() -> None:
    now = dt.datetime(2027, 1, 12, 12, 0, tzinfo=dt.UTC)
    windows = [
        (now - 30 * MIN, now + 150 * MIN, 30),  # starts -30, 0, 30, 60, 90, 120
        (now + 31 * dt.timedelta(days=1), now + 31 * dt.timedelta(days=1) + 60 * MIN, 30),
    ]
    booked = {now + 90 * MIN}
    assert _slots(windows, booked, now) == [
        (now + 60 * MIN, now + 90 * MIN),
        (now + 120 * MIN, now + 150 * MIN),
    ]
    # A booked instant in another zone is the same slot; no windows, no slots.
    assert _slots(windows, {(now + 60 * MIN).astimezone(ISRAEL)}, now) == [
        (now + 90 * MIN, now + 120 * MIN),
        (now + 120 * MIN, now + 150 * MIN),
    ]
    assert _slots([], set(), now) == []


# --- AC1-AC9 ---------------------------------------------------------------------------------


def test_ac1_owner_opens_window_in_israel_time(
    owner: TestClient, seeker: TestClient, listing: uuid.UUID, application: uuid.UUID
) -> None:
    day = _israel_day(3)
    created = _ok(owner.post(f"/listings/{listing}/tour-windows", json=_window_body(day)), 201)
    starts_at = dt.datetime.combine(day, dt.time(18, 0), tzinfo=ISRAEL)
    ends_at = dt.datetime.combine(day, dt.time(20, 0), tzinfo=ISRAEL)
    assert _t(created["starts_at"]) == starts_at
    assert _t(created["ends_at"]) == ends_at
    # UTC on the wire, at Israel's offset of that day (+02 in winter, +03 in summer).
    assert _t(created["starts_at"]).utcoffset() == dt.timedelta(0)
    offset = starts_at.utcoffset()
    assert offset in (dt.timedelta(hours=2), dt.timedelta(hours=3))
    assert _t(created["starts_at"]).hour == 18 - offset.seconds // 3600
    assert created["slot_minutes"] == 20 and created["booked"] == []

    listed = _ok(owner.get(f"/listings/{listing}/tour-windows"))
    assert listed == {"listing_live": True, "windows": [created]}
    slots = _ok(seeker.get(f"/applications/{application}/tour-slots"))
    assert slots["listing_live"] is True and slots["tour"] is None
    assert [_t(s["starts_at"]) for s in slots["slots"]] == [
        starts_at + k * 20 * MIN for k in range(6)
    ]
    assert all(_t(s["ends_at"]) - _t(s["starts_at"]) == 20 * MIN for s in slots["slots"])


def test_ac2_window_rules(
    owner: TestClient,
    other: TestClient,
    owner_id: uuid.UUID,
    listing: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    day = _israel_day(2)
    body = _window_body(day)

    def post(caller: TestClient, listing_id: Any, payload: Any = body) -> httpx.Response:
        response: httpx.Response = caller.post(f"/listings/{listing_id}/tour-windows", json=payload)
        return response

    # Not the owner, or unknown: one identical 404, on every window route.
    for response in (
        post(other, listing),
        post(owner, uuid.uuid4()),
        other.get(f"/listings/{listing}/tour-windows"),
        owner.get(f"/listings/{uuid.uuid4()}/tour-windows"),
    ):
        assert (response.status_code, response.json()) == (404, NOT_FOUND)

    # Not live: paused, expired, removed, owner suspended.
    for overrides in (
        {"status": "paused"},
        {"expires_at": dt.datetime.now(dt.UTC) - dt.timedelta(days=1)},
        {"status": "paused", "removed_at": dt.datetime.now(dt.UTC)},
    ):
        dead = make_listing(db_engine, owner_id, gush_dan, **overrides)
        response = post(owner, dead)
        assert (response.status_code, response.json()) == (409, _err("listing_not_live"))
        assert _ok(owner.get(f"/listings/{dead}/tour-windows")) == {
            "listing_live": False,
            "windows": [],
        }
    # A suspended owner has no session (401), so the service itself: their listing is not live.
    _execute(db_engine, "UPDATE users SET suspended_at = now() WHERE id = :id", id=owner_id)
    with get_sessionmaker()() as db:
        user = db.get(User, owner_id)
        assert user is not None
        with pytest.raises(tours_service.ListingNotLiveError):
            tours_service.create_window(db, user, listing, TourWindowIn.model_validate(body))
    _execute(db_engine, "UPDATE users SET suspended_at = NULL WHERE id = :id", id=owner_id)

    # Overlap (touching is fine), then the 31st upcoming window.
    _ok(post(owner, listing), 201)
    response = post(owner, listing, _window_body(day, "19:40", "20:40"))
    assert (response.status_code, response.json()) == (409, _err("window_overlap"))
    _ok(post(owner, listing, _window_body(day, "20:00", "21:00")), 201)
    start = db_now(db_engine) + dt.timedelta(days=5)
    for i in range(tours_service.MAX_UPCOMING_WINDOWS - 2):
        make_window(db_engine, listing, start + i * 60 * MIN, start + i * 60 * MIN + 30 * MIN)
    response = post(owner, listing, _window_body(day, "08:00", "09:00"))
    assert (response.status_code, response.json()) == (409, _err("too_many_windows"))
    # A past window does not count against the cap.
    _execute(
        db_engine,
        "UPDATE tour_windows SET starts_at = starts_at - interval '60 days',"
        " ends_at = ends_at - interval '60 days' WHERE id = (SELECT id FROM tour_windows"
        " WHERE listing_id = :l ORDER BY starts_at DESC LIMIT 1)",
        l=listing,
    )
    _ok(post(owner, listing, _window_body(day, "08:00", "09:00")), 201)

    # The time rules (after the listing's lock): 422 `invalid_window`.
    for payload in (
        _window_body(_israel_day(-1)),  # past
        _window_body(_israel_day(31)),  # beyond the 30-day horizon
        _window_body(dt.date(2027, 3, 26), "02:30", "03:30", 15),  # does not exist (DST)
    ):
        response = post(owner, listing, payload)
        assert (response.status_code, response.json()) == (422, _err("invalid_window")), payload
    # The shape rules: 422 `invalid_window`, before the 404 (rule 8).
    for payload in (
        _window_body(day, "18:00", "18:00"),
        _window_body(day, "18:00", "17:00"),
        _window_body(day, "06:00", "18:15", 15),
        _window_body(day, "18:00", "18:50", 20),
        _window_body(day, "18:03", "19:03", 15),
    ):
        for listing_id in (listing, uuid.uuid4()):
            response = post(owner, listing_id, payload)
            assert (response.status_code, response.json()) == (422, _err("invalid_window")), payload
    # A wrong type or slot length is FastAPI's list.
    for payload in ({**body, "slot_minutes": 25}, {**body, "start": "evening"}, {**body, "x": 1}):
        response = post(owner, listing, payload)
        assert response.status_code == 422 and isinstance(response.json()["detail"], list)


def test_ac3_slots_for_shortlisted_seeker_only(
    owner: TestClient,
    seeker: TestClient,
    other: TestClient,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    other_id: uuid.UUID,
    listing: uuid.UUID,
    application: uuid.UUID,
    window: uuid.UUID,
    base: dt.datetime,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    others = shortlisted(db_engine, listing, other_id, owner_id)
    make_tour(db_engine, listing, others, other_id, _at(base, 95))
    # A past window adds nothing.
    make_window(db_engine, listing, base - 600 * MIN, base - 300 * MIN)
    assert _slots_of(seeker, application) == [_at(base, 65), _at(base, 125), _at(base, 155)]

    # Every other application is one identical 404.
    second = make_listing(db_engine, owner_id, gush_dan)
    for status in ("submitted", "declined", "withdrawn"):
        not_shortlisted = make_application(
            db_engine,
            second,
            seeker_id,
            status=status,
            **({"message": None} if status == "withdrawn" else {}),
        )
        response = seeker.get(f"/applications/{not_shortlisted}/tour-slots")
        assert (response.status_code, response.json()) == (404, NOT_FOUND), status
        _execute(db_engine, "DELETE FROM applications WHERE id = :id", id=not_shortlisted)
    for caller, application_id in (
        (other, application),
        (owner, application),
        (seeker, uuid.uuid4()),
    ):
        response = caller.get(f"/applications/{application_id}/tour-slots")
        assert (response.status_code, response.json()) == (404, NOT_FOUND)

    # Not live: no slots, the current tour still shown.
    _execute(db_engine, "UPDATE listings SET status = 'paused' WHERE id = :id", id=listing)
    body = _ok(other.get(f"/applications/{others}/tour-slots"))
    assert body["listing_live"] is False and body["slots"] == []
    assert _t(body["tour"]["starts_at"]) == _at(base, 95) and body["tour"]["status"] == "booked"


def test_ac4_book_writes_line_and_event(
    owner: TestClient,
    seeker: TestClient,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    application: uuid.UUID,
    window: uuid.UUID,
    base: dt.datetime,
    db_engine: Engine,
    published: Published,
) -> None:
    tour = _ok(_book(seeker, application, _at(base, 65).astimezone(ISRAEL)), 201)
    assert tour["status"] == "booked"
    assert (_t(tour["starts_at"]), _t(tour["ends_at"])) == (_at(base, 65), _at(base, 95))
    row = tour_row(db_engine, tour["id"])
    assert (row.status, row.cancelled_by, row.ends_at) == ("booked", None, _at(base, 95))
    assert published.calls == [({owner_id, seeker_id}, application, "message")]
    # The seeker sent it: unread for the owner only; it is both lists' newest message.
    (mine,) = _ok(seeker.get("/me/conversations"))
    (theirs,) = _ok(owner.get("/me/conversations"))
    assert (mine["unread_count"], theirs["unread_count"]) == (0, 1)
    for item, is_mine in ((mine, True), (theirs, False)):
        last = item["last_message"]
        assert last["body"] is None and last["mine"] is is_mine
        assert last["tour"]["change"] == "booked"
        assert _t(last["tour"]["starts_at"]) == _at(base, 65)
    for caller in (owner, seeker):
        assert tour_lines(caller, application) == [("booked", _at(base, 65), "Dana")]
    slots = _ok(seeker.get(f"/applications/{application}/tour-slots"))
    assert slots["tour"] == tour
    assert _at(base, 65) not in [_t(s["starts_at"]) for s in slots["slots"]]


def test_ac5_book_refusals(
    seeker: TestClient,
    other_id: uuid.UUID,
    owner_id: uuid.UUID,
    listing: uuid.UUID,
    application: uuid.UUID,
    window: uuid.UUID,
    base: dt.datetime,
    db_engine: Engine,
) -> None:
    others = shortlisted(db_engine, listing, other_id, owner_id)
    make_tour(db_engine, listing, others, other_id, _at(base, 95))
    for starts_at in (
        _at(base, 95),  # taken
        _at(base, 75),  # between slots
        _at(base, 35),  # too soon (lead time)
        _at(base, 245),  # outside every window
        _at(base, 65) + dt.timedelta(seconds=1),
    ):
        response = _book(seeker, application, starts_at)
        assert (response.status_code, response.json()) == (409, _err("slot_unavailable")), starts_at
    _ok(_book(seeker, application, _at(base, 65)), 201)
    response = _book(seeker, application, _at(base, 125))
    assert (response.status_code, response.json()) == (409, _err("tour_exists"))
    # A naive time is FastAPI's 422; an unknown application a 404.
    response = seeker.post(
        f"/applications/{application}/tour", json={"starts_at": "2027-01-12T18:00:00"}
    )
    assert response.status_code == 422 and isinstance(response.json()["detail"], list)
    response = _book(seeker, uuid.uuid4(), _at(base, 125))
    assert (response.status_code, response.json()) == (404, NOT_FOUND)

    _execute(db_engine, "UPDATE listings SET status = 'paused' WHERE id = :id", id=listing)
    _execute(
        db_engine,
        "UPDATE tours SET status = 'cancelled', cancelled_by = 'seeker',"
        " cancelled_at = now() WHERE application_id = :a",
        a=application,
    )
    response = _book(seeker, application, _at(base, 125))
    assert (response.status_code, response.json()) == (409, _err("listing_not_live"))


def test_ac6_concurrent_bookings(
    seeker_id: uuid.UUID,
    other_id: uuid.UUID,
    owner_id: uuid.UUID,
    listing: uuid.UUID,
    application: uuid.UUID,
    window: uuid.UUID,
    base: dt.datetime,
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    others = shortlisted(db_engine, listing, other_id, owner_id)
    real_slot_end = tours_service._slot_end

    def slow_slot_end(*args: Any) -> dt.datetime:
        end = real_slot_end(*args)
        time.sleep(0.3)  # widen the check-then-insert window so the two calls overlap
        return end

    monkeypatch.setattr(tours_service, "_slot_end", slow_slot_end)

    def race(calls: list[tuple[uuid.UUID, uuid.UUID, dt.datetime]]) -> list[str]:
        start = threading.Barrier(len(calls), timeout=10)
        outcomes: list[str] = []

        def run(user_id: uuid.UUID, application_id: uuid.UUID, at: dt.datetime) -> None:
            with get_sessionmaker()() as db:
                user = db.get(User, user_id)
                assert user is not None
                start.wait()
                try:
                    tours_service.book(db, user, application_id, at)
                    outcomes.append("booked")
                except (tours_service.SlotUnavailableError, tours_service.TourExistsError) as exc:
                    outcomes.append(type(exc).__name__)
                except Exception as exc:  # pragma: no cover - reported by the assertion below
                    outcomes.append(repr(exc))

        threads = [threading.Thread(target=run, args=call) for call in calls]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)
        return sorted(outcomes)

    same_slot = [(seeker_id, application, _at(base, 65)), (other_id, others, _at(base, 65))]
    assert race(same_slot) == ["SlotUnavailableError", "booked"]
    assert _scalar(db_engine, "SELECT count(*) FROM tours") == 1
    _execute(db_engine, "DELETE FROM tours")
    _execute(db_engine, "DELETE FROM messages")
    two_slots = [(seeker_id, application, _at(base, 95)), (seeker_id, application, _at(base, 125))]
    assert race(two_slots) == ["TourExistsError", "booked"]
    assert (
        _scalar(db_engine, "SELECT count(*) FROM tours WHERE application_id = :a", a=application)
        == 1
    )


def test_ac7_reschedule_by_seeker_only(
    owner: TestClient,
    seeker: TestClient,
    client: TestClient,
    outbox: Outbox,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    gush_dan: uuid.UUID,
    base: dt.datetime,
    db_engine: Engine,
    published: Published,
) -> None:
    room = uuid.UUID(_room(db_engine, owner_id, gush_dan))
    application = shortlisted(db_engine, room, seeker_id, owner_id)
    make_window(db_engine, room, base - 55 * MIN, base + 185 * MIN, 30)
    mate = signup(client, outbox, "f@example.com", "seeker", display_name="Fay")
    make_flatmate(db_engine, room, _user_id(mate))
    tour = _ok(_book(seeker, application, _at(base, 65)), 201)
    _execute(db_engine, "UPDATE tours SET reminder_sent_at = now() WHERE id = :id", id=tour["id"])
    before = tour_row(db_engine, tour["id"])
    published.calls.clear()

    for caller in (owner, mate):
        response = _reschedule(caller, tour["id"], _at(base, 95))
        assert (response.status_code, response.json()) == (404, NOT_FOUND)
    response = _reschedule(seeker, uuid.uuid4(), _at(base, 95))
    assert (response.status_code, response.json()) == (404, NOT_FOUND)
    # Its own slot is not free; nor is one between slots.
    for starts_at in (_at(base, 65), _at(base, 80)):
        response = _reschedule(seeker, tour["id"], starts_at)
        assert (response.status_code, response.json()) == (409, _err("slot_unavailable"))

    moved = _ok(_reschedule(seeker, tour["id"], _at(base, 95)))
    assert moved["id"] == tour["id"] and moved["status"] == "booked"
    assert (_t(moved["starts_at"]), _t(moved["ends_at"])) == (_at(base, 95), _at(base, 125))
    row = tour_row(db_engine, tour["id"])
    assert row.reminder_sent_at is None and row.updated_at > before.updated_at
    assert _scalar(db_engine, "SELECT count(*) FROM tours") == 1
    assert _at(base, 65) in _slots_of(seeker, application)
    assert tour_lines(seeker, application) == [
        ("booked", _at(base, 65), "Dana"),
        ("rescheduled", _at(base, 95), "Dana"),
    ]
    assert published.calls == [({owner_id, seeker_id}, application, "message")]

    # Not shortlisted any more: 404; listing not live: 409.
    _execute(db_engine, "UPDATE listings SET status = 'paused' WHERE id = :id", id=room)
    response = _reschedule(seeker, tour["id"], _at(base, 125))
    assert (response.status_code, response.json()) == (409, _err("listing_not_live"))
    _execute(
        db_engine, "UPDATE applications SET status = 'submitted' WHERE id = :id", id=application
    )
    response = _reschedule(seeker, tour["id"], _at(base, 125))
    assert (response.status_code, response.json()) == (404, NOT_FOUND)


def test_ac8_cancel_either_side(
    owner: TestClient,
    seeker: TestClient,
    client: TestClient,
    outbox: Outbox,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    gush_dan: uuid.UUID,
    base: dt.datetime,
    db_engine: Engine,
    published: Published,
) -> None:
    room = uuid.UUID(_room(db_engine, owner_id, gush_dan))
    application = shortlisted(db_engine, room, seeker_id, owner_id)
    make_window(db_engine, room, base - 55 * MIN, base + 185 * MIN, 30)
    mate = signup(client, outbox, "f@example.com", "seeker", display_name="Fay")
    make_flatmate(db_engine, room, _user_id(mate))

    first = _ok(_book(seeker, application, _at(base, 65)), 201)
    response = _cancel(mate, first["id"])
    assert (response.status_code, response.json()) == (404, NOT_FOUND)
    published.calls.clear()
    cancelled = _ok(_cancel(seeker, first["id"]))
    assert cancelled["status"] == "cancelled"
    row = tour_row(db_engine, first["id"])
    assert (row.cancelled_by, row.cancelled_at is not None) == ("seeker", True)
    assert published.calls == [({owner_id, seeker_id}, application, "message")]
    response = _cancel(seeker, first["id"])
    assert (response.status_code, response.json()) == (409, _err("tour_not_cancellable"))

    # The slot is free again at once; the owner cancels the next one.
    assert _at(base, 65) in _slots_of(seeker, application)
    second = _ok(_book(seeker, application, _at(base, 65)), 201)
    _ok(_cancel(owner, second["id"]))
    assert tour_row(db_engine, second["id"]).cancelled_by == "lister"
    assert tour_lines(owner, application) == [
        ("booked", _at(base, 65), "Dana"),
        ("cancelled_by_seeker", _at(base, 65), "Dana"),
        ("booked", _at(base, 65), "Dana"),
        ("cancelled_by_lister", _at(base, 65), "Noa"),
    ]

    # A started tour cannot be cancelled; an unknown one is a 404.
    started = make_tour(db_engine, room, application, seeker_id, base - 25 * MIN)
    response = _cancel(owner, started)
    assert (response.status_code, response.json()) == (409, _err("tour_not_cancellable"))
    response = _cancel(owner, uuid.uuid4())
    assert (response.status_code, response.json()) == (404, NOT_FOUND)


def test_ac9_delete_window(
    owner: TestClient,
    other: TestClient,
    seeker_id: uuid.UUID,
    listing: uuid.UUID,
    application: uuid.UUID,
    window: uuid.UUID,
    base: dt.datetime,
    db_engine: Engine,
) -> None:
    tour_id = make_tour(db_engine, listing, application, seeker_id, _at(base, 65))
    listed = _ok(owner.get(f"/listings/{listing}/tour-windows"))
    (item,) = listed["windows"]
    assert item["booked"] == [
        {
            "tour_id": str(tour_id),
            "starts_at": item["booked"][0]["starts_at"],
            "seeker_name": "Dana",
            "conversation_id": str(application),
        }
    ]
    assert _t(item["booked"][0]["starts_at"]) == _at(base, 65)
    for caller, window_id in ((other, window), (owner, uuid.uuid4())):
        response = caller.delete(f"/tour-windows/{window_id}")
        assert (response.status_code, response.json()) == (404, NOT_FOUND)
    response = owner.delete(f"/tour-windows/{window}")
    assert (response.status_code, response.json()) == (409, _err("window_has_tours"))

    # Only a past tour (and a cancelled one) left: it deletes.
    _execute(
        db_engine,
        "UPDATE tours SET starts_at = :s, ends_at = :e WHERE id = :id",
        s=base - 55 * MIN,
        e=base - 25 * MIN,
        id=tour_id,
    )
    assert _ok(owner.delete(f"/tour-windows/{window}"), 204) is None
    assert _scalar(db_engine, "SELECT count(*) FROM tour_windows") == 0
    assert tour_row(db_engine, tour_id).status == "booked"  # the tour row stays
    empty = make_window(db_engine, listing, base + 600 * MIN, base + 660 * MIN)
    assert _ok(owner.delete(f"/tour-windows/{empty}"), 204) is None


def test_ac18_checks(
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    listing: uuid.UUID,
    application: uuid.UUID,
    base: dt.datetime,
    db_engine: Engine,
) -> None:
    tour_id = make_tour(db_engine, listing, application, seeker_id, _at(base, 65))
    for statement in (
        # both a body and a tour change
        "INSERT INTO messages (conversation_id, sender_id, body, tour_id, tour_change,"
        " tour_starts_at) VALUES (:a, :s, 'hi', :t, 'booked', now())",
        # neither
        "INSERT INTO messages (conversation_id, sender_id) VALUES (:a, :s)",
        # a tour change with no tour
        "INSERT INTO messages (conversation_id, sender_id, tour_change, tour_starts_at)"
        " VALUES (:a, :s, 'booked', now())",
        "INSERT INTO messages (conversation_id, sender_id, tour_id, tour_change, tour_starts_at)"
        " VALUES (:a, :s, :t, 'moved', now())",
        # no body and no change, the tour columns set
        "INSERT INTO messages (conversation_id, sender_id, tour_id, tour_starts_at)"
        " VALUES (:a, :s, :t, now())",
        "UPDATE tours SET status = 'cancelled', cancelled_at = now() WHERE id = :t",
        "UPDATE tours SET cancelled_by = 'seeker' WHERE id = :t",
        "UPDATE tours SET status = 'cancelled', cancelled_by = 'admin', cancelled_at = now()"
        " WHERE id = :t",
        "UPDATE tours SET ends_at = starts_at WHERE id = :t",
        "INSERT INTO tour_windows (listing_id, starts_at, ends_at, slot_minutes)"
        " VALUES (:l, now(), now() + interval '50 minutes', 20)",
        "INSERT INTO tour_windows (listing_id, starts_at, ends_at, slot_minutes)"
        " VALUES (:l, now(), now() + interval '13 hours', 15)",
        "INSERT INTO tour_windows (listing_id, starts_at, ends_at, slot_minutes)"
        " VALUES (:l, now(), now() + interval '50 minutes', 25)",
    ):
        with db_engine.begin() as conn, pytest.raises(IntegrityError):
            conn.execute(
                text(statement), {"a": application, "s": seeker_id, "t": tour_id, "l": listing}
            )
    # A second booked tour on the same slot.
    with pytest.raises(IntegrityError):
        make_tour(db_engine, listing, application, seeker_id, _at(base, 65))
    # The valid kinds pass.
    _execute(
        db_engine,
        "INSERT INTO messages (conversation_id, sender_id, tour_id, tour_change, tour_starts_at)"
        " VALUES (:a, :s, :t, 'cancelled_by_system', now())",
        a=application,
        s=owner_id,
        t=tour_id,
    )
    _execute(
        db_engine,
        "UPDATE tours SET status = 'cancelled', cancelled_by = 'system', cancelled_at = now()"
        " WHERE id = :t",
        t=tour_id,
    )


def test_nf1_statement_counts(
    owner: TestClient,
    seeker: TestClient,
    other_id: uuid.UUID,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    listing: uuid.UUID,
    application: uuid.UUID,
    base: dt.datetime,
    db_engine: Engine,
    statements: list[str],
) -> None:
    def measure(call: Callable[[], httpx.Response], code: int = 200) -> int:
        statements.clear()
        response = call()
        assert response.status_code == code, response.text
        return len(statements) - 1  # after the session lookup

    owner.get("/me")  # warm-up: a first connect sends its own setup statements
    seeker.get("/me")
    others = shortlisted(db_engine, listing, other_id, owner_id)

    def reads() -> tuple[int, int]:
        return (
            measure(partial(owner.get, f"/listings/{listing}/tour-windows")),
            measure(partial(seeker.get, f"/applications/{application}/tour-slots")),
        )

    # Windows of two 30-minute slots, the first one booked.
    starts = [base + (600 + 120 * i) * MIN for i in range(5)]
    for at in starts:
        make_window(db_engine, listing, at, at + 60 * MIN)
        make_tour(db_engine, listing, others, other_id, at)
        if at == starts[0]:
            one = reads()
    five = reads()
    assert one == five and one[0] <= 3 and one[1] <= 3, (one, five)

    day = _israel_day(3)
    writes = {
        "create": measure(
            partial(owner.post, f"/listings/{listing}/tour-windows", json=_window_body(day)), 201
        ),
    }
    window_id = owner.get(f"/listings/{listing}/tour-windows").json()["windows"][-1]["id"]
    writes["delete"] = measure(partial(owner.delete, f"/tour-windows/{window_id}"), 204)
    statements.clear()
    tour = _ok(_book(seeker, application, starts[0] + 30 * MIN), 201)
    writes["book"] = len(statements) - 1
    writes["reschedule"] = measure(partial(_reschedule, seeker, tour["id"], starts[1] + 30 * MIN))
    writes["cancel"] = measure(partial(_cancel, owner, tour["id"]))
    assert all(count <= 8 for count in writes.values()), writes
    assert "INSERT INTO messages" in " ".join(statements)
