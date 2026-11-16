"""Per-account hourly and daily write budgets (spec 0011c).

A router calls `check(r, user.id, limits.WRITE)` as its handler's first statement (read the bucket
as `limits.WRITE` at call time, so a test can monkeypatch it). Every authenticated, body-valid
attempt counts, whatever its outcome; a refused request counts nothing (`count_or_raise`).

Per-network read budget (spec 0013b): `read_limit`, a dependency of `GET /listings` and
`GET /listings/{id}`, counts every request against `READ` per `client_network` (and an IPv6
network's /48 at `client_ip.PREFIX48_FACTOR` times it). Its keys live at most an hour, and a Redis
failure lets the read through (`redis_client.soft`)."""

import uuid
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request

from app import client_ip
from app.redis_client import RedisClient, get_redis, soft
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
# Each booking, move or cancel of a tour is a chat line and, from spec 0018c, an email to the other
# side (PRODUCT.md "Tours").
TOUR = Bucket("tour", 10, 20)


@dataclass(frozen=True)
class IpBucket:
    name: str
    per_minute: int
    per_hour: int


# No day window: every read key lives at most an hour (spec 0013b, Redis memory).
READ = IpBucket("read", 300, 3_000)

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
    _count(r, counters)


def _count(r: RedisClient, counters: list[tuple[str, int, int]]) -> None:
    try:
        count_or_raise(r, counters)
    except RateLimitedError as exc:
        raise HTTPException(
            status_code=429, detail="rate_limited", headers={"Retry-After": str(exc.retry_after)}
        ) from None


def check_ip(r: RedisClient, network: str, bucket: IpBucket) -> None:
    """Count one request of `network` against `bucket`'s minute and hour counters (an IPv6
    network's /48 first, at `PREFIX48_FACTOR` times them); 429 `rate_limited` with `Retry-After`
    (counting nothing) when any is at its limit."""
    counters: list[tuple[str, int, int]] = []
    p = client_ip.network48(network)
    if p is not None:
        factor = client_ip.PREFIX48_FACTOR
        counters += [
            (f"rl:{bucket.name}:ip48:{p}", factor * bucket.per_minute, 60),
            (f"rl:{bucket.name}:ip48:hour:{p}", factor * bucket.per_hour, 3600),
        ]
    counters += [
        (f"rl:{bucket.name}:ip:{network}", bucket.per_minute, 60),
        (f"rl:{bucket.name}:ip:hour:{network}", bucket.per_hour, 3600),
    ]
    _count(r, counters)


def read_limit(request: Request, r: Annotated[RedisClient, Depends(get_redis)]) -> None:
    """Dependency: count this public read against `READ` for the caller's network. A Redis failure
    lets the read through (public search worked without Redis before spec 0013b)."""
    soft(lambda: check_ip(r, client_ip.client_network(request), READ))
