"""The admin's actions (spec 0012b). Each flips 0012a's columns with one UPDATE and logs one
`admin_actions` row per changed target, in one transaction, then commits; the views call only
these. A target the UPDATE leaves as it was (already suspended, already resolved, ...) gets no row.
"""

import uuid
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, insert, select, tuple_, update
from sqlalchemy.orm import Session

from app.models import (
    AdminAction,
    Application,
    Conversation,
    Listing,
    ListingFlatmate,
    Message,
    Report,
    User,
)
from app.models import Session as UserSession
from app.models.admin_action import AdminActionKind, AdminTargetType

_NO_SYNC: dict[str, Any] = {"synchronize_session": False}


def _log(
    session: Session,
    action: AdminActionKind,
    target_type: AdminTargetType,
    rows: Sequence[tuple[uuid.UUID, str | None]],
) -> None:
    """One `admin_actions` row per `(target_id, detail)`, in the caller's transaction."""
    if rows:
        session.execute(
            insert(AdminAction),
            [
                {"action": action, "target_type": target_type, "target_id": t, "detail": d}
                for t, d in rows
            ],
        )


def suspend(session: Session, user_ids: Sequence[uuid.UUID]) -> int:
    """Suspend the users not suspended yet and revoke their live sessions, so lifting the
    suspension does not revive them. Returns how many were suspended."""
    ids = session.scalars(
        update(User)
        .where(User.id.in_(user_ids), User.suspended_at.is_(None))
        .values(suspended_at=func.now())
        .returning(User.id)
        .execution_options(**_NO_SYNC)
    ).all()
    if ids:
        session.execute(
            update(UserSession)
            .where(UserSession.user_id.in_(ids), UserSession.revoked_at.is_(None))
            .values(revoked_at=func.now())
            .execution_options(**_NO_SYNC)
        )
    _log(session, "suspend", "user", [(i, None) for i in ids])
    session.commit()
    return len(ids)


def unsuspend(session: Session, user_ids: Sequence[uuid.UUID]) -> int:
    """Lift the suspension. Old sessions stay revoked: the user signs in afresh."""
    ids = session.scalars(
        update(User)
        .where(User.id.in_(user_ids), User.suspended_at.is_not(None))
        .values(suspended_at=None)
        .returning(User.id)
        .execution_options(**_NO_SYNC)
    ).all()
    _log(session, "unsuspend", "user", [(i, None) for i in ids])
    session.commit()
    return len(ids)


def hide_listings(session: Session, listing_ids: Sequence[uuid.UUID]) -> int:
    """Pause and mark removed (`ck_listings_removed_paused`)."""
    ids = session.scalars(
        update(Listing)
        .where(Listing.id.in_(listing_ids), Listing.removed_at.is_(None))
        .values(status="paused", removed_at=func.now())
        .returning(Listing.id)
        .execution_options(**_NO_SYNC)
    ).all()
    _log(session, "hide_listing", "listing", [(i, None) for i in ids])
    session.commit()
    return len(ids)


def unhide_listings(session: Session, listing_ids: Sequence[uuid.UUID]) -> int:
    """Clear `removed_at`; the listing stays paused, so its owner resumes it under their cap."""
    ids = session.scalars(
        update(Listing)
        .where(Listing.id.in_(listing_ids), Listing.removed_at.is_not(None))
        .values(removed_at=None)
        .returning(Listing.id)
        .execution_options(**_NO_SYNC)
    ).all()
    _log(session, "unhide_listing", "listing", [(i, None) for i in ids])
    session.commit()
    return len(ids)


def resolve_reports(session: Session, report_ids: Sequence[uuid.UUID]) -> int:
    """Resolve the selected reports and every other open report on the same target. One log row
    per target: on the first selected report of that target, detail = how many it closed.
    Returns how many reports were closed."""
    order = {report_id: i for i, report_id in enumerate(report_ids)}
    selected = session.execute(
        select(Report.id, Report.target_type, Report.target_id).where(Report.id.in_(report_ids))
    ).all()
    first: dict[tuple[str, uuid.UUID], uuid.UUID] = {}
    for row in sorted(selected, key=lambda r: order[r.id]):
        first.setdefault((row.target_type, row.target_id), row.id)
    if not first:
        return 0
    closed = session.execute(
        update(Report)
        .where(
            Report.resolved_at.is_(None),
            tuple_(Report.target_type, Report.target_id).in_(list(first)),
        )
        .values(resolved_at=func.now())
        .returning(Report.target_type, Report.target_id)
        .execution_options(**_NO_SYNC)
    ).all()
    counts = Counter((row.target_type, row.target_id) for row in closed)
    _log(session, "resolve_reports", "report", [(first[t], str(n)) for t, n in counts.items()])
    session.commit()
    return len(closed)


def log_listing_cap(session: Session, user: User, new_cap: int) -> None:
    """UserView's edit: log the cap change in SQLAdmin's own update session, before its commit
    writes the new value, so both land or neither does."""
    if new_cap != user.listing_cap:
        session.add(
            AdminAction(
                action="set_listing_cap",
                target_type="user",
                target_id=user.id,
                detail=f"{user.listing_cap}→{new_cap}",
            )
        )


@dataclass(frozen=True)
class ChatMessage:
    sender: str
    sent_at: str  # Asia/Jerusalem, formatted by Postgres
    body: str


@dataclass(frozen=True)
class ReportedChat:
    report_id: uuid.UUID
    members: list[str]
    messages: list[ChatMessage]


def read_chat(session: Session, report_id: uuid.UUID) -> ReportedChat | None:
    """A reported conversation: its members and all its messages, oldest first, and one
    `read_chat` row per open. None (nothing logged) unless `report_id` is a `chat` report whose
    conversation still exists."""
    # A deleted account's name is NULL (spec 0013c).
    name = func.coalesce(User.display_name, "(deleted account)")
    report = session.get(Report, report_id)
    if report is None or report.target_type != "chat":
        return None
    conversation = session.get(Conversation, report.target_id)
    if conversation is None:
        return None
    names = dict(
        session.execute(
            select(User.id, name).where(
                User.id.in_([conversation.owner_id, conversation.seeker_id])
            )
        )
        .tuples()
        .all()
    )
    members = [names[conversation.owner_id], names[conversation.seeker_id]]
    application = (
        session.get(Application, conversation.application_id)
        if conversation.application_id
        else None
    )
    if application is not None and application.listing_type_at_apply == "room":
        # As services/chat.py: the room's flatmates, the seeker excluded.
        members += session.scalars(
            select(name)
            .join(ListingFlatmate, ListingFlatmate.user_id == User.id)
            .where(
                ListingFlatmate.listing_id == application.listing_id,
                ListingFlatmate.user_id != application.seeker_id,
            )
            .order_by(ListingFlatmate.joined_at, ListingFlatmate.id)
        ).all()
    rows = session.execute(
        select(
            name,
            func.to_char(func.timezone("Asia/Jerusalem", Message.created_at), "YYYY-MM-DD HH24:MI"),
            Message.body,
        )
        .join(User, User.id == Message.sender_id)
        .where(Message.conversation_id == conversation.id)
        .order_by(Message.created_at, Message.id)
    ).tuples()
    messages = [ChatMessage(sender, sent_at, body) for sender, sent_at, body in rows]
    _log(session, "read_chat", "chat", [(conversation.id, str(report_id))])
    session.commit()
    return ReportedChat(report_id, members, messages)
