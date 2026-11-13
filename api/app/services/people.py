"""People browse and likes (spec 0008a; PRODUCT.md "People & likes"): the owner of a live room
listing pages through the seekers who are looking for a room there and likes them; a seeker likes
rooms. When the second side likes, the pair becomes a **shortlisted application** with
`source = 'like'` and no message, and its chat opens (PRODUCT.md "Chat": mutual interest).

This module is the only writer of `room_pairs` and the only place a like turns into an
application. Its terms, each stated once here:

- A **candidate** of room listing `L` is a `seeker_profiles` row `P` with the looking part filled
  and a room section (`gender` set) that `room_fit(L, P)` is true for, that is not `L`'s owner nor a
  flatmate of `L` (`flatmate_of`, spec 0008d: a lister's like never makes their own flatmate
  mutual), that opted in (`people_visible`) **or** liked `L`, and that has no non-withdrawn
  application to `L` (`open_application`): declined, submitted and shortlisted applicants live in
  the inbox, and a decline is final. There is no area filter: another area only lowers the `area`
criterion. - A **pending seeker like** of `L` (`pending_seeker_like`) is a pair of `L` with
  `seeker_liked_at` set and no non-withdrawn application, while `L` is a room. `liked_me_count`
  (`services/listings.py`) counts these.

Privacy (NF2; security): a lister never handles a seeker's user id (a person is the pair's id).
The page selects the profile's card columns **by name**, never the `SeekerProfile` entity, so
`budget_max_ils` is never loaded; the match reads it inside its expression only. Every budget
input about a pair reads its `price_ils_seen`, frozen when the pair was created and never updated,
so editing a room's price cannot probe a seeker's budget.

Concurrency: both like paths take the pair row's lock with their one write (a conditional
UPDATE, or an INSERT ... ON CONFLICT DO UPDATE), and only then run a **separate** `SELECT EXISTS`
for an application: as a new statement under READ COMMITTED it sees an apply or a mutual that
committed while this transaction waited for the lock, and the like is rolled back with
`AlreadyAppliedError`. Two concurrent likes of the two sides serialise on the lock, and the later
one sees both timestamps, so exactly one of them turns the pair mutual. An apply consumes the
pair's likes (`consume_likes`) under the same lock, **before** it writes its application, so the
lock order is always the pair, then `applications`: a like waiting on an apply sees the committed
application in its post-lock EXISTS, and an apply waiting on a mutual finds the shortlisted row
(`AlreadyAppliedError`).

Flatmates (spec 0008d): a flatmate join holds the listing row `FOR UPDATE` while it checks for an
open application and inserts the membership. Every path that may create an application (apply,
both likes) first takes `FOR KEY SHARE` on the listing row, folded into its listing SELECT, so it
waits for a running join; its post-lock statements then re-test flatmate membership
(`_has_application`, and `_fits()` in `like_person`'s UPDATE), and a join waiting on it sees its
committed application. The full lock order is the listing, then the pair, then `applications`, so
the join (listing only) cannot deadlock with them. A caller is never both an applicant and a
flatmate."""

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
    or_,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.matching.fit import room_fit
from app.matching.score import match_columns
from app.models import (
    Application,
    Conversation,
    Listing,
    ListingFlatmate,
    RoomPair,
    SeekerProfile,
    User,
)
from app.redis_client import RedisClient
from app.schemas.people import PEOPLE_LIMIT, LikeStateOut
from app.services import search as search_service
from app.services.applications import (
    AlreadyAppliedError,
    ProfileRequiredError,
    RoomGenderMismatchError,
)
from app.services.listings import ListingNotFoundError
from app.services.rate_limit import count_or_raise

# Per user, the lister's and the seeker's likes together (`rl:like:user:*`).
LIKE_RATE_LIMIT_HOUR = 30
LIKE_RATE_WINDOW_S = 3600
LIKE_RATE_LIMIT_DAY = 100
LIKE_RATE_DAY_S = 86_400


