"""Public search endpoints (spec 0003a). Thin: all logic is in `services/search.py`; the listing
page's applicant count (spec 0004a) is in `services/applications.py` and its view counter in
`services/listing_views.py` (spec 0011e): the listing page is read-only, a view goes to Redis.

Both are **public** (`optional_user`): without a cookie no session query runs; an unknown or expired
cookie is a visitor, never a 401. A cookie adds the caller's match score (spec 0006b): any account
with a profile with the looking part (spec 0010b: whatever its role) gets `match` on every listing
but its own (and search defaults to `sort=match`), everyone else `match: null`. For an account whose
looking part is filled and that has a room section, a cookie also removes the rooms that do not fit
them from search, the map and `total` (never their own room, spec 0010b), and sets the listing
page's `room_fit` (spec 0007b). That is why every 200 says `Vary: Cookie` and a 200 to a request
carrying the session cookie is `Cache-Control: private` (0006b): the body may differ per caller. The
cookie also decides whether a room's flatmates' ages and questionnaire answers are shown: only a
signed-in seeker gets them, and a seeker is a role seeker **or** any account with a profile with the
looking part (`services/profiles.py::sees_room_privacy`, decision 13, Gilad 2026-11-13); everyone
else gets `[]` and `{}` (`ListingPublic.from_listing`). Every listing says `is_mine`, whether the
caller owns it (spec 0010b; false for a visitor). Search returns one type: `listing_type` omitted
means `apartment` (spec 0010a), the market asks for `room`; the listing page serves both. A
listing that is not public is a 404 `not_found`, the same body as an unknown id. Any signed-in
account on a room it does not own also gets the listing page's `like` (spec 0008a), the likes
between them and the room. A seeker on a room that fits them (`room_fit` not false) also gets the
listing page's `people` (spec 0010f, `services/flatmates.py::shown_people`): the lister when they
live there and the flatmates who chose to be shown (on a gendered room, only to a viewer of the
room's gender); everyone else gets `[]`."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from redis.exceptions import RedisError
from sqlalchemy.orm import Session

from app.auth import COOKIE_NAME, optional_user
from app.db import get_session
from app.models import Listing, User
from app.redis_client import RedisClient, get_redis
from app.schemas.error import ErrorOut
from app.schemas.search import (
    FlatPersonOut,
    ListingDetail,
    ListingPublic,
    ListingSearchOut,
    SearchParams,
)
from app.services import applications as applications_service
from app.services import flatmates as flatmates_service
from app.services import listing_views
from app.services import market_people as market_people_service
from app.services import people as people_service
from app.services import photos as photos_service
from app.services import profiles as profiles_service
from app.services import search as search_service
from app.services.listings import ListingNotFoundError
from app.services.rate_limit import RateLimitedError

router = APIRouter(tags=["search"])

DbDep = Annotated[Session, Depends(get_session)]
RedisDep = Annotated[RedisClient, Depends(get_redis)]
OptionalUserDep = Annotated[User | None, Depends(optional_user)]

_DB_DOWN: dict[int | str, dict[str, Any]] = {
    503: {"model": ErrorOut, "description": "The database is unreachable"}
}


def _is_mine(user: User | None, listing: Listing) -> bool:
    """The caller owns `listing` (spec 0010b; no statement)."""
    return user is not None and listing.owner_id == user.id


def _private_if_cookie(request: Request, response: Response) -> None:
    """A response that may differ per caller must not be shared-cached. The raw cookie, not the
    user: `optional_user` is None for an expired one. Every 200 says `Vary: Cookie` (appended, so
    CORS's `Vary: Origin` stays), since the body differs with the cookie."""
    response.headers.append("Vary", "Cookie")
    if COOKIE_NAME in request.cookies:
        response.headers["Cache-Control"] = "private"


@router.get("/listings", response_model=ListingSearchOut, responses=_DB_DOWN)
def search_listings(
    params: Annotated[SearchParams, Query()],
    db: DbDep,
    user: OptionalUserDep,
    request: Request,
    response: Response,
) -> ListingSearchOut:
    profile_user_id = profiles_service.profile_user_id(db, user)
    page, total, sort = search_service.search_listings(db, params, profile_user_id)
    seeker = profiles_service.sees_room_privacy(user, profile_user_id)
    items: list[ListingPublic] = []
    for listing, match, cover_id, cover_key in page:
        mine = _is_mine(user, listing)
        # No score on your own listing; a `match` sort still orders it by its score.
        items.append(
            ListingPublic.from_listing(
                listing,
                seeker=seeker,
                match=None if mine else match,
                cover=photos_service.cover_out(cover_id, cover_key),
                is_mine=mine,
            )
        )
    _private_if_cookie(request, response)
    return ListingSearchOut(items=items, total=total, sort=sort)


def _browse_allowed(r: RedisClient, user: User) -> bool:
    """Count one people-browse page for `user`; False when they are over the limit or Redis is
    unavailable (fail closed: the page is served without people, never a 503)."""
    try:
        market_people_service.count_browse(r, user)
    except (RateLimitedError, RedisError):
        return False
    return True


@router.get(
    "/listings/{listing_id}",
    response_model=ListingDetail,
    responses={
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown id, or a paused, expired or inactive-area listing",
        },
        **_DB_DOWN,
    },
)
def get_listing(
    listing_id: uuid.UUID,
    db: DbDep,
    user: OptionalUserDep,
    r: RedisDep,
    request: Request,
    response: Response,
) -> ListingDetail:
    """A public listing with its applicant count, the caller's match, room fit and like state
    (spec 0008a; 0010b: any signed-in account on a room, not their own), `is_mine` and, for a
    seeker on a room that fits them, the flat's people (spec 0010f). Read-only: a view is counted
    in Redis, once per viewer per listing per hour, and the worker flushes the counts into
    `listings.view_count` every minute (spec 0011e). A 404 counts nothing.

    The flat's people count one page against the caller's people-browse limit (spec 0010h,
    `market_people.count_browse`, shared with `GET /people` and `GET /listings/{id}/people`), only
    when they are computed: visitors, owners, apartments and non-seekers count nothing. Over the
    limit or with Redis unavailable the page is not refused: it is served with `people = []`
    (the view is still recorded, everything else unchanged)."""
    profile_user_id = profiles_service.profile_user_id(db, user)
    try:
        listing, match, room_fit = search_service.get_public_listing_with_match(
            db, listing_id, profile_user_id
        )
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    count = applications_service.applicant_count(db, listing.id)
    host = request.client.host if request.client else "unknown"
    listing_views.count_view(r, listing.id, f"u:{user.id}" if user else f"ip:{host}")
    mine = _is_mine(user, listing)
    like = None
    if user is not None and listing.listing_type == "room" and listing.owner_id != user.id:
        like = people_service.like_state(db, user.id, listing.id)
    # Decision 13, read once: the room privacy fields and the flat's people (spec 0010f).
    seeker = profiles_service.sees_room_privacy(user, profile_user_id)
    people: list[FlatPersonOut] = []
    if (
        user is not None
        and seeker
        and listing.listing_type == "room"
        and room_fit is not False
        and _browse_allowed(r, user)
    ):
        people = [
            FlatPersonOut(
                display_name=row.display_name,
                photo_url=photos_service.person_photo_url(row.photo_key),
                age=people_service.age(row.birth_year),
                gender=row.gender,
                about_me=row.about_me,
                lifestyle=row.lifestyle or {},
                lister=row.lister,
            )
            for row in flatmates_service.shown_people(db, listing, user.id)
        ]
    # The last statement (spec 0010d).
    photos = photos_service.photos_out(
        photos_service.photos_by_listing(db, [listing.id])[listing.id]
    )
    _private_if_cookie(request, response)
    return ListingDetail.from_listing(
        listing,
        seeker=seeker,
        match=None if mine else match,
        applicant_count=count,
        room_fit=room_fit,
        like=like,
        cover=photos[0] if photos else None,
        photos=photos,
        is_mine=mine,
        people=people,
    )
