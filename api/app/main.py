"""FastAPI application factory."""

import logging
import math
from typing import Any

import redis
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from app.config import get_settings
from app.routers import applications, areas, auth, chat, health, listings, search
from app.schemas.error import ErrorOut

log = logging.getLogger(__name__)


async def _database_unavailable(request: Request, exc: Exception) -> JSONResponse:
    """Postgres unreachable (connect refused or timed out): a JSON 503, not a text/plain 500."""
    # Driver error type and SQLSTATE only: str(exc) carries the SQL statement and driver detail.
    orig = getattr(exc, "orig", None)
    log.error(
        "database unavailable on %s %s: %s (sqlstate %s)",
        request.method,
        request.url.path,
        type(orig).__name__,
        getattr(orig, "sqlstate", None),
    )
    body = ErrorOut(detail="database unavailable")
    return JSONResponse(status_code=503, content=body.model_dump())


async def _redis_unavailable(request: Request, exc: Exception) -> JSONResponse:
    """Redis unreachable or timing out (OTP and rate-limit store): a JSON 503, not a 500."""
    log.error(
        "redis unavailable on %s %s: %s", request.method, request.url.path, type(exc).__name__
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
    non-finite numbers or lone surrogates in it would make the response itself fail (a 500)."""
    assert isinstance(exc, RequestValidationError)
    detail: list[dict[str, Any]] = []
    for error in exc.errors():
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
    app = FastAPI(title="Rent App API", version="0.0.1")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.web_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept-Language"],
    )
    app.add_exception_handler(RequestValidationError, _request_invalid)
    app.add_exception_handler(OperationalError, _database_unavailable)
    app.add_exception_handler(redis.exceptions.ConnectionError, _redis_unavailable)
    app.add_exception_handler(redis.exceptions.TimeoutError, _redis_unavailable)
    app.include_router(health.router)
    app.include_router(areas.router)
    app.include_router(auth.router)
    app.include_router(listings.router)
    app.include_router(search.router)
    app.include_router(applications.router)
    app.include_router(chat.router)
    return app


app = create_app()
