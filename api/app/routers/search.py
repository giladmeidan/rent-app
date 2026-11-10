"""Public search endpoints (spec 0003a). Thin: all logic is in `services/search.py`; the listing
page's view counter and applicant count (spec 0004a) are in `services/applications.py`.

Both are **public**: no session dependency, so a cookie is ignored and no session query runs.
A listing that is not public is a 404 `not_found`, the same body as an unknown id."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_session
from app.schemas.error import ErrorOut
from app.schemas.search import ListingDetail, ListingPublic, ListingSearchOut, SearchParams
from app.services import applications as applications_service
from app.services import search as search_service
from app.services.listings import ListingNotFoundError

router = APIRouter(tags=["search"])

DbDep = Annotated[Session, Depends(get_session)]

_DB_DOWN: dict[int | str, dict[str, Any]] = {
    503: {"model": ErrorOut, "description": "The database is unreachable"}
}


@router.get("/listings", response_model=ListingSearchOut, responses=_DB_DOWN)
def search_listings(params: Annotated[SearchParams, Query()], db: DbDep) -> ListingSearchOut:
    page, total = search_service.search_listings(db, params)
    return ListingSearchOut(items=[ListingPublic.model_validate(row) for row in page], total=total)


@router.get(
    "/listings/{listing_id}",
    response_model=ListingDetail,
    responses={
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown id, or a paused, expired, room or inactive-area "
            "listing",
        },
        **_DB_DOWN,
    },
)
def get_listing(listing_id: uuid.UUID, db: DbDep) -> ListingDetail:
    """A public listing with its applicant count; counts one view (`listings.view_count`). A 404
    counts nothing."""
    try:
        listing = search_service.get_public_listing(db, listing_id)
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    count = applications_service.record_view(db, listing.id)
    # `expire_on_commit=False` (db.py): the loaded `lat` / `lng` survive `record_view`'s commit.
    return ListingDetail(
        **ListingPublic.model_validate(listing).model_dump(), applicant_count=count
    )
