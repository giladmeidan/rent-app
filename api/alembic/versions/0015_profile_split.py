"""profile split (spec 0010c)

The profile splits in two independent parts: the **personal part** (`gender`, `birth_year`,
`about_me`, `lifestyle`; already nullable or defaulted) and the **looking part** (the 7 housing
columns below, plus `move_in_flexible`, `parking_needed` and `flatmate_gender`).

- The 7 looking columns (`budget_max_ils`, `move_in_date`, `area_ids`, `household`, `has_pets`,
  `smoker`, `contract_months`) become nullable.
- `ck_seeker_profiles_looking`: those 7 are all set or all NULL.
- `ck_seeker_profiles_looking_defaults`: without the looking part, `move_in_flexible`,
  `parking_needed`, `flatmate_gender` and `people_visible` hold their defaults.
- `ck_seeker_profiles_parts`: a row always has at least one part.

Every existing CHECK keeps its name and text (the value CHECKs on budget, areas, household and
contract already pass on NULL; `ck_seeker_profiles_room_section` already says the personal part
needs `gender`). Every existing row has all 7 set, so the upgrade passes the new CHECKs with no
backfill.

Downgrade deletes every personal-only profile first (`budget_max_ils IS NULL`, rows that could not
exist before 0015): **those accounts lose their personal part** (gender, birth year, about me,
questionnaire answers). Full profiles survive unchanged.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-13
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_LOOKING_COLUMNS = (
    "budget_max_ils",
    "move_in_date",
    "area_ids",
    "household",
    "has_pets",
    "smoker",
    "contract_months",
)

# The same text as `models/seeker_profile.py` (autogenerate must see no diff).
_LOOKING = (
    "num_nulls(budget_max_ils, move_in_date, area_ids, household, has_pets, smoker,"
    " contract_months) IN (0, 7)"
)
_LOOKING_DEFAULTS = (
    "budget_max_ils IS NOT NULL OR (NOT move_in_flexible AND parking_needed = 0"
    " AND flatmate_gender = 'any' AND NOT people_visible)"
)
_PARTS = "budget_max_ils IS NOT NULL OR gender IS NOT NULL"


def upgrade() -> None:
    for column in _LOOKING_COLUMNS:
        op.alter_column("seeker_profiles", column, nullable=True)
    op.create_check_constraint("ck_seeker_profiles_looking", "seeker_profiles", _LOOKING)
    op.create_check_constraint(
        "ck_seeker_profiles_looking_defaults", "seeker_profiles", _LOOKING_DEFAULTS
    )
    op.create_check_constraint("ck_seeker_profiles_parts", "seeker_profiles", _PARTS)


def downgrade() -> None:
    # Personal-only rows cannot survive NOT NULL (see the docstring: data loss).
    op.execute("DELETE FROM seeker_profiles WHERE budget_max_ils IS NULL")
    op.drop_constraint("ck_seeker_profiles_parts", "seeker_profiles", type_="check")
    op.drop_constraint("ck_seeker_profiles_looking_defaults", "seeker_profiles", type_="check")
    op.drop_constraint("ck_seeker_profiles_looking", "seeker_profiles", type_="check")
    for column in _LOOKING_COLUMNS:
        op.alter_column("seeker_profiles", column, nullable=False)
