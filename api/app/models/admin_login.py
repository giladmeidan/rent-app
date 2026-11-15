"""`admin_logins` table (spec 0013e, migration 0026): the admin dashboard's login attempts (spec
0012b's login), one row per attempt. The running public app never reads or writes it.

A right password is an `ok` row holding the sha256 of its session token (`ended_at` on logout); a
wrong one is a failed row, with `locks_until` on the failure that starts a lock. Every CHECK
matches migration 0026 exactly (autogenerate must see no diff)."""

import datetime as dt
import uuid

from sqlalchemy import Boolean, CheckConstraint, DateTime, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base

TOKEN_CHECK = "ok = (token_hash IS NOT NULL)"
ENDED_CHECK = "ok OR ended_at IS NULL"
LOCK_CHECK = "NOT ok OR locks_until IS NULL"


class AdminLogin(Base):
    __tablename__ = "admin_logins"
    __table_args__ = (
        CheckConstraint(TOKEN_CHECK, name="ck_admin_logins_token"),
        CheckConstraint(ENDED_CHECK, name="ck_admin_logins_ended"),
        CheckConstraint(LOCK_CHECK, name="ck_admin_logins_lock"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False)
    token_hash: Mapped[str | None] = mapped_column(Text, unique=True)
    ended_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    locks_until: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
