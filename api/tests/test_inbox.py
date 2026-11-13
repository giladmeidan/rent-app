"""Owner inbox API (spec 0004c): applicants per listing, shortlist / decline, counts on
`GET /me/listings`. AC1-AC6.

Match in the inbox (spec 0006c): each applicant's match and housing summary, sorted by match.
AC1-AC8 are the `test_ac*_` functions after `# --- 0006c`. `L0` / `P0` are 0006b's
(`test_matching.py`): `L0` scores 100 for `P0` (`make_profile`'s defaults); every date is UTC, as
the database's `current_date` is.

Rooms in the inbox (spec 0007c): a room application's `room` (gender, age, answers), never an
apartment application's, whatever the listing later becomes. AC1-AC5 are the `test_ac*_` functions
after `# --- 0007c`."""

import datetime as dt
import json
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text

from app.schemas.listing import ListingOut
from tests.conftest import (
    Outbox,
    make_application,
    make_listing,
    make_owner,
    make_profile,
    make_seeker,
    signup,
)
from tests.test_listings import _body
from tests.test_matching import _area

pytestmark = pytest.mark.usefixtures("redis_clean")

APPLICANT_KEYS = {
    "id",
    "status",
    "message",
    "applicant_name",
    "created_at",
    "updated_at",
    "match",
    "profile",
    "room",  # 0007c
    "source",  # 0008a
}
COUNT_KEYS = {
    "applicant_count",
    "new_applicant_count",
    "liked_me_count",  # 0008a
    "flatmate_count",  # 0008d
    "flatmate_invite_active",  # 0008d
}
LISTING_OUT_KEYS = set(ListingOut.model_fields)
NOT_FOUND = {"detail": "not_found"}
INVALID_TRANSITION = {"detail": "invalid_transition"}
MICHAL = "מיכל"


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _user_id(caller: TestClient) -> uuid.UUID:
    return uuid.UUID(caller.get("/me").json()["id"])


def _applicants(caller: TestClient, listing_id: Any, sort: str | None = None) -> httpx.Response:
    params = {} if sort is None else {"sort": sort}
    response: httpx.Response = caller.get(f"/listings/{listing_id}/applications", params=params)
    return response


def _set_status(
    caller: TestClient, listing_id: Any, application_id: Any, body: Any
) -> httpx.Response:
    response: httpx.Response = caller.patch(
        f"/listings/{listing_id}/applications/{application_id}", json=body
    )
    return response


def _row(engine: Engine, application_id: Any) -> tuple[str, dt.datetime]:
    with engine.connect() as conn:
        status, updated_at = conn.execute(
            text("SELECT status, updated_at FROM applications WHERE id = :id"),
            {"id": str(application_id)},
        ).one()
    return status, updated_at


def _all_rows(engine: Engine) -> list[tuple[Any, ...]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, status, updated_at FROM applications ORDER BY id")
        ).all()
    return [tuple(row) for row in rows]


def _created_ago(engine: Engine, application_id: Any, seconds: int) -> None:
    _execute(
        engine,
        "UPDATE applications SET created_at = now() - make_interval(secs => :s) WHERE id = :id",
        s=seconds,
        id=str(application_id),
    )


def _applicant_count(caller: TestClient, listing_id: Any) -> int:
    response = caller.get(f"/listings/{listing_id}")
    assert response.status_code == 200, response.text
    count: int = response.json()["applicant_count"]
    return count


@pytest.fixture
def owner(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "o@example.com", "owner")


