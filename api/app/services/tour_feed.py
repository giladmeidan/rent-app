"""The lister's private calendar feed (spec 0018d, PRODUCT.md "Tours"): a subscribed iCal URL that
lists the booked tours of every listing the account owns.

A calendar app cannot send a header or cookie, so the token travels in the URL path, the one place
in homie a secret sits in a URL. It follows the flatmate invite (`services/flatmates.py`):
`secrets.token_urlsafe(32)`, only its sha256 hex in `tour_feeds`, creating again rotates, off
deletes the row. A malformed token is refused before any SQL; every well-formed dead token (unknown,
rotated, off, suspended or deleted owner) gets the same empty calendar as a live feed with no tours,
so a subscribed calendar wipes its old copy and nobody can tell the two apart. Access logs and the
503 handlers write `redact_path` of the path (`app/main.py`)."""

import datetime as dt
import logging
import re
import secrets

from sqlalchemy import delete, exists, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, aliased

from app.config import get_settings
from app.i18n import he
from app.models import Listing, Tour, TourFeed, User
from app.services import ics
from app.services.auth import _token_hash

TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{43}")
# Google re-reads the whole feed; the past month is enough context and keeps old names out of
# third-party calendars; the cap bounds a response.
FEED_PAST = dt.timedelta(days=30)
FEED_MAX_EVENTS = 500

_FEED_PATH = re.compile(r"/tour-feed/[^\s\"]*")


def _hash(token: str) -> str:
    return _token_hash(token)


def feed_active(db: Session, user: User) -> bool:
    return bool(db.scalar(select(exists().where(TourFeed.user_id == user.id))))


def create_feed(db: Session, user: User) -> str:
    """Create the feed or rotate it (the old token stops working at once); the raw token is
    returned only here. Two concurrent calls: the last commit wins."""
    token = secrets.token_urlsafe(32)
    statement = insert(TourFeed).values(user_id=user.id, token_hash=_hash(token))
    db.execute(
        statement.on_conflict_do_update(
            index_elements=[TourFeed.user_id],
            set_={"token_hash": statement.excluded.token_hash, "created_at": func.now()},
        )
    )
    db.commit()
    return token


def disable_feed(db: Session, user: User) -> None:
    db.execute(delete(TourFeed).where(TourFeed.user_id == user.id))
    db.commit()


def feed_for_token(db: Session, token: str, now: dt.datetime) -> str | None:
    """The feed's calendar text; `None` for a malformed token (no query). A well-formed token that
    resolves to no live account gets the empty calendar."""
    if not TOKEN_RE.fullmatch(token):
        return None
    owner = db.scalar(
        select(TourFeed.user_id)
        .join(User, User.id == TourFeed.user_id)
        .where(
            TourFeed.token_hash == _hash(token),
            User.deleted_at.is_(None),
            User.suspended_at.is_(None),
        )
    )
    if owner is None:
        return ics.feed_calendar([], name=he.TOUR_FEED_NAME)
    seeker = aliased(User)
    rows = db.execute(
        select(
            Tour.id,
            Tour.starts_at,
            Tour.ends_at,
            Tour.updated_at,
            Listing.street,
            Listing.city,
            seeker.display_name,
        )
        .join(Listing, Listing.id == Tour.listing_id)
        .join(seeker, seeker.id == Tour.seeker_id)
        .where(
            Listing.owner_id == owner,
            seeker.deleted_at.is_(None),  # a tombstone has no name: a deleted seeker leaves
            Tour.status == "booked",
            Tour.starts_at >= now - FEED_PAST,
        )
        .order_by(Tour.starts_at, Tour.id)
        .limit(FEED_MAX_EVENTS)
    ).all()
    url = f"{get_settings().web_origin}/tours"
    events = [
        ics.vevent(
            uid=ics.tour_uid(row.id),
            start=row.starts_at,
            end=row.ends_at,
            summary=he.TOUR_ICS_SUMMARY.format(street=row.street, city=row.city),
            location=he.TOUR_WHERE.format(street=row.street, city=row.city),
            description=he.TOUR_FEED_DESCRIPTION.format(name=row.display_name, url=url),
            url=url,
            stamp=now,
            sequence=int(row.updated_at.timestamp()),
            status="CONFIRMED",
            organizer=None,
        )
        for row in rows
    ]
    return ics.feed_calendar(events, name=he.TOUR_FEED_NAME)


def redact_path(path: str) -> str:
    """`path` with a feed token (and whatever follows it, a query string included) replaced."""
    return _FEED_PATH.sub("/tour-feed/[redacted]", path)


class RedactFeedToken(logging.Filter):
    """Redacts feed tokens from uvicorn's access log (it passes the path with query as
    `args[2]`)."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_path(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(
                redact_path(arg) if isinstance(arg, str) else arg for arg in record.args
            )
        return True
