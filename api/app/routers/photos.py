"""Listing photo endpoints (spec 0010d). Thin: all logic is in `services/photos.py`.

Every route requires a session (`current_user`, 401 `unauthenticated`) and the listing to be the
caller's own, whatever its type or status and whatever the caller's role: an unknown listing and
another's are one 404 `not_found`.

Upload: the request body **is** the image (`Content-Type: image/jpeg`, `image/png` or `image/webp`;
not multipart, and the header is not trusted: Pillow decides the format). Before the body is read
(`prepare_upload`): the attempt is counted against the user's photo rate limit, the listing must be
the caller's (404), not removed by homie (409 `listing_removed`, spec 0012a) and not full (409
`photo_limit`), the user's one upload slot is taken (a second upload in flight is a 429,
`Retry-After: 5`), and the request's transaction is committed, so a slow body,
the re-encode and the store never hold a pooled connection idle in a transaction. None of these
refusals reads the body or decodes anything. `read_capped` stops reading past 8 MB. The re-encode
runs on the two-thread photo pool (`encode_upload`), the store and the database in the
threadpool: the event loop is never blocked.
Nothing here logs or echoes the body; a 413 / 415 logs the route and the error code only.

Delete and reorder count the shared `write` budget (spec 0011c, `app/limits.py`), every attempt, and
answer 409 `listing_removed` on a listing removed by homie (spec 0012a), nothing written.

Person photo (spec 0010j): `PUT /me/photo` and `DELETE /me/photo`, any role. The upload runs exactly
as a listing upload (no listing check), counting against the same limit and the same one upload
slot; it returns the caller's `UserOut`. The delete counts the shared `write` budget and is
idempotent."""

import logging
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from functools import partial
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import limits
from app.auth import current_user
from app.db import get_session
from app.models import User
from app.redis_client import RedisClient, get_redis
from app.routers.auth import user_out
from app.schemas.auth import UserOut
from app.schemas.error import ErrorOut
from app.schemas.photo import PhotoOrderIn, PhotoOut
from app.services import photos as photos_service
from app.services.listings import ListingNotFoundError, ListingRemovedError
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
_REMOVED: dict[int | str, dict[str, Any]] = {
    409: {"model": ErrorOut, "description": "listing_removed: removed by homie"},
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


def _removed() -> HTTPException:
    return HTTPException(status_code=409, detail="listing_removed")


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


def prepare_upload(
    db: Session, r: RedisClient, user: User, check: Callable[[], None] | None = None
) -> str:
    """Everything an upload does before its body is read, in the threadpool (sync Redis and DB):
    count the attempt (`RateLimitedError`), run `check` (the route's ownership and cap check, no
    lock), take the user's one upload slot (`RateLimitedError`, retry after 5 s) and end the
    transaction the session lookup began, so no pooled connection waits on the body, the encode or
    the store (`expire_on_commit=False` keeps `user` loaded). Returns the slot's token; the caller
    releases it with `release_upload_slot` once the upload ends."""
    photos_service.count_photo_upload(r, user.id)
    if check is not None:
        check()
    token = photos_service.take_upload_slot(r, user.id)
    try:
        db.commit()
    except BaseException:
        photos_service.release_upload_slot(r, user.id, token)
        raise
    return token


@asynccontextmanager
async def upload_body(
    request: Request,
    db: Session,
    r: RedisClient,
    user: User,
    check: Callable[[], None] | None = None,
) -> AsyncIterator[bytes]:
    """The pre-body step (`prepare_upload`) and the capped body read shared by every upload route;
    the user's upload slot is held for the whole `async with` block and released after it,
    whatever the outcome. The pre-body errors (`RateLimitedError` and `check`'s) propagate."""
    token = await run_in_threadpool(prepare_upload, db, r, user, check)
    try:
        try:
            data = await read_capped(request, photos_service.MAX_PHOTO_BYTES)
        except HTTPException as exc:
            _log_refused(request, exc.detail)
            raise
        yield data
    finally:
        await run_in_threadpool(photos_service.release_upload_slot, r, user.id, token)


def _rate_limited(exc: RateLimitedError) -> HTTPException:
    return HTTPException(
        status_code=429, detail="rate_limited", headers={"Retry-After": str(exc.retry_after)}
    )


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
        409: {
            "model": ErrorOut,
            "description": "photo_limit: the listing has 10 photos; listing_removed: removed by"
            " homie (before the body is read)",
        },
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
    check = partial(photos_service.check_listing_upload, db, user, listing_id)
    try:
        async with upload_body(request, db, r, user, check) as data:
            encoded = await photos_service.encode_upload(data)
            photo = await run_in_threadpool(
                photos_service.add_listing_photo, db, store, user, listing_id, encoded
            )
    except RateLimitedError as exc:
        raise _rate_limited(exc) from None
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
    except ListingRemovedError:
        raise _removed() from None
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
        **_REMOVED,
        **limits.RATE_LIMITED,
    },
)
def delete_listing_photo(
    listing_id: uuid.UUID,
    photo_id: uuid.UUID,
    user: UserDep,
    db: DbDep,
    r: RedisDep,
    store: StoreDep,
) -> Response:
    """Delete one photo; the photos after it move up one position."""
    limits.check(r, user.id, limits.WRITE)
    try:
        photos_service.delete_listing_photo(db, store, user, listing_id, photo_id)
    except (ListingNotFoundError, photos_service.PhotoNotFoundError):
        raise HTTPException(status_code=404, detail="not_found") from None
    except ListingRemovedError:
        raise _removed() from None
    return Response(status_code=204)


