"""listing neighbourhoods (spec 0021a2)

`listings.neighbourhood_id`: the active neighbourhood the server placed the listing in (from its
street, else from its geocoded point); NULL when it cannot tell. `applications.
neighbourhood_id_at_apply`: the listing's neighbourhood when the seeker applied (spec 0006c,
security B1), NULL on applications from before this spec. No backfill: existing rows stay NULL
until their next street edit or geocode.

Downgrade drops both columns (and the index).

Revision ID: 0032
Revises: 0031
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0032"
down_revision: str | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "listings",
        sa.Column(
            "neighbourhood_id",
            UUID(as_uuid=True),
            sa.ForeignKey("areas.id", ondelete="SET NULL", name="fk_listings_neighbourhood_id"),
            nullable=True,
        ),
    )
    op.create_index("ix_listings_neighbourhood_id", "listings", ["neighbourhood_id"])
    op.add_column(
        "applications",
        sa.Column(
            "neighbourhood_id_at_apply",
            UUID(as_uuid=True),
            sa.ForeignKey(
                "areas.id",
                ondelete="RESTRICT",
                name="fk_applications_neighbourhood_id_at_apply",
            ),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("applications", "neighbourhood_id_at_apply")
    op.drop_index("ix_listings_neighbourhood_id", table_name="listings")
    op.drop_column("listings", "neighbourhood_id")
