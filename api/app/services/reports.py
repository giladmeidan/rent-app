"""Reports (spec 0011b; PRODUCT.md "Trust (MVP)"): a signed-in user reports a listing, a person or
a chat where they met it. The report is **stored only** for Slice 12's admin: nothing is hidden,
no email or event goes out, and the reported user never learns of it. This module is the only
writer of `reports`.

The client sends the id its page holds with a `target_type`; the place's owning module resolves
the person behind it under that place's own visibility rule (`_LOOKUPS`), so no rule is restated
here. Unknown, not visible to the caller and the caller's own are one case (`NotFoundError`).

A repeat (same reporter, `target_type`, `target_id`) changes nothing: the first report stands
(`uq_reports_reporter_target`). Nothing here logs the note or the target."""

import uuid
from collections.abc import Callable

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import Report, User
from app.redis_client import RedisClient
from app.schemas.report import ReportIn, ReportTargetType
from app.services import applications as applications_service
from app.services import chat as chat_service
from app.services import market_people as market_service
from app.services import people as people_service
from app.services import search as search_service
from app.services.rate_limit import count_or_raise

REPORT_RATE_LIMIT_HOUR = 10
REPORT_RATE_WINDOW_S = 3600
REPORT_RATE_LIMIT_DAY = 30
REPORT_RATE_DAY_S = 86_400


class NotFoundError(Exception):
    """The target is unknown, not visible to the caller where it was seen, or the caller's own
    (deliberately one case: no existence oracle)."""


# Each place's lookup: the reported user's id, or None when the caller may not report it.
_LOOKUPS: dict[ReportTargetType, Callable[[Session, User, uuid.UUID], uuid.UUID | None]] = {
    "listing": lambda db, _me, target_id: search_service.public_listing_owner(db, target_id),
    "person": market_service.card_user,
    "room_person": people_service.room_person_user,
    "chat": chat_service.other_member,
    "applicant": applications_service.applicant_user,
}


def count_report(r: RedisClient, user: User) -> None:
    """Count one report attempt of `user` (`rl:report:user:{id}`, `rl:report:user:day:{id}`).
    Raises `RateLimitedError`."""
    count_or_raise(
        r,
        (
            (f"rl:report:user:{user.id}", REPORT_RATE_LIMIT_HOUR, REPORT_RATE_WINDOW_S),
            (f"rl:report:user:day:{user.id}", REPORT_RATE_LIMIT_DAY, REPORT_RATE_DAY_S),
        ),
    )


def report(db: Session, r: RedisClient, me: User, body: ReportIn) -> bool:
    """Store `me`'s report. True when stored now, False when `me` had already reported this
    target (nothing changed). In order: the limiter (every authenticated attempt counts, a 404
    and a repeat too; `RateLimitedError`), the target's lookup (`NotFoundError` for None or `me`),
    one INSERT ... ON CONFLICT DO NOTHING. One commit."""
    try:
        count_report(r, me)
        reported = _LOOKUPS[body.target_type](db, me, body.target_id)
        if reported is None or reported == me.id:
            raise NotFoundError
        stored = db.scalar(
            insert(Report)
            .values(
                reporter_id=me.id,
                target_type=body.target_type,
                target_id=body.target_id,
                reported_user_id=reported,
                reason=body.reason,
                note=body.note,
            )
            .on_conflict_do_nothing(constraint="uq_reports_reporter_target")
            .returning(Report.id)
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return stored is not None
