"""arq worker. Run with `arq app.worker.WorkerSettings`."""

import asyncio
import logging
from typing import Any

from arq import cron
from arq.connections import RedisSettings

from app.config import get_settings
from app.db import get_sessionmaker
from app.redis_client import get_redis
from app.services.cbs_rent import run_cbs_import
from app.services.geocoding import geocode_pending, get_geocoder
from app.services.listing_views import flush_views
from app.services.rent_reference import run_rent_import

log = logging.getLogger(__name__)

# At INFO, httpx logs every request URL, and a Nominatim URL holds the street and city.
logging.getLogger("httpx").setLevel(logging.WARNING)


async def ping(ctx: dict[str, Any]) -> str:
    """No-op task proving the worker loop runs."""
    return "pong"


def _sweep() -> dict[str, int]:
    with get_sessionmaker()() as db:
        return geocode_pending(
            db,
            get_redis(),
            get_geocoder(),
            secret=get_settings().secret_key.get_secret_value(),
        )


async def geocode_listings(ctx: dict[str, Any]) -> dict[str, int]:
    """One geocoding sweep (spec 0003c), off the event loop. Logs the counts only, never an
    address or a point."""
    counts = await asyncio.to_thread(_sweep)
    log.info("geocode sweep: %s", counts)
    return counts


async def import_rent_reference_job(ctx: dict[str, Any]) -> dict[str, int]:
    """The monthly import of the official rent figures (spec 0014a), off the event loop. With
    `RENT_REFERENCE=off` it makes no request and returns `{"skipped": 1}`."""
    return await asyncio.to_thread(run_rent_import)


def _flush_views() -> int:
    with get_sessionmaker()() as db:
        return flush_views(db, get_redis())


async def flush_listing_views(ctx: dict[str, Any]) -> int:
    """Add the listing-page views counted in Redis to `listings.view_count` (spec 0011e), off the
    event loop. Logs the number only."""
    added = await asyncio.to_thread(_flush_views)
    log.info("view flush: %d", added)
    return added


async def import_cbs_rent_job(ctx: dict[str, Any]) -> dict[str, int]:
    """The monthly import of the CBS small-flat rent figures (spec 0014d), off the event loop. With
    `CBS_RENT=off` it makes no request and returns `{"skipped": 1}`."""
    return await asyncio.to_thread(run_cbs_import)


class WorkerSettings:
    functions = [ping]
    cron_jobs = [
        cron(geocode_listings, second={0, 10, 20, 30, 40, 50}, unique=True),
        cron(flush_listing_views, second={30}, unique=True),
        # About 350 requests, 3-4 minutes: past arq's 300 s default timeout.
        cron(import_rent_reference_job, day=5, hour=3, minute=10, unique=True, timeout=1800),
        # At most six requests: arq's default timeout is enough.
        cron(import_cbs_rent_job, day=16, hour=3, minute=40, unique=True),
    ]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url.get_secret_value())
