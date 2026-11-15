"""admin logins (spec 0013e)

`admin_logins`: one row per admin login attempt, so the admin's sessions and its wrong-password lock
live in Postgres instead of the signed cookie and the process. Only the sha256 of a session token
is stored (`token_hash`, unique, on `ok` rows only); `ended_at` is a logout; `locks_until` marks the
failure that started a lock.

Downgrade drops the table: every admin session ends and a running lock is lifted.

Revision ID: 0026
Revises: 0024
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0026"
down_revision: str | None = "0024"  # becomes "0025" once spec 0013c's migration lands on main
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The same texts as `models/admin_login.py` (autogenerate must see no diff), frozen here.
_CHECKS = (
    ("ck_admin_logins_token", "ok = (token_hash IS NOT NULL)"),
    ("ck_admin_logins_ended", "ok OR ended_at IS NULL"),
    ("ck_admin_logins_lock", "NOT ok OR locks_until IS NULL"),
)


def upgrade() -> None:
    op.create_table(
        "admin_logins",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=True, unique=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locks_until", sa.DateTime(timezone=True), nullable=True),
        *(sa.CheckConstraint(check, name=name) for name, check in _CHECKS),
    )


def downgrade() -> None:
    op.drop_table("admin_logins")
