"""API schemas for listings (spec 0002a). Never the ORM model.

Every bound of the `listings` CHECKs (migration 0003) is repeated here, so a bad value is a 422 with
a list `detail`, never a database `IntegrityError` (a 500)."""

import datetime as dt
import uuid
from decimal import Decimal
from typing import Annotated, Any, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    PlainSerializer,
    field_validator,
    model_validator,
)

from app.schemas._text import visible_characters_only

ListingType = Literal["apartment", "room"]
ListingStatus = Literal["active", "paused"]
Furnished = Literal["none", "partial", "full"]

AVAILABLE_FROM_MAX_DAYS = 730
_SMALLINT_MAX = 32_767  # `total_floors` has no CHECK bound; this keeps it inside the column type


def _half_rooms(value: Decimal) -> Decimal:
    if (value * 2) % 1 != 0:
        raise ValueError("rooms must be a multiple of 0.5")
    return value


def _not_too_far(value: dt.date) -> dt.date:
    limit = dt.datetime.now(dt.UTC).date() + dt.timedelta(days=AVAILABLE_FROM_MAX_DAYS)
    if value > limit:
        raise ValueError(f"available_from must be at most {AVAILABLE_FROM_MAX_DAYS} days ahead")
    return value


def _lf_newlines(value: Any) -> Any:
    return value.replace("\r\n", "\n") if isinstance(value, str) else value


def _visible_multiline(value: str) -> str:
    return visible_characters_only(value, allow_newlines=True, field="description")


def _visible_alnum(field: str) -> AfterValidator:
    """The visible-characters rule plus at least one letter or digit (city, street)."""

    def check(value: str) -> str:
        return visible_characters_only(value, field=field, require_alnum=True)

    return AfterValidator(check)


# JSON number, not Pydantic's default string ("3.5"); `numeric(3,1)` in the database.
Rooms = Annotated[
    Decimal,
    Field(max_digits=3, decimal_places=1, ge=1, le=20),
    AfterValidator(_half_rooms),
    PlainSerializer(float, return_type=float, when_used="json"),
]
# Text is stripped (model config) before the length check, so " " is empty and rejected.
City = Annotated[str, Field(min_length=1, max_length=40), _visible_alnum("city")]
Street = Annotated[str, Field(min_length=1, max_length=80), _visible_alnum("street")]
Description = Annotated[
    str, BeforeValidator(_lf_newlines), Field(max_length=2000), AfterValidator(_visible_multiline)
]
Floor = Annotated[int, Field(ge=-2, le=100)]
TotalFloors = Annotated[int, Field(le=_SMALLINT_MAX)]
SizeSqm = Annotated[int, Field(ge=5, le=1000)]
PriceIls = Annotated[int, Field(ge=500, le=100_000)]
AvailableFrom = Annotated[dt.date, AfterValidator(_not_too_far)]
ParkingSpots = Annotated[int, Field(ge=0, le=5)]
ArnonaIls = Annotated[int, Field(ge=0, le=20_000)]  # the bi-monthly bill
VaadIls = Annotated[int, Field(ge=0, le=5_000)]  # monthly

# Columns an explicit `null` in a PATCH clears; `null` on any other field is a 422.
NULLABLE_FIELDS = frozenset({"total_floors", "arnona_ils", "vaad_ils", "description"})


class ListingIn(BaseModel):
    """A new listing. No `status`: a listing is active on create."""

    model_config = ConfigDict(str_strip_whitespace=True)

    listing_type: ListingType
    area_id: uuid.UUID
    city: City
    street: Street
    rooms: Rooms
    floor: Floor
    total_floors: TotalFloors | None = None
    size_sqm: SizeSqm
    price_ils: PriceIls
    available_from: AvailableFrom
    entry_flexible: bool = False
    elevator: bool
    parking_spots: ParkingSpots = 0
    furnished: Furnished
    pets_allowed: bool
    arnona_ils: ArnonaIls | None = None
    vaad_ils: VaadIls | None = None
    description: Description | None = None

    @field_validator("description")
    @classmethod
    def _empty_description_is_none(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def _total_floors_at_least_floor(self) -> Self:
        if self.total_floors is not None and self.total_floors < self.floor:
            raise ValueError("total_floors must be at least floor")
        return self


class ListingPatch(BaseModel):
    """A partial update. A key not sent leaves the column unchanged; an explicit `null` clears a
    nullable column (`NULLABLE_FIELDS`) and is a 422 on any other field. The defaults below are
    never written: the service reads only `model_fields_set` and re-validates the merged row with
    `ListingIn` (cross-field rules)."""

    model_config = ConfigDict(str_strip_whitespace=True)

    listing_type: ListingType | None = None
    area_id: uuid.UUID | None = None
    city: City | None = None
    street: Street | None = None
    rooms: Rooms | None = None
    floor: Floor | None = None
    total_floors: TotalFloors | None = None
    size_sqm: SizeSqm | None = None
    price_ils: PriceIls | None = None
    available_from: AvailableFrom | None = None
    entry_flexible: bool | None = None
    elevator: bool | None = None
    parking_spots: ParkingSpots | None = None
    furnished: Furnished | None = None
    pets_allowed: bool | None = None
    arnona_ils: ArnonaIls | None = None
    vaad_ils: VaadIls | None = None
    description: Description | None = None
    status: ListingStatus | None = None

    @field_validator("description")
    @classmethod
    def _empty_description_is_none(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def _at_least_one_key_and_null_only_where_nullable(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("send at least one field")
        nulled = sorted(
            name for name in self.model_fields_set - NULLABLE_FIELDS if getattr(self, name) is None
        )
        if nulled:
            raise ValueError(f"may not be null: {', '.join(nulled)}")
        return self


class ListingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_id: uuid.UUID
    status: ListingStatus
    listing_type: ListingType
    area_id: uuid.UUID
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
    updated_at: dt.datetime
    expires_at: dt.datetime


class MyListingOut(ListingOut):
    """One of the caller's own listings on `GET /me/listings` (0004c): `ListingOut` plus its
    applicant count (every application but withdrawn ones), new-applicant count (`submitted`) and
    view count (approximate, `0004a`). `POST` / `PATCH /listings` keep returning `ListingOut`."""

    applicant_count: int
    new_applicant_count: int
    view_count: int
