"""Listing photos (spec 0010d): re-encode, store, order, and the photo addresses.

Every upload is decoded by Pillow (JPEG, PNG or WebP only, whatever the `Content-Type` said) and
re-encoded into two WebP copies, `{key}-s.webp` (480 px long edge) and `{key}-l.webp` (1600 px),
with the EXIF orientation applied and **no** metadata (no EXIF, GPS, XMP or ICC). `key` is
`secrets.token_urlsafe(32)` and nothing else is ever part of an object name (MARKET-PLAN Q16: random
public addresses that never contain a user or listing id).

Ownership: every write locks the caller's own listing first (`owner_id = :me`, `FOR NO KEY UPDATE`),
so another owner's listing is indistinguishable from an unknown id (`ListingNotFoundError`, a 404),
and two uploads to one listing serialise: the cap of `MAX_LISTING_PHOTOS` holds under concurrency.
`FOR NO KEY UPDATE` does not wait for the `FOR KEY SHARE` that apply and like take
(`services/search.py`).

Cleanup: a refused or failed upload deletes the objects it put; a delete removes the row first and
the objects after the commit (a failed object delete is logged and leaves an unreferenced object,
spec Risks).

Person photos (spec 0010j): one per account, `users.photo_key`, through the same pipeline, store and
rate limit. Only the small address is ever exposed (`person_photo_url`), and only in responses that
already show that person to the caller (MARKET-PLAN Q16)."""

import asyncio
import logging
import secrets
import uuid
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import SmallInteger, delete, func, select, update, values
from sqlalchemy import column as sql_column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from app.config import get_settings
from app.models import Listing, ListingPhoto, User
from app.redis_client import RedisClient
from app.schemas.photo import PhotoOut
from app.services.listings import ListingNotFoundError
from app.services.photo_store import PhotoStore, PhotoStoreUnavailable
from app.services.rate_limit import RateLimitedError, count_or_raise

log = logging.getLogger(__name__)

MAX_PHOTO_BYTES = 8 * 1024 * 1024
MAX_LISTING_PHOTOS = 10
MAX_PIXELS = 40_000_000
SMALL_EDGE = 480
LARGE_EDGE = 1600
# Pillow reports a JPEG with an MPF block (many iPhone and Samsung photos) as `MPO`; frame 0 is the
# primary image.
ALLOWED_FORMATS = frozenset({"JPEG", "MPO", "PNG", "WEBP"})
# The only Pillow plugins that may ever parse an upload (`JPEG` also opens MPO files).
_OPEN_FORMATS = ("JPEG", "PNG", "WEBP")
WEBP_QUALITY = 80
WEBP_METHOD = 4

# Uploads per user, refused ones included (0010j's person photo counts against the same two).
PHOTO_RATE_LIMIT_HOUR = 60
PHOTO_RATE_LIMIT_DAY = 300

# A backstop: Pillow refuses (`DecompressionBombError`) anything over twice this at open. `encode`
# checks `MAX_PIXELS` itself on the header, before any decode.
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
# Uploads decode on these two threads only, never on the shared anyio threadpool: at most two images
# are decoded at once per process, and only two threads ever hold a decode's malloc arena (with
# `MALLOC_ARENA_MAX=2` in the image). A waiting upload holds no threadpool thread.
_ENCODE_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="photo-encode")

# One upload in flight per user (`take_upload_slot`); the TTL frees a slot a crashed request left.
UPLOAD_SLOT_TTL_S = 60
UPLOAD_SLOT_RETRY_AFTER_S = 5
# Deletes the slot only if it still holds this request's token.
_RELEASE_SLOT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
"""
# 16-bit (and 32-bit integer) grayscale: scaled to 8 bits, since `convert` clips instead.
_WIDE_GRAY_MODES = frozenset({"I", "I;16", "I;16L", "I;16B", "I;16N"})


class PhotoTooLargeError(Exception):
    """More than `MAX_PHOTO_BYTES`, or more than `MAX_PIXELS` pixels (a 413)."""


class UnsupportedImageError(Exception):
    """Empty, not JPEG / PNG / WebP, or corrupt (a 415)."""


class PhotoLimitError(Exception):
    """The listing already has `MAX_LISTING_PHOTOS` photos (a 409)."""


class PhotoNotFoundError(Exception):
    """No photo with this id on this listing (a 404)."""


class PhotoOrderMismatchError(Exception):
    """The ids are not exactly the listing's photos, each once (a 422)."""


@dataclass(frozen=True, slots=True)
class Encoded:
    small: bytes
    large: bytes
    width: int  # the large copy's
    height: int


