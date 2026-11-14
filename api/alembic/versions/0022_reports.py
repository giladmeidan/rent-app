"""reports (spec 0011b)

`reports`: one row per report a signed-in user made (a listing, a person's card, a person on a
room's people page, a chat, an applicant), stored for Slice 12's admin. One row per (reporter,
`target_type`, `target_id`) (`uq_reports_reporter_target`); `target_id` has no FK (it points into
five tables); both user FKs cascade.

Downgrade drops the table: **every report is lost**.

Revision ID: 0022
Revises: 0021
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The same texts as `models/report.py` (autogenerate must see no diff), frozen here.
_CHECKS = (
    (
        "ck_reports_target_type",
        "target_type IN ('listing', 'person', 'room_person', 'chat', 'applicant')",
    ),
    (
        "ck_reports_reason",
        "reason IN ('money_before_viewing', 'broker', 'misleading', 'unavailable', 'offensive',"
        " 'other')",
    ),
    ("ck_reports_note_length", "char_length(note) BETWEEN 1 AND 500"),
    ("ck_reports_not_self", "reporter_id <> reported_user_id"),
)


def upgrade() -> None:
    op.create_table(
        "reports",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "reporter_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("target_type", sa.Text(), nullable=False),
        sa.Column("target_id", UUID(as_uuid=True), nullable=False),
        sa.Column(
            "reported_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        *(sa.CheckConstraint(check, name=name) for name, check in _CHECKS),
        sa.UniqueConstraint(
            "reporter_id", "target_type", "target_id", name="uq_reports_reporter_target"
        ),
    )
    op.create_index("ix_reports_reported_user_id", "reports", ["reported_user_id"])


def downgrade() -> None:
    op.drop_index("ix_reports_reported_user_id", table_name="reports")
    op.drop_table("reports")
