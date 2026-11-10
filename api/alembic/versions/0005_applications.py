"""applications and listings.view_count (spec 0004a)

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "applications",
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
        sa.Column(
            "seeker_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'submitted'")),
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
            "char_length(message) BETWEEN 1 AND 500", name="ck_applications_message_length"
        ),
        sa.CheckConstraint(
            "status IN ('submitted', 'shortlisted', 'declined', 'withdrawn')",
            name="ck_applications_status",
        ),
        # One application per seeker per listing, ever; its index (leading `listing_id`) also
        # serves "applications of a listing" and the public applicant count.
        sa.UniqueConstraint("listing_id", "seeker_id", name="uq_applications_listing_seeker"),
    )
    op.create_index("ix_applications_seeker_id", "applications", ["seeker_id"])
    op.add_column(
        "listings",
        sa.Column("view_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_index("ix_applications_seeker_id", table_name="applications")
    op.drop_table("applications")
    op.drop_column("listings", "view_count")
