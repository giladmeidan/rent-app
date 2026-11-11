"""API schemas for the seeker's housing profile and the owner's listing preferences (spec 0006a).
Never the ORM model.

Every bound of the `seeker_profiles` CHECKs (migration 0007) is repeated here, so a bad value is a
422 with a list `detail`, never a database `IntegrityError` (a 500). `SeekerProfileOut` lists its
fields explicitly (NF2): adding a column never adds it to a response."""

import datetime as dt
import uuid
from typing import Annotated, Literal, get_args

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

Household = Literal["single", "couple", "family", "roommates"]
# The canonical order: `accepted_households` is stored and returned in it.
HOUSEHOLDS: tuple[Household, ...] = get_args(Household)
ContractMonths = Literal[6, 12, 24, 36]

MOVE_IN_MAX_DAYS = 365
AREA_IDS_MAX = 20


def _canonical_order(value: list[Household]) -> list[Household]:
    return sorted(value, key=HOUSEHOLDS.index)


def _distinct_households(value: list[Household]) -> list[Household]:
    if len(set(value)) != len(value):
        raise ValueError("accepted_households must not repeat a household")
    return _canonical_order(value)


def _distinct_area_ids(value: list[uuid.UUID]) -> list[uuid.UUID]:
    if len(set(value)) != len(value):
        raise ValueError("area_ids must not repeat an area")
    return value


def _move_in_window(value: dt.date) -> dt.date:
    today = dt.datetime.now(dt.UTC).date()
    if value < today:
        raise ValueError("move_in_date must not be in the past")
    if value > today + dt.timedelta(days=MOVE_IN_MAX_DAYS):
        raise ValueError(f"move_in_date must be at most {MOVE_IN_MAX_DAYS} days ahead")
    return value


# A listing's accepted households (`ck_listings_accepted_households`): 1-4 distinct, in
# `HOUSEHOLDS` order whatever order they were sent in.
AcceptedHouseholds = Annotated[
    list[Household], Field(min_length=1, max_length=4), AfterValidator(_distinct_households)
]
# On a response: the stored list, in `HOUSEHOLDS` order.
HouseholdsOut = Annotated[list[Household], AfterValidator(_canonical_order)]
BudgetMaxIls = Annotated[int, Field(ge=500, le=100_000)]  # the listing price range
MoveInDate = Annotated[dt.date, AfterValidator(_move_in_window)]
AreaIds = Annotated[
    list[uuid.UUID],
    Field(min_length=1, max_length=AREA_IDS_MAX),
    AfterValidator(_distinct_area_ids),
]
ParkingNeeded = Annotated[int, Field(ge=0, le=2)]


class SeekerProfileIn(BaseModel):
    """The whole profile (`PUT` replaces it). Every field without a default is a deliberate answer
    the seeker must give. Every `area_ids` entry must also be an active area (the service)."""

    model_config = ConfigDict(extra="ignore")

    budget_max_ils: BudgetMaxIls
    move_in_date: MoveInDate
    move_in_flexible: bool = False  # flexible by about two weeks either way
    area_ids: AreaIds
    household: Household
    has_pets: bool
    smoker: bool
    contract_months: ContractMonths  # the length the seeker wants
    parking_needed: ParkingNeeded = 0


class SeekerProfileOut(BaseModel):
    """The caller's own profile; `area_ids` in the order sent."""

    model_config = ConfigDict(from_attributes=True)

    budget_max_ils: int
    move_in_date: dt.date
    move_in_flexible: bool
    area_ids: list[uuid.UUID]
    household: Household
    has_pets: bool
    smoker: bool
    contract_months: ContractMonths
    parking_needed: int
    updated_at: dt.datetime
