"""ORM models. Import every model here so `Base.metadata` is complete for Alembic."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base shared by all ORM models."""


from app.models.application import Application  # noqa: E402  (models must see Base first)
from app.models.area import Area  # noqa: E402
from app.models.conversation import Conversation, Message  # noqa: E402
from app.models.flatmate import ConversationRead, ListingFlatmate  # noqa: E402
from app.models.listing import Listing  # noqa: E402
from app.models.listing_price_change import ListingPriceChange  # noqa: E402
from app.models.person_pair import PersonPair  # noqa: E402
from app.models.photo import ListingPhoto  # noqa: E402
from app.models.rent_area import RentArea  # noqa: E402
from app.models.rent_price import RentPrice  # noqa: E402
from app.models.room_pair import RoomPair  # noqa: E402
from app.models.seeker_profile import SeekerProfile  # noqa: E402
from app.models.session import Session  # noqa: E402
from app.models.user import User  # noqa: E402

__all__ = [
    "Application",
    "Area",
    "Base",
    "Conversation",
    "ConversationRead",
    "Listing",
    "ListingFlatmate",
    "ListingPhoto",
    "ListingPriceChange",
    "Message",
    "PersonPair",
    "RentArea",
    "RentPrice",
    "RoomPair",
    "SeekerProfile",
    "Session",
    "User",
]
