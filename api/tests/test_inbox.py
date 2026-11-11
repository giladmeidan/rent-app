"""Owner inbox API (spec 0004c): applicants per listing, shortlist / decline, counts on
`GET /me/listings`. AC1-AC6."""

import datetime as dt
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
    make_seeker,
    signup,
)
from tests.test_listings import _body

pytestmark = pytest.mark.usefixtures("redis_clean")

APPLICANT_KEYS = {"id", "status", "message", "applicant_name", "created_at", "updated_at"}
COUNT_KEYS = {"applicant_count", "new_applicant_count"}
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


def _applicants(caller: TestClient, listing_id: Any) -> httpx.Response:
    response: httpx.Response = caller.get(f"/listings/{listing_id}/applications")
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
    assert [i["id"] for i in _applicants(owner, listing).json()] == expected


def test_ac2_applicants_are_owner_only(
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

    seeker = signup(client, outbox, "s@example.com", "seeker")
    forbidden = _applicants(seeker, listing_a)
    assert forbidden.status_code == 403
    assert forbidden.json() == {"detail": "owner_only"}

    other = signup(client, outbox, "o2@example.com", "owner")
    foreign = _applicants(other, listing_a)
    unknown = _applicants(other, uuid.uuid4())
    assert foreign.status_code == 404
    assert unknown.status_code == 404
    assert foreign.json() == unknown.json() == NOT_FOUND
    assert foreign.content == unknown.content

    malformed = _applicants(owner, "not-a-uuid")
    assert malformed.status_code == 422


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
            # The session lookup, the one UPDATE, then the chat it opens (spec 0005a).
            assert len(sent) == 3, sent
            assert "UPDATE applications" in sent[1]
            assert "FROM listings" in sent[1]
            assert "RETURNING" in sent[1]
            assert "INSERT INTO conversations" in sent[2]
        if code == 409 and not measured_conflict:
            measured_conflict = True
            assert len(sent) == 3, sent  # lookup, UPDATE, then the follow-up SELECT
        assert response.status_code == code, (current, target, response.text)
        status, after = _row(db_engine, application_id)
        if code == 200:
            body = response.json()
            assert set(body) == APPLICANT_KEYS
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
    seeker = signup(client, outbox, "s@example.com", "seeker")
    forbidden = _set_status(seeker, listing_a, p, shortlist)
    assert forbidden.status_code == 403
    assert forbidden.json() == {"detail": "owner_only"}

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
