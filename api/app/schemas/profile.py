"""API schemas for the seeker's housing profile and the owner's listing preferences (spec 0006a).
Never the ORM model.

Every bound of the `seeker_profiles` CHECKs (migrations 0007 and 0009) is repeated here, so a bad
value is a 422 with a list `detail`, never a database `IntegrityError` (a 500). `SeekerProfileOut`
lists its fields explicitly (NF2): adding a column never adds it to a response.

Spec 0007a adds the types rooms share (`SeekerGender`, `GenderPreference`, `Lifestyle`, the age
bounds) and the profile's room section: `gender` (None = not looking for a room), an optional
`birth_year`, `flatmate_gender` and `lifestyle`. Personal data: no message names a sent value.

Spec 0008a adds `people_visible` (opt in to room listers' people browse) and `about_me` (plain text,
1-300 characters) to the room section: neither without a `gender`."""

import datetime as dt
import uuid
from typing import Annotated, Literal, Self, get_args

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.schemas._text import lf_newlines, visible_characters_only

Household = Literal["single", "couple", "family", "roommates"]
# The canonical order: `accepted_households` is stored and returned in it.
HOUSEHOLDS: tuple[Household, ...] = get_args(Household)
ContractMonths = Literal[6, 12, 24, 36]

# The room section and room listings (spec 0007a).
SeekerGender = Literal["woman", "man", "other"]
# Who a room is for (a listing's `gender_preference`) or whom a seeker wants to live with (a
# profile's `flatmate_gender`).
GenderPreference = Literal["any", "women", "men"]
# The 7 questionnaire keys, in the canonical order clients iterate (key order in a stored or
# returned `lifestyle` is not significant: jsonb reorders keys).
LifestyleKey = Literal[
    "cleanliness", "guests", "night", "social", "kosher", "shabbat", "work_from_home"
]
LIFESTYLE_KEYS: tuple[LifestyleKey, ...] = get_args(LifestyleKey)
LifestyleAnswer = Literal[1, 2, 3]  # the 3-point scale; its wording lives in the web copy


def _known_lifestyle_keys(value: object) -> object:
    """At most 7 answers, every key a `LIFESTYLE_KEYS` one, as a single error at the field: a
    dict validates every key, so a huge body of unknown keys would otherwise return one error
    per key, each naming it. The message never names a sent key. Anything else (a non-dict
    included) passes through unchanged, for Pydantic to report as before."""
    if isinstance(value, dict):
        if len(value) > len(LIFESTYLE_KEYS):
            raise ValueError(f"lifestyle has at most {len(LIFESTYLE_KEYS)} answers")
        if any(key not in LIFESTYLE_KEYS for key in value):
            raise ValueError(f"lifestyle keys must be among: {', '.join(LIFESTYLE_KEYS)}")
    return value


# Only answered keys; an unknown key or a value outside 1-3 is a 422.
Lifestyle = Annotated[dict[LifestyleKey, LifestyleAnswer], BeforeValidator(_known_lifestyle_keys)]

AGE_MIN = 18
AGE_MAX = 99

ABOUT_ME_MAX_LENGTH = 300  # ck_seeker_profiles_about_me (migration 0011)

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


def _adult_birth_year(value: int) -> int:
    """An age of `AGE_MIN`-`AGE_MAX` in the current UTC year. The message names the bounds, never
    the value (personal data)."""
    year = dt.datetime.now(dt.UTC).year
    if not year - AGE_MAX <= value <= year - AGE_MIN:
        raise ValueError(f"birth_year must give an age of {AGE_MIN} to {AGE_MAX} this year")
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
BirthYear = Annotated[int, AfterValidator(_adult_birth_year)]


def _visible_about_me(value: str) -> str:
    return visible_characters_only(value, allow_newlines=True, field="about_me", require_alnum=True)


def _lf_stripped(value: object) -> object:
    """`\\r\\n` -> `\\n`, then stripped. The strip runs here as well: with a `BeforeValidator` in
    front, Pydantic applies `StringConstraints`' own `strip_whitespace` only **after** its length
    checks, so 300 characters inside spaces would be refused."""
    value = lf_newlines(value)
    return value.strip() if isinstance(value, str) else value


# Stripped on the type (`SeekerProfileIn` strips nothing) before the length check, so "   " is
# empty; plain text, never HTML.
AboutMe = Annotated[
    str,
    BeforeValidator(_lf_stripped),
    StringConstraints(strip_whitespace=True, min_length=1, max_length=ABOUT_ME_MAX_LENGTH),
    AfterValidator(_visible_about_me),
]


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
    # The room section (spec 0007a), all optional: omitting it clears it (PUT replaces). Factories,
    # not plain defaults: a JSON-schema `default` makes the generated web type require the key,
    # and the profile page sends none of the four until 0007d.
    gender: SeekerGender | None = None  # None = not looking for a room
    birth_year: BirthYear | None = None
    flatmate_gender: GenderPreference = Field(default_factory=lambda: "any")
    lifestyle: Lifestyle = Field(default_factory=dict)
    # People browse (spec 0008a), also the room section. A factory for the same reason as above.
    people_visible: bool = Field(default_factory=lambda: False)
    about_me: AboutMe | None = None

    @model_validator(mode="after")
    def _room_section_needs_gender(self) -> Self:
        """As `ck_seeker_profiles_room_section`: no room field without a `gender`."""
        if self.gender is None and (
            self.birth_year is not None
            or self.flatmate_gender != "any"
            or self.lifestyle
            or self.people_visible
            or self.about_me is not None
        ):
            raise ValueError(
                "birth_year, flatmate_gender, lifestyle, people_visible and about_me need gender"
                " (the room section)"
            )
        return self


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
    gender: SeekerGender | None
    birth_year: int | None
    flatmate_gender: GenderPreference
    lifestyle: Lifestyle
    people_visible: bool
    about_me: str | None
    updated_at: dt.datetime
