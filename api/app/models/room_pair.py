"""`room_pairs` table (spec 0008a): one row per (room listing, seeker) that either side ever saw in
people browse or liked.

Every CHECK, the unique constraint, the FKs and the index match migration 0011 exactly (autogenerate
must see no diff). `services/people.py` is the only writer and holds the rules.

`id` is the person card's id, so a lister never handles a seeker's user id. `price_ils_seen` is the
listing's `price_ils` when the row was created and is **never updated** (Gilad 2026-11-11, "freeze
price per pair"): the card's budget criterion and a mutual like's `price_ils_at_apply` both read
it, so editing the price cannot probe the seeker's budget through people browse. A like column is
NULL when that side has not liked; both are cleared when the pair becomes an application."""

import datetime as dt
import uuid

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class RoomPair(Base):
    __tablename__ = "room_pairs"
    __table_args__ = (
        CheckConstraint("price_ils_seen > 0", name="ck_room_pairs_price"),
        # Its index (leading `listing_id`) also serves the listing's scans.
        UniqueConstraint("listing_id", "seeker_id", name="uq_room_pairs_listing_seeker"),
        Index("ix_room_pairs_seeker_id", "seeker_id"),  # `GET /me/likes`
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    listing_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id", ondelete="CASCADE"), nullable=False
    )
    seeker_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # The listing's price when the row was created; never updated (see the module docstring).
    price_ils_seen: Mapped[int] = mapped_column(Integer, nullable=False)
    lister_liked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    seeker_liked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
