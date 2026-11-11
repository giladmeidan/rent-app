"""Owner listings: create, list own (with applicant counts, 0004c), edit / pause / resume (spec
0002a).

Cap (PRODUCT.md "Owner cap: 3 active listings per account, admin may raise"): an owner may have at
most `users.listing_cap` **live** listings (`status = 'active' AND expires_at > now()`). Creating
or resuming one locks the owner's `users` row (`SELECT … FOR UPDATE`) and counts inside the same
transaction, so two concurrent creates serialise and the cap holds (AC9).

Ownership: every query by listing id also carries `owner_id = :owner` in its `WHERE`, so another
owner's listing is indistinguishable from an unknown id (`ListingNotFoundError`, a 404).

Timestamps (`updated_at`, `expires_at`) come from the database's `now()`, never from Python.

Room fields (spec 0007a): `gender_preference`, `flatmates_count`, `flatmate_ages` and `lifestyle`.
`ListingIn` checks them on create and on a PATCH's merged row: an apartment holds
`ROOM_FIELD_DEFAULTS`, a room needs a count, ages never outnumber it. A switch to an apartment
resets the four server-side before validation (sent room values still win, so a non-default one is
a 422), and any `listing_type` change writes all four. A pause or resume of a legacy room (NULL
count) is not an edit and is let through; every other PATCH of it must send `flatmates_count`.

Flatmates (spec 0008d): a switch to an apartment also turns the listing's invite link off
(`flatmate_invite_hash = NULL`); its memberships stay.
"""

import datetime as dt
import uuid
from collections.abc import Sequence
from typing import Any

from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import func, insert, select, update
from sqlalchemy.orm import Session

from app.models import Application, Area, Listing, ListingFlatmate, RoomPair, User
from app.schemas.listing import ROOM_FIELD_DEFAULTS, ListingIn, ListingPatch

LISTING_TTL_DAYS = 90
# Changing any of these resets the listing's map location to `pending` (spec 0003c).
_ADDRESS_FIELDS = ("city", "street", "area_id")


class ListingCapReachedError(Exception):
    """The owner already has `listing_cap` live listings."""


class UnknownAreaError(Exception):
    """`area_id` is not an active launch area."""


class ListingNotFoundError(Exception):
    """No listing with this id belongs to the caller (unknown id or another owner's listing)."""


def _check_area(db: Session, area_id: uuid.UUID) -> None:
    active = db.scalar(select(Area.id).where(Area.id == area_id, Area.is_active.is_(True)))
    if active is None:
        raise UnknownAreaError


def _lock_owner_cap(db: Session, owner_id: uuid.UUID) -> int:
    """Lock the owner's `users` row until the transaction ends and return its `listing_cap`."""
    return db.execute(
        select(User.listing_cap).where(User.id == owner_id).with_for_update()
    ).scalar_one()


def _count_live_listings(db: Session, owner_id: uuid.UUID) -> int:
    """The owner's live listings. Called with the owner row locked (`_lock_owner_cap`)."""
    return db.execute(
        select(func.count())
        .select_from(Listing)
        .where(
            Listing.owner_id == owner_id,
            Listing.status == "active",
            Listing.expires_at > func.now(),
        )
    ).scalar_one()


def _enforce_cap(db: Session, owner_id: uuid.UUID) -> None:
    cap = _lock_owner_cap(db, owner_id)
    if _count_live_listings(db, owner_id) >= cap:
        raise ListingCapReachedError


def create_listing(db: Session, owner: User, data: ListingIn) -> Listing:
    """Insert an active listing expiring `LISTING_TTL_DAYS` from now. Raises `UnknownAreaError`
    or `ListingCapReachedError` (nothing written). Commits."""
    try:
        _check_area(db, data.area_id)
        _enforce_cap(db, owner.id)
        listing = db.scalars(
            insert(Listing)
            .values(
                **data.model_dump(),
                owner_id=owner.id,
                expires_at=func.now() + dt.timedelta(days=LISTING_TTL_DAYS),
            )
            .returning(Listing)
        ).one()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return listing


