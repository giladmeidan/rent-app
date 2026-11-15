"""Listing-page views (spec 0011e, FOLLOWUPS 0004a): the public listing page counts a view in Redis,
once per viewer per listing per hour, and the worker adds the counts to `listings.view_count` every
minute (`flush_views`), so `GET /listings/{id}` never writes to the database. Approximate by design:
bots, refetches and the owner count, and anonymous viewers are told apart by
`client_ip.client_network` (an IPv6 /64, an IPv4 address; spec 0013b).

Keys (every one starts with `KEY_PREFIX`; tests use `test-views:`):
- `seen:{h}` (TTL `SEEN_TTL_S`), `h` the first 32 hex of HMAC-SHA256(SECRET_KEY, "listing|viewer"),
  so Redis never holds which network or user viewed which listing.
- `budget` (TTL 3600 s, a fixed window from the first counted view): how many `seen` keys were
  created in the window. At `SEEN_BUDGET_PER_HOUR` no view is counted, which bounds the `seen` keys
  (about 20-30 MB) whatever the number of networks.
- `pending`: hash `listing_id → views` waiting for the flush. A field whose key is not a UUID or
  whose value is not an int is skipped by the flush, logged by count only, and never put back."""

import hashlib
import hmac
import logging
import uuid

from sqlalchemy import Table, bindparam, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Listing
from app.redis_client import RedisClient, soft

log = logging.getLogger(__name__)

KEY_PREFIX = "views:"
SEEN_TTL_S = 3600
SEEN_BUDGET_PER_HOUR = 200_000

# KEYS = seen, budget, pending; ARGV = seen TTL, budget, listing id. Over budget nothing is written;
# a new `seen` key (SET NX) creates the hour's budget counter, counts in it and adds a pending view.
_COUNT_VIEW = """
if tonumber(redis.call('GET', KEYS[2]) or '0') >= tonumber(ARGV[2]) then return 0 end
if not redis.call('SET', KEYS[1], 1, 'NX', 'EX', ARGV[1]) then return 0 end
redis.call('SET', KEYS[2], 0, 'EX', 3600, 'NX')
redis.call('INCR', KEYS[2])
redis.call('HINCRBY', KEYS[3], ARGV[3], 1)
return 1
"""


def count_view(r: RedisClient, listing_id: uuid.UUID, viewer: str) -> None:
    """Count one view of `listing_id` by `viewer` (`u:{user id}` or `ip:{network}`) unless this
    viewer was counted on it in the last hour or the hour's key budget is spent. One EVAL through
    `redis_client.soft`: a Redis failure is logged there and swallowed, so the page never fails for
    a view."""
    secret = get_settings().secret_key.get_secret_value().encode()
    h = hmac.new(secret, f"{listing_id}|{viewer}".encode(), hashlib.sha256).hexdigest()[:32]
    keys = [f"{KEY_PREFIX}seen:{h}", f"{KEY_PREFIX}budget", f"{KEY_PREFIX}pending"]
    soft(
        lambda: r.eval(  # type: ignore[no-untyped-call]  # untyped stub
            _COUNT_VIEW, len(keys), *keys, SEEN_TTL_S, SEEN_BUDGET_PER_HOUR, str(listing_id)
        )
    )


def _parse(raw: dict[bytes, bytes]) -> list[tuple[uuid.UUID, int]]:
    """The well-formed `listing_id → views` fields; the others are logged by count and dropped."""
    rows: list[tuple[uuid.UUID, int]] = []
    for k, v in raw.items():
        try:
            rows.append((uuid.UUID(k.decode()), int(v)))
        except ValueError:
            continue
    if len(rows) < len(raw):
        log.warning("view flush skipped %d malformed field(s)", len(raw) - len(rows))
    return rows


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
    rows = sorted(_parse(raw))
    if not rows:
        return 0
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
