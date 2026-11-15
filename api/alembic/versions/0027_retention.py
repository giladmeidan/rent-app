"""data retention (spec 0013h)

`listings.floor` becomes nullable: account deletion clears a deleted owner's floor (with the
flatmates' answers and ages). `ck_listings_floor` (`BETWEEN`) and `ck_listings_total_floors`
pass on NULL, unchanged. No NULL exists before the new `delete_account` writes one.

Downgrade gives each NULL floor 0 (only deleted owners' listings, never shown to anyone), then
restores NOT NULL.

Revision ID: 0027
Revises: 0026
Create Date: 2026-11-15
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("listings", "floor", nullable=True)


def downgrade() -> None:
    op.execute("UPDATE listings SET floor = 0 WHERE floor IS NULL")
    op.alter_column("listings", "floor", nullable=False)
