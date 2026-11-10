"""ORM models. Import every model here so `Base.metadata` is complete for Alembic."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base shared by all ORM models."""


from app.models.application import Application  # noqa: E402  (models must see Base first)
from app.models.area import Area  # noqa: E402
from app.models.listing import Listing  # noqa: E402
from app.models.session import Session  # noqa: E402
from app.models.user import User  # noqa: E402

__all__ = ["Application", "Area", "Base", "Listing", "Session", "User"]
