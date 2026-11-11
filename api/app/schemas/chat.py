"""API schemas for chat (spec 0005a). Never the ORM models.

Every response shape lists its fields explicitly (NF2): no user id and no email anywhere. The
other participant is known only by `other_name` (their `display_name`), and only to the two
participants; who sent a message is `mine`. A conversation's `id` is its application's id
(PRODUCT.md "Chat", Q4). Bodies are plain text: stored and returned as validated, never processed
as HTML."""

import datetime as dt
import uuid
from typing import Annotated

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field

from app.schemas._text import visible_characters_only
from app.schemas.application import ApplicationListingOut
from app.schemas.listing import _lf_newlines

BODY_MAX_LENGTH = 2000  # ck_messages_body_length (migration 0006)


def _visible_body(value: str) -> str:
    # No `require_alnum`: an emoji-only or punctuation-only message ("?") is a valid chat message.
    return visible_characters_only(value, allow_newlines=True, field="body")


# Stripped (model config) and `\r\n` -> `\n` before the length check, so "   " is empty.
Body = Annotated[
    str,
    BeforeValidator(_lf_newlines),
    Field(min_length=1, max_length=BODY_MAX_LENGTH),
    AfterValidator(_visible_body),
]


class MessageIn(BaseModel):
    """A chat message: plain text, 1-2000 characters after trimming."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    body: Body


class MessageOut(BaseModel):
    """One message of a thread. The sender is `mine` (the caller) or the other participant."""

    id: uuid.UUID
    body: str
    mine: bool
    created_at: dt.datetime


class LastMessageOut(BaseModel):
    """The newest message of a conversation, as the chat list previews it."""

    body: str  # its first 120 characters
    mine: bool
    created_at: dt.datetime


class ConversationOut(BaseModel):
    """One of the caller's conversations in `GET /me/conversations`."""

    id: uuid.UUID  # the application's id
    listing: ApplicationListingOut
    other_name: str
    can_send: bool  # the application is `shortlisted`
    is_new: bool  # the caller never opened it
    unread_count: int
    last_message: LastMessageOut | None
    created_at: dt.datetime


class ThreadOut(BaseModel):
    """One conversation with its newest messages, oldest first (`truncated`: older ones exist)."""

    id: uuid.UUID
    listing: ApplicationListingOut
    other_name: str
    can_send: bool
    messages: list[MessageOut]
    truncated: bool
