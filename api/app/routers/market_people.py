"""People browse endpoints of שוק השותפים (spec 0010h). Thin: all logic is in
`services/market_people.py`.

Every endpoint requires a session of any role (`current_user`): 401 `unauthenticated` without one.

- `GET /people` and `GET /me/people-likes` need the caller's own **visible card** (a live room is
  not enough, spec 0010m): 403 `card_required` without it. Both are rate limited per user by the
  browse limit (`BROWSE_RATE_LIMIT_HOUR` / `_DAY`, shared with the room side's
  `GET /listings/{id}/people`; `GET /me/people-likes` since spec 0011c; a 429 with
  `Retry-After`), and every attempt counts, a 403 included.
- `PUT /people/{card_id}/like` needs the caller's own **visible card** (403 `card_required`). An
  unknown card, the caller's own and one that is not a candidate
  for the caller are one 404 `not_found`. It shares the like limit with room likes
  (`rl:like:user:*`), and every attempt counts. A like that makes the pair mutual opens the direct
  chat and returns its id; a `status` chat event goes to both.
- `DELETE /people/{card_id}/like` is a 204 also for an unknown card (it reveals nothing), and a
  409 `mutual_match` on a match (remove it instead).
- `DELETE /me/matches/{conversation_id}` removes a match: 204, also when already removed; an
  unknown id, an application chat and a chat the caller is not in are one 404 `not_found`.
- Both DELETEs count the shared `write` budget (spec 0011c, `app/limits.py`), every attempt.

A person is their `card_id`, never their user id; a chat is its `conversation_id`. Neither
reveals an account in a URL."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import Row
from sqlalchemy.orm import Session

from app import limits
from app.auth import current_user
from app.client_ip import client_network
from app.db import get_session
from app.models import User
from app.redis_client import RedisClient, get_redis
from app.routers.applications import _SESSION
from app.schemas.error import ErrorOut
from app.schemas.market_people import (
    MyPeopleLikesOut,
    PeopleBrowseOut,
    PeopleBrowseParams,
    PersonCardOut,
    PersonLikeOut,
    PersonMatchOut,
)
from app.services import market_people as market_service
from app.services import people as people_service
from app.services import photos as photos_service
from app.services.rate_limit import RateLimitedError

router = APIRouter(tags=["market-people"])

DbDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[User, Depends(current_user)]
RedisDep = Annotated[RedisClient, Depends(get_redis)]

_CARD_REQUIRED: dict[int | str, dict[str, Any]] = {
    403: {
        "model": ErrorOut,
        "description": "card_required: the caller shows no card",
    },
}
_RATE_LIMITED: dict[int | str, dict[str, Any]] = {
    429: {"model": ErrorOut, "description": "rate_limited; see Retry-After"},
}


def _rate_limited(exc: RateLimitedError) -> HTTPException:
    return HTTPException(
        status_code=429, detail="rate_limited", headers={"Retry-After": str(exc.retry_after)}
    )


def _card_required() -> HTTPException:
    return HTTPException(status_code=403, detail="card_required")


def _card_out(row: Row[Any]) -> PersonCardOut:
    return PersonCardOut(
        card_id=row.card_id,
        display_name=row.display_name,
        gender=row.gender,
        age=people_service.age(row.birth_year),
        area_ids=row.area_ids,
        move_in_date=row.move_in_date,
        move_in_flexible=row.move_in_flexible,
        lifestyle=row.lifestyle,
        about_me=row.about_me,
        photo_url=photos_service.person_photo_url(row.photo_key),
        liked_by_me=row.liked_by_me,
        liked_me=row.liked_me,
    )


@router.get(
    "/people",
    response_model=PeopleBrowseOut,
    responses={**_SESSION, **_CARD_REQUIRED, **_RATE_LIMITED},
)
def browse_people(
    params: Annotated[PeopleBrowseParams, Query()],
    request: Request,
    user: UserDep,
    db: DbDep,
    r: RedisDep,
) -> PeopleBrowseOut:
    try:
        rows, total = market_service.browse(db, r, user, params.offset, client_network(request))
    except RateLimitedError as exc:
        raise _rate_limited(exc) from None
    except market_service.CardRequiredError:
        raise _card_required() from None
    return PeopleBrowseOut(items=[_card_out(row) for row in rows], total=total)


@router.put(
    "/people/{card_id}/like",
    response_model=PersonLikeOut,
    responses={
        **_SESSION,
        403: {"model": ErrorOut, "description": "card_required: the caller shows no card"},
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown card, the caller's own, or not a candidate for "
            "the caller (hidden, a gender misfit, already a match)",
        },
        **_RATE_LIMITED,
    },
)
def like_person(card_id: uuid.UUID, user: UserDep, db: DbDep, r: RedisDep) -> PersonLikeOut:
    try:
        conversation_id = market_service.like(db, r, user, card_id)
    except RateLimitedError as exc:
        raise _rate_limited(exc) from None
    except market_service.CardRequiredError:
        raise _card_required() from None
    except market_service.NotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    return PersonLikeOut(liked=True, conversation_id=conversation_id)


@router.delete(
    "/people/{card_id}/like",
    status_code=204,
    responses={
        **_SESSION,
        409: {
            "model": ErrorOut,
            "description": "mutual_match: the pair is a match; remove it with "
            "DELETE /me/matches/{conversation_id}",
        },
        **limits.RATE_LIMITED,
    },
)
def unlike_person(card_id: uuid.UUID, user: UserDep, db: DbDep, r: RedisDep) -> Response:
    limits.check(r, user.id, limits.WRITE)
    try:
        market_service.unlike(db, user, card_id)
    except market_service.MutualMatchError:
        raise HTTPException(status_code=409, detail="mutual_match") from None
    return Response(status_code=204)


@router.delete(
    "/me/matches/{conversation_id}",
    status_code=204,
    responses={
        **_SESSION,
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown id, an application chat, or not the caller's",
        },
        **limits.RATE_LIMITED,
    },
)
def remove_match(conversation_id: uuid.UUID, user: UserDep, db: DbDep, r: RedisDep) -> Response:
    limits.check(r, user.id, limits.WRITE)
    try:
        market_service.remove_match(db, r, user, conversation_id)
    except market_service.NotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    return Response(status_code=204)


@router.get(
    "/me/people-likes",
    response_model=MyPeopleLikesOut,
    responses={**_SESSION, **_CARD_REQUIRED, **_RATE_LIMITED},
)
def my_people_likes(request: Request, user: UserDep, db: DbDep, r: RedisDep) -> MyPeopleLikesOut:
    try:
        rows = market_service.my_people_likes(db, r, user, client_network(request))
    except RateLimitedError as exc:
        raise _rate_limited(exc) from None
    except market_service.CardRequiredError:
        raise _card_required() from None
    out = MyPeopleLikesOut(liked_me=[], mine=[], matches=[])
    for row in rows:
        if row.kind == "match":
            if row.conversation_id is None:  # never: a mutual like opens the chat with it
                continue
            out.matches.append(
                PersonMatchOut(
                    conversation_id=row.conversation_id,
                    display_name=row.display_name,
                    photo_url=photos_service.person_photo_url(row.photo_key),
                    matched_at=row.at,
                )
            )
        elif row.kind == "liked_me":
            out.liked_me.append(_card_out(row))
        else:
            out.mine.append(_card_out(row))
    return out
