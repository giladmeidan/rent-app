"""Owner listings: create, list own (with applicant counts, 0004c), edit / pause / resume (spec
0002a), renew (spec 0011a).

Cap (PRODUCT.md "Owner cap: 3 active listings per account, admin may raise"): an owner may have at
most `users.listing_cap` **live** listings (`status = 'active' AND expires_at > now()`). Creating
or resuming one locks the owner's `users` row (`SELECT … FOR UPDATE`) and counts inside the same
transaction, so two concurrent creates serialise and the cap holds (AC9).

Ownership: every query by listing id also carries `owner_id = :owner` in its `WHERE`, so another
owner's listing is indistinguishable from an unknown id (`ListingNotFoundError`, a 404).

Timestamps (`updated_at`, `expires_at`) come from the database's `now()`, never from Python. A PATCH
never moves `expires_at`; only `renew_listing` does, and a PATCH of a listing past `expires_at` is
refused (`ListingExpiredError`, spec 0011a).

A listing removed by homie (`removed_at`, spec 0012a; always paused) refuses every PATCH and a
renewal (`ListingRemovedError`, checked on the locked row before anything else); `set_closure` is
still allowed.

Room fields (spec 0007a): `gender_preference`, `flatmates_count`, `flatmate_ages` and `lifestyle`.
`ListingIn` checks them on create and on a PATCH's merged row: an apartment holds
`ROOM_FIELD_DEFAULTS`, a room needs a count, ages never outnumber it. A listing's type is fixed at
create (spec 0010a): `ListingPatch` has no `listing_type` and forbids unknown keys. A pause or
resume of a legacy room (NULL count) is not an edit and is let through; every other PATCH of it
must send `flatmates_count`.

Price signals (spec 0014b): every price a listing has is a `listing_price_changes` row, written in
the listing's own transaction (on create, and on a PATCH that changes `price_ils`). The closure
answer (`set_closure`) is set only while the listing is not live and does not move `updated_at`;
a resume (a paused listing PATCHed to `active`) or a renewal clears it.
"""

import datetime as dt
import uuid
from collections.abc import Sequence
from typing import Any

from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import and_, func, insert, select, update
from sqlalchemy.orm import Session

from app.models import Application, Area, Listing, ListingFlatmate, ListingPriceChange, User
from app.schemas.listing import ClosureIn, ListingIn, ListingPatch

LISTING_TTL_DAYS = 90
# Policy (PRODUCT.md "Trust (MVP)"): a listing renews from this many days before `expires_at`.
RENEWAL_WINDOW_DAYS = 7
# Changing any of these resets the listing's map location to `pending` (spec 0003c).
_ADDRESS_FIELDS = ("city", "street", "area_id")


class ListingCapReachedError(Exception):
    """The owner already has `listing_cap` live listings."""


class UnknownAreaError(Exception):
    """`area_id` is not an active launch area."""


class ListingNotFoundError(Exception):
    """No listing with this id belongs to the caller (unknown id or another owner's listing)."""


class RenewalNotOpenError(Exception):
    """More than `RENEWAL_WINDOW_DAYS` before `expires_at`: too early to renew."""


class ListingExpiredError(Exception):
    """Past `expires_at`: not patchable; renew it."""


class ListingRemovedError(Exception):
    """Removed by homie (`removed_at` set, spec 0012a): the owner cannot resume, renew, edit or
    change its photos."""


class ListingLiveError(Exception):
    """The listing is live (`status = 'active' AND expires_at > now()`): no closure answer yet."""


def _check_area(db: Session, area_id: uuid.UUID) -> None:
    active = db.scalar(select(Area.id).where(Area.id == area_id, Area.is_active.is_(True)))
    if active is None:
        raise UnknownAreaError


