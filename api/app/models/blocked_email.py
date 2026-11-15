"""`blocked_emails` table (spec 0013c, migration 0026): the keyed hash of each email whose account
homie acted against (a `suspend` or `hide_listing`, even if later lifted) before its owner deleted
it. That email cannot sign up again. No user id: a row cannot be tied back to the tombstone."""

import datetime as dt

from sqlalchemy import CheckConstraint, DateTime, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base

# `services/accounts.py::email_hmac`: HMAC-SHA256 hex digest.
HMAC_CHECK = "email_hmac ~ '^[0-9a-f]{64}$'"


class BlockedEmail(Base):
    __tablename__ = "blocked_emails"
    __table_args__ = (CheckConstraint(HMAC_CHECK, name="ck_blocked_emails_hmac"),)

    email_hmac: Mapped[str] = mapped_column(Text, primary_key=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
