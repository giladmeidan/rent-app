"""PostHog usage analytics (spec 0019b): the funnel's business events, keyed by the user's UUID and
never carrying personal data, and the daily job that deletes deleted accounts from PostHog.

`track` is a no-op without `POSTHOG_KEY` (no client is ever built). With one, the SDK's own consumer
thread sends in the background: a request never waits on PostHog, and PostHog down never fails a
request. Each call site runs after its write's `db.commit()`, so a rolled-back write sends nothing.
Nothing here logs an id, a property or a batch."""

import datetime as dt
import logging
import threading
import uuid
from collections.abc import Mapping
from typing import Literal

import httpx
from posthog import Posthog
from sqlalchemy import func, select

from app.config import get_settings
from app.db import get_sessionmaker
from app.models import User

log = logging.getLogger(__name__)

# The SDK logs an upload failure at ERROR, which 0019a's logging integration would turn into a
# Sentry event; `_log_failure` writes our own WARNING instead.
logging.getLogger("posthog").setLevel(logging.CRITICAL)

Event = Literal[
    "signed_up",
    "logged_in",
    "listing_published",
    "application_sent",
    "application_shortlisted",
    "tour_booked",
    "account_deleted",
]
Property = str | int | bool

# Anything not listed for its event is dropped before sending.
ALLOWED: dict[Event, frozenset[str]] = {
    "signed_up": frozenset({"role", "method"}),
    "logged_in": frozenset({"method"}),
    "listing_published": frozenset({"listing_type", "area_id"}),
    "application_sent": frozenset({"listing_type"}),
    "application_shortlisted": frozenset({"listing_type", "source"}),
    "tour_booked": frozenset({"listing_type"}),
    "account_deleted": frozenset(),
}

FORGET_WINDOW = dt.timedelta(days=7)
FORGET_BATCH = 1000  # PostHog's bulk_delete limit

_client: Posthog | None = None
_lock = threading.Lock()


def _log_failure(exc: Exception, batch: object) -> None:
    log.warning("posthog upload failed: %s", type(exc).__name__)


def _get_client() -> Posthog | None:
    global _client
    with _lock:
        if _client is None:
            settings = get_settings()
            if not settings.posthog_key:
                return None
            _client = Posthog(
                settings.posthog_key,
                host=settings.posthog_host,
                disable_geoip=True,
                on_error=_log_failure,
                max_retries=3,
                timeout=5,
            )
        return _client


def track(
    user_id: uuid.UUID | None, event: Event, properties: Mapping[str, Property] | None = None
) -> None:
    """Capture `event` for `user_id`, or personless with `None`. Never raises."""
    try:
        client = _get_client()
        if client is None:
            return
        allowed = ALLOWED[event]
        props = {k: v for k, v in (properties or {}).items() if k in allowed}
        if user_id is None:
            # No distinct_id: the SDK generates one and creates no person.
            client.capture(event, properties=props)
        else:
            client.capture(event, distinct_id=str(user_id), properties=props)
    except Exception as exc:
        log.warning("posthog capture failed: %s", type(exc).__name__)


def shutdown() -> None:
    """Flush and stop the client; the next `track` builds a fresh one (pytest builds many apps)."""
    global _client
    with _lock:
        client, _client = _client, None
    if client is not None:
        client.shutdown()


def set_client(client: Posthog | None) -> None:
    """Test hook: install a fake client, or `None` to reset."""
    global _client
    with _lock:
        _client = client


def forget_deleted_users() -> int:
    """Delete from PostHog the persons and events of the accounts deleted in the last
    `FORGET_WINDOW` (spec 0019b), daily: a second delete of an id is harmless, so the window is a
    week of retries. Returns the number of ids sent. A non-2xx answer raises, so the job fails and
    is reported to Sentry."""
    settings = get_settings()
    key = settings.posthog_personal_api_key
    if not key or not settings.posthog_project_id:  # compose passes unset ones as ""
        log.info("posthog forget: off (no personal key or project id)")
        return 0
    with get_sessionmaker()() as db:
        ids = [
            str(i)
            for i in db.scalars(
                select(User.id).where(User.deleted_at >= func.now() - FORGET_WINDOW)
            )
        ]
    url = (
        f"{settings.posthog_api_host.rstrip('/')}/api/projects/"
        f"{settings.posthog_project_id}/persons/bulk_delete/"
    )
    headers = {"Authorization": f"Bearer {key.get_secret_value()}"}
    with httpx.Client(timeout=30) as client:
        for start in range(0, len(ids), FORGET_BATCH):
            response = client.post(
                url,
                headers=headers,
                json={"distinct_ids": ids[start : start + FORGET_BATCH], "delete_events": True},
            )
            response.raise_for_status()
            errors = response.json().get("deletion_errors") if response.content else None
            if errors:
                log.warning("posthog forget: %d deletion errors", len(errors))
    return len(ids)