def _lock_owner_cap(db: Session, owner_id: uuid.UUID) -> int:
    """Lock the owner's `users` row until the transaction ends and return its `listing_cap`."""
    # shortcut: not checked in create; a create that waited here on DELETE /me inserts a listing
    # for the tombstone, which no public read shows (`visibility.owner_not_suspended` excludes
    # deleted owners, spec 0013c); add deleted_at IS NULL to this lock if such rows are ever seen.
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
        db.execute(
            insert(ListingPriceChange).values(listing_id=listing.id, price_ils=data.price_ils)
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return listing


def list_own_listings(db: Session, owner: User) -> Sequence[tuple[Listing, int, int, int]]:
    """Every listing of `owner` (active, paused and expired), newest first, with its applicant
    count (every application but withdrawn ones), new-applicant count (`submitted`; spec 0004c)
    and flatmate count (spec 0008d). One statement: the counts are correlated scalar
    subqueries, each an index range scan on `uq_applications_listing_seeker (listing_id,
    seeker_id)` or `uq_listing_flatmates_listing_user (listing_id, user_id)`."""
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
    flatmates = (
        select(func.count())
        .select_from(ListingFlatmate)
        .where(ListingFlatmate.listing_id == Listing.id)
        .scalar_subquery()
    )
    rows = db.execute(
        select(Listing, applicants, new_applicants, flatmates)
        .where(Listing.owner_id == owner.id)
        .order_by(Listing.created_at.desc(), Listing.id)
    ).tuples()
    return rows.all()


def _merged(listing: Listing, patch: ListingPatch) -> ListingIn:
    """The listing as it would be after `patch`, re-validated as a whole (cross-field rules).
    A status-only PATCH (pause / resume) does not need a room's `flatmates_count`; a stored NULL
    `shelter` (a listing from before 0015b) is kept (`stored_row`). A failure is the
    request's fault: FastAPI's 422 with a list `detail`."""
    current: dict[str, Any] = {name: getattr(listing, name) for name in ListingIn.model_fields}
    sent = patch.model_dump(include=patch.model_fields_set - {"status"})
    try:
        return ListingIn.model_validate(
            {**current, **sent}, context={"status_only": not sent, "stored_row": True}
        )
    except ValidationError as exc:
        raise RequestValidationError(
            [{**error, "loc": ("body", *error["loc"])} for error in exc.errors()]
        ) from None


def update_listing(db: Session, owner: User, listing_id: uuid.UUID, patch: ListingPatch) -> Listing:
    """Apply the sent fields of `patch` to the caller's listing and refresh `updated_at`. Resuming
    a paused listing re-applies the cap; a PATCH never moves `expires_at`; only `renew_listing`
    does. Raises `ListingNotFoundError`, `ListingRemovedError` (checked first),
    `ListingExpiredError` (past `expires_at`, checked next), `UnknownAreaError`,
    `ListingCapReachedError` or `RequestValidationError` (nothing written). Commits."""
    try:
        # Row lock: a concurrent PATCH of the same listing waits and then merges onto this one's
        # result, so two individually valid patches can never combine into a CHECK failure.
        row = db.execute(
            select(Listing, Listing.expires_at <= func.now())
            .where(Listing.id == listing_id, Listing.owner_id == owner.id)
            .with_for_update()
        ).one_or_none()
        if row is None:
            raise ListingNotFoundError
        listing, expired = row
        if listing.removed_at is not None:
            raise ListingRemovedError
        if expired:
            raise ListingExpiredError
        data = _merged(listing, patch)
        if "area_id" in patch.model_fields_set:
            _check_area(db, data.area_id)
        values: dict[str, Any] = {
            name: getattr(data, name) for name in patch.model_fields_set - {"status"}
        }
        if patch.status == "active" and listing.status == "paused":
            # The paused listing is not live, so the count is of the others only.
            # shortcut: resume locks listing then user, DELETE /me user then listing (spec 0013c);
            # a race can deadlock and Postgres aborts one (a 500, nothing lost), re-order if seen.
            _enforce_cap(db, owner.id)
            # Live again, so it was not rented: the closure answer goes (spec 0014b).
            values.update(close_reason=None, final_rent_ils=None, closed_at=None)
        price_changed = data.price_ils != listing.price_ils
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
        if price_changed:
            db.execute(
                insert(ListingPriceChange).values(
                    listing_id=listing_id, price_ils=updated.price_ils
                )
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return updated


def renew_listing(db: Session, owner: User, listing_id: uuid.UUID) -> Listing:
    """Make the caller's listing live for `LISTING_TTL_DAYS` from now and clear its closure answer.
    Opens `RENEWAL_WINDOW_DAYS` before `expires_at` and stays open after it. A listing that is not
    live takes a cap slot; a live one already holds its own. Raises `ListingNotFoundError`,
    `ListingRemovedError`, `RenewalNotOpenError` or `ListingCapReachedError` (nothing written).
    Commits."""
    try:
        # Lock order as `update_listing`: the listing row, then the owner row (`_enforce_cap`).
        row = db.execute(
            select(
                Listing.removed_at.is_not(None),
                Listing.expires_at > func.now() + dt.timedelta(days=RENEWAL_WINDOW_DAYS),
                and_(Listing.status == "active", Listing.expires_at > func.now()),
            )
            .where(Listing.id == listing_id, Listing.owner_id == owner.id)
            .with_for_update()
        ).one_or_none()
        if row is None:
            raise ListingNotFoundError
        removed, too_early, live = row
        if removed:
            raise ListingRemovedError
        if too_early:
            raise RenewalNotOpenError
        if not live:
            # Not live, so the count is of the others only, as a resume.
            _enforce_cap(db, owner.id)
        renewed = db.scalars(
            update(Listing)
            .where(Listing.id == listing_id, Listing.owner_id == owner.id)
            .values(
                status="active",
                expires_at=func.now() + dt.timedelta(days=LISTING_TTL_DAYS),
                close_reason=None,
                final_rent_ils=None,
                closed_at=None,
                updated_at=func.now(),
            )
            .returning(Listing),
            execution_options={"populate_existing": True},
        ).one()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return renewed


def set_closure(db: Session, owner: User, listing_id: uuid.UUID, data: ClosureIn) -> None:
    """Store what happened to the caller's listing, replacing any earlier answer, with `closed_at =
    now()`; `updated_at` does not move. Raises `ListingNotFoundError` or `ListingLiveError` (nothing
    written). Commits."""
    try:
        # Row lock, as `update_listing`: serialises with a concurrent resume.
        live = db.scalar(
            select(and_(Listing.status == "active", Listing.expires_at > func.now()))
            .where(Listing.id == listing_id, Listing.owner_id == owner.id)
            .with_for_update()
        )
        if live is None:
            raise ListingNotFoundError
        if live:
            raise ListingLiveError
        db.execute(
            update(Listing)
            .where(Listing.id == listing_id)
            .values(
                close_reason=data.reason, final_rent_ils=data.final_rent_ils, closed_at=func.now()
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