class ListingNotLiveError(Exception):
    """The caller's own room listing is paused, expired or in an inactive area (not public)."""


class RoomSectionRequiredError(Exception):
    """The seeker's profile has no room section (`gender` unset); liking a room needs one, even a
    room for anyone."""


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


def consume_likes(db: Session, listing_id: uuid.UUID, seeker_id: uuid.UUID) -> None:
    """Clear both likes of the pair (`listing_id`, `seeker_id`), if it exists, in the caller's
    transaction: an application consumes them (spec 0008a, Out: a one-sided like stays only until
    an application for the pair exists), so after a withdraw both sides start over. Unconditional,
    so it takes the pair's row lock even when both likes are already null; `applications.apply`
    calls it before its application INSERT (the lock order above). One UPDATE."""
    db.execute(
        update(RoomPair)
        .where(RoomPair.listing_id == listing_id, RoomPair.seeker_id == seeker_id)
        .values(lister_liked_at=None, seeker_liked_at=None)
        .execution_options(synchronize_session=False)
    )


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
    """Opted in, or liked this room (the pair's `seeker_liked_at`): a like shares the card with
    that room's lister only (PRODUCT.md "People & likes")."""
    return or_(SeekerProfile.people_visible.is_(True), RoomPair.seeker_liked_at.is_not(None))


def pending_seeker_like() -> ColumnElement[bool]:
    """A pair (`RoomPair`) of the statement's `Listing` that its seeker liked and that has no
    non-withdrawn application, while the listing is a room. Correlates on `Listing`."""
    # shortcut: fit and opt-in are not re-checked, nor the looking part (a liker who changed
    # gender or dropped either part since still counts); people browse re-checks them. Accepted
    # in spec 0008a, Risks.
    return and_(
        RoomPair.listing_id == Listing.id,
        Listing.listing_type == "room",
        RoomPair.seeker_liked_at.is_not(None),
        ~open_application(RoomPair.listing_id, RoomPair.seeker_id),
        ~flatmate_of(RoomPair.listing_id, RoomPair.seeker_id),  # 0008d: never a candidate
    )


def _own_room(db: Session, owner: User, listing_id: uuid.UUID, *, lock: bool = False) -> Listing:
    """The caller's room listing, if it is live. One SELECT, with its public-ness as a correlated
    column (`_public_listings()`, the one visibility rule). Raises `ListingNotFoundError` (unknown,
    another owner's, an apartment) or `ListingNotLiveError` (paused, expired, inactive area).
    `lock`: the SELECT also takes `FOR KEY SHARE` on the listing row (a like that may create an
    application, spec 0008d: it waits for a flatmate join holding the row `FOR UPDATE`)."""
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


def _count_like(r: RedisClient, user: User) -> None:
    count_or_raise(
        r,
        (
            (f"rl:like:user:{user.id}", LIKE_RATE_LIMIT_HOUR, LIKE_RATE_WINDOW_S),
            (f"rl:like:user:day:{user.id}", LIKE_RATE_LIMIT_DAY, LIKE_RATE_DAY_S),
        ),
    )


