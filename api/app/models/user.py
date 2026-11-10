"""`users` table (spec 0001a). Role and account type are text with named CHECKs, not enums."""

import datetime as dt
import uuid

from sqlalchemy import CheckConstraint, DateTime, SmallInteger, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "char_length(display_name) BETWEEN 2 AND 40", name="ck_users_display_name_length"
        ),
        CheckConstraint("role IN ('owner', 'seeker')", name="ck_users_role"),
        CheckConstraint("account_type IN ('individual', 'broker')", name="ck_users_account_type"),
        CheckConstraint("listing_cap BETWEEN 0 AND 100", name="ck_users_listing_cap"),
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
