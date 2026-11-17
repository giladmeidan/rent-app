"""Calendar feed endpoints (spec 0018d). Thin: all logic is in `services/tour_feed.py`.

`/me/tour-feed` (status, create or rotate, turn off) requires a session of any role
(`current_user`): 401 `unauthenticated`; the two writes count the shared `write` budget first.

`GET /tour-feed/{token}.ics` is public: a calendar app sends no cookie or header, so the handler
takes no user dependency and reads no cookie. It counts the per-network `read` budget (soft on a
Redis failure). A malformed token is a 404 before any SQL; every well-formed one is a 200 calendar,
empty when the token is dead (unknown, rotated, off, or a suspended or deleted owner)."""

import datetime as dt
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app import limits
from app.auth import current_user
from app.db import get_session
from app.models import User
from app.redis_client import RedisClient, get_redis
from app.schemas.error import ErrorOut
from app.schemas.tour_feed import TourFeedOut, TourFeedTokenOut
from app.services import tour_feed as tour_feed_service

router = APIRouter(tags=["tour-feed"])

DbDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[User, Depends(current_user)]
RedisDep = Annotated[RedisClient, Depends(get_redis)]

_UNAVAILABLE: dict[int | str, dict[str, Any]] = {
    503: {"model": ErrorOut, "description": "The database or Redis is unreachable"},
}
_SESSION: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorOut, "description": "unauthenticated"},
    **_UNAVAILABLE,
}


@router.get("/me/tour-feed", response_model=TourFeedOut, responses=_SESSION)
def feed_status(me: UserDep, db: DbDep) -> TourFeedOut:
    return TourFeedOut(active=tour_feed_service.feed_active(db, me))


@router.post(
    "/me/tour-feed",
    status_code=201,
    response_model=TourFeedTokenOut,
    responses={**_SESSION, **limits.RATE_LIMITED},
)
def create_feed(me: UserDep, db: DbDep, r: RedisDep, response: Response) -> TourFeedTokenOut:
    """Turn the calendar feed on, or rotate it (the old link stops working at once). The token is
    returned only here and can never be read again; the response is never cached."""
    limits.check(r, me.id, limits.WRITE)
    token = tour_feed_service.create_feed(db, me)
    response.headers["Cache-Control"] = "no-store"
    return TourFeedTokenOut(token=token)


@router.delete("/me/tour-feed", status_code=204, responses={**_SESSION, **limits.RATE_LIMITED})
def disable_feed(me: UserDep, db: DbDep, r: RedisDep) -> Response:
    """Turn the calendar feed off (204, also when it was off)."""
    limits.check(r, me.id, limits.WRITE)
    tour_feed_service.disable_feed(db, me)
    return Response(status_code=204)


@router.get(
    "/tour-feed/{token}.ics",
    response_class=Response,
    dependencies=[Depends(limits.read_limit)],
    responses={
        200: {"content": {"text/calendar": {}}, "description": "The calendar (maybe empty)"},
        404: {"model": ErrorOut, "description": "not_found: a malformed token"},
        **limits.RATE_LIMITED,
        **_UNAVAILABLE,
    },
)
def feed(token: str, db: DbDep) -> Response:
    """The account's booked tours as an iCalendar feed (public; the token is the credential)."""
    body = tour_feed_service.feed_for_token(db, token, dt.datetime.now(dt.UTC))
    if body is None:
        raise HTTPException(status_code=404, detail="not_found")
    return Response(
        content=body,
        media_type="text/calendar",
        headers={
            "Cache-Control": "private, max-age=300",
            "Content-Disposition": 'inline; filename="homie-tours.ics"',
        },
    )
