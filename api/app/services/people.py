"""People browse and invites (spec 0008a, 0010l; PRODUCT.md "People & likes"): the owner of a
live room listing pages through the seekers who are looking for a room there and opted in, and
likes them. A lister's like is an **invite**: when that seeker applies to the room, the application
is shortlisted at once with `source = 'like'` and its chat opens (`services/applications.py`, the
single writer of applications). A seeker has no room-like of their own (spec 0010l): on a room
their one action is the application.

This module is the only writer of `room_pairs`. Its terms, each stated once here:

- A **candidate** of room listing `L` is a `seeker_profiles` row `P` with the looking part filled
  and a room section (`gender` set) that `room_fit(L, P)` is true for, that is not `L`'s owner nor a
  flatmate of `L` (`flatmate_of`, spec 0008d), that opted in (`people_visible`), and that has no
  non-withdrawn application to `L` (`open_application`): declined, submitted and shortlisted
  applicants live in the inbox, and a decline is final. There is no area filter: another area only
  lowers the `area` criterion.
- An **invite** is a pair of `L` with `lister_liked_at` set. An application consumes it
  (`consume_invite`), so after a withdraw the lister has to like again.

Privacy (NF2; security): a lister never handles a seeker's user id (a person is the pair's id).
The page selects the profile's card columns **by name**, never the `SeekerProfile` entity, so
`budget_max_ils` is never loaded; the match reads it inside its expression only. Every budget
input about a pair reads its `price_ils_seen`, frozen when the pair was created and never updated,
so editing a room's price cannot probe a seeker's budget (an invited application's price snapshot
is that frozen price too).

Concurrency: the like and the apply both take a transaction-scoped advisory lock on the
(listing, seeker) key (`lock_pair_key`) before they touch the pair row, because the row may not
exist yet when an apply starts (people browse inserts it, spec 0010l review): a row lock alone
would let a browse and a like slip in beside an apply that found no row. The like then takes the
pair row's lock with its one write (a conditional UPDATE), and only then runs a **separate**
`SELECT EXISTS` for an application: as a new statement under READ COMMITTED it sees an apply
that committed while this transaction waited, and the like is rolled back with
`AlreadyAppliedError`. An apply reads the pair `FOR UPDATE` (`consume_invite`) **before** it
writes its application, so the lock order is always the key, the pair, then `applications`: an
apply waiting on a like gets the like's committed `lister_liked_at` and shortlists, and a like
waiting on an apply sees the committed application in its post-lock EXISTS. An invite therefore
never outlives an application.

Flatmates (spec 0008d): a flatmate join holds the listing row `FOR UPDATE` while it checks for an
open application and inserts the membership. The like and the apply first take `FOR KEY SHARE` on
the listing row, folded into their listing SELECT, so they wait for a running join; their post-lock
statements then re-test flatmate membership (`_has_application`, and `_fits()` in `like_person`'s
UPDATE; the apply's INSERT ... SELECT), and a join waiting on an apply sees its committed
application. The full lock order is the listing, then the pair, then `applications`, so the join
(listing only) cannot deadlock with them; the full order is the listing, the (listing, seeker)
key, the pair, then `applications`. A caller is never both an applicant and a flatmate."""

