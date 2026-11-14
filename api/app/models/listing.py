"""`listings` table (spec 0002a). Enumerations are text with named CHECKs; money is integer ILS.

Every CHECK, FK, unique constraint and index here matches migrations 0003, 0004, 0005, 0007, 0009,
0010, 0012, 0016 and 0020 exactly (autogenerate must see no diff). A listing is **live** while
`status = 'active' AND expires_at > now()`.

Room fields (spec 0007a): `gender_preference` (who the room is for), `flatmates_count` (people
already living there), `flatmate_ages` (optional: none, some or all of them) and `lifestyle` (the
flat's questionnaire answers, key -> 1-3). An apartment always holds the defaults
(`ck_listings_room_fields`); a room migrated before 0009 is a "legacy room" (NULL count) until its
next edit.

Flat facts (spec 0010f): `room_size_sqm` (the room itself, at most the flat's `size_sqm`),
`private_bathroom`, `bills_included` and `poster` (who is posting), all optional and room-only (NULL
on an apartment, `ck_listings_room_fields`); public on every listing response. `balcony` was one of
them and is a fact of any listing since 0020.

Price signals (spec 0014b, migration 0020): `safe_room`, `air_conditioning` and `condition`,
optional and public, on any listing. The closure answer `close_reason`, `final_rent_ils` and
`closed_at` is private: only the owner's `GET /me/listings` returns the first two; a resume or a
renewal clears all three. Every price a listing had is a `listing_price_changes` row
(`models/listing_price_change.py`).

Location (spec 0003c): `location` is the **approximate** point (`services/geocoding.py`
`approximate_point`), never the geocoder's raw point; the worker fills it while `geocode_status` is
`pending`. `lat` / `lng` are deferred read-only expressions over it, loaded only by the public
search queries (`services/search.py` `_public_listings`)."""

import datetime as dt
import uuid
from decimal import Decimal
from typing import Any

from geoalchemy2 import Geography, Geometry
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    Text,
    UniqueConstraint,
    cast,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, column_property, mapped_column

from app.models import Base
from app.models._checks import LIFESTYLE_CHECK

# Plain `::geometry` (no typmod): the cast `ix_listings_location` is built on. A typmod'd cast such
# as `geometry(POINT,4326)` is a different expression, and the planner would not use the index.
PLAIN_GEOMETRY = Geometry(geometry_type=None)


