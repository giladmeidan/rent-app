"""Applications (spec 0004a): a seeker applies to a public listing with a short message, lists
their applications and withdraws one; the public listing page counts its applicants and views.
The owner's inbox (spec 0004c): an owner lists the applicants of one of their listings and
shortlists, un-shortlists or declines them (`ALLOWED_FROM`).

Rules (PRODUCT.md "Applications"):
- One application per (listing, seeker), ever (`uq_applications_listing_seeker`). Applying again
  after a **withdrawal** reopens the same row as new (`submitted`, the new message, `created_at`
  now); after `submitted`, `shortlisted` or `declined` it is `AlreadyAppliedError`. Both are one
  `INSERT ... ON CONFLICT DO UPDATE ... WHERE status = 'withdrawn'`, so two concurrent applies
  yield one application and one `AlreadyAppliedError`.
- Only a public listing (`search.get_public_listing`, the one visibility rule) can be applied to,
  and never the caller's own: both are `ListingNotFoundError` (a 404, the same as an unknown id).
- Applying is rate limited per seeker (`APPLY_RATE_LIMIT_HOUR`, `APPLY_RATE_LIMIT_DAY`); every
  authenticated, body-valid attempt counts, a refused one does not.
- The applicant count is every application of the listing except withdrawn ones (declined ones
  applied); `view_count` is approximate by design (bots, refetches and the owner all count).
- Owner side (0004c): a withdrawn application is invisible to the owner (a 404, like an unknown
  id, another owner's listing or an application of a different listing); a decline is final
  (PRODUCT.md, Q6). The listing's own state (live, paused, expired) never matters. The owner learns
  of an applicant only `users.display_name` and the message (NF2): no query loads the `User`."""

import uuid
from collections.abc import Sequence

from sqlalchemy import case, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import Application, Conversation, Listing, User
from app.redis_client import RedisClient
from app.schemas.application import ApplicantStatus
from app.services import search as search_service
from app.services.listings import ListingNotFoundError
from app.services.rate_limit import count_or_raise

APPLY_RATE_LIMIT_HOUR = 10
APPLY_RATE_WINDOW_S = 3600
APPLY_RATE_LIMIT_DAY = 30
APPLY_RATE_DAY_S = 86_400

_WITHDRAWABLE = ("submitted", "shortlisted")

# The owner's transition table (spec 0004c): target status -> the current statuses it may be set
# from. Setting the current status again is a no-op that keeps `updated_at`. Not listed (and so a
# 409): from `declined` to `shortlisted` / `submitted`. `withdrawn` is never a source (a 404).
ALLOWED_FROM: dict[ApplicantStatus, frozenset[str]] = {
    "shortlisted": frozenset({"submitted", "shortlisted"}),
    "submitted": frozenset({"submitted", "shortlisted"}),
    "declined": frozenset({"submitted", "shortlisted", "declined"}),
}


class AlreadyAppliedError(Exception):
    """The seeker already has a submitted, shortlisted or declined application to the listing."""


class ApplicationNotFoundError(Exception):
    """Unknown application id, or another seeker's (deliberately one case). Owner side (0004c):
    unknown id, another owner's listing, an application of a different listing, or a withdrawn
    one."""


class InvalidTransitionError(Exception):
    """The owner's status change is not in `ALLOWED_FROM` (from `declined`: a decline is final)."""


class NotWithdrawableError(Exception):
    """The application is already withdrawn, or declined (withdrawing would reopen it)."""


def _upsert(
    db: Session, listing_id: uuid.UUID, seeker_id: uuid.UUID, message: str
) -> Application | None:
    """Insert the application, or reopen a withdrawn one; None when one exists in any other
    status (including the row a concurrent apply just inserted)."""
    stmt = insert(Application).values(listing_id=listing_id, seeker_id=seeker_id, message=message)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_applications_listing_seeker",
        set_={
            "status": "submitted",
            "message": stmt.excluded.message,
            "created_at": func.now(),
            "updated_at": func.now(),
        },
        where=Application.status == "withdrawn",
    )
    return db.scalar(stmt.returning(Application).execution_options(populate_existing=True))


def apply(
    db: Session, r: RedisClient, seeker: User, listing_id: uuid.UUID, message: str
) -> tuple[Application, Listing]:
    """Apply `seeker` to a public listing with `message` (already validated by `ApplicationIn`).
    Raises `RateLimitedError`, `ListingNotFoundError` or `AlreadyAppliedError`. Commits."""
    count_or_raise(
        r,
        (
            (f"rl:apply:user:{seeker.id}", APPLY_RATE_LIMIT_HOUR, APPLY_RATE_WINDOW_S),
            (f"rl:apply:user:day:{seeker.id}", APPLY_RATE_LIMIT_DAY, APPLY_RATE_DAY_S),
        ),
    )
    try:
        listing = search_service.get_public_listing(db, listing_id)
        # A user whose role changes later must never apply to their own listing.
        if listing.owner_id == seeker.id:
            raise ListingNotFoundError
        application = _upsert(db, listing.id, seeker.id, message)
        if application is None:
            raise AlreadyAppliedError
        db.commit()
    except Exception:
        db.rollback()
        raise
    return application, listing


def list_my_applications(db: Session, seeker: User) -> Sequence[tuple[Application, Listing]]:
    """Every application of `seeker` (every status, every listing state) with its listing, newest
    `created_at` first, then `id`. One statement."""
    rows = db.execute(
        select(Application, Listing)
        .join(Listing, Listing.id == Application.listing_id)
        .where(Application.seeker_id == seeker.id)
        .order_by(Application.created_at.desc(), Application.id)
    ).tuples()
    return rows.all()


