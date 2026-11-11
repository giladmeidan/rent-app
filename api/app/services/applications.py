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
- Applying needs a housing profile (spec 0006a, PRODUCT.md "Matching"): checked **first**, so a
  seeker without one gets `ProfileRequiredError` and the call costs no rate-limit budget. Only
  applying is gated: existing applications are listed and withdrawn as before.
- Applying is rate limited per seeker (`APPLY_RATE_LIMIT_HOUR`, `APPLY_RATE_LIMIT_DAY`); every
  authenticated, body-valid attempt counts, a refused one does not.
- The applicant count is every application of the listing except withdrawn ones (declined ones
  applied); `view_count` is approximate by design (bots, refetches and the owner all count).
- Owner side (0004c): a withdrawn application is invisible to the owner (a 404, like an unknown
  id, another owner's listing or an application of a different listing); a decline is final
  (PRODUCT.md, Q6). The listing's own state (live, paused, expired) never matters. The owner learns
  of an applicant only `users.display_name` and the message (NF2): no query loads the `User`.
- Owner side, matching (0006c): each applicant also carries their **current** match against the
  listing (`matching.score.match_columns`, the number the seeker sees on that listing) and seven
  housing-profile columns selected by name, never `budget_max_ils` or `area_ids` (PRODUCT.md
  "Matching": an owner never sees a seeker's budget or areas). A pre-Slice-6 applicant with no
  profile row has NULL profile columns; its match columns are meaningless and never read. The
  default order is by match, applicants with a profile first."""

import uuid
from collections.abc import Sequence
from typing import Any, Literal

from sqlalchemy import Label, Row, Select, case, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.matching.score import match_columns
from app.models import Application, Conversation, Listing, SeekerProfile, User
from app.redis_client import RedisClient
from app.schemas.application import ApplicantStatus
from app.services import profiles as profiles_service
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


class ProfileRequiredError(Exception):
    """The seeker has no housing profile yet (spec 0006a); they must `PUT /me/profile` first."""


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
    Raises `ProfileRequiredError` (checked first: nothing counted), `RateLimitedError`,
    `ListingNotFoundError` or `AlreadyAppliedError`. Commits."""
    if not profiles_service.has_profile(db, seeker.id):
        raise ProfileRequiredError
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


ApplicantSort = Literal["match", "newest"]

# The owner-facing housing summary (0006c, NF2): by name, never the `SeekerProfile` entity, so
# `budget_max_ils` and `area_ids` are never loaded.
_PROFILE_COLUMNS = (
    SeekerProfile.household,
    SeekerProfile.move_in_date,
    SeekerProfile.move_in_flexible,
    SeekerProfile.has_pets,
    SeekerProfile.smoker,
    SeekerProfile.contract_months,
    SeekerProfile.parking_needed,
)


def _applicants(listing_id: uuid.UUID) -> tuple[Select[Any], Label[Any]]:
    """The non-withdrawn applications of `listing_id`, each with the applicant's display name, the
    seven owner-facing profile columns (NULL without a profile row) and the match columns; and the
    statement's `m_score` column. Unordered.

    It has **no ownership condition** of its own: both callers establish ownership first (the
    ownership SELECT in `list_applicants`, the UPDATE's WHERE in `set_applicant_status`)."""
    columns = match_columns(Listing, SeekerProfile)
    score = next(column for column in columns if column.name == "m_score")
    query = (
        select(Application, User.display_name, *_PROFILE_COLUMNS, *columns)
        .join(User, User.id == Application.seeker_id)
        .join(Listing, Listing.id == Application.listing_id)
        .outerjoin(SeekerProfile, SeekerProfile.user_id == Application.seeker_id)
        .where(Application.listing_id == listing_id, Application.status != "withdrawn")
    )
    return query, score


def list_applicants(
    db: Session, owner: User, listing_id: uuid.UUID, sort: ApplicantSort = "match"
) -> Sequence[Row[Any]]:
    """The non-withdrawn applications of one of `owner`'s listings (any listing state), each row as
    `_applicants` selects it. `sort="match"`: applicants with a profile first, then score, then
    newest `created_at`, then `id` (no-profile rows tie on whatever `m_score` they get and fall
    through to `created_at`); `"newest"`: newest `created_at` first, then `id`. Raises
    `ListingNotFoundError` (unknown id or another owner's listing). Two statements: the ownership
    check, then the list, which reads only `display_name` from `users` (NF2)."""
    own = db.scalar(
        select(Listing.id).where(Listing.id == listing_id, Listing.owner_id == owner.id)
    )
    if own is None:
        raise ListingNotFoundError
    query, score = _applicants(listing_id)
    newest = (Application.created_at.desc(), Application.id)
    if sort == "match":
        order: tuple[Any, ...] = (SeekerProfile.user_id.is_(None), score.desc(), *newest)
    else:
        order = newest
    return db.execute(query.order_by(*order)).all()


def set_applicant_status(
    db: Session,
    owner: User,
    listing_id: uuid.UUID,
    application_id: uuid.UUID,
    status: ApplicantStatus,
) -> Row[Any]:
    """Set an applicant of one of `owner`'s listings to `status` (`shortlisted`, `submitted` or
    `declined`), whatever the listing's state, and return its row as `list_applicants` does (the
    `_applicants` SELECT, run in the same transaction before the commit, so it sees the new
    status). One conditional UPDATE: ownership, the listing / application pair and `ALLOWED_FROM`
    are all in its WHERE, so a concurrent withdraw or decline cannot interleave. A same-status
    change keeps `updated_at` (in Postgres the SET clause's CASE sees the pre-update status).
    Raises `ApplicationNotFoundError` (unknown listing or application, another owner's listing, an
    application of a different listing, a withdrawn one) or `InvalidTransitionError`. The fallback
    status SELECT runs in a fresh READ COMMITTED snapshot, so a seeker withdrawing or re-applying
    between the UPDATE and the SELECT can turn a 404 into a 409 or the reverse; no data changes in
    either case and the client re-fetches. To `shortlisted`, also opens the application's chat in
    the same transaction (spec 0005a: one conversation per application, insert on conflict do
    nothing). Commits."""
    try:
        application = db.scalar(
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
            .returning(Application)
            .execution_options(populate_existing=True, synchronize_session=False)
        )
        if application is None:
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
        # The response row (0006c): the UPDATE's WHERE established ownership, and the row exists
        # and is locked by this transaction.
        query, _ = _applicants(listing_id)
        row = db.execute(query.where(Application.id == application.id)).one()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return row
