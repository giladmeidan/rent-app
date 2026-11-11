---
id: 0005c
title: Every logged-in tab holds one server-sent event stream that tells it within a second when one of its chats gets a message, opens or closes, so chat pages update without polling
status: in-progress
depends_on: [0005a]      # the conversations, the send endpoint and the shortlist hook this spec publishes from
reviewers: [code, qa, security, perf]   # security: a long-lived authenticated connection, per-user fan-out (no event to the wrong user), connection exhaustion; perf: the scale path — idle streams must cost no DB, one Redis connection per process
estimate: 1 coder run
---

## Goal
After this ships, a logged-in user's tab opens `GET /me/events` once and keeps it open; whenever one of their
conversations gets a message (from either side, or from their own other tab), opens on shortlist, or opens /
closes for sending through a status change, the stream delivers `event: chat` with the conversation id within a
second, and the web (`0005b`) refetches only what changed. Idle streams cost no database work and one shared Redis
connection per API process, so the cost grows with messages sent, not with users online × time (PRODUCT.md
"Chat", decided 2026-11-11: push, chosen for a very large user count). Serves Dev Plan slice 5 (Chat), part c of
three:
- `0005a` — tables, open-on-shortlist, list / read / send API (verified).
- `0005c` (this) — the event stream and the publish points. `depends_on: [0005a]`.
- `0005b` — web, consuming both. `depends_on: [0005a, 0005c, 0004b, 0004d]`.

## Scope
**In:**
- `api/app/services/chat_events.py` (new):
  - `publish(r: RedisClient, user_ids: Iterable[uuid.UUID], conversation_id: uuid.UUID, kind: Literal["message",
    "status"]) -> None` (sync): `PUBLISH chat:u:{user_id}` with the JSON `{"conversation_id": "<uuid>", "kind":
    "<kind>"}` for each user. Catches `redis.RedisError`, logs a warning (`logging.getLogger(__name__)`) and
    returns: it is called **after** the commit, so the request has already succeeded; clients recover on their
    next reconnect (NF2). Callers call it as `chat_events.publish(...)` (module attribute, so tests can replace
    it).
  - `ChatHub` — one per process, returned by a **sync** `get_hub()` (no creation race), which rebuilds it when
    the cached hub is closed or bound to another event loop; `async close_hub()` for tests:
    - one client `redis.asyncio.Redis.from_url(url, socket_connect_timeout=1, client_name=f"chat-hub:{os.getpid()}")`
      (from `redis` 5.3, already a dependency; **not** `get_redis()`'s 1 s `socket_timeout`, which would kill an
      idle read) and **one** `PubSub` for every stream in the process; one reader task that `await
      pubsub.connect()`s once, then loops `get_message(ignore_subscribe_messages=True, timeout=1.0)` (an explicit
      timeout returns None; `listen()` would exit with no subscriptions) and routes each message to the local
      subscriptions of that user; any exception fails the hub (below).
    - `async connect(user_id) -> Subscription` (an `asyncio.Queue(maxsize=QUEUE_MAX)`, `QUEUE_MAX = 100`): the
      first local subscription of a user `SUBSCRIBE`s `chat:u:{user_id}`; `async disconnect(sub)`: the last one to
      leave `UNSUBSCRIBE`s it. More than `MAX_STREAMS_PER_USER = 5` local subscriptions of one user →
      `TooManyStreamsError`.
    - a full queue is emptied and gets one `RESYNC` marker (its stream sends `event: resync`, the client refetches
      everything); later events queue normally.
    - when the reader fails, the hub empties every local queue and puts a `None` sentinel in each (a stream ends on
      `None`; the browsers reconnect and refetch) and marks itself closed; the next `get_hub()` builds a fresh one.
