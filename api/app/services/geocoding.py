"""Approximate listing locations (spec 0003c). The only module that talks to a geocoder.

The worker (`app/worker.py`) runs `geocode_pending` every 10 s: it geocodes the street **name** (a
house number is dropped, `street_query`) and city of live `pending` listings, bounded by the area's
bounding box, and stores `approximate_point`: the geocoder's point moved by a fixed, never-zero,
per-listing offset of at most `JITTER_DEG` on each axis. Postgres and responses only ever hold that
approximate point; the raw one lives only in the Redis cache.

Nominatim's usage policy (public instance): at most one request per second (the sweep sleeps
`min_interval_s` after every call while holding a Redis lock), an identifying User-Agent (config,
never an email), cached results, no bulk geocoding (`SWEEP_BATCH` live rows per sweep, only after
an address change). Any outage pauses geocoding (`PAUSE_S`; `BLOCKED_PAUSE_S` on 429/403).

Nothing here logs a city, a street or a point."""

import hashlib
import hmac
import json
import math
import re
import time
import uuid
from collections.abc import Callable
from functools import lru_cache
from typing import Protocol

import httpx
from sqlalchemy import case, cast, func, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Area, Listing
from app.redis_client import RedisClient

Point = tuple[float, float]  # (lng, lat)
Envelope = tuple[float, float, float, float]  # (west, south, east, north)

# The offset of `approximate_point`: 0.0001 to 0.0020 degrees per axis (~220 m north-south,
# ~190 m east-west at 32 N at most).
JITTER_DEG = 0.002
_JITTER_STEP = 0.0001
_JITTER_STEPS = round(JITTER_DEG / _JITTER_STEP)

SWEEP_BATCH = 20
SWEEP_BUDGET_S = 6.0
MAX_ATTEMPTS = 5
LOCK_TTL_S = 60
PAUSE_S = 300  # any geocoder outage
BLOCKED_PAUSE_S = 3600  # HTTP 429 / 403: throttled or blocked
CACHE_POINT_TTL_S = 30 * 24 * 3600
CACHE_NONE_TTL_S = 7 * 24 * 3600
_CACHE_NONE = b"none"

NOMINATIM_MIN_INTERVAL_S = 1.1
NOMINATIM_TIMEOUT_S = 3.0

# A whole token that is a house number: ASCII digits, optionally `#` first, a `/` or `-` range or
# sub-number, one Latin or Hebrew letter, a geresh (`\u05f3` or `'`) and a trailing `,` or `.`:
# `12`, `12,`, `12/3`, `12-14`, `12A`, `#12`, `12\u05d0\u05f3`. A token that starts with a letter
# (`\u05d4-12`) is not one; neither is a space-less `<street>12` (FOLLOWUPS).
_HOUSE_NUMBER = re.compile(r"#?[0-9]+(?:[/-][0-9]+)?[A-Za-z\u05d0-\u05ea]?[\u05f3']?[,.]?")


class GeocoderUnavailable(Exception):  # noqa: N818  (the name the spec fixes)
    """A transient failure: nothing is known about the address. `stop_sweep` is `True` for HTTP
    429/403 ("we are being throttled or blocked, stop asking this run")."""

    def __init__(self, *, stop_sweep: bool) -> None:
        super().__init__("geocoder unavailable" + (" (throttled or blocked)" if stop_sweep else ""))
        self.stop_sweep = stop_sweep


class Geocoder(Protocol):
    min_interval_s: float

    def geocode(self, city: str, street: str, envelope: Envelope) -> Point | None:
        """The address's point inside `envelope`; `None` = definitively not found. Raises
        `GeocoderUnavailable` for anything transient."""
        ...


def street_query(street: str) -> str:
    """`street` without its house-number tokens (`_HOUSE_NUMBER`), whitespace collapsed. An empty
    result means "not found", without a request."""
    return " ".join(token for token in street.split() if not _HOUSE_NUMBER.fullmatch(token))


def _inside(point: Point, envelope: Envelope) -> bool:
    lng, lat = point
    west, south, east, north = envelope
    return west <= lng <= east and south <= lat <= north


