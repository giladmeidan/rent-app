"""Flatmates (spec 0008d; PRODUCT.md "Flatmates"): the owner of a room listing shares an invite
link, and a signed-in user who opens it and confirms joins that room's flat. From then on every chat
about a **room** application to the listing includes them, from the moment they joined
(`services/chat.py`). Flatmates chat only: they never see the inbox, people browse or a profile.

Rules:
- One live link per listing. The token is `secrets.token_urlsafe(32)` (43 characters); only its
  sha256 hex (`services/auth.py::_token_hash`, as session tokens) reaches Postgres, in
  `listings.flatmate_invite_hash`. Creating a link again rotates it (the old token stops working);
  disabling it sets the hash to NULL. Only a room can have one (an apartment is a 404, and a switch
  to an apartment turns the link off, `services/listings.py`).
- The token is only ever sent in a POST body (`InviteTokenIn`), never in a URL: uvicorn's access
  log records full paths.
- Previewing and joining are rate limited per user (`FLATMATE_RATE_LIMIT_HOUR`, one counter for
  both): every authenticated attempt counts, found or not, so tokens cannot be scanned cheaply.
- Joining locks the listing row (`SELECT ... FOR UPDATE` by hash) before it counts the members and
  inserts, so two concurrent joins at `FLATMATES_MAX - 1` members cannot both pass the bound. The
  owner cannot join their own listing (`OwnListingError`); someone with a submitted or shortlisted
  application to it must withdraw first (`AlreadyAppliedError`), and a declined applicant cannot
  join (`DeclinedError`; Gilad, 2026-11-11); a withdrawn application does not block. Every path that
  creates an application takes `FOR KEY SHARE` on the listing first and re-tests membership after
  it (`services/applications.py`, `services/people.py`), so a join and an apply racing each other
  never leave the caller both. A member joining again keeps their membership and its `joined_at`
  (idempotent).
- The owner's removal of a flatmate also turns the link off in the same transaction, so a removed
  flatmate cannot re-join with the link they still hold; leaving does not touch the link. Both
  delete that user's `conversation_reads` rows for the listing's conversations. A re-join is a new
  membership with a new `joined_at`, so the history restarts.
- Ownership: every owner query carries `owner_id = :owner`, so another owner's listing is the same
  404 as an unknown id (`ListingNotFoundError`)."""

import secrets
import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import Row, delete, exists, func, insert, select, update
from sqlalchemy.orm import Session, aliased

from app.models import Application, ConversationRead, Listing, ListingFlatmate, User
from app.redis_client import RedisClient
from app.services.applications import AlreadyAppliedError
from app.services.auth import _token_hash
from app.services.listings import ListingNotFoundError
from app.services.rate_limit import count_or_raise

# The `FlatmatesCount` bound (spec 0007a): at most 7 people share a room's flat with its lister.
FLATMATES_MAX = 7

# Per user, previews and joins together (`rl:flatmate:user:*`).
FLATMATE_RATE_LIMIT_HOUR = 20
FLATMATE_RATE_WINDOW_S = 3600

_TOKEN_BYTES = 32


class OwnListingError(Exception):
    """The caller owns the listing the invite is for."""


class FlatmatesFullError(Exception):
    """The listing already has `FLATMATES_MAX` flatmates."""


class DeclinedError(Exception):
    """The caller's application to the listing was declined (Gilad, 2026-11-11: the link may reach
    a declined applicant from a flatmate rather than the owner)."""


def _count_attempt(r: RedisClient, user: User) -> None:
    count_or_raise(
        r, ((f"rl:flatmate:user:{user.id}", FLATMATE_RATE_LIMIT_HOUR, FLATMATE_RATE_WINDOW_S),)
    )


