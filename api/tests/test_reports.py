"""Reports (spec 0011b): AC1-AC9 and NF1 (AC10 is in `test_migrations.py`).

`O` is an owner, `S` a seeker, both signed up; everyone else is made directly with the conftest
`make_*` helpers. A report is a `POST /reports` of `{target_type, target_id, reason, note}`."""

import threading
import time
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text

from app.db import get_sessionmaker
from app.models import User
from app.redis_client import get_redis
from app.schemas.report import ReportIn
from app.services import reports as reports_service
from tests.conftest import (
    Outbox,
    make_application,
    make_card,
    make_direct_chat,
    make_flatmate,
    make_listing,
    make_owner,
    make_pair,
    make_person_like,
    make_seeker,
    signup,
)
from tests.test_matching import _area, _user_id

pytestmark = pytest.mark.usefixtures("redis_clean")

NOT_FOUND = {"detail": "not_found"}


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _report(
    caller: TestClient | httpx.Client,
    target_type: str,
    target_id: Any,
    reason: str = "money_before_viewing",
    note: str | None = None,
) -> httpx.Response:
    body = {"target_type": target_type, "target_id": str(target_id), "reason": reason}
    if note is not None:
        body["note"] = note
    response: httpx.Response = caller.post("/reports", json=body)
    return response


def _created(response: httpx.Response) -> None:
    assert response.status_code == 201, response.text
    assert response.json() == {"already_reported": False}


def _rows(engine: Engine) -> list[tuple[Any, ...]]:
    with engine.connect() as conn:
        return [
            tuple(row)
            for row in conn.execute(
                text(
                    "SELECT reporter_id, target_type, target_id, reported_user_id, reason, note"
                    " FROM reports ORDER BY created_at, id"
                )
            )
        ]


def _reported(engine: Engine, reporter: uuid.UUID, target_id: Any) -> uuid.UUID | None:
    value: uuid.UUID | None = _scalar(
        engine,
        "SELECT reported_user_id FROM reports WHERE reporter_id = :r AND target_id = :t",
        r=reporter,
        t=str(target_id),
    )
    return value


def _count(engine: Engine) -> int:
    return int(_scalar(engine, "SELECT count(*) FROM reports"))


def _room(engine: Engine, owner_id: uuid.UUID, area: uuid.UUID, **overrides: Any) -> uuid.UUID:
    values: dict[str, Any] = {"listing_type": "room", "flatmates_count": 2, **overrides}
    return make_listing(engine, owner_id, area, **values)


def _chat(engine: Engine, application_id: uuid.UUID) -> uuid.UUID:
    """The application's conversation (its id is the application's), inserted directly."""
    with engine.begin() as conn:
        conversation_id: uuid.UUID = conn.execute(
            text(
                "INSERT INTO conversations (id, application_id, owner_id, seeker_id)"
                " SELECT a.id, a.id, l.owner_id, a.seeker_id FROM applications a"
                " JOIN listings l ON l.id = a.listing_id WHERE a.id = :id RETURNING id"
            ),
            {"id": application_id},
        ).scalar_one()
    return conversation_id


@pytest.fixture
def owner(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "owner@example.com", "owner", display_name="Oren")


@pytest.fixture
def seeker(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "seeker@example.com", "seeker", display_name="Shir")