class NominatimGeocoder:
    """One `GET /search` per address on a client built by `get_geocoder()` (base URL, User-Agent,
    timeout). Never follows redirects (httpx's default)."""

    min_interval_s: float = NOMINATIM_MIN_INTERVAL_S

    def __init__(self, client: httpx.Client) -> None:
        self.client = client

    def geocode(self, city: str, street: str, envelope: Envelope) -> Point | None:
        query = street_query(street)
        if not query:
            return None
        west, south, east, north = envelope
        params = {
            "street": query,
            "city": city,
            "countrycodes": "il",
            "format": "jsonv2",
            "limit": "1",
            "accept-language": "he",
            "viewbox": f"{west},{north},{east},{south}",
            "bounded": "1",
        }
        # `from None` throughout: an httpx error's message and context may hold the request URL,
        # which holds the street and city.
        try:
            response = self.client.get("/search", params=params)
        except httpx.HTTPError:
            raise GeocoderUnavailable(stop_sweep=False) from None
        if response.status_code in (429, 403):
            raise GeocoderUnavailable(stop_sweep=True)
        if response.status_code != 200:
            raise GeocoderUnavailable(stop_sweep=False)
        try:
            payload = response.json()
        except ValueError:
            raise GeocoderUnavailable(stop_sweep=False) from None
        if not isinstance(payload, list):
            raise GeocoderUnavailable(stop_sweep=False)
        if not payload:
            return None
        first = payload[0]
        try:
            point = (float(first["lon"]), float(first["lat"]))
        except (KeyError, TypeError, ValueError):
            raise GeocoderUnavailable(stop_sweep=False) from None
        if not all(math.isfinite(value) for value in point):
            # A `nan` / `inf` coordinate is a malformed payload, not an answer (spec AC7).
            raise GeocoderUnavailable(stop_sweep=False)
        return point if _inside(point, envelope) else None


class FakeGeocoder:
    """No network: a deterministic point inside the middle half of the envelope, derived from the
    address. The default backend (dev, CI, e2e)."""

    min_interval_s: float = 0.0

    def geocode(self, city: str, street: str, envelope: Envelope) -> Point | None:
        query = street_query(street)
        if not query:
            return None
        digest = hashlib.sha256(f"{city}|{query}".encode()).digest()
        west, south, east, north = envelope
        fx = int.from_bytes(digest[0:4], "big") / 2**32
        fy = int.from_bytes(digest[4:8], "big") / 2**32
        return (
            west + (east - west) * (0.25 + 0.5 * fx),
            south + (north - south) * (0.25 + 0.5 * fy),
        )


@lru_cache(maxsize=1)
def get_geocoder() -> Geocoder:
    """The process-wide geocoder chosen by `GEOCODER` (one `httpx.Client` for Nominatim)."""
    settings = get_settings()
    if settings.geocoder == "nominatim":
        client = httpx.Client(
            base_url=settings.nominatim_url,
            headers={"User-Agent": settings.nominatim_user_agent},
            timeout=NOMINATIM_TIMEOUT_S,
        )
        return NominatimGeocoder(client)
    return FakeGeocoder()


def approximate_point(listing_id: uuid.UUID, point: Point, secret: str) -> Point:
    """`point` moved by a deterministic per-listing offset of `k * 0.0001` degrees per axis,
    `k = +-(1 + u % 20)` (never zero, at most `JITTER_DEG`), rounded to 4 decimals. Keyed by
    `secret`, so the offset cannot be undone from the listing id alone."""
    h = hmac.new(secret.encode(), b"geo:" + listing_id.bytes, hashlib.sha256).digest()

    def offset(u_bytes: bytes, sign_byte: int) -> float:
        k = 1 + int.from_bytes(u_bytes, "big") % _JITTER_STEPS
        return (-k if sign_byte & 1 else k) * _JITTER_STEP

    lng, lat = point
    return (round(lng + offset(h[0:2], h[2]), 4), round(lat + offset(h[3:5], h[5]), 4))


def _cache_key(key_prefix: str, area_id: uuid.UUID, city: str, query: str) -> str:
    digest = hashlib.sha256(f"{area_id}|{city}|{query}".encode()).hexdigest()
    return f"{key_prefix}v1:{digest}"


_MISS = object()  # no usable cache entry


def _cached(raw: bytes | None) -> Point | None | object:
    """A cache entry as a point or `None`; `_MISS` when absent or unreadable."""
    if raw is None:
        return _MISS
    if raw == _CACHE_NONE:
        return None
    try:
        lng, lat = json.loads(raw)
        return (float(lng), float(lat))
    except (ValueError, TypeError):
        return _MISS


