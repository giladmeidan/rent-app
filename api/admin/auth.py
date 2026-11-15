"""The admin's password login (spec 0012b): one password, a `homie_admin` session cookie scoped to
`/admin` with `SameSite=Strict`, an absolute 8-hour session age and a lock after 5 wrong tries."""

import hmac
import time

from sqladmin.authentication import AuthenticationBackend
from starlette.requests import Request

from admin.config import AdminSettings

SESSION_MAX_AGE_S = 8 * 60 * 60
LOCK_AFTER = 5
LOCK_WINDOW_S = 15 * 60


def _now() -> float:
    return time.time()


class PasswordAuth(AuthenticationBackend):
    def __init__(self, settings: AdminSettings) -> None:
        super().__init__(
            secret_key=settings.secret_key.get_secret_value(),
            session_cookie="homie_admin",
            path="/admin",
            same_site="strict",
            https_only=settings.https_only,
            # Starlette's max_age slides on every response; `login_at` is the absolute limit.
            max_age=SESSION_MAX_AGE_S,
        )
        self._password = settings.password.get_secret_value().encode()
        # shortcut: the wrong-password count is in-process, so a restart resets it; fine for one
        # localhost admin, revisit with the Slice 13 deploy.
        self._failures: list[float] = []
        self._locked_until = 0.0

    async def login(self, request: Request) -> bool:
        now = _now()
        if now < self._locked_until:
            return False  # even the right password: a lock is never lifted early
        password = (await request.form()).get("password")
        # Bytes, not str: compare_digest raises on non-ASCII str.
        if isinstance(password, str) and hmac.compare_digest(password.encode(), self._password):
            self._failures.clear()
            request.session.clear()
            request.session["login_at"] = now
            return True
        self._failures = [t for t in self._failures if now - t < LOCK_WINDOW_S] + [now]
        if len(self._failures) >= LOCK_AFTER:
            self._locked_until = now + LOCK_WINDOW_S
            self._failures.clear()
        return False

    async def logout(self, request: Request) -> bool:
        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool:
        login_at = request.session.get("login_at")
        if isinstance(login_at, int | float) and 0 <= _now() - login_at < SESSION_MAX_AGE_S:
            return True
        request.session.clear()
        return False
