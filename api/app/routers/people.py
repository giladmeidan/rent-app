"""People browse and likes endpoints (spec 0008a). Thin: all logic is in `services/people.py` (and
`services/search.py::liked_rooms`).

Lister side: the three `/listings/{listing_id}/people...` endpoints require an **owner** session
(`current_owner`): 401 `unauthenticated`, 403 `owner_only` for a seeker. `listing_id` must be the
caller's own room listing: unknown, another owner's and an apartment are one 404 `not_found`; a
paused, expired or inactive-area one is a 409 `listing_not_live` (browse and like; an unlike works
whatever the state). A person is the pair's id, never a user id.

Seeker side: `PUT` / `DELETE /listings/{listing_id}/like` and `GET /me/likes` require a **seeker**
session (`current_seeker`): 401, 403 `seeker_only`. The `DELETE` is always a 204, so it reveals
nothing about the listing.

Both like `PUT`s share one rate limit per user (`LIKE_RATE_LIMIT_HOUR` / `_DAY`, a 429 with
`Retry-After`), counted only once the listing gate passed. A like that makes the pair mutual
returns the new shortlisted application's id (also its chat's) and, after the commit, publishes a
`status` chat event to the chat's members, the room's flatmates included (spec 0005c, 0008d), as a
shortlist does. A plain like notifies no one."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import Row
from sqlalchemy.orm import Session

from app.auth import current_owner, current_seeker
from app.db import get_session
from app.matching.score import explain_row
from app.models import User
from app.redis_client import RedisClient, get_redis
from app.routers.applications import _OWNER_ONLY, _SEEKER_ONLY
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
from app.services import chat as chat_service
from app.services import chat_events
from app.services import people as people_service
from app.services import photos as photos_service
from app.services import search as search_service
from app.services.applications import (
    AlreadyAppliedError,
    ProfileRequiredError,
    RoomGenderMismatchError,
)
from app.services.listings import ListingNotFoundError
from app.services.rate_limit import RateLimitedError

router = APIRouter(tags=["people"])

DbDep = Annotated[Session, Depends(get_session)]
OwnerDep = Annotated[User, Depends(current_owner)]
SeekerDep = Annotated[User, Depends(current_seeker)]
RedisDep = Annotated[RedisClient, Depends(get_redis)]

_OWN_ROOM_404: dict[int | str, dict[str, Any]] = {
    404: {
        "model": ErrorOut,
        "description": "not_found: unknown id, another owner's listing, or an apartment",
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
        liked_me=row.seeker_liked_at is not None,
    )


@router.get(
    "/listings/{listing_id}/people",
    response_model=PeoplePageOut,
    responses={
        **_OWNER_ONLY,
        **_OWN_ROOM_404,
        409: {
            "model": ErrorOut,
            "description": "listing_not_live: paused, expired, or its area inactive",
        },
    },
)
def list_people(
    listing_id: uuid.UUID,
    params: Annotated[PeopleParams, Query()],
    owner: OwnerDep,
    db: DbDep,
) -> PeoplePageOut:
    try:
        rows, total = people_service.list_people(db, owner, listing_id, params.offset)
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except people_service.ListingNotLiveError:
        raise HTTPException(status_code=409, detail="listing_not_live") from None
    return PeoplePageOut(items=[_person_out(row) for row in rows], total=total)


@router.put(
    "/listings/{listing_id}/people/{person_id}/like",
    response_model=LikeOut,
    responses={
        **_OWNER_ONLY,
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown listing or person, another owner's listing, an "
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
    owner: OwnerDep,
    db: DbDep,
    r: RedisDep,
) -> LikeOut:
    try:
        application, seeker_id = people_service.like_person(db, r, owner, listing_id, person_id)
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except people_service.ListingNotLiveError:
        raise HTTPException(status_code=409, detail="listing_not_live") from None
    except RateLimitedError as exc:
        raise _rate_limited(exc) from None
    except AlreadyAppliedError:
        raise HTTPException(status_code=409, detail="already_applied") from None
    if application is None:
        return LikeOut(liked=True, application_id=None)
    members = chat_service.event_members(db, application, owner.id)
    chat_events.publish(r, members, application.id, "status")
    return LikeOut(liked=True, application_id=application.id)


@router.delete(
    "/listings/{listing_id}/people/{person_id}/like",
    status_code=204,
    responses={
        **_OWNER_ONLY,
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown person, or one of another listing or owner",
        },
    },
)
def unlike_person(
    listing_id: uuid.UUID, person_id: uuid.UUID, owner: OwnerDep, db: DbDep
) -> Response:
    try:
        people_service.unlike_person(db, owner, listing_id, person_id)
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    return Response(status_code=204)


@router.put(
    "/listings/{listing_id}/like",
    response_model=LikeOut,
    responses={
        **_SEEKER_ONLY,
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown id, a paused, expired or inactive-area listing, "
            "an apartment, or the caller's own",
        },
        409: {
            "model": ErrorOut,
            "description": "seeker_profile_required; room_section_required: the profile has no "
            "room section; room_gender_mismatch: the room does not fit the seeker; "
            "already_applied. Only already_applied costs rate-limit budget",
        },
        **_RATE_LIMITED,
    },
)
def like_room(listing_id: uuid.UUID, seeker: SeekerDep, db: DbDep, r: RedisDep) -> LikeOut:
    try:
        application, listing = people_service.like_room(db, r, seeker, listing_id)
    except ProfileRequiredError:
        raise HTTPException(status_code=409, detail="seeker_profile_required") from None
    except people_service.RoomSectionRequiredError:
        raise HTTPException(status_code=409, detail="room_section_required") from None
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except RoomGenderMismatchError:
        raise HTTPException(status_code=409, detail="room_gender_mismatch") from None
    except RateLimitedError as exc:
        raise _rate_limited(exc) from None
    except AlreadyAppliedError:
        raise HTTPException(status_code=409, detail="already_applied") from None
    if application is None:
        return LikeOut(liked=True, application_id=None)
    members = chat_service.event_members(db, application, listing.owner_id)
    chat_events.publish(r, members, application.id, "status")
    return LikeOut(liked=True, application_id=application.id)


@router.delete("/listings/{listing_id}/like", status_code=204, responses=_SEEKER_ONLY)
def unlike_room(listing_id: uuid.UUID, seeker: SeekerDep, db: DbDep) -> Response:
    people_service.unlike_room(db, seeker, listing_id)
    return Response(status_code=204)


@router.get("/me/likes", response_model=MyLikesOut, responses=_SEEKER_ONLY)
def my_likes(seeker: SeekerDep, db: DbDep) -> MyLikesOut:
    liked_me: list[LikedRoomOut] = []
    mine: list[LikedRoomOut] = []
    for (
        listing,
        match,
        lister_liked_at,
        seeker_liked_at,
        cover_id,
        cover_key,
    ) in search_service.liked_rooms(db, seeker.id):
        room = ListingPublic.from_listing(
            listing,
            seeker=True,
            match=match,
            cover=photos_service.cover_out(cover_id, cover_key),
        )
        if seeker_liked_at is not None:
            mine.append(LikedRoomOut(listing=room, liked_at=seeker_liked_at))
        elif lister_liked_at is not None:
            liked_me.append(LikedRoomOut(listing=room, liked_at=lister_liked_at))
    return MyLikesOut(liked_me=liked_me, mine=mine)
