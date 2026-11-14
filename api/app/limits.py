"""Per-account hourly and daily write budgets (spec 0011c).

A router calls `check(r, user.id, limits.WRITE)` as its handler's first statement (read the bucket
as `limits.WRITE` at call time, so a test can monkeypatch it). Every authenticated, body-valid
attempt counts, whatever its outcome; a refused request counts nothing (`count_or_raise`)."""

import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException

from app.redis_client import RedisClient
from app.schemas.error import ErrorOut
from app.services.rate_limit import RateLimitedError, count_or_raise


@dataclass(frozen=True)
class Bucket:
    name: str
    per_hour: int
    per_day: int


# PRODUCT.md "Trust (MVP)": an account creates at most 5 listings an hour and 10 a day.
CREATE = Bucket("create", 5, 10)
# Each new address is a Nominatim lookup by the worker.
ADDRESS = Bucket("address", 10, 30)
STATUS = Bucket("status", 200, 1000)
# One shared budget for the small writes.
WRITE = Bucket("write", 200, 1000)
ESTIMATE = Bucket("estimate", 300, 1500)

RATE_LIMITED: dict[int | str, dict[str, Any]] = {
    429: {"model": ErrorOut, "description": "rate_limited; see Retry-After"},
}


def check(r: RedisClient, user_id: uuid.UUID, *buckets: Bucket) -> None:
    """Count one attempt against every bucket's hour and day counter at once; 429 `rate_limited`
    with `Retry-After` (counting nothing) when any of them is at its limit."""
    counters = [
        counter
        for b in buckets
        for counter in (
            (f"rl:{b.name}:user:{user_id}", b.per_hour, 3600),
            (f"rl:{b.name}:user:day:{user_id}", b.per_day, 86_400),
        )
    ]
    try:
        count_or_raise(r, counters)
    except RateLimitedError as exc:
        raise HTTPException(
            status_code=429, detail="rate_limited", headers={"Retry-After": str(exc.retry_after)}
        ) from None