def list_own_listings(db: Session, owner: User) -> Sequence[tuple[Listing, int, int, int, int]]:
    """Every listing of `owner` (active, paused and expired), newest first, with its applicant
    count (every application but withdrawn ones), new-applicant count (`submitted`; spec 0004c),
    liked-me count (its pending seeker likes, `services/people.py`; 0 for an apartment; spec
    0008a) and flatmate count (spec 0008d). One statement: the counts are correlated scalar
    subqueries, each an index range scan on `uq_applications_listing_seeker (listing_id,
    seeker_id)`, `uq_room_pairs_listing_seeker (listing_id, seeker_id)` or
    `uq_listing_flatmates_listing_user (listing_id, user_id)`."""
    # Imported here: `services/people.py` imports this module (through `services/search.py`).
    from app.services.people import pending_seeker_like

    applicants = (
        select(func.count())
        .where(Application.listing_id == Listing.id, Application.status != "withdrawn")
        .scalar_subquery()
    )
    new_applicants = (
        select(func.count())
        .where(Application.listing_id == Listing.id, Application.status == "submitted")
        .scalar_subquery()
    )
    liked_me = (
        select(func.count()).select_from(RoomPair).where(pending_seeker_like()).scalar_subquery()
    )
    flatmates = (
        select(func.count())
        .select_from(ListingFlatmate)
        .where(ListingFlatmate.listing_id == Listing.id)
        .scalar_subquery()
    )
    rows = db.execute(
        select(Listing, applicants, new_applicants, liked_me, flatmates)
        .where(Listing.owner_id == owner.id)
        .order_by(Listing.created_at.desc(), Listing.id)
    ).tuples()
    return rows.all()


def _merged(listing: Listing, patch: ListingPatch) -> ListingIn:
    """The listing as it would be after `patch`, re-validated as a whole (cross-field rules).
    A switch to an apartment first resets the room fields (`ROOM_FIELD_DEFAULTS`); a status-only
    PATCH (pause / resume) does not need a room's `flatmates_count`. A failure is the request's
    fault: FastAPI's 422 with a list `detail`."""
    current: dict[str, Any] = {name: getattr(listing, name) for name in ListingIn.model_fields}
    sent = patch.model_dump(include=patch.model_fields_set - {"status"})
    if sent.get("listing_type") == "apartment":
        current.update(ROOM_FIELD_DEFAULTS)
    try:
        return ListingIn.model_validate({**current, **sent}, context={"status_only": not sent})
    except ValidationError as exc:
        raise RequestValidationError(
            [{**error, "loc": ("body", *error["loc"])} for error in exc.errors()]
        ) from None


def update_listing(db: Session, owner: User, listing_id: uuid.UUID, patch: ListingPatch) -> Listing:
    """Apply the sent fields of `patch` to the caller's listing and refresh `updated_at`. Resuming
    a paused listing re-applies the cap; `expires_at` never moves. Raises `ListingNotFoundError`,
    `UnknownAreaError`, `ListingCapReachedError` or `RequestValidationError` (nothing written).
    Commits."""
    try:
        # Row lock: a concurrent PATCH of the same listing waits and then merges onto this one's
        # result, so two individually valid patches can never combine into a CHECK failure.
        listing = db.scalar(
            select(Listing)
            .where(Listing.id == listing_id, Listing.owner_id == owner.id)
            .with_for_update()
        )
        if listing is None:
            raise ListingNotFoundError
        data = _merged(listing, patch)
        if "area_id" in patch.model_fields_set:
            _check_area(db, data.area_id)
        if patch.status == "active" and listing.status == "paused":
            # The paused listing is not live, so the count is of the others only.
            _enforce_cap(db, owner.id)
        values: dict[str, Any] = {
            name: getattr(data, name) for name in patch.model_fields_set - {"status"}
        }
        if "listing_type" in patch.model_fields_set:
            # Room -> apartment writes the reset; apartment -> room the merged (sent or default).
            values.update({name: getattr(data, name) for name in ROOM_FIELD_DEFAULTS})
            if data.listing_type == "apartment":
                # An apartment has no invite link (spec 0008d). Memberships stay: they reach room
                # applications only (`services/chat.py`).
                values["flatmate_invite_hash"] = None
        if patch.status is not None:
            values["status"] = patch.status
        if any(getattr(data, name) != getattr(listing, name) for name in _ADDRESS_FIELDS):
            # A new address: the worker geocodes it again (spec 0003c); the old point is dropped.
            values.update(location=None, geocode_status="pending", geocode_attempts=0)
        updated = db.scalars(
            update(Listing)
            .where(Listing.id == listing_id, Listing.owner_id == owner.id)
            .values(**values, updated_at=func.now())
            .returning(Listing),
            execution_options={"populate_existing": True},
        ).one()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return updated
