"""`applications` table (spec 0004a): a seeker's application to a listing, with a short message.

Every CHECK, the unique constraint, the FKs and the index match migration 0005 exactly
(autogenerate must see no diff). One row per (listing, seeker), ever: re-applying after a
withdrawal reopens the same row (`services/applications.py`)."""

import datetime as dt
import uuid

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (
        CheckConstraint(
            "char_length(message) BETWEEN 1 AND 500", name="ck_applications_message_length"
        ),
        CheckConstraint(
            "status IN ('submitted', 'shortlisted', 'declined', 'withdrawn')",
            name="ck_applications_status",
        ),
        UniqueConstraint("listing_id", "seeker_id", name="uq_applications_listing_seeker"),
        Index("ix_applications_seeker_id", "seeker_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    listing_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id", ondelete="CASCADE"), nullable=False
    )
    # A deleted account takes its messages with it.
    seeker_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Plain text, stored and returned as sent (after `ApplicationIn`'s rules); never HTML.
    message: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'submitted'"))
    # Reset to now() when a withdrawn application is reopened, so the owner sees it as new.
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    # Set to now() by every status change.
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
