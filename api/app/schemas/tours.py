"""API schemas for tours (spec 0018a; spec 0018b adds its agenda schemas here). Never the ORM
models. Every time in a response is ISO-8601 UTC; only `TourWindowIn` is Israel wall time (the
server converts it, so DST needs no date maths in the browser)."""

import datetime as dt
import uuid
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict

from app.schemas.photo import PhotoOut

TourChangeKind = Literal[
    "booked", "rescheduled", "cancelled_by_seeker", "cancelled_by_lister", "cancelled_by_system"
]
TourStatus = Literal["booked", "cancelled"]


class TourWindowIn(BaseModel):
    """A window in Israel wall time on one day. Only typed here: the window rules (whole 5-minute
    times, end after start, at most 12 hours of whole slots, within 30 days) are
    `services/tours.create_window`'s, a 422 `invalid_window`."""

    model_config = ConfigDict(extra="forbid")

    date: dt.date
    start: dt.time
    end: dt.time
    slot_minutes: Literal[15, 20, 30, 45]


class BookedSlotOut(BaseModel):
    """An upcoming booked tour in one of the lister's windows."""

    tour_id: uuid.UUID
    starts_at: dt.datetime
    seeker_name: str | None  # null = a deleted account
    conversation_id: uuid.UUID  # = the application's id


class TourWindowOut(BaseModel):
    id: uuid.UUID
    starts_at: dt.datetime
    ends_at: dt.datetime
    slot_minutes: int
    booked: list[BookedSlotOut]  # by `starts_at`


class TourWindowsOut(BaseModel):
    """The lister's upcoming windows of one listing (`ends_at` in the future), by `starts_at`."""

    listing_live: bool
    windows: list[TourWindowOut]


class SlotOut(BaseModel):
    starts_at: dt.datetime
    ends_at: dt.datetime


class TourOut(BaseModel):
    id: uuid.UUID
    starts_at: dt.datetime
    ends_at: dt.datetime
    status: TourStatus


class TourSlotsOut(BaseModel):
    """The free slots of the application's listing (none while it is not live) and the
    application's current tour (booked and not over), if any."""

    listing_live: bool
    slots: list[SlotOut]
    tour: TourOut | None


class TourStartIn(BaseModel):
    """A slot's start, timezone-aware (a naive time is a 422)."""

    model_config = ConfigDict(extra="forbid")

    starts_at: AwareDatetime


class TourAgendaListingOut(BaseModel):
    """The facts the web's `cardTitle` needs (spec 0018b), and the cover photo (null without
    photos)."""

    id: uuid.UUID
    listing_type: Literal["apartment", "room"]
    rooms: float
    street: str
    city: str
    cover: PhotoOut | None


class TourAgendaItemOut(BaseModel):
    """One upcoming booked tour of the caller, as the listing's owner (`lister`) or as the seeker
    (spec 0018b). `other_name` is the other party's display name."""

    id: uuid.UUID
    role: Literal["lister", "seeker"]
    starts_at: dt.datetime
    ends_at: dt.datetime
    conversation_id: uuid.UUID  # = the application's id
    other_name: str
    listing: TourAgendaListingOut
