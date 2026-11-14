"""API schemas for people browse in שוק השותפים (spec 0010h). Never the ORM model.

`PersonCardOut` is a person as another person sees them. Its fields are listed explicitly (NF2):
the card's id is `users.card_id`, never a user id, and there is no budget, `household`, pets,
smoker, contract, parking, `flatmate_gender`, email or score (MARKET-PLAN.md decision 11, Q15).
`age` is the current UTC year minus the birth year (`services/people.py::age`), or null without one.
`photo_url` is the person photo's small address (decision 15), or null without one."""

import datetime as dt
import uuid
from typing import Annotated

from pydantic import BaseModel, Field

from app.schemas.people import PEOPLE_OFFSET_MAX
from app.schemas.profile import Lifestyle, SeekerGender


class PeopleBrowseParams(BaseModel):
    """`GET /people` query. The page size is `PEOPLE_LIMIT` (`schemas/people.py`)."""

    offset: Annotated[int, Field(ge=0, le=PEOPLE_OFFSET_MAX)] = 0


class PersonCardOut(BaseModel):
    """One person's card in people browse and in `/me/people-likes`."""

    card_id: uuid.UUID  # `users.card_id`, never a user id
    display_name: str
    gender: SeekerGender
    age: int | None
    area_ids: list[uuid.UUID]
    move_in_date: dt.date
    move_in_flexible: bool
    lifestyle: Lifestyle  # their answers; the web compares them with the viewer's own
    about_me: str | None
    photo_url: str | None
    liked_by_me: bool
    liked_me: bool


class PeopleBrowseOut(BaseModel):
    items: list[PersonCardOut]
    total: int  # every candidate of the viewer, ignoring `offset`


class PersonLikeOut(BaseModel):
    """The result of a person like. `conversation_id` is set exactly when the pair is mutual after
    this like: the direct chat it opened (or reopened)."""

    liked: bool
    conversation_id: uuid.UUID | None


class PersonMatchOut(BaseModel):
    """A mutual like: the other person (by name and photo only) and their direct chat."""

    conversation_id: uuid.UUID
    display_name: str
    photo_url: str | None
    matched_at: dt.datetime  # the later of the two likes


class MyPeopleLikesOut(BaseModel):
    """The people who liked the caller and whom they have not liked back (`liked_me`), the people
    they liked who have not liked back (`mine`), and their matches; newest first in each, at most
    100 each."""

    liked_me: list[PersonCardOut]
    mine: list[PersonCardOut]
    matches: list[PersonMatchOut]
