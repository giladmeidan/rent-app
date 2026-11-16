"""Email one-time-code login and cookie sessions (spec 0001a; limits per network, spec 0013b).

Brute-force bound (NF2), per targeted email: a code allows `OTP_MAX_ATTEMPTS` (5) guesses, and at
most 20 codes per email (`OTP_RATE_LIMIT_EMAIL_ALL_DAY`) are issued per 24 h across all networks
(10 from any one network, `OTP_RATE_LIMIT_EMAIL_DAY`), so an attacker gets at most 100 guesses a day
against a 10**6 code space: 0.01 % a day, about 0.3 % over a month of continuous attack. The ceiling
is the one counter not scoped per network: 20 requests from two or more networks (one IPv6
connection holds many /64s) stop an email getting new codes for a day; its signed-in sessions are
unaffected. Attempts are reserved atomically in Redis before the comparison, so concurrent guesses
cannot exceed the bound, and a right code is claimed (compare-and-delete) before it is used, so one
code yields at most one session.

A network is `client_ip.client_network` (an IPv4 address or an IPv6 /64); an IPv6 network's /48 is
also counted, at `client_ip.PREFIX48_FACTOR` times the per-network limits.

OTP codes and rate-limit counters live in Redis with TTLs; only the HMAC of a code is stored, and
only the sha256 of a session token reaches Postgres.

Password login (spec 0016a): every attempt is counted before any hash check, per (email, network)
(10 per 15 min, 30 a day), per network (30 per 15 min, 300 a day) and per email across networks
(100 a day, `PW_RATE_LIMIT_EMAIL_ALL_DAY`): at most 100 guesses a day against one email. That
ceiling stops only password logins; the emailed code still works, so it never locks a person out.
Every failure answers the same and runs exactly one argon2 verify (against `DUMMY_HASH` when there
is no stored hash). Only argon2id hashes are stored (`services/passwords.py`).
"""

import datetime as dt
import hashlib
import hmac
import secrets
import uuid
from typing import Any

from sqlalchemy import exists, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app import client_ip
from app.config import get_settings
from app.i18n import he
from app.models import Session as SessionRow
from app.models import User, UserPassword
from app.redis_client import RedisClient
from app.schemas.auth import ProfileIn
from app.services import (
    accounts,  # a module import: accounts.py imports this module too
    passwords,
)
from app.services.email import EmailSender, EmailUnavailable
from app.services.rate_limit import count_or_raise

OTP_TTL_S = 600
OTP_MAX_ATTEMPTS = 5
OTP_RATE_LIMIT_EMAIL = 3
OTP_RATE_WINDOW_S = 900
OTP_RATE_LIMIT_EMAIL_DAY = 10
OTP_RATE_LIMIT_EMAIL_ALL_DAY = 20
OTP_RATE_DAY_S = 86_400
OTP_RATE_LIMIT_IP = 10
OTP_RATE_LIMIT_IP_DAY = 50
SESSION_TTL_S = 30 * 24 * 3600
PW_RATE_LIMIT_EMAIL = 10
PW_RATE_WINDOW_S = 900
PW_RATE_LIMIT_EMAIL_DAY = 30
PW_RATE_LIMIT_EMAIL_ALL_DAY = 100
PW_RATE_DAY_S = 86_400
PW_RATE_LIMIT_IP = 30
PW_RATE_LIMIT_IP_DAY = 300

# Reserve one attempt: nil when no code is pending (never creates a key, so never one without a
# TTL); otherwise {code_hmac, attempts after this one, PTTL}. A key past the limit is deleted.
_RESERVE_ATTEMPT = """
if redis.call('EXISTS', KEYS[1]) == 0 then return nil end
local n = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if n > tonumber(ARGV[1]) then redis.call('DEL', KEYS[1]) return nil end
return {redis.call('HGET', KEYS[1], 'code_hmac'), n, redis.call('PTTL', KEYS[1])}
"""
# Act on the code only while it is still the one that was reserved (ARGV[1] = its code_hmac), so a
# fresh code from a concurrent request is never touched. ARGV[2] = 'del' (claim a right code, or
# drop an exhausted one; returns 1 if this call deleted it) or 'refund' (give the attempt back).
_SETTLE_CODE = """
if redis.call('HGET', KEYS[1], 'code_hmac') ~= ARGV[1] then return 0 end
if ARGV[2] == 'refund' then
  redis.call('HINCRBY', KEYS[1], 'attempts', -1)
else
  redis.call('DEL', KEYS[1])
end
return 1
"""
# Put a claimed code back after the login failed in Postgres, unless a new code was requested.
_RESTORE_CODE = """
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'code_hmac', ARGV[1], 'attempts', ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
"""


class InvalidCodeError(Exception):
    """Wrong, expired, exhausted or never-requested code (deliberately one case)."""


class ProfileRequiredError(Exception):
    """Right code for an email with no account, and no profile to create one."""


