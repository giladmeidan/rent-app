"""Self-serve account deletion and the re-signup block (spec 0013c).

`delete_account` scrubs the caller's account into a tombstone in one transaction: the `users` row
stays (every FK to it, 14 in 11 tables, cascades, so deleting it would erase the other side's
threads and the reports), with `deleted_at` set and no email, name or photo
(`ck_users_deleted_scrubbed`). Their personal data goes; the threads, messages, reports and the
listing rows (paused, without photos, description or invite link) stay. The photo objects are
deleted after the commit, so a failure before it deletes nothing.

An account homie acted against (an `admin_actions` `suspend` on it, or `hide_listing` on one of its
listings, even if later lifted) leaves the keyed hash of its email in `blocked_emails`, and that
email cannot sign up again (`email_blocked`, checked by `services/auth.py::verify_otp`)."""

import hashlib
import hmac
import logging

from sqlalchemy import and_, delete, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    AdminAction,
    Application,
    BlockedEmail,
    Conversation,
    ConversationRead,
    Listing,
    ListingFlatmate,
    ListingPhoto,
    PersonPair,
    RoomPair,
    SeekerProfile,
    User,
)
from app.models import Session as SessionRow
from app.services import auth  # a module import: auth.py imports this module too
from app.services.photo_store import PhotoStore
from app.services.photos import _discard, object_names

log = logging.getLogger(__name__)


def email_hmac(email: str) -> str:
    """The keyed hash of a normalised email (`EMAIL_BLOCK_KEY`, never `SECRET_KEY`): a dump of
    `blocked_emails` cannot confirm a guessed address without the key."""
    key = get_settings().email_block_key.get_secret_value().encode()
    return hmac.new(key, auth.normalise_email(email).encode(), hashlib.sha256).hexdigest()


def email_blocked(db: Session, email: str) -> bool:
    """Whether `email` may not sign up again."""
    return bool(db.scalar(select(exists().where(BlockedEmail.email_hmac == email_hmac(email)))))


def delete_account(db: Session, store: PhotoStore, user: User) -> None:
    """Delete `user`'s account (the spec's 13 steps, in order). A second call on the tombstone,
    including one that waited on the first's row lock, writes nothing. Commits; any failure before
    the commit rolls everything back and deletes no object."""
    me = user.id
    try:
        # 1. Lock the row, read as columns (the identity-mapped `user` predates the lock).
        # Serialises with listing create / resume, a login's `last_login_at` write and a second
        # DELETE /me.
        locked = db.execute(
            select(User.deleted_at, User.email, User.photo_key)
            .where(User.id == me)
            .with_for_update()
        ).one()
        if locked.deleted_at is not None:
            db.rollback()
            return
        my_listings = select(Listing.id).where(Listing.owner_id == me).scalar_subquery()
        # 2. The re-signup block.
        acted_against = exists().where(
            or_(
                and_(
                    AdminAction.action == "suspend",
                    AdminAction.target_type == "user",
                    AdminAction.target_id == me,
                ),
                and_(
                    AdminAction.action == "hide_listing",
                    AdminAction.target_type == "listing",
                    AdminAction.target_id.in_(my_listings),
                ),
            )
        )
        if db.scalar(select(acted_against)):
            assert locked.email is not None  # a live row has one (ck_users_deleted_scrubbed)
            db.execute(
                insert(BlockedEmail)
                .values(email_hmac=email_hmac(locked.email))
                .on_conflict_do_nothing()
            )
        # 3. Listings off the site, before the photos: its row locks wait for a photo write that
        # holds `_lock_own_listing`, so step 4 sees that write's committed row.
        db.execute(
            update(Listing)
            .where(Listing.owner_id == me)
            .values(
                status="paused", description=None, flatmate_invite_hash=None, updated_at=func.now()
            )
            .execution_options(synchronize_session=False)
        )
        # 4. Listing photos; the objects go after the commit.
        keys = list(
            db.scalars(
                delete(ListingPhoto)
                .where(ListingPhoto.listing_id.in_(my_listings))
                .returning(ListingPhoto.key)
                .execution_options(synchronize_session=False)
            )
        )
        if locked.photo_key is not None:
            keys.append(locked.photo_key)
        # 5. My applications nobody's thread hangs on.
        db.execute(
            delete(Application)
            .where(
                Application.seeker_id == me,
                ~exists().where(Conversation.application_id == Application.id),
            )
            .execution_options(synchronize_session=False)
        )
        # 6. The rest have a chat: withdrawn, so their owners no longer see them.
        db.execute(
            update(Application)
            .where(Application.seeker_id == me, Application.status != "withdrawn")
            .values(status="withdrawn", updated_at=func.now())
            .execution_options(synchronize_session=False)
        )
        # 7.-11. Likes, matches, flats I joined, read markers, profile, every session.
        for statement in (
            delete(RoomPair).where(
                or_(RoomPair.seeker_id == me, RoomPair.listing_id.in_(my_listings))
            ),
            delete(PersonPair).where(or_(PersonPair.user_low == me, PersonPair.user_high == me)),
            delete(ListingFlatmate).where(ListingFlatmate.user_id == me),
            delete(ConversationRead).where(ConversationRead.user_id == me),
            delete(SeekerProfile).where(SeekerProfile.user_id == me),
            delete(SessionRow).where(SessionRow.user_id == me),
        ):
            db.execute(statement.execution_options(synchronize_session=False))
        # 12. The tombstone.
        db.execute(
            update(User)
            .where(User.id == me)
            .values(
                deleted_at=func.now(),
                email=None,
                display_name=None,
                photo_key=None,
                last_login_at=None,
            )
            .execution_options(synchronize_session=False)
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    # 13. After the commit: a failed object delete leaves an unreferenced object (logged).
    names = [name for key in keys for name in object_names(key)]
    if names:
        _discard(store, names)
    log.info("account deleted: %d photo objects", len(names))
