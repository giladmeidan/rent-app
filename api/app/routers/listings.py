"""The lister's listing endpoints (spec 0002a). Thin: all logic is in `services/listings.py`.

All three require a session of any role (`current_user`, spec 0010b): 401 `unauthenticated`
without one. Any account posts and manages a room; only an **owner** posts an apartment (403
`owner_only` on the POST, checked before anything is locked or counted). The live-listing cap is
per account and shared by both types. `GET /me/listings` lists the caller's own rows of both
types; PATCH requires the listing to be the caller's (404 `not_found` otherwise, the same body as
an unknown id).

`PUT /listings/{id}/closure` (spec 0014b) stores the owner's private answer on what happened to a
listing that is not live: the same owner rule as PATCH, 409 `listing_live` while it is live.

`POST /listings/{id}/renew` (spec 0011a) makes the caller's listing live for 90 days from now,
from 7 days before it expires and any time after: the same owner rule as PATCH, 409
`renewal_not_open` earlier, and the cap as a resume. PATCH refuses a listing past its expiry (409
`listing_expired`)."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.auth import current_user
from app.db import get_session
from app.models import User
from app.schemas.error import ErrorOut
from app.schemas.listing import ClosureIn, ListingIn, ListingOut, ListingPatch, MyListingOut
from app.services import listings as listings_service
from app.services import photos as photos_service

router = APIRouter(tags=["listings"])

DbDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[User, Depends(current_user)]

_AUTH_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorOut, "description": "unauthenticated"},
    503: {"model": ErrorOut, "description": "The database is unreachable"},
}
_OWNER_ONLY: dict[int | str, dict[str, Any]] = {
    403: {"model": ErrorOut, "description": "owner_only: an apartment by a non-owner"},
}
_CAP_REACHED: dict[int | str, dict[str, Any]] = {
    409: {"model": ErrorOut, "description": "listing_cap_reached"}
}
_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorOut, "description": "not_found: unknown id or another account's"},
}
_UNKNOWN_AREA: dict[int | str, dict[str, Any]] = {
    422: {"description": "unknown_area, or a malformed body (list `detail`)"}
}


@router.post(
    "/listings",
    status_code=201,
    response_model=ListingOut,
    responses={**_AUTH_ERRORS, **_OWNER_ONLY, **_CAP_REACHED, **_UNKNOWN_AREA},
)
def create_listing(body: ListingIn, user: UserDep, db: DbDep) -> ListingOut:
    # Apartments keep the roles (PRODUCT.md "Account roles"); a room is open to any account.
    if body.listing_type == "apartment" and user.role != "owner":
        raise HTTPException(status_code=403, detail="owner_only")
    try:
        listing = listings_service.create_listing(db, user, body)
    except listings_service.ListingCapReachedError:
        raise HTTPException(status_code=409, detail="listing_cap_reached") from None
    except listings_service.UnknownAreaError:
        raise HTTPException(status_code=422, detail="unknown_area") from None
    return ListingOut.model_validate(listing)


@router.get("/me/listings", response_model=list[MyListingOut], responses=_AUTH_ERRORS)
def my_listings(user: UserDep, db: DbDep) -> list[MyListingOut]:
    rows = listings_service.list_own_listings(db, user)
    # Every listing's photos in one statement, none without listings (spec 0010d).
    photos = photos_service.photos_by_listing(db, [row[0].id for row in rows])
    return [
        MyListingOut(
            **dict(ListingOut.model_validate(listing)),
            applicant_count=applicant_count,
            new_applicant_count=new_applicant_count,
            flatmate_count=flatmate_count,
            flatmate_invite_active=listing.flatmate_invite_hash is not None,
            close_reason=listing.close_reason,
            final_rent_ils=listing.final_rent_ils,
        ).model_copy(update={"photos": photos_service.photos_out(photos[listing.id])})
        for (
            listing,
            applicant_count,
            new_applicant_count,
            flatmate_count,
        ) in rows
    ]


@router.patch(
    "/listings/{listing_id}",
    response_model=ListingOut,
    responses={
        **_AUTH_ERRORS,
        **_NOT_FOUND,
        409: {
            "model": ErrorOut,
            "description": "listing_cap_reached (a resume) or listing_expired (past expires_at: "
            "renew it)",
        },
        **_UNKNOWN_AREA,
    },
)
def update_listing(
    listing_id: uuid.UUID, body: ListingPatch, user: UserDep, db: DbDep
) -> ListingOut:
    try:
        listing = listings_service.update_listing(db, user, listing_id, body)
    except listings_service.ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except listings_service.ListingExpiredError:
        raise HTTPException(status_code=409, detail="listing_expired") from None
    except listings_service.ListingCapReachedError:
        raise HTTPException(status_code=409, detail="listing_cap_reached") from None
    except listings_service.UnknownAreaError:
        raise HTTPException(status_code=422, detail="unknown_area") from None
    photos = photos_service.photos_by_listing(db, [listing.id])[listing.id]
    return ListingOut.model_validate(listing).model_copy(
        update={"photos": photos_service.photos_out(photos)}
    )


@router.post(
    "/listings/{listing_id}/renew",
    status_code=200,
    response_model=ListingOut,
    responses={
        **_AUTH_ERRORS,
        **_NOT_FOUND,
        409: {
            "model": ErrorOut,
            "description": "renewal_not_open (more than 7 days before expires_at) or "
            "listing_cap_reached",
        },
        422: {"description": "A malformed id (list `detail`)"},
    },
)
def renew_listing(listing_id: uuid.UUID, user: UserDep, db: DbDep) -> ListingOut:
    try:
        listing = listings_service.renew_listing(db, user, listing_id)
    except listings_service.ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except listings_service.RenewalNotOpenError:
        raise HTTPException(status_code=409, detail="renewal_not_open") from None
    except listings_service.ListingCapReachedError:
        raise HTTPException(status_code=409, detail="listing_cap_reached") from None
    photos = photos_service.photos_by_listing(db, [listing.id])[listing.id]
    return ListingOut.model_validate(listing).model_copy(
        update={"photos": photos_service.photos_out(photos)}
    )


@router.put(
    "/listings/{listing_id}/closure",
    status_code=204,
    responses={
        **_AUTH_ERRORS,
        **_NOT_FOUND,
        409: {"model": ErrorOut, "description": "listing_live: the listing is still live"},
        422: {"description": "A malformed body (list `detail`)"},
    },
)
def set_closure(listing_id: uuid.UUID, body: ClosureIn, user: UserDep, db: DbDep) -> Response:
    try:
        listings_service.set_closure(db, user, listing_id, body)
    except listings_service.ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except listings_service.ListingLiveError:
        raise HTTPException(status_code=409, detail="listing_live") from None
    return Response(status_code=204)
