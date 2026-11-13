"""API schemas for listings (spec 0002a). Never the ORM model.

Every bound of the `listings` CHECKs (migrations 0003, 0007 and 0009, the room fields of spec 0007a
included) is repeated here, so a bad value is a 422 with a list `detail`, never a database
`IntegrityError` (a 500)."""

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
    ValidationInfo,
    field_validator,
    model_validator,
)

from app.schemas._text import lf_newlines, visible_characters_only
from app.schemas.photo import PhotoOut
from app.schemas.profile import (
    AGE_MAX,
    AGE_MIN,
    HOUSEHOLDS,
    AcceptedHouseholds,
    ContractMonths,
    GenderPreference,
    HouseholdsOut,
    Lifestyle,
)

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


# Kept under its old name: `schemas/application.py` and `schemas/chat.py` import it from here.
_lf_newlines = lf_newlines


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
# Room fields (spec 0007a): the people already living there, and none, some or all of their ages.
FlatmatesCount = Annotated[int, Field(ge=1, le=7)]
FlatmateAges = Annotated[list[Annotated[int, Field(ge=AGE_MIN, le=AGE_MAX)]], Field(max_length=7)]

# The room fields as an apartment must hold them (`ck_listings_room_fields`). Never mutated.
ROOM_FIELD_DEFAULTS: dict[str, Any] = {
    "gender_preference": "any",
    "flatmates_count": None,
    "flatmate_ages": [],
    "lifestyle": {},
}

# Columns an explicit `null` in a PATCH clears; `null` on any other field is a 422.
NULLABLE_FIELDS = frozenset(
    {"total_floors", "arnona_ils", "vaad_ils", "description", "min_contract_months"}
)


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
    # Who the listing suits (spec 0006a); the defaults mean "no preference". Factories, not plain
    # defaults: a JSON-schema `default` makes the generated web type require the key, and the
    # wizard sends none of the three until 0006e.
    accepted_households: AcceptedHouseholds = Field(default_factory=lambda: list(HOUSEHOLDS))
    smoking_allowed: bool = Field(default_factory=lambda: True)
    min_contract_months: ContractMonths | None = None  # None = no minimum
    # Room fields (spec 0007a); an apartment keeps exactly these defaults (`ROOM_FIELD_DEFAULTS`).
    # Factories for the same reason as above: the wizard sends none of them until 0007e.
    gender_preference: GenderPreference = Field(default_factory=lambda: "any")
    flatmates_count: FlatmatesCount | None = None
    flatmate_ages: FlatmateAges = Field(default_factory=list)
    lifestyle: Lifestyle = Field(default_factory=dict)

    @field_validator("description")
    @classmethod
    def _empty_description_is_none(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def _total_floors_at_least_floor(self) -> Self:
        if self.total_floors is not None and self.total_floors < self.floor:
            raise ValueError("total_floors must be at least floor")
        return self

    @model_validator(mode="after")
    def _room_fields(self, info: ValidationInfo) -> Self:
        """An apartment holds the room defaults; a room needs `flatmates_count` (except on a pause
        or resume of a legacy room: the `status_only` context, `services/listings.py`); ages never
        outnumber the flatmates."""
        if self.listing_type == "apartment" and any(
            getattr(self, name) != default for name, default in ROOM_FIELD_DEFAULTS.items()
        ):
            raise ValueError(
                "gender_preference, flatmates_count, flatmate_ages and lifestyle"
                " are for a room only"
            )
        status_only = bool((info.context or {}).get("status_only"))
        if self.listing_type == "room" and self.flatmates_count is None and not status_only:
            raise ValueError("a room needs flatmates_count")
        if len(self.flatmate_ages) > (self.flatmates_count or 0):
            raise ValueError("flatmate_ages lists more people than flatmates_count")
        return self


class ListingPatch(BaseModel):
    """A partial update. A key not sent leaves the column unchanged; an explicit `null` clears a
    nullable column (`NULLABLE_FIELDS`) and is a 422 on any other field. The defaults below are
    never written: the service reads only `model_fields_set` and re-validates the merged row with
    `ListingIn` (cross-field rules)."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

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
    accepted_households: AcceptedHouseholds | None = None
    smoking_allowed: bool | None = None
    min_contract_months: ContractMonths | None = None
    # Room fields (spec 0007a): never in `NULLABLE_FIELDS`, so an explicit `null` is a 422.
    gender_preference: GenderPreference | None = None
    flatmates_count: FlatmatesCount | None = None
    flatmate_ages: FlatmateAges | None = None
    lifestyle: Lifestyle | None = None
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
    # `photos` (spec 0010d) has a default, but the key is always sent, so the response schema lists
    # it as required.
    model_config = ConfigDict(
        from_attributes=True, json_schema_serialization_defaults_required=True
    )

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
    accepted_households: HouseholdsOut
    smoking_allowed: bool
    min_contract_months: ContractMonths | None
    gender_preference: GenderPreference
    flatmates_count: int | None
    flatmate_ages: list[int]
    lifestyle: Lifestyle
    created_at: dt.datetime
    updated_at: dt.datetime
    expires_at: dt.datetime
    # The listing's photos in order, the first is the cover (spec 0010d). Not an ORM attribute:
    # `[]` from `model_validate(listing)`; the router fills it (`services/photos.py`).
    photos: list[PhotoOut] = Field(default_factory=list)


class MyListingOut(ListingOut):
    """One of the caller's own listings on `GET /me/listings` (0004c): `ListingOut` plus its
    applicant count (every application but withdrawn ones), new-applicant count (`submitted`),
    from 0008a its liked-me count and from 0008d its flatmate count and invite-link state.
    No `view_count`: owners do not see it (Gilad, 2026-11-10). `POST` / `PATCH /listings` keep
    returning `ListingOut`."""

    applicant_count: int
    new_applicant_count: int
    # Seekers who liked this room and are waiting for a like back (0008a, a "pending seeker like":
    # no non-withdrawn application yet); 0 for an apartment. Not re-checked for fit or opt-in.
    liked_me_count: int
    # The listing's flatmates (spec 0008d), and whether its invite link is live. The link's hash
    # never leaves the server.
    flatmate_count: int
    flatmate_invite_active: bool
