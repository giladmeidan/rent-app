"""The admin ASGI app (spec 0012b): `uvicorn admin.main:main --factory`.

No module-level app, so importing this without `ADMIN_*` env works (CI's `make test`). Outermost
first: a Host allowlist (DNS rebinding), a `Sec-Fetch-Site` check (another site, or another
localhost port, which is the same site), then SQLAdmin at `/admin` behind its password login."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from sqladmin import Admin
from starlette.applications import Starlette
from starlette.datastructures import Headers
from starlette.middleware import Middleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import Request
from starlette.responses import PlainTextResponse, RedirectResponse, Response
from starlette.routing import Route
from starlette.types import ASGIApp, Receive, Scope, Send

from admin.auth import PasswordAuth
from admin.config import AdminSettings
from admin.views import VIEWS
from app.db import make_engine

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
LANDING = "/admin/report/list"
# Set by the browser itself, so a page cannot forge it; a request without it (curl) passes.
REFUSED_FETCH_SITES = frozenset({"cross-site", "same-site"})


class FetchSiteGuard:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and Headers(scope=scope).get("sec-fetch-site") in (
            REFUSED_FETCH_SITES
        ):
            response = PlainTextResponse("Cross-site request refused", status_code=400)
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


class HomieAdmin(Admin):
    async def index(self, request: Request) -> Response:
        return RedirectResponse(LANDING, status_code=302)


async def _landing(request: Request) -> Response:
    return RedirectResponse(LANDING, status_code=302)


def create_admin_app(settings: AdminSettings) -> Starlette:
    engine = make_engine(settings.database_url.get_secret_value())

    @asynccontextmanager
    async def lifespan(app: Starlette) -> AsyncIterator[None]:
        yield
        engine.dispose()

    app = Starlette(
        routes=[Route("/", _landing)],
        middleware=[
            Middleware(TrustedHostMiddleware, allowed_hosts=settings.hosts),
            Middleware(FetchSiteGuard),
        ],
        lifespan=lifespan,
    )
    admin = HomieAdmin(
        app,
        engine=engine,
        title="homie admin",
        templates_dir=str(TEMPLATES_DIR),
        authentication_backend=PasswordAuth(settings),
    )
    for view in VIEWS:
        admin.add_view(view)
    return app


def main() -> Starlette:
    return create_admin_app(AdminSettings())
