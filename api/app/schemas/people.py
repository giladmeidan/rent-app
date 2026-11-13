"""API schemas for people browse and likes (spec 0008a). Never the ORM model.

`PersonOut` is a seeker as a room's lister sees them in people browse. Its fields are listed
explicitly (NF2): the card's `id` is the `room_pairs.id`, never a user id, and there is no budget,
`household`, pets, smoker, contract, parking, `flatmate_gender`, `seeker_id` or email; `match`
says only whether each criterion fits (PRODUCT.md "People & likes": the budget only as fits / does
not fit, never the amount). `age` is the current UTC year minus the birth year (as `0007c`), or
null without one.

`LikedRoomOut` is a room as the seeker sees it in their likes: the public listing shape, which never
names the owner (PRODUCT.md "Applications")."""

import datetime as dt
import uuid
from typing import Annotated

from pydantic import BaseModel, Field

from app.schemas.match import MatchOut
from app.schemas.profile import Lifestyle, SeekerGender
from app.schemas.search import LikeStateOut as LikeStateOut
from app.schemas.search import ListingPublic

PEOPLE_LIMIT = 20  # the page size; there is no `limit` parameter
PEOPLE_OFFSET_MAX = 1000


class PeopleParams(BaseModel):
    """`GET /listings/{id}/people` query."""

    offset: Annotated[int, Field(ge=0, le=PEOPLE_OFFSET_MAX)] = 0


class PersonOut(BaseModel):
    """One seeker on a room's people page."""

    id: uuid.UUID  # the pair's id (`room_pairs.id`), never a user id
    display_name: str
    photo_url: str | None  # their person photo's small address (spec 0010j)
    gender: SeekerGender
    age: int | None
    area_ids: list[uuid.UUID]
    move_in_date: dt.date
    move_in_flexible: bool
    lifestyle: Lifestyle
    about_me: str | None
    match: MatchOut  # against the room at the pair's frozen price
    liked_by_me: bool  # the lister liked this person for this room
    liked_me: bool  # this person liked the room


class PeoplePageOut(BaseModel):
    items: list[PersonOut]
    total: int  # every candidate of the room, ignoring `offset`


class LikeOut(BaseModel):
    """The result of a like. `application_id` is set only when this like made the pair mutual:
    the shortlisted application it created, which is also its chat's id."""

    liked: bool
    application_id: uuid.UUID | None


class LikedRoomOut(BaseModel):
    listing: ListingPublic
    liked_at: dt.datetime


class MyLikesOut(BaseModel):
    """The seeker's likes: rooms whose lister liked them and that they have not liked back
    (`liked_me`), and rooms they liked (`mine`); newest like first in each."""

    liked_me: list[LikedRoomOut]
    mine: list[LikedRoomOut]
