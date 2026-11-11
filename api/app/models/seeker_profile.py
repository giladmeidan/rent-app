"""`seeker_profiles` table (spec 0006a): a seeker's housing preferences, one row per seeker.

Every CHECK and the FK match migrations 0007 and 0009 exactly (autogenerate must see no diff).
Personal data (NF2): read only by its seeker (`GET /me/profile`), by the apply gate (existence
only) and, from 0006b / 0006c, by the matching queries.

The room section (spec 0007a): `gender` (NULL = not looking for a room), an optional `birth_year`,
`flatmate_gender` (the flatmates preference) and `lifestyle` (the seeker's questionnaire answers,
key -> 1-3). Without a `gender` the other three hold their defaults
(`ck_seeker_profiles_room_section`). Also personal data: in 0007a only its seeker reads it; from
0007b the room fit rule and the match score read it, and from 0007c the owner inbox shows it on room
applications only.

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
        CheckConstraint("jsonb_typeof(lifestyle) = 'object'", name="ck_seeker_profiles_lifestyle"),
        CheckConstraint(
            "gender IS NOT NULL OR (birth_year IS NULL AND flatmate_gender = 'any'"
            " AND lifestyle = '{}'::jsonb)",
            name="ck_seeker_profiles_room_section",
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    budget_max_ils: Mapped[int] = mapped_column(Integer, nullable=False)  # monthly
    # The API refuses a past date or one more than a year ahead; a stored date may later pass.
    move_in_date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    move_in_flexible: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    area_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=False)
    household: Mapped[str] = mapped_column(Text, nullable=False)
    has_pets: Mapped[bool] = mapped_column(Boolean, nullable=False)
    smoker: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # The contract length the seeker wants.
    contract_months: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    parking_needed: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("0")
    )
    # The room section (spec 0007a); `gender` NULL = not looking for a room.
    gender: Mapped[str | None] = mapped_column(Text)
    birth_year: Mapped[int | None] = mapped_column(SmallInteger)
    flatmate_gender: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'any'"))
    lifestyle: Mapped[dict[str, int]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'")
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    # Set to now() by every PUT (`services/profiles.py`).
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
