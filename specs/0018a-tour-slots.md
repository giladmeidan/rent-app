---
id: 0018a
title: "API: a lister opens tour times on a listing (apartment or room); a seeker they shortlisted books, moves or cancels a tour, the lister can cancel it, each change is a line in the chat, and cleanup cancels the tours involved"
status: in-review
depends_on: []   # 0018b, 0018c, 0018d and 0018e (this spec's web half, split by the verifier 2026-11-16) depend on this one (shared contract in specs/TOURS-PLAN.md)
reviewers: [code, security, qa]   # security: new gates on applications/listings, chat visibility (flatmates), admin grants, a new table holding a token hash; qa: 7 endpoints, 5 cleanup paths. No ux: no screen (0018e). No perf: ≤ 30 windows a listing, slots computed in Python, every query by primary key or a partial index
estimate: 1 coder run   # coder Opus/high (migration on `messages`, row locks, cleanup in 5 transactions). 7 endpoints is above the checklist's ~3, but 3 are plain owner CRUD and the contract fixes them in this spec
---

## Goal
After this ships a lister opens tour times on any of their live listings (apartment or room): a date, a start
and end time in Israel, and a slot length. A seeker whose application to that listing is **shortlisted** sees the
free slots in the chat thread and books one; the booking is final at once (the shortlist is the lister's
approval). The seeker can move it to another free slot or cancel it; the lister can cancel it. Every change is
a line in the conversation, pushed to both sides' open tabs. Pausing the listing, un-shortlisting, declining,
withdrawing, deleting an account, and homie hiding the listing or suspending an account cancel the upcoming
tours involved. This spec is the API; the screens are `0018e-tour-slots-web`. PRODUCT.md "Tours"; plan and
shared contract in `specs/TOURS-PLAN.md`.

## Decisions this spec builds on (Gilad, 2026-11-16; do not reopen)
1. Slots per listing, set by the lister; apartments and rooms; only the listing's owner manages them.
2. Only a seeker with a `shortlisted` application to the listing sees and books slots (a room `like` application
   is `shortlisted` from the start, 0010l, so it counts).
3. A booking is confirmed at once; a slot holds one seeker.
4. Either side cancels; the seeker reschedules to another free slot.
5. Each change is a system line in the chat. Flatmates see nothing of tours in v1 (no lines, no card).
6. Emails (0018c), the lister's tours page (0018b) and the calendar feed (0018d) are separate specs; this one
   provides the tables, the change hook and the after-commit hook they build on.

## Scope
**In (API):**
- Migration `api/alembic/versions/0030_tours.py` (`revision = "0030"`, `down_revision = "0029"`): every table,
  column, CHECK and index under Data, with a working `downgrade`.
- Models: `api/app/models/tour.py` (new: `TourWindow`, `Tour`, `TourFeed`), exported from
  `api/app/models/__init__.py`; `api/app/models/conversation.py::Message` gains `tour_id`, `tour_change`,
  `tour_starts_at`, `body` becomes `Mapped[str | None]`, the new CHECK in `__table_args__` (autogenerate must see no
  diff, as the module docstring requires).
- `api/app/services/tours.py` (new). Constants (comment: policy, PRODUCT.md "Tours"): `SLOT_MINUTES = (15, 20, 30,
  45)`, `WINDOW_MAX_HOURS = 12`, `HORIZON_DAYS = 30`, `LEAD_MINUTES = 60`, `MAX_UPCOMING_WINDOWS = 30`,
  `ISRAEL = zoneinfo.ZoneInfo("Asia/Jerusalem")`. Errors: `TourNotFoundError`, `ListingNotLiveError`,
  `WindowOverlapError`, `TooManyWindowsError`, `InvalidWindowError`, `WindowHasToursError`, `SlotUnavailableError`,
  `TourExistsError`, `TourNotCancellableError`. `@dataclass(frozen=True) TourChange(tour_id, application_id,
  listing_id, owner_id, seeker_id, actor_id, change, starts_at, previous_starts_at)` where `change` ∈
  `TourChangeKind = Literal["booked", "rescheduled", "cancelled_by_seeker", "cancelled_by_lister",
  "cancelled_by_system"]`. Functions (rules under API):
  - `list_windows(db, owner, listing_id)`, `create_window(db, owner, listing_id, data)`,
    `delete_window(db, owner, window_id)`;
  - `slots_for(db, seeker, application_id)`, `book(db, seeker, application_id, starts_at)`,
    `reschedule(db, seeker, tour_id, starts_at)`, `cancel(db, me, tour_id)`;
  - `current_tour(db, application_id)` (for the thread);
  - **the change hook** `record(db, changes: Sequence[TourChange]) -> None`: inside the caller's transaction,
    one `INSERT … SELECT` of the tour lines into `messages` (one row per change, `sender_id = actor_id`,
    `conversation_id = application_id`, `body = NULL`) and one `UPDATE conversations SET last_message_at =
    greatest(last_message_at, now())` for those conversations. Every booking, reschedule and cancel, the system
    cancels included, goes through it;
  - `cancel_upcoming(db, where, actor_id, by) -> list[TourChange]`: one `UPDATE tours SET status='cancelled',
    cancelled_by=:by, cancelled_at=now(), updated_at=now() WHERE status='booked' AND starts_at > now() AND <where>
    RETURNING …` joined to `listings` for `owner_id`, then `record`; the cleanup paths call it;
  - **the after-commit hook** `announce(r, changes) -> None`: `chat_events.publish(r, [owner_id, seeker_id],
    application_id, "message")` per change (never the flatmates). Never raises (as `publish`). 0018c adds its email
    enqueue here and nowhere else.
