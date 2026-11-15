"""Process-wide Redis client. Named `redis_client` so `app.redis` is never confused with the `redis`
package. `/health` keeps its own per-call ping (FOLLOWUPS).

`soft` runs a best-effort call (the read limit and the view count, spec 0013b): a `RedisError` is
logged and skipped, and every `soft` call in this process is skipped for `SOFT_SKIP_S` after it, so
a hanging Redis costs one socket timeout per window instead of one per request."""

import logging
import time
from collections.abc import Callable
from functools import lru_cache
from typing import TYPE_CHECKING

import redis
from redis.exceptions import RedisError

from app.config import get_settings

# The stubs make `Redis` generic; at runtime it is not, and FastAPI evaluates annotations.
if TYPE_CHECKING:
    RedisClient = redis.Redis[bytes]
else:
    RedisClient = redis.Redis

log = logging.getLogger(__name__)

SOFT_SKIP_S = 5.0
_soft_skip_until = 0.0


@lru_cache(maxsize=1)
def get_redis() -> RedisClient:
    return redis.Redis.from_url(
        get_settings().redis_url.get_secret_value(), socket_connect_timeout=1, socket_timeout=1
    )


def soft[T](call: Callable[[], T]) -> T | None:
    """`call()`, or None without calling it while a recent Redis error's skip window is open.
    A `RedisError` is logged (its type only), opens the window and returns None; anything else
    (a 429 included) propagates."""
    global _soft_skip_until
    now = time.monotonic()
    if now < _soft_skip_until:
        return None
    try:
        return call()
    except RedisError as exc:
        log.warning("redis call skipped: %s", type(exc).__name__)
        _soft_skip_until = now + SOFT_SKIP_S
        return None
