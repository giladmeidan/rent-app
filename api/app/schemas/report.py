"""API schemas for reports (spec 0011b). Never the ORM model.

A report names a target by the id its page already holds (`target_type` says which place); the
server resolves the person behind it (`services/reports.py`). The response is
`{already_reported}` only: **no response ever echoes the note**, and nothing logs it."""

import uuid
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field

from app.schemas._text import blank_to_none, lf_newlines, visible_characters_only

# Where the report was made (ck_reports_target_type, migration 0021).
ReportTargetType = Literal["listing", "person", "room_person", "chat", "applicant"]
# ck_reports_reason (migration 0021). The dialog offers `unavailable` only where a listing is
# involved; the API accepts any reason with any target.
ReportReason = Literal[
    "money_before_viewing", "broker", "misleading", "unavailable", "offensive", "other"
]

NOTE_MAX_LENGTH = 500  # ck_reports_note_length (migration 0021)


def _visible_note(value: str) -> str:
    return visible_characters_only(value, allow_newlines=True, field="note", require_alnum=True)


# Stripped (model config) and `\r\n` -> `\n` before the length check, as an application's message.
Note = Annotated[
    str,
    BeforeValidator(lf_newlines),
    Field(min_length=1, max_length=NOTE_MAX_LENGTH),
    AfterValidator(_visible_note),
]


class ReportIn(BaseModel):
    """A report: where (`target_type`, `target_id`), why (`reason`) and an optional note. Absent,
    null or blank is no note."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    target_type: ReportTargetType
    target_id: uuid.UUID
    reason: ReportReason
    note: Annotated[Note | None, BeforeValidator(blank_to_none)] = None


class ReportOut(BaseModel):
    """`already_reported`: true when the caller had already reported this target (the first
    report stands, unchanged)."""

    already_reported: bool