def geocode_pending(
    db: Session,
    redis: RedisClient,
    geocoder: Geocoder,
    *,
    secret: str,
    key_prefix: str = "geo:",
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, int]:
    """One sweep over up to `SWEEP_BATCH` live `pending` listings (spec 0003c "Sweep"). Returns the
    counts (`located`, `not_found`, `retry`, `failed`, `cached`), or `{"skipped": 1}` when geocoding
    is paused or another sweep holds the lock. Every Redis key starts with `key_prefix`. Redis and
    Postgres errors propagate. Commits per row; never touches `updated_at`."""
    pause_key = f"{key_prefix}pause"
    lock_key = f"{key_prefix}sweep-lock"
    if redis.exists(pause_key):
        return {"skipped": 1}
    if not redis.set(lock_key, 1, nx=True, ex=LOCK_TTL_S):
        return {"skipped": 1}
    counts = {"located": 0, "not_found": 0, "retry": 0, "failed": 0, "cached": 0}
    try:
        start = clock()
        rows = db.execute(
            select(
                Listing.id,
                Listing.area_id,
                Listing.city,
                Listing.street,
                func.ST_XMin(Area.geom),
                func.ST_YMin(Area.geom),
                func.ST_XMax(Area.geom),
                func.ST_YMax(Area.geom),
            )
            .join(Area, Area.id == Listing.area_id)
            .where(
                Area.is_active.is_(True),
                Listing.geocode_status == "pending",
                Listing.status == "active",
                Listing.expires_at > func.now(),
            )
            # Rows that already failed go behind fresh ones, so one failing address cannot hold the
            # head of the queue after every pause.
            .order_by(Listing.geocode_attempts, Listing.updated_at, Listing.id)
            .limit(SWEEP_BATCH)
        ).all()
        db.commit()  # no transaction stays open across geocoder calls
        for listing_id, area_id, city, street, west, south, east, north in rows:
            envelope: Envelope = (float(west), float(south), float(east), float(north))
            query = street_query(street)
            key = _cache_key(key_prefix, area_id, city, query)
            unavailable: GeocoderUnavailable | None = None
            point: Point | None = None
            hit = _cached(redis.get(key))
            if hit is not _MISS:
                counts["cached"] += 1
                point = hit if isinstance(hit, tuple) else None
            elif not query:
                redis.set(key, _CACHE_NONE, ex=CACHE_NONE_TTL_S)
            else:
                if clock() - start >= SWEEP_BUDGET_S:
                    break
                try:
                    point = geocoder.geocode(city, query, envelope)
                except GeocoderUnavailable as exc:
                    unavailable = exc
                finally:
                    # After every call, the lock still held: no two requests < min_interval_s apart.
                    if geocoder.min_interval_s > 0:
                        sleep(geocoder.min_interval_s)
                if unavailable is None:
                    if point is None:
                        redis.set(key, _CACHE_NONE, ex=CACHE_NONE_TTL_S)
                    else:
                        redis.set(key, json.dumps(list(point)), ex=CACHE_POINT_TTL_S)

            # Guarded: a result for an address the owner has since changed is dropped (AC6).
            guarded = update(Listing).where(
                Listing.id == listing_id,
                Listing.geocode_status == "pending",
                Listing.area_id == area_id,
                Listing.city == city,
                Listing.street == street,
            )
            if unavailable is not None:
                attempts = Listing.geocode_attempts + 1
                status = db.execute(
                    guarded.values(
                        geocode_attempts=attempts,
                        geocode_status=case(
                            (attempts >= MAX_ATTEMPTS, "failed"), else_=Listing.geocode_status
                        ),
                    ).returning(Listing.geocode_status),
                    execution_options={"synchronize_session": False},
                ).scalar_one_or_none()
                db.commit()
                if status == "failed":
                    counts["failed"] += 1
                elif status is not None:
                    counts["retry"] += 1
                pause = BLOCKED_PAUSE_S if unavailable.stop_sweep else PAUSE_S
                redis.set(pause_key, 1, ex=pause)
                break
            if point is None:
                written = db.execute(
                    guarded.values(geocode_status="not_found").returning(Listing.id),
                    execution_options={"synchronize_session": False},
                ).scalar_one_or_none()
                db.commit()
                counts["not_found"] += int(written is not None)
                continue
            lng, lat = approximate_point(listing_id, point, secret)
            written = db.execute(
                guarded.values(
                    location=cast(
                        func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326),
                        Listing.location.type,
                    ),
                    geocode_status="ok",
                ).returning(Listing.id),
                execution_options={"synchronize_session": False},
            ).scalar_one_or_none()
            db.commit()
            counts["located"] += int(written is not None)
    except Exception:
        db.rollback()
        raise
    finally:
        redis.delete(lock_key)
    return counts
