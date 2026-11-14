"""`person_pairs` table (spec 0010h): one row per pair of people in שוק השותפים, written only when
one of them likes the other's card.

Every CHECK, the primary key, the FKs and the index match migration 0017 exactly (autogenerate must
see no diff). `services/market_people.py` is the only writer and holds the rules.

The pair is stored ordered (`user_low < user_high`, Postgres's uuid order, always written with
`least` / `greatest` in SQL), so it has one row. A like column is NULL when that side has not
liked; **mutual = both set**, and the likes stay set while matched (the chat is the direct
`conversations` row, 0010g). Removing a match clears both."""

import datetime as dt
import uuid

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, PrimaryKeyConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class PersonPair(Base):
    __tablename__ = "person_pairs"
    __table_args__ = (
        PrimaryKeyConstraint("user_low", "user_high", name="person_pairs_pkey"),
        CheckConstraint("user_low < user_high", name="ck_person_pairs_order"),
        Index("ix_person_pairs_user_high", "user_high"),  # a user's pairs from the high side
    )

    user_low: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    user_high: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    low_liked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    high_liked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
