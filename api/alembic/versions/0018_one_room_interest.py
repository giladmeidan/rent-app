"""one room interest (spec 0010l)

On a room a seeker has one way to say "I'm interested", the application; the seeker's room-like
is removed, and a lister's like is an invite that the seeker's application answers (shortlisted,
`source = 'like'`, its chat open).

- `room_pairs.seeker_liked_at` is dropped. Pending seeker likes (a seeker like with no application)
  are dropped with it (spec 0010l Q2: no real users before launch). A pair whose lister liked stays
  an invite.
- `ck_applications_message`: the message is NULL or 1-500 characters, and NULL only on a room
  application (spec 0010l Q1: optional on a room, required on an apartment). Neither term can
  evaluate to NULL, so no NULL slips through. `source` stays `'apply' | 'like'`; a `'like'` row may
  now carry a message (the seeker who answers an invite may write one).

Downgrade (works on any data, as 0011's does): **an invite answer's message is lost** (`'like'`
rows go back to no message), a room application without a message gets a placeholder ("no
message", in Hebrew), then the old CHECK, then `seeker_liked_at` is re-added **empty** (the seeker
likes dropped by the upgrade do not come back).

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# "(no message)" in Hebrew: the message an apply-sourced room application without one gets on
# downgrade.
_PLACEHOLDER_MESSAGE = "(ללא הודעה)"

_MESSAGE_0011 = (
    "(source = 'apply' AND message IS NOT NULL AND char_length(message) BETWEEN 1 AND 500)"
    " OR (source = 'like' AND message IS NULL)"
)
_MESSAGE = (
    "(message IS NULL OR char_length(message) BETWEEN 1 AND 500)"
    " AND (message IS NOT NULL OR listing_type_at_apply = 'room')"
)


def upgrade() -> None:
    op.drop_column("room_pairs", "seeker_liked_at")
    op.drop_constraint("ck_applications_message", "applications", type_="check")
    op.create_check_constraint("ck_applications_message", "applications", _MESSAGE)


def downgrade() -> None:
    op.drop_constraint("ck_applications_message", "applications", type_="check")
    op.execute(sa.text("UPDATE applications SET message = NULL WHERE source = 'like'"))
    op.execute(
        sa.text(
            "UPDATE applications SET message = :placeholder"
            " WHERE message IS NULL AND source = 'apply'"
        ).bindparams(placeholder=_PLACEHOLDER_MESSAGE)
    )
    op.create_check_constraint("ck_applications_message", "applications", _MESSAGE_0011)
    op.add_column(
        "room_pairs",
        sa.Column("seeker_liked_at", sa.DateTime(timezone=True), nullable=True),
    )