def new_key() -> str:
    """A fresh random object key: 43 URL-safe characters (256 bits)."""
    return secrets.token_urlsafe(32)


def small_name(key: str) -> str:
    return f"{key}-s.webp"


def large_name(key: str) -> str:
    return f"{key}-l.webp"


def object_names(key: str) -> tuple[str, str]:
    """The two stored objects of one photo: small, large."""
    return small_name(key), large_name(key)


def small_url(key: str) -> str:
    return f"{get_settings().photo_public_base_url}/{small_name(key)}"


def large_url(key: str) -> str:
    return f"{get_settings().photo_public_base_url}/{large_name(key)}"


def photo_out(photo_id: uuid.UUID, key: str) -> PhotoOut:
    return PhotoOut(id=photo_id, small_url=small_url(key), large_url=large_url(key))


def cover_out(cover_id: uuid.UUID | None, cover_key: str | None) -> PhotoOut | None:
    """The cover from a search row's `cover_id` / `cover_key` (`services/search.py`), or None."""
    if cover_id is None or cover_key is None:
        return None
    return photo_out(cover_id, cover_key)


def upload_slot_key(user_id: uuid.UUID) -> str:
    return f"rl:photo:user:{user_id}:inflight"


def take_upload_slot(r: RedisClient, user_id: uuid.UUID) -> str:
    """Take the user's one upload slot and return its token; `RateLimitedError` (retry after
    `UPLOAD_SLOT_RETRY_AFTER_S`) while another upload of theirs is in flight."""
    token = secrets.token_hex(16)
    if not r.set(upload_slot_key(user_id), token, nx=True, ex=UPLOAD_SLOT_TTL_S):
        raise RateLimitedError(retry_after=UPLOAD_SLOT_RETRY_AFTER_S)
    return token


def release_upload_slot(r: RedisClient, user_id: uuid.UUID, token: str) -> None:
    """Free the user's upload slot if it is still the one `token` took."""
    r.eval(_RELEASE_SLOT, 1, upload_slot_key(user_id), token)  # type: ignore[no-untyped-call]  # untyped stub


def count_photo_upload(r: RedisClient, user_id: uuid.UUID) -> None:
    """Count one upload attempt against the user's hourly and daily photo limits; raises
    `RateLimitedError` (counting nothing) when either is reached."""
    count_or_raise(
        r,
        [
            (f"rl:photo:user:{user_id}", PHOTO_RATE_LIMIT_HOUR, 3600),
            (f"rl:photo:user:{user_id}:day", PHOTO_RATE_LIMIT_DAY, 86400),
        ],
    )


def _webp(image: Image.Image, edge: int) -> tuple[bytes, tuple[int, int]]:
    """`image` fitted inside `edge` x `edge` (never upscaled) as WebP, and its size."""
    copy = image.copy()
    copy.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    out = BytesIO()
    # No `exif=`, `icc_profile=` or `xmp=`: the output carries no metadata.
    copy.save(out, format="WEBP", quality=WEBP_QUALITY, method=WEBP_METHOD)
    return out.getvalue(), copy.size


def _encode(data: bytes) -> Encoded:
    # Lazy: reads the header only. `formats` keeps every other Pillow plugin away from the bytes.
    img = Image.open(BytesIO(data), formats=list(_OPEN_FORMATS))
    if img.format not in ALLOWED_FORMATS:
        raise UnsupportedImageError
    if img.width * img.height > MAX_PIXELS:
        raise PhotoTooLargeError  # before any pixel is decoded
    if img.format in {"JPEG", "MPO"}:
        # DCT-scaled decode: a large JPEG never sits in memory at full size.
        img.draft("RGB", (LARGE_EDGE, LARGE_EDGE))
    alpha = img.has_transparency_data
    # Decodes frame 0 only (an animated WebP or APNG keeps its first frame) and applies the EXIF
    # orientation, so the EXIF can go.
    oriented = ImageOps.exif_transpose(img)
    if oriented.mode in _WIDE_GRAY_MODES:
        oriented = oriented.convert("I").point(lambda v: v * (1 / 256)).convert("L")
    rgb = oriented.convert("RGBA" if alpha else "RGB")
    rgb.info.clear()
    large, (width, height) = _webp(rgb, LARGE_EDGE)
    small, _ = _webp(rgb, SMALL_EDGE)
    return Encoded(small=small, large=large, width=width, height=height)


