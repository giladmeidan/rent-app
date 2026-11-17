# Slice 18 — Tour calendar for listers (plan)

Status: done 2026-11-17 (all five specs merged: #119, #122, #121, #123, #124). Decided 2026-11-16 (Gilad). Decisions are in `PRODUCT.md` "Tours"; this file is the slice breakdown and
moves to `specs/archive/` when the slice is done.

## The flow
1. **Lister opens slots.** On a listing (apartment or room), the lister adds availability windows: a date, a start
   and end time, and a slot length (15 / 20 / 30 / 45 min). The window is cut into slots. Past slots disappear.
2. **Shortlisted seeker books a slot.** Only a seeker whose application to that listing is `shortlisted` (the same
   gate that opens chat; a room `like` application counts) sees the free slots, in the chat thread. Picking one
   **books it at once**: the shortlist already is the lister's approval (Gilad). A slot holds one seeker; a seeker
   holds at most one upcoming tour per listing.
3. **Either side cancels; the seeker reschedules** to another free slot in one step.
4. **Everyone knows.** Each change is a system line in the conversation + an email to the other side, with an
   `.ics` attachment on booking and reschedule, and a reminder email the day before.
5. **Lister's tours page.** `/tours`: an agenda of upcoming tours across all the lister's listings, with who is
   coming and a link to the chat, plus the calendar-feed link.
6. **Calendar feed.** A private, revocable iCal URL per lister that Google / Apple Calendar subscribe to.

Cleanup: pausing, closing or hiding a listing cancels its future tours (expiry does not: no write happens); un-shortlisting or declining an
application cancels that seeker's tour; a deleted account's tours go with it (retention row + privacy text).
Times are stored `timestamptz` and shown in `Asia/Jerusalem`. Only a room's listing owner manages its tours.

## Specs (Slice 18, full-stack each)
| Spec | What | depends_on |
| --- | --- | --- |
| `0018a-tour-slots` | Migration, windows + slots, book / cancel / reschedule, chat tour lines, cleanup hooks, rate limits (API only) | — |
| `0018e-tour-slots-web` | The lister's slot editor, the seeker's slot picker and tour card in the thread | 0018a |
| `0018b-tours-page` | `GET /tours`, `/tours` page, nav entry | 0018a, 0018e |
| `0018c-tour-emails` | Emails on every change, `.ics` (stdlib, no new dependency), day-before reminder job, retention + privacy text | 0018a |
| `0018d-calendar-feed` | Private iCal feed per lister: create / rotate / revoke token, public `.ics` endpoint | 0018a, 0018b, 0018c |

Build order: `0018a` → `0018c` and `0018e` in parallel → `0018b` → `0018d`.

## Later (not this slice)
Real two-way Google Calendar sync (sensitive OAuth scope → Google verification); group tours / open house;
flatmates seeing a room's tours.

## Shared contract (orchestrator, 2026-11-16) — the four specs build on this; change it only here
- **One migration, in `0018a`** (next free Alembic id after `0029`), so `0018b`–`0018d` add none and can build in
  parallel: tables `tour_windows` and `tours`, the chat change for tour lines, `tours.reminder_sent_at` (used by
  `0018c`) and the lister's calendar-feed token hash (used by `0018d`; stored hashed, never the raw token): table
  `tour_feeds` (`user_id` PK → `users.id`, `token_hash`, as `0018a` defines it; supersedes `0018d`'s draft
  `users.tour_feed_hash`); `delete_account` deletes the user's `tour_feeds` row (a deleted account is a tombstone,
  so the FK cascade never fires).
- **Chat tour lines** live on `messages` (tour columns + CHECK, `body` nullable), per `0018a`. The change hook is two
  functions: `record` (inside the transaction: chat lines) and `announce` (after commit: chat event; `0018c` adds
  the email enqueue here).
- **Expiry does not cancel tours** (no write happens at expiry): an expired listing takes no new bookings, booked
  tours stay (open for Gilad).
- **`api/app/services/ics.py`** (VEVENT builder, UID `{tour_id}@homie`) is created by `0018c`; `0018d` imports it and
  so has `depends_on: [0018a, 0018b, 0018c]`.
- **Reschedule updates the same `tours` row** (new `starts_at`/`ends_at`, `reminder_sent_at` back to NULL), so the
  calendar UID stays; `updated_at` moves only on book, reschedule and cancel (it is the `.ics` SEQUENCE source).
  0018a also indexes `tours (starts_at) WHERE status = 'booked'` (reminder job, feed).
- **Retention R11 (`0018c`):** a tour row is deleted 12 months after its `starts_at` unless an unresolved report
  covers its conversation, listing or application; the chat tour line must survive its tour being deleted (render without it, or cascade). Privacy items: `0018d` takes `legal.privacy.s3.i7`.
- **`tour_windows`**: `listing_id` (cascade), `starts_at`/`ends_at` `timestamptz`, `slot_minutes` ∈ {15, 20, 30, 45};
  the window length is a whole number of slots; windows of one listing never overlap.
- **`tours`**: `listing_id`, `application_id`, `seeker_id` (all cascade), `starts_at`/`ends_at`, `status` ∈
  {`booked`, `cancelled`}, `cancelled_by` ∈ {`seeker`, `lister`, `system`} (NULL while booked), `cancelled_at`,
  `reminder_sent_at`, `created_at`, `updated_at`. Never two `booked` tours on one (listing, `starts_at`); at most one
  *upcoming* `booked` tour per application. Indexes include `tours (seeker_id) WHERE status = 'booked'` (0018b's
  seeker side) besides whatever 0018a's own queries need.
- **Slots are computed**, never stored: a window's slots minus booked tours minus slots starting before now.
- **Gate:** seeker endpoints require the caller's own application to the listing with `status = 'shortlisted'`
  (else 404, identical bodies); lister endpoints require `listings.owner_id` = caller (else 404).
- **Endpoints (`0018a`):** `GET`/`POST /listings/{id}/tour-windows`, `DELETE /tour-windows/{id}` (409
  `window_has_tours` while it holds an upcoming booked tour), `GET /applications/{id}/tour-slots` (free slots + the
  seeker's current tour), `POST /applications/{id}/tour` `{starts_at}` (book), `POST /tours/{id}/reschedule`
  `{starts_at}` (seeker), `POST /tours/{id}/cancel` (either side). `0018b` adds `GET /tours`; `0018d` adds the feed
  endpoints; `0018c` adds none.
- **Change hook:** every booking, reschedule and cancel (including system cancels from cleanup) goes through one
  function in `api/app/services/tours.py` that `0018a` defines and `0018c` extends to enqueue the email job; `0018a`
  makes it write the chat line and publish the chat event.
- **Chat line:** stored structured (tour id + change), rendered by the web from i18n keys; no Hebrew stored or built
  server-side.
- **Cleanup (`0018a`):** pause/close/admin-hide of a listing, a withdrawal, an un-shortlist or decline, and account deletion cancel
  the affected upcoming tours (`cancelled_by = 'system'`).
- **Times:** API speaks ISO-8601 UTC; the web shows `Asia/Jerusalem`.
