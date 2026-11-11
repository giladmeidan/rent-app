"""room listing fields and the seeker profile's room section (spec 0007a)

A room listing stores who it is for (`gender_preference`), how many flatmates live there
(`flatmates_count`), optionally their ages (`flatmate_ages`) and the flat's questionnaire answers
(`lifestyle`). A seeker profile gains a "room section": own `gender` (NULL = not looking for a
room), an optional `birth_year`, a `flatmate_gender` preference and the seeker's own `lifestyle`.
Existing rows get the defaults, which satisfy every new CHECK: existing rooms become "legacy
rooms" (`'any'`, NULL count) until their next edit.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_LISTINGS_CHECKS = (
    ("ck_listings_gender_preference", "gender_preference IN ('any', 'women', 'men')"),
    (
        "ck_listings_flatmates_count",
        "flatmates_count IS NULL OR flatmates_count BETWEEN 1 AND 7",
    ),
    # The last clause rejects a NULL element, which `ALL` would let through.
    (
        "ck_listings_flatmate_ages",
        "cardinality(flatmate_ages) <= coalesce(flatmates_count, 0)"
        " AND 18 <= ALL (flatmate_ages) AND 99 >= ALL (flatmate_ages)"
        " AND array_position(flatmate_ages, NULL) IS NULL",
    ),
    ("ck_listings_lifestyle", "jsonb_typeof(lifestyle) = 'object'"),
    # An apartment always holds the defaults.
    (
        "ck_listings_room_fields",
        "listing_type = 'room' OR (gender_preference = 'any' AND flatmates_count IS NULL"
        " AND flatmate_ages = '{}' AND lifestyle = '{}'::jsonb)",
    ),
)

_PROFILE_CHECKS = (
    ("ck_seeker_profiles_gender", "gender IS NULL OR gender IN ('woman', 'man', 'other')"),
    # A loose last line of defence: the API requires an age of 18-99 in the current UTC year.
    ("ck_seeker_profiles_birth_year", "birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100"),
    ("ck_seeker_profiles_flatmate_gender", "flatmate_gender IN ('any', 'women', 'men')"),
    ("ck_seeker_profiles_lifestyle", "jsonb_typeof(lifestyle) = 'object'"),
    # No gender = no room section: the other three hold their defaults.
    (
        "ck_seeker_profiles_room_section",
        "gender IS NOT NULL OR (birth_year IS NULL AND flatmate_gender = 'any'"
        " AND lifestyle = '{}'::jsonb)",
    ),
)


def upgrade() -> None:
    op.add_column(
        "listings",
        sa.Column("gender_preference", sa.Text(), nullable=False, server_default=sa.text("'any'")),
    )
    op.add_column("listings", sa.Column("flatmates_count", sa.SmallInteger(), nullable=True))
    op.add_column(
        "listings",
        sa.Column(
            "flatmate_ages",
            ARRAY(sa.SmallInteger()),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )
    op.add_column(
        "listings",
        sa.Column("lifestyle", JSONB(), nullable=False, server_default=sa.text("'{}'")),
    )
    for name, condition in _LISTINGS_CHECKS:
        op.create_check_constraint(name, "listings", condition)

    op.add_column("seeker_profiles", sa.Column("gender", sa.Text(), nullable=True))
    op.add_column("seeker_profiles", sa.Column("birth_year", sa.SmallInteger(), nullable=True))
    op.add_column(
        "seeker_profiles",
        sa.Column("flatmate_gender", sa.Text(), nullable=False, server_default=sa.text("'any'")),
    )
    op.add_column(
        "seeker_profiles",
        sa.Column("lifestyle", JSONB(), nullable=False, server_default=sa.text("'{}'")),
    )
    for name, condition in _PROFILE_CHECKS:
        op.create_check_constraint(name, "seeker_profiles", condition)


def downgrade() -> None:
    for name, _ in reversed(_PROFILE_CHECKS):
        op.drop_constraint(name, "seeker_profiles", type_="check")
    op.drop_column("seeker_profiles", "lifestyle")
    op.drop_column("seeker_profiles", "flatmate_gender")
    op.drop_column("seeker_profiles", "birth_year")
    op.drop_column("seeker_profiles", "gender")
    for name, _ in reversed(_LISTINGS_CHECKS):
        op.drop_constraint(name, "listings", type_="check")
    op.drop_column("listings", "lifestyle")
    op.drop_column("listings", "flatmate_ages")
    op.drop_column("listings", "flatmates_count")
    op.drop_column("listings", "gender_preference")
