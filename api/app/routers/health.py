"""GET /health — public, unauthenticated by design (no auth exists yet; no PII)."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.db import get_ping_engine
from app.schemas.health import HealthOut
from app.services.health import ping_db, ping_redis

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthOut,
    responses={503: {"model": HealthOut, "description": "A dependency ping failed"}},
)
def health() -> JSONResponse:
    db_ok = ping_db(get_ping_engine())
    redis_ok = ping_redis(get_settings().redis_url)
    body = HealthOut(
        status="ok" if db_ok and redis_ok else "degraded",
        db="ok" if db_ok else "error",
        redis="ok" if redis_ok else "error",
    )
    return JSONResponse(status_code=200 if body.status == "ok" else 503, content=body.model_dump())
