"""Sentry error reports for the API and the worker (spec 0019a). Off without `SENTRY_DSN`.

Nothing personal leaves the process: `scrub_event` keeps only the method and the route template of
a request, drops the user, `extra` and breadcrumb data, blanks database and validation exception
text, and redacts emails and calendar-feed tokens from every string left.
"""

import re
from typing import Any

import sentry_sdk
from sentry_sdk.integrations.arq import ArqIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import ignore_logger
from sentry_sdk.integrations.starlette import StarletteIntegration

from app.config import Settings
from app.services.tour_feed import redact_path

# Email-shaped: something@something.something, none of the parts holding a space or a delimiter.
_EMAIL = re.compile(r"[^\s@\"'<>()\[\]{},;:]+@[^\s@\"'<>()\[\]{},;:]+\.[^\s@\"'<>()\[\]{},;:]+")
# Their str() carries bound parameters, `DETAIL: Key (phone)=(…)` and `input_value=…`.
# FastAPI's ResponseValidationError (an unhandled 500) quotes the whole response as `input`.
_BLANKED_MODULES = ("sqlalchemy", "psycopg", "pydantic", "fastapi.exceptions")
_KEPT_CONTEXTS = {"runtime", "os", "trace"}
_KEPT_BREADCRUMB_FIELDS = {"type", "category", "level", "timestamp", "message"}
_OFF: Any = {"mode": "off"}
# sentry-sdk 2.75.0's replacement for the deprecated `send_default_pii=False`: collect none of it.
_DATA_COLLECTION: Any = {
    "user_info": False,
    "cookies": _OFF,
    "http_headers": {"request": _OFF},
    "http_bodies": [],
    "url_query_params": _OFF,
    "database_query_data": False,
    "queues": False,
    "stack_frame_variables": False,
}


def _redact(value: Any) -> Any:
    if isinstance(value, str):
        return redact_path(_EMAIL.sub("[email]", value))
    if isinstance(value, dict):
        return {key: _redact(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_redact(item) for item in value]
    return value


def scrub_event(event: Any, hint: Any) -> Any:
    """`before_send` and `before_send_transaction`. Returns the scrubbed event (never None)."""
    request = event.get("request")
    if request is not None:
        event["request"] = {"method": request.get("method"), "url": event.get("transaction")}
    event.pop("user", None)
    event.pop("extra", None)
    contexts = event.get("contexts")
    if isinstance(contexts, dict):
        event["contexts"] = {k: v for k, v in contexts.items() if k in _KEPT_CONTEXTS}
    breadcrumbs = event.get("breadcrumbs")
    crumbs = breadcrumbs.get("values") if isinstance(breadcrumbs, dict) else breadcrumbs
    if isinstance(crumbs, list):
        crumbs[:] = [
            {k: v for k, v in crumb.items() if k in _KEPT_BREADCRUMB_FIELDS} for crumb in crumbs
        ]
    for exc in (event.get("exception") or {}).get("values") or []:
        if str(exc.get("module") or "").startswith(_BLANKED_MODULES):
            exc["value"] = ""
    return _redact(event)


def init_sentry(settings: Settings, *, worker: bool) -> None:
    """Start the Sentry client once per process; a no-op without a DSN or when already running."""
    dsn = settings.sentry_dsn.get_secret_value() if settings.sentry_dsn else ""
    if not dsn or sentry_sdk.get_client().is_active():
        return
    # The SDK's default (500-599) would report the HTTPException(503)s we raise on purpose.
    web: dict[str, Any] = {"transaction_style": "url", "failed_request_status_codes": set[int]()}
    integrations: list[Any] = [StarletteIntegration(**web), FastApiIntegration(**web)]
    if worker:
        integrations.append(ArqIntegration())
    sentry_sdk.init(
        dsn=dsn,
        environment=settings.sentry_environment,
        release=settings.sentry_release or None,
        data_collection=_DATA_COLLECTION,
        include_local_variables=False,  # frames would carry emails, passwords, codes
        max_request_body_size="never",
        traces_sample_rate=settings.sentry_traces_sample_rate,
        before_send=scrub_event,
        before_send_transaction=scrub_event,
        integrations=integrations,
    )
    # The handled DB/Redis 503s and the /health pings log at ERROR: one event per request in an
    # outage, which uptime monitoring (not Sentry) is for.
    ignore_logger("app.main")
    ignore_logger("app.services.health")
    # Each line holds the peer IP and the path with its query.
    ignore_logger("uvicorn.access")
