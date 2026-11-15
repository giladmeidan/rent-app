"""account deletion (spec 0013c)

A deleted account stays as a scrubbed tombstone, so every FK to it (threads, reports, admin log)
stays valid: `users.deleted_at` (NULL = live), `email` and `display_name` become nullable, and
`ck_users_deleted_scrubbed` makes a deleted row have no email, name or photo. The partial index
`ix_users_deleted` covers the few deleted ids. `blocked_emails` holds the keyed hash of each email
that may not sign up again. Existing rows all satisfy the CHECK: no backfill.

Downgrade keeps the data: the CHECK and index go first (the CHECK would refuse the UPDATE), each
tombstone gets `<id>@deleted.invalid` / `deleted` (RFC 2606: no code can reach it), then
`deleted_at` goes, the columns become NOT NULL again, and `blocked_emails` is dropped (**the
re-signup blocks are lost**). Kept threads and reports survive.

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The same texts as `models/user.py` and `models/blocked_email.py` (autogenerate must see no
# diff), frozen here.
_DELETED_SCRUBBED = (
    "(deleted_at IS NULL AND email IS NOT NULL AND display_name IS NOT NULL)"
    " OR (deleted_at IS NOT NULL AND email IS NULL AND display_name IS NULL"
    " AND photo_key IS NULL)"
)
_HMAC = "email_hmac ~ '^[0-9a-f]{64}$'"


def upgrade() -> None:
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("users", "email", nullable=True)
    op.alter_column("users", "display_name", nullable=True)
    op.create_check_constraint("ck_users_deleted_scrubbed", "users", _DELETED_SCRUBBED)
    op.create_index(
        "ix_users_deleted", "users", ["id"], postgresql_where=sa.text("deleted_at IS NOT NULL")
    )
    op.create_table(
        "blocked_emails",
        sa.Column("email_hmac", sa.Text(), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(_HMAC, name="ck_blocked_emails_hmac"),
    )


def downgrade() -> None:
    op.drop_constraint("ck_users_deleted_scrubbed", "users", type_="check")
    op.drop_index("ix_users_deleted", table_name="users")
    op.execute(
        "UPDATE users SET email = id::text || '@deleted.invalid', display_name = 'deleted'"
        " WHERE deleted_at IS NOT NULL"
    )
    op.drop_column("users", "deleted_at")
    op.alter_column("users", "email", nullable=False)
    op.alter_column("users", "display_name", nullable=False)
    op.drop_table("blocked_emails")