def encode(data: bytes) -> Encoded:
    """Decode `data` (JPEG, MPO, PNG or WebP, by its bytes, never by a header) and re-encode it as
    two WebP copies without metadata. Raises `PhotoTooLargeError` over `MAX_PIXELS` (checked on the
    header, before decoding) and `UnsupportedImageError` for anything else that fails. Pure: no
    database, no store. An upload calls it through `encode_upload`."""
    try:
        return _encode(data)
    except (PhotoTooLargeError, UnsupportedImageError):
        raise
    except Image.DecompressionBombError:
        raise PhotoTooLargeError from None
    except UnidentifiedImageError:
        raise UnsupportedImageError from None
    except Exception as exc:  # corrupt headers or EXIF raise all sorts; never a 500
        log.warning("photo decode failed: %s", type(exc).__name__)
        raise UnsupportedImageError from None


async def encode_upload(data: bytes) -> Encoded:
    """`encode` on the dedicated two-thread photo pool (never the shared threadpool)."""
    return await asyncio.get_running_loop().run_in_executor(_ENCODE_POOL, encode, data)


def _lock_own_listing(db: Session, owner_id: uuid.UUID, listing_id: uuid.UUID) -> None:
    """Lock the caller's listing `FOR NO KEY UPDATE` until the transaction ends;
    `ListingNotFoundError` when it is unknown or another owner's."""
    found = db.scalar(
        select(Listing.id)
        .where(Listing.id == listing_id, Listing.owner_id == owner_id)
        # `key_share` without `read` renders `FOR NO KEY UPDATE` on PostgreSQL.
        .with_for_update(key_share=True)
    )
    if found is None:
        raise ListingNotFoundError


def _photo_count(db: Session, listing_id: uuid.UUID) -> int:
    return db.execute(
        select(func.count()).select_from(ListingPhoto).where(ListingPhoto.listing_id == listing_id)
    ).scalar_one()


def check_listing_upload(db: Session, owner: User, listing_id: uuid.UUID) -> None:
    """Before an upload's body is read (no lock): `ListingNotFoundError` unless the listing is the
    caller's, `PhotoLimitError` when it is full. `add_listing_photo` checks both again under the
    lock."""
    found = db.scalar(
        select(Listing.id).where(Listing.id == listing_id, Listing.owner_id == owner.id)
    )
    if found is None:
        raise ListingNotFoundError
    if _photo_count(db, listing_id) >= MAX_LISTING_PHOTOS:
        raise PhotoLimitError


def _discard(store: PhotoStore, names: Sequence[str]) -> None:
    """Delete objects nothing references; a failure is logged (the store logs its own detail)."""
    try:
        store.delete(names)
    except PhotoStoreUnavailable:
        log.warning("photo cleanup failed: %d objects left behind", len(names))


def add_listing_photo(
    db: Session, store: PhotoStore, owner: User, listing_id: uuid.UUID, encoded: Encoded
) -> ListingPhoto:
    """Store both copies of an encoded upload under a new key and add the photo last on the
    caller's listing. Raises `PhotoStoreUnavailable`, `ListingNotFoundError` and
    `PhotoLimitError` (re-checked under the listing lock); on any failure both objects are deleted
    again."""
    key = new_key()
    names = object_names(key)
    try:
        store.put(names[0], encoded.small)
        store.put(names[1], encoded.large)
        _lock_own_listing(db, owner.id, listing_id)
        count = _photo_count(db, listing_id)
        if count >= MAX_LISTING_PHOTOS:
            raise PhotoLimitError
        photo = ListingPhoto(
            listing_id=listing_id,
            key=key,
            position=count,
            width=encoded.width,
            height=encoded.height,
        )
        db.add(photo)
        db.commit()
    except BaseException:
        _discard(store, names)
        raise
    return photo


def delete_listing_photo(
    db: Session, store: PhotoStore, owner: User, listing_id: uuid.UUID, photo_id: uuid.UUID
) -> None:
    """Delete one photo of the caller's listing; the photos after it move up one position. The
    objects are deleted after the commit; a store failure then is logged and swallowed."""
    _lock_own_listing(db, owner.id, listing_id)
    deleted = db.execute(
        delete(ListingPhoto)
        .where(ListingPhoto.id == photo_id, ListingPhoto.listing_id == listing_id)
        .returning(ListingPhoto.key, ListingPhoto.position)
        .execution_options(synchronize_session=False)
    ).first()
    if deleted is None:
        raise PhotoNotFoundError
    db.execute(
        update(ListingPhoto)
        .where(ListingPhoto.listing_id == listing_id, ListingPhoto.position > deleted.position)
        .values(position=ListingPhoto.position - 1)
        .execution_options(synchronize_session=False)
    )
    db.commit()
    _discard(store, object_names(deleted.key))


