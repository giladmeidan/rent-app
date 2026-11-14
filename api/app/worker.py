"""arq worker. Run with `arq app.worker.WorkerSettings`."""

import asyncio
import logging
from typing import Any

from arq import cron
from arq.connections import RedisSettings

from app.config import get_settings
from app.db import get_sessionmaker
from app.redis_client import get_redis
from app.services.geocoding import geocode_pending, get_geocoder
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


class WorkerSettings:
    functions = [ping]
    cron_jobs = [
        cron(geocode_listings, second={0, 10, 20, 30, 40, 50}, unique=True),
        # About 350 requests, 3-4 minutes: past arq's 300 s default timeout.
        cron(import_rent_reference_job, day=5, hour=3, minute=10, unique=True, timeout=1800),
    ]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url.get_secret_value())
