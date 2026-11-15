"""`users` table (spec 0001a). Role and account type are text with named CHECKs, not enums."""

import datetime as dt
import uuid

from sqlalchemy import CheckConstraint, DateTime, Index, SmallInteger, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base
from app.models._checks import photo_key_check


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "char_length(display_name) BETWEEN 2 AND 40", name="ck_users_display_name_length"
        ),
        CheckConstraint("role IN ('owner', 'seeker')", name="ck_users_role"),
        CheckConstraint("account_type IN ('individual', 'broker')", name="ck_users_account_type"),
        CheckConstraint("listing_cap BETWEEN 0 AND 100", name="ck_users_listing_cap"),
        # The person photo's key (spec 0010d migration 0013; read and written from spec 0010j).
        UniqueConstraint("photo_key", name="uq_users_photo_key"),
        CheckConstraint(photo_key_check("photo_key"), name="ck_users_photo_key"),
        # The person's market card id (spec 0010h migration 0017).
        UniqueConstraint("card_id", name="uq_users_card_id"),
        # The few suspended users (spec 0012a migration 0024, Gilad 2026-11-15): the visibility
        # rules' "not suspended" check reads only these, so it stays flat as `users` grows.
        Index("ix_users_suspended", "id", postgresql_where=text("suspended_at IS NOT NULL")),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    # Stored lowercased and stripped by services/auth.py; UNIQUE is on the stored value.
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    # `broker` is reserved for a later paid tier; never set in slice 1.
    account_type: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'individual'")
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    last_login_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    # Live listings allowed at once (spec 0002a; PRODUCT.md "Owner cap: 3 … admin may raise").
    listing_cap: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("3"))
    # The person photo's random object key (`{photo_key}-s.webp` / `-l.webp`), NULL = no photo.
    # Column only in spec 0010d; nothing reads or writes it until 0010j.
    photo_key: Mapped[str | None] = mapped_column(Text)
    # Suspended by the admin (spec 0012a; written only by the dashboard, 0012b), NULL = not. A
    # suspended account's sessions stop resolving and its listings and person card are hidden (the
    # visibility rules in services/search.py, market_people.py, people.py and flatmates.py).
    suspended_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    # The only person id in market cards and likes (spec 0010h): random, never changes, and never
    # appears beside a user id in any response.
    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, server_default=text("gen_random_uuid()")
    )
