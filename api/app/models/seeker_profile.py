"""`seeker_profiles` table (spec 0006a): a person's profile, one row per account.

Every CHECK and the FK match migrations 0007, 0009, 0010, 0011 and 0015 exactly (autogenerate must
see no diff). Personal data (NF2): read only by its owner (`GET /me/profile`), by the apply and like
gates (whether the looking part is filled) and, from 0006b / 0006c, by the matching queries.

Two independent parts (spec 0010c), at least one always set (`ck_seeker_profiles_parts`):
- **The looking part** ("what I am looking for"): the 7 housing columns `budget_max_ils`,
  `move_in_date`, `area_ids`, `household`, `has_pets`, `smoker`, `contract_months`, all set or all
  NULL (`ck_seeker_profiles_looking`), plus `move_in_flexible`, `parking_needed` and
  `flatmate_gender`, which hold their defaults without it (`ck_seeker_profiles_looking_defaults`).
  A NULL `budget_max_ils` means the looking part is empty.
- **The personal part** (spec 0007a, the former "room section"): `gender` (NULL = no personal
  part), an optional `birth_year`, `lifestyle` (the questionnaire answers, key -> 1-3) and, from
  0008a, `about_me`. Without a `gender` these, `flatmate_gender` and `people_visible` hold their
  defaults (`ck_seeker_profiles_room_section`, name kept). Also personal data: from 0007b the room
  fit rule and the match score read it; from 0007c, the owner's inbox reads `gender`, `birth_year`
  (as an age) and `lifestyle` on room applications only (never `flatmate_gender`).
`people_visible` (0008a: opt in to room listers' people browse) needs both parts; people browse
reads the card columns by name, never `budget_max_ils`.

`area_ids` has no FK (an array cannot carry one): the API
checks each id is an active area when the profile is written; a later-deactivated area simply never
matches."""

import datetime as dt
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base
from app.models._checks import LIFESTYLE_CHECK


class SeekerProfile(Base):
    __tablename__ = "seeker_profiles"
    __table_args__ = (
        CheckConstraint("budget_max_ils BETWEEN 500 AND 100000", name="ck_seeker_profiles_budget"),
        CheckConstraint(
            "cardinality(area_ids) BETWEEN 1 AND 20", name="ck_seeker_profiles_area_ids"
        ),
        CheckConstraint(
            "household IN ('single', 'couple', 'family', 'roommates')",
            name="ck_seeker_profiles_household",
        ),
        CheckConstraint(
            "contract_months IN (6, 12, 24, 36)", name="ck_seeker_profiles_contract_months"
        ),
        CheckConstraint("parking_needed BETWEEN 0 AND 2", name="ck_seeker_profiles_parking_needed"),
        CheckConstraint(
            "shelter_needed IN ('any', 'protected', 'mamad')",
            name="ck_seeker_profiles_shelter_needed",
        ),
        # The room section (spec 0007a).
        CheckConstraint(
            "gender IS NULL OR gender IN ('woman', 'man', 'other')",
            name="ck_seeker_profiles_gender",
        ),
        # A loose last line of defence: the API requires an age of 18-99 in the current UTC year.
        CheckConstraint(
            "birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100",
            name="ck_seeker_profiles_birth_year",
        ),
        CheckConstraint(
            "flatmate_gender IN ('any', 'women', 'men')", name="ck_seeker_profiles_flatmate_gender"
        ),
        # Known keys, values 1-3 only (migration 0010).
        CheckConstraint(LIFESTYLE_CHECK, name="ck_seeker_profiles_lifestyle"),
        CheckConstraint(
            "about_me IS NULL OR char_length(about_me) BETWEEN 1 AND 300",
            name="ck_seeker_profiles_about_me",
        ),
        # Opting in and "about me" belong to the room section too (migration 0011).
        CheckConstraint(
            "gender IS NOT NULL OR (birth_year IS NULL AND flatmate_gender = 'any'"
            " AND lifestyle = '{}'::jsonb AND NOT people_visible AND about_me IS NULL)",
            name="ck_seeker_profiles_room_section",
        ),
        # The looking part (spec 0010c, migration 0015): all 7 or none; its defaults without it; a
        # row is never empty.
        CheckConstraint(
            "num_nulls(budget_max_ils, move_in_date, area_ids, household, has_pets, smoker,"
            " contract_months) IN (0, 7)",
            name="ck_seeker_profiles_looking",
        ),
        CheckConstraint(
            "budget_max_ils IS NOT NULL OR (NOT move_in_flexible AND parking_needed = 0"
            " AND shelter_needed = 'any' AND flatmate_gender = 'any' AND NOT people_visible)",
            name="ck_seeker_profiles_looking_defaults",
        ),
        CheckConstraint(
            "budget_max_ils IS NOT NULL OR gender IS NOT NULL", name="ck_seeker_profiles_parts"
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # The looking part (spec 0010c: nullable, all 7 or none).
    budget_max_ils: Mapped[int | None] = mapped_column(Integer, nullable=True)  # monthly
    # The API refuses a past date or one more than a year ahead; a stored date may later pass.
    move_in_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    move_in_flexible: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    area_ids: Mapped[list[uuid.UUID] | None] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=True
    )
    household: Mapped[str | None] = mapped_column(Text, nullable=True)
    has_pets: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    smoker: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # The contract length the seeker wants.
    contract_months: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    parking_needed: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("0")
    )
    # `any` / `protected` (ממ״ד, ממ״ק or מקלט) / `mamad` (a ממ״ד in the flat); spec 0015b.
    shelter_needed: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'any'"))
    # The personal part (spec 0007a's room section, 0010c); `gender` NULL = no personal part.
    gender: Mapped[str | None] = mapped_column(Text)
    birth_year: Mapped[int | None] = mapped_column(SmallInteger)
    flatmate_gender: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'any'"))
    lifestyle: Mapped[dict[str, int]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'")
    )
    # People browse (spec 0008a): shown to room listers whose rooms fit; and a short plain-text
    # "about me" on the person card.
    people_visible: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    about_me: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    # Set to now() by every PUT (`services/profiles.py`).
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
