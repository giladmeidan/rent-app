"""Seeker applications endpoints (spec 0004a). Thin: all logic is in `services/applications.py`.

All three require a **seeker** session (`current_seeker`): 401 `unauthenticated` without one, 403
`seeker_only` for an owner. A listing that is not public, or is the caller's own, is a 404
`not_found` (the same body as an unknown id); so is another seeker's application."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import current_seeker
from app.db import get_session
from app.models import Application, Listing, User
from app.redis_client import RedisClient, get_redis
from app.schemas.application import ApplicationIn, ApplicationListingOut, MyApplicationOut
from app.schemas.error import ErrorOut
from app.services import applications as applications_service
from app.services.listings import ListingNotFoundError
from app.services.rate_limit import RateLimitedError

router = APIRouter(tags=["applications"])

DbDep = Annotated[Session, Depends(get_session)]
SeekerDep = Annotated[User, Depends(current_seeker)]

_SEEKER_ONLY: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorOut, "description": "unauthenticated"},
    403: {"model": ErrorOut, "description": "seeker_only"},
    503: {"model": ErrorOut, "description": "The database or Redis is unreachable"},
}


def _out(application: Application, listing: Listing) -> MyApplicationOut:
    return MyApplicationOut(
        id=application.id,
        status=application.status,  # validated against ApplicationStatus (ck_applications_status)
        message=application.message,
        created_at=application.created_at,
        updated_at=application.updated_at,
        listing=ApplicationListingOut.model_validate(listing),
    )


@router.post(
    "/listings/{listing_id}/applications",
    status_code=201,
    response_model=MyApplicationOut,
    responses={
        **_SEEKER_ONLY,
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown id, a paused, expired, room or inactive-area "
            "listing, or the caller's own",
        },
        409: {"model": ErrorOut, "description": "already_applied"},
        429: {"model": ErrorOut, "description": "rate_limited; see Retry-After"},
    },
)
def apply(
    listing_id: uuid.UUID,
    body: ApplicationIn,
    seeker: SeekerDep,
    db: DbDep,
    r: Annotated[RedisClient, Depends(get_redis)],
) -> MyApplicationOut:
    try:
        application, listing = applications_service.apply(db, r, seeker, listing_id, body.message)
    except RateLimitedError as exc:
        raise HTTPException(
            status_code=429, detail="rate_limited", headers={"Retry-After": str(exc.retry_after)}
        ) from None
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except applications_service.AlreadyAppliedError:
        raise HTTPException(status_code=409, detail="already_applied") from None
    return _out(application, listing)


@router.get("/me/applications", response_model=list[MyApplicationOut], responses=_SEEKER_ONLY)
def my_applications(seeker: SeekerDep, db: DbDep) -> list[MyApplicationOut]:
    return [
        _out(application, listing)
        for application, listing in applications_service.list_my_applications(db, seeker)
    ]


@router.post(
    "/me/applications/{application_id}/withdraw",
    response_model=MyApplicationOut,
    responses={
        **_SEEKER_ONLY,
        404: {"model": ErrorOut, "description": "not_found: unknown id, or another seeker's"},
        409: {"model": ErrorOut, "description": "not_withdrawable: already withdrawn, or declined"},
    },
)
def withdraw(application_id: uuid.UUID, seeker: SeekerDep, db: DbDep) -> MyApplicationOut:
    try:
        application, listing = applications_service.withdraw(db, seeker, application_id)
    except applications_service.ApplicationNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except applications_service.NotWithdrawableError:
        raise HTTPException(status_code=409, detail="not_withdrawable") from None
    return _out(application, listing)
