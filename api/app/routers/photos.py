"""Listing photo endpoints (spec 0010d). Thin: all logic is in `services/photos.py`.

Every route requires a session (`current_user`, 401 `unauthenticated`) and the listing to be the
caller's own, whatever its type or status and whatever the caller's role: an unknown listing and
another's are one 404 `not_found`.

Upload: the request body **is** the image (`Content-Type: image/jpeg`, `image/png` or `image/webp`;
not multipart, and the header is not trusted: Pillow decides the format). Before the body is read,
the attempt is counted against the user's photo rate limit (a 429 with `Retry-After` costs no
bandwidth) and the request's transaction is committed, so a slow body, the re-encode and the store
never hold a pooled connection idle in a transaction. `read_capped` stops reading past 8 MB. The
re-encode, the store and the database run in the threadpool: the event loop is never blocked.
Nothing here logs or echoes the body; a 413 / 415 logs the route and the error code only.

Delete and reorder are not rate-limited. Spec 0010j adds its person upload route to this router the
same way, counting against the same limit."""

import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.auth import current_user
from app.db import get_session
from app.models import User
from app.redis_client import RedisClient, get_redis
from app.schemas.error import ErrorOut
from app.schemas.photo import PhotoOrderIn, PhotoOut
from app.services import photos as photos_service
from app.services.listings import ListingNotFoundError
from app.services.photo_store import PhotoStore, PhotoStoreUnavailable, get_photo_store
from app.services.rate_limit import RateLimitedError

log = logging.getLogger(__name__)

router = APIRouter(tags=["photos"])

DbDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[User, Depends(current_user)]
RedisDep = Annotated[RedisClient, Depends(get_redis)]
StoreDep = Annotated[PhotoStore, Depends(get_photo_store)]

IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp")
# The raw image body, for the OpenAPI schema (and so the generated client) only.
IMAGE_BODY: dict[str, Any] = {
    "requestBody": {
        "required": True,
        "content": {
            media_type: {"schema": {"type": "string", "format": "binary"}}
            for media_type in IMAGE_TYPES
        },
    }
}

_AUTH: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorOut, "description": "unauthenticated"},
    503: {"model": ErrorOut, "description": "The database is unreachable"},
}
_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorOut, "description": "not_found: unknown listing or another's"},
}
UPLOAD_ERRORS: dict[int | str, dict[str, Any]] = {
    413: {"model": ErrorOut, "description": "photo_too_large: over 8 MB or over 40 megapixels"},
    415: {
        "model": ErrorOut,
        "description": "unsupported_image: empty, not JPEG / PNG / WebP, or corrupt",
    },
    429: {"model": ErrorOut, "description": "rate_limited; see Retry-After"},
    503: {
        "model": ErrorOut,
        "description": "photo_storage_unavailable, or the database is unreachable",
    },
}


def _too_large() -> HTTPException:
    return HTTPException(status_code=413, detail="photo_too_large")


def _unsupported() -> HTTPException:
    return HTTPException(status_code=415, detail="unsupported_image")


def _storage_unavailable() -> HTTPException:
    return HTTPException(status_code=503, detail="photo_storage_unavailable")


async def read_capped(request: Request, cap: int) -> bytes:
    """The request body, at most `cap` bytes: a `Content-Length` over `cap` is a 413 without
    reading anything; otherwise the stream is read and a 413 is raised as soon as the running
    total passes `cap` (a chunked body has no `Content-Length`). An empty body is a 415."""
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            too_long = int(declared) > cap
        except ValueError:
            too_long = False  # the server rejects a malformed length; the stream check still holds
        if too_long:
            raise _too_large()
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > cap:
            raise _too_large()
        chunks.append(chunk)
    if total == 0:
        raise _unsupported()
    return b"".join(chunks)


