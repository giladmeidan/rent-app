"""Public search endpoints (spec 0003a). Thin: all logic is in `services/search.py`; the listing
page's view counter and applicant count (spec 0004a) are in `services/applications.py`.

Both are **public** (`optional_user`): without a cookie no session query runs; an unknown or expired
cookie is a visitor, never a 401. A cookie adds the caller's match score (spec 0006b): a seeker with
a profile gets `match` on every listing (and search defaults to `sort=match`), everyone else
`match: null`. For a seeker whose profile has a room section, a cookie also removes the rooms that
do not fit them from search, the map and `total`, and sets the listing page's `room_fit` (spec
0007b). That is why every 200 says `Vary: Cookie` and a 200 to a request carrying the session
cookie is `Cache-Control: private` (0006b): the body may differ per caller. The cookie also
decides whether a room's flatmates' ages and questionnaire answers are shown: only a signed-in
seeker gets them, everyone else `[]` and `{}` (`ListingPublic.from_listing`, Gilad (b),
2026-11-11). Search returns one type: `listing_type` omitted means `apartment` (spec 0010a), the
market asks for `room`; the listing page serves both. A listing that is not public is a 404
`not_found`, the same body as an unknown id. A seeker on a room also gets the listing page's `like`
(spec 0008a), the likes between them and the room."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from app.auth import COOKIE_NAME, optional_user
from app.db import get_session
from app.models import User
from app.schemas.error import ErrorOut
from app.schemas.search import ListingDetail, ListingPublic, ListingSearchOut, SearchParams
from app.services import applications as applications_service
from app.services import people as people_service
from app.services import profiles as profiles_service
from app.services import search as search_service
from app.services.listings import ListingNotFoundError

router = APIRouter(tags=["search"])

DbDep = Annotated[Session, Depends(get_session)]
OptionalUserDep = Annotated[User | None, Depends(optional_user)]

_DB_DOWN: dict[int | str, dict[str, Any]] = {
    503: {"model": ErrorOut, "description": "The database is unreachable"}
}


def _is_seeker(user: User | None) -> bool:
    """The caller is signed in as a seeker (no statement: `optional_user` loaded the user)."""
    return user is not None and user.role == "seeker"


def _profile_user_id(db: Session, user: User | None) -> uuid.UUID | None:
    """The caller's id when they are a seeker with a housing profile (one PK lookup), else None."""
    if user is None or not _is_seeker(user):
        return None
    return user.id if profiles_service.has_profile(db, user.id) else None


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
    page, total, sort = search_service.search_listings(db, params, _profile_user_id(db, user))
    seeker = _is_seeker(user)
    items = [
        ListingPublic.from_listing(listing, seeker=seeker, match=match) for listing, match in page
    ]
    _private_if_cookie(request, response)
    return ListingSearchOut(items=items, total=total, sort=sort)


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
    request: Request,
    response: Response,
) -> ListingDetail:
    """A public listing with its applicant count, the caller's match, room fit and like state
    (spec 0008a: a seeker on a room, not their own); counts one view (`listings.view_count`). A
    404 counts nothing."""
    try:
        listing, match, room_fit = search_service.get_public_listing_with_match(
            db, listing_id, _profile_user_id(db, user)
        )
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    count = applications_service.record_view(db, listing.id)
    like = None
    if (
        user is not None
        and _is_seeker(user)
        and listing.listing_type == "room"
        and listing.owner_id != user.id
    ):
        like = people_service.like_state(db, user.id, listing.id)
    _private_if_cookie(request, response)
    # `expire_on_commit=False` (db.py): the loaded `lat` / `lng` survive `record_view`'s commit.
    return ListingDetail.from_listing(
        listing,
        seeker=_is_seeker(user),
        match=match,
        applicant_count=count,
        room_fit=room_fit,
        like=like,
    )
