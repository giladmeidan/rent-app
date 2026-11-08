"""Email one-time-code login and cookie sessions (spec 0001a).

Brute-force bound (NF2), per targeted email: a code allows `OTP_MAX_ATTEMPTS` (5) guesses, and at
most `OTP_RATE_LIMIT_EMAIL` (3) codes per 15 min and `OTP_RATE_LIMIT_EMAIL_DAY` (10) codes per 24 h
are issued, so an attacker gets at most 50 guesses a day against a 10**6 code space: about 0.005 %
a day, about 0.15 % over a month of continuous attack. Attempts are reserved atomically in Redis
before the comparison, so concurrent guesses cannot exceed the bound.

OTP codes and rate-limit counters live in Redis with TTLs; only the HMAC of a code is stored, and
only the sha256 of a session token reaches Postgres.
"""

import datetime as dt
import hashlib
import hmac
import secrets
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.i18n import he
from app.models import Session as SessionRow
from app.models import User
from app.redis_client import RedisClient
from app.schemas.auth import ProfileIn
from app.services.email import EmailSender, EmailUnavailable

OTP_TTL_S = 600
OTP_MAX_ATTEMPTS = 5
OTP_RATE_LIMIT_EMAIL = 3
OTP_RATE_WINDOW_S = 900
OTP_RATE_LIMIT_EMAIL_DAY = 10
OTP_RATE_DAY_S = 86_400
OTP_RATE_LIMIT_IP = 10
SESSION_TTL_S = 30 * 24 * 3600

# Reserve one attempt: nil when no code is pending (never creates a key, so never one without a
# TTL); otherwise {code_hmac, attempts after this one}. A key already past the limit is deleted.
_RESERVE_ATTEMPT = """
if redis.call('EXISTS', KEYS[1]) == 0 then return nil end
local n = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if n > tonumber(ARGV[1]) then redis.call('DEL', KEYS[1]) return nil end
return {redis.call('HGET', KEYS[1], 'code_hmac'), n}
"""
# Give back a reserved attempt (right code, but no account and no profile yet).
_REFUND_ATTEMPT = """
if redis.call('EXISTS', KEYS[1]) == 1 then redis.call('HINCRBY', KEYS[1], 'attempts', -1) end
"""


