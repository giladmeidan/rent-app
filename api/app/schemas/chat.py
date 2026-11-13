"""API schemas for chat (spec 0005a; members from 0008d). Never the ORM models.

Every response shape lists its fields explicitly (NF2): no user id and no email anywhere. A
conversation's members (the owner, the seeker and, on a room application, the room's flatmates,
spec 0008d) are known only by their `display_name`, and only to the members: `other_name` is the
seeker's name for the owner and for a flatmate and the owner's for the seeker; `members` lists
every member with their role and `is_me`; who sent a message is `mine` and `sender_name`. The
caller's own role is `my_role`. A conversation has its own `id`: an application chat's equals its
application's id (PRODUCT.md "Chat", Q4), a direct chat's (two people, no application, spec 0010g)
is random; a direct chat has no `listing` and both its people have the role `person`. Bodies are
plain text: stored and returned as validated, never processed as HTML."""

import datetime as dt
import uuid
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field

from app.schemas._text import visible_characters_only
from app.schemas.application import ApplicationListingOut
from app.schemas.listing import _lf_newlines

BODY_MAX_LENGTH = 2000  # ck_messages_body_length (migration 0006)

MemberRole = Literal["owner", "seeker", "flatmate", "person"]


def _visible_body(value: str) -> str:
    # No `require_alnum`: an emoji-only or punctuation-only message ("?") is a valid chat message;
    # but at least one character must render (no joiner-, mark- or selector-only bodies).
    return visible_characters_only(value, allow_newlines=True, field="body", require_visible=True)


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


class MemberOut(BaseModel):
    """One member of a conversation. `is_me` marks the caller (two members may share a name)."""

    name: str
    role: MemberRole
    is_me: bool


class MessageOut(BaseModel):
    """One message of a thread. `mine`: the caller sent it; `sender_name` is the sender's display
    name (the caller's own on `mine`; a flatmate who has since left keeps theirs)."""

    id: uuid.UUID
    body: str
    mine: bool
    sender_name: str
    created_at: dt.datetime


class LastMessageOut(BaseModel):
    """The newest message of a conversation, as the chat list previews it."""

    body: str  # its first 120 characters
    mine: bool
    created_at: dt.datetime


class ConversationOut(BaseModel):
    """One of the caller's conversations in `GET /me/conversations`."""

    id: uuid.UUID  # the application's id for an application chat
    listing: ApplicationListingOut | None  # null exactly for a direct chat
    other_name: str  # the seeker's name for the owner and a flatmate, the owner's for the seeker
    my_role: MemberRole
    member_count: int  # 2, plus the room's flatmates on a room application
    # an application chat: the application is `shortlisted`; a direct chat: not closed
    can_send: bool
    is_new: bool  # the caller never opened it
    unread_count: int
    last_message: LastMessageOut | None
    created_at: dt.datetime


class ThreadOut(BaseModel):
    """One conversation with its newest messages, oldest first (`truncated`: older ones exist).
    `members`: the owner first, then the flatmates by `joined_at`, then the seeker (the caller
    included). `visible_from`: for a flatmate, their `joined_at` (no message before it is shown);
    null for the owner and the seeker."""

    id: uuid.UUID
    listing: ApplicationListingOut | None  # null exactly for a direct chat
    other_name: str
    my_role: MemberRole
    members: list[MemberOut]
    visible_from: dt.datetime | None
    can_send: bool
    messages: list[MessageOut]
    truncated: bool
