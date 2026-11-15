"""The admin's views (spec 0012b). Read-only except UserView's `listing_cap`; every write goes
through `admin/actions.py`. User-written text is rendered through Jinja autoescape only."""

import uuid
from collections.abc import Callable, Sequence
from typing import Any, TypeVar, cast, get_args

from markupsafe import Markup
from sqladmin import Flash, ModelView, action, expose
from sqladmin.filters import StaticValuesFilter
from sqladmin.flash import FlashLevel
from sqlalchemy import Select, select
from sqlalchemy.orm import InstrumentedAttribute, Session, object_session, sessionmaker
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response
from wtforms.validators import InputRequired, NumberRange  # type: ignore[import-untyped]

from admin import actions
from app.models import AdminAction, Listing, Report, User
from app.schemas.report import ReportReason, ReportTargetType

T = TypeVar("T")


class NullFilter:
    """Filter on whether a nullable timestamp is set (open/resolved, suspended, removed)."""

    has_operator = False
    template = "sqladmin/filters/lookup_filter.html"
    default_value: Any = None

    def __init__(
        self, column: InstrumentedAttribute[Any], title: str, is_set: str, is_null: str
    ) -> None:
        self.column = column
        self.title = title
        self.parameter_name = column.key
        self._labels = [("set", is_set), ("null", is_null)]

    async def lookups(
        self, request: Request, model: Any, run_query: Callable[[Select[Any]], Any]
    ) -> list[tuple[str, str]]:
        return [("__all", "All"), *self._labels]

    async def get_filtered_query(self, query: Select[Any], value: Any, model: Any) -> Select[Any]:
        if value == "set":
            return query.where(self.column.is_not(None))
        if value == "null":
            return query.where(self.column.is_(None))
        return query


def _person(user: User | None) -> str:
    if user is None:
        return ""
    if user.deleted_at is not None:  # a scrubbed tombstone (spec 0013c)
        return f"deleted account ({user.id})"
    return f"{user.display_name} <{user.email}>"


def _values(literal: Any) -> list[tuple[str, str]]:
    return [(value, value) for value in get_args(literal)]


def _pks(request: Request) -> list[uuid.UUID]:
    try:
        return [uuid.UUID(pk) for pk in request.query_params.get("pks", "").split(",") if pk]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid pks") from None


def _flash(request: Request, message: str, level: FlashLevel) -> None:
    Flash.flash(request, message, level)
    # Starlette 1.x saves the session only after a top-level write; SQLAdmin appends in place.
    request.session["_messages"] = request.session["_messages"]


class _ReadOnly(ModelView):
    can_create = False
    can_edit = False
    can_delete = False
    can_export = False
    can_import = False

    async def _run(
        self, fn: Callable[[Session, Sequence[uuid.UUID]], T], ids: Sequence[uuid.UUID]
    ) -> T:
        def call() -> T:
            with cast(sessionmaker[Session], self.session_maker)() as session:
                return fn(session, ids)

        return await run_in_threadpool(call)

    def _back(self, request: Request, message: str) -> Response:
        _flash(request, message, FlashLevel.success)
        return RedirectResponse(request.url_for("admin:list", identity=self.identity), 302)


def _target_link(report: Report, _attr: Any, request: Request) -> Markup | str:
    if report.target_type == "listing":
        url = request.url_for("admin:details", identity="listing", pk=str(report.target_id))
        return Markup('<a href="{}">{}</a>').format(url, report.target_id)
    if report.target_type == "chat":
        url = request.url_for("admin:view-report-chat", report_id=str(report.id))
        return Markup('{} <a href="{}">Open reported chat</a>').format(report.target_id, url)
    return str(report.target_id)


class ReportView(_ReadOnly, model=Report):
    name = "Report"
    name_plural = "Reports"
    icon = "fa-solid fa-flag"
    column_list = [
        Report.created_at,
        Report.resolved_at,
        Report.target_type,
        Report.reason,
        Report.note,
        "reporter",
        "reported_user",
        Report.target_id,
    ]
    column_labels = {Report.resolved_at: "state"}
    column_formatters = {
        Report.resolved_at: lambda m, a: "open" if m.resolved_at is None else "resolved",
        Report.note: lambda m, a: (m.note or "")[:80],
        "reporter": lambda m, a: _person(m.reporter),
        "reported_user": lambda m, a: _person(m.reported_user),
    }
    column_formatters_detail = {
        Report.target_id: _target_link,
        "reporter": lambda m, a: _person(m.reporter),
        "reported_user": lambda m, a: _person(m.reported_user),
    }
    column_default_sort = ("created_at", True)
    column_sortable_list = [Report.created_at]
    # Pasting a target id lists every report on it.
    column_searchable_list = ["reported_user.email", Report.target_id]
    column_filters = [
        NullFilter(Report.resolved_at, "State", is_set="Resolved", is_null="Open"),
        StaticValuesFilter(Report.target_type, _values(ReportTargetType), title="Target type"),
        StaticValuesFilter(Report.reason, _values(ReportReason), title="Reason"),
    ]

    @action(
        name="resolve",
        label="Resolve",
        confirmation_message="Resolve these reports and every other open report on their targets?",
    )
    async def resolve(self, request: Request) -> Response:
        closed = await self._run(actions.resolve_reports, _pks(request))
        return self._back(request, f"Resolved {closed} report(s).")

    @action(
        name="suspend_reported_user",
        label="Suspend reported user",
        confirmation_message="Suspend the reported users and end their sessions?",
    )
    async def suspend_reported_user(self, request: Request) -> Response:
        users = await self._run(_reported_users, _pks(request))
        done = await self._run(actions.suspend, users)
        return self._back(request, f"Suspended {done} user(s).")

    @action(
        name="hide_listing",
        label="Hide listing",
        confirmation_message="Hide the reported listings from the site?",
    )
    async def hide_listing(self, request: Request) -> Response:
        reports = await self._run(_listing_targets, _pks(request))
        listings = [target for target in reports if target is not None]
        if len(listings) < len(reports):
            _flash(request, "Skipped reports that are not on a listing.", FlashLevel.warning)
        done = await self._run(actions.hide_listings, listings)
        return self._back(request, f"Hid {done} listing(s).")

    @expose("/chat/{report_id}", methods=["GET"])
    async def chat(self, request: Request) -> Response:
        try:
            report_id = uuid.UUID(request.path_params["report_id"])
        except ValueError:
            raise HTTPException(status_code=404) from None
        page = await self._run(lambda s, ids: actions.read_chat(s, ids[0]), [report_id])
        if page is None:
            raise HTTPException(status_code=404)
        context = {"page": page, "title": "Reported chat", "model_view": self}
        return await self.templates.TemplateResponse(request, "chat.html", context)


