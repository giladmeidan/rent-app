"""`listing_flatmates` and `conversation_reads` tables (spec 0008d): who joined a room listing's
flat through its invite link, and each flatmate's read marker per conversation.

Every FK, the unique constraint and the index match migrations 0012, 0014 (which moves and names
the `conversation_reads` FK) and 0016 (`shown`) exactly (autogenerate must see no diff).
`services/flatmates.py` writes memberships; `services/chat.py` reads both and writes
`conversation_reads`.

A membership reaches only conversations of **room** applications (`listing_type_at_apply =
'room'`), and only the messages sent from its `joined_at` on. `conversation_reads` holds flatmates'
markers only: the owner and the seeker keep `conversations.owner_read_at` / `seeker_read_at`."""

import datetime as dt
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class ListingFlatmate(Base):
    __tablename__ = "listing_flatmates"
    __table_args__ = (
        # Its index (leading `listing_id`) also serves the chat statements' membership join.
        UniqueConstraint("listing_id", "user_id", name="uq_listing_flatmates_listing_user"),
        Index("ix_listing_flatmates_user_id", "user_id"),  # `GET /me/flats`
    )

    # The membership's id (`FlatmateOut.id`): the owner removes a flatmate by it, never by user id.
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    listing_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Where the flatmate's view of every chat about the room begins (a re-join is a new row).
    joined_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    # The flatmate's own choice to appear on the room's page, to seekers only (spec 0010f,
    # decision 17): set at join, changed from `/me/flats`; a re-join of a member keeps it.
    shown: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))


class ConversationRead(Base):
    __tablename__ = "conversation_reads"

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "conversations.id", ondelete="CASCADE", name="fk_conversation_reads_conversation_id"
        ),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    read_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