class AccountSuspendedError(Exception):
    """Right code for a suspended account (spec 0012a): the code is consumed, nothing is written."""


class SignupBlockedError(Exception):
    """Right code for an email with no live account whose hash is in `blocked_emails` (spec
    0013c): the code is consumed, nothing is written."""


class InvalidCredentialsError(Exception):
    """Unknown email, no password, or a wrong password (deliberately one case, spec 0016a)."""


def normalise_email(email: str) -> str:
    return email.strip().lower()


def otp_key(email: str) -> str:
    return f"otp:{email}"


def _code_hmac(code: str) -> bytes:
    key = get_settings().secret_key.get_secret_value().encode()
    return hmac.new(key, code.encode(), hashlib.sha256).hexdigest().encode()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _count_request(r: RedisClient, email: str, network: str) -> None:
    """Count this request against every limit of `email` and `network` (and an IPv6 network's
    /48, first); raise `RateLimitedError` (counting nothing) if any is already at its limit
    (`services/rate_limit.py`)."""
    counters: list[tuple[str, int, int]] = []
    p = client_ip.network48(network)
    if p is not None:
        factor = client_ip.PREFIX48_FACTOR
        counters += [
            (f"rl:otp:ip48:{p}", factor * OTP_RATE_LIMIT_IP, OTP_RATE_WINDOW_S),
            (f"rl:otp:ip48:day:{p}", factor * OTP_RATE_LIMIT_IP_DAY, OTP_RATE_DAY_S),
        ]
    counters += [
        (f"rl:otp:email:{email}:net:{network}", OTP_RATE_LIMIT_EMAIL, OTP_RATE_WINDOW_S),
        (f"rl:otp:email:day:{email}:net:{network}", OTP_RATE_LIMIT_EMAIL_DAY, OTP_RATE_DAY_S),
        (f"rl:otp:email:all:day:{email}", OTP_RATE_LIMIT_EMAIL_ALL_DAY, OTP_RATE_DAY_S),
        (f"rl:otp:ip:{network}", OTP_RATE_LIMIT_IP, OTP_RATE_WINDOW_S),
        (f"rl:otp:ip:day:{network}", OTP_RATE_LIMIT_IP_DAY, OTP_RATE_DAY_S),
    ]
    count_or_raise(r, counters)


def _count_password(r: RedisClient, email: str, network: str) -> None:
    """`_count_request`'s shape for a password login (spec 0016a), keys under `rl:pw:`."""
    counters: list[tuple[str, int, int]] = []
    p = client_ip.network48(network)
    if p is not None:
        factor = client_ip.PREFIX48_FACTOR
        counters += [
            (f"rl:pw:ip48:{p}", factor * PW_RATE_LIMIT_IP, PW_RATE_WINDOW_S),
            (f"rl:pw:ip48:day:{p}", factor * PW_RATE_LIMIT_IP_DAY, PW_RATE_DAY_S),
        ]
    counters += [
        (f"rl:pw:email:{email}:net:{network}", PW_RATE_LIMIT_EMAIL, PW_RATE_WINDOW_S),
        (f"rl:pw:email:day:{email}:net:{network}", PW_RATE_LIMIT_EMAIL_DAY, PW_RATE_DAY_S),
        (f"rl:pw:email:all:day:{email}", PW_RATE_LIMIT_EMAIL_ALL_DAY, PW_RATE_DAY_S),
        (f"rl:pw:ip:{network}", PW_RATE_LIMIT_IP, PW_RATE_WINDOW_S),
        (f"rl:pw:ip:day:{network}", PW_RATE_LIMIT_IP_DAY, PW_RATE_DAY_S),
    ]
    count_or_raise(r, counters)


def request_otp(r: RedisClient, sender: EmailSender, email: str, network: str) -> None:
    """Issue a code for `email` and send it. Same outcome whether or not an account exists."""
    email = normalise_email(email)
    _count_request(r, email, network)
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


def _eval(r: RedisClient, script: str, keys: list[str], *args: bytes | int) -> Any:
    """Run a Lua script atomically."""
    return r.eval(script, len(keys), *keys, *args)  # type: ignore[no-untyped-call]  # untyped stub


