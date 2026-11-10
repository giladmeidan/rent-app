"""ORM models. Import every model here so `Base.metadata` is complete for Alembic."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base shared by all ORM models."""


from app.models.area import Area  # noqa: E402  (models must see Base first)
from app.models.session import Session  # noqa: E402
from app.models.user import User  # noqa: E402

__all__ = ["Area", "Base", "Session", "User"]