def withdraw(db: Session, seeker: User, application_id: uuid.UUID) -> tuple[Application, Listing]:
    """Withdraw one of `seeker`'s own `submitted` or `shortlisted` applications, whatever the
    listing's state. Raises `ApplicationNotFoundError` (unknown or another seeker's) or
    `NotWithdrawableError` (already withdrawn, or declined). Commits."""
    try:
        application = db.scalar(
            update(Application)
            .where(
                Application.id == application_id,
                Application.seeker_id == seeker.id,
                Application.status.in_(_WITHDRAWABLE),
            )
            .values(status="withdrawn", updated_at=func.now())
            .returning(Application)
            .execution_options(populate_existing=True)
        )
        if application is None:
            status = db.scalar(
                select(Application.status).where(
                    Application.id == application_id, Application.seeker_id == seeker.id
                )
            )
            if status is None:
                raise ApplicationNotFoundError
            raise NotWithdrawableError
        listing = db.get(Listing, application.listing_id)
        assert listing is not None  # the FK cascades: an application never outlives its listing
        db.commit()
    except Exception:
        db.rollback()
        raise
    return application, listing


def record_view(db: Session, listing_id: uuid.UUID) -> int:
    """Count one view of a public listing and return its applicant count (every application
    except withdrawn ones). Call only after `get_public_listing` succeeded. The count runs
    first and the UPDATE last, so the listing row lock is held only for the UPDATE and the
    commit, not across the count."""
    try:
        count = db.scalar(
            select(func.count())
            .select_from(Application)
            .where(Application.listing_id == listing_id, Application.status != "withdrawn")
        )
        db.execute(
            update(Listing)
            .where(Listing.id == listing_id)
            .values(view_count=Listing.view_count + 1)
            # The loaded `listing` keeps its old `view_count`: no public schema shows it.
            .execution_options(synchronize_session=False)
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return int(count or 0)


def list_applicants(
    db: Session, owner: User, listing_id: uuid.UUID
) -> Sequence[tuple[Application, str]]:
    """The non-withdrawn applications of one of `owner`'s listings (any listing state) with each
    applicant's display name, newest `created_at` first, then `id`. Raises `ListingNotFoundError`
    (unknown id or another owner's listing). Two statements: the ownership check, then the list,
    which selects `users.display_name` only (NF2)."""
    own = db.scalar(
        select(Listing.id).where(Listing.id == listing_id, Listing.owner_id == owner.id)
    )
    if own is None:
        raise ListingNotFoundError
    rows = db.execute(
        select(Application, User.display_name)
        .join(User, User.id == Application.seeker_id)
        .where(Application.listing_id == listing_id, Application.status != "withdrawn")
        .order_by(Application.created_at.desc(), Application.id)
    ).tuples()
    return rows.all()


def set_applicant_status(
    db: Session,
    owner: User,
    listing_id: uuid.UUID,
    application_id: uuid.UUID,
    status: ApplicantStatus,
) -> tuple[Application, str]:
    """Set an applicant of one of `owner`'s listings to `status` (`shortlisted`, `submitted` or
    `declined`), whatever the listing's state, and return it with the applicant's display name.
    One conditional UPDATE: ownership, the listing / application pair and `ALLOWED_FROM` are all in
    its WHERE, so a concurrent withdraw or decline cannot interleave. A same-status change keeps
    `updated_at` (in Postgres the SET clause's CASE sees the pre-update status). Raises
    `ApplicationNotFoundError` (unknown listing or application, another owner's listing, an
    application of a different listing, a withdrawn one) or `InvalidTransitionError`. The fallback
    status SELECT runs in a fresh READ COMMITTED snapshot, so a seeker withdrawing or re-applying
    between the UPDATE and the SELECT can turn a 404 into a 409 or the reverse; no data changes in
    either case and the client re-fetches. To `shortlisted`, also opens the application's chat in
    the same transaction (spec 0005a: one conversation per application, insert on conflict do
    nothing). Commits."""
    applicant_name = (
        select(User.display_name)
        .where(User.id == Application.seeker_id)
        .correlate(Application)
        .scalar_subquery()
    )
    try:
        row = (
            db.execute(
                update(Application)
                .where(
                    Application.id == application_id,
                    Application.listing_id == listing_id,
                    Listing.id == Application.listing_id,
                    Listing.owner_id == owner.id,
                    Application.status.in_(ALLOWED_FROM[status]),
                )
                .values(
                    status=status,
                    updated_at=case(
                        (Application.status == status, Application.updated_at), else_=func.now()
                    ),
                )
                .returning(Application, applicant_name)
                .execution_options(populate_existing=True, synchronize_session=False)
            )
            .tuples()
            .one_or_none()
        )
        if row is None:
            current = db.scalar(
                select(Application.status).where(
                    Application.id == application_id,
                    Application.listing_id == listing_id,
                    Listing.id == Application.listing_id,
                    Listing.owner_id == owner.id,
                )
            )
            if current is None or current == "withdrawn":
                raise ApplicationNotFoundError
            raise InvalidTransitionError
        application: Application = row[0]
        name: str = row[1]
        if status == "shortlisted":
            # Opens the chat (spec 0005a), once per application ever: a re-shortlist finds the
            # row and inserts nothing; an un-shortlist or a decline never touches it.
            db.execute(
                insert(Conversation)
                .values(
                    application_id=application.id,
                    owner_id=owner.id,
                    seeker_id=application.seeker_id,
                    owner_read_at=func.now(),
                )
                .on_conflict_do_nothing(index_elements=["application_id"])
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return application, name
