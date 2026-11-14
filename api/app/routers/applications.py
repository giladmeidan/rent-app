"""Applications endpoints. Thin: all logic is in `services/applications.py`.

Every endpoint requires a session of any role (`current_user`, spec 0010b): 401 `unauthenticated`
without one. The role is read once, by `apply`: an **apartment** takes applications from seekers
only (403 `seeker_only`, not counted); a room is open to any account.

Applicant side (spec 0004a): the message is optional on a room and required on a public apartment
(spec 0010l: 422 `message_required`, not counted). A listing that is not public, or is the
caller's own, is a 404
`not_found` (the same body as an unknown id); so is another account's application. Rooms are open to
applications (spec 0007b); a room that does not fit the applicant is a 409 `room_gender_mismatch`,
a women- or men-only room for an applicant without a room section a 409 `seeker_gender_required`.

Lister side (spec 0004c): the two inbox endpoints act on the caller's own listings only. Another
account's listing, an application of a different listing and a withdrawn application are a 404
`not_found`, identical to an unknown id.

Each applicant carries their current `match` and housing `profile` (spec 0006c); the list is sorted
by match by default (`?sort=newest` for the 0004c order), applicants without a profile last. A room
application also carries the applicant's room section as `room` (spec 0007c: gender, age, answers).

Every successful lister status change and applicant withdraw publishes a `status` chat event to the
chat's members after the commit (spec 0005c): it may open or close the application's chat. On a
room application that includes the listing's flatmates (`chat.event_members`, spec 0008d). So does
an apply that answered the lister's invite (spec 0010l: it comes back `shortlisted`, its chat
open); a `submitted` apply publishes nothing."""

import datetime as dt
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Row
from sqlalchemy.orm import Session

from app.auth import current_user
from app.db import get_session
from app.matching.score import explain_row
from app.models import Application, Listing, User
from app.redis_client import RedisClient, get_redis
from app.schemas.application import (
    ApplicantOut,
    ApplicantProfileOut,
    ApplicantRoomOut,
    ApplicantSort,
    ApplicantStatusIn,
    ApplicationIn,
    ApplicationListingOut,
    MyApplicationOut,
)
from app.schemas.error import ErrorOut
from app.services import applications as applications_service
from app.services import chat as chat_service
from app.services import chat_events
from app.services.listings import ListingNotFoundError
from app.services.photos import person_photo_url
from app.services.rate_limit import RateLimitedError

router = APIRouter(tags=["applications"])

DbDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[User, Depends(current_user)]

_SESSION: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorOut, "description": "unauthenticated"},
    503: {"model": ErrorOut, "description": "The database or Redis is unreachable"},
}


def _out(application: Application, listing: Listing) -> MyApplicationOut:
    return MyApplicationOut(
        id=application.id,
        status=application.status,  # validated against ApplicationStatus (ck_applications_status)
        source=application.source,  # validated against ApplicationSource (ck_applications_source)
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
        **_SESSION,
        403: {
            "model": ErrorOut,
            "description": "seeker_only: an apartment by a non-seeker (not counted)",
        },
        422: {
            "description": "message_required: a public apartment without a message (not "
            "counted); or a malformed body (list `detail`)",
        },
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown id, a paused, expired or inactive-area listing, "
            "or the caller's own",
        },
        409: {
            "model": ErrorOut,
            "description": "already_applied; seeker_profile_required: the seeker's profile has no "
            "looking part (0006a, 0010c); seeker_gender_required: the room is for women or men "
            "only and the seeker's profile has no personal part (0007b); room_gender_mismatch: "
            "the room's gender preference does not fit the seeker (0007b). Only already_applied "
            "costs rate-limit budget",
        },
        429: {"model": ErrorOut, "description": "rate_limited; see Retry-After"},
    },
)
def apply(
    listing_id: uuid.UUID,
    body: ApplicationIn,
    user: UserDep,
    db: DbDep,
    r: Annotated[RedisClient, Depends(get_redis)],
) -> MyApplicationOut:
    try:
        application, listing = applications_service.apply(db, r, user, listing_id, body.message)
    except applications_service.SeekerOnlyError:
        raise HTTPException(status_code=403, detail="seeker_only") from None
    except applications_service.MessageRequiredError:
        raise HTTPException(status_code=422, detail="message_required") from None
    except applications_service.ProfileRequiredError:
        raise HTTPException(status_code=409, detail="seeker_profile_required") from None
    except applications_service.SeekerGenderRequiredError:
        raise HTTPException(status_code=409, detail="seeker_gender_required") from None
    except applications_service.RoomGenderMismatchError:
        raise HTTPException(status_code=409, detail="room_gender_mismatch") from None
    except RateLimitedError as exc:
        raise HTTPException(
            status_code=429, detail="rate_limited", headers={"Retry-After": str(exc.retry_after)}
        ) from None
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except applications_service.AlreadyAppliedError:
        raise HTTPException(status_code=409, detail="already_applied") from None
    if application.status == "shortlisted":
        # An invite answered (spec 0010l): its chat just opened, as a shortlist's does.
        members = chat_service.event_members(db, application, listing.owner_id)
        chat_events.publish(r, members, application.id, "status")
    return _out(application, listing)


