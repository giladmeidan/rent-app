"""seeker_profiles and the listing preferences the match score reads (spec 0006a)

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, UUID

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # One row per seeker: their housing preferences (PRODUCT.md "Matching"). Read only by its
    # seeker (`GET /me/profile`), the apply gate (existence) and the matching queries (0006b/c).
    op.create_table(
        "seeker_profiles",
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("budget_max_ils", sa.Integer(), nullable=False),
        sa.Column("move_in_date", sa.Date(), nullable=False),
        sa.Column(
            "move_in_flexible", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        # No FK (arrays cannot carry one): the API checks each id is an active area on write.
        sa.Column("area_ids", ARRAY(UUID(as_uuid=True)), nullable=False),
        sa.Column("household", sa.Text(), nullable=False),
        sa.Column("has_pets", sa.Boolean(), nullable=False),
        sa.Column("smoker", sa.Boolean(), nullable=False),
        sa.Column("contract_months", sa.SmallInteger(), nullable=False),
        sa.Column("parking_needed", sa.SmallInteger(), nullable=False, server_default=sa.text("0")),
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
        sa.CheckConstraint(
            "budget_max_ils BETWEEN 500 AND 100000", name="ck_seeker_profiles_budget"
        ),
        sa.CheckConstraint(
            "cardinality(area_ids) BETWEEN 1 AND 20", name="ck_seeker_profiles_area_ids"
        ),
        sa.CheckConstraint(
            "household IN ('single', 'couple', 'family', 'roommates')",
            name="ck_seeker_profiles_household",
        ),
        sa.CheckConstraint(
            "contract_months IN (6, 12, 24, 36)", name="ck_seeker_profiles_contract_months"
        ),
        sa.CheckConstraint(
            "parking_needed BETWEEN 0 AND 2", name="ck_seeker_profiles_parking_needed"
        ),
    )
    # Existing listings get "no preference": every household, smoking allowed, no minimum.
    op.add_column(
        "listings",
        sa.Column(
            "accepted_households",
            ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{single,couple,family,roommates}'"),
        ),
    )
    op.add_column(
        "listings",
        sa.Column("smoking_allowed", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.add_column("listings", sa.Column("min_contract_months", sa.SmallInteger(), nullable=True))
    op.create_check_constraint(
        "ck_listings_accepted_households",
        "listings",
        "cardinality(accepted_households) BETWEEN 1 AND 4"
        " AND accepted_households <@ ARRAY['single', 'couple', 'family', 'roommates']::text[]",
    )
    op.create_check_constraint(
        "ck_listings_min_contract_months",
        "listings",
        "min_contract_months IS NULL OR min_contract_months IN (6, 12, 24, 36)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_listings_min_contract_months", "listings", type_="check")
    op.drop_constraint("ck_listings_accepted_households", "listings", type_="check")
    op.drop_column("listings", "min_contract_months")
    op.drop_column("listings", "smoking_allowed")
    op.drop_column("listings", "accepted_households")
    op.drop_table("seeker_profiles")