import datetime as dt
import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import (
    ColumnElement,
    Exists,
    Row,
    and_,
    exists,
    func,
    literal,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.matching.fit import room_fit
from app.matching.score import match_columns
from app.models import (
    Application,
    Listing,
    ListingFlatmate,
    RoomPair,
    SeekerProfile,
    User,
)
from app.redis_client import RedisClient
from app.schemas.people import PEOPLE_LIMIT, LikeStateOut
from app.services import search as search_service
from app.services.applications import AlreadyAppliedError
from app.services.listings import ListingNotFoundError
from app.services.rate_limit import count_or_raise
from app.services.visibility import not_suspended

# Per user, the lister's likes and person likes (spec 0010h) together (`rl:like:user:*`).
LIKE_RATE_LIMIT_HOUR = 30
LIKE_RATE_WINDOW_S = 3600
LIKE_RATE_LIMIT_DAY = 100
LIKE_RATE_DAY_S = 86_400


class ListingNotLiveError(Exception):
    """The caller's own room listing is paused, expired or in an inactive area (not public)."""


_Id = InstrumentedAttribute[uuid.UUID] | ColumnElement[uuid.UUID] | uuid.UUID


def open_application(listing_id: _Id, seeker_id: _Id) -> Exists:
    """EXISTS a non-withdrawn application of `seeker_id` to `listing_id` (columns or values)."""
    return exists().where(
        Application.listing_id == listing_id,
        Application.seeker_id == seeker_id,
        Application.status != "withdrawn",
    )


def flatmate_of(listing_id: _Id, user_id: _Id) -> Exists:
    """EXISTS a membership of `user_id` in `listing_id`'s flat (spec 0008d; columns or values). A
    flatmate is treated like the listing's owner: they cannot apply to, like, or be liked for it."""
    return exists().where(
        ListingFlatmate.listing_id == listing_id, ListingFlatmate.user_id == user_id
    )


def lock_pair_key(db: Session, listing_id: uuid.UUID, seeker_id: uuid.UUID) -> None:
    """Take the transaction-scoped advisory lock on the (`listing_id`, `seeker_id`) key, held to
    the commit or rollback. Both writers of a pair's invite state take it (the like and the
    apply), after the listing's lock and before the pair's row (see the module docstring). The key
    is a stable 64-bit hash of the two ids. One statement."""
    db.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(literal(f"room_pair:{listing_id}:{seeker_id}"), 0)
            )
        )
    )


def consume_invite(
    db: Session, listing_id: uuid.UUID, seeker_id: uuid.UUID
) -> Row[tuple[uuid.UUID, dt.datetime | None, int]] | None:
    """Read the pair (`listing_id`, `seeker_id`) under its row lock and clear the lister's like,
    in the caller's transaction: an application consumes the invite (spec 0010l), so after a
    withdraw the lister has to like again. Returns the pair's `id`, `lister_liked_at` and
    `price_ils_seen` as they were **before** clearing, or None without a pair (an un-invited
    apply). It first takes the (listing, seeker) key (`lock_pair_key`), so a like of a pair that
    did not exist yet still waits for this apply. `applications._upsert` calls it before its
    application INSERT (the lock order above). Under READ COMMITTED the `FOR UPDATE` waits for a
    running like and returns its committed row. Two statements, plus one UPDATE when there was an
    invite."""
    lock_pair_key(db, listing_id, seeker_id)
    pair = db.execute(
        select(RoomPair.id, RoomPair.lister_liked_at, RoomPair.price_ils_seen)
        .where(RoomPair.listing_id == listing_id, RoomPair.seeker_id == seeker_id)
        .with_for_update(of=RoomPair)
    ).first()
    if pair is not None and pair.lister_liked_at is not None:
        db.execute(
            update(RoomPair)
            .where(RoomPair.id == pair.id)
            .values(lister_liked_at=None)
            .execution_options(synchronize_session=False)
        )
    return pair


def _fits() -> tuple[ColumnElement[bool], ...]:
    """The candidate's conditions on the statement's `SeekerProfile` and `Listing`, without
    opt-in and without the application clause: a personal part, the looking part (spec 0010c: the
    card needs areas and move-in, the score the budget), a true room fit, not the owner, not a
    flatmate (0008d)."""
    return (
        SeekerProfile.gender.is_not(None),
        SeekerProfile.budget_max_ils.is_not(None),
        room_fit(Listing, SeekerProfile).is_(True),
        SeekerProfile.user_id != Listing.owner_id,
        ~flatmate_of(Listing.id, SeekerProfile.user_id),
    )


