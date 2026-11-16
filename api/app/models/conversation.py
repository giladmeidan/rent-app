"""`conversations` and `messages` tables (spec 0005a; own id and direct chats from 0010g): the chat
an owner opens by shortlisting an applicant (or a mutual like opens), and the direct chat two
people share with no room and no application.

Every CHECK, FK and index matches migrations 0006, 0014 and 0030 exactly (autogenerate must see no
diff). A conversation has its own `id`. One conversation per application, ever, and an
application chat's `id` equals its application's id (kept for links, PRODUCT.md "Chat", Q4;
`ck_conversations_application_id`); a direct chat's is random. A direct chat has no application:
its two people sit in `owner_id` / `seeker_id`, ordered (`ck_conversations_direct`), one chat per
pair, ever (`uq_conversations_direct_pair`). `services/chat.py` holds the rules."""

import datetime as dt
import uuid

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base

MESSAGE_KIND_CHECK = (
    "(tour_change IS NULL AND body IS NOT NULL AND tour_id IS NULL AND tour_starts_at IS NULL)"
    " OR (tour_change IS NOT NULL"
    " AND tour_change IN ('booked', 'rescheduled', 'cancelled_by_seeker', 'cancelled_by_lister',"
    " 'cancelled_by_system') AND body IS NULL AND tour_id IS NOT NULL"
    " AND tour_starts_at IS NOT NULL)"
)


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        CheckConstraint("owner_id <> seeker_id", name="ck_conversations_two_people"),
        # A direct chat stores its pair ordered (uuid byte order, as `least` / `greatest`).
        CheckConstraint(
            "application_id IS NOT NULL OR owner_id < seeker_id", name="ck_conversations_direct"
        ),
        # Only a direct chat closes; an application chat closes through its status.
        CheckConstraint(
            "closed_at IS NULL OR application_id IS NULL", name="ck_conversations_closed_direct"
        ),
        # An application chat's id is its application's (links built from an application id).
        CheckConstraint(
            "application_id IS NULL OR id = application_id",
            name="ck_conversations_application_id",
        ),
        UniqueConstraint("application_id", name="uq_conversations_application_id"),
        Index("ix_conversations_owner_id", "owner_id"),
        Index("ix_conversations_seeker_id", "seeker_id"),
        # One direct chat per pair, ever: `open_direct`'s conflict target, serves `close_direct`.
        Index(
            "uq_conversations_direct_pair",
            "owner_id",
            "seeker_id",
            unique=True,
            postgresql_where=text("application_id IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    # Null = a direct chat (spec 0010g).
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("applications.id", ondelete="CASCADE")
    )
    # The listing's owner at open time (listings never change owner); in a direct chat the lower
    # of the two people's ids.
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # = applications.seeker_id; in a direct chat the higher of the two people's ids.
    seeker_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Set to now() on open: the owner opened it.
    owner_read_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    # Null = the seeker never opened it (`is_new`).
    seeker_read_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    # The newest message's `created_at`; null = no messages.
    last_message_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    # A direct chat closed by either side (the match was removed); null = open. Always null on an
    # application chat.
    closed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint("char_length(body) BETWEEN 1 AND 2000", name="ck_messages_body_length"),
        # A typed message or a tour line (spec 0018a), never both.
        CheckConstraint(MESSAGE_KIND_CHECK, name="ck_messages_kind"),
        # Serves the thread (newest 200), the newest message and the unread count.
        Index("ix_messages_conversation_created", "conversation_id", "created_at", "id"),
        # The cascade from `tours`.
        Index("ix_messages_tour_id", "tour_id", postgresql_where=text("tour_id IS NOT NULL")),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE", name="fk_messages_conversation_id"),
        nullable=False,
    )
    # A deleted account takes its messages with it (as `applications`).
    sender_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Plain text, stored and returned as validated by `MessageIn`; never HTML. NULL exactly on a
    # tour line (spec 0018a).
    body: Mapped[str | None] = mapped_column(Text)
    # A tour line (spec 0018a): the tour, the change and the time it showed (a reschedule moves
    # the tour, not its old lines). Its sender is whoever caused the change.
    tour_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tours.id", ondelete="CASCADE", name="fk_messages_tour_id")
    )
    tour_change: Mapped[str | None] = mapped_column(Text)
    tour_starts_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
