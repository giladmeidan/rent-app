"""listing shelter (spec 0015a)

`listings.shelter`: the flat's protected space, `mamad` (ממ״ד in the flat), `mamak` (ממ״ק on the
floor), `building` (מקלט in the building) or `none`; NULL = the lister did not say
(`ck_listings_shelter`). It replaces 0014b's `safe_room` yes/no: **backfill** `shelter = 'mamad'`
where `safe_room` was true; a `false` stays NULL ("no ממ״ד" says nothing about a ממ״ק or a מקלט);
then `safe_room` is dropped.

Downgrade: `safe_room` comes back true where `shelter = 'mamad'`, NULL everywhere else (**a `false`
lost on upgrade is not recovered**, and every other shelter answer is lost), then the CHECK and
`shelter` go.

Revision ID: 0023
Revises: 0022
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The same text as `models/listing.py` (autogenerate must see no diff), frozen here.
_SHELTER_CHECK = "shelter IS NULL OR shelter IN ('mamad', 'mamak', 'building', 'none')"


def upgrade() -> None:
    op.add_column("listings", sa.Column("shelter", sa.Text(), nullable=True))
    op.create_check_constraint("ck_listings_shelter", "listings", _SHELTER_CHECK)
    op.execute(sa.text("UPDATE listings SET shelter = 'mamad' WHERE safe_room"))
    op.drop_column("listings", "safe_room")


def downgrade() -> None:
    op.add_column("listings", sa.Column("safe_room", sa.Boolean(), nullable=True))
    op.execute(sa.text("UPDATE listings SET safe_room = true WHERE shelter = 'mamad'"))
    op.drop_constraint("ck_listings_shelter", "listings", type_="check")
    op.drop_column("listings", "shelter")