def reorder_listing_photos(
    db: Session, owner: User, listing_id: uuid.UUID, photo_ids: Sequence[uuid.UUID]
) -> list[ListingPhoto]:
    """Set the order of the caller's listing's photos to `photo_ids` (the first is the cover);
    `PhotoOrderMismatchError` unless they are exactly the listing's photos, each once. Returns
    the photos in the new order."""
    _lock_own_listing(db, owner.id, listing_id)
    photos = {
        photo.id: photo
        for photo in db.scalars(select(ListingPhoto).where(ListingPhoto.listing_id == listing_id))
    }
    if len(set(photo_ids)) != len(photo_ids) or set(photo_ids) != photos.keys():
        raise PhotoOrderMismatchError
    order = values(
        sql_column("id", UUID(as_uuid=True)),
        sql_column("position", SmallInteger),
        name="new_order",
    ).data([(photo_id, index) for index, photo_id in enumerate(photo_ids)])
    db.execute(
        update(ListingPhoto)
        .where(ListingPhoto.id == order.c.id)
        .values(position=order.c.position)
        .execution_options(synchronize_session=False)
    )
    db.commit()
    ordered = [photos[photo_id] for photo_id in photo_ids]
    for index, photo in enumerate(ordered):
        set_committed_value(photo, "position", index)
    return ordered


def _lock_photo_key(db: Session, user_id: uuid.UUID) -> str | None:
    """The user's current photo key, read under a `FOR NO KEY UPDATE` row lock until the
    transaction ends. A scalar, never the identity-mapped `User`: two concurrent writes each read
    the key the other committed, never a stale one."""
    key: str | None = db.scalar(
        select(User.photo_key)
        .where(User.id == user_id)
        # `key_share` without `read` renders `FOR NO KEY UPDATE` on PostgreSQL.
        .with_for_update(key_share=True)
    )
    return key


def _set_photo_key(db: Session, user_id: uuid.UUID, key: str | None) -> None:
    db.execute(
        update(User)
        .where(User.id == user_id)
        .values(photo_key=key)
        .execution_options(synchronize_session=False)
    )


def set_user_photo(db: Session, store: PhotoStore, user: User, encoded: Encoded) -> str | None:
    """Store both copies of an encoded upload under a new key and make it `user`'s photo; returns
    the old key (None without one). On any failure before the commit both new objects are deleted
    again and the old photo stays. After the commit the old photo's objects are deleted (a failure
    is logged and swallowed). Raises `PhotoStoreUnavailable`. `user.photo_key` is the new key."""
    key = new_key()
    names = object_names(key)
    try:
        store.put(names[0], encoded.small)
        store.put(names[1], encoded.large)
        old = _lock_photo_key(db, user.id)
        _set_photo_key(db, user.id, key)
        db.commit()
    except BaseException:
        _discard(store, names)
        raise
    set_committed_value(user, "photo_key", key)
    if old is not None:
        _discard(store, object_names(old))
    return old


def clear_user_photo(db: Session, store: PhotoStore, user: User) -> None:
    """Remove `user`'s photo: the column is cleared and committed first, then both objects are
    deleted (a failure is logged and swallowed). Idempotent: without a photo nothing is deleted."""
    old = _lock_photo_key(db, user.id)
    if old is not None:
        _set_photo_key(db, user.id, None)
    db.commit()
    set_committed_value(user, "photo_key", None)
    if old is not None:
        _discard(store, object_names(old))


def person_photo_url(key: str | None) -> str | None:
    """A person's photo address (the small copy only), or None without a photo."""
    return None if key is None else small_url(key)


def photos_by_listing(
    db: Session, listing_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[ListingPhoto]]:
    """Each listing's photos in position order (every id is a key, `[]` without photos). One
    statement; none for an empty `listing_ids`."""
    result: dict[uuid.UUID, list[ListingPhoto]] = {listing_id: [] for listing_id in listing_ids}
    if not listing_ids:
        return result
    for photo in db.scalars(
        select(ListingPhoto)
        .where(ListingPhoto.listing_id.in_(listing_ids))
        .order_by(ListingPhoto.listing_id, ListingPhoto.position)
    ):
        result[photo.listing_id].append(photo)
    return result


def photos_out(photos: Sequence[ListingPhoto]) -> list[PhotoOut]:
    return [photo_out(photo.id, photo.key) for photo in photos]
