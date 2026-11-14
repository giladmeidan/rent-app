"""People browse and invites endpoints (spec 0008a, 0010l). Thin: all logic is in
`services/people.py` (and `services/search.py::liked_rooms`).

Every endpoint requires a session of any role (`current_user`, spec 0010b): 401 `unauthenticated`
without one. There are no roles in the market: the services' ownership checks decide.

Lister side: the three `/listings/{listing_id}/people...` endpoints act on the caller's own room
listing: unknown, another account's and an apartment are one 404 `not_found`; a paused, expired or
inactive-area one is a 409 `listing_not_live` (browse and like; an unlike works whatever the
state). A person is the pair's id, never a user id.

Invited side: `GET /me/likes` lists the rooms whose lister invited the caller and that they have
not applied to. A seeker has no room-like (spec 0010l): on a room they apply.

Browsing a room's people shares one browse rate limit per user with `GET /people` (spec 0010h,
`market_people.BROWSE_RATE_LIMIT_HOUR` / `_DAY`; a 429 with `Retry-After`), counted before the
listing gate, so every attempt counts.

The lister's like shares one rate limit per user with person likes (`LIKE_RATE_LIMIT_HOUR` /
`_DAY`, a 429 with `Retry-After`), counted only once the listing gate passed. It is an invite
(spec 0010l): it never creates an application and notifies no one; the seeker's application
answers it (`routers/applications.py` publishes that chat event). The unlike counts the shared
`write` budget (spec 0011c, `app/limits.py`)."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import Row
from sqlalchemy.orm import Session

from app import limits
from app.auth import current_user
from app.db import get_session
from app.matching.score import explain_row
from app.models import User
from app.redis_client import RedisClient, get_redis
from app.routers.applications import _SESSION
from app.schemas.error import ErrorOut
from app.schemas.people import (
    LikedRoomOut,
    LikeOut,
    MyLikesOut,
    PeoplePageOut,
    PeopleParams,
    PersonOut,
)
from app.schemas.search import ListingPublic
from app.services import market_people as market_people_service
from app.services import people as people_service
from app.services import photos as photos_service
from app.services import profiles as profiles_service
from app.services import search as search_service
from app.services.applications import AlreadyAppliedError
from app.services.listings import ListingNotFoundError
from app.services.rate_limit import RateLimitedError

router = APIRouter(tags=["people"])

DbDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[User, Depends(current_user)]
RedisDep = Annotated[RedisClient, Depends(get_redis)]

_OWN_ROOM_404: dict[int | str, dict[str, Any]] = {
    404: {
        "model": ErrorOut,
        "description": "not_found: unknown id, another account's listing, or an apartment",
    },
}
_RATE_LIMITED: dict[int | str, dict[str, Any]] = {
    429: {"model": ErrorOut, "description": "rate_limited; see Retry-After"},
}


def _rate_limited(exc: RateLimitedError) -> HTTPException:
    return HTTPException(
        status_code=429, detail="rate_limited", headers={"Retry-After": str(exc.retry_after)}
    )


def _person_out(row: Row[Any]) -> PersonOut:
    return PersonOut(
        id=row.id,
        display_name=row.display_name,
        photo_url=photos_service.person_photo_url(row.photo_key),
        gender=row.gender,
        age=people_service.age(row.birth_year),
        area_ids=row.area_ids,
        move_in_date=row.move_in_date,
        move_in_flexible=row.move_in_flexible,
        lifestyle=row.lifestyle,
        about_me=row.about_me,
        match=explain_row(row),
        liked_by_me=row.lister_liked_at is not None,
    )


@router.get(
    "/listings/{listing_id}/people",
    response_model=PeoplePageOut,
    responses={
        **_SESSION,
        **_OWN_ROOM_404,
        409: {
            "model": ErrorOut,
            "description": "listing_not_live: paused, expired, or its area inactive",
        },
        **_RATE_LIMITED,
    },
)
def list_people(
    listing_id: uuid.UUID,
    params: Annotated[PeopleParams, Query()],
    user: UserDep,
    db: DbDep,
    r: RedisDep,
) -> PeoplePageOut:
    # Spec 0010h: one browse counter for both people surfaces, counted before anything else.
    try:
        market_people_service.count_browse(r, user)
    except RateLimitedError as exc:
        raise _rate_limited(exc) from None
    try:
        rows, total = people_service.list_people(db, user, listing_id, params.offset)
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except people_service.ListingNotLiveError:
        raise HTTPException(status_code=409, detail="listing_not_live") from None
    return PeoplePageOut(items=[_person_out(row) for row in rows], total=total)


@router.put(
    "/listings/{listing_id}/people/{person_id}/like",
    response_model=LikeOut,
    responses={
        **_SESSION,
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown listing or person, another account's listing, an "
            "apartment, a person of another listing, or one who is not a candidate any more",
        },
        409: {
            "model": ErrorOut,
            "description": "listing_not_live; already_applied: the seeker has a non-withdrawn "
            "application to the listing",
        },
        **_RATE_LIMITED,
    },
)
def like_person(
    listing_id: uuid.UUID,
    person_id: uuid.UUID,
    user: UserDep,
    db: DbDep,
    r: RedisDep,
) -> LikeOut:
    try:
        people_service.like_person(db, r, user, listing_id, person_id)
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except people_service.ListingNotLiveError:
        raise HTTPException(status_code=409, detail="listing_not_live") from None
    except RateLimitedError as exc:
        raise _rate_limited(exc) from None
    except AlreadyAppliedError:
        raise HTTPException(status_code=409, detail="already_applied") from None
    return LikeOut(liked=True)


@router.delete(
    "/listings/{listing_id}/people/{person_id}/like",
    status_code=204,
    responses={
        **_SESSION,
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown person, or one of another listing or account",
        },
        **limits.RATE_LIMITED,
    },
)
def unlike_person(
    listing_id: uuid.UUID, person_id: uuid.UUID, user: UserDep, db: DbDep, r: RedisDep
) -> Response:
    limits.check(r, user.id, limits.WRITE)
    try:
        people_service.unlike_person(db, user, listing_id, person_id)
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    return Response(status_code=204)


@router.get("/me/likes", response_model=MyLikesOut, responses=_SESSION)
def my_likes(user: UserDep, db: DbDep) -> MyLikesOut:
    liked_me: list[LikedRoomOut] = []
    # Decision 13 (`profiles_service.sees_room_privacy`): the seeker role, or the looking part.
    # `liked_rooms` returns nothing without the looking part (spec 0010c), so a caller with rows
    # has it; asked anyway, so the rule lives in one place.
    seeker = profiles_service.sees_room_privacy(user, profiles_service.profile_user_id(db, user))
    for (
        listing,
        match,
        lister_liked_at,
        cover_id,
        cover_key,
    ) in search_service.liked_rooms(db, user.id):
        # Never the caller's own room (`liked_rooms` excludes it), so `is_mine` is false.
        room = ListingPublic.from_listing(
            listing,
            seeker=seeker,
            match=match,
            cover=photos_service.cover_out(cover_id, cover_key),
            is_mine=False,
        )
        liked_me.append(LikedRoomOut(listing=room, liked_at=lister_liked_at))
    return MyLikesOut(liked_me=liked_me)
