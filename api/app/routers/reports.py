"""Report endpoint (spec 0011b). Thin: all logic is in `services/reports.py`.

`POST /reports` requires a session of any role (`current_user`): 401 `unauthenticated` without
one. The target must be visible to the caller where it was seen and not the caller's own; anything
else is one 404 `not_found`. 201 `{already_reported: false}` when stored, 200
`{already_reported: true}` on a repeat (nothing changed). Rate limited per user (10 an hour, 30 a
day; a 429 with `Retry-After`), every attempt counted. No response echoes the note."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.auth import current_user
from app.db import get_session
from app.models import User
from app.redis_client import RedisClient, get_redis
from app.routers.applications import _SESSION
from app.routers.market_people import _RATE_LIMITED, _rate_limited
from app.schemas.error import ErrorOut
from app.schemas.report import ReportIn, ReportOut
from app.services import reports as reports_service
from app.services.rate_limit import RateLimitedError

router = APIRouter(tags=["reports"])

DbDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[User, Depends(current_user)]
RedisDep = Annotated[RedisClient, Depends(get_redis)]


@router.post(
    "/reports",
    status_code=201,
    response_model=ReportOut,
    responses={
        **_SESSION,
        200: {"model": ReportOut, "description": "already reported: nothing changed"},
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown target, not visible to the caller, or the "
            "caller's own",
        },
        **_RATE_LIMITED,
    },
)
def create_report(
    body: ReportIn, response: Response, user: UserDep, db: DbDep, r: RedisDep
) -> ReportOut:
    try:
        stored = reports_service.report(db, r, user, body)
    except RateLimitedError as exc:
        raise _rate_limited(exc) from None
    except reports_service.NotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    if not stored:
        response.status_code = 200
    return ReportOut(already_reported=not stored)