class Listing(Base):
    __tablename__ = "listings"
    __table_args__ = (
        CheckConstraint("listing_type IN ('apartment', 'room')", name="ck_listings_type"),
        CheckConstraint("status IN ('active', 'paused')", name="ck_listings_status"),
        CheckConstraint("char_length(city) BETWEEN 1 AND 40", name="ck_listings_city_length"),
        CheckConstraint("char_length(street) BETWEEN 1 AND 80", name="ck_listings_street_length"),
        CheckConstraint(
            "rooms BETWEEN 1 AND 20 AND rooms * 2 = floor(rooms * 2)", name="ck_listings_rooms"
        ),
        CheckConstraint("floor BETWEEN -2 AND 100", name="ck_listings_floor"),
        CheckConstraint(
            "total_floors IS NULL OR total_floors >= floor", name="ck_listings_total_floors"
        ),
        CheckConstraint("size_sqm BETWEEN 5 AND 1000", name="ck_listings_size_sqm"),
        CheckConstraint("price_ils BETWEEN 500 AND 100000", name="ck_listings_price_ils"),
        CheckConstraint("parking_spots BETWEEN 0 AND 5", name="ck_listings_parking_spots"),
        CheckConstraint("furnished IN ('none', 'partial', 'full')", name="ck_listings_furnished"),
        CheckConstraint("arnona_ils BETWEEN 0 AND 20000", name="ck_listings_arnona_ils"),
        CheckConstraint("vaad_ils BETWEEN 0 AND 5000", name="ck_listings_vaad_ils"),
        CheckConstraint("char_length(description) <= 2000", name="ck_listings_description_length"),
        CheckConstraint(
            "geocode_status IN ('pending', 'ok', 'not_found', 'failed')",
            name="ck_listings_geocode_status",
        ),
        CheckConstraint("geocode_attempts BETWEEN 0 AND 5", name="ck_listings_geocode_attempts"),
        CheckConstraint(
            "(geocode_status = 'ok') = (location IS NOT NULL)", name="ck_listings_location_status"
        ),
        # The owner's preferences (spec 0006a), read by the match score (0006b).
        CheckConstraint(
            "cardinality(accepted_households) BETWEEN 1 AND 4"
            " AND accepted_households <@ ARRAY['single', 'couple', 'family', 'roommates']::text[]",
            name="ck_listings_accepted_households",
        ),
        CheckConstraint(
            "min_contract_months IS NULL OR min_contract_months IN (6, 12, 24, 36)",
            name="ck_listings_min_contract_months",
        ),
        # The room fields (spec 0007a), read by the room fit rule and the match score (0007b).
        CheckConstraint(
            "gender_preference IN ('any', 'women', 'men')", name="ck_listings_gender_preference"
        ),
        CheckConstraint(
            "flatmates_count IS NULL OR flatmates_count BETWEEN 1 AND 7",
            name="ck_listings_flatmates_count",
        ),
        # The last clause rejects a NULL element, which `ALL` would let through.
        CheckConstraint(
            "cardinality(flatmate_ages) <= coalesce(flatmates_count, 0)"
            " AND 18 <= ALL (flatmate_ages) AND 99 >= ALL (flatmate_ages)"
            " AND array_position(flatmate_ages, NULL) IS NULL",
            name="ck_listings_flatmate_ages",
        ),
        # Known keys, values 1-3 only (migration 0010).
        CheckConstraint(LIFESTYLE_CHECK, name="ck_listings_lifestyle"),
        # The flat facts (spec 0010f), optional.
        CheckConstraint(
            "room_size_sqm IS NULL OR (room_size_sqm BETWEEN 4 AND 100"
            " AND room_size_sqm <= size_sqm)",
            name="ck_listings_room_size_sqm",
        ),
        CheckConstraint(
            "poster IS NULL OR poster IN ('lives_here', 'leaving', 'landlord')",
            name="ck_listings_poster",
        ),
        CheckConstraint(
            "listing_type = 'room' OR (gender_preference = 'any' AND flatmates_count IS NULL"
            " AND flatmate_ages = '{}' AND lifestyle = '{}'::jsonb AND room_size_sqm IS NULL"
            " AND private_bathroom IS NULL AND bills_included IS NULL AND poster IS NULL)",
            name="ck_listings_room_fields",
        ),
        # The price signals (spec 0014b), optional.
        CheckConstraint(
            "condition IS NULL OR condition IN ('new', 'renovated', 'good', 'needs_work')",
            name="ck_listings_condition",
        ),
        CheckConstraint(
            "close_reason IS NULL OR close_reason IN ('rented_here', 'rented_elsewhere',"
            " 'not_renting')",
            name="ck_listings_close_reason",
        ),
        CheckConstraint(
            "final_rent_ils IS NULL OR (final_rent_ils BETWEEN 500 AND 100000"
            " AND close_reason IS NOT NULL"
            " AND close_reason IN ('rented_here', 'rented_elsewhere'))",
            name="ck_listings_final_rent_ils",
        ),
        CheckConstraint(
            "(close_reason IS NULL) = (closed_at IS NULL)", name="ck_listings_closed_at"
        ),
        # NULLs never collide: many listings have no live invite link (spec 0008d).
        UniqueConstraint("flatmate_invite_hash", name="uq_listings_flatmate_invite_hash"),
        Index("ix_listings_owner_id", "owner_id"),
        Index("ix_listings_area_id", "area_id"),
        # Explicit GiST index on the planar cast (`location::geometry`), the expression the map-box
        # filter compares (services/search.py), hence `spatial_index=False` on the column.
        Index("ix_listings_location", text("(location::geometry)"), postgresql_using="gist"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Must be an `is_active` area at create/update time (checked in services/listings.py).
    area_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("areas.id", ondelete="RESTRICT"), nullable=False
    )
    listing_type: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'active'"))
    city: Mapped[str] = mapped_column(Text, nullable=False)
    # Street name only; no house number is collected.
    street: Mapped[str] = mapped_column(Text, nullable=False)
    rooms: Mapped[Decimal] = mapped_column(Numeric(3, 1), nullable=False)
    floor: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    total_floors: Mapped[int | None] = mapped_column(SmallInteger)
    size_sqm: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    price_ils: Mapped[int] = mapped_column(Integer, nullable=False)  # monthly
    available_from: Mapped[dt.date] = mapped_column(Date, nullable=False)  # past = immediate
    entry_flexible: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    elevator: Mapped[bool] = mapped_column(Boolean, nullable=False)
    parking_spots: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("0")
    )
    furnished: Mapped[str] = mapped_column(Text, nullable=False)
    pets_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    arnona_ils: Mapped[int | None] = mapped_column(Integer)  # bi-monthly bill
    vaad_ils: Mapped[int | None] = mapped_column(Integer)  # monthly
    description: Mapped[str | None] = mapped_column(Text)
    # Owner preferences (spec 0006a); the defaults mean "no preference".
    accepted_households: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{single,couple,family,roommates}'")
    )
    smoking_allowed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    min_contract_months: Mapped[int | None] = mapped_column(SmallInteger)  # NULL = no minimum
    # Room fields (spec 0007a); an apartment keeps the defaults.
    gender_preference: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'any'")
    )
    # NULL on apartments, and on legacy rooms until their next edit.
    flatmates_count: Mapped[int | None] = mapped_column(SmallInteger)
    flatmate_ages: Mapped[list[int]] = mapped_column(
        ARRAY(SmallInteger), nullable=False, server_default=text("'{}'")
    )
    # Only answered keys; the API checks keys and values (`schemas/profile.py` `Lifestyle`), and so
    # does `ck_listings_lifestyle` (0010).
    lifestyle: Mapped[dict[str, int]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'")
    )
    # Flat facts (spec 0010f); NULL = not said, always NULL on an apartment.
    room_size_sqm: Mapped[int | None] = mapped_column(SmallInteger)
    private_bathroom: Mapped[bool | None] = mapped_column(Boolean)
    # NULL = not said; on any listing since 0020 (spec 0014b).
    balcony: Mapped[bool | None] = mapped_column(Boolean)
    bills_included: Mapped[bool | None] = mapped_column(Boolean)
    # `lives_here` puts the lister on the room's page as a person, to seekers only (decision 13).
    poster: Mapped[str | None] = mapped_column(Text)
    # Apartment facts (spec 0014b); NULL = not said, valid on any listing.
    safe_room: Mapped[bool | None] = mapped_column(Boolean)
    air_conditioning: Mapped[bool | None] = mapped_column(Boolean)
    condition: Mapped[str | None] = mapped_column(Text)
    # The closure answer (spec 0014b): private to the owner, set only while not live, cleared by a
    # resume or a renewal (`services/listings.py`).
    close_reason: Mapped[str | None] = mapped_column(Text)
    final_rent_ils: Mapped[int | None] = mapped_column(Integer)  # monthly
    closed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # The sha256 hex of the room's one live flatmate invite token (spec 0008d,
    # `services/flatmates.py`); NULL = no live link. Never in any response: `GET /me/listings` shows
    # only whether it is set.
    flatmate_invite_hash: Mapped[str | None] = mapped_column(Text)
    # Deferred: no endpoint returns it (the public sees `lat` / `lng`); the worker writes it.
    location: Mapped[Any] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=False),
        nullable=True,
        deferred=True,
    )
    geocode_status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'pending'")
    )
    geocode_attempts: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("0")
    )
    # Public listing-page views (spec 0004a, `services/applications.py` `record_view`); approximate
    # by design (bots, refetches and the owner count). Never in a public schema.
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    # Deferred: only `_public_listings()` undefers them (owner endpoints never load them).
    lat: Mapped[float | None] = column_property(
        func.ST_Y(cast(location, PLAIN_GEOMETRY), type_=Float),
        deferred=True,
    )
    lng: Mapped[float | None] = column_property(
        func.ST_X(cast(location, PLAIN_GEOMETRY), type_=Float),
        deferred=True,
    )
