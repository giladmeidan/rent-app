"""API schemas for public search (spec 0003a). Never the ORM model.

`ListingPublic` is the only shape the public sees: no `owner_id`, `area_id`, `status`, `updated_at`
or `expires_at` (who owns what and when it lapses stay private). Its `lat` / `lng` (spec 0003c) are
the listing's **approximate** point (the street's point plus a fixed per-listing offset of up to
~200 m, 4 decimals), `null` until the worker has located it; never a geocoder's raw point.

`SearchParams`' optional map box (`west`, `south`, `east`, `north`, all four or none) matches only
listings whose approximate point is inside it."""

import datetime as dt
import uuid
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, model_validator

from app.schemas.listing import Furnished, ListingType, Rooms

SearchSort = Literal["newest", "price_asc", "price_desc"]
SearchPrice = Annotated[int, Field(ge=0, le=100_000)]

SEARCH_LIMIT_DEFAULT = 20
SEARCH_LIMIT_MAX = 50
SEARCH_OFFSET_MAX = 10_000

Longitude = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]
Latitude = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]


class SearchParams(BaseModel):
    """`GET /listings` query. Every filter is optional; a boolean feature filter applies only when
    `true`. Unknown query params are ignored."""

    price_min: SearchPrice | None = None
    price_max: SearchPrice | None = None
    rooms_min: Rooms | None = None
    rooms_max: Rooms | None = None
    # The seeker's move-in date: listings available by then (a flexible one 14 days earlier).
    available_by: dt.date | None = None
    pets: bool | None = None
    furnished: bool | None = None
    elevator: bool | None = None
    parking: bool | None = None
    sort: SearchSort = "newest"
    limit: Annotated[int, Field(ge=1, le=SEARCH_LIMIT_MAX)] = SEARCH_LIMIT_DEFAULT
    offset: Annotated[int, Field(ge=0, le=SEARCH_OFFSET_MAX)] = 0
    # Map bounding box (spec 0003c), WGS84 degrees. No antimeridian boxes (`west < east`).
    west: Longitude | None = None
    south: Latitude | None = None
    east: Longitude | None = None
    north: Latitude | None = None

    @model_validator(mode="after")
    def _ranges_in_order(self) -> Self:
        if (
            self.price_min is not None
            and self.price_max is not None
            and self.price_min > self.price_max
        ):
            raise ValueError("price_min must be at most price_max")
        if (
            self.rooms_min is not None
            and self.rooms_max is not None
            and self.rooms_min > self.rooms_max
        ):
            raise ValueError("rooms_min must be at most rooms_max")
        box = (self.west, self.south, self.east, self.north)
        if any(edge is not None for edge in box) and any(edge is None for edge in box):
            raise ValueError("west, south, east and north must be given together")
        if self.west is not None and self.east is not None and self.west >= self.east:
            raise ValueError("west must be less than east")
        if self.south is not None and self.north is not None and self.south >= self.north:
            raise ValueError("south must be less than north")
        return self

    @property
    def bbox(self) -> tuple[float, float, float, float] | None:
        """`(west, south, east, north)` when the map box is set."""
        if self.west is None or self.south is None or self.east is None or self.north is None:
            return None
        return (self.west, self.south, self.east, self.north)


class ListingPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    listing_type: ListingType
    city: str
    street: str
    rooms: Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]
    floor: int
    total_floors: int | None
    size_sqm: int
    price_ils: int
    available_from: dt.date
    entry_flexible: bool
    elevator: bool
    parking_spots: int
    furnished: Furnished
    pets_allowed: bool
    arnona_ils: int | None
    vaad_ils: int | None
    description: str | None
    created_at: dt.datetime
    lat: float | None
    lng: float | None


class ListingSearchOut(BaseModel):
    items: list[ListingPublic]
    total: int  # rows matching the filters, ignoring `limit` / `offset`
