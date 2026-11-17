"""Tours (spec 0018a, PRODUCT.md "Tours"; shared contract in `specs/TOURS-PLAN.md`): a lister opens
tour windows on a live listing; a seeker whose application to it is `shortlisted` books one free
slot (final at once), moves it or cancels it; the lister can cancel it. Every change is a tour line
in the application's chat.

Definitions (all with the database's `now()`):
- *Live listing*: `active`, not expired, not removed by homie, its owner neither suspended nor
  deleted (`_live`).
- *Free slot*: a window's `starts_at + k * slot_minutes` with the whole slot inside the window, at
  least `LEAD_MINUTES` from now, in a window starting within `HORIZON_DAYS`, and no `booked` tour of
  the listing at that instant (`_slots`, pure).
- *Current tour* of an application: its `booked` tour that has not ended (at most one).

Locks (no cycle, spec R5): window create / delete and `book` lock the listing row, then `book` the
application row; `reschedule` the listing, then the tour (`OF tours` only); `cancel` the tour only.
The cleanup paths call `cancel_upcoming` after their own locks (`update_listing`: the listing;
`set_applicant_status`: the application; `delete_account`: the user, their listings and
applications).

The change hook is two functions (spec R2): `record` writes the tour lines inside the caller's
transaction (the only writer of tour lines), `announce` publishes after the commit (spec 0018c adds
its email enqueue there and nowhere else). The services return `list[TourChange]` for the routers
to announce."""

