"""price signals (spec 0014b)

What the rent price estimate can never recover later:

- `listing_price_changes`: one row per price a listing had (`price_ils` 500-100000, `created_at` =
  when it started), indexed on (`listing_id`, `created_at`). **Backfill:** one row per existing
  listing with its current price at its `updated_at` (earlier prices are unknown).
- Four facts on any listing: `safe_room`, `air_conditioning` (boolean), `condition` (text,
  `ck_listings_condition`) and `balcony` (spec 0010f), which stops being room-only:
  `ck_listings_room_fields` is re-created without `AND balcony IS NULL`.
- The closure answer, private to the owner: `close_reason` (`ck_listings_close_reason`),
  `final_rent_ils` (`ck_listings_final_rent_ils`: only with a `rented_*` reason) and `closed_at`
  (`ck_listings_closed_at`: set exactly when `close_reason` is).

Every new column is nullable and the relaxed CHECK accepts every row the old one did.

Downgrade: **an apartment's balcony answer is lost** (set NULL so the old CHECK holds), then the old
`ck_listings_room_fields`, then the six columns with their CHECKs and the table go.

Revision ID: 0020
Revises: 0018
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0020"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The same texts as `models/listing.py` (autogenerate must see no diff).
_ROOM_FIELDS = (
    "listing_type = 'room' OR (gender_preference = 'any' AND flatmates_count IS NULL"
    " AND flatmate_ages = '{}' AND lifestyle = '{}'::jsonb AND room_size_sqm IS NULL"
    " AND private_bathroom IS NULL AND bills_included IS NULL AND poster IS NULL)"
)
# Migration 0016's text, restored on downgrade.
_ROOM_FIELDS_0016 = (
    "listing_type = 'room' OR (gender_preference = 'any' AND flatmates_count IS NULL"
    " AND flatmate_ages = '{}' AND lifestyle = '{}'::jsonb AND room_size_sqm IS NULL"
    " AND private_bathroom IS NULL AND balcony IS NULL AND bills_included IS NULL"
    " AND poster IS NULL)"
)
_CHECKS = (
    (
        "ck_listings_condition",
        "condition IS NULL OR condition IN ('new', 'renovated', 'good', 'needs_work')",
    ),
    (
        "ck_listings_close_reason",
        "close_reason IS NULL OR close_reason IN ('rented_here', 'rented_elsewhere',"
        " 'not_renting')",
    ),
    (
        "ck_listings_final_rent_ils",
        "final_rent_ils IS NULL OR (final_rent_ils BETWEEN 500 AND 100000"
        " AND close_reason IS NOT NULL AND close_reason IN ('rented_here', 'rented_elsewhere'))",
    ),
    ("ck_listings_closed_at", "(close_reason IS NULL) = (closed_at IS NULL)"),
)
_COLUMNS = (
    ("safe_room", sa.Boolean()),
    ("air_conditioning", sa.Boolean()),
    ("condition", sa.Text()),
    ("close_reason", sa.Text()),
    ("final_rent_ils", sa.Integer()),
    ("closed_at", sa.DateTime(timezone=True)),
)


def upgrade() -> None:
    op.create_table(
        "listing_price_changes",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "listing_id",
            UUID(as_uuid=True),
            sa.ForeignKey("listings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("price_ils", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "price_ils BETWEEN 500 AND 100000", name="ck_listing_price_changes_price_ils"
        ),
    )
    op.create_index(
        "ix_listing_price_changes_listing_id",
        "listing_price_changes",
        ["listing_id", "created_at"],
    )
    op.execute(
        sa.text(
            "INSERT INTO listing_price_changes (listing_id, price_ils, created_at)"
            " SELECT id, price_ils, updated_at FROM listings"
        )
    )
    for name, type_ in _COLUMNS:
        op.add_column("listings", sa.Column(name, type_, nullable=True))
    for name, check in _CHECKS:
        op.create_check_constraint(name, "listings", check)
    op.drop_constraint("ck_listings_room_fields", "listings", type_="check")
    op.create_check_constraint("ck_listings_room_fields", "listings", _ROOM_FIELDS)


def downgrade() -> None:
    op.drop_constraint("ck_listings_room_fields", "listings", type_="check")
    op.execute(sa.text("UPDATE listings SET balcony = NULL WHERE listing_type = 'apartment'"))
    op.create_check_constraint("ck_listings_room_fields", "listings", _ROOM_FIELDS_0016)
    # The multi-column CHECKs go before their columns (Postgres would drop them silently).
    for name, _check in reversed(_CHECKS):
        op.drop_constraint(name, "listings", type_="check")
    for name, _type in reversed(_COLUMNS):
        op.drop_column("listings", name)
    op.drop_index("ix_listing_price_changes_listing_id", table_name="listing_price_changes")
    op.drop_table("listing_price_changes")
