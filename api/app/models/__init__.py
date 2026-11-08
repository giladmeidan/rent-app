"""ORM models. Import every model here so `Base.metadata` is complete for Alembic."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base shared by all ORM models."""


from app.models.area import Area  # noqa: E402  (models must see Base first)

__all__ = ["Area", "Base"]
