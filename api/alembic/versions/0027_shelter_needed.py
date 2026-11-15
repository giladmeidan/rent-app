"""seeker shelter preference (spec 0015b)

`seeker_profiles.shelter_needed`: whether the seeker needs a protected space, `any` (no
preference), `protected` (a listing's `mamad`, `mamak` or `building`) or `mamad` (a ממ״ד in the flat
only); `ck_seeker_profiles_shelter_needed`. It belongs to the looking part, like
`parking_needed`: `ck_seeker_profiles_looking_defaults` gains `shelter_needed = 'any'` in its "no
looking part" branch. Existing rows read `any` (the column default): no backfill.

Downgrade: the old `ck_seeker_profiles_looking_defaults` comes back, then the CHECK and the column
go (**every saved preference is lost**).

Revision ID: 0027
Revises: 0026
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The same text as `models/seeker_profile.py` (autogenerate must see no diff), frozen here.
_SHELTER_CHECK = "shelter_needed IN ('any', 'protected', 'mamad')"
_LOOKING_DEFAULTS = (
    "budget_max_ils IS NOT NULL OR (NOT move_in_flexible AND parking_needed = 0"
    " AND shelter_needed = 'any' AND flatmate_gender = 'any' AND NOT people_visible)"
)
# 0015's text.
_OLD_LOOKING_DEFAULTS = (
    "budget_max_ils IS NOT NULL OR (NOT move_in_flexible AND parking_needed = 0"
    " AND flatmate_gender = 'any' AND NOT people_visible)"
)


def upgrade() -> None:
    op.add_column(
        "seeker_profiles",
        sa.Column("shelter_needed", sa.Text(), nullable=False, server_default=sa.text("'any'")),
    )
    op.create_check_constraint(
        "ck_seeker_profiles_shelter_needed", "seeker_profiles", _SHELTER_CHECK
    )
    op.drop_constraint("ck_seeker_profiles_looking_defaults", "seeker_profiles", type_="check")
    op.create_check_constraint(
        "ck_seeker_profiles_looking_defaults", "seeker_profiles", _LOOKING_DEFAULTS
    )


def downgrade() -> None:
    op.drop_constraint("ck_seeker_profiles_looking_defaults", "seeker_profiles", type_="check")
    op.create_check_constraint(
        "ck_seeker_profiles_looking_defaults", "seeker_profiles", _OLD_LOOKING_DEFAULTS
    )
    op.drop_constraint("ck_seeker_profiles_shelter_needed", "seeker_profiles", type_="check")
    op.drop_column("seeker_profiles", "shelter_needed")
