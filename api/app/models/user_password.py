"""`user_passwords` table (spec 0016a, migration 0029): one argon2id hash per account that has a
password; no row = no password. Its own table, not a `users` column, so the admin role
(`scripts/admin_role.py`) is refused it with one REVOKE and still reads whole `users` rows."""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base

# Only argon2id hashes (`services/passwords.py`): a raw password can never be stored by mistake.
ARGON2ID_CHECK = "hash LIKE '$argon2id$%'"


class UserPassword(Base):
    __tablename__ = "user_passwords"
    __table_args__ = (CheckConstraint(ARGON2ID_CHECK, name="ck_user_passwords_argon2id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # The encoded hash `$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>` (the salt is inside).
    hash: Mapped[str] = mapped_column(Text, nullable=False)
