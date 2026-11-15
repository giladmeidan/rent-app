"""Data retention (spec 0013h): how long each kind of personal data stays, enforced nightly by
`worker.py::purge_expired_job`. The periods are PRODUCT.md "Retention" and the privacy policy's
section 5; changing one changes the policy text too.

Each rule is one set-based statement whose period is compared in SQL (`now() - interval`), never
with a Python clock, and returns its row count. An **unresolved report** (`resolved_at IS NULL`)
keeps what it points at (`services/reports.py::_LOOKUPS`: a `listing` id, a `chat` conversation
id, an `applicant` application id): R1, R4 and R5 skip it, so the admin can still read it. Nothing
here logs an id or a value."""

from collections.abc import Callable

from sqlalchemy import text
from sqlalchemy.orm import Session

DELETED_OWNER_LISTING = "12 months"  # R1, after the last message (or the deletion)
PRICE_HISTORY = "24 months"  # R2, per price change
FINAL_RENT = "24 months"  # R3, from the closure
CONVERSATION_IDLE = "3 years"  # R4 (b), with no message
DECIDED_APPLICATION = "12 months"  # R5, declined / withdrawn without a chat
REPORT_NOTE = "12 months"  # R6, after resolution
REPORT = "3 years"  # R7, after resolution
ADMIN_ACTION = "3 years"  # R8
BLOCKED_EMAIL = "5 years"  # R9, from blocking

_CUTOFF = "now() - CAST(:period AS interval)"

# The conversations of a listing `l` (a conversation has no listing id: through its application).
_LISTING_CHATS = (
    "SELECT c.id FROM conversations c JOIN applications a ON a.id = c.application_id"
    " WHERE a.listing_id = l.id"
)


def _run(db: Session, sql: str, period: str) -> int:
    result = db.connection().execute(text(sql), {"period": period})
    return int(result.rowcount)


def purge_deleted_owner_listings(db: Session) -> int:
    """R1: a deleted owner's listing 12 months after the later of the deletion and the last message
    in its conversations (`greatest` ignores the NULL of a listing with no message). Cascades its
    price changes, flatmates, applications and, through them, conversations, messages and read
    markers. Skipped while an unresolved report targets the listing, one of its applications or
    one of its conversations."""
    return _run(
        db,
        "DELETE FROM listings l USING users u"
        " WHERE u.id = l.owner_id AND u.deleted_at IS NOT NULL"
        " AND greatest(u.deleted_at, (SELECT max(c.last_message_at) FROM conversations c"
        " JOIN applications a ON a.id = c.application_id WHERE a.listing_id = l.id))"
        f" < {_CUTOFF}"
        " AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.resolved_at IS NULL AND ("
        " (r.target_type = 'listing' AND r.target_id = l.id)"
        " OR (r.target_type = 'applicant'"
        " AND r.target_id IN (SELECT a.id FROM applications a WHERE a.listing_id = l.id))"
        f" OR (r.target_type = 'chat' AND r.target_id IN ({_LISTING_CHATS}))))",
        DELETED_OWNER_LISTING,
    )


def purge_price_history(db: Session) -> int:
    """R2: price changes older than 24 months, except each listing's newest (the current price)."""
    return _run(
        db,
        "DELETE FROM listing_price_changes p"
        f" WHERE p.created_at < {_CUTOFF}"
        " AND EXISTS (SELECT 1 FROM listing_price_changes n WHERE n.listing_id = p.listing_id"
        " AND (n.created_at, n.id) > (p.created_at, p.id))",
        PRICE_HISTORY,
    )


def purge_final_rent(db: Session) -> int:
    """R3: the final rent 24 months after the closure. `close_reason` and `closed_at` stay
    (`ck_listings_closed_at` needs them together; neither is personal)."""
    return _run(
        db,
        "UPDATE listings SET final_rent_ils = NULL"
        f" WHERE final_rent_ils IS NOT NULL AND closed_at < {_CUTOFF}",
        FINAL_RENT,
    )


