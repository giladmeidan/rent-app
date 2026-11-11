"""The chat event stream (spec 0005c): `GET /me/events`, one server-sent event stream per tab.

Auth: a session cookie, either role, resolved once at connect with a short-lived DB session (no
pooled connection is held while the stream is open, NF4); the stream only ever receives the
caller's own channel (NF3). Every check runs in a dependency, which FastAPI solves before it
creates the generator: once the generator runs, the `200 text/event-stream` start is already sent
and an error can no longer be a JSON response. Errors: 401 `unauthenticated`, 429 `rate_limited`
(+ `Retry-After`), 429 `too_many_streams`, 503 (DB or Redis down at connect).

Wire format: `retry: 3000` first, then `event: chat` with `data: {"conversation_id", "kind"}`,
`event: resync` with `data: {}` (events were dropped: refetch everything) and FastAPI's own `: ping`
comments every 15 s. The stream ends after `STREAM_MAX_S` plus up to `STREAM_JITTER_S` (the browser
reconnects and re-authenticates) or when the hub fails. Nothing is replayed: no `id:`."""

import asyncio
import random
import uuid
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Cookie, Depends, HTTPException
from fastapi.sse import EventSourceResponse, ServerSentEvent
from starlette.concurrency import run_in_threadpool

from app.auth import COOKIE_NAME
from app.db import get_sessionmaker
from app.redis_client import RedisClient, get_redis
from app.schemas.error import ErrorOut
from app.services import chat_events
from app.services.auth import resolve_session
from app.services.rate_limit import RateLimitedError, count_or_raise

router = APIRouter(tags=["events"])

EVENTS_OPEN_LIMIT_MINUTE = 30
EVENTS_OPEN_WINDOW_S = 60
STREAM_MAX_S = 900.0
STREAM_JITTER_S = 60.0
RETRY_MS = 3000

_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorOut, "description": "unauthenticated"},
    429: {
        "model": ErrorOut,
        "description": "rate_limited (see Retry-After): too many stream opens per minute; "
        "too_many_streams: the user already has the maximum of open streams",
    },
    503: {"model": ErrorOut, "description": "The database or Redis is unreachable"},
}


def _user_id_for(token: str) -> uuid.UUID | None:
    """The user id of a live session, from a session opened and closed here (runs in the
    threadpool)."""
    with get_sessionmaker()() as db:
        user = resolve_session(db, token)
        return None if user is None else user.id


async def stream_user_id(
    r: Annotated[RedisClient, Depends(get_redis)],
    token: Annotated[str | None, Cookie(alias=COOKIE_NAME)] = None,
) -> uuid.UUID:
    """The caller's user id (401 `unauthenticated`), counted against the open rate limit (429
    `rate_limited`). Deliberately without `get_session`: a yield dependency would hold a pooled
    connection for the stream's whole life."""
    user_id = await run_in_threadpool(_user_id_for, token) if token else None
    if user_id is None:
        raise HTTPException(status_code=401, detail="unauthenticated")
    counter = (f"rl:events:user:{user_id}", EVENTS_OPEN_LIMIT_MINUTE, EVENTS_OPEN_WINDOW_S)
    try:
        await run_in_threadpool(count_or_raise, r, (counter,))
    except RateLimitedError as exc:
        raise HTTPException(
            status_code=429, detail="rate_limited", headers={"Retry-After": str(exc.retry_after)}
        ) from None
    return user_id


async def stream_subscription(
    user_id: Annotated[uuid.UUID, Depends(stream_user_id)],
) -> AsyncIterator[chat_events.Subscription]:
    """The stream's hub subscription (429 `too_many_streams`). The cleanup lives here, on the
    request's exit stack: on a client disconnect FastAPI cancels the generator's task group, so an
    `await` in the generator's own `finally` would be cancelled and the UNSUBSCRIBE lost."""
    hub = chat_events.get_hub()
    try:
        sub = await hub.connect(user_id)
    except chat_events.TooManyStreamsError:
        raise HTTPException(status_code=429, detail="too_many_streams") from None
    try:
        yield sub
    finally:
        await hub.disconnect(sub)


@router.get("/me/events", response_class=EventSourceResponse, responses=_ERRORS)
async def events(
    sub: Annotated[chat_events.Subscription, Depends(stream_subscription)],
) -> AsyncIterator[ServerSentEvent]:
    yield ServerSentEvent(retry=RETRY_MS)
    loop = asyncio.get_running_loop()
    deadline = loop.time() + STREAM_MAX_S + random.uniform(0, STREAM_JITTER_S)
    while True:
        try:
            async with asyncio.timeout_at(deadline):
                item = await sub.queue.get()
        except TimeoutError:
            return
        if item is None:
            return
        if item is chat_events.RESYNC:
            yield ServerSentEvent(event="resync", data={})
        else:
            yield ServerSentEvent(event="chat", raw_data=item)