class RateLimitedError(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__("rate_limited")
        self.retry_after = retry_after


class InvalidCodeError(Exception):
    """Wrong, expired, exhausted or never-requested code (deliberately one case)."""


class ProfileRequiredError(Exception):
    """Right code for an email with no account, and no profile to create one."""


def normalise_email(email: str) -> str:
    return email.strip().lower()


def otp_key(email: str) -> str:
    return f"otp:{email}"


def _code_hmac(code: str) -> bytes:
    key = get_settings().secret_key.get_secret_value().encode()
    return hmac.new(key, code.encode(), hashlib.sha256).hexdigest().encode()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _count_request(r: RedisClient, email: str, ip: str) -> None:
    """Count this request against all three limits; raise `RateLimitedError` if any is exceeded."""
    counters = (
        (f"rl:otp:email:{email}", OTP_RATE_LIMIT_EMAIL, OTP_RATE_WINDOW_S),
        (f"rl:otp:email:day:{email}", OTP_RATE_LIMIT_EMAIL_DAY, OTP_RATE_DAY_S),
        (f"rl:otp:ip:{ip}", OTP_RATE_LIMIT_IP, OTP_RATE_WINDOW_S),
    )
    pipe = r.pipeline(transaction=True)
    for key, _limit, window in counters:
        # SET NX EX and INCR in one MULTI: a counter can never exist without its TTL.
        pipe.set(key, 0, ex=window, nx=True)
        pipe.incr(key)
        pipe.ttl(key)
    results: list[Any] = pipe.execute()
    tripped = [
        max(int(results[i * 3 + 2]), 1)
        for i, (_key, limit, _window) in enumerate(counters)
        if int(results[i * 3 + 1]) > limit
    ]
    if tripped:
        raise RateLimitedError(retry_after=max(tripped))


def request_otp(r: RedisClient, sender: EmailSender, email: str, ip: str) -> None:
    """Issue a code for `email` and send it. Same outcome whether or not an account exists."""
    email = normalise_email(email)
    _count_request(r, email, ip)
    code = f"{secrets.randbelow(10**6):06d}"
    key = otp_key(email)
    pipe = r.pipeline(transaction=True)
    pipe.delete(key)
    pipe.hset(key, mapping={"code_hmac": _code_hmac(code), "attempts": 0})
    pipe.expire(key, OTP_TTL_S)
    pipe.execute()
    try:
        sender.send(email, he.EMAIL_OTP_SUBJECT, he.EMAIL_OTP_BODY.format(code=code))
    except EmailUnavailable:
        r.delete(key)  # a code nobody received must not linger
        raise


def _eval(r: RedisClient, script: str, key: str, *args: int) -> Any:
    """Run a one-key Lua script atomically."""
    return r.eval(script, 1, key, *args)  # type: ignore[no-untyped-call]  # untyped in types-redis


def _find_user(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


def verify_otp(
    db: Session, r: RedisClient, email: str, code: str, profile: ProfileIn | None
) -> tuple[User, bool]:
    """Check the code and return `(user, created)`, creating the account from `profile` on first
    use. Raises `InvalidCodeError` or `ProfileRequiredError`. Commits; the caller adds a session."""
    email = normalise_email(email)
    key = otp_key(email)
    reserved = _eval(r, _RESERVE_ATTEMPT, key, OTP_MAX_ATTEMPTS)
    if reserved is None:
        raise InvalidCodeError
    stored, attempts = reserved
    if not hmac.compare_digest(stored, _code_hmac(code)):
        if int(attempts) >= OTP_MAX_ATTEMPTS:
            r.delete(key)
        raise InvalidCodeError

    user = _find_user(db, email)
    created = False
    if user is None:
        if profile is None:
            _eval(r, _REFUND_ATTEMPT, key)
            raise ProfileRequiredError
        # ON CONFLICT: a concurrent first verify for the same email that inserted first wins, and
        # this request becomes a login of that row instead of a 500.
        user = db.scalar(
            insert(User)
            .values(email=email, display_name=profile.display_name, role=profile.role)
            .on_conflict_do_nothing(index_elements=[User.email])
            .returning(User)
        )
        created = user is not None
        if user is None:
            user = _find_user(db, email)
            assert user is not None  # the conflicting row exists once our INSERT returns
    user.last_login_at = dt.datetime.now(dt.UTC)
    db.commit()
    r.delete(key)
    return user, created


def create_session(db: Session, user: User) -> str:
    """Store a new session for `user` and return the raw cookie token (only its hash is stored)."""
    token = secrets.token_urlsafe(32)
    now = dt.datetime.now(dt.UTC)
    db.add(
        SessionRow(
            user_id=user.id,
            token_hash=_token_hash(token),
            created_at=now,
            expires_at=now + dt.timedelta(seconds=SESSION_TTL_S),
        )
    )
    db.commit()
    return token


def revoke_session(db: Session, token: str) -> None:
    db.execute(
        update(SessionRow)
        .where(SessionRow.token_hash == _token_hash(token), SessionRow.revoked_at.is_(None))
        .values(revoked_at=dt.datetime.now(dt.UTC))
    )
    db.commit()


def resolve_session(db: Session, token: str) -> User | None:
    """The user of a live session (not revoked, not expired), in one query."""
    return db.scalar(
        select(User)
        .join(SessionRow, SessionRow.user_id == User.id)
        .where(
            SessionRow.token_hash == _token_hash(token),
            SessionRow.revoked_at.is_(None),
            SessionRow.expires_at > func.now(),
        )
    )
