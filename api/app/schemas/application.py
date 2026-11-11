"""API schemas for applications (specs 0004a, 0004c). Never the ORM model.

Both response shapes list their fields explicitly (NF3): `ApplicationListingOut` has no
`owner_id`, owner name, `status`, `expires_at` or `view_count`; `MyApplicationOut` has no
`seeker_id` (the caller is the seeker) and nothing about the owner (PRODUCT.md "Applications": the
owner's identity is not shown to applicants until chat opens). `ApplicantOut` (the owner's view,
0004c) carries only the seeker's `display_name` and message: no `seeker_id`, email or any other user
column (NF2). The message is plain text: stored and returned as validated, never processed as
HTML.

From 0006c the owner's view also carries the applicant's current `match` and `ApplicantProfileOut`,
seven housing-profile fields listed explicitly: never the seeker's `budget_max_ils` or `area_ids`
(PRODUCT.md "Matching"; only the criterion codes `budget` / `area` in `match` say whether they
fit).

From 0007c a room application also carries `ApplicantRoomOut` (`gender`, `age`, `lifestyle`, listed
explicitly): never the seeker's `birth_year` or `flatmate_gender`."""

import datetime as dt
import uuid
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    PlainSerializer,
)

from app.schemas._text import visible_characters_only
from app.schemas.listing import ListingType, _lf_newlines
from app.schemas.match import MatchOut
from app.schemas.profile import ContractMonths, Household, Lifestyle, SeekerGender

ApplicationStatus = Literal["submitted", "shortlisted", "declined", "withdrawn"]
# What an owner sees and may set: a withdrawn application is invisible to the owner (0004c).
ApplicantStatus = Literal["submitted", "shortlisted", "declined"]
ApplicantSort = Literal["match", "newest"]

MESSAGE_MAX_LENGTH = 500  # ck_applications_message_length (migration 0005)


def _visible_message(value: str) -> str:
    return visible_characters_only(value, allow_newlines=True, field="message", require_alnum=True)


# Stripped (model config) and `\r\n` -> `\n` before the length check, so "   " is empty.
Message = Annotated[
    str,
    BeforeValidator(_lf_newlines),
    Field(min_length=1, max_length=MESSAGE_MAX_LENGTH),
    AfterValidator(_visible_message),
]


class ApplicationIn(BaseModel):
    """A seeker's application: a required short message (PRODUCT.md "Applications", 1-500)."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    message: Message


class ApplicationListingOut(BaseModel):
    """The listing summary on a seeker's application."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    listing_type: ListingType
    city: str
    street: str
    rooms: Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]
    price_ils: int


class MyApplicationOut(BaseModel):
    """One of the caller's own applications."""

    id: uuid.UUID
    status: ApplicationStatus
    message: str
    created_at: dt.datetime
    updated_at: dt.datetime
    listing: ApplicationListingOut


class ApplicantProfileOut(BaseModel):
    """The applicant's housing summary, as the owner sees it (0006c). Fields listed explicitly:
    no `budget_max_ils`, no `area_ids`. `move_in_date` is as stored and may be in the past (the
    match treats a past date as "now")."""

    household: Household
    move_in_date: dt.date
    move_in_flexible: bool
    has_pets: bool
    smoker: bool
    contract_months: ContractMonths
    parking_needed: int


class ApplicantRoomOut(BaseModel):
    """The applicant's room section, as the owner of a room they applied to sees it (0007c). Fields
    listed explicitly: no `birth_year` (only the `age` this year, current UTC year - birth year,
    or None without one) and no `flatmate_gender`. `lifestyle` holds only the answered keys."""

    gender: SeekerGender
    age: int | None
    lifestyle: Lifestyle


class ApplicantOut(BaseModel):
    """One applicant to the caller's listing, as the owner sees it (0004c). Fields listed
    explicitly (NF2): the seeker is known only by `applicant_name` (their `display_name`). `match`
    and `profile` (0006c) are both null for an applicant without a housing profile (before
    Slice 6). `room` (0007c) is null unless the seeker applied to a room (`listing_type_at_apply`,
    whatever the listing is now) and has a room section now."""

    id: uuid.UUID
    status: ApplicantStatus
    message: str
    applicant_name: str
    created_at: dt.datetime
    updated_at: dt.datetime
    match: MatchOut | None
    profile: ApplicantProfileOut | None
    room: ApplicantRoomOut | None


class ApplicantStatusIn(BaseModel):
    """The owner's decision on an applicant: shortlist, remove from the shortlist, or decline.
    `withdrawn` (the seeker's own action) or any other value is a 422."""

    status: ApplicantStatus
