---
id: 0004c
title: An owner lists the applicants of one of their listings with each applicant's name and message, shortlists or declines them, and sees applicant, new-applicant and view counts on "my listings"
status: verified
depends_on: [0004a]
reviewers: [code, qa, security]   # security: a seeker's name and free-text message shown to another user (PII), ownership checks on two ids; qa: status transitions
estimate: 1 coder run
---

## Goal
After this ships, an owner calls `GET /listings/{id}/applications` for one of their listings (any state: live,
paused, expired) and gets its applicants — display name, message, status, date — newest first; `PATCH
/listings/{id}/applications/{application_id}` with `{"status": "shortlisted" | "submitted" | "declined"}` moves
an applicant onto or off the shortlist or declines them; and `GET /me/listings` carries `applicant_count`,
`new_applicant_count` and `view_count` per listing. Shortlisting is the status Slice 5 opens chat on (PRODUCT.md
"Chat — opens only on owner shortlist"); this spec stores it and nothing more. Serves Dev Plan slice 4 (Apply +
inbox), part c of four (see `0004a` Goal for the split); the web inbox is `0004d`.

## Scope
**In:**
- `api/app/schemas/application.py` (from `0004a`) gains `ApplicantStatus = Literal['submitted', 'shortlisted',
  'declined']`, `ApplicantOut` and `ApplicantStatusIn` (see API). `api/app/schemas/listing.py` gains
  `MyListingOut(ListingOut)` with `applicant_count: int`, `new_applicant_count: int`, `view_count: int`.