@pytest.fixture
def statements(db_engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement the app engine sends while the test records (`.clear()` to start)."""
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(db_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine, "before_cursor_execute", record)


def test_ac1_owner_lists_applicants(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    owner_id = _user_id(owner)
    listing_a = make_listing(db_engine, owner_id, gush_dan)
    listing_b = make_listing(db_engine, owner_id, gush_dan)
    other_owner = make_owner(db_engine, "other@example.com")
    other_listing = make_listing(db_engine, other_owner, gush_dan)
    seekers: dict[str, uuid.UUID] = {}
    applications: dict[str, uuid.UUID] = {}
    for name, status, seconds in (
        (MICHAL, "submitted", 1),
        ("Omer", "shortlisted", 2),
        ("Dana", "declined", 3),
        ("Gone", "withdrawn", 0),
    ):
        seekers[name] = make_seeker(db_engine, f"applicant-{seconds}@example.com", name)
        applications[name] = make_application(
            db_engine, listing_a, seekers[name], status=status, message=f"Hi from {seconds}"
        )
        _created_ago(db_engine, applications[name], seconds)
    stranger = make_seeker(db_engine, "stranger@example.com", "Stranger")
    stranger_application = make_application(db_engine, other_listing, stranger)

    def assert_three(response: httpx.Response) -> None:
        assert response.status_code == 200, response.text
        body = response.json()
        assert [item["applicant_name"] for item in body] == [MICHAL, "Omer", "Dana"]
        assert [item["status"] for item in body] == ["submitted", "shortlisted", "declined"]
        assert [item["id"] for item in body] == [
            str(applications[name]) for name in (MICHAL, "Omer", "Dana")
        ]
        assert [item["message"] for item in body] == ["Hi from 1", "Hi from 2", "Hi from 3"]
        for item in body:
            assert set(item) == APPLICANT_KEYS
            assert item["source"] == "apply"  # 0008a
        assert "@example.com" not in response.text
        for seeker_id in (*seekers.values(), stranger):
            assert str(seeker_id) not in response.text
        assert str(applications["Gone"]) not in response.text
        assert "Gone" not in response.text
        assert str(stranger_application) not in response.text
        assert "seeker_id" not in response.text

    assert_three(_applicants(owner, listing_a))

    _execute(db_engine, "UPDATE listings SET status = 'paused' WHERE id = :id", id=str(listing_a))
    assert_three(_applicants(owner, listing_a))

    _execute(
        db_engine,
        "UPDATE listings SET status = 'active', expires_at = now() - interval '1 hour'"
        " WHERE id = :id",
        id=str(listing_a),
    )
    assert_three(_applicants(owner, listing_a))

    empty = _applicants(owner, listing_b)
    assert empty.status_code == 200
    assert empty.json() == []


def test_ac1_reapply_counts_as_new_and_ties_order_by_id(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    # Gilad, 2026-11-10: a re-apply counts as new, so it sorts first (newest first).
    listing = make_listing(db_engine, _user_id(owner), gush_dan)
    x = signup(client, outbox, "x@example.com", "seeker")
    y = signup(client, outbox, "y@example.com", "seeker")
    for applicant in (x, y):
        make_profile(db_engine, _user_id(applicant), gush_dan)
    x_application = x.post(f"/listings/{listing}/applications", json={"message": "X here"}).json()
    y_response = y.post(f"/listings/{listing}/applications", json={"message": "Y here"})
    assert y_response.status_code == 201, y_response.text
    y_application = y_response.json()["id"]
    assert [i["id"] for i in _applicants(owner, listing).json()] == [
        y_application,
        x_application["id"],
    ]

    assert y.post(f"/me/applications/{y_application}/withdraw").status_code == 200
    assert [i["id"] for i in _applicants(owner, listing).json()] == [x_application["id"]]
    again = y.post(f"/listings/{listing}/applications", json={"message": "Y again"})
    assert again.status_code == 201, again.text
    assert again.json()["id"] == y_application
    assert [i["id"] for i in _applicants(owner, listing).json()] == [
        y_application,
        x_application["id"],
    ]

    third = make_application(db_engine, listing, make_seeker(db_engine, "z@example.com"))
    _execute(
        db_engine,
        "UPDATE applications SET created_at = '2026-01-01T00:00:00+00' WHERE listing_id = :id",
        id=str(listing),
    )
    expected = _scalar(
        db_engine,
        "SELECT array_agg(id::text ORDER BY id) FROM applications WHERE listing_id = :id",
        id=str(listing),
    )
    assert len(expected) == 3
    assert third in {uuid.UUID(e) for e in expected}
    # `x` and `y` have a profile and `third` none, so match order would put `third` last (0006c).
    assert [i["id"] for i in _applicants(owner, listing, sort="newest").json()] == expected


def test_ac2_applicants_are_the_listers_only(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    listing_a = make_listing(db_engine, _user_id(owner), gush_dan)
    applicant = make_seeker(db_engine, "applicant@example.com")
    make_application(db_engine, listing_a, applicant)

    anonymous = _applicants(client, listing_a)
    assert anonymous.status_code == 401
    assert anonymous.json() == {"detail": "unauthenticated"}

    # Spec 0010b: no role gate; a seeker on another's listing is the unknown id's 404.
    seeker = signup(client, outbox, "s@example.com", "seeker")
    other = signup(client, outbox, "o2@example.com", "owner")
    unknown = _applicants(other, uuid.uuid4())
    for caller in (seeker, other):
        foreign = _applicants(caller, listing_a)
        assert foreign.status_code == 404
        assert unknown.status_code == 404
        assert foreign.json() == unknown.json() == NOT_FOUND
        assert foreign.content == unknown.content

    malformed = _applicants(owner, "not-a-uuid")
    assert malformed.status_code == 422


def test_ac3_any_account_runs_its_room_inbox(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    """Spec 0010b AC3: a seeker lists their room's applicants and shortlists one, which opens the
    chat; another account gets the unknown id's 404 on both."""
    lister = signup(client, outbox, "lister@example.com", "seeker")
    room = make_listing(
        db_engine, _user_id(lister), gush_dan, listing_type="room", flatmates_count=2
    )
    applicant = signup(client, outbox, "applicant@example.com", "seeker")
    application = make_application(db_engine, room, _user_id(applicant))
    before = _all_rows(db_engine)

    for other in (
        signup(client, outbox, "seeker2@example.com", "seeker"),
        signup(client, outbox, "owner2@example.com", "owner"),
    ):
        listed = _applicants(other, room)
        changed = _set_status(other, room, application, {"status": "shortlisted"})
        for response in (listed, changed):
            assert response.status_code == 404
            assert response.json() == NOT_FOUND
    assert _all_rows(db_engine) == before

    listed = _applicants(lister, room)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [str(application)]
    shortlisted = _set_status(lister, room, application, {"status": "shortlisted"})
    assert shortlisted.status_code == 200, shortlisted.text
    assert shortlisted.json()["status"] == "shortlisted"
    # The chat opens for both sides.
    for caller in (lister, applicant):
        chats = caller.get("/me/conversations")
        assert chats.status_code == 200
        assert [chat["id"] for chat in chats.json()] == [str(application)]


def test_ac3_applicants_is_three_statements(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine, statements: list[str]
) -> None:
    owner_id = _user_id(owner)
    listing_a = make_listing(db_engine, owner_id, gush_dan)
    listing_c = make_listing(db_engine, owner_id, gush_dan)
    for listing_id, count in ((listing_a, 3), (listing_c, 25)):
        for n in range(count):
            seeker_id = make_seeker(db_engine, f"{listing_id}-{n}@example.com", f"Seeker {n}")
            make_application(db_engine, listing_id, seeker_id)

    _applicants(owner, listing_a)  # warm-up: a first connect sends its own setup statements
    for listing_id, count in ((listing_a, 3), (listing_c, 25)):
        statements.clear()
        measured = _applicants(owner, listing_id)
        sent = list(statements)
        assert measured.status_code == 200
        assert len(measured.json()) == count
        assert len(sent) == 3, sent
        assert "FROM listings" in sent[1]
        assert sum("FROM applications" in statement for statement in sent) == 1


# (current status, target status, expected code, no-op) - the 9 cells of the transition table's
# first three columns (spec 0004c API).
CELLS = (
    ("submitted", "shortlisted", 200, False),
    ("shortlisted", "shortlisted", 200, True),
    ("declined", "shortlisted", 409, False),
    ("submitted", "submitted", 200, True),
    ("shortlisted", "submitted", 200, False),
    ("declined", "submitted", 409, False),
    ("submitted", "declined", 200, False),
    ("shortlisted", "declined", 200, False),
    ("declined", "declined", 200, True),
)


def test_ac4_status_transitions(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    statements: list[str],
) -> None:
    owner_id = _user_id(owner)
    listing_a = make_listing(db_engine, owner_id, gush_dan)
    a_day_ago = dt.datetime.now(dt.UTC) - dt.timedelta(days=1)
    cells: list[tuple[uuid.UUID, str, str, str, int, bool]] = []
    for current, target, code, no_op in CELLS:
        name = f"{current} to {target}"
        seeker_id = make_seeker(db_engine, f"{current}-{target}@example.com", name)
        application_id = make_application(
            db_engine,
            listing_a,
            seeker_id,
            status=current,
            created_at=a_day_ago,
            updated_at=a_day_ago,
        )
        cells.append((application_id, name, current, target, code, no_op))

    seeker = signup(client, outbox, "s@example.com", "seeker")
    make_profile(db_engine, _user_id(seeker), gush_dan)
    applied = seeker.post(f"/listings/{listing_a}/applications", json={"message": "Hello there"})
    assert applied.status_code == 201, applied.text
    s_application = applied.json()["id"]
    applicant_count = _applicant_count(client, listing_a)
    assert applicant_count == 10

    owner.get("/me")  # warm-up: a first connect sends its own setup statements
    measured_ok = measured_conflict = False
    for application_id, name, current, target, code, no_op in cells:
        _, before = _row(db_engine, application_id)
        statements.clear()
        response = _set_status(owner, listing_a, application_id, {"status": target})
        sent = list(statements)
        if code == 200 and not no_op and not measured_ok:
            measured_ok = True
            # The session lookup, the one UPDATE, the chat it opens (spec 0005a), then the
            # response row (spec 0006c).
            assert len(sent) == 4, sent
            assert "UPDATE applications" in sent[1]
            assert "FROM listings" in sent[1]
            assert "RETURNING" in sent[1]
            assert "INSERT INTO conversations" in sent[2]
            assert "FROM applications" in sent[3]
        if code == 409 and not measured_conflict:
            measured_conflict = True
            assert len(sent) == 3, sent  # lookup, UPDATE, then the follow-up SELECT
        assert response.status_code == code, (current, target, response.text)
        status, after = _row(db_engine, application_id)
        if code == 200:
            body = response.json()
            assert set(body) == APPLICANT_KEYS
            assert body["source"] == "apply"  # 0008a
            assert body["id"] == str(application_id)
            assert body["status"] == target
            assert body["applicant_name"] == name
            assert status == target
            assert dt.datetime.fromisoformat(body["updated_at"]) == after
            if no_op:
                assert after == before, (current, target)
            else:
                assert after > before, (current, target)
        else:
            assert response.json() == INVALID_TRANSITION
            assert (status, after) == (current, before)
        assert _applicant_count(client, listing_a) == applicant_count

    listing_e = make_listing(db_engine, owner_id, gush_dan)
    _execute(db_engine, "UPDATE listings SET status = 'paused' WHERE id = :id", id=str(listing_e))
    e_seeker = make_seeker(db_engine, "e@example.com", "Eden")
    e_application = make_application(db_engine, listing_e, e_seeker)
    paused = _set_status(owner, listing_e, e_application, {"status": "shortlisted"})
    assert paused.status_code == 200, paused.text
    assert paused.json()["status"] == "shortlisted"
    assert _row(db_engine, e_application)[0] == "shortlisted"

    listing_x = make_listing(db_engine, owner_id, gush_dan)
    _execute(
        db_engine,
        "UPDATE listings SET expires_at = now() - interval '1 hour' WHERE id = :id",
        id=str(listing_x),
    )
    x_seeker = make_seeker(db_engine, "x-expired@example.com", "Xena")
    x_application = make_application(db_engine, listing_x, x_seeker)
    expired = _set_status(owner, listing_x, x_application, {"status": "shortlisted"})
    assert expired.status_code == 200, expired.text
    assert expired.json()["status"] == "shortlisted"
    assert _row(db_engine, x_application)[0] == "shortlisted"

    for target in ("shortlisted", "declined"):
        response = _set_status(owner, listing_a, s_application, {"status": target})
        assert response.status_code == 200, response.text
        mine = seeker.get("/me/applications").json()
        assert [item["status"] for item in mine if item["id"] == s_application] == [target]
        assert _applicant_count(client, listing_a) == applicant_count


def test_ac5_patch_ownership_and_validation(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    owner_x = _user_id(owner)
    listing_a = make_listing(db_engine, owner_x, gush_dan)
    listing_b = make_listing(db_engine, owner_x, gush_dan)
    owner_y = make_owner(db_engine, "y@example.com")
    listing_d = make_listing(db_engine, owner_y, gush_dan)
    p = make_application(db_engine, listing_a, make_seeker(db_engine, "p@example.com"))
    q = make_application(db_engine, listing_b, make_seeker(db_engine, "q@example.com"))
    r = make_application(db_engine, listing_d, make_seeker(db_engine, "r@example.com"))
    withdrawn = make_application(
        db_engine, listing_a, make_seeker(db_engine, "w@example.com"), status="withdrawn"
    )
    before = _all_rows(db_engine)
    shortlist = {"status": "shortlisted"}

    not_found = [
        _set_status(owner, listing_a, q, shortlist),  # an application of a different listing
        _set_status(owner, listing_d, r, shortlist),  # another owner's listing
        _set_status(owner, listing_a, uuid.uuid4(), shortlist),  # unknown application
        _set_status(owner, listing_a, withdrawn, shortlist),  # withdrawn
        _set_status(owner, uuid.uuid4(), p, shortlist),  # unknown listing
    ]
    for response in not_found:
        assert response.status_code == 404, response.text
        assert response.json() == NOT_FOUND
    assert len({response.content for response in not_found}) == 1
    assert _all_rows(db_engine) == before

    for body in ({"status": "withdrawn"}, {"status": "open"}, {}):
        response = _set_status(owner, listing_a, p, body)
        assert response.status_code == 422, (body, response.text)
    assert _set_status(owner, listing_a, "not-a-uuid", shortlist).status_code == 422
    assert _set_status(owner, "not-a-uuid", p, shortlist).status_code == 422

    anonymous = _set_status(client, listing_a, p, shortlist)
    assert anonymous.status_code == 401
    assert anonymous.json() == {"detail": "unauthenticated"}
    # Spec 0010b: no role gate; a seeker on another's listing is the unknown id's 404.
    seeker = signup(client, outbox, "s@example.com", "seeker")
    not_theirs = _set_status(seeker, listing_a, p, shortlist)
    assert not_theirs.status_code == 404
    assert not_theirs.content == not_found[0].content

    assert _all_rows(db_engine) == before


def test_ac6_my_listings_counts(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine, statements: list[str]
) -> None:
    owner_id = _user_id(owner)
    listing_a = make_listing(db_engine, owner_id, gush_dan)
    listing_b = make_listing(db_engine, owner_id, gush_dan)
    for n, status in enumerate(("submitted", "submitted", "shortlisted", "declined", "withdrawn")):
        seeker_id = make_seeker(db_engine, f"{status}-{n}@example.com")
        make_application(db_engine, listing_a, seeker_id, status=status)
    # Owners do not see view_count (Gilad, 2026-11-10): set, to prove it is not exposed.
    _execute(db_engine, "UPDATE listings SET view_count = 7 WHERE id = :id", id=str(listing_a))

    response = owner.get("/me/listings")

    assert response.status_code == 200, response.text
    by_id = {item["id"]: item for item in response.json()}
    assert set(by_id) == {str(listing_a), str(listing_b)}
    for item in by_id.values():
        assert set(item) == LISTING_OUT_KEYS | COUNT_KEYS
        assert "view_count" not in item
    counts = {
        listing_id: (item["applicant_count"], item["new_applicant_count"])
        for listing_id, item in by_id.items()
    }
    assert counts == {str(listing_a): (4, 2), str(listing_b): (0, 0)}

    owner.get("/me/listings")  # warm-up: a first connect sends its own setup statements
    statements.clear()
    measured = owner.get("/me/listings")
    sent = list(statements)
    assert measured.status_code == 200
    assert len(sent) == 2, sent

    created = owner.post("/listings", json=_body(gush_dan))
    assert created.status_code == 201, created.text
    assert not set(created.json()) & COUNT_KEYS
    patched = owner.patch(f"/listings/{created.json()['id']}", json={"price_ils": 7500})
    assert patched.status_code == 200, patched.text
    assert not set(patched.json()) & COUNT_KEYS


def test_ac6_counts_follow_transitions(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    listing = make_listing(db_engine, _user_id(owner), gush_dan)
    other_owner = make_owner(db_engine, "other@example.com")
    other_listing = make_listing(db_engine, other_owner, gush_dan)
    seeker_1 = make_seeker(db_engine, "s1@example.com")
    seeker_2 = make_seeker(db_engine, "s2@example.com")
    first = make_application(db_engine, listing, seeker_1)
    second = make_application(db_engine, listing, seeker_2)
    third_seeker = signup(client, outbox, "s3@example.com", "seeker")
    make_profile(db_engine, _user_id(third_seeker), gush_dan)
    applied = third_seeker.post(f"/listings/{listing}/applications", json={"message": "Hello"})
    assert applied.status_code == 201, applied.text
    third = applied.json()["id"]
    stranger = make_seeker(db_engine, "stranger@example.com")
    stranger_application = make_application(db_engine, other_listing, stranger)

    def counts() -> tuple[int, int]:
        items = {i["id"]: i for i in owner.get("/me/listings").json()}
        return items[str(listing)]["applicant_count"], items[str(listing)]["new_applicant_count"]

    assert counts() == (3, 3)
    assert _set_status(owner, listing, first, {"status": "shortlisted"}).status_code == 200
    assert counts() == (3, 2)
    assert _set_status(owner, listing, second, {"status": "declined"}).status_code == 200
    assert counts() == (3, 1)
    assert third_seeker.post(f"/me/applications/{third}/withdraw").status_code == 200
    assert counts() == (2, 0)
    assert _set_status(owner, listing, first, {"status": "submitted"}).status_code == 200
    assert counts() == (2, 1)
    # another owner's applications never change these counts
    assert (
        _set_status(owner, other_listing, stranger_application, {"status": "declined"}).status_code
        == 404
    )
    _execute(
        db_engine,
        "UPDATE applications SET status = 'shortlisted' WHERE id = :id",
        id=str(stranger_application),
    )
    assert counts() == (2, 1)


# --- 0006c: match and housing summary per applicant ------------------------------------------

PROFILE_KEYS = {
    "household",
    "move_in_date",
    "move_in_flexible",
    "has_pets",
    "smoker",
    "contract_months",
    "parking_needed",
}
MATCH_KEYS = {"score", "agrees", "differs"}
TOP3 = ["budget", "move_in", "area"]


def _utc_day(days: int) -> dt.date:
    return dt.datetime.now(dt.UTC).date() + dt.timedelta(days=days)


def _l0(engine: Engine, owner_id: uuid.UUID, area: uuid.UUID, **overrides: Any) -> uuid.UUID:
    """`L0` (0006b): 7000, available UTC today + 30, not flexible, all households, smoking allowed,
    no minimum contract, one parking spot, pets allowed; `overrides` win."""
    values: dict[str, Any] = {
        "price_ils": 7000,
        "available_from": _utc_day(30),
        "entry_flexible": False,
        "accepted_households": ["single", "couple", "family", "roommates"],
        "smoking_allowed": True,
        "min_contract_months": None,
        "parking_spots": 1,
        "pets_allowed": True,
        **overrides,
    }
    return make_listing(engine, owner_id, area, **values)


def _p0_out() -> dict[str, Any]:
    """`P0`'s `profile` as the owner sees it."""
    return {
        "household": "couple",
        "move_in_date": _utc_day(30).isoformat(),
        "move_in_flexible": False,
        "has_pets": False,
        "smoker": False,
        "contract_months": 24,
        "parking_needed": 1,
    }


def _p0_body(area: uuid.UUID, **overrides: Any) -> dict[str, Any]:
    """`P0` as a `PUT /me/profile` body (every field)."""
    return {
        **_p0_out(),
        "budget_max_ils": 7500,
        "area_ids": [str(area)],
        **overrides,
    }


def _match(score: int, agrees: list[str], differs: str | None) -> dict[str, Any]:
    return {"score": score, "agrees": agrees, "differs": differs}


def _profiled_seeker(
    engine: Engine, email: str, area: uuid.UUID, name: str = MICHAL, **profile: Any
) -> uuid.UUID:
    seeker_id = make_seeker(engine, email, name)
    make_profile(engine, seeker_id, area, **profile)
    return seeker_id


def _ok(response: httpx.Response) -> Any:
    assert response.status_code == 200, response.text
    return response.json()


def _by_id(body: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {item["id"]: item for item in body}


def _keys_and_numbers(value: Any) -> tuple[set[str], list[float]]:
    """Every key at any depth of parsed JSON, and every number (booleans excluded)."""
    keys: set[str] = set()
    numbers: list[float] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key, child in node.items():
                keys.add(key)
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)
        elif isinstance(node, int | float) and not isinstance(node, bool):
            numbers.append(node)

    walk(value)
    return keys, numbers


@pytest.fixture
def scored_inbox(owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine) -> dict[str, uuid.UUID]:
    """AC1's `A` = `L0` with S1 (`P0`, 100), S2 (`P0` with budget 6000, 59) and S3 (no profile),
    applied 1 s apart, oldest first; and a withdrawn S4 with a profile."""
    ids: dict[str, uuid.UUID] = {"A": _l0(db_engine, _user_id(owner), gush_dan)}
    seekers = {
        "S1": _profiled_seeker(db_engine, "s1@example.com", gush_dan, "S1"),
        "S2": _profiled_seeker(db_engine, "s2@example.com", gush_dan, "S2", budget_max_ils=6000),
        "S3": make_seeker(db_engine, "s3@example.com", "S3"),
        "S4": _profiled_seeker(db_engine, "s4@example.com", gush_dan, "S4"),
    }
    for seconds, (name, seeker_id) in zip((4, 3, 2, 1), seekers.items(), strict=True):
        status = "withdrawn" if name == "S4" else "submitted"
        ids[name] = make_application(db_engine, ids["A"], seeker_id, status=status)
        _created_ago(db_engine, ids[name], seconds)
    return ids


def test_ac1_applicants_sorted_by_match(
    owner: TestClient, scored_inbox: dict[str, uuid.UUID]
) -> None:
    body = _ok(_applicants(owner, scored_inbox["A"]))

    assert [item["id"] for item in body] == [str(scored_inbox[n]) for n in ("S1", "S2", "S3")]
    assert [item["applicant_name"] for item in body] == ["S1", "S2", "S3"]
    for item in body:
        assert set(item) == APPLICANT_KEYS
    s1, s2, s3 = body
    assert s1["match"] == _match(100, TOP3, None)
    assert s2["match"] == _match(59, ["move_in", "area", "household"], "budget")
    assert s3["match"] is None
    assert s3["profile"] is None
    assert set(s1["profile"]) == PROFILE_KEYS
    assert s1["profile"] == _p0_out()
    assert s2["profile"] == _p0_out()


def test_ac2_sort_newest_and_invalid(owner: TestClient, scored_inbox: dict[str, uuid.UUID]) -> None:
    by_match = _by_id(_ok(_applicants(owner, scored_inbox["A"])))
    newest = _ok(_applicants(owner, scored_inbox["A"], sort="newest"))

    assert [item["id"] for item in newest] == [str(scored_inbox[n]) for n in ("S3", "S2", "S1")]
    for item in newest:
        assert item["match"] == by_match[item["id"]]["match"]
        assert item["profile"] == by_match[item["id"]]["profile"]
    assert _ok(_applicants(owner, scored_inbox["A"], sort="match")) == list(by_match.values())

    for invalid in ("score", "", "MATCH"):
        response = _applicants(owner, scored_inbox["A"], sort=invalid)
        assert response.status_code == 422, (invalid, response.text)


def test_ac3_match_ties_and_nulls(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing = _l0(db_engine, _user_id(owner), gush_dan)
    seekers = {
        "older_100": _profiled_seeker(db_engine, "a@example.com", gush_dan),
        "newer_100": _profiled_seeker(db_engine, "b@example.com", gush_dan),
        # Budget, move-in (d = 70) and area fail: 10 + 10 + 5 + 5 + 5 = 35.
        "s5_35": _profiled_seeker(
            db_engine,
            "c@example.com",
            gush_dan,
            area_ids=[uuid.uuid4()],
            budget_max_ils=6000,
            move_in_date=_utc_day(100),
        ),
        "older_none": make_seeker(db_engine, "d@example.com"),
        "newer_none": make_seeker(db_engine, "e@example.com"),
    }
    applications: dict[str, uuid.UUID] = {}
    # Oldest first, so newest-first alone would put both unscored applicants on top.
    for seconds, (name, seeker_id) in zip((5, 4, 3, 2, 1), seekers.items(), strict=True):
        applications[name] = make_application(db_engine, listing, seeker_id)
        _created_ago(db_engine, applications[name], seconds)

    body = _ok(_applicants(owner, listing))

    expected = ["newer_100", "older_100", "s5_35", "newer_none", "older_none"]
    assert [item["id"] for item in body] == [str(applications[n]) for n in expected]
    assert [item["match"] and item["match"]["score"] for item in body] == [
        100,
        100,
        35,
        None,
        None,
    ]
    assert body[2]["match"] == _match(35, ["household", "contract", "parking"], "budget")
    assert [item["profile"] is None for item in body] == [False, False, False, True, True]

    # On `L0` (available today + 30) an unscored row's meaningless `m_score` is 25, below S5's 35,
    # so the order above holds even on score alone. Available today, it is 45 (move-in counts as
    # met): only "applicants with a profile first" keeps S5 ahead.
    today_listing = _l0(db_engine, _user_id(owner), gush_dan, available_from=_utc_day(0))
    late = make_application(db_engine, today_listing, seekers["s5_35"])
    _created_ago(db_engine, late, 2)
    unscored = make_application(db_engine, today_listing, seekers["newer_none"])
    _created_ago(db_engine, unscored, 1)
    today_body = _ok(_applicants(owner, today_listing))
    assert [item["id"] for item in today_body] == [str(late), str(unscored)]
    assert today_body[0]["match"]["score"] == 35
    assert today_body[1]["match"] is None


def test_ac4_still_three_statements(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine, statements: list[str]
) -> None:
    owner_id = _user_id(owner)
    listing_a = _l0(db_engine, owner_id, gush_dan)
    listing_c = _l0(db_engine, owner_id, gush_dan)
    for listing_id, count in ((listing_a, 3), (listing_c, 25)):
        for n in range(count):
            email = f"{listing_id}-{n}@example.com"
            if n % 2:
                seeker_id = _profiled_seeker(db_engine, email, gush_dan)
            else:
                seeker_id = make_seeker(db_engine, email)
            make_application(db_engine, listing_id, seeker_id)

    _applicants(owner, listing_a)  # warm-up: a first connect sends its own setup statements
    for listing_id, count in ((listing_a, 3), (listing_c, 25)):
        for sort in (None, "newest"):
            statements.clear()
            measured = _applicants(owner, listing_id, sort=sort)
            sent = list(statements)
            body = _ok(measured)
            assert len(body) == count
            assert sum(item["match"] is not None for item in body) == count // 2
            assert len(sent) == 3, sent  # the session lookup, the ownership check, the list
            assert "FROM listings" in sent[1]
            assert sum("FROM applications" in statement for statement in sent) == 1
            assert "seeker_profiles" in sent[2]


def test_ac5_patch_returns_scored_applicant(
    owner: TestClient,
    scored_inbox: dict[str, uuid.UUID],
    db_engine: Engine,
    statements: list[str],
) -> None:
    listing = scored_inbox["A"]
    owner.get("/me")  # warm-up: a first connect sends its own setup statements

    statements.clear()
    patched = _ok(_set_status(owner, listing, scored_inbox["S1"], {"status": "shortlisted"}))
    sent = list(statements)
    assert len(sent) == 4, sent
    assert "UPDATE applications" in sent[1]
    assert "INSERT INTO conversations" in sent[2]
    assert "FROM applications" in sent[3]
    assert not sent[3].lstrip().upper().startswith(("UPDATE", "INSERT"))

    assert patched["status"] == "shortlisted"
    assert patched["match"] == _match(100, TOP3, None)
    assert patched["profile"] == _p0_out()
    listed = _by_id(_ok(_applicants(owner, listing)))
    assert patched == listed[str(scored_inbox["S1"])]
    assert (
        _scalar(
            db_engine,
            "SELECT count(*) FROM conversations WHERE application_id = :a",
            a=str(scored_inbox["S1"]),
        )
        == 1
    )

    unscored = _ok(_set_status(owner, listing, scored_inbox["S3"], {"status": "shortlisted"}))
    assert set(unscored) == APPLICANT_KEYS
    assert unscored["status"] == "shortlisted"
    assert unscored["match"] is None
    assert unscored["profile"] is None

    for application, target in (
        (scored_inbox["S1"], "submitted"),
        (scored_inbox["S2"], "declined"),
    ):
        statements.clear()
        body = _ok(_set_status(owner, listing, application, {"status": target}))
        sent = list(statements)
        assert len(sent) == 3, (target, sent)
        assert "UPDATE applications" in sent[1]
        assert "FROM applications" in sent[2]
        assert body == _by_id(_ok(_applicants(owner, listing)))[str(application)]
        assert body["match"] is not None


def test_ac6_owner_never_sees_budget_or_areas(
    owner: TestClient, scored_inbox: dict[str, uuid.UUID], gush_dan: uuid.UUID
) -> None:
    # S1 has `P0`'s budget 7500 and area_ids [gush_dan].
    listing = scored_inbox["A"]
    listed = _applicants(owner, listing)
    patched = _set_status(owner, listing, scored_inbox["S1"], {"status": "shortlisted"})

    for response in (listed, patched):
        body = _ok(response)
        keys, numbers = _keys_and_numbers(body)
        assert "budget_max_ils" not in keys
        assert "area_ids" not in keys
        assert 7500 not in numbers
        assert str(gush_dan) not in response.text
    s1 = _by_id(listed.json())[str(scored_inbox["S1"])]
    assert set(s1["match"]) == MATCH_KEYS
    assert set(patched.json()["match"]) == MATCH_KEYS


def test_ac7_owner_and_seeker_see_the_same_score(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    listing = _l0(db_engine, _user_id(owner), gush_dan)
    seeker = signup(client, outbox, "s1@example.com", "seeker")
    # Ten days late: move-in scores 18/28, so the score is not a round 100 (93).
    make_profile(db_engine, _user_id(seeker), gush_dan, move_in_date=_utc_day(40))
    applied = seeker.post(f"/listings/{listing}/applications", json={"message": "Hello there"})
    assert applied.status_code == 201, applied.text

    seen_by_seeker = _ok(seeker.get(f"/listings/{listing}"))["match"]
    seen_by_owner = _by_id(_ok(_applicants(owner, listing)))[applied.json()["id"]]["match"]

    assert seen_by_owner == seen_by_seeker
    assert seen_by_owner["score"] == 93


def test_ac8_score_follows_profile_edits(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    listing_b = _l0(db_engine, _user_id(owner), gush_dan, pets_allowed=False)
    seeker = signup(client, outbox, "s1@example.com", "seeker")
    make_profile(db_engine, _user_id(seeker), gush_dan)
    applied = seeker.post(f"/listings/{listing_b}/applications", json={"message": "Hello there"})
    assert applied.status_code == 201, applied.text
    s1 = applied.json()["id"]
    assert _by_id(_ok(_applicants(owner, listing_b)))[s1]["match"] == _match(100, TOP3, None)

    edited = seeker.put("/me/profile", json=_p0_body(gush_dan, has_pets=True))
    assert edited.status_code == 200, edited.text

    item = _by_id(_ok(_applicants(owner, listing_b)))[s1]
    assert item["match"] == _match(59, TOP3, "pets")
    assert item["profile"] == {**_p0_out(), "has_pets": True}


# --- 0006c, security B1: the owner's budget / area criteria use the listing as applied to


def _edit_listing(owner: TestClient, listing_id: Any, body: dict[str, Any]) -> None:
    response = owner.patch(f"/listings/{listing_id}", json=body)
    assert response.status_code == 200, response.text


def _switch_type(engine: Engine, listing_id: Any, to: str, lifestyle: str = "{}") -> None:
    """Switch a listing's type by SQL, as a listing switched before spec 0010a would be (an edit can
    no longer switch it). To a room: two flatmates and `lifestyle`; to an apartment: the room
    fields reset to `ROOM_FIELD_DEFAULTS` and no invite link, as 0007e's switch wrote them."""
    if to == "room":
        sql = (
            "UPDATE listings SET listing_type = 'room', flatmates_count = 2,"
            " lifestyle = CAST(:lifestyle AS jsonb) WHERE id = :id"
        )
    else:
        sql = (
            "UPDATE listings SET listing_type = 'apartment', gender_preference = 'any',"
            " flatmates_count = NULL, flatmate_ages = '{}', lifestyle = '{}'::jsonb,"
            " flatmate_invite_hash = NULL WHERE id = :id"
        )
    _execute(engine, sql, id=listing_id, lifestyle=lifestyle)


def _owner_match(owner: TestClient, listing_id: Any, application_id: str) -> Any:
    return _by_id(_ok(_applicants(owner, listing_id)))[application_id]["match"]


def _patched_match(owner: TestClient, listing_id: Any, application_id: str, status: str) -> Any:
    return _ok(_set_status(owner, listing_id, application_id, {"status": status}))["match"]


def test_ac9_owner_match_ignores_price_and_area_edits_after_apply(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    north = _area(db_engine, "north", active=True)
    listing = _l0(db_engine, _user_id(owner), gush_dan)
    seeker = signup(client, outbox, "s1@example.com", "seeker")
    make_profile(db_engine, _user_id(seeker), gush_dan)  # P0: budget 7500, areas [gush_dan]
    applied = seeker.post(f"/listings/{listing}/applications", json={"message": "Hello there"})
    assert applied.status_code == 201, applied.text
    s1 = applied.json()["id"]
    assert set(applied.json()) == {
        "id",
        "status",
        "source",  # 0008a
        "message",
        "created_at",
        "updated_at",
        "listing",
    }
    snapshot = "SELECT price_ils_at_apply, area_id_at_apply FROM applications WHERE id = :a"
    with db_engine.connect() as conn:
        assert tuple(conn.execute(text(snapshot), {"a": s1}).one()) == (7000, gush_dan)
    full = _match(100, TOP3, None)
    assert _owner_match(owner, listing, s1) == full

    # Price above the budget: the seeker's own view is live, the owner's is not.
    _edit_listing(owner, listing, {"price_ils": 8000})
    assert _ok(seeker.get(f"/listings/{listing}"))["match"] == _match(
        59, ["move_in", "area", "household"], "budget"
    )
    assert _owner_match(owner, listing, s1) == full
    assert _patched_match(owner, listing, s1, "shortlisted") == full
    assert _owner_match(owner, listing, s1) == full

    # Area outside the seeker's areas (price back in budget): the same.
    _edit_listing(owner, listing, {"price_ils": 7000, "area_id": str(north)})
    assert _ok(seeker.get(f"/listings/{listing}"))["match"] == _match(
        59, ["budget", "move_in", "household"], "area"
    )
    assert _owner_match(owner, listing, s1) == full
    assert _patched_match(owner, listing, s1, "submitted") == full

    # Every other criterion stays live against the listing: a pets ban shows at once.
    _execute(
        db_engine,
        "UPDATE seeker_profiles SET has_pets = true WHERE user_id = :u",
        u=str(_user_id(seeker)),
    )
    _edit_listing(owner, listing, {"pets_allowed": False})
    assert _owner_match(owner, listing, s1) == _match(59, TOP3, "pets")
    _edit_listing(owner, listing, {"pets_allowed": True, "area_id": str(gush_dan)})

    # A re-apply after a withdrawal snapshots the listing again, at its new price.
    _edit_listing(owner, listing, {"price_ils": 8000})
    withdrawn = seeker.post(f"/me/applications/{s1}/withdraw")
    assert withdrawn.status_code == 200, withdrawn.text
    reapplied = seeker.post(f"/listings/{listing}/applications", json={"message": "Again"})
    assert reapplied.status_code == 201, reapplied.text
    assert reapplied.json()["id"] == s1
    with db_engine.connect() as conn:
        assert tuple(conn.execute(text(snapshot), {"a": s1}).one()) == (8000, gush_dan)
    reapplied_match = _owner_match(owner, listing, s1)
    assert reapplied_match == _ok(seeker.get(f"/listings/{listing}"))["match"]
    assert reapplied_match == _match(59, ["move_in", "area", "household"], "budget")


def test_ac9_budget_cannot_be_bisected_by_price_edits(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    # The reviewer's attack: pause, set a price, re-read the inbox, halve the interval, repeat.
    listing = _l0(db_engine, _user_id(owner), gush_dan)
    seeker = signup(client, outbox, "s1@example.com", "seeker")
    make_profile(db_engine, _user_id(seeker), gush_dan, budget_max_ils=8437)
    applied = seeker.post(f"/listings/{listing}/applications", json={"message": "Hello there"})
    assert applied.status_code == 201, applied.text
    s1 = applied.json()["id"]
    baseline = _owner_match(owner, listing, s1)
    assert baseline == _match(100, TOP3, None)
    _edit_listing(owner, listing, {"status": "paused"})

    seen = []
    low, high = 500, 100_000
    statuses = iter(["shortlisted", "submitted"] * 10)
    for _ in range(16):
        price = (low + high) // 2
        _edit_listing(owner, listing, {"price_ils": price})
        listed = _owner_match(owner, listing, s1)
        patched = _patched_match(owner, listing, s1, next(statuses))
        seen.extend([listed, patched])
        if listed["differs"] == "budget":
            high = price
        else:
            low = price

    assert all(match == baseline for match in seen), seen
    # Read as "always fits", the bisection walks to the ceiling, never to the budget.
    assert low > 8437 * 10


# --- 0007a: the seeker's room section ----------------------------------------------------------

ROOM_SECTION_KEYS = {"gender", "birth_year", "flatmate_gender", "lifestyle"}


def test_ac8_room_section_never_outside_room_field(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    birth_year = dt.datetime.now(dt.UTC).year - 30
    listing = make_listing(
        db_engine, _user_id(owner), gush_dan, listing_type="room", flatmates_count=2
    )
    s1 = _profiled_seeker(
        db_engine,
        "s1@example.com",
        gush_dan,
        "S1",
        gender="woman",
        birth_year=birth_year,
        flatmate_gender="women",
        lifestyle={"night": 3},
    )
    application = make_application(db_engine, listing, s1)

    listed = _applicants(owner, listing)
    patched = _set_status(owner, listing, application, {"status": "shortlisted"})

    for response in (listed, patched):
        body = _ok(response)
        items = body if isinstance(body, list) else [body]
        assert [item["id"] for item in items] == [str(application)]
        for item in items:
            # `room` is 0007c's and is excluded on purpose.
            item_wo_room = {k: v for k, v in item.items() if k != "room"}
            assert set(item_wo_room["profile"]) == PROFILE_KEYS
            keys, _ = _keys_and_numbers(item_wo_room)
            assert not keys & ROOM_SECTION_KEYS
            assert "woman" not in json.dumps(item_wo_room)
        keys, numbers = _keys_and_numbers(body)
        assert "birth_year" not in keys
        assert "flatmate_gender" not in keys
        assert birth_year not in numbers


# --- 0007g: lifestyle in the owner's score, only on applications made to a room ---------------


def _room_seeker(
    client: TestClient, outbox: Outbox, area: uuid.UUID, lifestyle: dict[str, int]
) -> TestClient:
    """A signed-up seeker whose `PUT /me/profile` is `P0` with a woman / any room section."""
    seeker = signup(client, outbox, "s1@example.com", "seeker")
    put = seeker.put("/me/profile", json=_p0_body(area, gender="woman", lifestyle=lifestyle))
    assert put.status_code == 200, put.text
    return seeker


def _apply(seeker: TestClient, listing_id: Any) -> str:
    applied = seeker.post(f"/listings/{listing_id}/applications", json={"message": "Hello there"})
    assert applied.status_code == 201, applied.text
    application_id: str = applied.json()["id"]
    return application_id


def test_ac3_room_applicant_match_includes_lifestyle(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    room = _l0(db_engine, _user_id(owner), gush_dan, listing_type="room", flatmates_count=2)
    _edit_listing(owner, room, {"lifestyle": {"cleanliness": 3, "night": 1, "kosher": 2}})
    seeker = _room_seeker(client, outbox, gush_dan, {"cleanliness": 3, "night": 3, "shabbat": 1})
    s1 = _apply(seeker, room)

    expected = _match(90, TOP3, "lifestyle")
    assert _owner_match(owner, room, s1) == expected
    assert _ok(seeker.get(f"/listings/{room}"))["match"] == expected
    assert _patched_match(owner, room, s1, "shortlisted") == expected


def test_ac4_apartment_applicant_lifestyle_never_scored_for_owner(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    apartment = _l0(db_engine, _user_id(owner), gush_dan)
    seeker = _room_seeker(client, outbox, gush_dan, {"night": 1, "guests": 2})
    s1 = _apply(seeker, apartment)
    snapshot = "SELECT listing_type_at_apply FROM applications WHERE id = :a"
    assert _scalar(db_engine, snapshot, a=s1) == "apartment"
    baseline = _match(100, TOP3, None)
    assert _owner_match(owner, apartment, s1) == baseline

    # The probe: turn the apartment into a room and set one flat answer.
    _switch_type(db_engine, apartment, "room", lifestyle='{"night": 3}')
    assert _owner_match(owner, apartment, s1) == baseline
    assert _patched_match(owner, apartment, s1, "shortlisted") == baseline
    # The seeker's own view is live: round(0.8 * 100 + 20 * 0).
    assert _ok(seeker.get(f"/listings/{apartment}"))["match"] == _match(80, TOP3, "lifestyle")

    # One answer per edit: the seeker's live score moves every time, the owner's never does.
    statuses = iter(["submitted", "shortlisted"] * 3)
    for key in ("night", "guests"):
        for value in (1, 2, 3):
            _edit_listing(owner, apartment, {"lifestyle": {key: value}})
            assert _owner_match(owner, apartment, s1) == baseline, (key, value)
            assert _patched_match(owner, apartment, s1, next(statuses)) == baseline, (key, value)
            live = _ok(seeker.get(f"/listings/{apartment}"))["match"]
            assert "lifestyle" in [*live["agrees"], live["differs"]], (key, value)


# --- 0007c: the room section in the owner's inbox, only on applications made to a room --------

ROOM_KEYS = {"gender", "age", "lifestyle"}


def _named_room_seeker(
    client: TestClient, outbox: Outbox, email: str, area: uuid.UUID, name: str, **room: Any
) -> TestClient:
    """A seeker signed up as `name` (2+ characters, `SignupProfile`) whose `PUT /me/profile` is
    `_p0_body(area, **room)`. (`_room_seeker` above is 0007g's, with a fixed email and name.)"""
    seeker = signup(client, outbox, email, "seeker", name)
    put = seeker.put("/me/profile", json=_p0_body(area, **room))
    assert put.status_code == 200, put.text
    return seeker


def _this_year() -> int:
    return dt.datetime.now(dt.UTC).year


def _w(client: TestClient, outbox: Outbox, area: uuid.UUID, **room: Any) -> TestClient:
    """W: a woman of 27 who wants women flatmates and answered cleanliness 3, night 1; `room`
    overrides any of it."""
    values: dict[str, Any] = {
        "gender": "woman",
        "birth_year": _this_year() - 27,
        "flatmate_gender": "women",
        "lifestyle": {"cleanliness": 3, "night": 1},
        **room,
    }
    return _named_room_seeker(client, outbox, "w@example.com", area, "W1", **values)


def _no_private_keys(body: Any, birth_year: int | None = None) -> None:
    keys, numbers = _keys_and_numbers(body)
    assert "birth_year" not in keys
    assert "flatmate_gender" not in keys
    if birth_year is not None:
        assert birth_year not in numbers


def test_ac1_room_applicants_show_gender_age_lifestyle(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    room = _l0(db_engine, _user_id(owner), gush_dan, listing_type="room", flatmates_count=2)
    w = _apply(_w(client, outbox, gush_dan), room)
    m_seeker = _named_room_seeker(client, outbox, "m@example.com", gush_dan, "M1", gender="man")
    m = _apply(m_seeker, room)
    n = _apply(_named_room_seeker(client, outbox, "n@example.com", gush_dan, "N1"), room)
    s0 = str(make_application(db_engine, room, make_seeker(db_engine, "s0@example.com", "S0")))
    gone_seeker = _named_room_seeker(
        client, outbox, "x@example.com", gush_dan, "Gone", gender="other"
    )
    gone = _apply(gone_seeker, room)
    withdrawn = gone_seeker.post(f"/me/applications/{gone}/withdraw")
    assert withdrawn.status_code == 200, withdrawn.text

    body = _ok(_applicants(owner, room))
    items = _by_id(body)
    assert set(items) == {w, m, n, s0}
    assert "Gone" not in [item["applicant_name"] for item in body]
    for item in body:
        assert set(item) == APPLICANT_KEYS

    assert items[w]["room"] == {
        "gender": "woman",
        "age": 27,
        "lifestyle": {"cleanliness": 3, "night": 1},
    }
    assert set(items[w]["room"]) == ROOM_KEYS
    assert items[m]["room"] == {"gender": "man", "age": None, "lifestyle": {}}
    assert items[n]["room"] is None
    assert items[n]["match"] is not None
    assert items[n]["profile"] is not None
    assert items[s0]["room"] is None
    assert items[s0]["match"] is None
    assert items[s0]["profile"] is None
    _no_private_keys(body, _this_year() - 27)


def test_ac2_patch_returns_room_fields(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    room = _l0(db_engine, _user_id(owner), gush_dan, listing_type="room", flatmates_count=2)
    w = _apply(_w(client, outbox, gush_dan), room)
    m_seeker = _named_room_seeker(client, outbox, "m@example.com", gush_dan, "M1", gender="man")
    m = _apply(m_seeker, room)
    m_room = _by_id(_ok(_applicants(owner, room)))[m]["room"]
    assert m_room == {"gender": "man", "age": None, "lifestyle": {}}

    shortlisted = _ok(_set_status(owner, room, w, {"status": "shortlisted"}))
    assert shortlisted["status"] == "shortlisted"
    assert shortlisted["room"] == {
        "gender": "woman",
        "age": 27,
        "lifestyle": {"cleanliness": 3, "night": 1},
    }
    assert shortlisted == _by_id(_ok(_applicants(owner, room)))[w]

    declined = _ok(_set_status(owner, room, m, {"status": "declined"}))
    assert declined["status"] == "declined"
    assert declined["room"] == m_room

    for body in (shortlisted, declined):
        _no_private_keys(body, _this_year() - 27)


def _application_type(engine: Engine, application_id: str) -> Any:
    return _scalar(
        engine, "SELECT listing_type_at_apply FROM applications WHERE id = :a", a=application_id
    )


def _no_room_section(body: Any) -> None:
    keys, _ = _keys_and_numbers(body)
    assert not keys & {"gender", "age", "birth_year", "flatmate_gender", "lifestyle"}
    assert "woman" not in json.dumps(body)


def test_ac3_apartment_applicants_stay_hidden_after_switch_to_room(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    apartment = _l0(db_engine, _user_id(owner), gush_dan)
    seeker = _w(client, outbox, gush_dan, lifestyle={"night": 3})
    w = _apply(seeker, apartment)
    assert _application_type(db_engine, w) == "apartment"
    baseline = _match(100, TOP3, None)
    item = _by_id(_ok(_applicants(owner, apartment)))[w]
    assert item["room"] is None
    assert item["match"] == baseline

    _switch_type(db_engine, apartment, "room", lifestyle='{"night": 1}')
    # The seeker's own view is live: round(0.8 * 100 + 20 * 0).
    live = _match(80, TOP3, "lifestyle")
    assert _ok(seeker.get(f"/listings/{apartment}"))["match"] == live

    listed = _ok(_applicants(owner, apartment))
    patched = _ok(_set_status(owner, apartment, w, {"status": "shortlisted"}))
    for body in (listed, patched):
        entry = body[0] if isinstance(body, list) else body
        assert entry["id"] == w
        assert entry["room"] is None
        assert entry["match"] == baseline
        assert "lifestyle" not in [*entry["match"]["agrees"], entry["match"]["differs"]]
        _no_room_section(body)

    # A re-apply snapshots the type again: W now applied to an `any` room.
    withdrawn = seeker.post(f"/me/applications/{w}/withdraw")
    assert withdrawn.status_code == 200, withdrawn.text
    assert _apply(seeker, apartment) == w
    assert _application_type(db_engine, w) == "room"
    item = _by_id(_ok(_applicants(owner, apartment)))[w]
    assert item["room"] == {"gender": "woman", "age": 27, "lifestyle": {"night": 3}}
    assert item["match"] == _ok(seeker.get(f"/listings/{apartment}"))["match"] == live


def test_ac4_room_applicants_keep_room_after_switch_to_apartment(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    room = _l0(db_engine, _user_id(owner), gush_dan, listing_type="room", flatmates_count=2)
    w = _apply(_w(client, outbox, gush_dan), room)
    _edit_listing(owner, room, {"lifestyle": {"night": 3}})
    assert _owner_match(owner, room, w) == _match(80, TOP3, "lifestyle")
    w_room = _by_id(_ok(_applicants(owner, room)))[w]["room"]
    assert w_room == {"gender": "woman", "age": 27, "lifestyle": {"cleanliness": 3, "night": 1}}

    _switch_type(db_engine, room, "apartment")

    assert _application_type(db_engine, w) == "room"
    item = _by_id(_ok(_applicants(owner, room)))[w]
    assert item["room"] == w_room
    assert item["match"] == _match(100, TOP3, None)
    mine = {i["id"]: i for i in _ok(owner.get("/me/listings"))}
    assert mine[str(room)]["listing_type"] == "apartment"
    assert mine[str(room)]["lifestyle"] == {}


def test_ac5_room_fields_follow_profile_edits_and_clearing(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    room = _l0(db_engine, _user_id(owner), gush_dan, listing_type="room", flatmates_count=2)
    seeker = _w(client, outbox, gush_dan)
    w = _apply(seeker, room)

    edited = seeker.put(
        "/me/profile",
        json=_p0_body(
            gush_dan, gender="woman", birth_year=_this_year() - 30, lifestyle={"guests": 2}
        ),
    )
    assert edited.status_code == 200, edited.text
    assert _by_id(_ok(_applicants(owner, room)))[w]["room"] == {
        "gender": "woman",
        "age": 30,
        "lifestyle": {"guests": 2},
    }

    cleared = seeker.put("/me/profile", json=_p0_body(gush_dan))
    assert cleared.status_code == 200, cleared.text
    listed = _ok(_applicants(owner, room))
    patched = _ok(_set_status(owner, room, w, {"status": "shortlisted"}))
    for entry in (_by_id(listed)[w], patched):
        assert entry["room"] is None
        assert entry["match"] is not None
        assert entry["profile"] is not None
    for body in (listed, patched):
        keys, _ = _keys_and_numbers(body)
        assert "gender" not in keys
        assert "woman" not in json.dumps(body)
