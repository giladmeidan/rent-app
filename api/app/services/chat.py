"""Chat (spec 0005a): the one-to-one conversation an owner opens by shortlisting an applicant
(`services/applications.set_applicant_status`), listed, read and written by its two participants.

Rules (PRODUCT.md "Chat"):
- One conversation per application, ever; its id is the application's id. Only its `owner_id` and
  `seeker_id` may see it: every statement has the membership condition in its WHERE, so an unknown
  id, an application never shortlisted and someone else's conversation are one case
  (`ConversationNotFoundError`, a 404).
- Sending is open exactly while the application is `shortlisted`; after an un-shortlist, decline or
  withdraw the thread stays readable by both and sending is `ChatClosedError` (Q2). The status is
  checked in the `INSERT ... SELECT`'s own snapshot, without a lock: a decline committing at the
  same instant can let one message land after it (harmless, by design).
- Each side has its own read marker (`owner_read_at`, `seeker_read_at`): unread = the other
  side's messages newer than mine; `is_new` = my marker is null. Reading a thread moves my marker
  to `now()` only when something is new, so a poll with nothing new writes nothing (NF3).
- Sending is rate limited per user (`CHAT_RATE_LIMIT_MINUTE`, `CHAT_RATE_LIMIT_DAY`); every
  authenticated, body-valid attempt counts, a refused one does not (as `apply`).
- The other participant is known by `users.display_name` only (NF2): no query loads the `User`."""

import datetime as dt
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import (
    DateTime,
    Row,
    Text,
    case,
    func,
    literal,
    literal_column,
    or_,
    select,
    true,
    update,
)
from sqlalchemy.dialects.postgresql import UUID, insert
from sqlalchemy.orm import Session

from app.models import Application, Conversation, Listing, Message, User
from app.redis_client import RedisClient
from app.services.rate_limit import count_or_raise

CHAT_RATE_LIMIT_MINUTE = 20
CHAT_RATE_MINUTE_S = 60
CHAT_RATE_LIMIT_DAY = 300
CHAT_RATE_DAY_S = 86_400

THREAD_LIMIT = 200
PREVIEW_LENGTH = 120

# The listing summary (`ApplicationListingOut`) as `listing_*` columns.
_LISTING_COLUMNS = (
    Listing.id.label("listing_id"),
    Listing.listing_type.label("listing_type"),
    Listing.city.label("listing_city"),
    Listing.street.label("listing_street"),
    Listing.rooms.label("listing_rooms"),
    Listing.price_ils.label("listing_price_ils"),
)


class ConversationNotFoundError(Exception):
    """Unknown id, an application never shortlisted, or a conversation the caller is not in
    (deliberately one case)."""


class ChatClosedError(Exception):
    """The caller is a participant, but the application is not `shortlisted`."""


@dataclass(frozen=True)
class Thread:
    """`get_thread`'s result: the header row (`listing_*`, `other_name`, `status`) and the newest
    `THREAD_LIMIT` messages oldest first (rows of `id`, `body`, `mine`, `created_at`)."""

    header: Row[Any]
    messages: Sequence[Row[Any]]
    truncated: bool


def _is_member(me: User) -> Any:
    return or_(Conversation.owner_id == me.id, Conversation.seeker_id == me.id)


def _is_other(me: User) -> Any:
    """The join condition onto `users` for the other participant (select `display_name` only)."""
    return User.id == case(
        (Conversation.owner_id == me.id, Conversation.seeker_id), else_=Conversation.owner_id
    )


