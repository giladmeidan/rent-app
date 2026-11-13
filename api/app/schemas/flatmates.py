"""API schemas for flatmates (spec 0008d). Never the ORM models.

Every response lists its fields explicitly (NF2): no user id and no email. A flatmate is known by
`display_name` (and, from 0010j, their photo's address) only; `FlatmateOut.id` is the membership
row's id. The invite token appears in
exactly one response, `InviteOut` from the create/rotate POST, and is never stored (only its sha256
hex) nor readable again. It is sent back only in a POST body (`InviteTokenIn`), never in a URL."""

import datetime as dt
import uuid

from pydantic import BaseModel, ConfigDict, Field, StrictBool

from app.schemas.application import ApplicationListingOut


class InviteOut(BaseModel):
    """A new invite link's token (`secrets.token_urlsafe(32)`, 43 characters)."""

    token: str


class InviteTokenIn(BaseModel):
    """The token of an invite link, as the web read it from its `/flatmates/join/:token` URL:
    trimmed, then 1-100 URL-safe base64 characters (anything else is a 422, before the limiter)."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    token: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")


class JoinIn(InviteTokenIn):
    """The join body: the token, and whether the caller chooses to appear on the room's page
    (spec 0010f, decision 17; default off; a JSON boolean only, so consent is never coerced from
    `"yes"` or `0`). The preview keeps `InviteTokenIn`."""

    shown: StrictBool = False


class ShownIn(BaseModel):
    """A flatmate's choice to appear on the room's page (spec 0010f), from `/me/flats`: a JSON
    boolean only (no coercion of `"yes"`, `"false"` or `0`)."""

    model_config = ConfigDict(extra="forbid")

    shown: StrictBool


class InvitePreviewOut(BaseModel):
    """What the invited person sees before joining: the room, who invites them, and whether they
    are already a flatmate there."""

    listing: ApplicationListingOut
    owner_name: str
    member: bool


class JoinOut(BaseModel):
    """The flat the caller is now (or already was) a flatmate of."""

    listing_id: uuid.UUID


class FlatmateOut(BaseModel):
    """One flatmate of the owner's listing. `id` is the membership's id (remove by it)."""

    id: uuid.UUID
    display_name: str
    photo_url: str | None  # their person photo's small address (spec 0010j)
    joined_at: dt.datetime


class MyFlatOut(BaseModel):
    """One flat the caller is a flatmate of."""

    listing: ApplicationListingOut
    owner_name: str
    joined_at: dt.datetime
    # Whether the caller chose to appear on the room's page (spec 0010f).
    shown: bool