def purge_conversations(db: Session) -> int:
    """R4: a conversation (a) whose owner and seeker are both deleted and, for a room chat, whose
    room has no live flatmate, or (b) with no message (or, with none, no creation) for 3 years.
    Skipped while an unresolved `chat` report targets it. Messages and read markers cascade; the
    application stays (R5 may take it)."""
    return _run(
        db,
        "DELETE FROM conversations c WHERE ("
        " (EXISTS (SELECT 1 FROM users o WHERE o.id = c.owner_id AND o.deleted_at IS NOT NULL)"
        " AND EXISTS (SELECT 1 FROM users s WHERE s.id = c.seeker_id AND s.deleted_at IS NOT NULL)"
        " AND NOT EXISTS (SELECT 1 FROM applications a"
        " JOIN listing_flatmates f ON f.listing_id = a.listing_id"
        " JOIN users fu ON fu.id = f.user_id"
        " WHERE a.id = c.application_id AND a.listing_type_at_apply = 'room'"
        " AND fu.deleted_at IS NULL))"
        f" OR coalesce(c.last_message_at, c.created_at) < {_CUTOFF})"
        " AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.resolved_at IS NULL"
        " AND r.target_type = 'chat' AND r.target_id = c.id)",
        CONVERSATION_IDLE,
    )


def purge_decided_applications(db: Session) -> int:
    """R5: a declined or withdrawn application with no conversation, 12 months after the decision
    (`updated_at`, set by every status change). Skipped while an unresolved `applicant` report
    targets it."""
    return _run(
        db,
        "DELETE FROM applications a WHERE a.status IN ('declined', 'withdrawn')"
        " AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.application_id = a.id)"
        f" AND a.updated_at < {_CUTOFF}"
        " AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.resolved_at IS NULL"
        " AND r.target_type = 'applicant' AND r.target_id = a.id)",
        DECIDED_APPLICATION,
    )


def purge_report_notes(db: Session) -> int:
    """R6: a report's free-text note 12 months after resolution."""
    return _run(
        db,
        f"UPDATE reports SET note = NULL WHERE note IS NOT NULL AND resolved_at < {_CUTOFF}",
        REPORT_NOTE,
    )


def purge_reports(db: Session) -> int:
    """R7: a report 3 years after resolution; an unresolved one never."""
    return _run(db, f"DELETE FROM reports WHERE resolved_at < {_CUTOFF}", REPORT)


def purge_admin_actions(db: Session) -> int:
    """R8: admin actions older than 3 years, except a `suspend` on a live account and a
    `hide_listing` on a live owner's listing: the re-signup block is computed from them at
    deletion (`accounts.delete_account` step 2), and they are the current state."""
    return _run(
        db,
        f"DELETE FROM admin_actions x WHERE x.created_at < {_CUTOFF}"
        " AND NOT (x.action = 'suspend' AND x.target_type = 'user' AND EXISTS ("
        " SELECT 1 FROM users u WHERE u.id = x.target_id AND u.deleted_at IS NULL))"
        " AND NOT (x.action = 'hide_listing' AND x.target_type = 'listing' AND EXISTS ("
        " SELECT 1 FROM listings l JOIN users u ON u.id = l.owner_id"
        " WHERE l.id = x.target_id AND u.deleted_at IS NULL))",
        ADMIN_ACTION,
    )


def purge_blocked_emails(db: Session) -> int:
    """R9: a re-signup block 5 years after blocking."""
    return _run(db, f"DELETE FROM blocked_emails WHERE created_at < {_CUTOFF}", BLOCKED_EMAIL)


# The order matters: R4 before R5 (an application whose chat R4 deletes is R5's the same night).
_RULES: tuple[tuple[str, Callable[[Session], int]], ...] = (
    ("r1_deleted_owner_listings", purge_deleted_owner_listings),
    ("r4_conversations", purge_conversations),
    ("r5_decided_applications", purge_decided_applications),
    ("r2_price_history", purge_price_history),
    ("r3_final_rent", purge_final_rent),
    ("r6_report_notes", purge_report_notes),
    ("r7_reports", purge_reports),
    ("r8_admin_actions", purge_admin_actions),
    ("r9_blocked_emails", purge_blocked_emails),
)


def purge_expired(db: Session) -> dict[str, int]:
    """Run every rule in one transaction, commit, and return `{rule: rows}`."""
    try:
        counts = {name: rule(db) for name, rule in _RULES}
        db.commit()
    except Exception:
        db.rollback()
        raise
    return counts
