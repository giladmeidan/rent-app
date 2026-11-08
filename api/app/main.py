"""FastAPI application factory."""

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from app.config import get_settings
from app.routers import areas, health
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
    app.include_router(health.router)
    app.include_router(areas.router)
    return app


app = create_app()
