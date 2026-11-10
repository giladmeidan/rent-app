"""Process-wide Redis client. Named `redis_client` so `app.redis` is never confused with the `redis`
package. `/health` keeps its own per-call ping (FOLLOWUPS)."""

from functools import lru_cache
from typing import TYPE_CHECKING

import redis

from app.config import get_settings

# The stubs make `Redis` generic; at runtime it is not, and FastAPI evaluates annotations.
if TYPE_CHECKING:
    RedisClient = redis.Redis[bytes]
else:
    RedisClient = redis.Redis


@lru_cache(maxsize=1)
def get_redis() -> RedisClient:
    return redis.Redis.from_url(
        get_settings().redis_url.get_secret_value(), socket_connect_timeout=1, socket_timeout=1
    )
