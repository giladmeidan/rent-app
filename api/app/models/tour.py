"""`tour_windows`, `tours` and `tour_feeds` tables (spec 0018a, migration 0030). Every CHECK, FK
and index matches the migration exactly (autogenerate must see no diff). `services/tours.py` holds
the rules.

A window is a stretch of time a lister opens on a listing (entered as Israel wall time, stored
UTC), cut into slots of `slot_minutes`; windows of one listing never overlap (checked by the
service under the listing's row lock: an exclusion constraint needs `btree_gist`). A tour is one
seeker's booking of one slot: never two `booked` tours on one (listing, `starts_at`)
(`uq_tours_listing_slot`); at most one upcoming `booked` tour per application is a service rule.
`updated_at` has **no** `onupdate`: every book, reschedule and cancel sets it, and nothing else may
(spec 0018c's `.ics` SEQUENCE). `tour_feeds` holds the sha256 hex of a lister's calendar-feed
token (written by spec 0018d only; never a raw token)."""

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

SLOT_MINUTES_CHECK = "slot_minutes IN (15, 20, 30, 45)"
WINDOW_RANGE_CHECK = "ends_at > starts_at AND ends_at - starts_at <= interval '12 hours'"
WHOLE_SLOTS_CHECK = "(extract(epoch FROM ends_at - starts_at)::integer % (slot_minutes * 60)) = 0"
TOUR_STATUS_CHECK = "status IN ('booked', 'cancelled')"
TOUR_CANCELLED_CHECK = (
    "(status = 'booked' AND cancelled_by IS NULL AND cancelled_at IS NULL)"
    " OR (status = 'cancelled' AND cancelled_by IS NOT NULL"
    " AND cancelled_by IN ('seeker', 'lister', 'system')"
    " AND cancelled_at IS NOT NULL)"
)
_BOOKED = text("status = 'booked'")


class TourWindow(Base):
    __tablename__ = "tour_windows"
    __table_args__ = (
        CheckConstraint(SLOT_MINUTES_CHECK, name="ck_tour_windows_slot_minutes"),
        CheckConstraint(WINDOW_RANGE_CHECK, name="ck_tour_windows_range"),
        CheckConstraint(WHOLE_SLOTS_CHECK, name="ck_tour_windows_whole_slots"),
        # A listing's upcoming windows (`ends_at > now()`).
        Index("ix_tour_windows_listing_id_ends_at", "listing_id", "ends_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    listing_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id", ondelete="CASCADE"), nullable=False
    )
    starts_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    slot_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class Tour(Base):
    __tablename__ = "tours"
    __table_args__ = (
        CheckConstraint(TOUR_STATUS_CHECK, name="ck_tours_status"),
        CheckConstraint(TOUR_CANCELLED_CHECK, name="ck_tours_cancelled"),
        CheckConstraint("ends_at > starts_at", name="ck_tours_range"),
        # A slot holds one seeker; also serves a listing's booked tours (slots, agenda).
        Index(
            "uq_tours_listing_slot",
            "listing_id",
            "starts_at",
            unique=True,
            postgresql_where=_BOOKED,
        ),
        Index("ix_tours_application_id", "application_id"),
        Index("ix_tours_seeker_id", "seeker_id", postgresql_where=_BOOKED),
        Index("ix_tours_booked_starts_at", "starts_at", postgresql_where=_BOOKED),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    listing_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id", ondelete="CASCADE"), nullable=False
    )
    # = its conversation's id (an application chat's id is its application's).
    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("applications.id", ondelete="CASCADE"), nullable=False
    )
    seeker_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    starts_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # = starts_at + the window's slot_minutes at booking.
    ends_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'booked'"))
    cancelled_by: Mapped[str | None] = mapped_column(Text)  # seeker / lister / system
    cancelled_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    # Written by spec 0018c only; a reschedule sets it back to NULL.
    reminder_sent_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    # No `onupdate` (see the module docstring).
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class TourFeed(Base):
    __tablename__ = "tour_feeds"
    __table_args__ = (UniqueConstraint("token_hash", name="uq_tour_feeds_token_hash"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # sha256 hex of the raw token (`services/auth.py::_token_hash`).
    token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