def create_invite(db: Session, owner: User, listing_id: uuid.UUID) -> str:
    """Create (or rotate) the invite link of one of `owner`'s room listings, whatever its status,
    and return the new token; the old one stops working. Raises `ListingNotFoundError` (unknown,
    another owner's, an apartment). One UPDATE. Commits."""
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    try:
        updated = db.scalar(
            update(Listing)
            .where(
                Listing.id == listing_id,
                Listing.owner_id == owner.id,
                Listing.listing_type == "room",
            )
            .values(flatmate_invite_hash=_token_hash(token))
            .returning(Listing.id)
            .execution_options(synchronize_session=False)
        )
        if updated is None:
            raise ListingNotFoundError
        db.commit()
    except Exception:
        db.rollback()
        raise
    return token


def disable_invite(db: Session, owner: User, listing_id: uuid.UUID) -> None:
    """Turn off the invite link of one of `owner`'s listings (a no-op without one). Raises
    `ListingNotFoundError` (unknown, another owner's). One UPDATE. Commits."""
    try:
        updated = db.scalar(
            update(Listing)
            .where(Listing.id == listing_id, Listing.owner_id == owner.id)
            .values(flatmate_invite_hash=None)
            .returning(Listing.id)
            .execution_options(synchronize_session=False)
        )
        if updated is None:
            raise ListingNotFoundError
        db.commit()
    except Exception:
        db.rollback()
        raise


def preview(db: Session, r: RedisClient, me: User, token: str) -> Row[Any]:
    """The room a live invite token is for, as `me` sees it before joining: a row of the `Listing`,
    `owner_name` and `member` (whether `me` is already a flatmate there). Counts the attempt first
    (`RateLimitedError`), then raises `ListingNotFoundError` (an unknown, rotated or disabled token,
    or an apartment) or `OwnListingError`. One SELECT after the limiter."""
    _count_attempt(r, me)
    owner = aliased(User, name="owner")
    member = exists().where(
        ListingFlatmate.listing_id == Listing.id, ListingFlatmate.user_id == me.id
    )
    row = db.execute(
        select(Listing, owner.display_name.label("owner_name"), member.label("member"))
        .join(owner, owner.id == Listing.owner_id)
        .where(Listing.flatmate_invite_hash == _token_hash(token), Listing.listing_type == "room")
    ).one_or_none()
    if row is None:
        raise ListingNotFoundError
    if row.Listing.owner_id == me.id:
        raise OwnListingError
    return row


def join(db: Session, r: RedisClient, me: User, token: str) -> uuid.UUID:
    """Make `me` a flatmate of the room a live invite token is for and return its id. Counts the
    attempt first (`RateLimitedError`); then locks the listing by hash (`ListingNotFoundError` for
    an unknown, rotated or disabled token or an apartment), and raises `OwnListingError`,
    `AlreadyAppliedError` (a submitted or shortlisted application of `me` to it), `DeclinedError`
    (a declined one) or `FlatmatesFullError`. A
    member gets the listing id again, membership untouched. Commits."""
    _count_attempt(r, me)
    try:
        listing = db.execute(
            select(Listing.id, Listing.owner_id)
            .where(
                Listing.flatmate_invite_hash == _token_hash(token),
                Listing.listing_type == "room",
            )
            .with_for_update()
        ).one_or_none()
        if listing is None:
            raise ListingNotFoundError
        if listing.owner_id == me.id:
            raise OwnListingError
        # With the listing locked, a concurrent join of the same listing waits here and then sees
        # this one's committed row (READ COMMITTED: each statement takes a new snapshot).
        state = db.execute(
            select(
                exists()
                .where(ListingFlatmate.listing_id == listing.id, ListingFlatmate.user_id == me.id)
                .label("member"),
                select(Application.status)
                .where(Application.listing_id == listing.id, Application.seeker_id == me.id)
                .scalar_subquery()
                .label("application_status"),
                select(func.count())
                .select_from(ListingFlatmate)
                .where(ListingFlatmate.listing_id == listing.id)
                .scalar_subquery()
                .label("members"),
            )
        ).one()
        if not state.member:
            if state.application_status in ("submitted", "shortlisted"):
                raise AlreadyAppliedError
            if state.application_status == "declined":
                raise DeclinedError
            if state.members >= FLATMATES_MAX:
                raise FlatmatesFullError
            db.execute(insert(ListingFlatmate).values(listing_id=listing.id, user_id=me.id))
        db.commit()
    except Exception:
        db.rollback()
        raise
    listing_id: uuid.UUID = listing.id
    return listing_id


