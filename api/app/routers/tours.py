"""Tour endpoints (spec 0018a). Thin: all logic is in `services/tours.py`.

Every endpoint requires a session (`current_user`, any role): 401 `unauthenticated` without one.
The window routes act on the caller's own listings; the slot and booking routes on the caller's own
`shortlisted` application; cancel on a tour the caller is the seeker or the listing's owner of.
Anything else is a 404 `not_found`, identical to an unknown id. Every write counts the shared
`write` budget first (the three tour changes the `tour` budget too: each is a chat line); a
booking, a move and a cancel publish a `message` chat event to the owner and the seeker after the
commit (`tours.announce`). Error order: 401, 422 (malformed id or body), 429, 404, 409."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import Row
from sqlalchemy.orm import Session

from app import limits
from app.auth import current_user
from app.db import get_session
from app.models import TourWindow, User
from app.redis_client import RedisClient, get_redis
from app.schemas.error import ErrorOut
from app.schemas.tours import (
    BookedSlotOut,
    SlotOut,
    TourOut,
    TourSlotsOut,
    TourStartIn,
    TourWindowIn,
    TourWindowOut,
    TourWindowsOut,
)
from app.services import tours

router = APIRouter(tags=["tours"])

DbDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[User, Depends(current_user)]
RedisDep = Annotated[RedisClient, Depends(get_redis)]

_SESSION: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorOut, "description": "unauthenticated"},
    503: {"model": ErrorOut, "description": "The database or Redis is unreachable"},
}
_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorOut, "description": "not_found: unknown id or not the caller's"},
}
_ERRORS: dict[type[Exception], tuple[int, str]] = {
    tours.TourNotFoundError: (404, "not_found"),
    tours.InvalidWindowError: (422, "invalid_window"),
    tours.ListingNotLiveError: (409, "listing_not_live"),
    tours.WindowOverlapError: (409, "window_overlap"),
    tours.TooManyWindowsError: (409, "too_many_windows"),
    tours.WindowHasToursError: (409, "window_has_tours"),
    tours.SlotUnavailableError: (409, "slot_unavailable"),
    tours.TourExistsError: (409, "tour_exists"),
    tours.TourNotCancellableError: (409, "tour_not_cancellable"),
}


def _http(exc: Exception) -> HTTPException:
    status, detail = _ERRORS[type(exc)]
    return HTTPException(status_code=status, detail=detail)


def _conflict(description: str) -> dict[int | str, dict[str, Any]]:
    return {409: {"model": ErrorOut, "description": description}}


def _tour_out(row: Row[Any]) -> TourOut:
    return TourOut(id=row.id, starts_at=row.starts_at, ends_at=row.ends_at, status=row.status)


def _window_out(w: tours.Window | TourWindow, booked: list[tours.BookedSlot]) -> TourWindowOut:
    return TourWindowOut(
        id=w.id,
        starts_at=w.starts_at,
        ends_at=w.ends_at,
        slot_minutes=w.slot_minutes,
        booked=[
            BookedSlotOut(
                tour_id=b.tour_id,
                starts_at=b.starts_at,
                seeker_name=b.seeker_name,
                conversation_id=b.conversation_id,
            )
            for b in booked
        ],
    )


@router.get(
    "/listings/{listing_id}/tour-windows",
    response_model=TourWindowsOut,
    responses={**_SESSION, **_NOT_FOUND},
)
def list_windows(listing_id: uuid.UUID, user: UserDep, db: DbDep) -> TourWindowsOut:
    try:
        live, windows = tours.list_windows(db, user, listing_id)
    except tours.TourNotFoundError as exc:
        raise _http(exc) from None
    return TourWindowsOut(listing_live=live, windows=[_window_out(w, w.booked) for w in windows])


@router.post(
    "/listings/{listing_id}/tour-windows",
    status_code=201,
    response_model=TourWindowOut,
    responses={
        **_SESSION,
        **_NOT_FOUND,
        **_conflict("listing_not_live, window_overlap or too_many_windows"),
        422: {"description": "invalid_window, or a malformed id or body (list `detail`)"},
        **limits.RATE_LIMITED,
    },
)
def create_window(
    listing_id: uuid.UUID, body: TourWindowIn, user: UserDep, db: DbDep, r: RedisDep
) -> TourWindowOut:
    limits.check(r, user.id, limits.WRITE)
    try:
        window = tours.create_window(db, user, listing_id, body)
    except (
        tours.InvalidWindowError,
        tours.TourNotFoundError,
        tours.ListingNotLiveError,
        tours.WindowOverlapError,
        tours.TooManyWindowsError,
    ) as exc:
        raise _http(exc) from None
    return _window_out(window, [])


@router.delete(
    "/tour-windows/{window_id}",
    status_code=204,
    responses={
        **_SESSION,
        **_NOT_FOUND,
        **_conflict("window_has_tours: it holds an upcoming booked tour"),
        **limits.RATE_LIMITED,
    },
)
def delete_window(window_id: uuid.UUID, user: UserDep, db: DbDep, r: RedisDep) -> Response:
    limits.check(r, user.id, limits.WRITE)
    try:
        tours.delete_window(db, user, window_id)
    except (tours.TourNotFoundError, tours.WindowHasToursError) as exc:
        raise _http(exc) from None
    return Response(status_code=204)


@router.get(
    "/applications/{application_id}/tour-slots",
    response_model=TourSlotsOut,
    responses={
        **_SESSION,
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown id, another account's, or not shortlisted",
        },
    },
)
def tour_slots(application_id: uuid.UUID, user: UserDep, db: DbDep) -> TourSlotsOut:
    try:
        result = tours.slots_for(db, user, application_id)
    except tours.TourNotFoundError as exc:
        raise _http(exc) from None
    return TourSlotsOut(
        listing_live=result.listing_live,
        slots=[SlotOut(starts_at=s, ends_at=e) for s, e in result.slots],
        tour=None if result.tour is None else _tour_out(result.tour),
    )


@router.post(
    "/applications/{application_id}/tour",
    status_code=201,
    response_model=TourOut,
    responses={
        **_SESSION,
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown id, another account's, or not shortlisted",
        },
        **_conflict("listing_not_live, tour_exists (move it instead) or slot_unavailable"),
        **limits.RATE_LIMITED,
    },
)
def book(
    application_id: uuid.UUID, body: TourStartIn, user: UserDep, db: DbDep, r: RedisDep
) -> TourOut:
    limits.check(r, user.id, limits.WRITE, limits.TOUR)
    try:
        tour, change = tours.book(db, user, application_id, body.starts_at)
    except (
        tours.TourNotFoundError,
        tours.ListingNotLiveError,
        tours.TourExistsError,
        tours.SlotUnavailableError,
    ) as exc:
        raise _http(exc) from None
    tours.announce(r, [change])
    return _tour_out(tour)


@router.post(
    "/tours/{tour_id}/reschedule",
    response_model=TourOut,
    responses={
        **_SESSION,
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown id, not the caller's as its seeker, or the "
            "application is not shortlisted",
        },
        **_conflict("listing_not_live, tour_not_cancellable or slot_unavailable"),
        **limits.RATE_LIMITED,
    },
)
def reschedule(
    tour_id: uuid.UUID, body: TourStartIn, user: UserDep, db: DbDep, r: RedisDep
) -> TourOut:
    limits.check(r, user.id, limits.WRITE, limits.TOUR)
    try:
        tour, change = tours.reschedule(db, user, tour_id, body.starts_at)
    except (
        tours.TourNotFoundError,
        tours.TourNotCancellableError,
        tours.ListingNotLiveError,
        tours.SlotUnavailableError,
    ) as exc:
        raise _http(exc) from None
    tours.announce(r, [change])
    return _tour_out(tour)


@router.post(
    "/tours/{tour_id}/cancel",
    response_model=TourOut,
    responses={
        **_SESSION,
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown id, or the caller is neither its seeker nor the "
            "listing's owner",
        },
        **_conflict("tour_not_cancellable: already cancelled, or started"),
        **limits.RATE_LIMITED,
    },
)
def cancel(tour_id: uuid.UUID, user: UserDep, db: DbDep, r: RedisDep) -> TourOut:
    limits.check(r, user.id, limits.WRITE, limits.TOUR)
    try:
        tour, change = tours.cancel(db, user, tour_id)
    except (tours.TourNotFoundError, tours.TourNotCancellableError) as exc:
        raise _http(exc) from None
    tours.announce(r, [change])
    return _tour_out(tour)
