"""flatmates (spec 0008d)

A room listing gains `flatmate_invite_hash`: the sha256 hex of its one live invite token (NULL = no
live link; the token itself is never stored). `uq_listings_flatmate_invite_hash` finds a listing by
hash and keeps two listings from sharing one; NULLs never collide.

`listing_flatmates` holds one row per (listing, user) who joined that listing's flat through its
invite link. `joined_at` is where the flatmate's view of every chat about the room begins; a re-join
after leaving is a new row with a new `joined_at`. `uq_listing_flatmates_listing_user` also serves
the chat statements' membership join; `ix_listing_flatmates_user_id` serves `GET /me/flats`.

`conversation_reads` is a flatmate's read marker per conversation (the owner and the seeker keep
`conversations.owner_read_at` / `seeker_read_at`); it is deleted when the flatmate leaves or is
removed.

Downgrade drops the three in reverse: **every membership, flatmate read marker and live invite link
is lost.**

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("listings", sa.Column("flatmate_invite_hash", sa.Text(), nullable=True))
    op.create_unique_constraint(
        "uq_listings_flatmate_invite_hash", "listings", ["flatmate_invite_hash"]
    )

    op.create_table(
        "listing_flatmates",
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
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("listing_id", "user_id", name="uq_listing_flatmates_listing_user"),
    )
    op.create_index("ix_listing_flatmates_user_id", "listing_flatmates", ["user_id"])

    op.create_table(
        "conversation_reads",
        sa.Column(
            "conversation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("conversations.application_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("conversation_reads")
    op.drop_index("ix_listing_flatmates_user_id", table_name="listing_flatmates")
    op.drop_table("listing_flatmates")
    op.drop_constraint("uq_listings_flatmate_invite_hash", "listings", type_="unique")
    op.drop_column("listings", "flatmate_invite_hash")
