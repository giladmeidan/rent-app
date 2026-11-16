"""Google sign-in ID tokens (spec 0016b). The only module that reads a Google credential.

`verify_credential` checks the credential the web got from Google Identity Services, by
`settings.google_verifier`: `off` refuses (503), `fake` accepts `fake:<sub>:<email>` (dev, tests,
e2e; refused by the settings on an https origin), `google` verifies a real ID token against
Google's published keys. Nothing here logs or returns any part of a credential: the library's error
messages can quote token parts, so every failure is raised as a bare `InvalidGoogleToken`.

Not `google.oauth2.id_token.verify_oauth2_token`: it re-fetches the keys on every call with no
timeout. `jwt.decode` plus the `iss` check below is what it does after its fetch."""

import re
import threading
import time
from dataclasses import dataclass

import httpx
from google.auth import exceptions as google_exceptions
from google.auth import jwt
from pydantic import EmailStr, TypeAdapter, ValidationError

from app.config import get_settings

CERTS_URL = "https://www.googleapis.com/oauth2/v1/certs"
CERTS_TIMEOUT_S = 5.0
CERTS_DEFAULT_MAX_AGE_S = 3600
CLOCK_SKEW_S = 10
ISSUERS = frozenset({"accounts.google.com", "https://accounts.google.com"})

_FAKE_SUB = re.compile(r"[A-Za-z0-9_-]{1,64}")
_MAX_AGE = re.compile(r"(?:^|,)\s*max-age\s*=\s*(\d+)", re.IGNORECASE)
_EMAIL = TypeAdapter(EmailStr)


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str


class InvalidGoogleToken(Exception):  # noqa: N818  (name fixed by spec 0016b)
    """Malformed, forged, expired or otherwise unacceptable credential (one case: 401)."""


class GoogleUnavailable(Exception):  # noqa: N818  (name fixed by spec 0016b)
    """Google sign-in is off, or Google's keys cannot be fetched (503)."""


# {kid: PEM certificate} and the monotonic time it expires; refreshed under `_lock`.
_certs: dict[str, str] = {}
_certs_expire_at = 0.0
_lock = threading.Lock()


def _reset_cache() -> None:
    """Forget the cached keys (tests)."""
    global _certs, _certs_expire_at
    with _lock:
        _certs, _certs_expire_at = {}, 0.0


def _max_age(cache_control: str | None) -> int:
    match = _MAX_AGE.search(cache_control or "")
    return int(match.group(1)) if match else CERTS_DEFAULT_MAX_AGE_S


def _google_certs() -> dict[str, str]:
    """Google's signing certificates, cached for the response's `max-age`. One thread refetches
    while the others wait. Any fetch failure: `GoogleUnavailable`, nothing cached."""
    # shortcut: no refetch on an unknown kid; Google publishes a new key well before signing with
    # it, so the max-age refresh is enough — upgrade if 401s show up after a rotation
    global _certs, _certs_expire_at
    with _lock:
        if _certs and time.monotonic() < _certs_expire_at:
            return _certs
        try:
            response = httpx.get(CERTS_URL, timeout=CERTS_TIMEOUT_S)
            body = response.json() if response.status_code == 200 else None
        except (httpx.HTTPError, ValueError):
            raise GoogleUnavailable from None
        if (
            not isinstance(body, dict)
            or not body
            or not all(isinstance(k, str) and isinstance(v, str) for k, v in body.items())
        ):
            raise GoogleUnavailable
        _certs = body
        _certs_expire_at = time.monotonic() + _max_age(response.headers.get("cache-control"))
        return _certs


def _fake(credential: str) -> GoogleIdentity:
    prefix, _, rest = credential.partition(":")
    sub, _, email = rest.partition(":")
    if prefix != "fake" or not _FAKE_SUB.fullmatch(sub):
        raise InvalidGoogleToken
    try:
        _EMAIL.validate_python(email)
    except ValidationError:
        raise InvalidGoogleToken from None
    return GoogleIdentity(sub=sub, email=email)


def _google(credential: str, client_id: str) -> GoogleIdentity:
    certs = _google_certs()  # before the try: a fetch failure is a 503, not a 401
    try:
        claims = jwt.decode(  # type: ignore[no-untyped-call]  # google-auth is unannotated
            credential, certs=certs, audience=client_id, clock_skew_in_seconds=CLOCK_SKEW_S
        )
    except (ValueError, TypeError, google_exceptions.GoogleAuthError):
        raise InvalidGoogleToken from None
    iss, sub, email = claims.get("iss"), claims.get("sub"), claims.get("email")
    if (
        not isinstance(iss, str)
        or iss not in ISSUERS
        or claims.get("email_verified") is not True
        or not isinstance(sub, str)
        or not sub
        or not isinstance(email, str)
        or not email
    ):
        raise InvalidGoogleToken
    return GoogleIdentity(sub=sub, email=email)


def verify_credential(credential: str) -> GoogleIdentity:
    """The Google account a credential vouches for (its email verified by Google). Raises
    `InvalidGoogleToken` or `GoogleUnavailable`."""
    settings = get_settings()
    if settings.google_verifier == "fake":
        return _fake(credential)
    if settings.google_verifier == "google":
        return _google(credential, settings.google_client_id)
    raise GoogleUnavailable