def _find_user(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


def verify_otp(
    db: Session, r: RedisClient, email: str, code: str, profile: ProfileIn | None
) -> tuple[User, bool]:
    """Check the code and return `(user, created)`, creating the account from `profile` on first
    use, with `profile.password` when set (spec 0016a; ignored for an existing account). Raises
    `InvalidCodeError`, `ProfileRequiredError`, `AccountSuspendedError` or `SignupBlockedError`.
    Commits; the caller adds a session."""
    email = normalise_email(email)
    key = [otp_key(email)]
    reserved = _eval(r, _RESERVE_ATTEMPT, key, OTP_MAX_ATTEMPTS)
    if reserved is None:
        raise InvalidCodeError
    stored, attempts, ttl_ms = reserved
    if not hmac.compare_digest(stored, _code_hmac(code)):
        if int(attempts) >= OTP_MAX_ATTEMPTS:
            _eval(r, _SETTLE_CODE, key, stored, b"del")
        raise InvalidCodeError

    user = _find_user(db, email)
    # Before the refund below, so a blocked person learns at the first verify (spec 0013c).
    if user is None and accounts.email_blocked(db, email):
        # Claim the code outside the `try` below, so it stays consumed (0012a's suspended rule).
        _eval(r, _SETTLE_CODE, key, stored, b"del")
        raise SignupBlockedError
    if user is None and profile is None:
        _eval(r, _SETTLE_CODE, key, stored, b"refund")
        raise ProfileRequiredError
    # Claim the code: of concurrent verifies with the same right code, exactly one gets past here.
    if not _eval(r, _SETTLE_CODE, key, stored, b"del"):
        raise InvalidCodeError
    # After the claim and outside the `try` below, so a suspended account's code stays consumed.
    if user is not None and user.suspended_at is not None:
        raise AccountSuspendedError
    # Outside the `try` and before any write: no row lock or transaction waits on the hash.
    new_hash = (
        passwords.hash_password(profile.password)
        if user is None and profile is not None and profile.password is not None
        else None
    )
    try:
        created = False
        if user is None:
            assert profile is not None
            # ON CONFLICT: a concurrent first verify for the same email that inserted first wins,
            # and this request becomes a login of that row instead of a 500.
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
            elif new_hash is not None:
                db.add(UserPassword(user_id=user.id, hash=new_hash))
        user.last_login_at = dt.datetime.now(dt.UTC)
        db.commit()
    except Exception:
        db.rollback()
        if int(ttl_ms) > 0:  # the code stays usable after a database failure
            _eval(r, _RESTORE_CODE, key, stored, int(attempts), int(ttl_ms))
        raise
    return user, created


def password_login(db: Session, r: RedisClient, email: str, password: str, network: str) -> User:
    """Log in with email and password (spec 0016a). Raises `RateLimitedError` (nothing checked),
    `InvalidCredentialsError` or, for the right password only, `AccountSuspendedError` (nothing
    written). Commits `last_login_at` (and an upgraded hash); the caller adds a session."""
    email = normalise_email(email)
    _count_password(r, email, network)
    row = db.execute(
        select(User, UserPassword.hash)
        .outerjoin(UserPassword, UserPassword.user_id == User.id)
        .where(User.email == email)
    ).one_or_none()
    if row is None or row.hash is None:
        passwords.verify_password(passwords.DUMMY_HASH, password)  # the same cost as a real one
        raise InvalidCredentialsError
    user, stored = row.tuple()
    if not passwords.verify_password(stored, password):
        raise InvalidCredentialsError
    if user.suspended_at is not None:
        raise AccountSuspendedError
    user.last_login_at = dt.datetime.now(dt.UTC)
    if passwords.needs_rehash(stored):
        db.execute(
            update(UserPassword)
            .where(UserPassword.user_id == user.id)
            .values(hash=passwords.hash_password(password))
        )
    db.commit()
    return user


def set_password(db: Session, user: User, raw: str, keep_token: str) -> None:
    """Set or replace `user`'s password and revoke every other live session of theirs (spec
    0016a), in one commit. A racing `DELETE /me` that committed first: `AccountDeletedError`."""
    new_hash = passwords.hash_password(raw)  # before the lock: nothing waits on the hash
    accounts.lock_live_account(db, user.id)
    db.execute(
        insert(UserPassword)
        .values(user_id=user.id, hash=new_hash)
        .on_conflict_do_update(index_elements=[UserPassword.user_id], set_={"hash": new_hash})
    )
    db.execute(
        update(SessionRow)
        .where(
            SessionRow.user_id == user.id,
            SessionRow.revoked_at.is_(None),
            SessionRow.token_hash != _token_hash(keep_token),
        )
        .values(revoked_at=dt.datetime.now(dt.UTC))
    )
    db.commit()


def has_password(db: Session, user_id: uuid.UUID) -> bool:
    return bool(db.scalar(select(exists().where(UserPassword.user_id == user_id))))


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
    """The user of a live session (not revoked, not expired, user not suspended or deleted), in one
    query."""
    return db.scalar(
        select(User)
        .join(SessionRow, SessionRow.user_id == User.id)
        .where(
            SessionRow.token_hash == _token_hash(token),
            SessionRow.revoked_at.is_(None),
            SessionRow.expires_at > func.now(),
            User.suspended_at.is_(None),
            # A login racing DELETE /me can add a session after its step 11 (spec 0013c AC14).
            User.deleted_at.is_(None),
        )
    )


def session_created_at(db: Session, token: str) -> dt.datetime | None:
    """When the live session of `token` was created (DELETE /me's recent sign-in), else None."""
    return db.scalar(
        select(SessionRow.created_at).where(
            SessionRow.token_hash == _token_hash(token),
            SessionRow.revoked_at.is_(None),
            SessionRow.expires_at > func.now(),
        )
    )