def _shown() -> ColumnElement[bool]:
    """Opted in (`people_visible`): people browse shows opted-in people only (spec 0010l), and not
    suspended (spec 0012a)."""
    return and_(SeekerProfile.people_visible.is_(True), not_suspended(SeekerProfile.user_id))


def _own_room(db: Session, owner: User, listing_id: uuid.UUID, *, lock: bool = False) -> Listing:
    """The caller's room listing, if it is live. One SELECT, with its public-ness as a correlated
    column (`_public_listings()`, the one visibility rule). Raises `ListingNotFoundError` (unknown,
    another owner's, an apartment) or `ListingNotLiveError` (paused, expired, inactive area).
    `lock`: the SELECT also takes `FOR KEY SHARE` on the listing row (a like, spec 0008d: it waits
    for a flatmate join holding the row `FOR UPDATE`)."""
    live = search_service._public_listings().where(Listing.id == listing_id).exists()
    query = select(Listing, live.label("live")).where(
        Listing.id == listing_id,
        Listing.owner_id == owner.id,
        Listing.listing_type == "room",
    )
    if lock:
        query = query.with_for_update(read=True, key_share=True, of=Listing)
    row = db.execute(query).first()
    if row is None:
        raise ListingNotFoundError
    if not row.live:
        raise ListingNotLiveError
    listing: Listing = row[0]
    return listing


def count_like(r: RedisClient, user: User) -> None:
    """Count one like attempt of `user` against `rl:like:user:*` (`LIKE_RATE_LIMIT_HOUR` /
    `_DAY`): lister likes and person likes (spec 0010h) share it. Raises
    `RateLimitedError`."""
    count_or_raise(
        r,
        (
            (f"rl:like:user:{user.id}", LIKE_RATE_LIMIT_HOUR, LIKE_RATE_WINDOW_S),
            (f"rl:like:user:day:{user.id}", LIKE_RATE_LIMIT_DAY, LIKE_RATE_DAY_S),
        ),
    )


# The card's profile columns, by name (NF2): never the entity, so `budget_max_ils`, `household`,
# pets, smoker, contract, parking and `flatmate_gender` are never loaded.
CARD_COLUMNS = (
    SeekerProfile.gender,
    SeekerProfile.birth_year,
    SeekerProfile.area_ids,
    SeekerProfile.move_in_date,
    SeekerProfile.move_in_flexible,
    SeekerProfile.lifestyle,
    SeekerProfile.about_me,
)


