"""applications.price_ils_at_apply / area_id_at_apply (spec 0006c, security B1)

The owner's inbox scores an applicant's budget and area criteria against the listing's price and
area as they were when the seeker applied, so an owner cannot probe a seeker's maximum budget or
preferred areas by editing the listing and re-reading the inbox. Existing rows are backfilled
from their listing's current values.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("applications", sa.Column("price_ils_at_apply", sa.Integer(), nullable=True))
    op.add_column("applications", sa.Column("area_id_at_apply", UUID(as_uuid=True), nullable=True))
    op.execute(
        "UPDATE applications SET price_ils_at_apply = listings.price_ils,"
        " area_id_at_apply = listings.area_id"
        " FROM listings WHERE listings.id = applications.listing_id"
    )
    op.alter_column("applications", "price_ils_at_apply", nullable=False)
    op.alter_column("applications", "area_id_at_apply", nullable=False)
    # As `listings.area_id`: an area in use is never deleted.
    op.create_foreign_key(
        "fk_applications_area_id_at_apply",
        "applications",
        "areas",
        ["area_id_at_apply"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint("fk_applications_area_id_at_apply", "applications", type_="foreignkey")
    op.drop_column("applications", "area_id_at_apply")
    op.drop_column("applications", "price_ils_at_apply")
