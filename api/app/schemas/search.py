"""API schemas for public search (spec 0003a). Never the ORM model.

`ListingPublic` is the only shape the public sees: no `owner_id`, `area_id`, `status`, `updated_at`
or `expires_at` (who owns what and when it lapses stay private). Its `lat` / `lng` (spec 0003c) are
the listing's **approximate** point (the street's point plus a fixed per-listing offset of up to
~200 m, 4 decimals), `null` until the worker has located it; never a geocoder's raw point.

`SearchParams`' optional map box (`west`, `south`, `east`, `north`, all four or none) matches only
listings whose approximate point is inside it.

`ListingPublic.match` (spec 0006b) is the caller's match score and its explanation: only a score and
criterion codes, never a profile value; `null` for everyone but an account with a profile with the
looking part (any role, spec 0010b), and on the caller's own listing.

Rooms are public (spec 0007b). Each type is searched on its own (spec 0010a):
`SearchParams.listing_type` is `apartment` when omitted, and the market asks for `room` explicitly.
`ListingPublic` carries the four room fields (`gender_preference`, `flatmates_count`,
`flatmate_ages`, `lifestyle`; an apartment holds `'any'`, null, `[]` and `{}`). The flatmates' ages
and the questionnaire answers (`SEEKER_ONLY_FIELDS`) go only to a signed-in seeker, or any account
with a profile with the looking part (decision 13) (Gilad (b), 2026-11-11; Gilad 2026-11-13): a
visitor, or an owner without the looking part (the listing's own lister included), gets `[]` and
`{}`. Both stay required in the schema; only the values are emptied. The lister reads their own
values through `ListingOut` (`GET /me/listings`). `ListingPublic.from_listing` is the one place
that applies this.
`ListingDetail.room_fit` is the caller's own fit to a room: `true` / `false` exactly when the
listing is a room and the caller (any role) has a profile with the looking part and a room section,
else `null`. Search items do not carry it: a room that does not fit the caller never reaches them.
`ListingDetail.like` (spec 0008a) is the caller's like state on a room (`LikeStateOut`): set only
for a signed-in account on a room it does not own and has no non-withdrawn application to, else
`null` (spec 0010b: any role).
`ListingPublic.is_mine` (spec 0010b) says the caller owns the listing (false for a visitor); on an
own listing `match` is `null`."""

import datetime as dt
import uuid
from collections.abc import Callable, Mapping
from decimal import Decimal
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, model_validator

from app.schemas.listing import Furnished, ListingType, Rooms
from app.schemas.match import MatchOut
from app.schemas.photo import PhotoOut
from app.schemas.profile import ContractMonths, GenderPreference, HouseholdsOut, Lifestyle

# `match` (spec 0006b) orders by the caller's match score; without a profile it is `newest`.
SearchSort = Literal["newest", "price_asc", "price_desc", "match"]
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
    # Omitted: `apartment` (spec 0010a); rooms are asked for explicitly by the market.
    listing_type: ListingType = "apartment"
    # Omitted: `match` for an account with a profile, else `newest` (`services/search.py`).
    sort: SearchSort | None = None
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


# The listing fields only a signed-in seeker, or any account with a profile with the looking part
# (decision 13), sees (Gilad (b), 2026-11-11), each with the empty value everyone else gets.
# `ListingPublic.from_listing` is the only reader.
SEEKER_ONLY_FIELDS: Mapping[str, Callable[[], object]] = {
    "flatmate_ages": list,
    "lifestyle": dict,
}


# A public listing. Build it with `from_listing`, never `model_validate(<ORM row>)`: only the
# builder empties `SEEKER_ONLY_FIELDS` for a caller who is not a seeker. (A comment, not a
# docstring: a docstring would become the OpenAPI description.)
class ListingPublic(BaseModel):
    # `match` has a default, but the key is always sent, so the response schema lists it as
    # required (nullable).
    model_config = ConfigDict(
        from_attributes=True, json_schema_serialization_defaults_required=True
    )

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
    # Who the listing suits (spec 0006a): public, the seeker sees what the owner is looking for.
    accepted_households: HouseholdsOut
    smoking_allowed: bool
    min_contract_months: ContractMonths | None
    # The room fields (spec 0007b), as stored; `lifestyle` holds only the answered keys. The last
    # two are `SEEKER_ONLY_FIELDS`: `[]` and `{}` unless the caller is a seeker (decision 13).
    gender_preference: GenderPreference
    flatmates_count: int | None
    flatmate_ages: list[int]
    lifestyle: Lifestyle
    created_at: dt.datetime
    lat: float | None
    lng: float | None
    # The cover photo (spec 0010d): the listing's position-0 photo, null without photos. Not an ORM
    # attribute: every caller passes it to `from_listing`.
    cover: PhotoOut | None
    # The caller's match (spec 0006b): set exactly when the caller has a profile with the looking
    # part and the listing is not their own; the router passes it to `from_listing`.
    match: MatchOut | None = None
    # The caller owns it (spec 0010b); false for a visitor. The router passes it to `from_listing`.
    is_mine: bool

    @classmethod
    def from_listing(
        cls, listing: Any, *, seeker: bool, match: MatchOut | None, **fields: Any
    ) -> Self:
        """The public shape of a listing row for one caller. `seeker`: the caller is signed in
        as a seeker, or has a profile with the looking part (decision 13); otherwise
        `SEEKER_ONLY_FIELDS` hold their empty values. `match` and `fields` (`is_mine`; on
        `ListingDetail` also `applicant_count`, `room_fit`, `like`) are the router's
        caller-dependent values, as is `cover` (and `photos` on `ListingDetail`, spec 0010d); every
        other field is read from `listing`."""
        given: dict[str, Any] = {"match": match, **fields}
        if not seeker:
            given |= {name: empty() for name, empty in SEEKER_ONLY_FIELDS.items()}
        values = {name: getattr(listing, name) for name in cls.model_fields.keys() - given.keys()}
        return cls.model_validate({**values, **given})


# Defined here, not in `schemas/people.py` (which re-exports it): `ListingDetail` needs it, and
# `people` imports `ListingPublic` from this module.
class LikeStateOut(BaseModel):
    """The likes between the caller (any account, spec 0010b) and one room (spec 0008a)."""

    liked_by_me: bool
    liked_me: bool


class ListingDetail(ListingPublic):
    """The public listing page (spec 0004a): `ListingPublic` plus the exact number of applicants
    (every application except withdrawn ones; declined ones count, they applied), the caller's
    room fit (spec 0007b; see the module docstring) and like state (spec 0008a). The page is public
    whatever the fit."""

    applicant_count: int
    room_fit: bool | None
    like: LikeStateOut | None
    # Every photo in position order (spec 0010d); `cover` is `photos[0]` or null.
    photos: list[PhotoOut]


class ListingSearchOut(BaseModel):
    items: list[ListingPublic]
    total: int  # rows matching the filters, ignoring `limit` / `offset`
    # The order applied (spec 0006b): `match` falls back to `newest` without a profile.
    sort: SearchSort