import datetime as dt
import uuid
import zoneinfo
from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import (
    ColumnElement,
    CompoundSelect,
    Row,
    and_,
    delete,
    exists,
    func,
    insert,
    literal,
    or_,
    select,
    union_all,
    update,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.models import (
    Application,
    Conversation,
    Listing,
    ListingPhoto,
    Message,
    Tour,
    TourWindow,
    User,
)
from app.redis_client import RedisClient
from app.schemas.tours import TourChangeKind as TourChangeKind  # the services' name too
from app.schemas.tours import TourWindowIn
from app.services import chat_events, tour_mail, visibility

# Policy, PRODUCT.md "Tours" (Gilad 2026-11-16; may change).
SLOT_MINUTES = (15, 20, 30, 45)
WINDOW_MAX_HOURS = 12
HORIZON_DAYS = 30
LEAD_MINUTES = 60
MAX_UPCOMING_WINDOWS = 30
TOURS_AGENDA_LIMIT = 200  # spec 0018b: 3 live listings per lister make this unreachable
ISRAEL = zoneinfo.ZoneInfo("Asia/Jerusalem")

CancelledBy = Literal["seeker", "lister", "system"]
_CANCEL_KIND: dict[CancelledBy, TourChangeKind] = {
    "seeker": "cancelled_by_seeker",
    "lister": "cancelled_by_lister",
    "system": "cancelled_by_system",
}


class TourNotFoundError(Exception):
    """Unknown id, or not the caller's (one case: a 404)."""


class ListingNotLiveError(Exception):
    pass


class WindowOverlapError(Exception):
    pass


class TooManyWindowsError(Exception):
    pass


class InvalidWindowError(Exception):
    pass


class WindowHasToursError(Exception):
    pass


class SlotUnavailableError(Exception):
    pass


class TourExistsError(Exception):
    pass


class TourNotCancellableError(Exception):
    """Not booked any more, or already started."""


@dataclass(frozen=True)
class TourChange:
    tour_id: uuid.UUID
    application_id: uuid.UUID  # = the conversation's id
    listing_id: uuid.UUID
    owner_id: uuid.UUID
    seeker_id: uuid.UUID
    actor_id: uuid.UUID  # the tour line's sender: whoever caused the change
    change: TourChangeKind
    starts_at: dt.datetime
    previous_starts_at: dt.datetime | None  # a reschedule's old time


@dataclass(frozen=True)
class BookedSlot:
    tour_id: uuid.UUID
    starts_at: dt.datetime
    seeker_name: str | None
    conversation_id: uuid.UUID


@dataclass(frozen=True)
class Window:
    id: uuid.UUID
    starts_at: dt.datetime
    ends_at: dt.datetime
    slot_minutes: int
    booked: list[BookedSlot]


@dataclass(frozen=True)
class Slots:
    listing_live: bool
    slots: list[tuple[dt.datetime, dt.datetime]]
    tour: Row[Any] | None  # `id`, `starts_at`, `ends_at`, `status`


def _live() -> ColumnElement[bool]:
    return and_(
        Listing.status == "active",
        Listing.expires_at > func.now(),
        Listing.removed_at.is_(None),
        visibility.owner_not_suspended(),
    )


_TOUR_COLUMNS = (Tour.id, Tour.starts_at, Tour.ends_at, Tour.status)


def _slots(
    windows: Iterable[tuple[dt.datetime, dt.datetime, int]],
    booked: Collection[dt.datetime],
    now: dt.datetime,
) -> list[tuple[dt.datetime, dt.datetime]]:
    """The free slots (start, end) of `windows` (start, end, slot minutes) given the listing's
    booked starts, by start."""
    earliest = now + dt.timedelta(minutes=LEAD_MINUTES)
    horizon = now + dt.timedelta(days=HORIZON_DAYS)
    free = []
    for starts_at, ends_at, minutes in sorted(windows):
        if starts_at >= horizon:
            continue
        step = dt.timedelta(minutes=minutes)
        start = starts_at
        while start + step <= ends_at:
            if start >= earliest and start not in booked:
                free.append((start, start + step))
            start += step
    return free


def _israel(day: dt.date, wall: dt.time) -> dt.datetime:
    """`day` at Israel wall time `wall`, in UTC. A wall time that does not exist (the
    spring-forward hour) or is ambiguous (the autumn hour) is `InvalidWindowError`: its two folds
    are two different instants; so is a day at the calendar's ends (year 1 or 9999)."""
    naive = dt.datetime.combine(day, wall)
    try:
        instants = {naive.replace(tzinfo=ISRAEL, fold=fold).astimezone(dt.UTC) for fold in (0, 1)}
    except OverflowError:
        raise InvalidWindowError from None
    if len(instants) != 1:
        raise InvalidWindowError
    return instants.pop()


def _check_length(length: dt.timedelta, slot_minutes: int) -> None:
    if not (
        dt.timedelta(0) < length <= dt.timedelta(hours=WINDOW_MAX_HOURS)
        and length % dt.timedelta(minutes=slot_minutes) == dt.timedelta(0)
    ):
        raise InvalidWindowError


def _check_shape(data: TourWindowIn) -> None:
    """The window's own rules, before any query (so a 422 comes ahead of a 404)."""
    for wall in (data.start, data.end):
        if wall.tzinfo is not None or wall.second or wall.microsecond or wall.minute % 5:
            raise InvalidWindowError
    day = dt.date.min
    _check_length(
        dt.datetime.combine(day, data.end) - dt.datetime.combine(day, data.start),
        data.slot_minutes,
    )


def list_windows(db: Session, owner: User, listing_id: uuid.UUID) -> tuple[bool, list[Window]]:
    """`owner`'s listing's liveness and its upcoming windows (`ends_at` in the future) by start,
    each with its booked tours that have not ended. Raises `TourNotFoundError`. Three SELECTs."""
    live = db.scalar(select(_live()).where(Listing.id == listing_id, Listing.owner_id == owner.id))
    if live is None:
        raise TourNotFoundError
    windows = db.scalars(
        select(TourWindow)
        .where(TourWindow.listing_id == listing_id, TourWindow.ends_at > func.now())
        .order_by(TourWindow.starts_at)
    ).all()
    booked = db.execute(
        select(Tour.id, Tour.starts_at, Tour.application_id, User.display_name)
        .join(User, User.id == Tour.seeker_id)
        .where(Tour.listing_id == listing_id, Tour.status == "booked", Tour.ends_at > func.now())
        .order_by(Tour.starts_at)
    ).all()
    return live, [
        Window(
            id=w.id,
            starts_at=w.starts_at,
            ends_at=w.ends_at,
            slot_minutes=w.slot_minutes,
            booked=[
                BookedSlot(
                    tour_id=t.id,
                    starts_at=t.starts_at,
                    seeker_name=t.display_name,
                    conversation_id=t.application_id,
                )
                for t in booked
                if w.starts_at <= t.starts_at < w.ends_at
            ],
        )
        for w in windows
    ]


def _lock_own_listing(db: Session, owner: User, listing_id: uuid.UUID) -> Row[Any]:
    row = db.execute(
        select(_live().label("live"), func.now().label("now"))
        .where(Listing.id == listing_id, Listing.owner_id == owner.id)
        .with_for_update(of=Listing)
    ).one_or_none()
    if row is None:
        raise TourNotFoundError
    return row


def create_window(
    db: Session, owner: User, listing_id: uuid.UUID, data: TourWindowIn
) -> TourWindow:
    """Open a window on `owner`'s live listing (rule 1). Raises `InvalidWindowError` (checked
    first), `TourNotFoundError`, `ListingNotLiveError`, `WindowOverlapError` or
    `TooManyWindowsError`. Commits."""
    _check_shape(data)
    try:
        listing = _lock_own_listing(db, owner, listing_id)
        if not listing.live:
            raise ListingNotLiveError
        starts_at, ends_at = _israel(data.date, data.start), _israel(data.date, data.end)
        # A day with a clock change: the real length must fit the rules too (the CHECKs).
        _check_length(ends_at - starts_at, data.slot_minutes)
        if not listing.now <= starts_at <= listing.now + dt.timedelta(days=HORIZON_DAYS):
            raise InvalidWindowError
        upcoming = and_(TourWindow.listing_id == listing_id, TourWindow.ends_at > func.now())
        overlap, count = db.execute(
            select(
                exists().where(
                    upcoming, TourWindow.starts_at < ends_at, TourWindow.ends_at > starts_at
                ),
                select(func.count()).where(upcoming).scalar_subquery(),
            )
        ).one()
        if overlap:
            raise WindowOverlapError
        if count >= MAX_UPCOMING_WINDOWS:
            raise TooManyWindowsError
        window = db.scalars(
            insert(TourWindow)
            .values(
                listing_id=listing_id,
                starts_at=starts_at,
                ends_at=ends_at,
                slot_minutes=data.slot_minutes,
            )
            .returning(TourWindow)
        ).one()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return window


def delete_window(db: Session, owner: User, window_id: uuid.UUID) -> None:
    """Delete a window of `owner`'s listing that holds no upcoming booked tour (rule 2). Raises
    `TourNotFoundError` or `WindowHasToursError`. Commits."""
    try:
        window = db.execute(
            select(TourWindow.listing_id, TourWindow.starts_at, TourWindow.ends_at)
            .join(Listing, Listing.id == TourWindow.listing_id)
            .where(TourWindow.id == window_id, Listing.owner_id == owner.id)
            .with_for_update(of=Listing)
        ).one_or_none()
        if window is None:
            raise TourNotFoundError
        if db.scalar(
            select(
                exists().where(
                    Tour.listing_id == window.listing_id,
                    Tour.status == "booked",
                    Tour.starts_at > func.now(),
                    Tour.starts_at >= window.starts_at,
                    Tour.starts_at < window.ends_at,
                )
            )
        ):
            raise WindowHasToursError
        db.execute(delete(TourWindow).where(TourWindow.id == window_id))
        db.commit()
    except Exception:
        db.rollback()
        raise


def current_tour(db: Session, application_id: uuid.UUID) -> Row[Any] | None:
    """The application's booked tour that has not ended (`id`, `starts_at`, `ends_at`, `status`),
    else None. One SELECT (`ix_tours_application_id`)."""
    return db.execute(
        select(*_TOUR_COLUMNS).where(
            Tour.application_id == application_id,
            Tour.status == "booked",
            Tour.ends_at > func.now(),
        )
    ).first()


def slots_for(db: Session, seeker: User, application_id: uuid.UUID) -> Slots:
    """The free slots of `seeker`'s `shortlisted` application's listing (none while it is not live)
    and the application's current tour (rule 3). Raises `TourNotFoundError`. At most three
    SELECTs."""
    application = db.execute(
        select(Application.listing_id, _live().label("live"), func.now().label("now"))
        .join(Listing, Listing.id == Application.listing_id)
        .where(
            Application.id == application_id,
            Application.seeker_id == seeker.id,
            Application.status == "shortlisted",
        )
    ).one_or_none()
    if application is None:
        raise TourNotFoundError
    windows: Sequence[Row[Any]] = []
    if application.live:
        windows = db.execute(
            select(TourWindow.starts_at, TourWindow.ends_at, TourWindow.slot_minutes).where(
                TourWindow.listing_id == application.listing_id,
                TourWindow.ends_at > func.now(),
                TourWindow.starts_at < func.now() + dt.timedelta(days=HORIZON_DAYS),
            )
        ).all()
    booked = db.execute(
        select(Tour.application_id, *_TOUR_COLUMNS).where(
            Tour.listing_id == application.listing_id,
            Tour.status == "booked",
            Tour.ends_at > func.now(),
        )
    ).all()
    tour = next((t for t in booked if t.application_id == application_id), None)
    slots = _slots([tuple(w) for w in windows], {t.starts_at for t in booked}, application.now)
    return Slots(listing_live=application.live, slots=slots, tour=tour)


def _slot_end(
    db: Session, listing_id: uuid.UUID, starts_at: dt.datetime, now: dt.datetime
) -> dt.datetime:
    """The end of the free slot of the listing starting exactly at `starts_at`; else
    `SlotUnavailableError`. One SELECT (the window holding it, windows never overlap)."""
    window = db.execute(
        select(
            TourWindow.starts_at,
            TourWindow.ends_at,
            TourWindow.slot_minutes,
            exists()
            .where(
                Tour.listing_id == listing_id,
                Tour.status == "booked",
                Tour.starts_at == starts_at,
            )
            .label("taken"),
        ).where(
            TourWindow.listing_id == listing_id,
            TourWindow.starts_at <= starts_at,
            TourWindow.ends_at > starts_at,
        )
    ).first()
    if window is None or window.taken:
        raise SlotUnavailableError
    slots = dict(_slots([(window.starts_at, window.ends_at, window.slot_minutes)], (), now))
    if starts_at not in slots:
        raise SlotUnavailableError
    return slots[starts_at]


def _is_slot_taken(exc: IntegrityError) -> bool:
    diag = getattr(exc.orig, "diag", None)
    return getattr(diag, "constraint_name", None) == "uq_tours_listing_slot"


def book(
    db: Session, seeker: User, application_id: uuid.UUID, starts_at: dt.datetime
) -> tuple[Row[Any], TourChange]:
    """Book the free slot at `starts_at` for `seeker`'s `shortlisted` application (rule 4) and
    return the tour (`TourOut`'s columns) with its change. Raises `TourNotFoundError`,
    `ListingNotLiveError`, `TourExistsError` or `SlotUnavailableError`. Commits."""
    try:
        listing = db.execute(
            select(Listing.id, Listing.owner_id, _live().label("live"), func.now().label("now"))
            .where(
                Listing.id
                == select(Application.listing_id)
                .where(Application.id == application_id, Application.seeker_id == seeker.id)
                .scalar_subquery()
            )
            .with_for_update(of=Listing)
        ).one_or_none()
        if listing is None:
            raise TourNotFoundError
        application = db.scalar(
            select(Application.id)
            .where(
                Application.id == application_id,
                Application.seeker_id == seeker.id,
                Application.status == "shortlisted",
            )
            .with_for_update()
        )
        if application is None:
            raise TourNotFoundError
        if not listing.live:
            raise ListingNotLiveError
        if current_tour(db, application_id) is not None:
            raise TourExistsError
        ends_at = _slot_end(db, listing.id, starts_at, listing.now)
        tour = db.execute(
            insert(Tour)
            .values(
                listing_id=listing.id,
                application_id=application_id,
                seeker_id=seeker.id,
                starts_at=starts_at,
                ends_at=ends_at,
            )
            .returning(*_TOUR_COLUMNS)
        ).one()
        change = TourChange(
            tour_id=tour.id,
            application_id=application_id,
            listing_id=listing.id,
            owner_id=listing.owner_id,
            seeker_id=seeker.id,
            actor_id=seeker.id,
            change="booked",
            starts_at=tour.starts_at,
            previous_starts_at=None,
        )
        record(db, [change])
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if _is_slot_taken(exc):
            raise SlotUnavailableError from None
        raise
    except Exception:
        db.rollback()
        raise
    return tour, change


def reschedule(
    db: Session, seeker: User, tour_id: uuid.UUID, starts_at: dt.datetime
) -> tuple[Row[Any], TourChange]:
    """Move `seeker`'s upcoming booked tour (application `shortlisted`) to the free slot at
    `starts_at`: the same row, `reminder_sent_at` cleared (rule 5). Raises `TourNotFoundError`,
    `TourNotCancellableError`, `ListingNotLiveError` or `SlotUnavailableError`. Commits."""
    try:
        listing = db.execute(
            select(Listing.id, Listing.owner_id, _live().label("live"), func.now().label("now"))
            .where(
                Listing.id == select(Tour.listing_id).where(Tour.id == tour_id).scalar_subquery()
            )
            .with_for_update(of=Listing)
        ).one_or_none()
        if listing is None:
            raise TourNotFoundError
        # `OF tours` only: locking the application too could deadlock with
        # `set_applicant_status` (application, then tours).
        current = db.execute(
            select(Tour.application_id, Tour.status, Tour.starts_at)
            .join(Application, Application.id == Tour.application_id)
            .where(
                Tour.id == tour_id,
                Tour.seeker_id == seeker.id,
                Application.status == "shortlisted",
            )
            .with_for_update(of=Tour)
        ).one_or_none()
        if current is None:
            raise TourNotFoundError
        if current.status != "booked" or current.starts_at <= listing.now:
            raise TourNotCancellableError
        if not listing.live:
            raise ListingNotLiveError
        ends_at = _slot_end(db, listing.id, starts_at, listing.now)
        tour = db.execute(
            update(Tour)
            .where(Tour.id == tour_id)
            .values(
                starts_at=starts_at,
                ends_at=ends_at,
                reminder_sent_at=None,
                updated_at=func.now(),
            )
            .returning(*_TOUR_COLUMNS)
            .execution_options(synchronize_session=False)
        ).one()
        change = TourChange(
            tour_id=tour_id,
            application_id=current.application_id,
            listing_id=listing.id,
            owner_id=listing.owner_id,
            seeker_id=seeker.id,
            actor_id=seeker.id,
            change="rescheduled",
            starts_at=tour.starts_at,
            previous_starts_at=current.starts_at,
        )
        record(db, [change])
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if _is_slot_taken(exc):
            raise SlotUnavailableError from None
        raise
    except Exception:
        db.rollback()
        raise
    return tour, change


def cancel(db: Session, me: User, tour_id: uuid.UUID) -> tuple[Row[Any], TourChange]:
    """Cancel an upcoming booked tour as its seeker or the listing's owner (rule 6); a flatmate
    gets `TourNotFoundError`. Raises `TourNotFoundError` or `TourNotCancellableError`. Commits."""
    try:
        # The tour only (`OF tours`): taking the listing here could deadlock with `reschedule`.
        current = db.execute(
            select(
                Tour.application_id,
                Tour.listing_id,
                Tour.seeker_id,
                Tour.status,
                Tour.starts_at,
                Listing.owner_id,
                func.now().label("now"),
            )
            .join(Listing, Listing.id == Tour.listing_id)
            .where(Tour.id == tour_id, or_(Tour.seeker_id == me.id, Listing.owner_id == me.id))
            .with_for_update(of=Tour)
        ).one_or_none()
        if current is None:
            raise TourNotFoundError
        if current.status != "booked" or current.starts_at <= current.now:
            raise TourNotCancellableError
        by: CancelledBy = "seeker" if current.seeker_id == me.id else "lister"
        tour = db.execute(
            update(Tour)
            .where(Tour.id == tour_id)
            .values(
                status="cancelled",
                cancelled_by=by,
                cancelled_at=func.now(),
                updated_at=func.now(),
            )
            .returning(*_TOUR_COLUMNS)
            .execution_options(synchronize_session=False)
        ).one()
        change = TourChange(
            tour_id=tour_id,
            application_id=current.application_id,
            listing_id=current.listing_id,
            owner_id=current.owner_id,
            seeker_id=current.seeker_id,
            actor_id=me.id,
            change=_CANCEL_KIND[by],
            starts_at=current.starts_at,
            previous_starts_at=None,
        )
        record(db, [change])
        db.commit()
    except Exception:
        db.rollback()
        raise
    return tour, change


def record(db: Session, changes: Sequence[TourChange]) -> None:
    """The change hook, inside the caller's transaction: one INSERT of the tour lines (one row per
    change, sent by its actor, in the application's chat) and one UPDATE of those conversations'
    `last_message_at`. Every booking, reschedule and cancel goes through it. Does not commit."""
    if not changes:
        return
    db.execute(
        insert(Message).values(
            [
                {
                    "conversation_id": c.application_id,
                    "sender_id": c.actor_id,
                    "tour_id": c.tour_id,
                    "tour_change": c.change,
                    "tour_starts_at": c.starts_at,
                }
                for c in changes
            ]
        )
    )
    db.execute(
        update(Conversation)
        .where(Conversation.id.in_({c.application_id for c in changes}))
        .values(last_message_at=func.greatest(Conversation.last_message_at, func.now()))
        .execution_options(synchronize_session=False)
    )


def cancel_upcoming(
    db: Session, where: ColumnElement[bool], actor_id: uuid.UUID, by: CancelledBy
) -> list[TourChange]:
    """Cancel every upcoming booked tour matching `where` (`cancelled_by = by`) and `record` the
    lines, sent by `actor_id`, inside the caller's transaction; the cleanup paths call it. Returns
    the changes for `announce`. One UPDATE, plus `record`'s two when any tour matched."""
    rows = db.execute(
        update(Tour)
        .where(
            Tour.status == "booked",
            Tour.starts_at > func.now(),
            Listing.id == Tour.listing_id,
            where,
        )
        .values(status="cancelled", cancelled_by=by, cancelled_at=func.now(), updated_at=func.now())
        .returning(
            Tour.id,
            Tour.application_id,
            Tour.listing_id,
            Listing.owner_id,
            Tour.seeker_id,
            Tour.starts_at,
        )
        .execution_options(synchronize_session=False)
    ).all()
    changes = [
        TourChange(
            tour_id=row.id,
            application_id=row.application_id,
            listing_id=row.listing_id,
            owner_id=row.owner_id,
            seeker_id=row.seeker_id,
            actor_id=actor_id,
            change=_CANCEL_KIND[by],
            starts_at=row.starts_at,
            previous_starts_at=None,
        )
        for row in rows
    ]
    record(db, changes)
    return changes


def announce(r: RedisClient, changes: Sequence[TourChange]) -> None:
    """The after-commit hook: a `message` chat event per change to its owner and seeker (never the
    flatmates: they see no tour lines), then the email items (spec 0018c). Never raises a Redis
    error (as `chat_events.publish`)."""
    for c in changes:
        chat_events.publish(r, [c.owner_id, c.seeker_id], c.application_id, "message")
    tour_mail.enqueue(r, changes)


def agenda_statement(me: User) -> CompoundSelect[Any]:
    """Spec 0018b: `me`'s upcoming booked tours (`ends_at` in the future, so one in progress still
    shows), as the listing's owner (`role = 'lister'`, `other_name` the seeker) and as the seeker
    (`role = 'seeker'`, `other_name` the owner), `starts_at` then `id`, at most
    `TOURS_AGENDA_LIMIT`. No listing-visibility filter: a booked tour on an expired listing stays
    booked (specs/TOURS-PLAN.md), as in 0018c's reminders and 0018d's feed. The other party must
    not be suspended or deleted. `cover_id` / `cover_key`: the listing's position-0 photo, NULL
    without photos (as `search._with_cover`)."""

    def branch(role: str, mine: ColumnElement[bool], other_id: Any) -> Any:
        other = aliased(User)  # the other party: the seeker for the lister, the owner otherwise
        cover = aliased(ListingPhoto)
        return (
            select(
                Tour.id,
                literal(role).label("role"),
                Tour.starts_at,
                Tour.ends_at,
                Tour.application_id.label("conversation_id"),
                other.display_name.label("other_name"),
                Listing.id.label("listing_id"),
                Listing.listing_type,
                Listing.rooms,
                Listing.street,
                Listing.city,
                cover.id.label("cover_id"),
                cover.key.label("cover_key"),
            )
            .select_from(Tour)
            .join(Listing, Listing.id == Tour.listing_id)
            .join(other, other.id == other_id)
            .outerjoin(cover, and_(cover.listing_id == Listing.id, cover.position == 0))
            .where(
                Tour.status == "booked",
                Tour.ends_at > func.now(),
                mine,
                visibility.not_suspended(other_id),
            )
        )

    lister = branch("lister", Listing.owner_id == me.id, Tour.seeker_id)
    as_seeker = branch("seeker", Tour.seeker_id == me.id, Listing.owner_id)
    return union_all(lister, as_seeker).order_by("starts_at", "id").limit(TOURS_AGENDA_LIMIT)


def list_agenda(db: Session, me: User) -> Sequence[Row[Any]]:
    """Spec 0018b: `me`'s agenda, one SELECT (`agenda_statement`)."""
    return db.execute(agenda_statement(me)).all()
