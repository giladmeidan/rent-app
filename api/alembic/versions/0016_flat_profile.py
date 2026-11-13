"""flat profile (spec 0010f)

A room listing gains five optional facts about the flat, all nullable and room-only:

- `room_size_sqm smallint` (the room itself), `ck_listings_room_size_sqm`: 4 to 100 and at most the
  flat's `size_sqm`;
- `private_bathroom`, `balcony`, `bills_included` (boolean);
- `poster text` (who is posting: `lives_here`, `leaving`, `landlord`), `ck_listings_poster`.

`ck_listings_room_fields` keeps its name and now also says an apartment holds NULL in the five.

`listing_flatmates.shown boolean NOT NULL DEFAULT false`: whether a flatmate chose to appear on the
room's page (decision 17, chosen at join, default off). Existing flatmates are not shown.

Every new column is nullable or defaulted, so existing rows pass with no backfill.

Downgrade drops `ck_listings_room_fields` and the two new CHECKs first, then the five columns and
`shown` (Postgres would otherwise silently drop the multi-column CHECK with the first column), and
re-creates `ck_listings_room_fields` with its 0009 text. **Every room fact and every flatmate's
`shown` choice is lost on downgrade.**

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The same texts as `models/listing.py` (autogenerate must see no diff).
_ROOM_FIELDS = (
    "listing_type = 'room' OR (gender_preference = 'any' AND flatmates_count IS NULL"
    " AND flatmate_ages = '{}' AND lifestyle = '{}'::jsonb AND room_size_sqm IS NULL"
    " AND private_bathroom IS NULL AND balcony IS NULL AND bills_included IS NULL"
    " AND poster IS NULL)"
)
# Migration 0009's text, restored on downgrade.
_ROOM_FIELDS_0009 = (
    "listing_type = 'room' OR (gender_preference = 'any' AND flatmates_count IS NULL"
    " AND flatmate_ages = '{}' AND lifestyle = '{}'::jsonb)"
)
_ROOM_SIZE = (
    "room_size_sqm IS NULL OR (room_size_sqm BETWEEN 4 AND 100 AND room_size_sqm <= size_sqm)"
)
_POSTER = "poster IS NULL OR poster IN ('lives_here', 'leaving', 'landlord')"

_FACTS = (
    ("room_size_sqm", sa.SmallInteger()),
    ("private_bathroom", sa.Boolean()),
    ("balcony", sa.Boolean()),
    ("bills_included", sa.Boolean()),
    ("poster", sa.Text()),
)


def upgrade() -> None:
    for name, type_ in _FACTS:
        op.add_column("listings", sa.Column(name, type_, nullable=True))
    op.create_check_constraint("ck_listings_room_size_sqm", "listings", _ROOM_SIZE)
    op.create_check_constraint("ck_listings_poster", "listings", _POSTER)
    op.drop_constraint("ck_listings_room_fields", "listings", type_="check")
    op.create_check_constraint("ck_listings_room_fields", "listings", _ROOM_FIELDS)
    op.add_column(
        "listing_flatmates",
        sa.Column("shown", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_constraint("ck_listings_room_fields", "listings", type_="check")
    op.drop_constraint("ck_listings_room_size_sqm", "listings", type_="check")
    op.drop_constraint("ck_listings_poster", "listings", type_="check")
    for name, _type in reversed(_FACTS):
        op.drop_column("listings", name)
    op.drop_column("listing_flatmates", "shown")
    op.create_check_constraint("ck_listings_room_fields", "listings", _ROOM_FIELDS_0009)
