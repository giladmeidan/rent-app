"""arq worker. Run with `arq app.worker.WorkerSettings`."""

import asyncio
import logging
from typing import Any

from arq import cron
from arq.connections import RedisSettings

from app import analytics
from app.config import get_settings
from app.db import get_sessionmaker
from app.observability import init_sentry
from app.redis_client import get_redis
from app.services.cbs_rent import run_cbs_import
from app.services.email import get_email_sender
from app.services.geocoding import geocode_pending, get_geocoder
from app.services.listing_views import flush_views
from app.services.rent_reference import run_rent_import
from app.services.retention import purge_expired
from app.services.tour_mail import queue_reminders, send_pending

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
    if any(counts.values()):  # every 10 s: a line only when something happened
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


def _purge() -> dict[str, int]:
    with get_sessionmaker()() as db:
        return purge_expired(db)


async def purge_expired_job(ctx: dict[str, Any]) -> dict[str, int]:
    """The nightly retention purge (spec 0013h), off the event loop. Logs the counts only, never
    an id or a value."""
    counts = await asyncio.to_thread(_purge)
    log.info("retention purge: %s", counts)
    return counts


def _send_tour_mail() -> dict[str, int]:
    with get_sessionmaker()() as db:
        return send_pending(db, get_redis(), get_email_sender())


async def send_tour_mail_job(ctx: dict[str, Any]) -> dict[str, int]:
    """Send the queued tour emails (spec 0018c), off the event loop. Logs the counts only, never
    an address, a name or an id."""
    counts = await asyncio.to_thread(_send_tour_mail)
    if any(counts.values()):  # every 10 s: a line only when something happened
        log.info("tour mail: %s", counts)
    return counts


def _queue_tour_reminders() -> int:
    with get_sessionmaker()() as db:
        return queue_reminders(db, get_redis())


async def tour_reminders_job(ctx: dict[str, Any]) -> int:
    """Queue the day-before tour reminders (spec 0018c), off the event loop. Logs the number
    only."""
    queued = await asyncio.to_thread(_queue_tour_reminders)
    if queued:
        log.info("tour reminders: %d", queued)
    return queued


async def posthog_forget_job(ctx: dict[str, Any]) -> int:
    """Delete the accounts deleted in the last 7 days from PostHog (spec 0019b), off the event
    loop. A failed request fails the job (Sentry's arq integration reports it). Logs the number
    only."""
    sent = await asyncio.to_thread(analytics.forget_deleted_users)
    log.info("posthog forget: %d", sent)
    return sent


async def on_startup(ctx: dict[str, Any]) -> None:
    """Show the `app` loggers' INFO lines (spec 0013g). arq's CLI configures only its own logger
    and leaves the root at WARNING, so `view flush` and `geocode sweep` would never be written.
    Runs after arq's `dictConfig`, whatever launches the worker."""
    app_log = logging.getLogger("app")
    app_log.setLevel(logging.INFO)
    if not any(getattr(h, "_homie_worker", False) for h in app_log.handlers):
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s: %(levelname)s %(name)s: %(message)s"))
        handler._homie_worker = True  # type: ignore[attr-defined]
        app_log.addHandler(handler)
    logging.getLogger("httpx").setLevel(logging.WARNING)


async def on_shutdown(ctx: dict[str, Any]) -> None:
    analytics.shutdown()  # flush the queued PostHog events (spec 0019b)


# At import, not in `on_startup`: Sentry's arq integration wraps the jobs inside `create_worker`,
# which arq calls before `on_startup` (spec 0019a).
init_sentry(get_settings(), worker=True)


class WorkerSettings:
    on_startup = on_startup
    on_shutdown = on_shutdown
    functions = [ping]
    cron_jobs = [
        cron(geocode_listings, second={0, 10, 20, 30, 40, 50}, unique=True),
        cron(flush_listing_views, second={30}, unique=True),
        # Spec 0021c: a first national run is ~1,300 settlement requests plus the big and mid-size
        # cities' neighbourhoods, 2,500-4,000 requests x ~5.3 s (Crawl-delay 5) = 4-6 h; a month
        # with an unchanged source version costs 1 request plus the missing settlements' 404s. An
        # interrupted run resumes at the next run.
        cron(import_rent_reference_job, day=5, hour=3, minute=10, unique=True, timeout=28800),
        # At most six requests: arq's default timeout is enough.
        cron(import_cbs_rent_job, day=16, hour=3, minute=40, unique=True),
        cron(purge_expired_job, hour=3, minute=25, unique=True),
        cron(posthog_forget_job, hour=3, minute=55, unique=True),
        # Off the geocode sweep's seconds.
        cron(send_tour_mail_job, second={5, 15, 25, 35, 45, 55}, unique=True),
        cron(tour_reminders_job, minute={0, 15, 30, 45}, unique=True),
    ]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url.get_secret_value())