- `api/app/schemas/tours.py` (new; 0018b adds its agenda schemas here): `TourWindowIn`, `TourWindowOut`, `BookedSlotOut`, `TourWindowsOut`, `SlotOut`,
  `TourSlotsOut`, `TourOut`, `TourStartIn`.
- `api/app/routers/tours.py` (new, included in `api/app/main.py` as the others): the 7 endpoints under API.
- `api/app/limits.py`: `TOUR = Bucket("tour", 10, 20)` (comment: each booking, move or cancel is a chat line and,
  from 0018c, an email to the other side).
- Chat (`api/app/services/chat.py`, `api/app/schemas/chat.py`, `api/app/routers/chat.py`):
  - `TourLineOut(change: TourChangeKind, starts_at: dt.datetime)`; `MessageOut.body: str | None` (null exactly for
    a tour line) and `MessageOut.tour: TourLineOut | None`; `LastMessageOut` the same two changes; `ThreadOut.tour:
    TourOut | None` (the application's current tour, rules under API).
  - `list_statement`: the `newest` lateral and the `unread` count add `or_(Message.tour_change.is_(None),
    _is_party(me))`; `newest` selects `tour_change` and `tour_starts_at` (`left(body, …)` of a NULL is NULL).
  - `get_thread`: `messages_query` adds the same condition and selects `Message.tour_change`,
    `Message.tour_starts_at`; the thread's `tour` = `tours.current_tour(db, conversation_id)` when `my_role` is
    `owner` or `seeker` and the chat has an application, else `None` (one more SELECT by `ix_tours_application_id`;
    `test_flatmates.py::test_ac12_statement_counts` asserts 5/4 thread statements for owner, seeker and flatmate alike:
    it becomes 6/5 for owner and seeker, 5/4 for the flatmate; a direct chat runs no tour SELECT, so
    `test_direct_chat.py::test_ac7_statement_counts_and_plan` is unchanged).
  - `routers/chat.py::_conversation_out` and the thread builder fill the new fields. `send_message` is unchanged
    (a typed message always has a body).
- Cleanup (each in the existing transaction, before its commit, returning the changes; the router calls
  `tours.announce` after it):
  - `services/listings.py::update_listing`: when `patch.status == "paused"` and the locked row is `active`,
    `cancel_upcoming(db, Tour.listing_id == listing_id, actor_id=owner.id, by="system")`; it returns
    `tuple[Listing, list[TourChange]]` (its one caller, `routers/listings.py::update_listing`).
  - `services/applications.py::set_applicant_status`: when the status changed away from `shortlisted` (to
    `submitted` or `declined`), `cancel_upcoming(db, Tour.application_id == application_id, actor_id=owner.id,
    by="system")`; returns `tuple[Row, bool, list[TourChange]]` (its one caller in `routers/applications.py`).
  - `services/applications.py::withdraw`: always `cancel_upcoming(db, Tour.application_id == application.id,
    actor_id=seeker.id, by="system")` (a withdrawn seeker is no longer shortlisted; not named in the plan, see R4);
    returns `tuple[Application, Listing, list[TourChange]]`.
  - `services/accounts.py::delete_account`: a new step between 6 and 7, `cancel_upcoming(db, or_(Tour.seeker_id ==
    me, Tour.listing_id.in_(my_listings)), actor_id=me, by="system")`, and `delete(TourFeed).where(TourFeed.user_id ==
    me)` joins the step 7–11 tuple (contract); returns `list[TourChange]` (`[]` on the tombstone's early return);
    `routers/auth.py::delete_me` gains a `RedisDep` and calls `tours.announce` after it.
  - `api/admin/actions.py::hide_listings` and `suspend`: one `UPDATE tours … status='cancelled',
    cancelled_by='system'` of the upcoming booked tours (of those listings; of tours whose seeker or listing owner
    is suspended), in the same transaction, **no** chat line and no announce (the admin app imports nothing from
    `app.services`; R6). `api/scripts/admin_role.py`: `("tours", ("status", "cancelled_by", "cancelled_at",
    "updated_at"))` in `_COLUMN_GRANTS`, `"tour_feeds"` in `_NO_ACCESS`.
  - `api/admin/actions.py::read_chat` (reported chats): `ChatMessage.body` stays `str`; the SELECT reads
    `coalesce(Message.body, 'Tour ' || replace(Message.tour_change, '_', ' ') || ': ' ||
    to_char(timezone('Asia/Jerusalem', Message.tour_starts_at), 'YYYY-MM-DD HH24:MI'))`, so a tour line reads e.g.
    "Tour cancelled by lister: 2026-11-18 18:20" (the admin is English, PRODUCT.md "Admin"); `templates/chat.html`
    unchanged.
- Tests: `api/tests/test_tours.py` (new) and the updates the ACs name in `test_hardening.py`, `test_chat.py`,
  `test_flatmates.py` (AC14 and the `test_ac12_statement_counts` thread counts), `test_applications.py`,
  `test_listings.py`, `test_account_deletion.py` (AC12 and `test_nf1_failure_rolls_back_everything`'s call),
  `test_admin.py`, `test_admin_isolation.py`, `test_migrations.py`.

**In (web, compile only; the screens are `0018e-tour-slots-web`):**
- `make client`; CI regenerates the client from this API, so `make lint`'s `tsc` must pass on this branch with the
  web unchanged in behaviour: add `tour: null` to every literal `ThreadOut`, `MessageOut` and `LastMessageOut` in
  `web/src/features/chat/__tests__/fixtures.ts`, `chat/__tests__/harness.tsx`, `ChatListPage.test.tsx`,
  `ChatLayout.test.tsx`, `ChatThreadPage.test.tsx`, `web/e2e/screens/fixtures-chat.ts`, `chat.screens.ts`,
  `market-people.screens.ts`, and fix only what `tsc` reports for `body: string | null`
  (`ConversationsPane.tsx:108`, `ChatThreadPage.tsx:80` render it as is). No new key, component or route.

**Out:**
- Emails, `.ics`, reminders (0018c); the cross-listing agenda `/tours` and any header badge (0018b); the iCal feed
  and everything that writes `tour_feeds` (0018d; this spec only creates the table).
- Group tours / several seekers per slot; recurring windows ("every Tuesday"); editing a window (delete and add);
  flatmates seeing or managing tours; a lister booking on a seeker's behalf; Google Calendar sync.
- Retention of `tours` rows and the privacy text (0018c; until then tours go only with their listing, application
  or account by cascade).
- The composer's "הצעת סיור" chip stays as it is (R8).
- Every screen, card, dialog, route and i18n key: `0018e-tour-slots-web` (depends_on 0018a).
- Cancelling on expiry (R3).

**New dependencies:** `tzdata` (PyPI, the IANA database; already in `api/uv.lock` as a Windows-only transitive)
becomes a direct dependency in `api/pyproject.toml`: `zoneinfo` is stdlib but needs the database, and the API image
(`uv:…-python3.12-trixie-slim`, `infra/Dockerfile.api`) does not ship Debian's `tzdata`; the PyPI package gives the
container and the Mac CI runner the same rules.

## Data
Migration `0030_tours` (head `0029` → `0030`; `0015b` is done and used `0027`, no other open spec adds an Alembic
revision).

**`tour_windows`**
| column | type | notes |
| --- | --- | --- |
| `id` | uuid PK | `gen_random_uuid()` |
| `listing_id` | uuid NOT NULL | FK `listings.id` ON DELETE CASCADE |
| `starts_at`, `ends_at` | timestamptz NOT NULL | |
| `slot_minutes` | integer NOT NULL | |
| `created_at` | timestamptz NOT NULL | `now()` |

CHECKs: `ck_tour_windows_slot_minutes` `slot_minutes IN (15, 20, 30, 45)`; `ck_tour_windows_range` `ends_at >
starts_at AND ends_at - starts_at <= interval '12 hours'`; `ck_tour_windows_whole_slots` `(extract(epoch FROM ends_at
- starts_at)::integer % (slot_minutes * 60)) = 0`. Index `ix_tour_windows_listing_id_ends_at (listing_id, ends_at)`.
No overlap constraint (that needs `btree_gist`): the service checks overlap under the listing's row lock.

**`tours`**
| column | type | notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `listing_id` | uuid NOT NULL | FK `listings.id` ON DELETE CASCADE |
| `application_id` | uuid NOT NULL | FK `applications.id` ON DELETE CASCADE |
| `seeker_id` | uuid NOT NULL | FK `users.id` ON DELETE CASCADE |
| `starts_at`, `ends_at` | timestamptz NOT NULL | `ends_at = starts_at + slot_minutes` at booking |
| `status` | text NOT NULL | default `'booked'` |
| `cancelled_by` | text NULL | |
| `cancelled_at` | timestamptz NULL | |
| `reminder_sent_at` | timestamptz NULL | written by 0018c only; a reschedule sets it back to NULL |
| `created_at`, `updated_at` | timestamptz NOT NULL | `now()` |

`updated_at` moves **only** on book, reschedule and cancel (contract: 0018c's `.ics` SEQUENCE): the model has
`server_default=func.now()` and **no** `onupdate`; every write path here (book, reschedule, cancel,
`cancel_upcoming`, the admin cancels) sets it explicitly, and 0018c's `reminder_sent_at` write must not.

CHECKs: `ck_tours_status` `status IN ('booked', 'cancelled')`; `ck_tours_cancelled` `(status = 'booked' AND
cancelled_by IS NULL AND cancelled_at IS NULL) OR (status = 'cancelled' AND cancelled_by IN ('seeker', 'lister',
'system') AND cancelled_at IS NOT NULL)`; `ck_tours_range` `ends_at > starts_at`. Indexes:
`uq_tours_listing_slot` UNIQUE `(listing_id, starts_at) WHERE status = 'booked'` (never two booked tours on one
slot; also serves 0018b's per-listing agenda); `ix_tours_application_id (application_id)`; `ix_tours_seeker_id
(seeker_id) WHERE status = 'booked'` (contract; 0018b's seeker side, account deletion); `ix_tours_booked_starts_at (starts_at) WHERE status = 'booked'` (0018c's reminder scan). "At most one
upcoming booked tour per application" is a service rule under the application's row lock, not an index: a past
`booked` tour must not block a second tour later.

**`tour_feeds`** (used by 0018d): `user_id` uuid PK FK `users.id` ON DELETE CASCADE, `token_hash` text NOT NULL
(`uq_tour_feeds_token_hash` UNIQUE; the sha256 hex of `services/auth.py::_token_hash`, as `sessions.token_hash` and
`listings.flatmate_invite_hash`), `created_at` timestamptz NOT NULL `now()`. Never a raw token. 0018d owns its
rules; this spec's `delete_account` already deletes the row (contract: a tombstone never fires the cascade).

**`messages`** (changed): `body` becomes NULLable; new `tour_id` uuid NULL FK `tours.id` ON DELETE CASCADE
(`fk_messages_tour_id`), `tour_change` text NULL, `tour_starts_at` timestamptz NULL. New CHECK `ck_messages_kind`:
`(tour_change IS NULL AND body IS NOT NULL AND tour_id IS NULL AND tour_starts_at IS NULL) OR (tour_change IN
('booked', 'rescheduled', 'cancelled_by_seeker', 'cancelled_by_lister', 'cancelled_by_system') AND body IS NULL AND
tour_id IS NOT NULL AND tour_starts_at IS NOT NULL)`. `ck_messages_body_length` stays (NULL passes it). Partial index
`ix_messages_tour_id (tour_id) WHERE tour_id IS NOT NULL` (the cascade from `tours`). `tour_starts_at` is the
snapshot the line shows (a reschedule moves the tour row, not old lines).

**Downgrade:** `DELETE FROM messages WHERE tour_change IS NOT NULL`, drop `ck_messages_kind`, the index and the three
columns, `body` back to NOT NULL, drop `tour_feeds`, `tours`, `tour_windows`.

Backwards-compatible: existing messages satisfy `ck_messages_kind` (body NOT NULL until now). Between this spec's
merge and 0018e's, `main`'s web ignores `tour` and would show a tour line as an empty bubble; none exists, because
nothing books without 0018e's picker, and production is not deployed yet (`0013a` open).

## API
All times in responses are ISO-8601 UTC. Every write's first statement is `limits.check(r, user.id, …)` (bucket in
the table). Every 404 body is `{"detail": "not_found"}`, byte-identical for "unknown" and "not yours".

| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/listings/{listing_id}/tour-windows` | Signed in; the listing's owner (`owner_id` in the WHERE) | — | 200 `TourWindowsOut` | 401; 404; 422 malformed id |
| POST | `/listings/{listing_id}/tour-windows` | Owner, as above. `WRITE` | `TourWindowIn` | 201 `TourWindowOut` | 401; 404; 409 `listing_not_live`, `window_overlap`, `too_many_windows`; 422 `invalid_window` or FastAPI's list; 429 |
| DELETE | `/tour-windows/{window_id}` | Owner of the window's listing (joined in the WHERE). `WRITE` | — | 204 | 401; 404; 409 `window_has_tours`; 429 |
| GET | `/applications/{application_id}/tour-slots` | Signed in; the application's seeker (`seeker_id` in the WHERE) and `status = 'shortlisted'` | — | 200 `TourSlotsOut` | 401; 404 (unknown, another's, not shortlisted); 422 |
| POST | `/applications/{application_id}/tour` | As tour-slots. `WRITE` + `TOUR` | `TourStartIn` | 201 `TourOut` | 401; 404; 409 `listing_not_live`, `tour_exists`, `slot_unavailable`; 422; 429 |
| POST | `/tours/{tour_id}/reschedule` | The tour's seeker, whose application is `shortlisted`. `WRITE` + `TOUR` | `TourStartIn` | 200 `TourOut` | 401; 404; 409 `listing_not_live`, `tour_not_cancellable`, `slot_unavailable`; 422; 429 |
| POST | `/tours/{tour_id}/cancel` | The tour's seeker or the listing's owner. `WRITE` + `TOUR` | — | 200 `TourOut` | 401; 404; 409 `tour_not_cancellable`; 429 |

**Schemas** (`model_config = ConfigDict(extra="forbid")` on inputs):
- `TourWindowIn`: `date: dt.date`, `start: dt.time`, `end: dt.time`, `slot_minutes: Literal[15, 20, 30, 45]` — Israeli
  wall time. The schema only types the fields (a wrong type or `slot_minutes` value is FastAPI's 422 list); the
  window rules are `create_window`'s and raise `InvalidWindowError` → 422 `{"detail": "invalid_window"}` (rule 1).
- `TourWindowOut`: `id`, `starts_at`, `ends_at`, `slot_minutes`, `booked: list[BookedSlotOut]` (the window's upcoming
  booked tours by `starts_at`). `BookedSlotOut`: `tour_id`, `starts_at`, `seeker_name: str | None` (null = deleted),
  `conversation_id` (= application id).
- `TourWindowsOut`: `listing_live: bool`, `windows: list[TourWindowOut]` (windows with `ends_at > now()`, by
  `starts_at`).
- `SlotOut`: `starts_at`, `ends_at`. `TourSlotsOut`: `listing_live: bool`, `slots: list[SlotOut]`, `tour: TourOut |
  None` (the application's current tour).
- `TourOut`: `id`, `starts_at`, `ends_at`, `status: Literal["booked", "cancelled"]`.
- `TourStartIn`: `starts_at: dt.datetime` (timezone-aware; naive → 422 FastAPI).

**Definitions** (all with the database's `now()`):
- *Live listing*: `status = 'active' AND expires_at > now() AND removed_at IS NULL` and
  `visibility.owner_not_suspended()`.
- *Free slot* of a listing: `w.starts_at + k * slot_minutes` for each upcoming window `w` and `k ≥ 0` with
  `start + slot ≤ w.ends_at`, `start ≥ now() + LEAD_MINUTES`, and no `booked` tour of the listing at `start`.
  Computed in Python from ≤ `MAX_UPCOMING_WINDOWS` rows plus one SELECT of the listing's booked upcoming tours
  (`uq_tours_listing_slot`).
- *Current tour* of an application: its `booked` tour with `ends_at > now()` (at most one, by the booking rule),
  else NULL.

**Rules**
1. `create_window`: first the shape checks, before any query (so they answer 422 ahead of 404, rule 8): `start`/`end`
   have seconds and microseconds 0 and minutes divisible by 5; `end > start` (same day; no window past midnight);
   `end - start ≤ 12 h` and a whole number of slots (≥ 1); else `InvalidWindowError`. Then lock the listing row
   (`SELECT … FOR UPDATE` with `owner_id` in the WHERE; none → 404). Not live → `ListingNotLiveError`. Convert `date` + `start`/`end` with `ISRAEL` to aware datetimes; a wall time that does
   not exist (the spring-forward hour) or is ambiguous (the autumn hour) → `InvalidWindowError` (round-trip check
   with `fold`). `starts_at < now()` or `starts_at > now() + HORIZON_DAYS` → `InvalidWindowError`. An upcoming window
   of the listing with `starts_at < :ends_at AND ends_at > :starts_at` → `WindowOverlapError`. `MAX_UPCOMING_WINDOWS`
   upcoming windows already → `TooManyWindowsError`. Insert, commit, 201.
2. `delete_window`: lock the window's listing row (join on owner; none → 404). A `booked` tour of the listing with
   `starts_at > now()` inside `[window.starts_at, window.ends_at)` → `WindowHasToursError`. Delete, commit, 204. A
   past or empty window deletes freely.
3. `slots_for`: the application (by id and `seeker_id`, `status = 'shortlisted'`; none → 404). `listing_live` per the
   definition; not live → `slots = []` (the current tour is still returned). Slots only from windows starting before
   `now() + HORIZON_DAYS`.
4. `book`: lock the listing row `FOR UPDATE` (serialises every booking and window change of one listing), then the
   application row `FOR UPDATE` by id, `seeker_id` and `status = 'shortlisted'` (none → 404). Order: listing, then
   application (R5). Not live → `ListingNotLiveError`. A current tour exists → `TourExistsError` (the web offers
   reschedule). `starts_at` is not a free slot (the definition, exact instant) → `SlotUnavailableError`. Insert the
   tour (`ends_at = starts_at + slot_minutes` of its window), `record([booked])`, commit; an `IntegrityError` on
   `uq_tours_listing_slot` → rollback, `SlotUnavailableError`. The router calls `announce` after the commit. 201.
5. `reschedule`: lock the tour's listing row (by `listings.id = (SELECT listing_id FROM tours WHERE id = :tour_id)`),
   then the tour row joined to its application (`seeker_id = me`, application `shortlisted`; none → 404) with
   `with_for_update(of=Tour)`: locking the application too would take tour and application in plan order and can
   deadlock with `set_applicant_status` (application, then tours). Not `booked` or `starts_at ≤ now()` → `TourNotCancellableError`. Not live
   → `ListingNotLiveError`. New `starts_at` not a free slot (its own current slot is not free) →
   `SlotUnavailableError`. Update `starts_at`, `ends_at`, `reminder_sent_at = NULL`, `updated_at`;
   `record([rescheduled])` with `previous_starts_at`; commit (unique violation → `SlotUnavailableError`). 200.
6. `cancel`: the tour joined to its listing where `seeker_id = me OR listings.owner_id = me`, locked
   `with_for_update(of=Tour)` only (none → 404; a flatmate gets 404): cancel needs no listing lock, and taking it
   here (tour, listing in plan order) could deadlock with `reschedule` (listing, then tour). Not `booked` or `starts_at ≤ now()` → `TourNotCancellableError`. `cancelled_by` = `seeker`
   or `lister` by the caller's side; set `cancelled_at` and `updated_at` to `now()`; `record([cancelled_by_seeker |
   cancelled_by_lister])`; commit. 200. Cancel does
   not need a live listing or a shortlisted application (those already cancelled it) or the TOUR window semantics.
7. A cancelled tour's slot is free again at once.
8. Error order for every route: 401 → 422 (malformed id / body) → 429 → 404 → 409.

**Chat (spec 0005a changes)**
- A tour line is a `messages` row with `tour_change` set; its sender is `actor_id` (for a system cancel: the person
  whose action caused it, a deleted account for `DELETE /me`). It counts as unread for the other party (`sender_id
  != me`), moves `last_message_at`, and is pushed as a `message` event to the owner and the seeker only.
- **Flatmates** never see a tour line: not in the thread, not as the list's newest message, not in the unread count
  (the `or_(tour_change IS NULL, _is_party(me))` condition on all three). `ThreadOut.tour` is null for a flatmate.
  `last_message_at` still moves for them (the list order may move without a visible message; harmless, R7).
- `ThreadOut.tour` is the current tour for the owner and the seeker of an application chat; null in a direct chat.

## UI
None in this spec: the tour-times page, the thread card, the slot picker, the tour line's rendering and every i18n
key are `specs/0018e-tour-slots-web.md`. This spec only keeps the web compiling (Scope, "In (web, compile only)").

## Acceptance criteria
API (`api/tests/test_tours.py` unless named):
- [ ] AC1 Given a live listing, when its owner POSTs a window (Israeli date, 18:00–20:00, 20 min), then 201 with UTC
  `starts_at`/`ends_at` matching Asia/Jerusalem (winter +02, summer +03), and GET lists it with 6 free slots —
  `test_ac1_owner_opens_window_in_israel_time`
- [ ] AC2 Windows are refused: not the owner / unknown → identical 404; paused, expired, removed listing or suspended
  owner → 409 `listing_not_live`; overlapping → 409 `window_overlap`; 31st upcoming → 409 `too_many_windows`; past,
  >30 days, end ≤ start, >12 h, not whole slots, a minute not divisible by 5, a nonexistent DST wall time → 422
  `invalid_window` — `test_ac2_window_rules`
- [ ] AC3 A shortlisted seeker GETs tour-slots: free slots only (booked, before now+60 min and past ones absent);
  submitted, declined, withdrawn, another seeker's or an unknown application → identical 404; a non-live listing →
  `listing_live: false, slots: []` — `test_ac3_slots_for_shortlisted_seeker_only`
- [ ] AC4 Booking a free slot → 201, the tour is `booked`, a `booked` tour line is in the thread for owner and seeker,
  a `message` event is published to exactly those two — `test_ac4_book_writes_line_and_event`
- [ ] AC5 Booking refused: a taken slot, a time between slots, outside every window → 409 `slot_unavailable`; a second
  booking with a current tour → 409 `tour_exists`; non-live listing → 409 `listing_not_live` —
  `test_ac5_book_refusals`
- [ ] AC6 Two seekers booking the same slot concurrently (two sessions, threads) → exactly one 201, the other 409
  `slot_unavailable`; one seeker booking two slots concurrently → one tour — `test_ac6_concurrent_bookings`
- [ ] AC7 Reschedule moves the same tour row to a free slot, clears `reminder_sent_at`, frees the old slot, writes a
  `rescheduled` line with the new time; the lister or a flatmate rescheduling → 404 —
  `test_ac7_reschedule_by_seeker_only`
- [ ] AC8 Cancel by the seeker and by the owner → 200, `cancelled_by` `seeker`/`lister`, the slot is free again, the
  line names the canceller; a flatmate → 404; an already cancelled or started tour → 409 `tour_not_cancellable` —
  `test_ac8_cancel_either_side`
- [ ] AC9 Deleting a window with an upcoming booked tour → 409 `window_has_tours`; with none, or only past tours →
  204 — `test_ac9_delete_window`
- [ ] AC10 Pausing the listing (PATCH `status: paused`) cancels its upcoming tours (`system`, line, event); a field
  edit does not — `api/tests/test_listings.py::test_ac10_pause_cancels_tours`
- [ ] AC11 Un-shortlisting, declining and withdrawing cancel that application's upcoming tour (`system`, line) —
  `api/tests/test_applications.py::test_ac11_status_change_cancels_tour`
- [ ] AC12 `DELETE /me` of the seeker and of the lister cancels their upcoming tours (`system`); past tours stay
  `booked`; the account's `tour_feeds` row is gone —
  `api/tests/test_account_deletion.py::test_ac12_deletion_cancels_tours`
- [ ] AC13 Admin `hide_listings` and `suspend` cancel the upcoming tours involved, with no chat line, as the
  `homie_admin` role — `api/tests/test_admin.py::test_ac13_admin_actions_cancel_tours`; the role can UPDATE only
  those four `tours` columns and cannot read `tour_feeds` — `api/tests/test_admin_isolation.py::test_ac13_tour_grants`;
  a reported chat with a tour line shows it as "Tour …: <Israel time>" in `read_chat` —
  `api/tests/test_admin.py::test_ac13_read_chat_shows_tour_lines`
- [ ] AC14 A flatmate of a room never sees a tour line (thread, list newest, unread count) or `ThreadOut.tour`; the
  owner and the seeker do — `api/tests/test_flatmates.py::test_ac14_flatmates_see_no_tours`
- [ ] AC15 `ThreadOut.tour` is the current tour for owner and seeker; null after it ends or is cancelled; null in a
  direct chat — `api/tests/test_chat.py::test_ac15_thread_current_tour`
- [ ] AC16 Every new write route is in `LIMITED` with its buckets (`WRITE`; `WRITE` + `TOUR` for the three tour
  writes) and 429s — `api/tests/test_hardening.py` (the AC1 registry and AC2 parametrisation, updated)
- [ ] AC17 Migration `0030` upgrades and downgrades cleanly with tour lines present, and autogenerate shows no diff —
  `api/tests/test_migrations.py` (existing round-trip test covers it; add a tour line before the downgrade)
- [ ] AC18 `ck_messages_kind` refuses a message with both or neither of `body`/`tour_change`, and
  `ck_tours_cancelled` a cancelled tour without `cancelled_by` — `test_ac18_checks`

- [ ] NF1 Statement counts, after the session lookup and with the same count for 1 and for 5 windows / tours:
  `GET …/tour-windows` ≤ 3 (listing, windows, their booked tours); `GET …/tour-slots` ≤ 3 (application + listing
  liveness, windows, booked tours); each write ≤ 8 (locks, checks, the write, `record`'s two statements) —
  `test_tours.py::test_nf1_statement_counts` (statement counter as `test_direct_chat.py::test_ac7`)

## Tests to write
Unit: window validation and DST conversion (`create_window`'s shape checks and round-trip), slot computation (pure
function `_slots(windows, booked, now)`). Web: none here (0018e). Integration: AC1–AC18 against Postgres;
AC6 with two DB sessions and threads, as the cap race test in `test_listings.py`. E2E (smoke, CI only): none in this
spec — the flow needs two signed-in accounts and a shortlist, which costs 2 OTP codes in a shard already near its
budget (HANDOFF "e2e OTP budget"); the verifier accepts none for 0018a and 0018e (R10).

## Blast radius
From `graphify affected` (main, 2026-11-16; re-run by the verifier) plus grep:
- `services/applications.py::set_applicant_status` → `routers/applications.py:277` (only caller).
- `services/applications.py::withdraw` → `routers/applications.py:177` (only caller).
- `services/listings.py::update_listing` → `routers/listings.py:140` (only caller).
- `services/accounts.py::delete_account` → `routers/auth.py:270` (`delete_me`), `tests/test_account_deletion.py:947`
  (`test_nf1_failure_rolls_back_everything` calls it directly: update for the new return value).
- `services/chat.py::list_statement` → `list_conversations` (`services/chat.py:287`, `routers/chat.py:92`),
  `tests/test_direct_chat.py::test_ac7_statement_counts_and_plan`, `tests/test_flatmates.py::
  test_ac12_list_uses_indexes_for_every_role` (plan asserts: assert indexes used, not node shapes — HANDOFF).
- `services/chat.py::get_thread` → `routers/chat.py:102`; `tests/test_flatmates.py::test_ac12_statement_counts`
  (thread counts +1 for owner and seeker, Scope); `tests/test_direct_chat.py::test_ac7_statement_counts_and_plan`
  (untouched: no tour SELECT in a direct chat).
- `schemas/chat.py::LastMessageOut` → `routers/chat.py::_conversation_out`; `ThreadOut` → `routers/chat.py:100`.
- `schemas/chat.py::MessageOut` → `routers/chat.py::get_thread` (L121) and `send_message` (L156: always a body).
- `models/conversation.py::Message` (`body` becomes `str | None`) → readers of `Message.body`: `services/chat.py`
  (`list_statement`, `get_thread`), `routers/chat.py:123,170`, `api/admin/actions.py::read_chat` +
  `ChatMessage` (Scope: coalesce), `api/scripts/seed_demo.py` (writes bodies: untouched); every other importer
  (`models/__init__.py`, `alembic/env.py`, `test_migrations.py`, the tests' `_message` helpers) only inserts typed
  messages: untouched.
- Web `ThreadOut` / `MessageOut` / `LastMessageOut` (generated) → `ChatThreadPage.tsx`, `ConversationsPane.tsx`,
  `Composer.tsx`, `useSendMessage.ts`, `chat/__tests__/fixtures.ts`, `chat/__tests__/harness.tsx`,
  `ChatLayout.test.tsx`, `ChatThreadPage.test.tsx`, `ChatListPage.test.tsx`, `ChatStreamProvider.test.tsx`,
  `web/e2e/screens/chat.screens.ts`, `fixtures-chat.ts`, `market-people.screens.ts`: compile fixes here (Scope),
  behaviour in 0018e.
- `api/admin/actions.py::hide_listings`, `suspend` → `api/admin/views.py:163,176,243,284` (return value unchanged:
  untouched), `tests/test_admin.py::test_nf5_action_and_log_are_one_transaction`.
- `api/scripts/admin_role.py::_COLUMN_GRANTS`, `_NO_ACCESS` → `tests/test_admin_isolation.py`; HANDOFF Next Steps 3
  (re-apply the admin role grants after this migration).
- `app/limits.py` registry → `tests/test_hardening.py::LIMITED`.

## Risks / open questions
- **R1 Size.** Resolved by the verifier: split into this spec (API, Opus/high) and `0018e-tour-slots-web` (web,
  Sonnet/medium, depends_on 0018a; branches from this spec's PR, Speed rule 3).
- **R2 Contract: the change hook is two functions.** The plan says "one function that 0018c extends to enqueue the
  email job". Writes must happen in the caller's transaction, but events (and 0018c's job enqueue) must happen after
  the commit (`chat_events.publish`'s rule), so this spec defines `record` (in-transaction, the only writer of tour
  lines) and `announce` (after commit, the only place 0018c adds its enqueue). The services return
  `list[TourChange]` so the routers can announce. Alternative for 0018c: treat tour lines as an outbox (a worker scans
  new `tour_change` messages), which needs no router plumbing; 0018c's choice.
- **R3 Contract: expiry does not cancel.** The plan lists expiry among the cancelling events, but expiry has no write
  (a listing passes `expires_at` silently) and the chat stays open after it. This spec: an expired listing is not
  live, so no new windows and no new bookings or reschedules; already booked tours stay and can be cancelled by
  either side. A sweeping job to cancel them would surprise a lister who renews within the week. **Gilad/orchestrator:
  confirm, or ask for a nightly job.**
- **R4 Withdraw also cancels.** Not in the plan's list, but a withdrawn seeker is no longer shortlisted; leaving their
  tour booked would block the slot. Included.
- **R5 Locks.** Booking locks listing → application; reschedule listing → tour (`OF tours`); cancel tour only;
  window create/delete the listing; `update_listing` listing (→ user on resume, unchanged) then tours;
  `set_applicant_status` application then tours; `delete_account` user → own listings → own applications → tours;
  `record` then the conversations. Verifier (2026-11-16): no cycle once reschedule and cancel lock `OF tours` only
  (Rules 5–6); a set_applicant_status racing a booking either sees the new tour in `cancel_upcoming`'s fresh
  snapshot or makes the booking's `shortlisted` lock come back empty (404).
- **R6 Admin cancels silently.** `hide_listings` / `suspend` cancel tours with no chat line and no email (the admin
  app does not import `app.services`, and a hidden listing is usually abuse). The seeker sees the card disappear on
  the next refetch. Alternative: a line `cancelled_by_system` written by the admin action (needs INSERT on
  `messages` for `homie_admin`). Recommendation: silent, as here. Note for Gilad: PRODUCT.md "Tours" says "each
  change is a system line in the chat plus an **email**"; silent admin cancels are the one exception (and 0018c's
  emails, sent from `announce`, skip them too).
- **R7 Flatmates and `last_message_at`.** A tour line moves the conversation's `last_message_at`, so a flatmate's list
  may reorder with no visible new message. Cheaper alternative to the three party filters: let flatmates see tour
  lines (they live there). That changes Gilad's Q4 default ("flatmates see nothing"); kept as decided.
- **R8 The "הצעת סיור" chip** (0005b, `Composer.tsx`) still inserts free text. Once a slot picker exists the chip may
  be redundant; left unchanged, a UX follow-up for Gilad.
- **R9 Migration number.** Resolved: `0015b` is done (0027); `0030` is free.
- **R10 E2E.** Verifier: none in 0018a or 0018e (OTP budget); Vitest + the API tests cover the flow.
- **R11 Timezone source.** Windows are sent as Israeli wall time and converted on the server with `zoneinfo`; the
  plan says "API speaks ISO-8601 UTC". Responses and booking inputs are UTC ISO; only the window input is local, to
  keep DST correct without date maths in the browser. `tzdata` is now a named dependency (Scope).
- **R12 Policy numbers** (Gilad may change; defaults): 60-minute lead time, 30-day horizon, 30 upcoming windows per
  listing, 12-hour window, 10 tour changes an hour / 20 a day per account (Gilad 2026-11-16).

## Verifier findings (2026-11-16, one round)
Fixed in this spec: split off `0018e-tour-slots-web` (web screens, ACs, i18n, UI) and kept a compile-only web step
here (CI regenerates the client); `schemas/tours.py` (0018b's name); `ix_tours_seeker_id` partial on `booked`
(contract); `tour_feeds.token_hash` `text` sha256 hex (house pattern, `_token_hash`), not `bytea`; `delete_account`
deletes the `tour_feeds` row (contract); `updated_at` has no `onupdate` (0018c's SEQUENCE); reschedule / cancel lock
`OF tours` only (deadlock with `set_applicant_status` / `reschedule`); `invalid_window` checks moved out of the
schema into `create_window`, shape checks before the 404; `admin/actions.py::read_chat` renders tour lines (its
`body: str` would break); `test_flatmates.py::test_ac12_statement_counts` added to Scope and Blast radius; NF1
made testable per route; `tzdata` named as a dependency (the trixie-slim image has no system zoneinfo); R9 resolved.

Left for the orchestrator (sibling specs and the contract; not 0018a defects):
1. `TOURS-PLAN.md` table: add `0018e-tour-slots-web` (depends_on 0018a) and drop "slot editor and slot picker" from
   0018a's row.
2. Contract self-contradiction: "Cleanup (0018a): pause/close/**expiry**" vs "Expiry does not cancel tours". This
   spec follows the latter (R3).
3. `0018b`: its web half reuses `features/tours/api.ts::cancelTour`, `format.ts` (`tourDay`, `formatTourTime`,
   `formatTourDay`, now defined in 0018e with 0018b's signatures and `tours.day.*` keys) and the `tours` i18n object,
   so it should `depends_on: [0018a, 0018e]` (or branch from 0018e) and drop the helpers 0018e now defines.
4. `0018d`: still writes `users.tour_feed_hash` (UPDATE users, a `ck_users_deleted_scrubbed` change, `delete_account`
   step 12); align to `tour_feeds` (upsert on `user_id`, `token_hash` text; delete = DELETE row; account deletion
   already handled here) and to `depends_on: [0018a, 0018b, 0018c]` (contract; `ics.py` is 0018c's).
5. `0018c` D1 says system cancels email both sides: admin cancels (R6) never reach `announce`, so they send nothing;
   say so in 0018c. 0018c's `enqueue` takes 3 change names; it maps this spec's 5 `TourChangeKind` values.

Questions for Gilad (defaults written in Risks; the coder builds the default, none blocks the build):
R3 (expiry keeps booked tours), R6 (admin hide/suspend cancel silently: no chat line, no email), R7 (flatmates see no
tour lines), R8 (keep the "הצעת סיור" chip), R12 (lead 60 min, horizon 30 days, 30 windows, 12 h, 10/h 20/day) — all decided 2026-11-16 (Gilad: all defaults; R12's limit lowered to 10/20 per 0018c R5).

## Digest (filled by orchestrator after verification)
See `/digest`.
