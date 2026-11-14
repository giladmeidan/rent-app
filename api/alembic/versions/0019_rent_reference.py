"""rent reference (spec 0014a)

`rent_areas` holds one row per settlement and per neighbourhood of nadlan.gov.il's public rent
files; `rent_prices` one row per area, room count (0 = all sizes) and quarter that has a figure.
`period` is the first day of the quarter's last month (2026-06-01 = 2026-Q2). Nothing else is
touched.

Downgrade drops both tables: **every imported figure is lost** (the next import fetches them again).

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects.postgresql import ARRAY, UUID

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "rent_areas",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("settlement_code", sa.Integer(), nullable=False),
        sa.Column("name_he", sa.Text(), nullable=False),
        sa.Column(
            "centre",
            Geometry(geometry_type="POINT", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column("streets", ARRAY(sa.Text()), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("source_version", sa.Text(), nullable=False),
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
        sa.UniqueConstraint("kind", "source_id", name="uq_rent_areas_kind_source"),
        sa.CheckConstraint("kind IN ('settlement', 'neighbourhood')", name="ck_rent_areas_kind"),
        sa.CheckConstraint(
            "char_length(name_he) BETWEEN 1 AND 80", name="ck_rent_areas_name_length"
        ),
    )
    op.create_index("ix_rent_areas_settlement_code", "rent_areas", ["settlement_code"])
    op.create_table(
        "rent_prices",
        sa.Column(
            "area_id",
            UUID(as_uuid=True),
            sa.ForeignKey("rent_areas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("rooms", sa.SmallInteger(), nullable=False),
        sa.Column("period", sa.Date(), nullable=False),
        sa.Column("price_ils", sa.Integer(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("area_id", "rooms", "period"),
        sa.CheckConstraint("rooms IN (0, 3, 4, 5)", name="ck_rent_prices_rooms"),
        sa.CheckConstraint(
            "EXTRACT(DAY FROM period) = 1 AND EXTRACT(MONTH FROM period) IN (3, 6, 9, 12)",
            name="ck_rent_prices_period",
        ),
        sa.CheckConstraint("price_ils BETWEEN 500 AND 100000", name="ck_rent_prices_price_ils"),
    )


def downgrade() -> None:
    op.drop_table("rent_prices")
    op.drop_index("ix_rent_areas_settlement_code", table_name="rent_areas")
    op.drop_table("rent_areas")
