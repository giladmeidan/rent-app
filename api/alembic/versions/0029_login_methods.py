"""login methods (spec 0016a)

`user_passwords` holds one argon2id hash per account that has a password (no row = no password),
in its own table so the `homie_admin` role can be refused it with one REVOKE. `users.google_sub`
(unique) is Google's account id, written only by spec 0016b; `ck_users_deleted_scrubbed` also
makes a deleted row have none. Existing tombstones satisfy it (the column is new and NULL).

The migration role's default privileges grant SELECT on every new table to `homie_admin`; the
REVOKE below closes that window before `scripts/admin_role.py` runs again.

Downgrade drops `user_passwords` (**passwords are lost**: everyone logs in with a code, which still
works), restores the old CHECK and drops `google_sub`.

Revision ID: 0029
Revises: 0028
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0029"
down_revision: str | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The same texts as `models/user.py` and `models/user_password.py` (autogenerate must see no
# diff), frozen here.
_DELETED_SCRUBBED_0026 = (
    "(deleted_at IS NULL AND email IS NOT NULL AND display_name IS NOT NULL)"
    " OR (deleted_at IS NOT NULL AND email IS NULL AND display_name IS NULL"
    " AND photo_key IS NULL)"
)
_DELETED_SCRUBBED = (
    "(deleted_at IS NULL AND email IS NOT NULL AND display_name IS NOT NULL)"
    " OR (deleted_at IS NOT NULL AND email IS NULL AND display_name IS NULL"
    " AND photo_key IS NULL AND google_sub IS NULL)"
)
_ARGON2ID = "hash LIKE '$argon2id$%'"


def upgrade() -> None:
    op.create_table(
        "user_passwords",
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("hash", sa.Text(), nullable=False),
        sa.CheckConstraint(_ARGON2ID, name="ck_user_passwords_argon2id"),
    )
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'homie_admin') THEN"
        " REVOKE ALL ON user_passwords FROM homie_admin; END IF; END $$"
    )
    op.add_column("users", sa.Column("google_sub", sa.Text(), nullable=True))
    op.create_unique_constraint("uq_users_google_sub", "users", ["google_sub"])
    op.drop_constraint("ck_users_deleted_scrubbed", "users", type_="check")
    op.create_check_constraint("ck_users_deleted_scrubbed", "users", _DELETED_SCRUBBED)


def downgrade() -> None:
    op.drop_constraint("ck_users_deleted_scrubbed", "users", type_="check")
    op.create_check_constraint("ck_users_deleted_scrubbed", "users", _DELETED_SCRUBBED_0026)
    op.drop_constraint("uq_users_google_sub", "users", type_="unique")
    op.drop_column("users", "google_sub")
    op.drop_table("user_passwords")
