"""tours (spec 0018a)

`tour_windows`: the times a lister opens on a listing (Israel wall time, stored UTC), cut into
slots of `slot_minutes`. `tours`: one seeker's booking of one slot; never two `booked` tours on one
(listing, `starts_at`) (`uq_tours_listing_slot`). `tour_feeds`: the hash of a lister's calendar-feed
token (written by spec 0018d; never a raw token). `messages` gains the tour line: `body` becomes
NULLable and `ck_messages_kind` makes a row either a typed message or a tour line, never both.
Existing messages satisfy it (their body is NOT NULL).

The migration role's default privileges grant SELECT on every new table to `homie_admin`; the
REVOKE below closes that window on `tour_feeds`, and the GRANT gives it the `tours` columns its
hide and suspend write, so neither waits for `scripts/admin_role.py` to run again.

`ADD CONSTRAINT ck_messages_kind` validates every message under a lock and `ix_messages_tour_id`
is built without CONCURRENTLY: fine, nothing is deployed yet (spec 0013a open) and `messages` is
small in every environment.

Downgrade deletes the tour lines (**they are lost**), restores `messages`, and drops the three
tables (**tours and windows are lost**).

Revision ID: 0030
Revises: 0029
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0030"
down_revision: str | None = "0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The same texts as `models/tour.py` and `models/conversation.py` (autogenerate must see no diff),
# frozen here.
_SLOT_MINUTES = "slot_minutes IN (15, 20, 30, 45)"
_WINDOW_RANGE = "ends_at > starts_at AND ends_at - starts_at <= interval '12 hours'"
_WHOLE_SLOTS = "(extract(epoch FROM ends_at - starts_at)::integer % (slot_minutes * 60)) = 0"
_TOUR_STATUS = "status IN ('booked', 'cancelled')"
_TOUR_CANCELLED = (
    "(status = 'booked' AND cancelled_by IS NULL AND cancelled_at IS NULL)"
    " OR (status = 'cancelled' AND cancelled_by IS NOT NULL"
    " AND cancelled_by IN ('seeker', 'lister', 'system')"
    " AND cancelled_at IS NOT NULL)"
)
_MESSAGE_KIND = (
    "(tour_change IS NULL AND body IS NOT NULL AND tour_id IS NULL AND tour_starts_at IS NULL)"
    " OR (tour_change IS NOT NULL"
    " AND tour_change IN ('booked', 'rescheduled', 'cancelled_by_seeker', 'cancelled_by_lister',"
    " 'cancelled_by_system') AND body IS NULL AND tour_id IS NOT NULL"
    " AND tour_starts_at IS NOT NULL)"
)


def _now() -> sa.TextClause:
    return sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "tour_windows",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "listing_id",
            UUID(as_uuid=True),
            sa.ForeignKey("listings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("slot_minutes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.CheckConstraint(_SLOT_MINUTES, name="ck_tour_windows_slot_minutes"),
        sa.CheckConstraint(_WINDOW_RANGE, name="ck_tour_windows_range"),
        sa.CheckConstraint(_WHOLE_SLOTS, name="ck_tour_windows_whole_slots"),
    )
    op.create_index("ix_tour_windows_listing_id_ends_at", "tour_windows", ["listing_id", "ends_at"])

    op.create_table(
        "tours",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "listing_id",
            UUID(as_uuid=True),
            sa.ForeignKey("listings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "application_id",
            UUID(as_uuid=True),
            sa.ForeignKey("applications.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "seeker_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'booked'")),
        sa.Column("cancelled_by", sa.Text(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reminder_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.CheckConstraint(_TOUR_STATUS, name="ck_tours_status"),
        sa.CheckConstraint(_TOUR_CANCELLED, name="ck_tours_cancelled"),
        sa.CheckConstraint("ends_at > starts_at", name="ck_tours_range"),
    )
    booked = sa.text("status = 'booked'")
    op.create_index(
        "uq_tours_listing_slot",
        "tours",
        ["listing_id", "starts_at"],
        unique=True,
        postgresql_where=booked,
    )
    op.create_index("ix_tours_application_id", "tours", ["application_id"])
    op.create_index("ix_tours_seeker_id", "tours", ["seeker_id"], postgresql_where=booked)
    op.create_index("ix_tours_booked_starts_at", "tours", ["starts_at"], postgresql_where=booked)

    op.create_table(
        "tour_feeds",
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.UniqueConstraint("token_hash", name="uq_tour_feeds_token_hash"),
    )
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'homie_admin') THEN"
        " REVOKE ALL ON tour_feeds FROM homie_admin;"
        " GRANT UPDATE (status, cancelled_by, cancelled_at, updated_at) ON tours TO homie_admin;"
        " END IF; END $$"
    )

    op.alter_column("messages", "body", existing_type=sa.Text(), nullable=True)
    op.add_column(
        "messages",
        sa.Column(
            "tour_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tours.id", ondelete="CASCADE", name="fk_messages_tour_id"),
            nullable=True,
        ),
    )
    op.add_column("messages", sa.Column("tour_change", sa.Text(), nullable=True))
    op.add_column(
        "messages", sa.Column("tour_starts_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_check_constraint("ck_messages_kind", "messages", _MESSAGE_KIND)
    op.create_index(
        "ix_messages_tour_id",
        "messages",
        ["tour_id"],
        postgresql_where=sa.text("tour_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute("DELETE FROM messages WHERE tour_change IS NOT NULL")
    op.drop_index("ix_messages_tour_id", table_name="messages")
    op.drop_constraint("ck_messages_kind", "messages", type_="check")
    op.drop_column("messages", "tour_starts_at")
    op.drop_column("messages", "tour_change")
    op.drop_column("messages", "tour_id")
    op.alter_column("messages", "body", existing_type=sa.Text(), nullable=False)
    op.drop_table("tour_feeds")
    op.drop_table("tours")
    op.drop_table("tour_windows")
