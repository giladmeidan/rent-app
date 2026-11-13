"""direct chat (spec 0010g)

A conversation gets its own `id` as its primary key, so a **direct chat** between two people (no
room, no application) can exist. Every existing row keeps `id = application_id`, and
`ck_conversations_application_id` keeps it that way for every new application chat, so every stored
link and every status event keyed by an application id stays valid.

- `application_id` becomes nullable and unique (`uq_conversations_application_id`); its FK to
  `applications(id) ON DELETE CASCADE` stays. NULLs never collide in a unique constraint.
- The FKs of `messages.conversation_id` and `conversation_reads.conversation_id` move from
  `conversations(application_id)` to `conversations(id)`, now named explicitly (0006 and 0012 left
  them unnamed; `Base` has no naming convention), matching the models.
- `closed_at`: a direct chat closed by either side (the match was removed). Only a direct chat
  closes (`ck_conversations_closed_direct`); an application chat closes through its status.
- A direct chat stores its pair ordered (`ck_conversations_direct`: `owner_id < seeker_id`, uuid
  byte order), and there is one per pair, ever (`uq_conversations_direct_pair`, partial on
  `application_id IS NULL`).

Postgres DDL is transactional: a failure rolls the whole swap back. The swap holds ACCESS EXCLUSIVE
on `conversations` and blocks writes to `messages` / `conversation_reads` while the two FKs
re-validate; fine at MVP volume (spec 0010g, Risks).

Downgrade deletes every direct chat first: **direct chats, their messages and their read markers
are lost** (cascade). Application chats, their messages and markers survive with the old primary
key and FKs.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. The new id: every existing row keeps its application's id.
    op.add_column("conversations", sa.Column("id", UUID(as_uuid=True), nullable=True))
    op.execute("UPDATE conversations SET id = application_id")
    op.alter_column(
        "conversations",
        "id",
        nullable=False,
        server_default=sa.text("gen_random_uuid()"),
    )
    # 2. The FKs onto `conversations(application_id)`, by their Postgres default names.
    op.drop_constraint("messages_conversation_id_fkey", "messages", type_="foreignkey")
    op.drop_constraint(
        "conversation_reads_conversation_id_fkey", "conversation_reads", type_="foreignkey"
    )
    # 3. The primary key moves to `id`, same name.
    op.drop_constraint("conversations_pkey", "conversations", type_="primary")
    op.create_primary_key("conversations_pkey", "conversations", ["id"])
    # 4. `application_id`: nullable, unique; its FK to `applications` stays.
    op.alter_column("conversations", "application_id", nullable=True)
    op.create_unique_constraint(
        "uq_conversations_application_id", "conversations", ["application_id"]
    )
    # 5. The two FKs onto `conversations(id)`, named.
    op.create_foreign_key(
        "fk_messages_conversation_id",
        "messages",
        "conversations",
        ["conversation_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_conversation_reads_conversation_id",
        "conversation_reads",
        "conversations",
        ["conversation_id"],
        ["id"],
        ondelete="CASCADE",
    )
    # 6. A direct chat's close.
    op.add_column(
        "conversations", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True)
    )
    # 7. The rules.
    op.create_check_constraint(
        "ck_conversations_direct",
        "conversations",
        "application_id IS NOT NULL OR owner_id < seeker_id",
    )
    op.create_check_constraint(
        "ck_conversations_closed_direct",
        "conversations",
        "closed_at IS NULL OR application_id IS NULL",
    )
    op.create_check_constraint(
        "ck_conversations_application_id",
        "conversations",
        "application_id IS NULL OR id = application_id",
    )
    # 8. One direct chat per pair, ever.
    op.create_index(
        "uq_conversations_direct_pair",
        "conversations",
        ["owner_id", "seeker_id"],
        unique=True,
        postgresql_where=sa.text("application_id IS NULL"),
    )


def downgrade() -> None:
    op.execute("DELETE FROM conversations WHERE application_id IS NULL")
    op.drop_index("uq_conversations_direct_pair", table_name="conversations")
    op.drop_constraint("ck_conversations_application_id", "conversations", type_="check")
    op.drop_constraint("ck_conversations_closed_direct", "conversations", type_="check")
    op.drop_constraint("ck_conversations_direct", "conversations", type_="check")
    op.drop_column("conversations", "closed_at")
    op.drop_constraint(
        "fk_conversation_reads_conversation_id", "conversation_reads", type_="foreignkey"
    )
    op.drop_constraint("fk_messages_conversation_id", "messages", type_="foreignkey")
    op.drop_constraint("conversations_pkey", "conversations", type_="primary")
    op.alter_column("conversations", "application_id", nullable=False)
    op.drop_constraint("uq_conversations_application_id", "conversations", type_="unique")
    op.create_primary_key("conversations_pkey", "conversations", ["application_id"])
    op.create_foreign_key(
        "messages_conversation_id_fkey",
        "messages",
        "conversations",
        ["conversation_id"],
        ["application_id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "conversation_reads_conversation_id_fkey",
        "conversation_reads",
        "conversations",
        ["conversation_id"],
        ["application_id"],
        ondelete="CASCADE",
    )
    op.drop_column("conversations", "id")