- `api/app/routers/events.py` (new, tag `events`, included in `main.py`): `GET /me/events`, an `async def`
  generator endpoint with `response_class=EventSourceResponse` (FastAPI 0.162's built-in `fastapi.sse`; its
  automatic `: ping` keep-alive every 15 s and its `Cache-Control: no-cache` / `X-Accel-Buffering: no` headers
  stay as they are — no headers of ours). **Every check runs in dependencies**, which FastAPI solves before it
  creates the generator, because once the generator runs the `200 text/event-stream` start is already sent and an
  `HTTPException` can no longer become a JSON error:
  1. `stream_user_id` (async, no yield) — **without** the `get_session` dependency (a yield dependency would hold a
     pooled DB connection for the stream's whole life): the cookie via `Cookie(alias=COOKIE_NAME)`, then `await
     run_in_threadpool(_user_id_for, token)`, a helper that opens `get_sessionmaker()()` in a `with` block, calls
     `resolve_session` and returns the user id only; None → 401 `unauthenticated`. Then `await
     run_in_threadpool(count_or_raise, …)` (the Redis limiter is sync) on `rl:events:user:{id}`
     (`EVENTS_OPEN_LIMIT_MINUTE = 30`, 60 s) → 429 `rate_limited` + `Retry-After`. A DB or Redis error here → 503
     through the existing handlers.
  2. `stream_subscription` (async **yield**, the default scope — never `scope="function"`): `sub = await
     get_hub().connect(uid)` (`TooManyStreamsError` → 429 `too_many_streams`), then `try: yield sub` / `finally:
     await get_hub().disconnect(sub)`. The cleanup lives here, on the request's exit stack, because on a client
     disconnect FastAPI cancels the producer task group, and an `await` in the generator's own `finally` would be
     cancelled again (the UNSUBSCRIBE would never go out). The generator has no `finally`.
  3. The generator: first `ServerSentEvent(retry=3000)` (reconnect after 3 s), then per queue item
     `ServerSentEvent(event="chat", raw_data=<the published text>)` (`raw_data`: the payload is already JSON;
     `data=` would encode it twice), `ServerSentEvent(event="resync", data={})` for `RESYNC`, and it returns on
     `None` (hub failure) or after `STREAM_MAX_S = 900` plus a random 0–`STREAM_JITTER_S` (60) s, which bounds how
     long a revoked session keeps a stream and spreads reconnects after a deploy; the browser reconnects and
     re-authenticates. It never sends `id:` (nothing is replayed).
- Publish points, each one line in the router **after** the service returned (so after its commit):
  - `routers/chat.py` `POST /conversations/{id}/messages` → `publish(r, [owner_id, seeker_id], id, "message")`;
    `services/chat.send_message` returns `(Message, owner_id, seeker_id)`, taken from its step 4 `UPDATE
    conversations … RETURNING owner_id, seeker_id` (no extra statement; the `INSERT … SELECT` can only return
    `messages` columns).
  - `routers/applications.py` owner `PATCH …/applications/{application_id}` (every 200; the handler gains `r:
    Annotated[RedisClient, Depends(get_redis)]`) → `publish(r, [owner.id, application.seeker_id], application.id,
    "status")`; seeker `POST /me/applications/{id}/withdraw` (every 200)
    → `publish(r, [listing.owner_id, user.id], application.id, "status")`. Unconditional: an application with no
    conversation costs its two users one cheap list refetch; status changes are rare.
  - Nothing else publishes (applying and re-applying change no conversation).
- Tests: `api/tests/test_chat_events.py` (new). The stream is driven at the ASGI level by a small helper in that
  file: an HTTP scope with `asgi.spec_version` `"2.3"` (as uvicorn) and the cookie header; `receive` returns
  `http.request` once, then blocks on an `asyncio.Event` until the test disconnects, then returns
  `http.disconnect`; `send` collects `http.response.start` and body chunks for the test to wait on (with a
  timeout). No server, no thread, no network (the `no_network` fixture stays); httpx's `ASGITransport` buffers the
  whole body, so it cannot be used. Async tests are `@pytest.mark.asyncio` and `hub_reset` is a
  `@pytest_asyncio.fixture` (strict mode) that awaits `close_hub()` after each test (the hub is bound to the
  test's loop). `fastapi.routing._PING_INTERVAL` (routing imports it by name), `STREAM_MAX_S`,
  `STREAM_JITTER_S` and `QUEUE_MAX` are monkeypatched where an AC says so.
- `README.md`: a `curl -N --cookie rent_session=… http://localhost:8000/me/events` line under "Posting a listing
  locally".
- `specs/FOLLOWUPS.md`: append `0005c · infra (Slice 12) · production must serve the API over HTTP/2 end to end at
  the edge (one stream per tab; HTTP/1.1 allows 6 connections per origin, so 6+ tabs would starve) and must not
  buffer text/event-stream; keep uvicorn behind a proxy that allows ≥ 960 s idle-free streams (15 s pings) · deploy
  decision`.

**Out:**
- Message content in events (events carry ids only; content stays behind `0005a`'s membership checks — NF3).
- Event replay / `Last-Event-ID` (a reconnecting client refetches instead; nothing is persisted).
- Typing indicators, presence, read receipts; push notifications to a closed tab or the PWA (Q3 of `0005a`: none).
- A separate realtime gateway service and Redis Cluster sharding — the scale-out path beyond one Redis (Risks).
- The web side: `0005b`.

**New dependencies:** none (`fastapi.sse` ships with FastAPI 0.162.2; `redis.asyncio` with `redis` 5.3.1).

## Data
None. No migration. Redis: channels `chat:u:{user_id}` (pub/sub only, nothing stored); rate-limit keys
`rl:events:user:{id}`.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /me/events | session cookie, either role, resolved once at connect with a short-lived DB session; each stream only ever receives the caller's own channel | – | 200 `text/event-stream`: `retry: 3000`, then `event: chat` / `data: {"conversation_id","kind"}` (`kind` `message` or `status`), `event: resync` / `data: {}`, `: ping` comments; ends after 900–960 s | 401 `unauthenticated` · 429 `rate_limited` + `Retry-After` · 429 `too_many_streams` · 503 (DB or Redis down at connect) |
| POST | /conversations/{id}/messages (`0005a`) | unchanged | unchanged | unchanged; then publishes `message` to both participants | unchanged |
| PATCH | /listings/{lid}/applications/{aid} (`0004c`) | unchanged | unchanged | unchanged; every 200 publishes `status` to the owner and the seeker | unchanged |
| POST | /me/applications/{id}/withdraw (`0004a`) | unchanged | unchanged | unchanged; every 200 publishes `status` to the seeker and the owner | unchanged |

## UI
None in this part (`0005b` consumes the stream).

## Acceptance criteria
Fixtures as `0005a` (`signup(…, display_name=…)`, `make_*`, `redis_clean`, `outbox`) plus `hub_reset` and the ASGI
stream helper ("a stream of U" = the helper running `GET /me/events` with U's cookie). Waits are bounded: an
expected event within 1 s, an absent one checked for 0.3 s.
- [ ] AC1 Given no cookie, an unknown token and an expired session (SQL), When opening a stream, Then 401 `{"detail":"unauthenticated"}` with `content-type: application/json` and no stream; Given a valid session, Then 200 `text/event-stream`, `cache-control: no-cache`, the first bytes contain `retry: 3000`; while that stream is open, `get_engine().pool.checkedout()` is 0 — `api/tests/test_chat_events.py::test_ac1_stream_auth_holds_no_db_connection`
- [ ] AC2 Given streams of A and B, When `chat_events.publish(get_redis(), [A], cid, "message")`, Then A's stream yields exactly one `event: chat` whose data parses to `{"conversation_id": "<cid>", "kind": "message"}` and B's yields none; When published to `[A, B]`, Then both; Given two streams of A, Then both receive it — `test_chat_events.py::test_ac2_events_reach_only_their_user`
- [ ] AC3 Given the first stream of A, Then `PUBSUB NUMSUB chat:u:{A}` is 1 and `CLIENT LIST TYPE pubsub` has exactly one client named `chat-hub:<pid>`; a second stream of A keeps NUMSUB at 1; a stream of B adds `chat:u:{B}` on the same connection; When both of A's streams disconnect, Then NUMSUB for A is 0 and B's stream still receives its events — `test_chat_events.py::test_ac3_one_connection_refcounted_channels`
- [ ] AC4 Given 5 open streams of A, When a 6th opens, Then 429 `{"detail":"too_many_streams"}`; Given `redis_clean` and `rl:events:user:{A}` set to 30 with `ex=60`, When A opens a stream, Then 429 `{"detail":"rate_limited"}` with an integer `Retry-After` between 1 and 60; B can still open one — `test_chat_events.py::test_ac4_stream_limits`
- [ ] AC5 Given `fastapi.routing._PING_INTERVAL` patched to 0.05 s, Then an idle stream yields `: ping` comments; Given `STREAM_MAX_S` 0.2 and `STREAM_JITTER_S` 0, Then the stream ends by itself within 1 s and NUMSUB for that user is back to 0 — `test_chat_events.py::test_ac5_keepalive_and_max_lifetime`
- [ ] AC6 Given `QUEUE_MAX` 2 and `sub = await get_hub().connect(A)`, When 5 events are published to A, Then the queue holds exactly `[RESYNC]`; a 6th publish → the queue is `[RESYNC, <chat item>]`; Given a stream of A whose subscription receives `RESYNC`, Then it yields `event: resync` with `data: {}` and then later events as `chat` — `test_chat_events.py::test_ac6_overflow_sends_resync`
- [ ] AC7 Given streams of A and B, When the hub's connection is killed from outside (`get_redis().client_kill_filter(_id=…)` with the id of the `CLIENT LIST` entry named `chat-hub:<pid>`; never every pubsub client — the dev Redis is shared), Then both streams end within 1 s; When A opens a new stream, Then it works and receives a new event — `test_chat_events.py::test_ac7_redis_failure_ends_streams_and_recovers`
- [ ] AC8 Given `chat_events.publish` replaced by a recorder that also checks, from a fresh DB connection, that the triggering change is committed, When S sends a message on P (`0005a`), Then one call `([O, S], P, "message")` in any order of ids; When O PATCHes P to `submitted`, `shortlisted`, `declined` (each 200), Then one `status` call each with `[O, S]`; When another seeker withdraws their shortlisted application W, Then one `([owner, that seeker], W, "status")`; a 404, 409, 422 or 429 on any of these makes no call — `test_chat_events.py::test_ac8_publish_points_after_commit`
- [ ] AC9 Given `get_redis().publish` raising `redis.ConnectionError`, When S sends a message, Then 201 and the row exists, and a warning is logged; When O PATCHes an applicant, Then 200 — `test_chat_events.py::test_ac9_publish_failure_never_fails_a_request`
- [ ] NF1 `make lint` clean (ruff, mypy --strict; the `redis.asyncio` types come from `types-redis`, a `type: ignore` only where `services/rate_limit.py` already needs one); `make client` regenerates `schema.d.ts` with `GET /me/events` — CI `api`, `web` jobs
- [ ] NF2 Correctness under failure: a publish that fails, an overflowed queue and a dropped Redis connection each end in the client refetching (AC6, AC7, AC9); no request fails because of Redis pub/sub — security + code reviewers
- [ ] NF3 Privacy: an event carries only `conversation_id` and `kind`; a stream subscribes only to the caller's channel, fixed at connect (AC2) — security reviewer
- [ ] NF4 Scale: an idle stream runs no SQL (AC1: no pooled connection; pings are FastAPI's comment frames) and every stream in a process shares one Redis connection (AC3); per sent message the server does 2 `PUBLISH`es and the two users' tabs one refetch each — perf reviewer

## Tests to write
Async integration (Postgres + Redis, `pytest-asyncio`): AC1–AC7 in `test_chat_events.py` through the ASGI helper;
AC8–AC9 with the sync `TestClient` and a monkeypatched `chat_events.publish` / `get_redis().publish`.
`test_chat.py`, `test_inbox.py`, `test_applications.py` pass unchanged (publishing is a side effect after the
commit; their statement counts are unaffected — `PUBLISH` is Redis, not SQL). E2E: none (`0005b`).

## Risks / open questions
**Decisions:** Gilad 2026-11-11: "think on a huge scale of users — choose the better option": the orchestrator chose
SSE over Redis pub/sub (reasoning in PRODUCT.md "Chat" and the `0005a` Q1 note). No open product question.

**Why not the alternatives (for the reviewers):** polling makes cost proportional to users online × time (every
open thread every few seconds, each with a session lookup and queries, almost always finding nothing); WebSockets
scale the same way as SSE (the cost is open connections plus the same Redis fan-out) but add a second protocol,
their own auth handshake, heartbeats and reconnect logic, for a two-way channel chat does not need — sending stays
a plain `POST` with its validation and rate limits. SSE is plain HTTP: browsers reconnect by themselves, HTTP/2
multiplexes it, proxies and CDNs pass it.

**Scale-out path (not built here):** one Redis handles on the order of 100k+ publishes per second; when a single
Redis or the API processes become the limit, (1) run more API processes — each holds its own hub, Redis fans out
to all; (2) move `GET /me/events` to a dedicated stream service with the same contract; (3) shard channels with
Redis Cluster sharded pub/sub (`SSUBSCRIBE`). The client contract (`/me/events`, `chat` / `resync`) stays.

**Technical risks the verifier should challenge:**
- **Event loop blocking:** the endpoint is `async`; the DB session lookup and the sync Redis limiter run in the
  threadpool, never on the loop. A sync call on the loop would stall every stream of the process.
- **Hub lifecycle per event loop:** production has one loop per process; tests get a loop per test, hence
  `hub_reset` and `get_hub()` rebuilding a hub bound to another loop. A hub created at import time would break
  both. `TestClient` runs the app on its own loop, so the stream ACs use the ASGI helper, never `TestClient`.
- **Disconnect detection:** on `http.disconnect` FastAPI cancels the producer; the cleanup lives in the yield
  dependency, which runs afterwards on the request's exit stack, outside the cancelled scope (AC3, AC5).
- **Revoked sessions:** a logged-out session's stream lives until its 900–960 s end; events carry ids only (NF3),
  and the web closes its own stream on logout (`0005b`). Accepted.
- **HTTP/1.1 in local dev:** uvicorn without a proxy speaks HTTP/1.1, so 6+ tabs on one browser starve each other;
  dev only (FOLLOWUPS entry for production).
- Touches `routers/applications.py` and `routers/chat.py` / `services/chat.py` (from `0005a`): this branch starts
  from `0005a`'s branch once its PR is open (Speed rule 3) and merges `origin/main` after it lands.

## Verifier findings — one round, 10 findings, all applied
1. (blocker) A generator endpoint cannot send a JSON 401 / 429 / 503 (the 200 start goes out first): every check moved into dependencies solved before the generator starts.
2. (blocker) An `await` in the generator's `finally` is cancelled on disconnect, so UNSUBSCRIBE never ran: cleanup moved into a yield dependency on the request exit stack.
3. `data=` would JSON-encode the published JSON twice: `raw_data=`; resync `data={}`; never `id:`.
4. Hub client: its own `redis.asyncio` client without the 1 s socket timeout, `client_name`; reader uses `get_message(timeout=1.0)` (not `listen()`); sync `get_hub()` rebuilds per loop; no shutdown hook (no lifespan).
5. Patch target is `fastapi.routing._PING_INTERVAL`; FastAPI already sets `no-cache` / `X-Accel-Buffering` (our header line dropped; AC1 asserts `no-cache`).
6. AC6 untestable through the stream (FastAPI's buffers absorb ~4 events): a full queue is emptied to one `RESYNC`; AC6 at hub level.
7. AC7: kill the hub's connection with `CLIENT KILL TYPE pubsub`; on failure each queue gets a `None` sentinel.
8. `send_message` gets the participants from step 4's `UPDATE … RETURNING owner_id, seeker_id`; the PATCH handler's variable is `owner` and it gains `r`.
9. AC3 counts the hub client by name (shared dev Redis); AC4 sets the rate-limit key instead of 30 opens.
10. ASGI helper spelled out (spec version, blocking `receive`, no `ASGITransport`); strict-mode pytest-asyncio markers.
Verifier note: the coder runs on Opus/high (concurrency).

## Digest (filled by orchestrator after verification)

    Spec 0005c - Chat events API: one SSE stream per tab pushes "this chat changed"   (verified, part 2 of 3, depends on 0005a)
    What a user can do after this: an open chat page or header learns within a second that a chat got a message,
             opened or closed, without polling.
    Decisions: Gilad 2026-11-11 "choose the option that scales" -> SSE over Redis pub/sub (orchestrator's call, in PRODUCT.md).
    KPIs this slice moves: time from send to seen; server cost per online user (flat while idle).
    Acceptance targets: NF4 an idle stream runs no SQL and holds no DB connection; one Redis connection per API process
             for all its streams; 2 PUBLISHes per message - NF3 events carry ids only - NF2 a Redis failure never
             fails a request, clients refetch.
    Risks: long-lived async connections in a mostly sync app (loop blocking, cancelled cleanup) - mitigation: checks and
             cleanup in dependencies, DB/limiter calls in the threadpool, ASGI-level tests for each failure path.
    Reviewers: code, qa, security, perf   Estimated: 1 coder run (Opus/high), 1 review round
    Links: specs/0005c-chat-events-api.md - PRODUCT.md "Chat" - FOLLOWUPS (Slice 12 HTTP/2 + no buffering)
