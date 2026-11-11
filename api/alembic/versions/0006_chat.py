"""conversations and messages, backfilled for shortlisted applications (spec 0005a)

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # One conversation per application that was ever shortlisted; its id is the application's.
    op.create_table(
        "conversations",
        sa.Column(
            "application_id",
            UUID(as_uuid=True),
            sa.ForeignKey("applications.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "owner_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "seeker_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("owner_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("seeker_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("owner_id <> seeker_id", name="ck_conversations_two_people"),
    )
    op.create_index("ix_conversations_owner_id", "conversations", ["owner_id"])
    op.create_index("ix_conversations_seeker_id", "conversations", ["seeker_id"])
    op.create_table(
        "messages",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "conversation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("conversations.application_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sender_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("char_length(body) BETWEEN 1 AND 2000", name="ck_messages_body_length"),
    )
    # Serves the thread (newest 200), the newest message and the unread count.
    op.create_index(
        "ix_messages_conversation_created", "messages", ["conversation_id", "created_at", "id"]
    )
    # Applications already shortlisted get their chat now (otherwise only a re-shortlist would).
    op.execute(
        "INSERT INTO conversations (application_id, owner_id, seeker_id, owner_read_at)"
        " SELECT a.id, l.owner_id, a.seeker_id, now()"
        " FROM applications a JOIN listings l ON l.id = a.listing_id"
        " WHERE a.status = 'shortlisted'"
    )


def downgrade() -> None:
    op.drop_index("ix_messages_conversation_created", table_name="messages")
    op.drop_table("messages")
    op.drop_index("ix_conversations_seeker_id", table_name="conversations")
    op.drop_index("ix_conversations_owner_id", table_name="conversations")
    op.drop_table("conversations")
