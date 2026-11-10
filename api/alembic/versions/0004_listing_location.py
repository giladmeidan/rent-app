"""listings approximate location and geocoding state (spec 0003c)

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geography

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The approximate point only (services/geocoding.py `approximate_point`), never the raw one.
    op.add_column(
        "listings",
        sa.Column(
            "location",
            Geography(geometry_type="POINT", srid=4326, spatial_index=False),
            nullable=True,
        ),
    )
    op.add_column(
        "listings",
        sa.Column("geocode_status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
    )
    op.add_column(
        "listings",
        sa.Column(
            "geocode_attempts", sa.SmallInteger(), nullable=False, server_default=sa.text("0")
        ),
    )
    op.create_check_constraint(
        "ck_listings_geocode_status",
        "listings",
        "geocode_status IN ('pending', 'ok', 'not_found', 'failed')",
    )
    op.create_check_constraint(
        "ck_listings_geocode_attempts", "listings", "geocode_attempts BETWEEN 0 AND 5"
    )
    op.create_check_constraint(
        "ck_listings_location_status",
        "listings",
        "(geocode_status = 'ok') = (location IS NOT NULL)",
    )
    # On the planar cast: the map box compares `location::geometry` (services/search.py).
    op.create_index(
        "ix_listings_location",
        "listings",
        [sa.text("(location::geometry)")],
        postgresql_using="gist",
    )


def downgrade() -> None:
    op.drop_index("ix_listings_location", table_name="listings")
    op.drop_constraint("ck_listings_location_status", "listings", type_="check")
    op.drop_constraint("ck_listings_geocode_attempts", "listings", type_="check")
    op.drop_constraint("ck_listings_geocode_status", "listings", type_="check")
    op.drop_column("listings", "geocode_attempts")
    op.drop_column("listings", "geocode_status")
    op.drop_column("listings", "location")