# The card's profile columns, by name (NF2): never the entity, so `budget_max_ils`, `household`,
# pets, smoker, contract, parking and `flatmate_gender` are never loaded.
_CARD_COLUMNS = (
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
    their total. Each row has `RoomPair.id`, both like timestamps, `display_name`, `photo_key`, the
    card columns (`_CARD_COLUMNS`) and the match columns (budget at the pair's frozen price). Order:
    those who liked the room first, then score, then the pair's age, then its id.

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
                SeekerProfile.people_visible.is_(True),
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
            select(RoomPair.id, RoomPair.lister_liked_at, RoomPair.seeker_liked_at)
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
                *_CARD_COLUMNS,
                *columns,
                func.count().over().label("total"),
            )
            .order_by(
                RoomPair.seeker_liked_at.is_(None),
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


def _mutual(db: Session, listing: Listing, pair: RoomPair, *, lister_second: bool) -> Application:
    """Turn `pair` into a shortlisted, like-sourced application of `listing` (inserted, or a
    withdrawn one reopened as new), open its chat and clear the pair's likes, in the caller's
    transaction. The budget snapshot is the pair's frozen price. `lister_second`: the lister's like
    made it mutual (their read marker is now(), the seeker's null; the reverse otherwise). Raises
    `AlreadyAppliedError` when a non-withdrawn application exists (a racing apply)."""
    stmt = insert(Application).values(
        listing_id=listing.id,
        seeker_id=pair.seeker_id,
        source="like",
        message=None,
        status="shortlisted",
        price_ils_at_apply=pair.price_ils_seen,
        area_id_at_apply=listing.area_id,
        listing_type_at_apply=listing.listing_type,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_applications_listing_seeker",
        set_={
            "status": "shortlisted",
            "source": "like",
            "message": None,
            "price_ils_at_apply": stmt.excluded.price_ils_at_apply,
            "area_id_at_apply": stmt.excluded.area_id_at_apply,
            "listing_type_at_apply": stmt.excluded.listing_type_at_apply,
            "created_at": func.now(),
            "updated_at": func.now(),
        },
        where=Application.status == "withdrawn",
    )
    application = db.scalar(stmt.returning(Application).execution_options(populate_existing=True))
    if application is None:
        raise AlreadyAppliedError
    # One conversation per application, ever (0005a): a reopened one keeps its markers and history,
    # as a re-shortlist does.
    db.execute(
        insert(Conversation)
        .values(
            id=application.id,  # an application chat's id is its application's (0010g)
            application_id=application.id,
            owner_id=listing.owner_id,
            seeker_id=pair.seeker_id,
            owner_read_at=func.now() if lister_second else None,
            seeker_read_at=None if lister_second else func.now(),
        )
        .on_conflict_do_nothing(index_elements=["application_id"])
    )
    db.execute(
        update(RoomPair)
        .where(RoomPair.id == pair.id)
        .values(lister_liked_at=None, seeker_liked_at=None)
        .execution_options(synchronize_session=False)
    )
    return application


def like_person(
    db: Session, r: RedisClient, owner: User, listing_id: uuid.UUID, person_id: uuid.UUID
) -> tuple[Application | None, uuid.UUID]:
    """The lister likes person `person_id` (a pair of their live room listing `listing_id`).
    Returns the application when this like made the pair mutual (else None) and the seeker's id
    (for the chat event). In order: the listing (`ListingNotFoundError`, `ListingNotLiveError`,
    nothing counted), the limiter (`RateLimitedError`), one conditional UPDATE that takes the
    pair's lock (`ListingNotFoundError` when it is unknown, another listing's, or not a candidate
    any more), the post-lock check (`AlreadyAppliedError`, the like rolled back), then mutual when
    the seeker had liked. A second like keeps the first `lister_liked_at`. The listing SELECT takes
    `FOR KEY SHARE` before the pair's lock (spec 0008d), and the UPDATE's candidate condition and
    the post-lock check both re-test flatmate membership after it (`ListingNotFoundError`).
    Commits."""
    try:
        listing = _own_room(db, owner, listing_id, lock=True)
        _count_like(r, owner)
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
        application = None
        if pair.seeker_liked_at is not None:
            application = _mutual(db, listing, pair, lister_second=True)
        seeker_id = pair.seeker_id
        db.commit()
    except Exception:
        db.rollback()
        raise
    return application, seeker_id


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


def like_room(
    db: Session, r: RedisClient, seeker: User, listing_id: uuid.UUID
) -> tuple[Application | None, Listing]:
    """The seeker likes public room `listing_id`. Returns the application when this like made the
    pair mutual (else None), and the listing. In order: the profile (`ProfileRequiredError` without
    the looking part, spec 0010c, then `RoomSectionRequiredError` without the personal part; the
    same SELECT reads whether the seeker is a flatmate there, 0008d), the listing
    (`search.get_public_listing_with_match`: `ListingNotFoundError` for one not public, the caller's
    own, one they are a flatmate of, or an apartment; `RoomGenderMismatchError` when it does not
    fit), none of them counted; the limiter (`RateLimitedError`); one INSERT ... ON CONFLICT DO
    UPDATE that takes the pair's lock (the live price is frozen only if the pair is new; a second
    like keeps the first `seeker_liked_at`); the post-lock check (`ListingNotFoundError` for a
    flatmate join that committed while the listing SELECT's `FOR KEY SHARE` waited,
    `AlreadyAppliedError`; the like rolled back); then mutual when the lister had liked. Commits."""
    try:
        profile = db.execute(
            select(
                SeekerProfile.budget_max_ils,
                SeekerProfile.gender,
                flatmate_of(listing_id, seeker.id).label("flatmate"),
            ).where(SeekerProfile.user_id == seeker.id)
        ).first()
        if profile is None or profile.budget_max_ils is None:
            raise ProfileRequiredError
        if profile.gender is None:
            raise RoomSectionRequiredError
        listing, _, fit = search_service.get_public_listing_with_match(
            db, listing_id, seeker.id, lock=True
        )
        if listing.owner_id == seeker.id or listing.listing_type != "room" or profile.flatmate:
            raise ListingNotFoundError
        if fit is False:
            raise RoomGenderMismatchError
        _count_like(r, seeker)
        stmt = insert(RoomPair).values(
            listing_id=listing.id,
            seeker_id=seeker.id,
            price_ils_seen=listing.price_ils,
            seeker_liked_at=func.now(),
        )
        stmt = stmt.on_conflict_do_update(
            constraint="uq_room_pairs_listing_seeker",
            set_={
                "seeker_liked_at": func.coalesce(
                    RoomPair.seeker_liked_at, stmt.excluded.seeker_liked_at
                )
            },
        )
        pair = db.scalars(
            stmt.returning(RoomPair), execution_options={"populate_existing": True}
        ).one()
        if _has_application(db, listing.id, seeker.id):
            raise AlreadyAppliedError
        application = None
        if pair.lister_liked_at is not None:
            application = _mutual(db, listing, pair, lister_second=False)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return application, listing


def unlike_room(db: Session, seeker: User, listing_id: uuid.UUID) -> None:
    """The seeker withdraws their like of `listing_id`, if any (reveals nothing either way). One
    UPDATE. Commits."""
    try:
        db.execute(
            update(RoomPair)
            .where(RoomPair.listing_id == listing_id, RoomPair.seeker_id == seeker.id)
            .values(seeker_liked_at=None)
            .execution_options(synchronize_session=False)
        )
        db.commit()
    except Exception:
        db.rollback()
        raise


def like_state(db: Session, seeker_id: uuid.UUID, listing_id: uuid.UUID) -> LikeStateOut | None:
    """The likes between `seeker_id` and room `listing_id` for the listing page (the caller checks
    that the caller is signed in, of any role (spec 0010b), and the listing a room not their own):
    None when the seeker has a non-withdrawn application to it (the page shows that instead), else
    both sides' like, false without a pair. One one-row SELECT."""
    pair = and_(RoomPair.listing_id == listing_id, RoomPair.seeker_id == seeker_id)
    row = db.execute(
        select(
            open_application(listing_id, seeker_id).label("applied"),
            exists().where(pair, RoomPair.seeker_liked_at.is_not(None)).label("liked_by_me"),
            exists().where(pair, RoomPair.lister_liked_at.is_not(None)).label("liked_me"),
        )
    ).one()
    if row.applied:
        return None
    return LikeStateOut(liked_by_me=row.liked_by_me, liked_me=row.liked_me)


def age(birth_year: int | None) -> int | None:
    """The age this (UTC) year, as `0007c`'s inbox shows it; None without a birth year."""
    return None if birth_year is None else dt.datetime.now(dt.UTC).year - birth_year
