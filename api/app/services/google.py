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
# After a failed fetch: no new attempt for this long, so an outage costs one 5 s fetch per 30 s.
CERTS_RETRY_S = 30
# A failed refresh keeps serving the expired keys this long past their expiry.
CERTS_STALE_S = 3600
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


# {kid: PEM certificate}, the monotonic time it expires, and when a failed fetch may be retried;
# all under `_lock`.
_certs: dict[str, str] = {}
_certs_expire_at = 0.0
_retry_at = 0.0
_lock = threading.Lock()


def _reset_cache() -> None:
    """Forget the cached keys and any failed fetch (tests)."""
    global _certs, _certs_expire_at, _retry_at
    with _lock:
        _certs, _certs_expire_at, _retry_at = {}, 0.0, 0.0


def _max_age(cache_control: str | None) -> int:
    match = _MAX_AGE.search(cache_control or "")
    return int(match.group(1)) if match else CERTS_DEFAULT_MAX_AGE_S


def _fetch_certs() -> tuple[dict[str, str], int] | None:
    """Google's `{kid: PEM cert}` and its `max-age`, or None on any failure."""
    try:
        response = httpx.get(CERTS_URL, timeout=CERTS_TIMEOUT_S)
        body = response.json() if response.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        return None
    if (
        not isinstance(body, dict)
        or not body
        or not all(isinstance(k, str) and isinstance(v, str) for k, v in body.items())
    ):
        return None
    return body, _max_age(response.headers.get("cache-control"))


def _google_certs() -> dict[str, str]:
    """Google's signing certificates, cached for the response's `max-age`. One thread refetches
    while the others wait. A failed fetch is not retried for `CERTS_RETRY_S`; meanwhile expired
    keys are served for up to `CERTS_STALE_S` past expiry, else `GoogleUnavailable`."""
    # shortcut: no refetch on an unknown kid; Google publishes a new key well before signing with
    # it, so the max-age refresh is enough — upgrade if 401s show up after a rotation
    global _certs, _certs_expire_at, _retry_at
    with _lock:
        now = time.monotonic()
        if _certs and now < _certs_expire_at:
            return _certs
        stale = _certs if _certs and now < _certs_expire_at + CERTS_STALE_S else None
        fetched = _fetch_certs() if now >= _retry_at else None
        if fetched is None:
            if now >= _retry_at:  # this call fetched and failed
                _retry_at = time.monotonic() + CERTS_RETRY_S
            if stale is not None:
                return stale
            raise GoogleUnavailable
        _certs, max_age = fetched
        _certs_expire_at = time.monotonic() + max_age
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
        # Google always names its key: without a `kid`, google-auth would try every cert.
        if not isinstance(jwt.decode_header(credential).get("kid"), str):  # type: ignore[no-untyped-call]
            raise InvalidGoogleToken
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
