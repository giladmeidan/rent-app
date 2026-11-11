"""applications.listing_type_at_apply (spec 0007b); tighter lifestyle CHECKs (0007a follow-up)

Every application records the listing type it was made to, set again when a withdrawn one is
reopened; 0007c keys the inbox's room fields on it, 0007g the owner's lifestyle criterion. Existing
rows are backfilled with the literal `'apartment'`, never the listing's current type: until this
spec `apply` reached only apartments (`_public_listings()` held `listing_type = 'apartment'` since
0003a), and a listing switched to a room since then still carries apartment applicants.

`ck_listings_lifestyle` / `ck_seeker_profiles_lifestyle` (0009) checked only that `lifestyle` is an
object; from here they also require that its keys are among the 7 questionnaire keys and that every
value is the JSON number 1, 2 or 3 (a string, a fraction, null, an array or an object fails). The
jsonpath is `strict`: in lax mode a filter unwraps an array, so `{"night": [1]}` would pass. The
key list is frozen here; `app/models/_checks.py` builds the same text from `LIFESTYLE_KEYS`.
Recreating the CHECKs fails on existing rows written by SQL or seed scripts that hold a key outside
the 7, or a value outside 1-3, so those rows must be cleaned first; `1.0` counts as 1 (the
comparison is numeric). No pre-flight query is run.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_LISTING_TYPE_CHECK = "listing_type_at_apply IN ('apartment', 'room')"

_LIFESTYLE_OBJECT = "jsonb_typeof(lifestyle) = 'object'"  # the 0009 definition
_LIFESTYLE_CHECK = (
    "jsonb_typeof(lifestyle) = 'object'"
    " AND (lifestyle - ARRAY['cleanliness', 'guests', 'night', 'social', 'kosher', 'shabbat',"
    " 'work_from_home']) = '{}'::jsonb"
    " AND NOT jsonb_path_exists(lifestyle,"
    " 'strict $.* ? (@.type() != \"number\" || (@ != 1 && @ != 2 && @ != 3))')"
)
_LIFESTYLE_CHECKS = (
    ("ck_listings_lifestyle", "listings"),
    ("ck_seeker_profiles_lifestyle", "seeker_profiles"),
)


def upgrade() -> None:
    op.add_column("applications", sa.Column("listing_type_at_apply", sa.Text(), nullable=True))
    op.execute("UPDATE applications SET listing_type_at_apply = 'apartment'")
    op.alter_column("applications", "listing_type_at_apply", nullable=False)
    op.create_check_constraint(
        "ck_applications_listing_type_at_apply", "applications", _LISTING_TYPE_CHECK
    )
    for name, table in _LIFESTYLE_CHECKS:
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(name, table, _LIFESTYLE_CHECK)


def downgrade() -> None:
    for name, table in reversed(_LIFESTYLE_CHECKS):
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(name, table, _LIFESTYLE_OBJECT)
    op.drop_constraint("ck_applications_listing_type_at_apply", "applications", type_="check")
    op.drop_column("applications", "listing_type_at_apply")
