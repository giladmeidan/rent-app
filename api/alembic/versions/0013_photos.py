"""photos (spec 0010d)

`listing_photos` holds up to 10 photos per listing (`position` 0-9, unique per listing; position 0
is the cover). `key` is the random object key (`secrets.token_urlsafe(32)`, 43 characters): the
stored objects are `{key}-s.webp` and `{key}-l.webp`, and `ck_listing_photos_key` keeps anything
but the token's alphabet and length (an id, a `/`) from ever becoming part of an object name.
`uq_listing_photos_listing_position` is `DEFERRABLE INITIALLY DEFERRED`: a reorder or the shift
after a delete passes through duplicate positions inside one statement. It also serves the cover
join and the per-listing photo reads. `width` / `height` are the large copy's (at most 1600).

`users.photo_key` is the person photo's key (same CHECK), added here so the chain needs one photo
migration; nothing reads or writes it until spec 0010j.

Downgrade drops the column, then the table: **every photo row and person photo key is lost**. The
stored objects are not touched (dev: `make down` empties `.media`).

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen copies of `models/_checks.py` `photo_key_check` (the token alphabet and length).
_LISTING_KEY_CHECK = "key ~ '^[A-Za-z0-9_-]{43}$'"
_USER_KEY_CHECK = "photo_key ~ '^[A-Za-z0-9_-]{43}$'"


def upgrade() -> None:
    op.create_table(
        "listing_photos",
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
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("width", sa.SmallInteger(), nullable=False),
        sa.Column("height", sa.SmallInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("key", name="uq_listing_photos_key"),
        sa.UniqueConstraint(
            "listing_id",
            "position",
            name="uq_listing_photos_listing_position",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.CheckConstraint(_LISTING_KEY_CHECK, name="ck_listing_photos_key"),
        sa.CheckConstraint("position BETWEEN 0 AND 9", name="ck_listing_photos_position"),
        sa.CheckConstraint("width > 0 AND height > 0", name="ck_listing_photos_size"),
    )
    op.add_column("users", sa.Column("photo_key", sa.Text(), nullable=True))
    op.create_unique_constraint("uq_users_photo_key", "users", ["photo_key"])
    op.create_check_constraint("ck_users_photo_key", "users", _USER_KEY_CHECK)


def downgrade() -> None:
    op.drop_constraint("ck_users_photo_key", "users", type_="check")
    op.drop_constraint("uq_users_photo_key", "users", type_="unique")
    op.drop_column("users", "photo_key")
    op.drop_table("listing_photos")
