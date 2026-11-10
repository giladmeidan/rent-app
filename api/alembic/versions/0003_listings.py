"""listings and users.listing_cap

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("listing_cap", sa.SmallInteger(), nullable=False, server_default=sa.text("3")),
    )
    op.create_check_constraint("ck_users_listing_cap", "users", "listing_cap BETWEEN 0 AND 100")
    op.create_table(
        "listings",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "owner_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "area_id",
            UUID(as_uuid=True),
            sa.ForeignKey("areas.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("listing_type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("city", sa.Text(), nullable=False),
        sa.Column("street", sa.Text(), nullable=False),
        sa.Column("rooms", sa.Numeric(3, 1), nullable=False),
        sa.Column("floor", sa.SmallInteger(), nullable=False),
        sa.Column("total_floors", sa.SmallInteger(), nullable=True),
        sa.Column("size_sqm", sa.SmallInteger(), nullable=False),
        sa.Column("price_ils", sa.Integer(), nullable=False),
        sa.Column("available_from", sa.Date(), nullable=False),
        sa.Column("entry_flexible", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("elevator", sa.Boolean(), nullable=False),
        sa.Column("parking_spots", sa.SmallInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("furnished", sa.Text(), nullable=False),
        sa.Column("pets_allowed", sa.Boolean(), nullable=False),
        sa.Column("arnona_ils", sa.Integer(), nullable=True),
        sa.Column("vaad_ils", sa.Integer(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("listing_type IN ('apartment', 'room')", name="ck_listings_type"),
        sa.CheckConstraint("status IN ('active', 'paused')", name="ck_listings_status"),
        sa.CheckConstraint("char_length(city) BETWEEN 1 AND 40", name="ck_listings_city_length"),
        sa.CheckConstraint(
            "char_length(street) BETWEEN 1 AND 80", name="ck_listings_street_length"
        ),
        sa.CheckConstraint(
            "rooms BETWEEN 1 AND 20 AND rooms * 2 = floor(rooms * 2)", name="ck_listings_rooms"
        ),
        sa.CheckConstraint("floor BETWEEN -2 AND 100", name="ck_listings_floor"),
        sa.CheckConstraint(
            "total_floors IS NULL OR total_floors >= floor", name="ck_listings_total_floors"
        ),
        sa.CheckConstraint("size_sqm BETWEEN 5 AND 1000", name="ck_listings_size_sqm"),
        sa.CheckConstraint("price_ils BETWEEN 500 AND 100000", name="ck_listings_price_ils"),
        sa.CheckConstraint("parking_spots BETWEEN 0 AND 5", name="ck_listings_parking_spots"),
        sa.CheckConstraint(
            "furnished IN ('none', 'partial', 'full')", name="ck_listings_furnished"
        ),
        sa.CheckConstraint("arnona_ils BETWEEN 0 AND 20000", name="ck_listings_arnona_ils"),
        sa.CheckConstraint("vaad_ils BETWEEN 0 AND 5000", name="ck_listings_vaad_ils"),
        sa.CheckConstraint(
            "char_length(description) <= 2000", name="ck_listings_description_length"
        ),
    )
    op.create_index("ix_listings_owner_id", "listings", ["owner_id"])
    op.create_index("ix_listings_area_id", "listings", ["area_id"])


def downgrade() -> None:
    op.drop_index("ix_listings_area_id", table_name="listings")
    op.drop_index("ix_listings_owner_id", table_name="listings")
    op.drop_table("listings")
    op.drop_constraint("ck_users_listing_cap", "users", type_="check")
    op.drop_column("users", "listing_cap")
