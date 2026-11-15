"""Who the public may see: the suspension filters (spec 0012a), shared by search, people, the
market's people and flatmates."""

import uuid

from sqlalchemy import ColumnElement, exists
from sqlalchemy.orm import InstrumentedAttribute, aliased

from app.models import Listing, User


def not_suspended(user_id: InstrumentedAttribute[uuid.UUID]) -> ColumnElement[bool]:
    """The user `user_id` is not suspended (spec 0012a). A `NOT EXISTS` by primary key, not a join,
    so callers' FROM lists and `FOR … OF listings` locks stay as they are; over an anonymous alias,
    so it never correlates with a `users` the caller already joins."""
    user = aliased(User)
    return ~exists().where(user.id == user_id, user.suspended_at.is_not(None))


def owner_not_suspended() -> ColumnElement[bool]:
    """The listing's owner is not suspended (spec 0012a)."""
    return not_suspended(Listing.owner_id)
