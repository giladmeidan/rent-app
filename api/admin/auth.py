"""The admin's password login (spec 0012b): one password, a `homie_admin` session cookie scoped to
`/admin` with `SameSite=Strict`, an absolute 8-hour session age and a lock after 5 wrong tries.

Since spec 0013e both live in Postgres (`admin_logins`, one row per attempt): the cookie holds only
a random session id whose sha256 is the row's `token_hash`, so a logout ends the session for every
copy of the cookie, and the lock holds across restarts and admin machines. Each method's database
work is one transaction in a worker thread. Nothing lifts a lock early (`homie_admin` cannot
DELETE); the owner role can: `DELETE FROM admin_logins WHERE locks_until > now()`."""

import datetime as dt
import hashlib
import hmac
import secrets
import time

from sqladmin.authentication import AuthenticationBackend
from sqlalchemy import Engine, func, insert, or_, select, text, update
from sqlalchemy.engine import Connection
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request

from admin.config import AdminSettings
from app.models import AdminLogin

SESSION_MAX_AGE_S = 8 * 60 * 60
LOCK_AFTER = 5
LOCK_WINDOW_S = 15 * 60


def _now() -> float:
    return time.time()


def _at() -> dt.datetime:
    return dt.datetime.fromtimestamp(_now(), dt.UTC)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class PasswordAuth(AuthenticationBackend):
    def __init__(self, settings: AdminSettings, engine: Engine) -> None:
        super().__init__(
            secret_key=settings.secret_key.get_secret_value(),
            session_cookie="homie_admin",
            path="/admin",
            same_site="strict",
            https_only=settings.https_only,
            # Starlette re-issues the cookie (and its max_age) whenever the session is modified, so
            # it is not an absolute limit; the row's `at` is.
            max_age=SESSION_MAX_AGE_S,
        )
        self._password = settings.password.get_secret_value().encode()
        self._engine = engine

    def _attempt(self, right: bool) -> str | None:
        """Record one attempt; the new session token on success, else None."""
        with self._engine.begin() as conn:
            # Concurrent logins, on any admin machine, run one at a time.
            conn.execute(text("SELECT pg_advisory_xact_lock(hashtext('homie_admin_login'))"))
            now = _at()
            locks_until = conn.scalar(select(func.max(AdminLogin.locks_until)))
            if locks_until is not None and locks_until > now:
                return None  # even the right password: a lock is never lifted early
            if right:
                token = secrets.token_urlsafe(32)
                conn.execute(insert(AdminLogin).values(at=now, ok=True, token_hash=_hash(token)))
                return token
            failures = self._failures_since_reset(conn, now)
            lock = now + dt.timedelta(seconds=LOCK_WINDOW_S) if failures + 1 >= LOCK_AFTER else None
            conn.execute(insert(AdminLogin).values(at=now, ok=False, locks_until=lock))
            return None

    @staticmethod
    def _failures_since_reset(conn: Connection, now: dt.datetime) -> int:
        """Failures within the window, after the latest success or lock (each resets the count)."""
        reset = conn.scalar(
            select(func.max(AdminLogin.at)).where(
                or_(AdminLogin.ok, AdminLogin.locks_until.is_not(None))
            )
        )
        window = [~AdminLogin.ok, AdminLogin.at > now - dt.timedelta(seconds=LOCK_WINDOW_S)]
        if reset is not None:
            window.append(AdminLogin.at > reset)
        count = conn.scalar(select(func.count()).select_from(AdminLogin).where(*window))
        return int(count or 0)

    def _live(self, sid: str) -> bool:
        now = _at()
        with self._engine.begin() as conn:
            row = conn.scalar(
                select(AdminLogin.id).where(
                    AdminLogin.token_hash == _hash(sid),
                    AdminLogin.ok,
                    AdminLogin.ended_at.is_(None),
                    AdminLogin.at > now - dt.timedelta(seconds=SESSION_MAX_AGE_S),
                    AdminLogin.at <= now,
                )
            )
        return row is not None

    def _end(self, sid: str) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                update(AdminLogin)
                .where(AdminLogin.token_hash == _hash(sid), AdminLogin.ended_at.is_(None))
                .values(ended_at=_at())
            )

    async def login(self, request: Request) -> bool:
        password = (await request.form()).get("password")
        # Bytes, not str: compare_digest raises on non-ASCII str.
        right = isinstance(password, str) and hmac.compare_digest(password.encode(), self._password)
        token = await run_in_threadpool(self._attempt, right)
        if token is None:
            return False
        request.session.clear()
        request.session["sid"] = token
        return True

    async def logout(self, request: Request) -> bool:
        # SQLAdmin's logout route has no login check, so it is reached with no session too.
        sid = request.session.get("sid")
        if isinstance(sid, str):
            await run_in_threadpool(self._end, sid)
        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool:
        sid = request.session.get("sid")
        if isinstance(sid, str) and await run_in_threadpool(self._live, sid):
            return True
        request.session.clear()
        return False
