"""FastAPI application factory."""

import logging

import redis
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from app.config import get_settings
from app.routers import areas, auth, health, listings
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
    app.add_exception_handler(OperationalError, _database_unavailable)
    app.add_exception_handler(redis.exceptions.ConnectionError, _redis_unavailable)
    app.add_exception_handler(redis.exceptions.TimeoutError, _redis_unavailable)
    app.include_router(health.router)
    app.include_router(areas.router)
    app.include_router(auth.router)
    app.include_router(listings.router)
    return app


app = create_app()
