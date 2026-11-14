"""`listing_price_changes` table (spec 0014b): every price a listing had, one row per change.

Matches migration 0020 exactly (autogenerate must see no diff). `services/listings.py` writes a row
on create and on a PATCH that changes `price_ils`, in the listing's own transaction. Private: no
schema returns it; the rent price estimate engine (a later spec) reads it."""

import datetime as dt
import uuid

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class ListingPriceChange(Base):
    __tablename__ = "listing_price_changes"
    __table_args__ = (
        CheckConstraint(
            "price_ils BETWEEN 500 AND 100000", name="ck_listing_price_changes_price_ils"
        ),
        Index("ix_listing_price_changes_listing_id", "listing_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    listing_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id", ondelete="CASCADE"), nullable=False
    )
    price_ils: Mapped[int] = mapped_column(Integer, nullable=False)  # monthly
    # When this price started.
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