- `api/app/services/applications.py` (from `0004a`) gains:
  - `list_applicants(db, owner, listing_id) -> Sequence[tuple[Application, str]]` (application, applicant
    display name): first `select(Listing.id).where(Listing.id == listing_id, Listing.owner_id == owner.id)` —
    none → `ListingNotFoundError` (reused from `services/listings.py`); then one statement `select(Application,
    User.display_name).join(User, User.id == Application.seeker_id).where(Application.listing_id ==
    listing_id, Application.status != 'withdrawn').order_by(Application.created_at.desc(), Application.id)`.
  - `set_applicant_status(db, owner, listing_id, application_id, status) -> tuple[Application, str]`: **one**
    statement `UPDATE applications SET status = :to, updated_at = CASE WHEN applications.status = :to THEN
    applications.updated_at ELSE now() END FROM listings WHERE applications.id = :aid AND
    applications.listing_id = :lid AND listings.id = applications.listing_id AND listings.owner_id = :me AND
    applications.status IN (ALLOWED_FROM[:to]) RETURNING applications.*, (SELECT users.display_name FROM users
    WHERE users.id = applications.seeker_id)` — the display name comes from that scalar subquery, never from a
    loaded `User` entity (NF2); a same-status PATCH keeps `updated_at` (verifier 2). No condition on the
    listing's status: a PATCH works for live, paused and expired listings alike. No row → one `SELECT
    applications.status` with the same id / listing / owner conditions: no row or `withdrawn` →
    `ApplicationNotFoundError`, otherwise `InvalidTransitionError`. Commits; rolls back on error.
  - New exception `InvalidTransitionError` in `services/applications.py` (next to `0004a`'s
    `ApplicationNotFoundError`).
    `ALLOWED_FROM = {'shortlisted': {'submitted', 'shortlisted'}, 'submitted': {'submitted', 'shortlisted'},
    'declined': {'submitted', 'shortlisted', 'declined'}}` — the transition table below, in one constant.
- `api/app/services/listings.py` `list_own_listings`: still **one** statement; selects `Listing` plus two
  correlated scalar subqueries (`select(func.count()).where(Application.listing_id == Listing.id,
  Application.status != 'withdrawn').scalar_subquery()` and the same with `status == 'submitted'`), served by
  `uq_applications_listing_seeker`'s index; returns `Sequence[tuple[Listing, int, int]]`. `view_count` is the
  column from `0004a`.
- `api/app/routers/applications.py` (from `0004a`): the two owner endpoints, `current_owner`; both map
  `ListingNotFoundError` / `ApplicationNotFoundError` → 404 `not_found` and the PATCH maps
  `InvalidTransitionError` → 409 `invalid_transition`, with `responses=` entries for 401 / 403 / 404 / 409 (`ErrorOut`)
  like `routers/listings.py`. `routers/listings.py` `my_listings`: `response_model=list[MyListingOut]`.
- Tests: `api/tests/test_inbox.py` (new); `api/tests/test_listings.py::test_ac6_me_listings_is_own_newest_first`
  passes unchanged (still 2 statements, 1 containing `FROM listings` at the outer level — AC6).
- `README.md`: one curl for listing applicants under "Posting a listing locally".

**Out:**
- Web: `0004d`. Chat, a "schedule a viewing" action (`InboxDesktop.dc.html` "הצעת סיור"): Slice 5.
- Match score, sorting by match, the applicant's age / household / occupation / move-in date (artboard): Slice 6
  and Slice 7 (the seeker profile does not exist yet).
- Marking applications as "seen": "new" means `status = 'submitted'`.
- Pagination of the applicant list (bounded by seekers' rate limits; FOLLOWUPS if a listing passes ~200).
- Notifications to the seeker on a status change: `0004a` Q1.
- Phone verification badge ("מאומתים בטלפון"): Slice 10/12.

**New dependencies:** none.

## Data
None new. Reads and updates `applications` (`0004a`); reads `users.display_name` and `listings.view_count`.
No migration.

## API
`ApplicantOut`: `id`, `status: ApplicantStatus`, `message`, `applicant_name` (the seeker's `display_name`),
`created_at`, `updated_at`. **Not** `seeker_id`, email, `listing_id`, or any other user column (NF2).
`ApplicantStatusIn`: `status: ApplicantStatus` (required; `withdrawn` or anything else is a 422).
`MyListingOut`: every `ListingOut` field plus `applicant_count` (non-withdrawn), `new_applicant_count`
(`submitted`), `view_count`. `POST /listings` and `PATCH /listings/{id}` keep returning `ListingOut` (no counts).

Transition table (owner side; rows = target, columns = current status):
| target ↓ / current → | submitted | shortlisted | declined | withdrawn |
| --- | --- | --- | --- | --- |
| `shortlisted` | 200 | 200 (no-op) | 409 | 404 |
| `submitted` ("remove from shortlist") | 200 (no-op) | 200 | 409 | 404 |
| `declined` | 200 | 200 | 200 (no-op) | 404 |
A decline is final for the owner (Q6); a withdrawn application is invisible to the owner, so it is a 404. A
no-op cell returns 200 and leaves the row untouched, `updated_at` included; every other 200 sets `updated_at =
now()`. The listing's own state (live, paused, expired) never matters.

| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /listings/{listing_id}/applications | owner session (`current_owner`) **and** `listings.owner_id == user.id` (in the `WHERE`) | path `uuid` | 200 `list[ApplicantOut]`: non-withdrawn applications of the listing, newest `created_at` first then `id`; `[]` when none; any listing state | 401 `unauthenticated` · 403 `owner_only` · 404 `not_found` (unknown id or another owner's listing, identical bodies) · 422 non-uuid · 503 |
| PATCH | /listings/{listing_id}/applications/{application_id} | owner session **and** the listing is the caller's **and** the application belongs to that listing (all in the `UPDATE`'s `WHERE`) | path `uuid`s; body `ApplicantStatusIn` | 200 `ApplicantOut` with the new status (and `applicant_name` from the same statement); any listing state | 401 · 403 `owner_only` · 404 `not_found` (unknown listing or application, another owner's listing, an application of a different listing, a withdrawn application — identical bodies) · 409 `invalid_transition` (from `declined` to `shortlisted` / `submitted`) · 422 (body, non-uuid) · 503 |
| GET | /me/listings (changed, `0002a`) | owner session (`current_owner`), unchanged | – | 200 `list[MyListingOut]`, same rows and order as before | unchanged: 401 · 403 · 503 |

`POST /listings/{listing_id}/applications` (seeker, `0004a`) and `GET /listings/{listing_id}/applications`
(owner) share a path; different methods and auth, routed independently.

## UI
None in this part. The inbox screen is `0004d` (`design/screens-v1/Inbox.dc.html`, `InboxDesktop.dc.html`).

## Acceptance criteria
Fixtures as `0004a`: `gush_dan`, `make_owner`, `make_listing`, `make_seeker`, `make_application`, `signup`,
`redis_clean`, `outbox`, the copied `statements` fixture. "Owner" = `signup(client, outbox, "o@example.com",
"owner")`, its id from `GET /me`; its listings via `make_listing(owner_id=…)`. Non-ASCII test inputs are written
as `\uXXXX` escapes in the tests (and here).
- [ ] AC1 Given the owner's listing A with applications from seekers named `"\u05de\u05d9\u05db\u05dc"` (submitted), `"Omer"` (shortlisted), `"Dana"` (declined) and `"Gone"` (withdrawn), created 1 s apart (SQL `created_at`), and another owner's listing with one application, When the owner `GET /listings/{A}/applications`, Then 200 with exactly three items, newest first, each key set exactly `{id, status, message, applicant_name, created_at, updated_at}`, `applicant_name` the seeker's display name, and no seeker email, `seeker_id` or the withdrawn one anywhere in the body; Given A is paused, and Given A has `expires_at` in the past, Then the same three; Given the owner's listing B with no applications, Then `[]` — `api/tests/test_inbox.py::test_ac1_owner_lists_applicants`
- [ ] AC2 Given A, When `GET /listings/{A}/applications` with no cookie, Then 401; with a seeker's cookie, Then 403 `owner_only`; with another owner's cookie, Then 404 `{"detail":"not_found"}`, identical to a random uuid's; `not-a-uuid` → 422 — `test_inbox.py::test_ac2_applicants_are_owner_only`
- [ ] AC3 Given A with 3 applications and listing C with 25, When the owner lists each (after one warm-up request and `statements.clear()`), Then each measured request executes exactly 3 `before_cursor_execute` statements (session lookup, ownership check, one containing `FROM applications`) — `test_inbox.py::test_ac3_applicants_is_three_statements`
- [ ] AC4 Given, for each of the 9 cells of the transition table's first three columns, a fresh application on A (9 seekers via `make_seeker` + `make_application(status=<current>, updated_at=now() − 1 day)`), When the owner PATCHes it to the cell's target, Then the cell's status code; each 200 returns `ApplicantOut` with the target status and `applicant_name`, and the row stores it; on the three no-op cells `updated_at` is unchanged, on the other 200 cells it moved; each 409 is `{"detail":"invalid_transition"}` and the row is unchanged; Given listing E of the owner paused (SQL) with a submitted application, When it is PATCHed to `shortlisted`, Then 200; Given a seeker S signed up with `signup(client, outbox, "s@example.com", "seeker")` who applied to A through `0004a`'s endpoint, When the owner shortlists then declines S's application, Then S's `GET /me/applications` shows `shortlisted`, then `declined`; `GET /listings/{A}`'s `applicant_count` is the same before and after every PATCH — `test_inbox.py::test_ac4_status_transitions`
- [ ] AC5 Given A (owner X) with application P, and X's listing B with application Q, and listing D of owner Y with application R, When X PATCHes `/listings/{A}/applications/{Q}` (wrong listing), `/listings/{D}/applications/{R}` (Y's), `/listings/{A}/applications/<random uuid>`, and a withdrawn application on A, Then 404 `not_found` with identical bodies and nothing changes; When X sends `{"status": "withdrawn"}`, `{"status": "open"}`, `{}`, or a non-uuid id, Then 422; with no cookie → 401; with a seeker's cookie → 403 `owner_only` — `test_inbox.py::test_ac5_patch_ownership_and_validation`
- [ ] AC6 Given the owner's listings A (applications: 2 submitted, 1 shortlisted, 1 declined, 1 withdrawn; `view_count` 7 by SQL) and B (none), When `GET /me/listings`, Then A has `applicant_count` 4, `new_applicant_count` 2, `view_count` 7 and B has 0 / 0 / 0, every item's keys are `ListingOut`'s plus exactly those three, and after one warm-up request and `statements.clear()` the measured request executes exactly 2 `before_cursor_execute` statements; `POST /listings` and `PATCH /listings/{id}` responses have none of the three keys — `test_inbox.py::test_ac6_my_listings_counts`
- [ ] NF1 `make lint` clean (ruff, mypy --strict); `make client` regenerates `web/src/api/schema.d.ts` with the two operations, `ApplicantOut` and `MyListingOut` — CI `api` and `web` jobs
- [ ] NF2 Privacy: the owner learns of an applicant only `display_name` and the message; `ApplicantOut` lists its fields explicitly and both the list query and the PATCH's `RETURNING` select `users.display_name` only (never the `User` entity) — AC1 key set + security reviewer

## Tests to write
Integration (Postgres + Redis as `0004a`): AC1–AC6 in `test_inbox.py`; rows via `make_seeker` /
`make_application`, statuses set by `make_application(status=…)`. `test_listings.py` and `test_applications.py`
pass unchanged. Unit: none (the transition table is proven cell by cell in AC4). E2E: none (`0004d`).

## Risks / open questions
**Decisions for Gilad (built on the recommendation until he answers):**
- **Q6 — Is a decline final?**
  (a) Yes; the web asks for confirmation before declining (`0004d`) — **recommended**: the seeker may already
  have seen it (`0004a` Q5), and flip-flopping is worse than a confirm dialog.
  (b) The owner can undo a decline (`declined` → `submitted`), for example within the inbox session.
- Also inherited: `0004a` Q1 (notifications: none in Slice 4 — so the counts in AC6 are how an owner notices new
  applicants), Q3 (the seeker does not learn the owner's identity), Q5 (the seeker sees `declined`).

**Assumptions (orchestrator, not Gilad calls):** "remove from shortlist" (`shortlisted` → `submitted`) is allowed,
as the artboard shows "הסרה מהרשימה"; Slice 5 decides what that does to an open chat. "New" = `submitted`. The
owner sees display name and message only, never the email: contact details travel through chat (Slice 5).
Newest first until Slice 6's match score sorts the inbox ("ממוין לפי ציון התאמה").

**Technical risks the verifier should challenge:**
- **Race with a seeker's withdraw:** the `UPDATE`'s `status IN (…)` condition makes it atomic: if the seeker
  withdraws first, the owner's PATCH gets 404; if the owner declines first, the seeker's withdraw gets 409
  `not_withdrawable` (`0004a`). No lock needed.
- **Correlated subqueries on `/me/listings`:** at most a few listings per owner (cap 3 live, paused ones too), each
  count an index range scan on `uq_applications_listing_seeker (listing_id, …)`. No perf reviewer; AC6 pins the
  single statement.
- **Unpaginated applicant list:** a popular listing could have hundreds of 500-character messages (~250 KB). Accepted
  for MVP; pagination when real data shows it.
- This branch starts from `0004a`'s branch (Speed rule 3) and rebases after it merges; it touches
  `routers/listings.py`, `services/listings.py` and `schemas/listing.py`, which no other open spec edits.

## Verifier findings — one round, 5 findings, all applied
1. PATCH is one `UPDATE … FROM listings … RETURNING applications.*, (SELECT users.display_name …)`; `applicant_name` comes from that scalar subquery, never a `User` entity (Scope, NF2).
2. A same-status PATCH keeps `updated_at` (`CASE WHEN applications.status = :to …`); AC4 asserts unchanged on the three no-op cells and moved on the others (Scope, API, AC4).
3. AC4 uses a fresh application per cell (9 seekers via `make_seeker` + `make_application`) and a `signup` seeker for the `GET /me/applications` check (AC4).
4. PATCH works in every listing state (no listing-status condition); AC4 adds a 200 on a paused listing (Scope, API, AC4).
5. `InvalidTransitionError` named in Scope; the router maps it to 409 `invalid_transition` and both not-found errors to 404, with `responses=` entries (Scope).
Also applied for consistency with `0004a` finding 3: AC3 and AC6 count statements after a warm-up request.

## Digest (filled by orchestrator after verification)

    Spec 0004c - Inbox API: applicants per listing, shortlist / decline, counts on my listings   (verified, part 3 of 4, depends on 0004a)
    What a user can do after this: an owner lists the applicants of any of their listings (name and message only), moves
             them onto or off the shortlist or declines them, and sees applicants / new applicants / views per listing
             on /me/listings.
    Decisions I need from you (built on the recommendation meanwhile):
      Q6. Is a decline final? (a) yes, the web asks for confirmation first [rec] (b) the owner can undo a decline.
    Inherited from 0004a: Q1 (no notifications, so the "new" count is how an owner notices), Q3, Q5.
    Acceptance targets: NF1 ruff + mypy --strict clean, client regenerated · NF2 the owner sees display name and message
             only, never email or id.
    Risks: a race between the owner's PATCH and the seeker's withdraw — mitigation: one conditional UPDATE, re-checked
             under the row lock; the loser gets 404 / 409.
    Reviewers: code, qa, security   Estimated: 1 coder run, 1 review round
    Links: specs/0004c-inbox-api.md · PRODUCT.md "Chat" · design/screens-v1/Inbox.dc.html, InboxDesktop.dc.html