def list_flatmates(db: Session, owner: User, listing_id: uuid.UUID) -> Sequence[Row[Any]]:
    """The flatmates of one of `owner`'s listings (any type, any status), oldest join first: rows of
    the membership `id`, `display_name` and `joined_at`. Raises `ListingNotFoundError` (unknown,
    another owner's). One statement: the listing, outer-joined to its memberships."""
    rows = db.execute(
        select(ListingFlatmate.id, User.display_name, ListingFlatmate.joined_at)
        .select_from(Listing)
        .outerjoin(ListingFlatmate, ListingFlatmate.listing_id == Listing.id)
        .outerjoin(User, User.id == ListingFlatmate.user_id)
        .where(Listing.id == listing_id, Listing.owner_id == owner.id)
        .order_by(ListingFlatmate.joined_at, ListingFlatmate.id)
    ).all()
    if not rows:
        raise ListingNotFoundError
    return [row for row in rows if row.id is not None]


def _delete_reads(db: Session, listing_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Drop `user_id`'s flatmate read markers on the listing's conversations (an application chat's
    id is its application's, by CHECK: `ck_conversations_application_id`)."""
    db.execute(
        delete(ConversationRead)
        .where(
            ConversationRead.user_id == user_id,
            ConversationRead.conversation_id.in_(
                select(Application.id).where(Application.listing_id == listing_id)
            ),
        )
        .execution_options(synchronize_session=False)
    )


def remove_flatmate(
    db: Session, owner: User, listing_id: uuid.UUID, flatmate_id: uuid.UUID
) -> None:
    """Remove membership `flatmate_id` from one of `owner`'s listings: the flatmate's chat access
    ends at once, their read markers there are deleted, and the listing's invite link is turned off
    (they may still hold it). Raises `ListingNotFoundError` (an unknown membership, another
    listing's, or a listing that is not the caller's). Three statements. Commits."""
    try:
        user_id = db.scalar(
            delete(ListingFlatmate)
            .where(
                ListingFlatmate.id == flatmate_id,
                ListingFlatmate.listing_id == listing_id,
                Listing.id == ListingFlatmate.listing_id,
                Listing.owner_id == owner.id,
            )
            .returning(ListingFlatmate.user_id)
            .execution_options(synchronize_session=False)
        )
        if user_id is None:
            raise ListingNotFoundError
        _delete_reads(db, listing_id, user_id)
        db.execute(
            update(Listing)
            .where(Listing.id == listing_id)
            .values(flatmate_invite_hash=None)
            .execution_options(synchronize_session=False)
        )
        db.commit()
    except Exception:
        db.rollback()
        raise


def my_flats(db: Session, me: User) -> Sequence[Row[Any]]:
    """Every flat `me` is a flatmate of, newest join first: rows of the `Listing`, `owner_name` and
    `joined_at`. One statement."""
    owner = aliased(User, name="owner")
    return db.execute(
        select(Listing, owner.display_name.label("owner_name"), ListingFlatmate.joined_at)
        .select_from(ListingFlatmate)
        .join(Listing, Listing.id == ListingFlatmate.listing_id)
        .join(owner, owner.id == Listing.owner_id)
        .where(ListingFlatmate.user_id == me.id)
        .order_by(ListingFlatmate.joined_at.desc(), ListingFlatmate.id)
    ).all()


def leave(db: Session, me: User, listing_id: uuid.UUID) -> None:
    """`me` leaves the flat of `listing_id`, if a member (reveals nothing either way): chat access
    ends at once and their read markers there are deleted; the invite link stays. Two statements.
    Commits."""
    try:
        db.execute(
            delete(ListingFlatmate)
            .where(ListingFlatmate.listing_id == listing_id, ListingFlatmate.user_id == me.id)
            .execution_options(synchronize_session=False)
        )
        _delete_reads(db, listing_id, me.id)
        db.commit()
    except Exception:
        db.rollback()
        raise