def _reported_users(session: Session, report_ids: Sequence[uuid.UUID]) -> list[uuid.UUID]:
    query = select(Report.reported_user_id).where(Report.id.in_(report_ids)).distinct()
    return list(session.scalars(query).all())


def _listing_targets(session: Session, report_ids: Sequence[uuid.UUID]) -> list[uuid.UUID | None]:
    """Each selected report's listing id, or None for a report on anything else."""
    rows = session.execute(
        select(Report.target_type, Report.target_id).where(Report.id.in_(report_ids))
    ).tuples()
    return [target_id if kind == "listing" else None for kind, target_id in rows]


class UserView(_ReadOnly, model=User):
    name = "User"
    name_plural = "Users"
    icon = "fa-solid fa-user"
    can_edit = True
    column_list = [
        User.email,
        User.display_name,
        User.role,
        User.created_at,
        User.last_login_at,
        User.listing_cap,
        User.suspended_at,
        User.deleted_at,
    ]
    column_default_sort = ("created_at", True)
    column_sortable_list = [User.created_at, User.last_login_at]
    column_searchable_list = [User.email, User.display_name]
    column_filters = [
        NullFilter(User.suspended_at, "Suspended", is_set="Suspended", is_null="Not suspended")
    ]
    form_columns = [User.listing_cap]
    # The DB CHECK agrees (ck_users_listing_cap).
    form_args = {"listing_cap": {"validators": [InputRequired(), NumberRange(0, 100)]}}

    async def on_model_change(
        self, data: dict[str, Any], model: Any, is_created: bool, request: Request
    ) -> None:
        session = object_session(model)
        assert session is not None  # SQLAdmin's update session, before its commit
        actions.log_listing_cap(session, model, data["listing_cap"])

    @action(
        name="suspend",
        label="Suspend",
        confirmation_message="Suspend these users and end their sessions?",
    )
    async def suspend(self, request: Request) -> Response:
        done = await self._run(actions.suspend, _pks(request))
        return self._back(request, f"Suspended {done} user(s).")

    @action(
        name="unsuspend",
        label="Lift suspension",
        confirmation_message="Lift the suspension? They sign in afresh; old sessions stay ended.",
    )
    async def unsuspend(self, request: Request) -> Response:
        done = await self._run(actions.unsuspend, _pks(request))
        return self._back(request, f"Lifted {done} suspension(s).")


class ListingView(_ReadOnly, model=Listing):
    name = "Listing"
    name_plural = "Listings"
    icon = "fa-solid fa-house"
    column_list = [
        Listing.created_at,
        Listing.listing_type,
        Listing.city,
        Listing.street,
        Listing.price_ils,
        Listing.status,
        Listing.expires_at,
        Listing.removed_at,
        "owner",
    ]
    column_formatters = {"owner": lambda m, a: _person(m.owner)}
    column_formatters_detail = {"owner": lambda m, a: _person(m.owner)}
    # The raw point is never shown; lat / lng would each cost a lazy load.
    column_details_exclude_list = [Listing.location, Listing.lat, Listing.lng]
    column_default_sort = ("created_at", True)
    column_sortable_list = [Listing.created_at, Listing.price_ils]
    column_searchable_list = [Listing.city, Listing.street, "owner.email"]
    column_filters = [
        NullFilter(Listing.removed_at, "Removed", is_set="Removed", is_null="Not removed")
    ]

    @action(name="hide", label="Hide", confirmation_message="Hide these listings from the site?")
    async def hide(self, request: Request) -> Response:
        done = await self._run(actions.hide_listings, _pks(request))
        return self._back(request, f"Hid {done} listing(s).")

    @action(
        name="unhide",
        label="Un-hide",
        confirmation_message="Un-hide these listings? They stay paused until the owner resumes.",
    )
    async def unhide(self, request: Request) -> Response:
        done = await self._run(actions.unhide_listings, _pks(request))
        return self._back(request, f"Un-hid {done} listing(s).")


class AdminActionView(_ReadOnly, model=AdminAction):
    name = "Log entry"
    name_plural = "Log"
    icon = "fa-solid fa-list"
    column_list = [
        AdminAction.created_at,
        AdminAction.action,
        AdminAction.target_type,
        AdminAction.target_id,
        AdminAction.detail,
    ]
    column_default_sort = ("created_at", True)
    column_sortable_list = [AdminAction.created_at]


VIEWS = (ReportView, UserView, ListingView, AdminActionView)
