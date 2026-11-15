"""admin moderation (spec 0012a)

All of Slice 12's schema: `users.suspended_at` (NULL = not suspended; the partial index
`ix_users_suspended` on the suspended rows' ids), `listings.removed_at`
(NULL = not removed; `ck_listings_removed_paused`: a removed listing is always paused),
`reports.resolved_at` (NULL = open) and the admin's log `admin_actions` (no FK on `target_id`: it
points into four tables and the log outlives its target). Only the admin dashboard (spec 0012b)
writes any of them.

Downgrade drops all four in reverse order: **the admin log, every resolution, removal and
suspension is lost**.

Revision ID: 0023
Revises: 0022
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The same texts as `models/admin_action.py` and `models/listing.py` (autogenerate must see no
# diff), frozen here.
_ADMIN_CHECKS = (
    (
        "ck_admin_actions_action",
        "action IN ('suspend', 'unsuspend', 'hide_listing', 'unhide_listing', 'set_listing_cap',"
        " 'resolve_reports', 'read_chat')",
    ),
    ("ck_admin_actions_target_type", "target_type IN ('user', 'listing', 'report', 'chat')"),
    ("ck_admin_actions_detail_length", "char_length(detail) BETWEEN 1 AND 200"),
)
_REMOVED_PAUSED = "removed_at IS NULL OR status = 'paused'"


def upgrade() -> None:
    op.add_column("users", sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True))
    # The few suspended users: the "not suspended" check reads only these (Gilad, 2026-11-15).
    op.create_index(
        "ix_users_suspended",
        "users",
        ["id"],
        postgresql_where=sa.text("suspended_at IS NOT NULL"),
    )
    op.add_column("listings", sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint("ck_listings_removed_paused", "listings", _REMOVED_PAUSED)
    op.add_column("reports", sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "admin_actions",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target_type", sa.Text(), nullable=False),
        sa.Column("target_id", UUID(as_uuid=True), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        *(sa.CheckConstraint(check, name=name) for name, check in _ADMIN_CHECKS),
    )


def downgrade() -> None:
    op.drop_table("admin_actions")
    op.drop_column("reports", "resolved_at")
    op.drop_constraint("ck_listings_removed_paused", "listings", type_="check")
    op.drop_column("listings", "removed_at")
    op.drop_index("ix_users_suspended", table_name="users")
    op.drop_column("users", "suspended_at")
