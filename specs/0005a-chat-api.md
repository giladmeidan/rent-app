---
id: 0005a
title: Shortlisting an applicant opens a one-to-one chat between the owner and that seeker; both list their chats with unread counts, read a thread and send plain-text messages while the applicant stays shortlisted
status: in-progress
depends_on: [0004c]      # merged (dabac4c): the shortlist transition this spec hooks into; migration chain 0005 -> 0006
reviewers: [code, qa, security, perf]   # security: free text between two users, the owner's name revealed to the seeker, membership checks on every call, rate limits; qa: open / freeze rules per application status; perf: every pushed event (0005c) makes both users' tabs refetch the thread (the hot path), a conditional write on read
estimate: 1 coder run
---

## Goal
After this ships, an owner who moves an applicant to `shortlisted` (`PATCH /listings/{id}/applications/{aid}`,
`0004c`) opens a chat with that seeker, once per application; either participant calls `GET /me/conversations`
for their chats (the other person's display name, the listing, the last message, unread count), `GET
/conversations/{id}` for a thread (it marks the thread read), and `POST /conversations/{id}/messages` to send a
plain-text message — allowed only while the application is `shortlisted`; after an un-shortlist, decline or
withdraw the thread stays readable but closed (Q2). Serves Dev Plan slice 5 (Chat), part a of three; the push
stream is `0005c`, the web `0005b`. PRODUCT.md rows: "Chat — opens only on owner shortlist or mutual interest; never one-sided" (the
mutual-interest source is Slice 8), "Applications — the owner's identity is not shown to applicants until chat
opens on shortlist (Slice 5)" (this spec reveals the owner's `display_name` to that seeker, and only inside the
chat), "Trust (MVP) — rate limits, deposit-before-viewing warning in chat" (the warning is static copy in
`0005b`).

**Slice 5 is split in three** (one coder run each):
- `0005a` (this) — tables, open-on-shortlist, list / read / send API.
- `0005c` — the server-sent event stream that pushes "this chat changed" to open tabs (Q1, decided: push).
  `depends_on: [0005a]`.
- `0005b` — web: `/chat` list, `/chat/:id` thread driven by the stream, header badge, chat entry points in the
  owner inbox (`0004d`) and "my applications" (`0004b`). `depends_on: [0005a, 0005c, 0004b, 0004d]`.

## Scope
**In:**
- Migration `api/alembic/versions/0006_chat.py` (revision `"0006"`, down `"0005"`): tables `conversations`
  and `messages` (see Data), and a one-statement backfill of a conversation for every application already
  `shortlisted` (Data); working `downgrade` (drops both).
- `api/app/models/conversation.py` (new): `Conversation`, `Message`, registered in `api/app/models/__init__.py`
  (`__all__` too). Autogenerate must see no diff
  (`test_migrations.py::test_ac4_autogenerate_sees_no_diff_with_postgis_extensions` stays green).
- `api/app/services/applications.py` `set_applicant_status`: when the UPDATE returned a row and the target is
  `shortlisted`, in the **same transaction** before the commit: `insert(Conversation).values(application_id=
  application.id, owner_id=owner.id, seeker_id=application.seeker_id, owner_read_at=func.now())
  .on_conflict_do_nothing(index_elements=["application_id"])`. A re-shortlist, an un-shortlist or a decline
  creates nothing (one conversation per application, ever; FOLLOWUPS `0004c` "shortlist side effects fire once
  per application"). The PATCH's response is unchanged.
- `api/app/schemas/chat.py` (new): `MessageIn`, `MessageOut`, `LastMessageOut`, `ConversationOut`, `ThreadOut`
  (see API). `Body` = `Annotated[str, BeforeValidator(_lf_newlines), Field(min_length=1, max_length=2000),
  AfterValidator(_visible_body)]` with `_visible_body(v) = visible_characters_only(v, allow_newlines=True,
  field="body")` — **no** `require_alnum` (an emoji-only "👍" or "?" is a valid chat message); `MessageIn` has
  `str_strip_whitespace=True, extra="ignore"` as `ApplicationIn`. `ApplicationListingOut` is reused from
  `schemas/application.py` for the listing summary.
- `api/app/services/chat.py` (new):
  - `list_conversations(db, me) -> Sequence[Row]`: **one** statement over `conversations c` where `c.owner_id =
    :me OR c.seeker_id = :me`, joined to `applications` (its `status` → `can_send`), `listings` (the summary
    columns) and `users` on the **other** participant (`CASE WHEN c.owner_id = :me THEN c.seeker_id ELSE
    c.owner_id END`), selecting `users.display_name` only; a `LATERAL` (or correlated) newest message (`left(body,
    120)`, `sender_id = :me`, `created_at`); a correlated `count(*)` of messages with `sender_id <> :me` and
    `created_at > my_read_at` (all of them when `my_read_at` is null), where `my_read_at` is `owner_read_at` or
    `seeker_read_at` by the caller's side. Order `coalesce(c.last_message_at, c.created_at) DESC,
    c.application_id`.
  - `get_thread(db, me, conversation_id) -> Thread`: (1) one statement for the header — the listing columns,
    `other_name` (as the list), `applications.status`, the caller's side (`c.owner_id = :me`), that side's read
    marker and `c.last_message_at`; no newest-message or unread subquery — `WHERE c.application_id = :id AND
    (c.owner_id = :me OR c.seeker_id = :me)`; no row → `ConversationNotFoundError`; (2) one statement for the newest `THREAD_LIMIT + 1` messages (`THREAD_LIMIT =
    200`) ordered `created_at DESC, id DESC`, reversed in Python, `truncated = len > THREAD_LIMIT` — `# shortcut:
    no paging, the 200 newest only; add a before-cursor when a thread passes ~200 messages`; (3) **only when**
    the caller's read marker is null or older than `c.last_message_at`: one `UPDATE conversations SET
    <my>_read_at = now() WHERE application_id = :id AND (<my>_read_at IS NULL OR <my>_read_at <
    last_message_at)`, then commit. A poll with nothing new runs no UPDATE (NF3).
  - `send_message(db, r, me, conversation_id, body) -> Message`: (1) `count_or_raise` on
    `rl:chat:user:{me.id}` (`CHAT_RATE_LIMIT_MINUTE = 20`, 60 s) and `rl:chat:user:day:{me.id}`
    (`CHAT_RATE_LIMIT_DAY = 300`, 86 400 s) — every authenticated, body-valid attempt counts, a refused one does
    not (as `apply`); (2) one `INSERT INTO messages (conversation_id, sender_id, body) SELECT c.application_id,
    :me, :body FROM conversations c JOIN applications a ON a.id = c.application_id WHERE c.application_id = :id
    AND (c.owner_id = :me OR c.seeker_id = :me) AND a.status = 'shortlisted' RETURNING …`; (3) no row → one
    `SELECT` with the same membership condition: none → `ConversationNotFoundError`, else `ChatClosedError`;
    (4) `UPDATE conversations SET last_message_at = greatest(last_message_at, :created_at), <my>_read_at =
    greatest(<my>_read_at, :created_at) WHERE application_id = :id` (`greatest` skips nulls; two sends
    committing out of order never move either value back). Commits; rolls back on any error.
  - Exceptions `ConversationNotFoundError`, `ChatClosedError` in `services/chat.py`.
- `api/app/routers/chat.py` (new, tag `chat`, thin, included in `main.py`): the three endpoints, `current_user`
  (either role); maps `ConversationNotFoundError` → 404 `not_found`, `ChatClosedError` → 409 `chat_closed`,
  `RateLimitedError` → 429 `rate_limited` with `Retry-After` (as `routers/applications.py`), with `responses=`
  entries for 401 / 404 / 409 / 429 (`ErrorOut`).
- Tests: `api/tests/test_chat.py` (new); `api/tests/test_migrations.py` (AC12); `api/tests/conftest.py`
  `signup` gains a keyword `display_name: str = "נועה"` (default unchanged, so every existing caller is
  untouched); `api/tests/test_inbox.py::test_ac4_status_transitions`: its measured 200 cell (a shortlist) now
  asserts 3 statements — the session lookup, the `UPDATE applications`, then `INSERT INTO conversations`
  (`sent[2]`); the measured 409 cell stays at 3 (it inserts nothing). Nothing else in `test_inbox.py` changes.
- `README.md`: one curl for sending a message under "Posting a listing locally".
- `specs/FOLLOWUPS.md`: the `0004c` · `PATCH …/applications/{application_id}` entry → `[x] … · done in 0005a:
  the only shortlist side effect is one conversation row per application (insert on conflict do nothing); no
  notifications exist, so toggling sends nothing`.

**Out:**
- Web: `0005b`. Notifications (email, push) on a new chat or message: Q3. The real-time event stream and its
  publish points: `0005c` (Q1).
- Chat from mutual interest (Slice 8), group chats (Slice 7/8 roommates), attachments and photos (`0002c` is
  not built), message edit / delete, typing indicators, read receipts shown to the other side.
- Report and block a user (Slice 10 "report button everywhere"); spam / scam text detection.
- A structured viewing proposal (Q5: `0005b` offers a template text only).
- Paging older messages beyond the newest 200 (the shortcut above).

**New dependencies:** none.

## Data
Migration `0006_chat`. Both tables are new; nothing existing changes, so the running app is unaffected
(backwards-compatible). `upgrade` then backfills, in one statement, the applications that are already
shortlisted (otherwise they could not chat until un-shortlisted and re-shortlisted): `INSERT INTO conversations
(application_id, owner_id, seeker_id, owner_read_at) SELECT a.id, l.owner_id, a.seeker_id, now() FROM
applications a JOIN listings l ON l.id = a.listing_id WHERE a.status = 'shortlisted'`. Downgrade drops
`messages`, then `conversations`.

`conversations` — one per application that was ever shortlisted (Q4: the conversation's id **is** the
application's id):
| column | type | notes |
| --- | --- | --- |
| `application_id` | uuid PK | FK `applications.id` `ON DELETE CASCADE` |
| `owner_id` | uuid not null | FK `users.id` `ON DELETE CASCADE`; the listing's owner at open time (listings never change owner) |
| `seeker_id` | uuid not null | FK `users.id` `ON DELETE CASCADE`; = `applications.seeker_id` |
| `owner_read_at` | timestamptz null | set to `now()` on open (the owner opened it) |
| `seeker_read_at` | timestamptz null | null = the seeker never opened it (`is_new`) |
| `last_message_at` | timestamptz null | the newest message's `created_at`; null = no messages |
| `created_at` | timestamptz not null default `now()` | |
Indexes `ix_conversations_owner_id (owner_id)`, `ix_conversations_seeker_id (seeker_id)`; CHECK
`ck_conversations_two_people` `owner_id <> seeker_id`.

`messages`:
| column | type | notes |
| --- | --- | --- |
| `id` | uuid PK default `gen_random_uuid()` | |
| `conversation_id` | uuid not null | FK `conversations.application_id` `ON DELETE CASCADE` |
| `sender_id` | uuid not null | FK `users.id` `ON DELETE CASCADE` (a deleted account takes its messages, as `applications`) |
| `body` | text not null | CHECK `ck_messages_body_length` `char_length(body) BETWEEN 1 AND 2000`; plain text, never HTML |
| `created_at` | timestamptz not null default `now()` | |
Index `ix_messages_conversation_created (conversation_id, created_at, id)` — serves the thread, the newest
message and the unread count.

## API
`ConversationOut`: `id` (the application id), `listing: ApplicationListingOut`, `other_name` (the other
participant's `display_name`), `can_send: bool` (the application is `shortlisted`), `is_new: bool` (the caller's
read marker is null), `unread_count: int`, `last_message: LastMessageOut | null`, `created_at`.
`LastMessageOut`: `body` (first 120 characters), `mine: bool`, `created_at`.
`ThreadOut`: `id`, `listing`, `other_name`, `can_send`, `messages: list[MessageOut]` (oldest first), `truncated:
bool`. `MessageOut`: `id`, `body`, `mine: bool`, `created_at`.
`MessageIn`: `body: Body` (required). No response carries a user id or an email (NF2): the sender is `mine`.

| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /me/conversations | session (`current_user`, either role); rows where the caller is `owner_id` or `seeker_id` (in the `WHERE`) | – | 200 `list[ConversationOut]`, latest activity first; `[]` when none | 401 `unauthenticated` · 503 |
| GET | /conversations/{conversation_id} | session **and** the caller is a participant (in the `WHERE`) | path `uuid` | 200 `ThreadOut`; marks the thread read for the caller; any application status | 401 · 404 `not_found` (unknown id, an application never shortlisted, someone else's conversation — identical bodies) · 422 non-uuid · 503 |
| POST | /conversations/{conversation_id}/messages | session **and** participant **and** the application is `shortlisted` (all in the `INSERT … SELECT`'s `WHERE`) | `MessageIn` | 201 `MessageOut` (`mine: true`) | 401 · 404 `not_found` (as above) · 409 `chat_closed` (application `submitted`, `declined` or `withdrawn`) · 422 (body, non-uuid) · 429 `rate_limited` + `Retry-After` · 503 |
| PATCH | /listings/{listing_id}/applications/{application_id} (changed, `0004c`) | unchanged | unchanged | unchanged; to `shortlisted` also opens the conversation once | unchanged |

When a chat can be sent to, by application status: `shortlisted` → yes; `submitted` (un-shortlisted, or
withdrawn and re-applied), `declined`, `withdrawn` → no (409), thread still readable by both (Q2). Re-shortlisting
a `submitted` application opens sending again on the same conversation.

## UI
None in this part. The chat screens are `0005b`.

## Acceptance criteria
Fixtures as `0004c`: `gush_dan`, `make_owner`, `make_listing`, `make_seeker`, `make_application`, `signup`,
`redis_clean`, `outbox`, the copied `statements` fixture. "Owner" O = `signup(client, outbox, "o@example.com",
"owner", display_name="Noa")`; seeker S = `signup(…, "s@example.com", "seeker", display_name="Dana")`, who
applied through `0004a`'s endpoint to O's listing A; O shortlists through `0004c`'s PATCH unless stated.
Conversation rows for bulk cases may be inserted by SQL. Non-ASCII test inputs are written as `\uXXXX` escapes
in the tests (and here).
- [ ] AC1 Given S's submitted application P on A, When O PATCHes P to `shortlisted`, Then one `conversations` row with `application_id = P`, `owner_id` O, `seeker_id` S, `owner_read_at` set, `seeker_read_at` and `last_message_at` null; When O un-shortlists, re-shortlists and shortlists again, Then still exactly one row with the same `created_at`; Given another application Q that O declines without shortlisting, Then no row for Q; the PATCH response bodies equal `0004c`'s (same key set); measured (after a warm-up request and `statements.clear()`), a PATCH from `submitted` to `shortlisted` executes exactly 3 statements (session, `UPDATE applications`, `INSERT INTO conversations`) and one to `submitted` or `declined` exactly 2 — `api/tests/test_chat.py::test_ac1_shortlist_opens_one_conversation`
- [ ] AC2 Given P shortlisted, When S `GET /me/conversations`, Then 200 with one item, key set exactly `{id, listing, other_name, can_send, is_new, unread_count, last_message, created_at}`, `id` = P, `other_name` `"Noa"`, `can_send` true, `is_new` true, `unread_count` 0, `last_message` null, `listing` key set as `ApplicationListingOut`'s; When O lists, Then the same item with `other_name` `"Dana"` and `is_new` false; neither body contains either email or any user id; Given a third user T (seeker) with no conversations, Then `[]`; T never sees P — `test_chat.py::test_ac2_list_conversations`
- [ ] AC3 Given O with conversations on three applications whose last messages (SQL) are 3 s, 1 s and 2 s old and a fourth with no messages created 5 s ago, When O lists, Then the order is 1 s, 2 s, 3 s, then the empty one; Given one last message of 300 characters, Then its `last_message.body` is its first 120 characters; `last_message.mine` is true on a message O sent and false on S's; Given S sent 3 messages after O's `owner_read_at` and 1 before, Then O's `unread_count` is 3 and S's own is 0; Given P's application set (SQL) to `submitted`, `declined`, `withdrawn` in turn, Then `can_send` is false each time and the conversation is still listed for both — `test_chat.py::test_ac3_order_preview_unread_can_send`
- [ ] AC4 Given O with 1 conversation and then with 6 (SQL), each with messages, When O lists (after one warm-up request and `statements.clear()`), Then each measured request executes exactly 2 `before_cursor_execute` statements (session lookup, one containing `FROM conversations`) — `test_chat.py::test_ac4_list_is_two_statements`
- [ ] AC5 Given P with messages m1 (S), m2 (O), m3 (S) 1 s apart, When S `GET /conversations/{P}`, Then 200, key set exactly `{id, listing, other_name, can_send, messages, truncated}`, messages oldest first, each key set exactly `{id, body, mine, created_at}`, `mine` false/true/false for S (true/false/true for O), `truncated` false; afterwards S's list shows `is_new` false and `unread_count` 0 while O's `unread_count` is unchanged; measured (after a warm-up request and `statements.clear()`): the first GET after a new message executes exactly 4 statements (session, header, messages, one `UPDATE conversations`), a repeat GET with nothing new exactly 3 and no `UPDATE` — `test_chat.py::test_ac5_thread_reads_and_marks_read`
- [ ] AC6 Given P with 205 messages (SQL, 1 ms apart), When S reads it, Then the 200 newest, oldest first, `truncated` true; with exactly 200, `truncated` false — `test_chat.py::test_ac6_thread_is_capped_at_200`
- [ ] AC7 Given P, When `GET /conversations/{P}` and `POST /conversations/{P}/messages` with no cookie, Then 401; with T's cookie (a non-participant seeker) and with another owner's cookie, Then 404 `{"detail":"not_found"}` identical to a random uuid's, and no message row; Given S's application R to another listing of O that was never shortlisted, Then both calls on R → 404; `not-a-uuid` → 422 — `test_chat.py::test_ac7_participants_only`
- [ ] AC8 Given P, When S POSTs `{"body": "  \u05e9\u05dc\u05d5\u05dd  "}`, Then 201, key set exactly `{id, body, mine, created_at}`, `body` `"\u05e9\u05dc\u05d5\u05dd"`, `mine` true; P's `last_message_at` equals that `created_at`; O's list shows P first with `unread_count` 1 and `last_message.mine` false; S's shows `unread_count` 0; When O replies, Then S's `unread_count` is 1 — `test_chat.py::test_ac8_send_message`
- [ ] AC9 Given P open, When O un-shortlists P (PATCH to `submitted`), Then S's and O's POST → 409 `{"detail":"chat_closed"}`, no row, and `GET /conversations/{P}` still 200 with `can_send` false and the earlier messages; When O shortlists P again, Then POST → 201; When O declines P, Then 409 again; Given another shortlisted application W that its seeker withdraws (`0004a`'s endpoint), Then 409 for both sides — `test_chat.py::test_ac9_closed_after_unshortlist_decline_withdraw`
- [ ] AC10 Given P, When the body is `""`, `"   "`, missing, 2001 × `x`, `"hi\u202ethere"` (bidi override), `"\u200b\u200b"`, `"a\u3164b"` (Hangul filler) or `"\u05d0" + "\u05b8" * 5`, Then 422 and no row; `"\U0001f44d"` (emoji only) and `"?"` → 201; `"a\r\nb"` is stored as `"a\nb"`; an extra field is ignored — `test_chat.py::test_ac10_body_validation`
- [ ] AC11 Given S, When S sends 20 messages to P, Then 201 each; the 21st → 429 `{"detail":"rate_limited"}` with an integer `Retry-After` between 1 and 60 and no row; O can still send (201); Given S's day counter `rl:chat:user:day:{S}` set to 300 in Redis (and the minute counter cleared), Then 429 with `Retry-After` ≤ 86 400 — `test_chat.py::test_ac11_send_rate_limits`
- [ ] AC12 Given a fresh `_mig` database upgraded to `0005` with one area, one owner, two seekers, one listing and each seeker's application inserted by SQL (the second one `shortlisted`), When upgraded to `0006`, Then the shortlisted application has exactly one conversation (`owner_id` the listing's owner, `seeker_id` its seeker, `owner_read_at` set) and the submitted one none; both tables exist with `ck_conversations_two_people`, `ck_messages_body_length`, the three indexes and the FKs above; an INSERT of a 2001-character body fails; deleting the application cascades to its conversation and messages; When downgraded to `0005`, Then both tables are gone and the application row is intact — `test_migrations.py::test_ac12_chat_tables_up_and_down`
- [ ] NF1 `make lint` clean (ruff, mypy --strict); `make client` regenerates `web/src/api/schema.d.ts` with the three operations and the five schemas — CI `api` and `web` jobs
- [ ] NF2 Privacy: no chat response contains an email or a user id; the other participant is known by `display_name` only, and only to the two participants; `ConversationOut`, `ThreadOut` and `MessageOut` list their fields explicitly; no query loads the `User` entity; bodies are stored and returned as validated plain text — AC2/AC5/AC8 key sets + security reviewer
- [ ] NF3 Read cost: every pushed event (`0005c`) makes the two users' tabs refetch, so a repeat `GET /conversations/{id}` with nothing new is 3 statements and writes nothing (AC5), and the list is 2 statements whatever the number of conversations (AC4) — perf reviewer

## Tests to write
Integration (Postgres + Redis as `0004a`): AC1–AC11 in `test_chat.py`, AC12 in `test_migrations.py`. Rows via
`make_seeker` / `make_application`; bulk conversations and messages by SQL. `test_inbox.py`,
`test_applications.py`, `test_listings.py` pass unchanged. Unit: none. E2E: none (`0005b`).

## Risks / open questions
**Gilad 2026-11-11 (written into PRODUCT.md "Chat"):** Q1 — "think on a huge scale of users, choose the better
option": the orchestrator chose **push over server-sent events** (Redis pub/sub fan-out, `0005c`), not polling:
polling cost grows with users online × time, push only with messages sent; SSE over WebSockets because sending
stays a plain `POST` and SSE is plain HTTP (browser reconnect, HTTP/2, proxies). Q2 (a), Q3 (a), Q4 (a), Q5 (a).
The options as they were put to Gilad:
- **Q1 — How do new messages arrive?**
  (a) Polling: an open thread re-fetches every 5 s while the tab is visible, the chat list and header badge every
  60 s — **recommended**: no new service or connection type, works on any free host, ~1 request / 5 s per open
  thread (NF3 keeps it to 3 statements, no write).
  (b) Server-sent events over Redis pub/sub: instant, but long-lived connections on the free host and a second
  code path.
  (c) WebSockets: instant and two-way; the most code, and the same hosting question.
- **Q2 — What happens to an open chat when the owner un-shortlists or declines, or the seeker withdraws?**
  (a) The thread stays readable by both, sending is closed; a re-shortlist reopens it — **recommended**: no lost
  history, and "never one-sided" holds (chat is open exactly while shortlisted).
  (b) Once opened, a chat stays open whatever the status (only Slice 10's block would stop it).
  (c) The thread disappears for both.
- **Q3 — Notifications for chat?**
  (a) None in Slice 5: the header badge shows chats with something new (`0005b`); unread messages join the
  pre-launch daily digest email spec (PRODUCT.md "Applications") — **recommended**: no email quota risk, same
  line as Slice 4. Caveat: a shortlisted seeker learns of it only on their next visit.
  (b) One email to the seeker when a chat opens (shortlist), nothing per message.
  (c) An email per new message, throttled to one per conversation per hour.
- **Q4 — Data shape (Speed rule 9: Slice 8's mutual-interest chat depends on it).**
  (a) One conversation per application, its id **is** the application id, participants as `owner_id` /
  `seeker_id` — **recommended**: two tables, no new id for the inbox or "my applications" to carry; Slice 8
  (pre-launch, so no production data) adds its own source with one migration (a surrogate id and generic
  participant columns).
  (b) Generic now: `conversations(id, application_id null unique)` + `conversation_members(conversation_id,
  user_id, last_read_at)` + `messages` — Slice 8-ready, one more table and a join on every call.
- **Q5 — "הצעת סיור" (propose a viewing, `InboxDesktop.dc.html`).**
  (a) A chip in the composer that inserts an editable template text ("אשמח לתאם סיור בדירה. מתי נוח לך?");
  nothing new in the API — **recommended**, `0005b`.
  (b) Drop it; people arrange viewings in plain messages.
  (c) A structured proposal (date/time options, accept / decline) as its own spec.

**Assumptions (orchestrator, not Gilad calls):** message bodies 1–2000 characters, emoji-only allowed; send limits
20 per minute and 300 per day per user, counted per attempt; the seeker learns the owner's `display_name` inside
the chat only (not on "my applications"); exact address and phone numbers travel as message text, by the users'
choice; history is kept until an account is deleted (cascade); the thread shows the newest 200 messages.

**Technical risks the verifier should challenge:**
- **A message racing a status change:** the `INSERT … SELECT` checks `status = 'shortlisted'` in its own
  snapshot; a decline committing at the same instant can let one message land after it. Harmless (the owner sees
  it in a closed thread); no lock taken, by design.
- **Read marker = `now()`:** a message whose transaction started before the reader's `now()` but committed after
  it is never counted unread. Two people typing in the same instant; the open thread shows it on the next poll.
  Accepted.
- **`OR` membership on the list:** `owner_id = :me OR seeker_id = :me` uses both indexes (BitmapOr); a user has at
  most a few dozen conversations at MVP volume. AC4 pins the statement count, the perf reviewer checks the plan.
- **Two `<my>_read_at` columns picked by a `CASE`:** easy to swap sides. AC3/AC5/AC8 assert both participants'
  counts after every action.
- This branch starts from `main`; it touches `services/applications.py` (`set_applicant_status` only), which no
  open spec edits (`0004b` / `0004d` are web-only).

## Verifier findings — one round, 6 findings, all applied
1. (blocker) `test_inbox.py::test_ac4_status_transitions` asserts 2 statements on a shortlist PATCH; the new `INSERT INTO conversations` makes it 3 — Scope now edits that one assertion; AC1 pins 3 / 2 statements.
2. (blocker) `conftest.signup` hard-codes the display name, so O and S could not be told apart — `signup` gains a `display_name` keyword (default unchanged); the AC preamble uses it.
3. Applications already `shortlisted` when `0006` runs would get no chat — `upgrade` backfills them in one statement; AC12 checks it.
4. Scope named the migration test AC11; it is AC12.
5. `send_message` step 4 could move `last_message_at` back when two sends commit out of order — `greatest(…)` on both columns.
6. `get_thread`'s header needs no newest-message / unread subquery (named its columns); AC5 measures after a warm-up request, as AC4.
Verifier note: the coder runs on Opus/high (migration with backfill, chat is security work).

## Digest (filled by orchestrator after verification)

    Spec 0005a - Chat API: shortlisting opens a chat; list, read, send   (verified, part 1 of 3, depends on 0004c - merged)
    What a user can do after this: an owner who shortlists an applicant opens a one-to-one chat with that seeker; both
             see their chats (the other person's name, the listing, the last message, unread count), read a thread
             and send plain-text messages while the applicant stays shortlisted.
    Decisions (Gilad 2026-11-11): Q1 push, decided for scale by the orchestrator -> SSE over Redis pub/sub in 0005c;
             Q2 (a) readable, sending closed; Q3 (a) no notifications; Q4 (a) one chat per application; Q5 (a) chip.
    KPIs this slice moves: shortlist -> first message rate; time from shortlist to first reply.
    Acceptance targets: NF1 ruff + mypy --strict clean, client regenerated - NF2 no email or user id in any chat
             response - NF3 a repeat poll is 3 statements and writes nothing; the chat list is 2 statements.
    Risks: the shortlist PATCH now also writes a conversation - mitigation: insert-on-conflict-do-nothing in the same
             transaction (once per application), a backfill for already-shortlisted rows, one 0004c test assertion updated.
    Reviewers: code, qa, security, perf   Estimated: 1 coder run (Opus/high: migration + backfill), 1 review round
    Links: specs/0005a-chat-api.md - PRODUCT.md "Chat", "Applications", "Trust (MVP)" - design/screens-v1/Inbox.dc.html
