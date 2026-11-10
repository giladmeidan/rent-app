"""API schemas for public search (spec 0003a). Never the ORM model.

`ListingPublic` is the only shape the public sees: no `owner_id`, `area_id`, `status`, `updated_at`
or `expires_at` (who owns what and when it lapses stay private)."""

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
        return self


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


class ListingSearchOut(BaseModel):
    items: list[ListingPublic]
    total: int  # rows matching the filters, ignoring `limit` / `offset`
