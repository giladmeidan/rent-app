"""`listing_photos` table (spec 0010d): up to 10 photos per listing, in order; position 0 is the
cover.

Every FK, unique constraint and CHECK matches migration 0013 exactly (autogenerate must see no
diff).
`key` is the random object key (`services/photos.py` `new_key`); the stored objects are
`{key}-s.webp` and `{key}-l.webp`. `width` / `height` are the large copy's.

There is deliberately no `Listing.photos` relationship: `ListingOut.model_validate(listing)` reads
attributes, and a relationship would lazy-load one statement per listing. Readers use
`services/photos.py` `photos_by_listing` (one statement) or the search statements' cover join."""

import datetime as dt
import uuid

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    SmallInteger,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base
from app.models._checks import photo_key_check


class ListingPhoto(Base):
    __tablename__ = "listing_photos"
    __table_args__ = (
        UniqueConstraint("key", name="uq_listing_photos_key"),
        # Deferred: a reorder or a delete's shift passes through duplicates inside one statement.
        # Its index (leading `listing_id`) serves the cover join and `photos_by_listing`.
        UniqueConstraint(
            "listing_id",
            "position",
            name="uq_listing_photos_listing_position",
            deferrable=True,
            initially="DEFERRED",
        ),
        CheckConstraint(photo_key_check("key"), name="ck_listing_photos_key"),
        CheckConstraint("position BETWEEN 0 AND 9", name="ck_listing_photos_position"),
        CheckConstraint("width > 0 AND height > 0", name="ck_listing_photos_size"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    listing_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id", ondelete="CASCADE"), nullable=False
    )
    key: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    width: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    height: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