def list_people(
    db: Session, owner: User, listing_id: uuid.UUID, offset: int
) -> tuple[Sequence[Row[Any]], int]:
    """One page (`PEOPLE_LIMIT`) of the candidates of one of `owner`'s live room listings, and
    their total. Each row has `RoomPair.id`, `lister_liked_at`, `display_name`, `photo_key`, the
    card columns (`CARD_COLUMNS`) and the match columns (budget at the pair's frozen price). Order:
    score, then the pair's age, then its id.

    Three statements after the session lookup: the listing (`_own_room`), the snapshot (every
    opted-in candidate gets its pair, so its price is frozen **before** anything is scored or
    ordered), and the page with `count(*) OVER ()` as the total. An empty page past the start
    (`offset > 0`) needs one more, the count. Raises `ListingNotFoundError` or
    `ListingNotLiveError`. Commits (the snapshot)."""
    try:
        listing = _own_room(db, owner, listing_id)
        # shortcut: inserts a row for every opted-in candidate on the first visit and re-scans
        # them on each later page (ON CONFLICT DO NOTHING); fine at MVP volume. If browse passes
        # a few hundred ms, insert only the missing pairs (an anti-join), or move the snapshot to
        # the like and score unseen candidates without the budget term (spec 0008a, Risks).
        # Ordered by seeker, so two concurrent first visits take the index locks in one order.
        candidates = (
            select(Listing.id, SeekerProfile.user_id, Listing.price_ils)
            .select_from(SeekerProfile)
            .join(Listing, Listing.id == listing.id)
            .where(
                *_fits(),
                _shown(),
                ~open_application(Listing.id, SeekerProfile.user_id),
            )
            .order_by(SeekerProfile.user_id)
        )
        db.execute(
            insert(RoomPair)
            .from_select(["listing_id", "seeker_id", "price_ils_seen"], candidates)
            .on_conflict_do_nothing(constraint="uq_room_pairs_listing_seeker")
        )
        columns = match_columns(
            Listing,
            SeekerProfile,
            price=RoomPair.price_ils_seen,
            listing_type=Listing.listing_type,
        )
        score = next(column for column in columns if column.name == "m_score")
        page = (
            select(RoomPair.id, RoomPair.lister_liked_at)
            .join(Listing, Listing.id == RoomPair.listing_id)
            .join(SeekerProfile, SeekerProfile.user_id == RoomPair.seeker_id)
            .join(User, User.id == RoomPair.seeker_id)
            .where(
                RoomPair.listing_id == listing.id,
                *_fits(),
                _shown(),
                ~open_application(RoomPair.listing_id, RoomPair.seeker_id),
            )
        )
        rows = db.execute(
            page.add_columns(
                User.display_name,
                User.photo_key,
                *CARD_COLUMNS,
                *columns,
                func.count().over().label("total"),
            )
            .order_by(
                score.desc(),
                RoomPair.created_at,
                RoomPair.id,
            )
            .limit(PEOPLE_LIMIT)
            .offset(offset)
        ).all()
        if rows:
            total = int(rows[0].total)
        elif offset == 0:
            total = 0
        else:
            total = int(db.execute(select(func.count()).select_from(page.subquery())).scalar_one())
        db.commit()
    except Exception:
        db.rollback()
        raise
    return rows, total


def _has_application(db: Session, listing_id: uuid.UUID, seeker_id: uuid.UUID) -> bool:
    """The post-lock check: a separate statement, so it sees an application that committed while
    this transaction waited for the pair's lock, and a flatmate join that committed while it
    waited for the listing's (spec 0008d). Raises `ListingNotFoundError` when the seeker is a
    flatmate there (treated like the owner); else whether they have a non-withdrawn application.
    The caller rolls the like back either way."""
    row = db.execute(
        select(
            flatmate_of(listing_id, seeker_id).label("flatmate"),
            open_application(listing_id, seeker_id).label("applied"),
        )
    ).one()
    if row.flatmate:
        raise ListingNotFoundError
    return bool(row.applied)


def room_person_user(db: Session, owner: User, pair_id: uuid.UUID) -> uuid.UUID | None:
    """The seeker of room pair `pair_id` when the pair is of a public room listing `owner` owns and
    the seeker is shown and fits (`like_person`'s rule without its application clause), else None.
    One SELECT. A report's lookup (spec 0011b)."""
    live = search_service._public_listings().where(Listing.id == RoomPair.listing_id).exists()
    return db.scalar(
        select(RoomPair.seeker_id)
        .join(Listing, Listing.id == RoomPair.listing_id)
        .join(SeekerProfile, SeekerProfile.user_id == RoomPair.seeker_id)
        .where(
            RoomPair.id == pair_id,
            Listing.owner_id == owner.id,
            Listing.listing_type == "room",
            live,
            *_fits(),
            _shown(),
        )
    )


