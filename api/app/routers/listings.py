"""Owner listing endpoints (spec 0002a). Thin: all logic is in `services/listings.py`.

All three require an owner session (`current_owner`): 401 `unauthenticated` without one, 403
`owner_only` for a seeker. PATCH also requires the listing to be the caller's (404 otherwise)."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import current_owner
from app.db import get_session
from app.models import User
from app.schemas.error import ErrorOut
from app.schemas.listing import ListingIn, ListingOut, ListingPatch, MyListingOut
from app.services import listings as listings_service

router = APIRouter(tags=["listings"])

DbDep = Annotated[Session, Depends(get_session)]
OwnerDep = Annotated[User, Depends(current_owner)]

_AUTH_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorOut, "description": "unauthenticated"},
    403: {"model": ErrorOut, "description": "owner_only: the caller is a seeker"},
    503: {"model": ErrorOut, "description": "The database is unreachable"},
}
_CAP_REACHED: dict[int | str, dict[str, Any]] = {
    409: {"model": ErrorOut, "description": "listing_cap_reached"}
}
_UNKNOWN_AREA: dict[int | str, dict[str, Any]] = {
    422: {"description": "unknown_area, or a malformed body (list `detail`)"}
}


@router.post(
    "/listings",
    status_code=201,
    response_model=ListingOut,
    responses={**_AUTH_ERRORS, **_CAP_REACHED, **_UNKNOWN_AREA},
)
def create_listing(body: ListingIn, owner: OwnerDep, db: DbDep) -> ListingOut:
    try:
        listing = listings_service.create_listing(db, owner, body)
    except listings_service.ListingCapReachedError:
        raise HTTPException(status_code=409, detail="listing_cap_reached") from None
    except listings_service.UnknownAreaError:
        raise HTTPException(status_code=422, detail="unknown_area") from None
    return ListingOut.model_validate(listing)


@router.get("/me/listings", response_model=list[MyListingOut], responses=_AUTH_ERRORS)
def my_listings(owner: OwnerDep, db: DbDep) -> list[MyListingOut]:
    return [
        MyListingOut(
            **dict(ListingOut.model_validate(listing)),
            applicant_count=applicant_count,
            new_applicant_count=new_applicant_count,
            liked_me_count=liked_me_count,
        )
        for (
            listing,
            applicant_count,
            new_applicant_count,
            liked_me_count,
        ) in listings_service.list_own_listings(db, owner)
    ]


@router.patch(
    "/listings/{listing_id}",
    response_model=ListingOut,
    responses={
        **_AUTH_ERRORS,
        404: {"model": ErrorOut, "description": "not_found: unknown id or another owner's"},
        **_CAP_REACHED,
        **_UNKNOWN_AREA,
    },
)
def update_listing(
    listing_id: uuid.UUID, body: ListingPatch, owner: OwnerDep, db: DbDep
) -> ListingOut:
    try:
        listing = listings_service.update_listing(db, owner, listing_id, body)
    except listings_service.ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except listings_service.ListingCapReachedError:
        raise HTTPException(status_code=409, detail="listing_cap_reached") from None
    except listings_service.UnknownAreaError:
        raise HTTPException(status_code=422, detail="unknown_area") from None
    return ListingOut.model_validate(listing)