def test_ac1_report_listing(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    seeker: TestClient,
    db_engine: Engine,
    gush_dan: uuid.UUID,
) -> None:
    owner_id, seeker_id = _user_id(owner), _user_id(seeker)
    apartment = make_listing(db_engine, owner_id, gush_dan)
    room = _room(db_engine, owner_id, gush_dan)
    sent_before = len(outbox.messages)

    for listing_id in (apartment, room):
        response = _report(seeker, "listing", listing_id, note="  first line\r\nsecond  ")
        _created(response)
        assert set(response.json()) == {"already_reported"}
        assert "first line" not in response.text
        assert str(listing_id) not in response.text
    assert _rows(db_engine) == [
        (seeker_id, "listing", apartment, owner_id, "money_before_viewing", "first line\nsecond"),
        (seeker_id, "listing", room, owner_id, "money_before_viewing", "first line\nsecond"),
    ]
    assert len(outbox.messages) == sent_before  # no email

    # A blank note is no note.
    other = signup(client, outbox, "other@example.com", "seeker")
    sent_before = len(outbox.messages)
    _created(_report(other, "listing", apartment, reason="broker", note="   "))
    assert _scalar(
        db_engine, "SELECT note IS NULL FROM reports WHERE reporter_id = :r", r=_user_id(other)
    )

    # Nothing else happens: no email, the listing stays public.
    assert len(outbox.messages) == sent_before
    for listing_id, listing_type in ((apartment, "apartment"), (room, "room")):
        assert client.get(f"/listings/{listing_id}").status_code == 200
        search = client.get("/listings", params={"listing_type": listing_type}).json()
        assert str(listing_id) in [item["id"] for item in search["items"]]