def count_upload_and_release(db: Session, r: RedisClient, user: User) -> None:
    """Count one upload attempt (`RateLimitedError` at the limit), then end the transaction the
    session lookup began, returning its connection to the pool before the body is read.
    `expire_on_commit=False` keeps `user` loaded. Run in the threadpool (sync Redis and DB)."""
    try:
        photos_service.count_photo_upload(r, user.id)
    finally:
        db.commit()


async def _read_upload(request: Request, db: Session, r: RedisClient, user: User) -> bytes:
    """The rate limit and the capped body read shared by every upload route."""
    try:
        await run_in_threadpool(count_upload_and_release, db, r, user)
    except RateLimitedError as exc:
        raise HTTPException(
            status_code=429, detail="rate_limited", headers={"Retry-After": str(exc.retry_after)}
        ) from None
    try:
        return await read_capped(request, photos_service.MAX_PHOTO_BYTES)
    except HTTPException as exc:
        _log_refused(request, exc.detail)
        raise


def _log_refused(request: Request, code: object) -> None:
    route = getattr(request.scope.get("route"), "path", "?")
    log.info("photo upload refused on %s %s: %s", request.method, route, code)


@router.post(
    "/listings/{listing_id}/photos",
    status_code=201,
    response_model=PhotoOut,
    openapi_extra=IMAGE_BODY,
    responses={
        **_AUTH,
        **_NOT_FOUND,
        409: {"model": ErrorOut, "description": "photo_limit: the listing has 10 photos"},
        **UPLOAD_ERRORS,
    },
)
async def upload_listing_photo(
    listing_id: uuid.UUID,
    request: Request,
    user: UserDep,
    db: DbDep,
    r: RedisDep,
    store: StoreDep,
) -> PhotoOut:
    """Add one photo (the raw image as the body) last on the caller's listing."""
    data = await _read_upload(request, db, r, user)
    try:
        photo = await run_in_threadpool(
            photos_service.add_listing_photo, db, store, user, listing_id, data
        )
    except photos_service.PhotoTooLargeError:
        _log_refused(request, "photo_too_large")
        raise _too_large() from None
    except photos_service.UnsupportedImageError:
        _log_refused(request, "unsupported_image")
        raise _unsupported() from None
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except photos_service.PhotoLimitError:
        raise HTTPException(status_code=409, detail="photo_limit") from None
    except PhotoStoreUnavailable:
        raise _storage_unavailable() from None
    return photos_service.photo_out(photo.id, photo.key)


@router.delete(
    "/listings/{listing_id}/photos/{photo_id}",
    status_code=204,
    responses={
        **_AUTH,
        404: {
            "model": ErrorOut,
            "description": "not_found: unknown listing, another's, or not a photo of this listing",
        },
    },
)
def delete_listing_photo(
    listing_id: uuid.UUID, photo_id: uuid.UUID, user: UserDep, db: DbDep, store: StoreDep
) -> Response:
    """Delete one photo; the photos after it move up one position."""
    try:
        photos_service.delete_listing_photo(db, store, user, listing_id, photo_id)
    except (ListingNotFoundError, photos_service.PhotoNotFoundError):
        raise HTTPException(status_code=404, detail="not_found") from None
    return Response(status_code=204)


@router.put(
    "/listings/{listing_id}/photos/order",
    response_model=list[PhotoOut],
    responses={
        **_AUTH,
        **_NOT_FOUND,
        422: {
            "description": "photo_order_mismatch: not exactly the listing's photos, each once;"
            " or a malformed body (list `detail`)"
        },
    },
)
def reorder_listing_photos(
    listing_id: uuid.UUID, body: PhotoOrderIn, user: UserDep, db: DbDep
) -> list[PhotoOut]:
    """Set the photos' order (the first is the cover); returns them in that order."""
    try:
        photos = photos_service.reorder_listing_photos(db, user, listing_id, body.photo_ids)
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except photos_service.PhotoOrderMismatchError:
        raise HTTPException(status_code=422, detail="photo_order_mismatch") from None
    return photos_service.photos_out(photos)
