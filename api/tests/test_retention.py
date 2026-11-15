"""The retention rules and their nightly purge (spec 0013h): AC2-AC11, AC13 (AC1 is in
`test_account_deletion.py`, the cron in `test_worker.py`, AC14 in `test_migrations.py`).

Every age is set in SQL relative to the database's `now()` (`_ago`), just inside and just outside
each period. A deleted account is a tombstone written directly (`_tombstone`)."""

import datetime as dt
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.services import accounts, retention
from app.services.photo_store import FilePhotoStore
from tests.conftest import (
    Outbox,
    make_application,
    make_direct_chat,
    make_flatmate,
    make_listing,
    make_owner,
    make_seeker,
)
from tests.test_account_deletion import _blocked, _deleted
from tests.test_moderation import _request_code

pytestmark = pytest.mark.usefixtures("redis_clean")

OUT_12M = "12 months 1 day"
IN_12M = "11 months"
OUT_24M = "24 months 1 day"
IN_24M = "23 months"
OUT_3Y = "3 years 1 day"
IN_3Y = "3 years -1 day"


# --- helpers -----------------------------------------------------------------------------------


def _execute(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.begin() as conn:
        result = conn.execute(text(sql), params)
        return result.scalar() if result.returns_rows else None


def _ago(engine: Engine, table: str, column: str, row_id: Any, age: str, key: str = "id") -> None:
    _execute(
        engine,
        f"UPDATE {table} SET {column} = now() - CAST(:age AS interval) WHERE {key} = :id",
        age=age,
        id=row_id,
    )


def _exists(engine: Engine, table: str, row_id: Any, key: str = "id") -> bool:
    return bool(_execute(engine, f"SELECT count(*) FROM {table} WHERE {key} = :id", id=row_id))


def _count(engine: Engine, table: str) -> int:
    return int(_execute(engine, f"SELECT count(*) FROM {table}"))


def _tombstone(engine: Engine, user_id: uuid.UUID, age: str = "0 days") -> None:
    """`user_id` deleted `age` ago (the columns `ck_users_deleted_scrubbed` requires)."""
    _execute(
        engine,
        "UPDATE users SET deleted_at = now() - CAST(:age AS interval), email = NULL,"
        " display_name = NULL, photo_key = NULL WHERE id = :id",
        age=age,
        id=user_id,
    )


def _chat(engine: Engine, application_id: uuid.UUID, last_message: str | None = None) -> uuid.UUID:
    """The application's conversation, its last message `last_message` ago (None: no message)."""
    _execute(
        engine,
        "INSERT INTO conversations (id, application_id, owner_id, seeker_id, last_message_at)"
        " SELECT a.id, a.id, l.owner_id, a.seeker_id, now() - CAST(:age AS interval)"
        " FROM applications a JOIN listings l ON l.id = a.listing_id WHERE a.id = :id",
        id=application_id,
        age=last_message,
    )
    if last_message is not None:
        _message(engine, application_id)
    return application_id


def _message(engine: Engine, conversation_id: uuid.UUID) -> None:
    _execute(
        engine,
        "INSERT INTO messages (conversation_id, sender_id, body)"
        " SELECT id, seeker_id, 'hello' FROM conversations WHERE id = :c",
        c=conversation_id,
    )


def _direct(
    engine: Engine, a: uuid.UUID, b: uuid.UUID, *, last_message: str | None, created: str = "0 days"
) -> uuid.UUID:
    chat = make_direct_chat(engine, a, b)
    _ago(engine, "conversations", "created_at", chat, created)
    if last_message is not None:
        _ago(engine, "conversations", "last_message_at", chat, last_message)
        _message(engine, chat)
    return chat


def _price_change(engine: Engine, listing_id: uuid.UUID, age: str) -> uuid.UUID:
    row: uuid.UUID = _execute(
        engine,
        "INSERT INTO listing_price_changes (listing_id, price_ils, created_at)"
        " VALUES (:l, 7000, now() - CAST(:age AS interval)) RETURNING id",
        l=listing_id,
        age=age,
    )
    return row


def _report(
    engine: Engine,
    reporter: uuid.UUID,
    reported: uuid.UUID,
    target_type: str,
    target_id: uuid.UUID,
    *,
    resolved: str | None = None,
    note: str | None = None,
) -> uuid.UUID:
    row: uuid.UUID = _execute(
        engine,
        "INSERT INTO reports (reporter_id, reported_user_id, target_type, target_id, reason, note,"
        " resolved_at) VALUES (:a, :b, :t, :id, 'other', :note,"
        " now() - CAST(:resolved AS interval)) RETURNING id",
        a=reporter,
        b=reported,
        t=target_type,
        id=target_id,
        note=note,
        resolved=resolved,
    )
    return row


def _action(
    engine: Engine, action: str, target_type: str, target_id: uuid.UUID, age: str
) -> uuid.UUID:
    row: uuid.UUID = _execute(
        engine,
        "INSERT INTO admin_actions (action, target_type, target_id, created_at)"
        " VALUES (:a, :t, :id, now() - CAST(:age AS interval)) RETURNING id",
        a=action,
        t=target_type,
        id=target_id,
        age=age,
    )
    return row


def _block(engine: Engine, email: str, age: str) -> None:
    _execute(
        engine,
        "INSERT INTO blocked_emails (email_hmac, created_at)"
        " VALUES (:h, now() - CAST(:age AS interval))",
        h=accounts.email_hmac(email),
        age=age,
    )


def _session(
    engine: Engine, user_id: uuid.UUID, *, expires: str, revoked: str | None = None
) -> uuid.UUID:
    """A login session that expired `expires` ago (a negative interval: still valid), revoked
    `revoked` ago if set."""
    row: uuid.UUID = _execute(
        engine,
        "INSERT INTO sessions (user_id, token_hash, created_at, expires_at, revoked_at)"
        " VALUES (:u, md5(random()::text), now() - interval '60 days',"
        " now() - CAST(:expires AS interval), now() - CAST(:revoked AS interval)) RETURNING id",
        u=user_id,
        expires=expires,
        revoked=revoked,
    )
    return row


def _purge(engine: Engine) -> dict[str, int]:
    with Session(engine) as db:
        return retention.purge_expired(db)


# --- R1 ----------------------------------------------------------------------------------------


def test_r1_deleted_owner_listing(db_engine: Engine, gush_dan: uuid.UUID) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    seeker = make_seeker(db_engine, "seeker@example.com")
    old = make_listing(db_engine, owner, gush_dan)
    old_app = make_application(db_engine, old, seeker, status="shortlisted")
    old_chat = _chat(db_engine, old_app, last_message=OUT_12M)
    old_price = _price_change(db_engine, old, "13 months")
    recent = make_listing(db_engine, owner, gush_dan)
    recent_chat = _chat(
        db_engine, make_application(db_engine, recent, seeker, status="shortlisted"), IN_12M
    )
    _tombstone(db_engine, owner, "2 years")
    # No conversations: 12 months after the deletion.
    gone_owner, kept_owner = (make_owner(db_engine, f"{n}@example.com") for n in ("g", "k"))
    no_chat_old = make_listing(db_engine, gone_owner, gush_dan)
    no_chat_recent = make_listing(db_engine, kept_owner, gush_dan)
    _tombstone(db_engine, gone_owner, OUT_12M)
    _tombstone(db_engine, kept_owner, IN_12M)
    # A live owner's listing with a chat idle for years: R1 never takes it.
    live_owner = make_owner(db_engine, "live@example.com")
    live = make_listing(db_engine, live_owner, gush_dan)
    _chat(db_engine, make_application(db_engine, live, seeker, status="shortlisted"), "5 years")
    # Deleted yesterday, last message 2 years ago: the later of the two counts.
    late_owner = make_owner(db_engine, "late@example.com")
    late = make_listing(db_engine, late_owner, gush_dan)
    _chat(db_engine, make_application(db_engine, late, seeker, status="shortlisted"), "2 years")
    _tombstone(db_engine, late_owner, "1 day")

    counts = _purge(db_engine)

    assert counts["r1_deleted_owner_listings"] == 2
    assert not _exists(db_engine, "listings", old)
    assert not _exists(db_engine, "applications", old_app)
    assert not _exists(db_engine, "conversations", old_chat)
    assert not _exists(db_engine, "messages", old_chat, key="conversation_id")
    assert not _exists(db_engine, "listing_price_changes", old_price)
    assert not _exists(db_engine, "listings", no_chat_old)
    for kept in (recent, no_chat_recent, live, late):
        assert _exists(db_engine, "listings", kept)
    assert _exists(db_engine, "messages", recent_chat, key="conversation_id")


# --- R2, R3 ------------------------------------------------------------------------------------


def test_r2_price_history(db_engine: Engine, gush_dan: uuid.UUID) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    changed = make_listing(db_engine, owner, gush_dan)
    oldest, older, inside, current = (
        _price_change(db_engine, changed, a) for a in ("30 months", OUT_24M, IN_24M, "1 month")
    )
    stale = make_listing(db_engine, owner, gush_dan)
    stale_first, stale_newest = (
        _price_change(db_engine, stale, a) for a in ("30 months", "26 months")
    )

    assert _purge(db_engine)["r2_price_history"] == 3

    remaining = {
        row_id
        for row_id in (oldest, older, inside, current, stale_first, stale_newest)
        if _exists(db_engine, "listing_price_changes", row_id)
    }
    # A row inside the period stays; so does each listing's newest, even when it is older.
    assert remaining == {inside, current, stale_newest}


def test_r3_final_rent(db_engine: Engine, gush_dan: uuid.UUID) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    closed = {
        age: make_listing(
            db_engine,
            owner,
            gush_dan,
            status="paused",
            close_reason="rented_here",
            final_rent_ils=7100,
            closed_at=dt.datetime.now(dt.UTC),
        )
        for age in (OUT_24M, IN_24M)
    }
    for age, listing in closed.items():
        _ago(db_engine, "listings", "closed_at", listing, age)

    assert _purge(db_engine)["r3_final_rent"] == 1

    def row(listing: uuid.UUID) -> tuple[Any, ...]:
        with db_engine.connect() as conn:
            return tuple(
                conn.execute(
                    text(
                        "SELECT final_rent_ils, close_reason, closed_at IS NOT NULL"
                        " FROM listings WHERE id = :id"
                    ),
                    {"id": listing},
                ).one()
            )

    assert row(closed[OUT_24M]) == (None, "rented_here", True)
    assert row(closed[IN_24M]) == (7100, "rented_here", True)


# --- R4 ----------------------------------------------------------------------------------------


def test_r4_conversations(db_engine: Engine, gush_dan: uuid.UUID) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    seeker = make_seeker(db_engine, "seeker@example.com")
    flatmate = make_seeker(db_engine, "flatmate@example.com")
    lonely_room = make_listing(db_engine, owner, gush_dan, listing_type="room", flatmates_count=1)
    lonely_app = make_application(db_engine, lonely_room, seeker, status="shortlisted")
    lonely = _chat(db_engine, lonely_app, "1 day")
    shared_room = make_listing(db_engine, owner, gush_dan, listing_type="room", flatmates_count=1)
    make_flatmate(db_engine, shared_room, flatmate)
    shared = _chat(
        db_engine, make_application(db_engine, shared_room, seeker, status="shortlisted"), "1 day"
    )
    # A deleted flatmate whose row is still there is not a live one.
    ghost_room = make_listing(db_engine, owner, gush_dan, listing_type="room", flatmates_count=1)
    ghost = make_seeker(db_engine, "ghost@example.com")
    make_flatmate(db_engine, ghost_room, ghost)
    _tombstone(db_engine, ghost)
    ghost_chat = _chat(
        db_engine, make_application(db_engine, ghost_room, seeker, status="shortlisted"), "1 day"
    )
    # An apartment chat has no flatmates, even with a stray live row on its listing.
    apartment = make_listing(db_engine, owner, gush_dan)
    make_flatmate(db_engine, apartment, flatmate)
    apartment_chat = _chat(
        db_engine, make_application(db_engine, apartment, seeker, status="shortlisted"), "1 day"
    )
    a, b, c, d, e = (make_seeker(db_engine, f"{n}@example.com") for n in "abcde")
    both_deleted = _direct(db_engine, d, e, last_message="1 day")
    _tombstone(db_engine, owner)
    _tombstone(db_engine, seeker)
    _tombstone(db_engine, d)
    _tombstone(db_engine, e)
    idle = _direct(db_engine, a, b, last_message=OUT_3Y)
    never_written = _direct(db_engine, a, c, last_message=None, created=OUT_3Y)
    recent = _direct(db_engine, b, c, last_message=IN_3Y, created="4 years")

    assert _purge(db_engine)["r4_conversations"] == 6

    for gone in (lonely, ghost_chat, apartment_chat, both_deleted, idle, never_written):
        assert not _exists(db_engine, "conversations", gone)
        assert not _exists(db_engine, "messages", gone, key="conversation_id")
    # The application stays (R5 may take it: not a shortlisted one).
    assert _exists(db_engine, "applications", lonely_app)
    for kept in (shared, recent):
        assert _exists(db_engine, "conversations", kept)
        assert _exists(db_engine, "messages", kept, key="conversation_id")


# --- R5 ----------------------------------------------------------------------------------------


def test_r5_applications(db_engine: Engine, gush_dan: uuid.UUID) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    listing = make_listing(db_engine, owner, gush_dan)
    cases = {
        "declined": ("declined", OUT_12M, False),
        "withdrawn": ("withdrawn", OUT_12M, False),
        "with_chat": ("declined", OUT_12M, True),
        "recent": ("withdrawn", IN_12M, False),
        "submitted": ("submitted", "3 years", False),
        "shortlisted": ("shortlisted", "3 years", False),
    }
    apps = {}
    for name, (status, age, chat) in cases.items():
        apps[name] = make_application(
            db_engine, listing, make_seeker(db_engine, f"{name}@example.com"), status=status
        )
        if chat:
            _chat(db_engine, apps[name], "1 day")
        _ago(db_engine, "applications", "updated_at", apps[name], age)

    assert _purge(db_engine)["r5_decided_applications"] == 2

    assert {n for n, a in apps.items() if not _exists(db_engine, "applications", a)} == {
        "declined",
        "withdrawn",
    }


# --- R6, R7 ------------------------------------------------------------------------------------


def test_r6_r7_reports(db_engine: Engine) -> None:
    reporter = make_seeker(db_engine, "reporter@example.com")
    reported = make_seeker(db_engine, "reported@example.com")

    def report(resolved: str | None) -> uuid.UUID:
        row = _report(
            db_engine, reporter, reported, "person", uuid.uuid4(), note="NOTE", resolved=resolved
        )
        _ago(db_engine, "reports", "created_at", row, "6 years")
        return row

    note_out, note_in, report_out, report_in, open_ = (
        report(age) for age in (OUT_12M, IN_12M, OUT_3Y, IN_3Y, None)
    )

    counts = _purge(db_engine)

    assert (counts["r6_report_notes"], counts["r7_reports"]) == (3, 1)

    def note(row: uuid.UUID) -> str | None:
        value: str | None = _execute(db_engine, "SELECT note FROM reports WHERE id = :id", id=row)
        return value

    assert not _exists(db_engine, "reports", report_out)
    assert (note(note_out), note(note_in), note(report_in), note(open_)) == (
        None,
        "NOTE",
        None,
        "NOTE",
    )


# --- R8 ----------------------------------------------------------------------------------------


def test_r8_admin_actions(
    client: TestClient, db_engine: Engine, gush_dan: uuid.UUID, photo_store: FilePhotoStore
) -> None:
    live = make_seeker(db_engine, "live@example.com")
    gone = make_seeker(db_engine, "gone@example.com")
    live_owner = make_owner(db_engine, "owner@example.com")
    gone_owner = make_owner(db_engine, "gone-owner@example.com")
    live_listing = make_listing(db_engine, live_owner, gush_dan)
    gone_listing = make_listing(db_engine, gone_owner, gush_dan)
    chat = make_direct_chat(db_engine, live, gone)
    _tombstone(db_engine, gone)
    _tombstone(db_engine, gone_owner)
    expired = {
        _action(db_engine, "read_chat", "chat", chat, "4 years"),
        _action(db_engine, "unsuspend", "user", live, "4 years"),
        _action(db_engine, "suspend", "user", gone, "4 years"),
        _action(db_engine, "hide_listing", "listing", gone_listing, "4 years"),
    }
    kept = {
        _action(db_engine, "suspend", "user", live, "4 years"),
        _action(db_engine, "hide_listing", "listing", live_listing, "4 years"),
        _action(db_engine, "set_listing_cap", "user", live, "2 years"),
    }
    # A live account whose only suspend is 4 years old.
    m_email = "m@example.com"
    m = make_seeker(db_engine, m_email)
    kept.add(_action(db_engine, "suspend", "user", m, "4 years"))

    assert _purge(db_engine)["r8_admin_actions"] == len(expired)

    assert {a for a in expired | kept if _exists(db_engine, "admin_actions", a)} == kept
    # The kept suspend still blocks M's re-signup once M deletes the account.
    _deleted(client, db_engine, m)
    assert _blocked(db_engine) == {accounts.email_hmac(m_email)}


# --- R9 ----------------------------------------------------------------------------------------


def test_r9_blocked_emails(client: TestClient, outbox: Outbox, db_engine: Engine) -> None:
    freed, still = "freed@example.com", "still@example.com"
    _block(db_engine, freed, "5 years 1 day")
    _block(db_engine, still, "4 years")

    assert _purge(db_engine)["r9_blocked_emails"] == 1

    assert _blocked(db_engine) == {accounts.email_hmac(still)}
    profile = {"display_name": "שוב", "role": "seeker"}
    for email, expected in ((freed, 201), (still, 403)):
        client.cookies.clear()
        code = _request_code(client, outbox, email)
        response = client.post(
            "/auth/otp/verify", json={"email": email, "code": code, "profile": profile}
        )
        assert response.status_code == expected, response.text
    assert response.json() == {"detail": "signup_blocked"}


# --- R10 ---------------------------------------------------------------------------------------


def test_r10_sessions(db_engine: Engine) -> None:
    user = make_seeker(db_engine, "user@example.com")
    gone = {
        _session(db_engine, user, expires="31 days"),
        _session(db_engine, user, expires="-10 days", revoked="31 days"),
    }
    kept = {
        _session(db_engine, user, expires="29 days"),
        _session(db_engine, user, expires="-10 days"),
    }

    assert _purge(db_engine)["r10_sessions"] == 2

    assert {s for s in gone | kept if _exists(db_engine, "sessions", s)} == kept


# --- AC10, AC11, AC13 --------------------------------------------------------------------------


def test_ac10_active_threads_kept(db_engine: Engine, gush_dan: uuid.UUID) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    seeker = make_seeker(db_engine, "seeker@example.com")
    gone = make_seeker(db_engine, "gone@example.com")
    gone_owner = make_owner(db_engine, "gone-owner@example.com")
    listing = make_listing(db_engine, owner, gush_dan)
    _chat(db_engine, make_application(db_engine, listing, gone, status="withdrawn"), IN_3Y)
    _chat(db_engine, make_application(db_engine, listing, seeker, status="shortlisted"), "1 day")
    _direct(db_engine, seeker, gone, last_message="2 years", created="4 years")
    # A deleted owner's listing whose last message is inside R1's 12 months.
    gone_listing = make_listing(db_engine, gone_owner, gush_dan)
    _chat(db_engine, make_application(db_engine, gone_listing, seeker, status="declined"), IN_12M)
    _tombstone(db_engine, gone, "2 years")
    _tombstone(db_engine, gone_owner, "2 years")
    before = {
        t: _count(db_engine, t) for t in ("listings", "applications", "conversations", "messages")
    }

    counts = _purge(db_engine)

    assert set(counts.values()) == {0}
    assert {t: _count(db_engine, t) for t in before} == before


def test_ac11_idempotent(db_engine: Engine, gush_dan: uuid.UUID) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    seeker = make_seeker(db_engine, "seeker@example.com")
    gone_owner = make_owner(db_engine, "gone-owner@example.com")
    make_listing(db_engine, gone_owner, gush_dan)  # R1
    _tombstone(db_engine, gone_owner, "2 years")
    listing = make_listing(
        db_engine,
        owner,
        gush_dan,
        status="paused",
        close_reason="rented_here",
        final_rent_ils=7000,
        closed_at=dt.datetime.now(dt.UTC),
    )
    _ago(db_engine, "listings", "closed_at", listing, "25 months")  # R3
    for age in ("30 months", "26 months", "1 month"):  # R2
        _price_change(db_engine, listing, age)
    # R4 deletes its chat, then R5 the application the same night.
    orphaned = make_application(db_engine, listing, seeker, status="declined")
    _chat(db_engine, orphaned, OUT_3Y)
    _ago(db_engine, "applications", "updated_at", orphaned, OUT_12M)
    reporter = make_seeker(db_engine, "reporter@example.com")
    _report(db_engine, reporter, seeker, "person", uuid.uuid4(), note="N", resolved="13 months")
    _report(db_engine, reporter, seeker, "person", uuid.uuid4(), resolved="4 years")
    _action(db_engine, "read_chat", "chat", uuid.uuid4(), "4 years")  # R8
    _block(db_engine, "old@example.com", "6 years")  # R9
    _session(db_engine, seeker, expires="31 days")  # R10

    first = _purge(db_engine)

    assert list(first) == [
        "r1_deleted_owner_listings",
        "r4_conversations",
        "r5_decided_applications",
        "r2_price_history",
        "r3_final_rent",
        "r6_report_notes",
        "r7_reports",
        "r8_admin_actions",
        "r10_sessions",
        "r9_blocked_emails",
    ]
    assert all(first.values()), first
    assert (first["r4_conversations"], first["r5_decided_applications"]) == (1, 1)
    assert not _exists(db_engine, "applications", orphaned)
    assert set(_purge(db_engine).values()) == {0}


def test_ac13_unresolved_report_keeps_target(db_engine: Engine, gush_dan: uuid.UUID) -> None:
    gone_owner = make_owner(db_engine, "gone-owner@example.com")
    owner = make_owner(db_engine, "owner@example.com")
    seeker = make_seeker(db_engine, "seeker@example.com")
    a, b, d, e = (make_seeker(db_engine, f"{n}@example.com") for n in "abde")
    reported_listing, via_application, via_chat = (
        make_listing(db_engine, gone_owner, gush_dan) for _ in range(3)
    )
    application = make_application(db_engine, via_application, seeker)
    listing_chat = _chat(
        db_engine, make_application(db_engine, via_chat, seeker, status="shortlisted")
    )
    both_deleted = _direct(db_engine, d, e, last_message="1 day")
    idle = _direct(db_engine, a, b, last_message="4 years")
    live_listing = make_listing(db_engine, owner, gush_dan)
    declined = make_application(db_engine, live_listing, a, status="declined")
    _ago(db_engine, "applications", "updated_at", declined, OUT_12M)
    _tombstone(db_engine, gone_owner, "2 years")
    _tombstone(db_engine, d)
    _tombstone(db_engine, e)
    reports = [
        _report(db_engine, seeker, gone_owner, "listing", reported_listing),
        _report(db_engine, seeker, gone_owner, "applicant", application),
        _report(db_engine, seeker, gone_owner, "chat", listing_chat),
        _report(db_engine, a, d, "chat", both_deleted),
        _report(db_engine, a, b, "chat", idle),
        _report(db_engine, owner, a, "applicant", declined),
    ]
    targets = [
        ("listings", reported_listing),
        ("listings", via_application),
        ("listings", via_chat),
        ("conversations", both_deleted),
        ("conversations", idle),
        ("applications", declined),
    ]

    assert set(_purge(db_engine).values()) == {0}
    assert all(_exists(db_engine, table, row) for table, row in targets)

    for report in reports:
        _ago(db_engine, "reports", "resolved_at", report, "0 days")
    counts = _purge(db_engine)

    assert (
        counts["r1_deleted_owner_listings"],
        counts["r4_conversations"],
        counts["r5_decided_applications"],
    ) == (3, 2, 1)
    assert not any(_exists(db_engine, table, row) for table, row in targets)
