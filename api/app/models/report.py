"""`reports` table (spec 0011b): one row per report a signed-in user made, stored for Slice 12's
admin. Nothing reads it in the running app.

Every CHECK, the unique constraint, the FKs and the index match migration 0021 exactly
(autogenerate must see no diff). `services/reports.py` is the only writer. `target_id` has no FK:
it points into five tables (`target_type` says which) and a report outlives its target's row."""

import datetime as dt
import uuid
from typing import get_args

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base
from app.schemas.report import NOTE_MAX_LENGTH, ReportReason, ReportTargetType


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(f"'{value}'" for value in values)})"


TARGET_TYPE_CHECK = _in_list("target_type", get_args(ReportTargetType))
REASON_CHECK = _in_list("reason", get_args(ReportReason))
NOTE_LENGTH_CHECK = f"char_length(note) BETWEEN 1 AND {NOTE_MAX_LENGTH}"
NOT_SELF_CHECK = "reporter_id <> reported_user_id"


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (
        CheckConstraint(TARGET_TYPE_CHECK, name="ck_reports_target_type"),
        CheckConstraint(REASON_CHECK, name="ck_reports_reason"),
        CheckConstraint(NOTE_LENGTH_CHECK, name="ck_reports_note_length"),
        CheckConstraint(NOT_SELF_CHECK, name="ck_reports_not_self"),
        # One report per reporter and target: a repeat is "already reported".
        UniqueConstraint(
            "reporter_id", "target_type", "target_id", name="uq_reports_reporter_target"
        ),
        Index("ix_reports_reported_user_id", "reported_user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    reporter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    target_type: Mapped[str] = mapped_column(Text, nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    reported_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)  # NULL = no note
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
