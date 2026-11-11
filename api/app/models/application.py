"""`applications` table (spec 0004a): a seeker's application to a listing, with a short message.

Every CHECK, the unique constraint, the FKs and the index match migrations 0005, 0008 and 0010
exactly (autogenerate must see no diff). One row per (listing, seeker), ever: re-applying after a
withdrawal reopens the same row (`services/applications.py`)."""

import datetime as dt
import uuid

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
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
        CheckConstraint(
            "listing_type_at_apply IN ('apartment', 'room')",
            name="ck_applications_listing_type_at_apply",
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
    # The listing's price and area when the seeker applied (spec 0006c, security B1), set again
    # when a withdrawn application is reopened. The owner's inbox scores the budget and area
    # criteria against these, never the listing's live values, so editing the listing cannot
    # probe the seeker's budget or areas. Never in a response schema.
    price_ils_at_apply: Mapped[int] = mapped_column(Integer, nullable=False)
    area_id_at_apply: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("areas.id", ondelete="RESTRICT", name="fk_applications_area_id_at_apply"),
        nullable=False,
    )
    # The listing type the seeker applied to (spec 0007b), set again when a withdrawn application
    # is reopened. 0007c keys the inbox's room fields on it, and 0007g the owner's lifestyle
    # criterion. No server default: a write path that forgets it fails. Never in a response schema.
    listing_type_at_apply: Mapped[str] = mapped_column(Text, nullable=False)
    # Reset to now() when a withdrawn application is reopened, so the owner sees it as new.
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    # Set to now() by every status change.
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
