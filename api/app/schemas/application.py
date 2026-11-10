"""API schemas for applications (specs 0004a, 0004c). Never the ORM model.

Both response shapes list their fields explicitly (NF3): `ApplicationListingOut` has no
`owner_id`, owner name, `status`, `expires_at` or `view_count`; `MyApplicationOut` has no
`seeker_id` (the caller is the seeker) and nothing about the owner (PRODUCT.md "Applications": the
owner's identity is not shown to applicants until chat opens). `ApplicantOut` (the owner's view,
0004c) carries only the seeker's `display_name` and message: no `seeker_id`, email or any other user
column (NF2). The message is plain text: stored and returned as validated, never processed as
HTML."""

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

ApplicationStatus = Literal["submitted", "shortlisted", "declined", "withdrawn"]
# What an owner sees and may set: a withdrawn application is invisible to the owner (0004c).
ApplicantStatus = Literal["submitted", "shortlisted", "declined"]

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


class ApplicantOut(BaseModel):
    """One applicant to the caller's listing, as the owner sees it (0004c). Fields listed
    explicitly (NF2): the seeker is known only by `applicant_name` (their `display_name`)."""

    id: uuid.UUID
    status: ApplicantStatus
    message: str
    applicant_name: str
    created_at: dt.datetime
    updated_at: dt.datetime


class ApplicantStatusIn(BaseModel):
    """The owner's decision on an applicant: shortlist, remove from the shortlist, or decline.
    `withdrawn` (the seeker's own action) or any other value is a 422."""

    status: ApplicantStatus
