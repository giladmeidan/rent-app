"""Tour emails (spec 0018c, PRODUCT.md "Tours"): every tour change reaches the side that did not
make it, off the request path. `tours.announce` enqueues one item per change on a Redis list;
the worker's `send_pending` renders and sends them; `queue_reminders` claims the tours starting
within `REMINDER_LEAD` and enqueues a reminder each.

An item is `{"tour_id", "change", "attempt", "to"?}`: ids and a change name only, no personal data
in Redis. It is re-checked against the row when sent, so a stale item never tells an old story.
Nothing here logs an address, a name, a time or an id: counts and exception types only.

shortcut: a Redis list, not a durable outbox table (an outage at enqueue or a worker crash loses
mail; the chat line stays); upgrade to a tours_outbox table if production logs show lost tour
mail."""

import json
import logging
import uuid
from collections.abc import Sequence
from email.utils import parseaddr
from typing import TYPE_CHECKING, Any, Literal

from redis.exceptions import RedisError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.i18n import he
from app.redis_client import RedisClient, soft
from app.services import ics
from app.services.email import Attachment, EmailSender, EmailUnavailable

if TYPE_CHECKING:  # tours imports this module: a runtime import back would be circular
    from app.services.tours import TourChange

log = logging.getLogger(__name__)

QUEUE_KEY = "tour_mail"
MAX_ATTEMPTS = 3
REMINDER_LEAD = "24 hours"
BATCH = 100

Side = Literal["lister", "seeker"]

# Spec D1: per change, the subject and each recipient side's body (a side not listed gets nothing).
_MAIL: dict[str, tuple[str, dict[Side, str]]] = {
    "booked": (
        he.TOUR_BOOKED_SUBJECT,
        {"lister": he.TOUR_BOOKED_LISTER_BODY, "seeker": he.TOUR_BOOKED_SEEKER_BODY},
    ),
    "rescheduled": (
        he.TOUR_RESCHEDULED_SUBJECT,
        {"lister": he.TOUR_RESCHEDULED_LISTER_BODY, "seeker": he.TOUR_RESCHEDULED_SEEKER_BODY},
    ),
    "cancelled_by_seeker": (he.TOUR_CANCELLED_SUBJECT, {"lister": he.TOUR_CANCELLED_BODY}),
    "cancelled_by_lister": (he.TOUR_CANCELLED_SUBJECT, {"seeker": he.TOUR_CANCELLED_BODY}),
    "cancelled_by_system": (
        he.TOUR_CANCELLED_SUBJECT,
        {"lister": he.TOUR_CANCELLED_SYSTEM_BODY, "seeker": he.TOUR_CANCELLED_SYSTEM_BODY},
    ),
    "reminder": (
        he.TOUR_REMINDER_SUBJECT,
        {"lister": he.TOUR_REMINDER_BODY, "seeker": he.TOUR_REMINDER_BODY},
    ),
}
_PUBLISH = {"booked", "rescheduled"}  # an `.ics` that adds or moves the event
_CANCEL = {"cancelled_by_seeker", "cancelled_by_lister", "cancelled_by_system"}

# One row: the tour, its listing, both people and the local time strings (Postgres formats them,
# so the image needs no tzdata).
_LOAD = text(
    "SELECT t.id, t.status, t.application_id, t.starts_at, t.ends_at, t.updated_at,"
    " t.starts_at > now() AS upcoming, t.reminder_sent_at IS NOT NULL AS reminded,"
    " now() AS now, l.street, l.city,"
    " o.email AS lister_email, o.display_name AS lister_name,"
    " o.suspended_at IS NOT NULL AS lister_suspended,"
    " s.email AS seeker_email, s.display_name AS seeker_name,"
    " s.suspended_at IS NOT NULL AS seeker_suspended,"
    " to_char(timezone('Asia/Jerusalem', t.starts_at), 'DD.MM.YYYY') AS local_date,"
    " to_char(timezone('Asia/Jerusalem', t.starts_at), 'HH24:MI') AS local_start,"
    " to_char(timezone('Asia/Jerusalem', t.ends_at), 'HH24:MI') AS local_end,"
    " extract(isodow from timezone('Asia/Jerusalem', t.starts_at))::int AS isodow"
    " FROM tours t JOIN listings l ON l.id = t.listing_id"
    " JOIN users o ON o.id = l.owner_id JOIN users s ON s.id = t.seeker_id"
    " WHERE t.id = :id"
)

_CLAIM = text(
    "UPDATE tours SET reminder_sent_at = now()"
    " WHERE status = 'booked' AND reminder_sent_at IS NULL"
    " AND starts_at > now() AND starts_at <= now() + CAST(:lead AS interval)"
    " AND updated_at <= starts_at - CAST(:lead AS interval)"
    " RETURNING id"
)


def _item(tour_id: uuid.UUID, change: str, attempt: int = 0, to: Side | None = None) -> str:
    item: dict[str, Any] = {"tour_id": str(tour_id), "change": change, "attempt": attempt}
    if to is not None:
        item["to"] = to
    return json.dumps(item)


def enqueue(r: RedisClient, changes: Sequence["TourChange"]) -> None:
    """One item per change, after the commit. A Redis failure is logged by `soft` and swallowed:
    the change is committed and its chat line is the durable record."""
    if not changes:
        return
    items = [_item(c.tour_id, c.change) for c in changes]
    soft(lambda: r.rpush(QUEUE_KEY, *items))


