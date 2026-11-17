"""FastAPI application factory."""

import logging
import math
import mimetypes
import re
from typing import Any

import redis
from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import OperationalError
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import get_settings
from app.observability import init_sentry
from app.routers import (
    applications,
    areas,
    auth,
    chat,
    events,
    flatmates,
    health,
    listings,
    market_people,
    people,
    photos,
    profiles,
    rent_estimate,
    reports,
    search,
    tour_feed,
    tours,
)
from app.schemas.error import ErrorOut
from app.services.accounts import AccountDeletedError
from app.services.tour_feed import RedactFeedToken, redact_path

log = logging.getLogger(__name__)

# The slim image's `mimetypes` may not know WebP; `/media` must serve `image/webp` (spec 0010d).
mimetypes.add_type("image/webp", ".webp")

# Spec 0011c: bodies over 64 KB are refused before parsing (~5x the largest real body). The two
# photo uploads keep their own 8 MB cap (`routers/photos.py::read_capped`).
MAX_BODY_BYTES = 65_536
MAX_VALIDATION_ERRORS = 50
_LISTING_PHOTO_UPLOAD = re.compile(r"^/listings/[^/]+/photos$")


def _is_upload(scope: Scope) -> bool:
    method, path = scope["method"], scope["path"]
    return (method == "POST" and bool(_LISTING_PHOTO_UPLOAD.match(path))) or (
        method == "PUT" and path == "/me/photo"
    )


class BodySizeLimit:
    """413 `body_too_large` for a request body over `MAX_BODY_BYTES`. Pure ASGI, not
    `BaseHTTPMiddleware`, so the SSE stream is never buffered. A declared `Content-Length` over the
    cap is refused without calling the app; a chunked body raises once its running total passes
    the cap (FastAPI re-raises an `HTTPException` from the body read, so its handler answers)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or _is_upload(scope):
            await self.app(scope, receive, send)
            return
        length = Headers(scope=scope).get("content-length", "")
        if length.isascii() and length.isdigit() and int(length) > MAX_BODY_BYTES:
            response = JSONResponse(status_code=413, content={"detail": "body_too_large"})
            await response(scope, receive, send)
            return
        if scope["method"] in ("GET", "HEAD"):
            # No GET/HEAD route reads a body, and SSE's disconnect listener reads `receive`.
            await self.app(scope, receive, send)
            return
        total = 0

        async def capped_receive() -> Message:
            nonlocal total
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > MAX_BODY_BYTES:
                    raise HTTPException(status_code=413, detail="body_too_large")
            return message

        await self.app(scope, capped_receive, send)


async def _account_deleted(request: Request, exc: Exception) -> JSONResponse:
    """A write whose account was deleted while it ran (spec 0013c): as a session that no longer
    resolves."""
    return JSONResponse(status_code=401, content={"detail": "unauthenticated"})


async def _database_unavailable(request: Request, exc: Exception) -> JSONResponse:
    """Postgres unreachable (connect refused or timed out): a JSON 503, not a text/plain 500."""
    # Driver error type and SQLSTATE only: str(exc) carries the SQL statement and driver detail.
    orig = getattr(exc, "orig", None)
    log.error(
        "database unavailable on %s %s: %s (sqlstate %s)",
        request.method,
        redact_path(request.url.path),  # a feed token sits in its path (spec 0018d)
        type(orig).__name__,
        getattr(orig, "sqlstate", None),
    )
    body = ErrorOut(detail="database unavailable")
    return JSONResponse(status_code=503, content=body.model_dump())


async def _redis_unavailable(request: Request, exc: Exception) -> JSONResponse:
    """Redis unreachable or timing out (OTP and rate-limit store): a JSON 503, not a 500."""
    log.error(
        "redis unavailable on %s %s: %s",
        request.method,
        redact_path(request.url.path),
        type(exc).__name__,
    )
    body = ErrorOut(detail="redis unavailable")
    return JSONResponse(status_code=503, content=body.model_dump())


def _json_safe(value: Any) -> bool:
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, dict):
        return all(_json_safe(v) for v in value.values())
    if isinstance(value, list):
        return all(_json_safe(v) for v in value)
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            return False
    return True


async def _request_invalid(request: Request, exc: Exception) -> JSONResponse:
    """422 with `type`, `loc`, `msg` (and a JSON-safe `ctx`); never `input`: it may be PII, and
    non-finite numbers or lone surrogates in it would make the response itself fail (a 500). At
    most the first `MAX_VALIDATION_ERRORS` entries (spec 0011c)."""
    assert isinstance(exc, RequestValidationError)
    detail: list[dict[str, Any]] = []
    for error in exc.errors()[:MAX_VALIDATION_ERRORS]:
        entry: dict[str, Any] = {
            "type": str(error.get("type", "")),
            "loc": [p if isinstance(p, int) else str(p) for p in error.get("loc", ())],
            "msg": str(error.get("msg", "")),
        }
        if "ctx" in error:
            try:
                ctx = jsonable_encoder(error["ctx"])
            except Exception:
                ctx = None
            if ctx is not None and _json_safe(ctx):
                entry["ctx"] = ctx
        detail.append(entry)
    return JSONResponse(status_code=422, content={"detail": detail})


def create_app() -> FastAPI:
    settings = get_settings()
    # Before the app is built, so Sentry's integrations patch Starlette first (spec 0019a).
    init_sentry(settings, worker=False)
    # The calendar feed's token sits in its path (spec 0018d); once per process, not per app.
    access_log = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, RedactFeedToken) for f in access_log.filters):
        access_log.addFilter(RedactFeedToken())
    app = FastAPI(title="Rent App API", version="0.0.1")
    # Added before CORS: the last added is outermost, so the 413 carries the CORS headers.
    app.add_middleware(BodySizeLimit)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.web_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept-Language"],
        expose_headers=["Retry-After"],
    )
    app.add_exception_handler(RequestValidationError, _request_invalid)
    app.add_exception_handler(OperationalError, _database_unavailable)
    app.add_exception_handler(AccountDeletedError, _account_deleted)
    app.add_exception_handler(redis.exceptions.ConnectionError, _redis_unavailable)
    app.add_exception_handler(redis.exceptions.TimeoutError, _redis_unavailable)
    # a full noeviction Redis refuses writes with OutOfMemoryError (a ResponseError; redis-py
    # has it, its type stubs do not)
    oom = redis.exceptions.OutOfMemoryError  # type: ignore[attr-defined]
    app.add_exception_handler(oom, _redis_unavailable)
    app.include_router(health.router)
    app.include_router(areas.router)
    app.include_router(auth.router)
    app.include_router(listings.router)
    app.include_router(search.router)
    app.include_router(applications.router)
    app.include_router(chat.router)
    app.include_router(events.router)
    app.include_router(profiles.router)
    app.include_router(people.router)
    app.include_router(market_people.router)
    app.include_router(flatmates.router)
    app.include_router(photos.router)
    app.include_router(rent_estimate.router)
    app.include_router(reports.router)
    app.include_router(tours.router)
    app.include_router(tour_feed.router)
    if settings.photo_backend == "file":
        # Dev, CI and e2e: the api serves the file photo store itself (spec 0010d). Created first:
        # `StaticFiles` refuses a missing directory. With `r2` nothing is mounted.
        settings.photo_dir.mkdir(parents=True, exist_ok=True)
        app.mount("/media", StaticFiles(directory=settings.photo_dir), name="media")
    return app


app = create_app()
