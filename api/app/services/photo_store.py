"""Photo object storage (spec 0010d): `FilePhotoStore` in dev, CI and e2e (served by the api at
`/media`), `R2PhotoStore` (Cloudflare R2 over the S3 API) in production.

An object name is always `{key}-s.webp` or `{key}-l.webp` with a random `key`
(`services/photos.py`); a store never builds a name itself. Neither store ever logs a name, a key or
a credential: a failure logs the error type (and S3's error code) only and raises
`PhotoStoreUnavailable`."""

import logging
import os
from collections.abc import Sequence
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.config import get_settings

if TYPE_CHECKING:
    from mypy_boto3_s3.client import S3Client

log = logging.getLogger(__name__)

# A key is never reused, so an object never changes: caches may keep it for a year.
CACHE_CONTROL = "public, max-age=31536000, immutable"
CONTENT_TYPE = "image/webp"


class PhotoStoreUnavailable(Exception):  # noqa: N818  (name fixed by spec 0010d)
    """The photo store could not write or delete an object."""


class PhotoStore(Protocol):
    def put(self, name: str, data: bytes) -> None: ...

    def delete(self, names: Sequence[str]) -> None: ...


class FilePhotoStore:
    """Each object is the file `photo_dir / name`, written through a temp file and `os.replace`, so
    a reader (the `/media` mount) never sees half a file."""

    def __init__(self, photo_dir: Path) -> None:
        self.photo_dir = photo_dir

    def put(self, name: str, data: bytes) -> None:
        try:
            self.photo_dir.mkdir(parents=True, exist_ok=True)
            tmp = self.photo_dir / f".{name}.tmp"
            tmp.write_bytes(data)
            os.replace(tmp, self.photo_dir / name)
        except OSError as exc:
            log.error("photo file write failed: %s", type(exc).__name__)
            raise PhotoStoreUnavailable from exc

    def delete(self, names: Sequence[str]) -> None:
        try:
            for name in names:
                (self.photo_dir / name).unlink(missing_ok=True)
        except OSError as exc:
            log.error("photo file delete failed: %s", type(exc).__name__)
            raise PhotoStoreUnavailable from exc


@lru_cache(maxsize=4)
def _r2_client(account_id: str, access_key_id: str, secret_access_key: str) -> "S3Client":
    """One S3 client per process (and per credentials): botocore clients are thread-safe and build
    their endpoint and connection pool once."""
    config = Config(
        connect_timeout=5,
        read_timeout=10,
        retries={"max_attempts": 2},
        # boto3 >= 1.36 sends CRC checksums by default; R2 wants them only where S3 requires them.
        request_checksum_calculation="when_required",
        response_checksum_validation="when_required",
    )
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        region_name="auto",
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        config=config,
    )


def _s3_error_code(exc: BotoCoreError | ClientError) -> str | None:
    if isinstance(exc, ClientError):
        return exc.response.get("Error", {}).get("Code")
    return None


class R2PhotoStore:
    """The objects in one R2 bucket, written with a WebP content type and a one-year immutable
    `Cache-Control`."""

    def __init__(
        self, account_id: str, access_key_id: str, secret_access_key: str, bucket: str
    ) -> None:
        self.client = _r2_client(account_id, access_key_id, secret_access_key)
        self.bucket = bucket

    def put(self, name: str, data: bytes) -> None:
        try:
            self.client.put_object(
                Bucket=self.bucket,
                Key=name,
                Body=data,
                ContentType=CONTENT_TYPE,
                CacheControl=CACHE_CONTROL,
            )
        except (BotoCoreError, ClientError) as exc:
            log.error("r2 put failed: %s (code %s)", type(exc).__name__, _s3_error_code(exc))
            raise PhotoStoreUnavailable from exc

    def delete(self, names: Sequence[str]) -> None:
        if not names:
            return
        try:
            self.client.delete_objects(
                Bucket=self.bucket,
                Delete={"Objects": [{"Key": name} for name in names], "Quiet": True},
            )
        except (BotoCoreError, ClientError) as exc:
            log.error("r2 delete failed: %s (code %s)", type(exc).__name__, _s3_error_code(exc))
            raise PhotoStoreUnavailable from exc


def get_photo_store() -> PhotoStore:
    """FastAPI dependency: the store `PHOTO_BACKEND` selects."""
    settings = get_settings()
    if settings.photo_backend == "r2":
        # Settings rejects r2 without all four values.
        assert settings.r2_account_id is not None
        assert settings.r2_access_key_id is not None
        assert settings.r2_secret_access_key is not None
        assert settings.r2_bucket is not None
        return R2PhotoStore(
            settings.r2_account_id,
            settings.r2_access_key_id.get_secret_value(),
            settings.r2_secret_access_key.get_secret_value(),
            settings.r2_bucket,
        )
    return FilePhotoStore(settings.photo_dir)
