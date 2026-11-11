"""Applications endpoints. Thin: all logic is in `services/applications.py`.

Seeker side (spec 0004a): the three seeker endpoints require a **seeker** session
(`current_seeker`): 401 `unauthenticated` without one, 403 `seeker_only` for an owner. A listing
that is not public, or is the caller's own, is a 404 `not_found` (the same body as an unknown id);
so is another seeker's application.

Owner side (spec 0004c): the two inbox endpoints require an **owner** session (`current_owner`):
401 `unauthenticated`, 403 `owner_only` for a seeker. Another owner's listing, an application of a
different listing and a withdrawn application are a 404 `not_found`, identical to an unknown id.

Each applicant carries their current `match` and housing `profile` (spec 0006c); the list is sorted
by match by default (`?sort=newest` for the 0004c order), applicants without a profile last.

Every successful owner status change and seeker withdraw publishes a `status` chat event to the
owner and the seeker after the commit (spec 0005c): it may open or close the application's chat."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Row
from sqlalchemy.orm import Session

from app.auth import current_owner, current_seeker
from app.db import get_session
from app.matching.score import explain_row
from app.models import Application, Listing, User
from app.redis_client import RedisClient, get_redis
from app.schemas.application import (
    ApplicantOut,
    ApplicantProfileOut,
    ApplicantSort,
    ApplicantStatusIn,
    ApplicationIn,
    ApplicationListingOut,
    MyApplicationOut,
)
from app.schemas.error import ErrorOut
from app.services import applications as applications_service
from app.services import chat_events
from app.services.listings import ListingNotFoundError
from app.services.rate_limit import RateLimitedError

router = APIRouter(tags=["applications"])

DbDep = Annotated[Session, Depends(get_session)]
SeekerDep = Annotated[User, Depends(current_seeker)]
OwnerDep = Annotated[User, Depends(current_owner)]

_SEEKER_ONLY: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorOut, "description": "unauthenticated"},
    403: {"model": ErrorOut, "description": "seeker_only"},
    503: {"model": ErrorOut, "description": "The database or Redis is unreachable"},
}


_OWNER_ONLY: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorOut, "description": "unauthenticated"},
    403: {"model": ErrorOut, "description": "owner_only: the caller is a seeker"},
    503: {"model": ErrorOut, "description": "The database is unreachable"},
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
        409: {
            "model": ErrorOut,
            "description": "already_applied, or seeker_profile_required: the seeker has no "
            "housing profile (0006a)",
        },
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
    except applications_service.ProfileRequiredError:
        raise HTTPException(status_code=409, detail="seeker_profile_required") from None
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
def withdraw(
    application_id: uuid.UUID,
    seeker: SeekerDep,
    db: DbDep,
    r: Annotated[RedisClient, Depends(get_redis)],
) -> MyApplicationOut:
    try:
        application, listing = applications_service.withdraw(db, seeker, application_id)
    except applications_service.ApplicationNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except applications_service.NotWithdrawableError:
        raise HTTPException(status_code=409, detail="not_withdrawable") from None
    chat_events.publish(r, [listing.owner_id, seeker.id], application.id, "status")
    return _out(application, listing)


def _applicant_out(row: Row[Any]) -> ApplicantOut:
    """One `services.applications._applicants` row as the owner sees it. `match` and `profile`
    only when the applicant has a profile (`household` is NOT NULL in `seeker_profiles`): without
    one the match columns are meaningless (spec 0006c)."""
    application: Application = row.Application
    has_profile = row.household is not None
    return ApplicantOut(
        id=application.id,
        status=application.status,  # never `withdrawn`: filtered out by the service
        message=application.message,
        applicant_name=row.display_name,
        created_at=application.created_at,
        updated_at=application.updated_at,
        match=explain_row(row) if has_profile else None,
        profile=(
            ApplicantProfileOut(
                household=row.household,
                move_in_date=row.move_in_date,
                move_in_flexible=row.move_in_flexible,
                has_pets=row.has_pets,
                smoker=row.smoker,
                contract_months=row.contract_months,
                parking_needed=row.parking_needed,
            )
            if has_profile
            else None
        ),
    )


@router.get(
    "/listings/{listing_id}/applications",
    response_model=list[ApplicantOut],
    responses={
        **_OWNER_ONLY,
        404: {"model": ErrorOut, "description": "not_found: unknown id or another owner's"},
    },
)
def list_applicants(
    listing_id: uuid.UUID,
    owner: OwnerDep,
    db: DbDep,
    sort: Annotated[ApplicantSort, Query()] = "match",
) -> list[ApplicantOut]:
    try:
        rows = applications_service.list_applicants(db, owner, listing_id, sort)
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    return [_applicant_out(row) for row in rows]


@router.patch(
    "/listings/{listing_id}/applications/{application_id}",
    response_model=ApplicantOut,
    responses={
        **_OWNER_ONLY,
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown listing or application, another owner's listing, "
            "an application of a different listing, or a withdrawn one",
        },
        409: {"model": ErrorOut, "description": "invalid_transition: the applicant is declined"},
    },
)
def set_applicant_status(
    listing_id: uuid.UUID,
    application_id: uuid.UUID,
    body: ApplicantStatusIn,
    owner: OwnerDep,
    db: DbDep,
    r: Annotated[RedisClient, Depends(get_redis)],
) -> ApplicantOut:
    try:
        row = applications_service.set_applicant_status(
            db, owner, listing_id, application_id, body.status
        )
    except (ListingNotFoundError, applications_service.ApplicationNotFoundError):
        raise HTTPException(status_code=404, detail="not_found") from None
    except applications_service.InvalidTransitionError:
        raise HTTPException(status_code=409, detail="invalid_transition") from None
    application: Application = row.Application
    chat_events.publish(r, [owner.id, application.seeker_id], application.id, "status")
    return _applicant_out(row)