def _parse(raw: bytes) -> tuple[uuid.UUID, str, int, Side | None]:
    item = json.loads(raw)
    tour_id, change, attempt = uuid.UUID(item["tour_id"]), item["change"], item["attempt"]
    to = item.get("to")
    if (
        change not in _MAIL
        or type(attempt) is not int
        or attempt < 0
        or (to is not None and to not in _MAIL[change][1])
    ):
        raise ValueError("unknown item")
    return tour_id, change, attempt, to


def _load(db: Session, tour_id: uuid.UUID) -> Any:
    row = db.execute(_LOAD, {"id": tour_id}).one_or_none()
    db.rollback()  # ends the read: no transaction stays open while mail is sent
    return row


def _current(row: Any, change: str) -> bool:
    """The item still describes the row (a later item tells the newer story)."""
    if change in _CANCEL:
        return bool(row.status == "cancelled")
    # A reminder needs its claim: a reschedule after the claim clears it (the old "tomorrow").
    return bool(
        row.status == "booked" and (change != "reminder" or (row.upcoming and row.reminded))
    )


def _calendar(row: Any, change: str) -> list[Attachment]:
    if change not in _PUBLISH and change not in _CANCEL:
        return []
    settings = get_settings()
    url = f"{settings.web_origin}/chat/{row.application_id}"
    publish = change in _PUBLISH
    method = "PUBLISH" if publish else "CANCEL"
    event = ics.vevent(
        uid=ics.tour_uid(row.id),
        start=row.starts_at,
        end=row.ends_at,
        summary=he.TOUR_ICS_SUMMARY.format(street=row.street, city=row.city),
        location=he.TOUR_WHERE.format(street=row.street, city=row.city),
        description=url,
        url=url,
        stamp=row.now,
        sequence=int(row.updated_at.timestamp()),
        status="CONFIRMED" if publish else "CANCELLED",
        organizer=parseaddr(settings.email_from)[1],  # "homie <a@b>" → a@b
    )
    return [
        Attachment(
            filename="tour.ics",
            content_type=f"text/calendar; method={method}; charset=utf-8",
            content=ics.vcalendar([event], method=method),
        )
    ]


def _body(row: Any, template: str, side: Side) -> str:
    other = row.seeker_name if side == "lister" else row.lister_name
    url = f"{get_settings().web_origin}/chat/{row.application_id}"
    return template.format(
        name=other if other is not None else he.TOUR_DELETED_NAME,
        when=he.TOUR_WHEN.format(
            weekday=he.WEEKDAYS[row.isodow - 1],
            date=row.local_date,
            start=row.local_start,
            end=row.local_end,
        ),
        where=he.TOUR_WHERE.format(street=row.street, city=row.city),
        footer=he.TOUR_FOOTER.format(url=url),
    )


def send_pending(db: Session, r: RedisClient, sender: EmailSender) -> dict[str, int]:
    """Pop up to `BATCH` items and send each to its recipients (spec "Delivery"). Returns the
    counts `sent`, `skipped`, `retried`, `dropped`."""
    counts = {"sent": 0, "skipped": 0, "retried": 0, "dropped": 0}
    for raw in r.lpop(QUEUE_KEY, BATCH) or []:
        try:
            tour_id, change, attempt, to = _parse(raw)
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            log.warning("tour mail item malformed: %s", type(exc).__name__)
            counts["dropped"] += 1
            continue
        try:
            row = _load(db, tour_id)
            if row is None or not _current(row, change):
                counts["skipped"] += 1
                continue
            subject, bodies = _MAIL[change]
            attachments = _calendar(row, change)
            for side, template in bodies.items():
                if to is not None and side != to:
                    continue
                email = row.lister_email if side == "lister" else row.seeker_email
                suspended = row.lister_suspended if side == "lister" else row.seeker_suspended
                if email is None or suspended:  # deleted (scrubbed) or suspended
                    counts["skipped"] += 1
                    continue
                try:
                    sender.send(email, subject, _body(row, template, side), attachments)
                    counts["sent"] += 1
                except EmailUnavailable:
                    if attempt + 1 >= MAX_ATTEMPTS:
                        counts["dropped"] += 1
                        continue
                    try:
                        r.rpush(QUEUE_KEY, _item(tour_id, change, attempt + 1, side))
                        counts["retried"] += 1
                    except RedisError as exc:  # only this side is lost; the other still goes
                        log.error("tour mail retry not queued: %s", type(exc).__name__)
                        counts["dropped"] += 1
        except Exception as exc:  # one item's bug never loses or loops the others
            db.rollback()
            # Never log.exception: a SQLAlchemy message carries bound parameters (an address).
            log.error("tour mail item failed: %s", type(exc).__name__)
            counts["dropped"] += 1
    return counts


def queue_reminders(db: Session, r: RedisClient) -> int:
    """Claim every booked tour starting within `REMINDER_LEAD` that has had no reminder and was
    not booked or moved inside that lead (those people just got the booking email), then push a
    `reminder` item each. Claim-then-push: a second run claims nothing; a Redis error after the
    claim loses that sweep's reminders (better none than two)."""
    try:
        ids = list(db.execute(_CLAIM, {"lead": REMINDER_LEAD}).scalars())
        db.commit()
    except Exception:
        db.rollback()
        raise
    if ids:
        r.rpush(QUEUE_KEY, *(_item(tour_id, "reminder") for tour_id in ids))
    return len(ids)
