"""Chat endpoints (spec 0005a; members from 0008d; direct chats from 0010g). Thin: all logic is in
`services/chat.py`.

Every endpoint requires a session (`current_user`, any role): 401 `unauthenticated` without one.
A conversation the caller is not a **member** of (its owner, its seeker or, on a room application,
a flatmate of its listing; one of the two people of a direct chat) is a 404 `not_found`, identical
to an unknown id or an application that was never shortlisted. Sending to a conversation whose
application is not `shortlisted`, or to a closed direct chat, is a 409 `chat_closed`; sending is
rate limited (429 `rate_limited` with `Retry-After`). A sent message is
published to every member's event streams after the commit (spec 0005c)."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Row
from sqlalchemy.orm import Session

from app.auth import current_user
from app.db import get_session
from app.models import User
from app.redis_client import RedisClient, get_redis
from app.schemas.application import ApplicationListingOut
from app.schemas.chat import (
    ConversationOut,
    LastMessageOut,
    MemberOut,
    MessageIn,
    MessageOut,
    ThreadOut,
)
from app.schemas.error import ErrorOut
from app.services import chat as chat_service
from app.services import chat_events
from app.services.rate_limit import RateLimitedError

router = APIRouter(tags=["chat"])

DbDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[User, Depends(current_user)]

_SESSION: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorOut, "description": "unauthenticated"},
    503: {"model": ErrorOut, "description": "The database or Redis is unreachable"},
}
_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {
        "model": ErrorOut,
        "description": "not_found: unknown id, an application never shortlisted, or a "
        "conversation (an application chat or a direct chat) the caller is not a member of",
    },
}


def _listing(row: Row[Any]) -> ApplicationListingOut | None:
    if row.listing_id is None:  # a direct chat
        return None
    return ApplicationListingOut(
        id=row.listing_id,
        listing_type=row.listing_type,
        city=row.listing_city,
        street=row.listing_street,
        rooms=row.listing_rooms,
        price_ils=row.listing_price_ils,
    )


def _conversation_out(row: Row[Any]) -> ConversationOut:
    last = (
        None
        if row.last_created_at is None
        else LastMessageOut(body=row.last_body, mine=row.last_mine, created_at=row.last_created_at)
    )
    return ConversationOut(
        id=row.id,
        listing=_listing(row),
        other_name=row.other_name,
        my_role=row.my_role,
        member_count=row.member_count,
        can_send=row.can_send,
        is_new=row.is_new,
        unread_count=row.unread_count,
        last_message=last,
        created_at=row.created_at,
    )


@router.get("/me/conversations", response_model=list[ConversationOut], responses=_SESSION)
def list_conversations(me: UserDep, db: DbDep) -> list[ConversationOut]:
    return [_conversation_out(row) for row in chat_service.list_conversations(db, me)]


@router.get(
    "/conversations/{conversation_id}",
    response_model=ThreadOut,
    responses={**_SESSION, **_NOT_FOUND},
)
def get_thread(conversation_id: uuid.UUID, me: UserDep, db: DbDep) -> ThreadOut:
    try:
        thread = chat_service.get_thread(db, me, conversation_id)
    except chat_service.ConversationNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    header = thread.header
    return ThreadOut(
        id=conversation_id,
        listing=_listing(header),
        other_name=header.other_name,
        my_role=header.my_role,
        members=[MemberOut(name=m.name, role=m.role, is_me=m.is_me) for m in thread.members],
        visible_from=header.visible_from,
        can_send=header.can_send,
        messages=[
            MessageOut(
                id=m.id,
                body=m.body,
                mine=m.mine,
                sender_name=m.sender_name,
                created_at=m.created_at,
            )
            for m in thread.messages
        ],
        truncated=thread.truncated,
    )


@router.post(
    "/conversations/{conversation_id}/messages",
    status_code=201,
    response_model=MessageOut,
    responses={
        **_SESSION,
        **_NOT_FOUND,
        409: {
            "model": ErrorOut,
            "description": "chat_closed: the application is not shortlisted (un-shortlisted, "
            "declined or withdrawn), or a direct chat is closed (the match was removed); the "
            "thread stays readable",
        },
        429: {"model": ErrorOut, "description": "rate_limited; see Retry-After"},
    },
)
def send_message(
    conversation_id: uuid.UUID,
    body: MessageIn,
    me: UserDep,
    db: DbDep,
    r: Annotated[RedisClient, Depends(get_redis)],
) -> MessageOut:
    try:
        message, member_ids = chat_service.send_message(db, r, me, conversation_id, body.body)
    except RateLimitedError as exc:
        raise HTTPException(
            status_code=429, detail="rate_limited", headers={"Retry-After": str(exc.retry_after)}
        ) from None
    except chat_service.ConversationNotFoundError:
        raise HTTPException(status_code=404, detail="not_found") from None
    except chat_service.ChatClosedError:
        raise HTTPException(status_code=409, detail="chat_closed") from None
    chat_events.publish(r, member_ids, conversation_id, "message")
    return MessageOut(
        id=message.id,
        body=message.body,
        mine=True,
        sender_name=me.display_name,
        created_at=message.created_at,
    )
