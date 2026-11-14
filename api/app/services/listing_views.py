"""Listing-page views (spec 0011e, FOLLOWUPS 0004a): the public listing page counts a view in Redis,
once per viewer per listing per hour, and the worker adds the counts to `listings.view_count` every
minute (`flush_views`), so `GET /listings/{id}` never writes to the database. Approximate by design:
bots, refetches and the owner count, and anonymous viewers are told apart by `request.client.host`.

Keys (every one starts with `KEY_PREFIX`; tests use `test-views:`):
- `seen:{h}` (TTL `SEEN_TTL_S`), `h` the first 32 hex of HMAC-SHA256(SECRET_KEY, "listing|viewer"),
  so Redis never holds which IP or user viewed which listing.
- `pending`: hash `listing_id → views` waiting for the flush."""

import hashlib
import hmac
import logging
import uuid

from redis.exceptions import RedisError
from sqlalchemy import Table, bindparam, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Listing
from app.redis_client import RedisClient

log = logging.getLogger(__name__)

KEY_PREFIX = "views:"
SEEN_TTL_S = 3600


def count_view(r: RedisClient, listing_id: uuid.UUID, viewer: str) -> None:
    """Count one view of `listing_id` by `viewer` (`u:{user id}` or `ip:{host}`) unless this viewer
    was counted on it in the last hour. A Redis failure is logged (its type only) and swallowed:
    the page never fails for a view."""
    secret = get_settings().secret_key.get_secret_value().encode()
    h = hmac.new(secret, f"{listing_id}|{viewer}".encode(), hashlib.sha256).hexdigest()[:32]
    try:
        if r.set(f"{KEY_PREFIX}seen:{h}", 1, nx=True, ex=SEEN_TTL_S):
            r.hincrby(f"{KEY_PREFIX}pending", str(listing_id), 1)
    except RedisError as exc:
        log.warning("listing view not counted: %s", type(exc).__name__)


def flush_views(db: Session, r: RedisClient) -> int:
    """Add the pending views to `listings.view_count` and return how many were added. The hash is
    read and cleared atomically; if the UPDATE or commit fails, the counts are put back and the
    error re-raised. `updated_at` is not touched."""
    pending = f"{KEY_PREFIX}pending"
    pipe = r.pipeline(transaction=True)
    pipe.hgetall(pending)
    pipe.delete(pending)
    raw: dict[bytes, bytes] = pipe.execute()[0]
    if not raw:
        return 0
    # Sorted by id: two flushes never take the listing row locks in opposite orders.
    rows = sorted((uuid.UUID(k.decode()), int(v)) for k, v in raw.items())
    table = Listing.__table__
    assert isinstance(table, Table)
    stmt = (
        update(table)
        .where(table.c.id == bindparam("b_id"))
        .values(view_count=table.c.view_count + bindparam("b_n"))
    )
    try:
        db.execute(stmt, [{"b_id": i, "b_n": n} for i, n in rows])
        db.commit()
    except Exception:
        db.rollback()
        back = r.pipeline(transaction=False)
        for i, n in rows:
            back.hincrby(pending, str(i), n)
        back.execute()
        raise
    return sum(n for _, n in rows)
