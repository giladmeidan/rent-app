"""people browse and likes (spec 0008a)

A seeker profile gains `people_visible` (opt in to room listers' people browse, default off) and an
optional `about_me` (1-300 characters); both belong to the room section, so the room-section CHECK
now also holds them at their defaults without a `gender`.

`room_pairs` holds one row per (room listing, seeker) that either side saw or liked: the person
card's id (so a lister never handles a user id), the listing's price frozen when the row was
created (`price_ils_seen`, never updated: every budget input about the pair reads it), and the two
like timestamps (NULL = not liked; both cleared when the pair turns into an application).

`applications.source` says how an application began: `'apply'` (the default, which backfills every
existing row and stays for the SQL test helpers) or `'like'` (a mutual like, `services/people.py`).
A like-sourced application has no message, so `message` drops NOT NULL and its length CHECK becomes
`ck_applications_message`, which ties a message to `'apply'` (the `IS NOT NULL` keeps a NULL from
passing a CHECK that would evaluate to NULL).

Downgrade: like-sourced applications keep their rows with a placeholder message ("mutual match",
in Hebrew); **the likes and frozen prices in `room_pairs`, the opt-ins and the about-me texts are
lost.**

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# "mutual match" in Hebrew: the message a like-sourced application gets on downgrade.
_PLACEHOLDER_MESSAGE = "\u05d4\u05ea\u05d0\u05de\u05d4 \u05d4\u05d3\u05d3\u05d9\u05ea"

_ROOM_SECTION_0009 = (
    "gender IS NOT NULL OR (birth_year IS NULL AND flatmate_gender = 'any'"
    " AND lifestyle = '{}'::jsonb)"
)
_ROOM_SECTION = (
    "gender IS NOT NULL OR (birth_year IS NULL AND flatmate_gender = 'any'"
    " AND lifestyle = '{}'::jsonb AND NOT people_visible AND about_me IS NULL)"
)
_ABOUT_ME = "about_me IS NULL OR char_length(about_me) BETWEEN 1 AND 300"
_MESSAGE_LENGTH_0005 = "char_length(message) BETWEEN 1 AND 500"
_MESSAGE = (
    "(source = 'apply' AND message IS NOT NULL AND char_length(message) BETWEEN 1 AND 500)"
    " OR (source = 'like' AND message IS NULL)"
)
_SOURCE = "source IN ('apply', 'like')"


def upgrade() -> None:
    op.add_column(
        "seeker_profiles",
        sa.Column("people_visible", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("seeker_profiles", sa.Column("about_me", sa.Text(), nullable=True))
    op.create_check_constraint("ck_seeker_profiles_about_me", "seeker_profiles", _ABOUT_ME)
    op.drop_constraint("ck_seeker_profiles_room_section", "seeker_profiles", type_="check")
    op.create_check_constraint("ck_seeker_profiles_room_section", "seeker_profiles", _ROOM_SECTION)

    op.create_table(
        "room_pairs",
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
        sa.Column("price_ils_seen", sa.Integer(), nullable=False),
        sa.Column("lister_liked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("seeker_liked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("price_ils_seen > 0", name="ck_room_pairs_price"),
        # One pair per (listing, seeker); its index (leading `listing_id`) serves a listing's scans.
        sa.UniqueConstraint("listing_id", "seeker_id", name="uq_room_pairs_listing_seeker"),
    )
    op.create_index("ix_room_pairs_seeker_id", "room_pairs", ["seeker_id"])

    op.add_column(
        "applications",
        sa.Column("source", sa.Text(), nullable=False, server_default=sa.text("'apply'")),
    )
    op.create_check_constraint("ck_applications_source", "applications", _SOURCE)
    op.alter_column("applications", "message", nullable=True)
    op.drop_constraint("ck_applications_message_length", "applications", type_="check")
    op.create_check_constraint("ck_applications_message", "applications", _MESSAGE)


def downgrade() -> None:
    # The new message CHECK goes first: it refuses a message on a `'like'` row.
    op.drop_constraint("ck_applications_message", "applications", type_="check")
    op.execute(
        sa.text("UPDATE applications SET message = :placeholder WHERE message IS NULL").bindparams(
            placeholder=_PLACEHOLDER_MESSAGE
        )
    )
    op.alter_column("applications", "message", nullable=False)
    op.create_check_constraint(
        "ck_applications_message_length", "applications", _MESSAGE_LENGTH_0005
    )
    op.drop_constraint("ck_applications_source", "applications", type_="check")
    op.drop_column("applications", "source")

    op.drop_index("ix_room_pairs_seeker_id", table_name="room_pairs")
    op.drop_table("room_pairs")

    op.drop_constraint("ck_seeker_profiles_room_section", "seeker_profiles", type_="check")
    op.drop_constraint("ck_seeker_profiles_about_me", "seeker_profiles", type_="check")
    op.drop_column("seeker_profiles", "about_me")
    op.drop_column("seeker_profiles", "people_visible")
    op.create_check_constraint(
        "ck_seeker_profiles_room_section", "seeker_profiles", _ROOM_SECTION_0009
    )
