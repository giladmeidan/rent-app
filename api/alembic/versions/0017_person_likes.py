"""person likes (spec 0010h)

People in שוק השותפים like each other's cards; a mutual like opens a direct chat (0010g).

- `users.card_id uuid NOT NULL DEFAULT gen_random_uuid()`, unique (`uq_users_card_id`): the only
  person id in market cards and likes. Existing users get one from the default (one table
  rewrite, fine at MVP volume). It never changes.
- `person_pairs`: one row per pair of people, written only on a like. The pair is ordered
  (`ck_person_pairs_order`: `user_low < user_high`, uuid byte order, as `least` / `greatest`), so
  a pair has one row (the primary key). `low_liked_at` / `high_liked_at`: NULL = not liked; both
  set = mutual. `ix_person_pairs_user_high` finds a user's pairs from the high side (the primary
  key serves the low side).

Downgrade drops `person_pairs` (**every person like is lost**), then `uq_users_card_id` and
`card_id`. Direct chats belong to 0014 and stay.

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "card_id",
            UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
    )
    op.create_unique_constraint("uq_users_card_id", "users", ["card_id"])
    op.create_table(
        "person_pairs",
        sa.Column(
            "user_low",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_high",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("low_liked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("high_liked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("user_low", "user_high", name="person_pairs_pkey"),
        sa.CheckConstraint("user_low < user_high", name="ck_person_pairs_order"),
    )
    op.create_index("ix_person_pairs_user_high", "person_pairs", ["user_high"])


def downgrade() -> None:
    op.drop_index("ix_person_pairs_user_high", table_name="person_pairs")
    op.drop_table("person_pairs")
    op.drop_constraint("uq_users_card_id", "users", type_="unique")
    op.drop_column("users", "card_id")
