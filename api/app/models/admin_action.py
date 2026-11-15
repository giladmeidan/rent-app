"""`admin_actions` table (spec 0012a, migration 0024): the admin dashboard's log (spec 0012b), one
row per action. The running public app never reads or writes it.

Every CHECK matches migration 0024 exactly (autogenerate must see no diff). `target_id` has no FK:
it points into four tables (`target_type` says which) and the log outlives its target. There is one
admin, so there is no "who" column."""

import datetime as dt
import uuid
from typing import Literal, get_args

from sqlalchemy import CheckConstraint, DateTime, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base
from app.models.report import _in_list

AdminActionKind = Literal[
    "suspend",
    "unsuspend",
    "hide_listing",
    "unhide_listing",
    "set_listing_cap",
    "resolve_reports",
    "read_chat",
]
AdminTargetType = Literal["user", "listing", "report", "chat"]

DETAIL_MAX_LENGTH = 200
ACTION_CHECK = _in_list("action", get_args(AdminActionKind))
TARGET_TYPE_CHECK = _in_list("target_type", get_args(AdminTargetType))
DETAIL_LENGTH_CHECK = f"char_length(detail) BETWEEN 1 AND {DETAIL_MAX_LENGTH}"


class AdminAction(Base):
    __tablename__ = "admin_actions"
    __table_args__ = (
        CheckConstraint(ACTION_CHECK, name="ck_admin_actions_action"),
        CheckConstraint(TARGET_TYPE_CHECK, name="ck_admin_actions_target_type"),
        CheckConstraint(DETAIL_LENGTH_CHECK, name="ck_admin_actions_detail_length"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    target_type: Mapped[str] = mapped_column(Text, nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)  # NULL = none
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
