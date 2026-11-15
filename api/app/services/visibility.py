"""Who the public may see: the suspension and deletion filters (specs 0012a, 0013c), shared by
search, people, the market's people and flatmates."""

import uuid

from sqlalchemy import ColumnElement, and_, exists
from sqlalchemy.orm import InstrumentedAttribute, aliased

from app.models import Listing, User


def not_suspended(user_id: InstrumentedAttribute[uuid.UUID]) -> ColumnElement[bool]:
    """The user `user_id` is not suspended (spec 0012a) and not deleted (spec 0013c). Two
    `NOT EXISTS` by primary key, not a join, so callers' FROM lists and `FOR … OF listings` locks
    stay as they are, each served by its own partial index (`ix_users_suspended`,
    `ix_users_deleted`); over anonymous aliases, so they never correlate with a `users` the caller
    already joins."""
    suspended, deleted = aliased(User), aliased(User)
    return and_(
        ~exists().where(suspended.id == user_id, suspended.suspended_at.is_not(None)),
        ~exists().where(deleted.id == user_id, deleted.deleted_at.is_not(None)),
    )


def owner_not_suspended() -> ColumnElement[bool]:
    """The listing's owner is not suspended (spec 0012a) and not deleted (spec 0013c)."""
    return not_suspended(Listing.owner_id)
