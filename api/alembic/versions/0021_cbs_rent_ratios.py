"""cbs rent ratios (spec 0014d)

`cbs_rent_prices` holds the CBS's average rent (Table 4.9) for 1-2 and 2.5-3 rooms per city or
residential district and quarter: the small-flat ratio the rent estimate applies to nadlan's 3-room
figure. `period` is the first day of the quarter's last month; `bulletin` the first day of the
month of the bulletin the row last came from. Nothing else is touched.

Downgrade drops the table: **every imported CBS figure is lost** (the next import fetches the
latest bulletin again; `make cbs-rent-history` the older ones).

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "cbs_rent_prices",
        sa.Column("geo_code", sa.Integer(), nullable=False),
        sa.Column("geo_kind", sa.Text(), nullable=False),
        sa.Column("room_group", sa.Text(), nullable=False),
        sa.Column("period", sa.Date(), nullable=False),
        sa.Column("price_ils", sa.Numeric(8, 1), nullable=False),
        sa.Column("sampling_error", sa.Numeric(8, 2), nullable=True),
        sa.Column("bulletin", sa.Date(), nullable=False),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("geo_kind", "geo_code", "room_group", "period"),
        sa.CheckConstraint(
            "EXTRACT(DAY FROM period) = 1 AND EXTRACT(MONTH FROM period) IN (3, 6, 9, 12)",
            name="ck_cbs_rent_period",
        ),
        sa.CheckConstraint("price_ils BETWEEN 500 AND 100000", name="ck_cbs_rent_price_ils"),
        sa.CheckConstraint("geo_kind IN ('city', 'district')", name="ck_cbs_rent_geo_kind"),
        sa.CheckConstraint("room_group IN ('1-2', '2.5-3')", name="ck_cbs_rent_room_group"),
        sa.CheckConstraint("EXTRACT(DAY FROM bulletin) = 1", name="ck_cbs_rent_bulletin"),
    )


def downgrade() -> None:
    op.drop_table("cbs_rent_prices")
