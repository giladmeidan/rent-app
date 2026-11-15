"""API schemas for a person's profile and the owner's listing preferences (spec 0006a).
Never the ORM model.

Every bound of the `seeker_profiles` CHECKs (migrations 0007, 0009, 0011 and 0015) is repeated
here, so a bad value is a 422 with a list `detail`, never a database `IntegrityError` (a 500).
`SeekerProfileOut` lists its fields explicitly (NF2): adding a column never adds it to a response.

Spec 0007a adds the types rooms share (`SeekerGender`, `GenderPreference`, `Lifestyle`, the age
bounds). Spec 0010c splits the profile in two independent parts, either alone or both:
- **the personal part**: `gender` (None = no personal part), an optional `birth_year`, `lifestyle`
  and `about_me` (plain text, 1-300 characters, 0008a); none of them without a `gender`;
- **the looking part**: the 7 housing fields (`budget_max_ils`, `move_in_date`, `area_ids`,
  `household`, `has_pets`, `smoker`, `contract_months`), sent together or all None, plus
  `move_in_flexible`, `parking_needed`, `shelter_needed` (0015b) and `flatmate_gender` (which also
  needs `gender`).
`people_visible` (0008a: opt in to people browse) needs both parts. Personal data: no message
names a sent value."""

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
# Spec 0015b: no preference / any protected space (ממ״ד, ממ״ק or מקלט) / a ממ״ד in the flat.
ShelterNeeded = Literal["any", "protected", "mamad"]
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
    """The whole profile (`PUT` replaces it): the personal part, the looking part or both (spec
    0010c); omitting a part clears it. Every `area_ids` entry must also be an active area (the
    service)."""

    model_config = ConfigDict(extra="ignore")

    # The looking part: all 7 or none (`_parts`), so a None here never reaches the database alone.
    budget_max_ils: BudgetMaxIls | None = None
    move_in_date: MoveInDate | None = None
    move_in_flexible: bool = False  # flexible by about two weeks either way
    area_ids: AreaIds | None = None
    household: Household | None = None
    has_pets: bool | None = None
    smoker: bool | None = None
    contract_months: ContractMonths | None = None  # the length the seeker wants
    parking_needed: ParkingNeeded = 0
    # A factory for the same reason as `flatmate_gender` below.
    shelter_needed: ShelterNeeded = Field(default_factory=lambda: "any")
    # The personal part (spec 0007a's room section), all optional: omitting it clears it (PUT
    # replaces). Factories, not plain defaults: a JSON-schema `default` makes the generated web
    # type require the key.
    gender: SeekerGender | None = None  # None = no personal part
    birth_year: BirthYear | None = None
    flatmate_gender: GenderPreference = Field(default_factory=lambda: "any")
    lifestyle: Lifestyle = Field(default_factory=dict)
    # People browse (spec 0008a): needs both parts. A factory for the same reason as above.
    people_visible: bool = Field(default_factory=lambda: False)
    about_me: AboutMe | None = None

    @model_validator(mode="after")
    def _parts(self) -> Self:
        """The two parts' rules, as `ck_seeker_profiles_looking`, `_looking_defaults`,
        `_room_section` and `_parts`, in this order (no message names a sent value)."""
        looking = (
            self.budget_max_ils,
            self.move_in_date,
            self.area_ids,
            self.household,
            self.has_pets,
            self.smoker,
            self.contract_months,
        )
        has_looking = all(value is not None for value in looking)
        if not has_looking and any(value is not None for value in looking):
            raise ValueError(
                "budget_max_ils, move_in_date, area_ids, household, has_pets, smoker and"
                " contract_months are sent together (the looking part)"
            )
        if not has_looking and (
            self.move_in_flexible
            or self.parking_needed != 0
            or self.shelter_needed != "any"
            or self.flatmate_gender != "any"
            or self.people_visible
        ):
            raise ValueError(
                "move_in_flexible, parking_needed, shelter_needed, flatmate_gender and"
                " people_visible need the looking part"
            )
        if self.gender is None and (
            self.birth_year is not None
            or self.flatmate_gender != "any"
            or self.lifestyle
            or self.people_visible
            or self.about_me is not None
        ):
            raise ValueError(
                "birth_year, flatmate_gender, lifestyle, people_visible and about_me need gender"
                " (the personal part)"
            )
        if self.gender is None and not has_looking:
            raise ValueError("fill the personal part, the looking part or both")
        return self


class SeekerProfileOut(BaseModel):
    """The caller's own profile; `area_ids` in the order sent. A `null` `budget_max_ils` means the
    looking part is empty (then all 7 looking fields are `null`); a `null` `gender` means the
    personal part is (spec 0010c)."""

    model_config = ConfigDict(from_attributes=True)

    budget_max_ils: int | None
    move_in_date: dt.date | None
    move_in_flexible: bool
    area_ids: list[uuid.UUID] | None
    household: Household | None
    has_pets: bool | None
    smoker: bool | None
    contract_months: ContractMonths | None
    parking_needed: int
    shelter_needed: ShelterNeeded
    gender: SeekerGender | None
    birth_year: int | None
    flatmate_gender: GenderPreference
    lifestyle: Lifestyle
    people_visible: bool
    about_me: str | None
    updated_at: dt.datetime