def like_person(
    db: Session, r: RedisClient, owner: User, listing_id: uuid.UUID, person_id: uuid.UUID
) -> None:
    """The lister likes person `person_id` (a pair of their live room listing `listing_id`): an
    invite (spec 0010l), never an application. In order: the listing (`ListingNotFoundError`,
    `ListingNotLiveError`, nothing counted), the limiter (`RateLimitedError`), one conditional
    UPDATE that takes the pair's lock (`ListingNotFoundError` when it is unknown, another
    listing's, or not a candidate any more), the post-lock check (`AlreadyAppliedError`, the like
    rolled back). Before the UPDATE it reads the pair's seeker and takes the (listing, seeker) key
    (`lock_pair_key`), so it waits for an apply that started before the pair existed. A second
    like keeps the first `lister_liked_at`. The listing SELECT takes
    `FOR KEY SHARE` before the pair's lock (spec 0008d), and the UPDATE's candidate condition and
    the post-lock check both re-test flatmate membership after it (`ListingNotFoundError`).
    Commits."""
    try:
        listing = _own_room(db, owner, listing_id, lock=True)
        count_like(r, owner)
        # The pair's seeker, for the (listing, seeker) key; the UPDATE below re-checks the pair.
        seeker_id = db.scalar(
            select(RoomPair.seeker_id).where(
                RoomPair.id == person_id, RoomPair.listing_id == listing.id
            )
        )
        if seeker_id is None:
            raise ListingNotFoundError
        lock_pair_key(db, listing.id, seeker_id)
        pair = db.scalar(
            update(RoomPair)
            .where(
                RoomPair.id == person_id,
                RoomPair.listing_id == listing.id,
                Listing.id == RoomPair.listing_id,
                SeekerProfile.user_id == RoomPair.seeker_id,
                *_fits(),
                _shown(),
            )
            .values(lister_liked_at=func.coalesce(RoomPair.lister_liked_at, func.now()))
            .returning(RoomPair)
            .execution_options(populate_existing=True, synchronize_session=False)
        )
        if pair is None:
            raise ListingNotFoundError
        if _has_application(db, listing.id, pair.seeker_id):
            raise AlreadyAppliedError
        db.commit()
    except Exception:
        db.rollback()
        raise


def unlike_person(db: Session, owner: User, listing_id: uuid.UUID, person_id: uuid.UUID) -> None:
    """The lister withdraws their like of `person_id`, whatever the listing's state. Raises
    `ListingNotFoundError` for a pair that is not of `listing_id` or not of the caller's listing.
    One UPDATE. Commits."""
    try:
        unliked = db.scalar(
            update(RoomPair)
            .where(
                RoomPair.id == person_id,
                RoomPair.listing_id == listing_id,
                Listing.id == RoomPair.listing_id,
                Listing.owner_id == owner.id,
            )
            .values(lister_liked_at=None)
            .returning(RoomPair.id)
            .execution_options(synchronize_session=False)
        )
        if unliked is None:
            raise ListingNotFoundError
        db.commit()
    except Exception:
        db.rollback()
        raise


def like_state(db: Session, seeker_id: uuid.UUID, listing_id: uuid.UUID) -> LikeStateOut | None:
    """Whether room `listing_id`'s lister invited `seeker_id`, for the listing page (the caller
    checks that the caller is signed in, of any role (spec 0010b), and the listing a room not their
    own): None when the seeker has a non-withdrawn application to it (the page shows that
    instead) or is a flatmate there (0008d: they can never answer an invite to their own flat),
    else `liked_me`, false without a pair. One one-row SELECT."""
    pair = and_(RoomPair.listing_id == listing_id, RoomPair.seeker_id == seeker_id)
    row = db.execute(
        select(
            open_application(listing_id, seeker_id).label("applied"),
            flatmate_of(listing_id, seeker_id).label("flatmate"),
            exists().where(pair, RoomPair.lister_liked_at.is_not(None)).label("liked_me"),
        )
    ).one()
    if row.applied or row.flatmate:
        return None
    return LikeStateOut(liked_me=row.liked_me)


def age(birth_year: int | None) -> int | None:
    """The age this (UTC) year, as `0007c`'s inbox shows it; None without a birth year."""
    return None if birth_year is None else dt.datetime.now(dt.UTC).year - birth_year