@router.put(
    "/listings/{listing_id}/photos/order",
    response_model=list[PhotoOut],
    responses={
        **_AUTH,
        **_NOT_FOUND,
        **_REMOVED,
        422: {
            "description": "photo_order_mismatch: not exactly the listing's photos, each once;"
            " or a malformed body (list `detail`)"
        },
        **limits.RATE_LIMITED,
    },
)
def reorder_listing_photos(
    listing_id: uuid.UUID, body: PhotoOrderIn, user: UserDep, db: DbDep, r: RedisDep
) -> list[PhotoOut]:
    """Set the photos' order (the first is the cover); returns them in that order."""
    limits.check(r, user.id, limits.WRITE)
    try:
        photos = photos_service.reorder_listing_photos(db, user, listing_id, body.photo_ids)
    except ListingNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except ListingRemovedError:
        raise _removed() from None
    except photos_service.PhotoOrderMismatchError:
        raise HTTPException(status_code=422, detail="photo_order_mismatch") from None
    return photos_service.photos_out(photos)


@router.put(
    "/me/photo",
    response_model=UserOut,
    openapi_extra=IMAGE_BODY,
    responses={**_AUTH, **UPLOAD_ERRORS},
)
async def set_my_photo(
    request: Request, user: UserDep, db: DbDep, r: RedisDep, store: StoreDep
) -> UserOut:
    """Set the caller's person photo (the raw image as the body), replacing any previous one."""
    try:
        async with upload_body(request, db, r, user) as data:
            encoded = await photos_service.encode_upload(data)
            await run_in_threadpool(photos_service.set_user_photo, db, store, user, encoded)
    except RateLimitedError as exc:
        raise _rate_limited(exc) from None
    except photos_service.PhotoTooLargeError:
        _log_refused(request, "photo_too_large")
        raise _too_large() from None
    except photos_service.UnsupportedImageError:
        _log_refused(request, "unsupported_image")
        raise _unsupported() from None
    except PhotoStoreUnavailable:
        raise _storage_unavailable() from None
    return user_out(user)


@router.delete("/me/photo", status_code=204, responses={**_AUTH, **limits.RATE_LIMITED})
def clear_my_photo(user: UserDep, db: DbDep, r: RedisDep, store: StoreDep) -> Response:
    """Remove the caller's person photo (also a 204 without one)."""
    limits.check(r, user.id, limits.WRITE)
    photos_service.clear_user_photo(db, store, user)
    return Response(status_code=204)
