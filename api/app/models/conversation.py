"""`conversations` and `messages` tables (spec 0005a): the one-to-one chat an owner opens by
shortlisting an applicant.

Every CHECK, FK and index matches migration 0006 exactly (autogenerate must see no diff). One
conversation per application, ever; its primary key **is** the application's id (PRODUCT.md
"Chat", Q4). `services/chat.py` holds the rules."""

import datetime as dt
import uuid

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        CheckConstraint("owner_id <> seeker_id", name="ck_conversations_two_people"),
        Index("ix_conversations_owner_id", "owner_id"),
        Index("ix_conversations_seeker_id", "seeker_id"),
    )

    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("applications.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # The listing's owner at open time (listings never change owner).
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # = applications.seeker_id
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


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint("char_length(body) BETWEEN 1 AND 2000", name="ck_messages_body_length"),
        # Serves the thread (newest 200), the newest message and the unread count.
        Index("ix_messages_conversation_created", "conversation_id", "created_at", "id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.application_id", ondelete="CASCADE"),
        nullable=False,
    )
    # A deleted account takes its messages with it (as `applications`).
    sender_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Plain text, stored and returned as validated by `MessageIn`; never HTML.
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