def test_ac2_listing_not_visible_is_404(
    owner: TestClient, seeker: TestClient, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    owner_id = _user_id(owner)
    inactive = _area(db_engine, "inactive", active=False)
    targets = (
        (seeker, make_listing(db_engine, owner_id, gush_dan, status="paused")),
        (seeker, make_listing(db_engine, owner_id, gush_dan, expires_at="2020-01-01T00:00:00Z")),
        (seeker, make_listing(db_engine, owner_id, inactive)),
        (seeker, uuid.uuid4()),
        (owner, make_listing(db_engine, owner_id, gush_dan)),  # the caller's own
    )
    for caller, listing_id in targets:
        response = _report(caller, "listing", listing_id)
        assert response.status_code == 404, listing_id
        assert response.json() == NOT_FOUND
    assert _count(db_engine) == 0


def test_ac3_report_person_card(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    a = signup(client, outbox, "a@example.com", "seeker", display_name="Avi")
    a_id = _user_id(a)
    make_card(db_engine, a_id, gush_dan, gender="woman")
    b_id = make_seeker(db_engine, "b@example.com", "Bat")
    b_card = make_card(db_engine, b_id, gush_dan, gender="woman")

    _created(_report(a, "person", b_card, reason="offensive"))
    assert _reported(db_engine, a_id, b_card) == b_id

    hidden_id = make_seeker(db_engine, "h@example.com", "Hila")
    hidden_card = make_card(db_engine, hidden_id, gush_dan, gender="woman")
    _execute(
        db_engine,
        "UPDATE seeker_profiles SET people_visible = false WHERE user_id = :id",
        id=hidden_id,
    )
    misfit_id = make_seeker(db_engine, "m@example.com", "Maya")
    misfit_card = make_card(db_engine, misfit_id, gush_dan, gender="woman", flatmate_gender="men")
    match_id = make_seeker(db_engine, "x@example.com", "Mor")
    match_card = make_card(db_engine, match_id, gush_dan, gender="woman")
    make_person_like(db_engine, a_id, match_id)
    make_person_like(db_engine, match_id, a_id)
    a_card = _scalar(db_engine, "SELECT card_id FROM users WHERE id = :id", id=a_id)
    no_card = signup(client, outbox, "nocard@example.com", "seeker")

    for caller, card_id in (
        (no_card, b_card),  # the caller shows no card
        (a, hidden_card),
        (a, misfit_card),
        (a, a_card),  # the caller's own
        (a, uuid.uuid4()),
        (a, match_card),  # a match is reported from its chat
    ):
        response = _report(caller, "person", card_id)
        assert response.status_code == 404, card_id
        assert response.json() == NOT_FOUND
    assert _count(db_engine) == 1


def test_ac4_report_room_person(owner: TestClient, db_engine: Engine, gush_dan: uuid.UUID) -> None:
    owner_id = _user_id(owner)
    room = _room(db_engine, owner_id, gush_dan, gender_preference="women")
    p_id = make_seeker(db_engine, "p@example.com", "Peleg")
    make_card(db_engine, p_id, gush_dan, gender="woman")
    pair = make_pair(db_engine, room, p_id, price_ils_seen=7000)

    def not_found(pair_id: Any) -> None:
        response = _report(owner, "room_person", pair_id, reason="other")
        assert response.status_code == 404, pair_id
        assert response.json() == NOT_FOUND

    # Each refusal first, then restored, so the last report is the stored one.
    other_owner = make_owner(db_engine, "o2@example.com")
    not_found(
        make_pair(db_engine, _room(db_engine, other_owner, gush_dan), p_id, price_ils_seen=7000)
    )
    _execute(db_engine, "UPDATE listings SET status = 'paused' WHERE id = :id", id=room)
    not_found(pair)
    _execute(db_engine, "UPDATE listings SET status = 'active' WHERE id = :id", id=room)
    _execute(
        db_engine, "UPDATE seeker_profiles SET people_visible = false WHERE user_id = :id", id=p_id
    )
    not_found(pair)
    _execute(
        db_engine, "UPDATE seeker_profiles SET people_visible = true WHERE user_id = :id", id=p_id
    )
    _execute(db_engine, "UPDATE seeker_profiles SET gender = 'man' WHERE user_id = :id", id=p_id)
    not_found(pair)
    _execute(db_engine, "UPDATE seeker_profiles SET gender = 'woman' WHERE user_id = :id", id=p_id)
    not_found(uuid.uuid4())
    assert _count(db_engine) == 0

    _created(_report(owner, "room_person", pair, reason="other"))
    assert _reported(db_engine, owner_id, pair) == p_id


def test_ac5_report_chat_other_side(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    seeker: TestClient,
    db_engine: Engine,
    gush_dan: uuid.UUID,
) -> None:
    owner_id, seeker_id = _user_id(owner), _user_id(seeker)
    flatmate = signup(client, outbox, "f@example.com", "seeker", display_name="Fani")
    flatmate_id = _user_id(flatmate)
    stranger = signup(client, outbox, "x@example.com", "seeker", display_name="Xena")

    # An apartment chat: each side names the other.
    apartment = make_listing(db_engine, owner_id, gush_dan)
    apartment_chat = _chat(
        db_engine, make_application(db_engine, apartment, seeker_id, status="shortlisted")
    )
    _created(_report(seeker, "chat", apartment_chat))
    assert _reported(db_engine, seeker_id, apartment_chat) == owner_id
    _created(_report(owner, "chat", apartment_chat))
    assert _reported(db_engine, owner_id, apartment_chat) == seeker_id

    # A room chat: the flatmate names the seeker.
    room = _room(db_engine, owner_id, gush_dan)
    room_seeker = make_seeker(db_engine, "rs@example.com", "Roni")
    room_chat = _chat(
        db_engine, make_application(db_engine, room, room_seeker, status="shortlisted")
    )
    make_flatmate(db_engine, room, flatmate_id)
    _created(_report(flatmate, "chat", room_chat))
    assert _reported(db_engine, flatmate_id, room_chat) == room_seeker

    # A direct chat: each names the other.
    direct = make_direct_chat(db_engine, seeker_id, flatmate_id)
    _created(_report(seeker, "chat", direct))
    assert _reported(db_engine, seeker_id, direct) == flatmate_id
    _created(_report(flatmate, "chat", direct))
    assert _reported(db_engine, flatmate_id, direct) == seeker_id

    # A declined application's chat and a removed match's (closed) chat stay reportable.
    declined_seeker = make_seeker(db_engine, "d@example.com", "Dana")
    declined_chat = _chat(
        db_engine, make_application(db_engine, apartment, declined_seeker, status="declined")
    )
    _created(_report(owner, "chat", declined_chat))
    assert _reported(db_engine, owner_id, declined_chat) == declined_seeker
    removed = make_direct_chat(db_engine, seeker_id, owner_id, closed=True)
    _created(_report(owner, "chat", removed))
    assert _reported(db_engine, owner_id, removed) == seeker_id

    stored = _count(db_engine)
    _execute(
        db_engine,
        "DELETE FROM listing_flatmates WHERE listing_id = :l AND user_id = :u",
        l=room,
        u=flatmate_id,
    )
    for caller, chat_id in (
        (stranger, apartment_chat),  # not in the chat
        (flatmate, room_chat),  # left the flat (already reported: the lookup refuses first)
        (seeker, uuid.uuid4()),
    ):
        response = _report(caller, "chat", chat_id)
        assert response.status_code == 404, chat_id
        assert response.json() == NOT_FOUND
    assert _count(db_engine) == stored


def test_ac6_report_applicant(
    owner: TestClient, seeker: TestClient, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    owner_id, seeker_id = _user_id(owner), _user_id(seeker)
    listing = make_listing(db_engine, owner_id, gush_dan)
    for status in ("submitted", "shortlisted", "declined"):
        applicant = make_seeker(db_engine, f"{status}@example.com", "Gal")
        application = make_application(db_engine, listing, applicant, status=status)
        _created(_report(owner, "applicant", application))
        assert _reported(db_engine, owner_id, application) == applicant

    withdrawn = make_application(
        db_engine, listing, make_seeker(db_engine, "w@example.com"), status="withdrawn"
    )
    other_listing = make_listing(db_engine, make_owner(db_engine, "o2@example.com"), gush_dan)
    others = make_application(db_engine, other_listing, make_seeker(db_engine, "y@example.com"))
    own = make_application(db_engine, make_listing(db_engine, owner_id, gush_dan), seeker_id)
    for caller, application_id in ((owner, withdrawn), (owner, others), (seeker, own)):
        response = _report(caller, "applicant", application_id)
        assert response.status_code == 404, application_id
        assert response.json() == NOT_FOUND
    assert _count(db_engine) == 3


def test_ac7_repeat_is_already_reported(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    seeker: TestClient,
    db_engine: Engine,
    gush_dan: uuid.UUID,
) -> None:
    owner_id, seeker_id = _user_id(owner), _user_id(seeker)
    listing = make_listing(db_engine, owner_id, gush_dan)
    _created(_report(seeker, "listing", listing, reason="broker", note="first"))
    again = _report(seeker, "listing", listing, reason="offensive", note="second")
    assert again.status_code == 200, again.text
    assert again.json() == {"already_reported": True}
    assert _rows(db_engine) == [(seeker_id, "listing", listing, owner_id, "broker", "first")]

    other = signup(client, outbox, "other@example.com", "seeker")
    _created(_report(other, "listing", listing))
    _created(_report(seeker, "listing", make_listing(db_engine, owner_id, gush_dan)))
    assert _count(db_engine) == 3

    # Two identical reports at once on two connections: each INSERT holds its row a moment
    # before it commits, so the second waits on the unique constraint and inserts nothing.
    racer = make_seeker(db_engine, "racer@example.com")
    body = ReportIn(target_type="listing", target_id=listing, reason="other")

    def hold_row(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        if statement.startswith("INSERT INTO reports"):
            time.sleep(0.3)

    event.listen(db_engine, "after_cursor_execute", hold_row)
    start = threading.Barrier(2, timeout=10)
    outcomes: list[Any] = []

    def run() -> None:
        with get_sessionmaker()() as db:
            user = db.get(User, racer)
            assert user is not None
            start.wait()
            try:
                outcomes.append(201 if reports_service.report(db, get_redis(), user, body) else 200)
            except Exception as exc:  # pragma: no cover - reported by the assertion below
                outcomes.append(repr(exc))

    threads = [threading.Thread(target=run) for _ in range(2)]
    try:
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)
    finally:
        event.remove(db_engine, "after_cursor_execute", hold_row)
    assert sorted(outcomes) == [200, 201]
    assert _scalar(db_engine, "SELECT count(*) FROM reports WHERE reporter_id = :r", r=racer) == 1


def test_ac8_validation_and_auth(
    client: TestClient,
    seeker: TestClient,
    owner: TestClient,
    db_engine: Engine,
    gush_dan: uuid.UUID,
) -> None:
    listing = make_listing(db_engine, _user_id(owner), gush_dan)
    good = {"target_type": "listing", "target_id": str(listing), "reason": "broker"}

    client.cookies.clear()
    response = client.post("/reports", json=good)
    assert response.status_code == 401
    assert response.json() == {"detail": "unauthenticated"}

    secret = "secret-words-here"
    for bad in (
        {"target_type": "page"},
        {"reason": "spam"},
        {"target_id": "not-a-uuid"},
        {"note": secret.ljust(501, "x")},
        {"note": secret + "‮"},
        {"note": "?!"},
    ):
        response = seeker.post("/reports", json={**good, **bad})
        assert response.status_code == 422, bad
        assert secret not in response.text
        assert "?!" not in response.text
        assert all("input" not in error for error in response.json()["detail"])
    assert _count(db_engine) == 0


def test_ac9_rate_limit(
    owner: TestClient, seeker: TestClient, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    seeker_id = _user_id(seeker)
    listing = make_listing(db_engine, _user_id(owner), gush_dan)
    for _ in range(5):  # 404s count
        assert _report(seeker, "listing", uuid.uuid4()).status_code == 404
    _created(_report(seeker, "listing", listing))
    for _ in range(4):  # repeats count
        assert _report(seeker, "listing", listing).status_code == 200

    fresh = make_listing(db_engine, _user_id(owner), gush_dan)
    refused = _report(seeker, "listing", fresh)
    assert refused.status_code == 429
    assert refused.json() == {"detail": "rate_limited"}
    assert 0 < int(refused.headers["Retry-After"]) <= 3600
    assert _count(db_engine) == 1

    # After the hour window, the day limit of 30 applies the same way (refusals never count).
    r = get_redis()
    for _ in range(2):
        r.delete(f"rl:report:user:{seeker_id}")
        for _ in range(10):
            assert _report(seeker, "listing", uuid.uuid4()).status_code == 404
    r.delete(f"rl:report:user:{seeker_id}")
    refused = _report(seeker, "listing", fresh)
    assert refused.status_code == 429
    assert refused.json() == {"detail": "rate_limited"}
    assert 3600 < int(refused.headers["Retry-After"]) <= 86_400
    assert _count(db_engine) == 1


@pytest.fixture
def statements(db_engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement the app engine sends while the test records (`.clear()` to start)."""
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(db_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine, "before_cursor_execute", record)


def test_nf1_statement_counts(
    owner: TestClient,
    seeker: TestClient,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    statements: list[str],
) -> None:
    owner_id, seeker_id = _user_id(owner), _user_id(seeker)
    listing = make_listing(db_engine, owner_id, gush_dan)
    make_card(db_engine, seeker_id, gush_dan, gender="woman")
    person = make_seeker(db_engine, "b@example.com", "Bat")
    card = make_card(db_engine, person, gush_dan, gender="woman")
    room = _room(db_engine, owner_id, gush_dan)
    pair = make_pair(db_engine, room, person, price_ils_seen=7000)
    application = make_application(db_engine, listing, seeker_id, status="shortlisted")
    chat = _chat(db_engine, application)

    for caller, target_type, target_id, expected in (
        (seeker, "listing", listing, 2),
        (seeker, "person", card, 3),  # the viewer, then the candidate
        (owner, "room_person", pair, 2),
        (seeker, "chat", chat, 2),
        (owner, "applicant", application, 2),
    ):
        caller.get("/me")  # warm-up: a first connect sends its own setup statements
        statements.clear()
        _created(_report(caller, target_type, target_id))
        sent = list(statements)
        assert len(sent) == 1 + expected, (target_type, sent)  # after the session lookup
        assert sent[-1].startswith("INSERT INTO reports"), sent
