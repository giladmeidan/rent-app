"""Flatmates endpoints (spec 0008d). Thin: all logic is in `services/flatmates.py`.

Owner side: the four `/listings/{listing_id}/flatmate...` endpoints require an **owner** session
(`current_owner`): 401 `unauthenticated`, 403 `owner_only` for a seeker. Another owner's listing is
a 404 `not_found`, the same as an unknown id; so is an apartment when creating a link.

Invitee and flatmate side: preview, join and `/me/flats` require a session of any role
(`current_user`): 401 `unauthenticated`. The invite token travels **only in a POST body**, never in
a path or query (uvicorn's access log records full paths). Preview and join share one rate limit
per user (429 `rate_limited` with `Retry-After`), counted on every authenticated attempt, found or
not. Leaving (`DELETE /me/flats/{listing_id}`) is always a 204, so it reveals nothing."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.auth import current_owner, current_user
from app.db import get_session
from app.models import Listing, User
from app.redis_client import RedisClient, get_redis
from app.routers.applications import _OWNER_ONLY
from app.schemas.application import ApplicationListingOut
from app.schemas.error import ErrorOut
from app.schemas.flatmates import (
    FlatmateOut,
    InviteOut,
    InvitePreviewOut,
    InviteTokenIn,
    JoinOut,
    MyFlatOut,
)
from app.services import flatmates as flatmates_service
from app.services.applications import AlreadyAppliedError
from app.services.listings import ListingNotFoundError
from app.services.photos import person_photo_url
from app.services.rate_limit import RateLimitedError

router = APIRouter(tags=["flatmates"])

DbDep = Annotated[Session, Depends(get_session)]
OwnerDep = Annotated[User, Depends(current_owner)]
UserDep = Annotated[User, Depends(current_user)]
RedisDep = Annotated[RedisClient, Depends(get_redis)]

_SESSION: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorOut, "description": "unauthenticated"},
    503: {"model": ErrorOut, "description": "The database or Redis is unreachable"},
}
_NOT_OWN: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorOut, "description": "not_found: unknown id or another owner's"},
}
_TOKEN_ERRORS: dict[int | str, dict[str, Any]] = {
    **_SESSION,
    404: {
        "model": ErrorOut,
        "description": "not_found: an unknown, rotated or disabled token, or the listing is an "
        "apartment",
    },
    429: {"model": ErrorOut, "description": "rate_limited; see Retry-After"},
}


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="not_found")


def _rate_limited(exc: RateLimitedError) -> HTTPException:
    return HTTPException(
        status_code=429, detail="rate_limited", headers={"Retry-After": str(exc.retry_after)}
    )


@router.post(
    "/listings/{listing_id}/flatmate-invite",
    status_code=201,
    response_model=InviteOut,
    responses={
        **_OWNER_ONLY,
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown id, another owner's, or an apartment",
        },
    },
)
def create_invite(
    listing_id: uuid.UUID, owner: OwnerDep, db: DbDep, response: Response
) -> InviteOut:
    """Create the room's invite link, or rotate it (the old link stops working). The token is
    returned only here and can never be read again; the response is never cached."""
    try:
        token = flatmates_service.create_invite(db, owner, listing_id)
    except ListingNotFoundError:
        raise _not_found() from None
    response.headers["Cache-Control"] = "no-store"
    return InviteOut(token=token)


@router.delete(
    "/listings/{listing_id}/flatmate-invite",
    status_code=204,
    responses={**_OWNER_ONLY, **_NOT_OWN},
)
def disable_invite(listing_id: uuid.UUID, owner: OwnerDep, db: DbDep) -> Response:
    try:
        flatmates_service.disable_invite(db, owner, listing_id)
    except ListingNotFoundError:
        raise _not_found() from None
    return Response(status_code=204)


@router.post(
    "/flatmate-invites/preview",
    response_model=InvitePreviewOut,
    responses={
        **_TOKEN_ERRORS,
        409: {"model": ErrorOut, "description": "own_listing: the caller owns the listing"},
    },
)
def preview_invite(body: InviteTokenIn, me: UserDep, db: DbDep, r: RedisDep) -> InvitePreviewOut:
    try:
        row = flatmates_service.preview(db, r, me, body.token)
    except RateLimitedError as exc:
        raise _rate_limited(exc) from None
    except ListingNotFoundError:
        raise _not_found() from None
    except flatmates_service.OwnListingError:
        raise HTTPException(status_code=409, detail="own_listing") from None
    listing: Listing = row.Listing
    return InvitePreviewOut(
        listing=ApplicationListingOut.model_validate(listing),
        owner_name=row.owner_name,
        member=row.member,
    )


@router.post(
    "/flatmate-invites/join",
    response_model=JoinOut,
    responses={
        **_TOKEN_ERRORS,
        409: {
            "model": ErrorOut,
            "description": "own_listing: the caller owns the listing; already_applied: the caller "
            "has a submitted or shortlisted application to it; declined: the caller's application "
            "to it was declined; flatmates_full: it has the maximum number of flatmates (7)",
        },
    },
)
def join(body: InviteTokenIn, me: UserDep, db: DbDep, r: RedisDep) -> JoinOut:
    """Join the flat. Idempotent: a member gets 200 and keeps the original `joined_at`."""
    try:
        listing_id = flatmates_service.join(db, r, me, body.token)
    except RateLimitedError as exc:
        raise _rate_limited(exc) from None
    except ListingNotFoundError:
        raise _not_found() from None
    except flatmates_service.OwnListingError:
        raise HTTPException(status_code=409, detail="own_listing") from None
    except AlreadyAppliedError:
        raise HTTPException(status_code=409, detail="already_applied") from None
    except flatmates_service.DeclinedError:
        raise HTTPException(status_code=409, detail="declined") from None
    except flatmates_service.FlatmatesFullError:
        raise HTTPException(status_code=409, detail="flatmates_full") from None
    return JoinOut(listing_id=listing_id)


@router.get(
    "/listings/{listing_id}/flatmates",
    response_model=list[FlatmateOut],
    responses={**_OWNER_ONLY, **_NOT_OWN},
)
def list_flatmates(listing_id: uuid.UUID, owner: OwnerDep, db: DbDep) -> list[FlatmateOut]:
    try:
        rows = flatmates_service.list_flatmates(db, owner, listing_id)
    except ListingNotFoundError:
        raise _not_found() from None
    return [
        FlatmateOut(
            id=row.id,
            display_name=row.display_name,
            photo_url=person_photo_url(row.photo_key),
            joined_at=row.joined_at,
        )
        for row in rows
    ]


@router.delete(
    "/listings/{listing_id}/flatmates/{flatmate_id}",
    status_code=204,
    responses={
        **_OWNER_ONLY,
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown listing or membership, another owner's listing, "
            "or another listing's membership",
        },
    },
)
def remove_flatmate(
    listing_id: uuid.UUID, flatmate_id: uuid.UUID, owner: OwnerDep, db: DbDep
) -> Response:
    """Remove a flatmate: their chat access ends at once, and the invite link is turned off (they
    may still hold it); make a new one for the others."""
    try:
        flatmates_service.remove_flatmate(db, owner, listing_id, flatmate_id)
    except ListingNotFoundError:
        raise _not_found() from None
    return Response(status_code=204)


@router.get("/me/flats", response_model=list[MyFlatOut], responses=_SESSION)
def my_flats(me: UserDep, db: DbDep) -> list[MyFlatOut]:
    return [
        MyFlatOut(
            listing=ApplicationListingOut.model_validate(row.Listing),
            owner_name=row.owner_name,
            joined_at=row.joined_at,
        )
        for row in flatmates_service.my_flats(db, me)
    ]


@router.delete("/me/flats/{listing_id}", status_code=204, responses=_SESSION)
def leave_flat(listing_id: uuid.UUID, me: UserDep, db: DbDep) -> Response:
    """Leave the flat (always 204, member or not)."""
    flatmates_service.leave(db, me, listing_id)
    return Response(status_code=204)