def list_conversations(db: Session, me: User) -> Sequence[Row[Any]]:
    """Every conversation `me` is in (either side, any application status), latest activity first
    (`coalesce(last_message_at, created_at)` desc, then id). One statement: the listing summary,
    the other participant's name, `can_send`, `is_new`, the newest message (`last_*`, null when
    none; its body cut to `PREVIEW_LENGTH`) and the unread count."""
    is_owner = Conversation.owner_id == me.id
    my_read_at = case((is_owner, Conversation.owner_read_at), else_=Conversation.seeker_read_at)
    newest = (
        select(
            func.left(Message.body, PREVIEW_LENGTH).label("body"),
            (Message.sender_id == me.id).label("mine"),
            Message.created_at.label("created_at"),
        )
        .where(Message.conversation_id == Conversation.application_id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(1)
        .lateral("newest")
    )
    # A null marker counts every message: `-infinity` keeps the index range scan.
    since = func.coalesce(
        my_read_at, literal_column("'-infinity'::timestamptz", DateTime(timezone=True))
    )
    unread = (
        select(func.count())
        .select_from(Message)
        .where(
            Message.conversation_id == Conversation.application_id,
            Message.created_at > since,
            Message.sender_id != me.id,
        )
        .correlate(Conversation)
        .scalar_subquery()
    )
    rows = db.execute(
        select(
            Conversation.application_id.label("id"),
            Conversation.created_at.label("created_at"),
            *_LISTING_COLUMNS,
            User.display_name.label("other_name"),
            (Application.status == "shortlisted").label("can_send"),
            my_read_at.is_(None).label("is_new"),
            unread.label("unread_count"),
            newest.c.body.label("last_body"),
            newest.c.mine.label("last_mine"),
            newest.c.created_at.label("last_created_at"),
        )
        .select_from(Conversation)
        .join(Application, Application.id == Conversation.application_id)
        .join(Listing, Listing.id == Application.listing_id)
        .join(User, _is_other(me))
        .outerjoin(newest, true())
        .where(_is_member(me))
        .order_by(
            func.coalesce(Conversation.last_message_at, Conversation.created_at).desc(),
            Conversation.application_id,
        )
    )
    return rows.all()


def get_thread(db: Session, me: User, conversation_id: uuid.UUID) -> Thread:
    """One of `me`'s conversations with its newest `THREAD_LIMIT` messages (any application
    status), marking it read for `me`. Raises `ConversationNotFoundError`. Two statements, plus
    one UPDATE and a commit only when `me`'s read marker is null or older than the newest message
    (a poll with nothing new writes nothing, NF3)."""
    try:
        header = db.execute(
            select(
                *_LISTING_COLUMNS,
                User.display_name.label("other_name"),
                Application.status.label("status"),
                (Conversation.owner_id == me.id).label("is_owner"),
                case(
                    (Conversation.owner_id == me.id, Conversation.owner_read_at),
                    else_=Conversation.seeker_read_at,
                ).label("my_read_at"),
                Conversation.last_message_at.label("last_message_at"),
            )
            .select_from(Conversation)
            .join(Application, Application.id == Conversation.application_id)
            .join(Listing, Listing.id == Application.listing_id)
            .join(User, _is_other(me))
            .where(Conversation.application_id == conversation_id, _is_member(me))
        ).one_or_none()
        if header is None:
            raise ConversationNotFoundError
        # shortcut: no paging, the 200 newest only; add a before-cursor when a thread passes ~200
        # messages
        newest_first = db.execute(
            select(
                Message.id,
                Message.body,
                (Message.sender_id == me.id).label("mine"),
                Message.created_at,
            )
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(THREAD_LIMIT + 1)
        ).all()
        my_read_at: dt.datetime | None = header.my_read_at
        last_message_at: dt.datetime | None = header.last_message_at
        if my_read_at is None or (last_message_at is not None and my_read_at < last_message_at):
            column = Conversation.owner_read_at if header.is_owner else Conversation.seeker_read_at
            db.execute(
                update(Conversation)
                .where(
                    Conversation.application_id == conversation_id,
                    or_(column.is_(None), column < Conversation.last_message_at),
                )
                .values({column: func.now()})
                .execution_options(synchronize_session=False)
            )
            db.commit()
    except Exception:
        db.rollback()
        raise
    messages = list(reversed(newest_first[:THREAD_LIMIT]))
    return Thread(header=header, messages=messages, truncated=len(newest_first) > THREAD_LIMIT)


def send_message(
    db: Session, r: RedisClient, me: User, conversation_id: uuid.UUID, body: str
) -> tuple[Message, uuid.UUID, uuid.UUID]:
    """Send `body` (already validated by `MessageIn`) as `me` to one of `me`'s conversations whose
    application is `shortlisted`, and return the message with the conversation's `owner_id` and
    `seeker_id` (the router publishes the chat event to both, spec 0005c). Raises
    `RateLimitedError`, `ConversationNotFoundError` or `ChatClosedError`. Moves the conversation's
    `last_message_at` and `me`'s read marker forward (never back: `greatest` skips nulls, so two
    sends committing out of order are safe). Commits."""
    count_or_raise(
        r,
        (
            (f"rl:chat:user:{me.id}", CHAT_RATE_LIMIT_MINUTE, CHAT_RATE_MINUTE_S),
            (f"rl:chat:user:day:{me.id}", CHAT_RATE_LIMIT_DAY, CHAT_RATE_DAY_S),
        ),
    )
    try:
        source = (
            select(
                Conversation.application_id,
                literal(me.id, UUID(as_uuid=True)),
                literal(body, Text),
            )
            .join(Application, Application.id == Conversation.application_id)
            .where(
                Conversation.application_id == conversation_id,
                _is_member(me),
                Application.status == "shortlisted",
            )
        )
        message = db.scalar(
            insert(Message)
            .from_select(["conversation_id", "sender_id", "body"], source)
            .returning(Message)
        )
        if message is None:
            member = db.scalar(
                select(Conversation.application_id).where(
                    Conversation.application_id == conversation_id, _is_member(me)
                )
            )
            if member is None:
                raise ConversationNotFoundError
            raise ChatClosedError
        is_owner = Conversation.owner_id == me.id
        participants = db.execute(
            update(Conversation)
            .where(Conversation.application_id == conversation_id)
            .values(
                last_message_at=func.greatest(Conversation.last_message_at, message.created_at),
                owner_read_at=case(
                    (is_owner, func.greatest(Conversation.owner_read_at, message.created_at)),
                    else_=Conversation.owner_read_at,
                ),
                seeker_read_at=case(
                    (is_owner, Conversation.seeker_read_at),
                    else_=func.greatest(Conversation.seeker_read_at, message.created_at),
                ),
            )
            .returning(Conversation.owner_id, Conversation.seeker_id)
            .execution_options(synchronize_session=False)
        ).one()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return message, participants.owner_id, participants.seeker_id