@router.get("/me/applications", response_model=list[MyApplicationOut], responses=_SESSION)
def my_applications(user: UserDep, db: DbDep) -> list[MyApplicationOut]:
    return [
        _out(application, listing)
        for application, listing in applications_service.list_my_applications(db, user)
    ]


@router.post(
    "/me/applications/{application_id}/withdraw",
    response_model=MyApplicationOut,
    responses={
        **_SESSION,
        404: {"model": ErrorOut, "description": "not_found: unknown id, or another account's"},
        409: {"model": ErrorOut, "description": "not_withdrawable: already withdrawn, or declined"},
    },
)
def withdraw(
    application_id: uuid.UUID,
    user: UserDep,
    db: DbDep,
    r: Annotated[RedisClient, Depends(get_redis)],
) -> MyApplicationOut:
    try:
        application, listing = applications_service.withdraw(db, user, application_id)
    except applications_service.ApplicationNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except applications_service.NotWithdrawableError:
        raise HTTPException(status_code=409, detail="not_withdrawable") from None
    members = chat_service.event_members(db, application, listing.owner_id)
    chat_events.publish(r, members, application.id, "status")
    return _out(application, listing)


def _applicant_out(row: Row[Any]) -> ApplicantOut:
    """One `services.applications._applicants` row as the owner sees it. `match` and `profile`
    only when the applicant's profile has the looking part (`household` is NOT NULL exactly then,
    spec 0010c; no row reads NULL too): without it the match columns are meaningless (spec 0006c).
    `room` only when the service's room CASE returned a `room_gender` (a room application whose
    seeker has a personal part now, spec 0007c), independent of `profile`; the birth year becomes
    an age (the `BirthYear` validator's year)."""
    application: Application = row.Application
    has_profile = row.household is not None
    room = None
    if row.room_gender is not None:
        age = (
            dt.datetime.now(dt.UTC).year - row.room_birth_year
            if row.room_birth_year is not None
            else None
        )
        room = ApplicantRoomOut(gender=row.room_gender, age=age, lifestyle=row.room_lifestyle)
    return ApplicantOut(
        id=application.id,
        status=application.status,  # never `withdrawn`: filtered out by the service
        source=application.source,
        message=application.message,
        applicant_name=row.display_name,
        photo_url=person_photo_url(row.photo_key),
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
        room=room,
    )


@router.get(
    "/listings/{listing_id}/applications",
    response_model=list[ApplicantOut],
    responses={
        **_SESSION,
        404: {"model": ErrorOut, "description": "not_found: unknown id or another account's"},
    },
)
def list_applicants(
    listing_id: uuid.UUID,
    user: UserDep,
    db: DbDep,
    sort: Annotated[ApplicantSort, Query()] = "match",
) -> list[ApplicantOut]:
    try:
        rows = applications_service.list_applicants(db, user, listing_id, sort)
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    return [_applicant_out(row) for row in rows]


@router.patch(
    "/listings/{listing_id}/applications/{application_id}",
    response_model=ApplicantOut,
    responses={
        **_SESSION,
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown listing or application, another account's listing, "
            "an application of a different listing, or a withdrawn one",
        },
        409: {"model": ErrorOut, "description": "invalid_transition: the applicant is declined"},
    },
)
def set_applicant_status(
    listing_id: uuid.UUID,
    application_id: uuid.UUID,
    body: ApplicantStatusIn,
    user: UserDep,
    db: DbDep,
    r: Annotated[RedisClient, Depends(get_redis)],
) -> ApplicantOut:
    try:
        row = applications_service.set_applicant_status(
            db, user, listing_id, application_id, body.status
        )
    except (ListingNotFoundError, applications_service.ApplicationNotFoundError):
        raise HTTPException(status_code=404, detail="not_found") from None
    except applications_service.InvalidTransitionError:
        raise HTTPException(status_code=409, detail="invalid_transition") from None
    application: Application = row.Application
    members = chat_service.event_members(db, application, user.id)
    chat_events.publish(r, members, application.id, "status")
    return _applicant_out(row)
