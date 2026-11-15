---
id: 0013g
title: Before launch, an expired listing's photos are frozen like its fields, every rate-limited form says when to try again, the worker's own log lines show, and the suspension filters live in a neutral module
status: in-review
depends_on: []   # the test-only half of the sweep is 0013d (no shared file)
reviewers: [code, qa]   # code: a move across four services and the photo routes' refusal order; qa: an API behaviour change (409 on three photo routes) and five UI error states. No security: no auth or data-exposure change, and the upload change is one more refusal before the body is read, the pattern 0012a's security review passed for `listing_removed`, no perf, no ux (error lines only, worded like the existing `rateLimitedIn` lines)
estimate: 1 coder run   # coder Sonnet/medium: every item copies a pattern already in the code (update_listing's expired check, ApplySection's Retry-After line), and the module move changes no behaviour (Speed rule 6: mechanical)
---

## Goal
Before launch, the open Slice 11/12 review minors that no other Slice 13 spec owns are closed. An owner can
no longer change the photos of a listing that is past `expires_at` (as PATCH already refuses its fields).
The forms FOLLOWUPS 0011c names (listing wizard, applicant status, profile save, likes page) and the room
lister's invite say "try again in …" when the API says when. The worker's INFO lines
show up in its logs. `not_suspended` / `owner_not_suspended` move out of `services/search.py`. PRODUCT.md
"Launch (Slice 13)": "a pre-launch cleanup sweep (… Slice 11/12 review minors)".

## Scope
**In:**

1. **Photos of an expired listing** (FOLLOWUPS 0011a line 269). `services/photos.py`: `check_listing_upload`
   (the pre-read check) and `_lock_own_listing` (under the lock, used by `add_listing_photo`,
   `delete_listing_photo` and `reorder_listing_photos`) select `Listing.expires_at <= func.now()` next to
   `removed_at`, as `update_listing` does (`services/listings.py:192–203`). The order of refusals is
   `ListingNotFoundError`, then `ListingRemovedError`, then the existing `ListingExpiredError` (from
   `services/listings.py`), then `PhotoLimitError` (upload only). `routers/photos.py`: the three listing photo
   routes map `ListingExpiredError` to **409 `listing_expired`**, nothing written or stored, and their OpenAPI
   409 descriptions add `listing_expired: past expires_at: renew it`. The upload refuses it before the body is
   read (the pre-read check), so an expired listing costs no decode. The person photo (`PUT` / `DELETE
   /me/photo`) is unchanged. The web needs nothing: the edit page already refuses an expired listing, and a
   listing that expires mid-edit fails its PATCH first (`ListingWizard.tsx` `outcome` → `expired`).
2. **"Try again in …" on the remaining 429s** (FOLLOWUPS 0011c lines 264–265). Use the existing pattern:
   `ApiError(…, response.headers)` gives `retryAfter` (`components/retryAfter.ts` `parseRetryAfter`). The text
   is `<key>In` with `retryAfterText(t, retryAfter)` when it is not null, else the fixed `<key>`, as in
   `ApplySection.tsx:262–266`. Each API function below passes `response.headers` to its `ApiError`. Surfaces:
   - **Listing wizard** (create and edit): `createListing`, `patchListing` (`features/listings/api.ts:63`, `:78`;
     buckets `create`, `write`, `address`). `ListingWizard.tsx` `outcome()` maps 429 to a new `PublishError`
     `'rateLimited'` (`PreviewStep.tsx:12`), carrying the error's `retryAfter` for the text. New keys
     `listings.errors.rateLimited`, `listings.errors.rateLimitedIn`.
   - **Applicant status** (owner's inbox): `setApplicantStatus` (`features/applicants/api.ts:43`, bucket
     `status`). `ApplicantCard.tsx` shows the new line where `applicants.errors.actionFailed` shows today
     (`:361`). New keys `applicants.errors.rateLimited`, `applicants.errors.rateLimitedIn`.
   - **Profile save**: `putProfile` (`features/profile/api.ts:45`, bucket `write`). `ProfilePage.tsx` shows it as
     the form's error (`errors.form`, `:622`). New keys `profile.errors.rateLimited`, `profile.errors.rateLimitedIn`.
   - **The likes page**: `fetchMyPeopleLikes` (`features/people/api.ts:91`, `GET /me/people-likes`, the shared
     `browse` bucket). `MyLikesPage.tsx` shows `people.browseRateLimited` on a 429, or the new
     `people.browseRateLimitedIn` with the wait, in place of the generic `ErrorState` (`:66`); any other error
     keeps `ErrorState`.
   - **The room lister's invite** (`PersonCard.tsx`): `likePerson` (`features/people/api.ts:34`) passes headers.
     The `rateLimited` line (`:211`) reads `people.errors.inviteRateLimitedIn` with the wait, else the existing
     `people.errors.inviteRateLimited`.

   Copy (he.json; `{{when}}` is `retryAfterText`'s "בעוד 14 דקות"):

   | key | text |
   | --- | --- |
   | `listings.errors.rateLimited` | `הרבה פעולות על מודעות בזמן קצר. אפשר לנסות שוב מאוחר יותר.` |
   | `listings.errors.rateLimitedIn` | `הרבה פעולות על מודעות בזמן קצר. אפשר לנסות שוב {{when}}.` |
   | `applicants.errors.rateLimited` | `הרבה שינויים בזמן קצר. אפשר לנסות שוב מאוחר יותר.` |
   | `applicants.errors.rateLimitedIn` | `הרבה שינויים בזמן קצר. אפשר לנסות שוב {{when}}.` |
   | `profile.errors.rateLimited` | `הפרופיל נשמר הרבה פעמים בזמן קצר. אפשר לנסות שוב מאוחר יותר.` |
   | `profile.errors.rateLimitedIn` | `הפרופיל נשמר הרבה פעמים בזמן קצר. אפשר לנסות שוב {{when}}.` |
   | `people.browseRateLimitedIn` | `צפיתם בהרבה כרטיסים בזמן קצר. אפשר לחזור לזה {{when}}.` |
   | `people.errors.inviteRateLimitedIn` | `יותר מדי הזמנות בזמן קצר. אפשר לנסות שוב {{when}}.` |
3. **The worker's own log lines** (FOLLOWUPS 0011e line 273). `app.worker` inherits the root WARNING level,
   and under `arq app.worker.WorkerSettings` only arq's own logger has a handler, so `view flush: %d` and
   `geocode sweep: %s` never show. Fix in `api/app/worker.py`, so it holds for every launcher (compose today,
   0013a's Fly process tomorrow): the `app` loggers log at INFO through a handler in the worker process.
   Configure it where arq's own `logging.config.dictConfig` (run by its CLI) does not undo it, e.g. in a
   `WorkerSettings.on_startup`. `httpx` stays at WARNING (`worker.py:21`: its INFO lines carry Nominatim URLs
   with addresses). To keep a line every 10 s out of the logs, the geocode sweep logs its counts only when one
   of them is not zero. The view flush (once a minute) logs as it does.
4. **`not_suspended` / `owner_not_suspended` to a neutral module** (FOLLOWUPS 0012a line 280). Move both,
   unchanged (docstrings included), from `services/search.py:53–63` to a new `api/app/services/visibility.py`.
   Callers import from there: `services/search.py` itself, `services/people.py` (`search_service.not_suspended`,
   `:175`), `services/market_people.py:66`, `services/flatmates.py:78`. No re-export from `search.py`. No
   behaviour change.

**Out** (each remaining 0011*/0012* line in FOLLOWUPS):
- 0011c line 266 (per-IP limits on public reads), 0011e lines 270–272 (views de-duplicated per IP, the flush's
  malformed field, `count_view`'s Redis timeout): spec `0013b`.
- 0012b lines 283–285 (admin test edges, session nonce, CSRF token): spec `0013e`.
- 0011b line 268 (reports when an account is deleted): spec `0013c`. 0012b line 282 (terms of use): spec `0013f`.
- 0012b line 281 (deploying the admin): spec `0013a`.
- 0011d line 275 (flaky `market ac18`): spec `0013d`.
- 0011b line 267 (naming one group-chat member in a report): its own condition is "if Slice 12's reports show the
  need"; no reports exist before launch.
- 0012a line 279 (the match-sort page statement takes 69–71 ms at 10,000 live apartments): there's no cheap,
  known fix (it needs an `EXPLAIN` study of the score ordering), and launch traffic is hundreds of listings,
  not 10,000. Keep it logged.
- The seeker's withdraw (`POST /me/applications/{id}/withdraw`, bucket `write`): not in FOLLOWUPS. With 200 an
  hour it is not reachable by hand.
- The other `write`-bucket 429s that stay generic, for the same reason (not in FOLLOWUPS, not reachable by hand):
  renew and pause/resume (`MyListingsPage.tsx` / `EditListingPage.tsx` → `actionErrorText`, `common.error`), the
  closure answer (`PUT /listings/{id}/closure`), the market unlike / remove match (`routers/market_people.py`
  DELETEs) and the room person unlike (`routers/people.py` DELETE).

**New dependencies:** none.

## Data
None. No migration.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | /listings/{listing_id}/photos | signed in; the caller's listing (unchanged) | multipart (unchanged) | 201 `PhotoOut` (unchanged) | **+ 409 `listing_expired`** (past `expires_at`), after 404 and 409 `listing_removed`, before 409 `photo_limit` and before the body is read |
| DELETE | /listings/{listing_id}/photos/{photo_id} | unchanged | — | 204 (unchanged) | **+ 409 `listing_expired`**, after 404 and `listing_removed`; nothing deleted from the DB or the store |
| PUT | /listings/{listing_id}/photos/order | unchanged | unchanged | unchanged | **+ 409 `listing_expired`**, after 404 and `listing_removed`; the order unchanged |

Every other endpoint is unchanged. `make client` regenerates `web/src/api/schema.d.ts` (the 409 descriptions).

## UI
No new screen. Error lines only, in the existing alert or error slot of each surface (Scope 2). States
unchanged apart from the 429 error state: without `Retry-After` the fixed `<key>`, with it `<key>In`. RTL: plain
text lines in existing slots. The 8 keys are in Scope 2's table. No artboard: these are error lines in screens
already styled (0009k wizard, 0009l inbox, 0009r profile, 0009qa likes, 0009p people).

## Acceptance criteria
- [ ] AC1 Given an owner's live listing with one photo, When the test sets its `expires_at` to the past, Then
  `POST …/photos` (a valid JPEG), `DELETE …/photos/{id}` and `PUT …/photos/order` each answer 409
  `{"detail": "listing_expired"}`. The photo row, its order and the store's objects are unchanged, and the
  upload never calls the decoder (monkeypatched to fail if called). Given the same listing also removed by
  homie, Then each answers 409 `listing_removed` (removed wins). Given another owner's expired listing, Then
  404 — `api/tests/test_photos.py::test_ac13_expired_listing_photos_frozen`
- [ ] AC2 Given an expired listing renewed (`POST /listings/{id}/renew`), Then the upload is accepted again (201) —
  `api/tests/test_photos.py::test_ac13_renewed_listing_photos_open`
- [ ] AC3 Given `POST /listings` answering 429 with `Retry-After: 840`, Then the wizard's preview step shows
  `listings.errors.rateLimitedIn` with "בעוד 14 דקות"; without the header, `listings.errors.rateLimited`; the
  edit wizard's PATCH answering 429 shows the same line —
  `web/src/features/listings/__tests__/ListingWizard.test.tsx::ac3_rate_limited_publish_says_when`
- [ ] AC4 Given an applicant status change answering 429 with `Retry-After: 120`, Then the card shows
  `applicants.errors.rateLimitedIn` with "בעוד 2 דקות"; without it `applicants.errors.rateLimited`; a 500
  still shows `applicants.errors.actionFailed` —
  `web/src/features/applicants/__tests__/ApplicantsPage.test.tsx::ac4_rate_limited_status_says_when`
- [ ] AC5 Given `PUT /me/profile` answering 429 with `Retry-After: 7200`, Then the form's error reads
  `profile.errors.rateLimitedIn` with "בעוד שעתיים"; without it `profile.errors.rateLimited` —
  `web/src/features/profile/__tests__/ProfilePage.test.tsx::ac5_rate_limited_save_says_when`
- [ ] AC6 Given `GET /me/people-likes` answering 429 with `Retry-After: 60`, Then the likes page shows
  `people.browseRateLimitedIn` with "בעוד דקה", not the retry `ErrorState`; without it
  `people.browseRateLimited`; a 500 still shows `ErrorState` —
  `web/src/features/likes/__tests__/MyLikesPage.test.tsx::ac6_rate_limited_likes_page_says_when`
- [ ] AC7 Given the room lister's invite (`PUT /listings/{id}/people/{id}/like`) answering 429 with `Retry-After:
  300`, Then the card reads `people.errors.inviteRateLimitedIn` with "בעוד 5 דקות"; without it the existing
  `people.errors.inviteRateLimited` — `web/src/features/people/__tests__/PeoplePage.test.tsx::ac7_invite_rate_limited_says_when` (where the card's `inviteRateLimited` test is today)
- [ ] AC8 Given the worker's startup hook run (as arq would, after its own `dictConfig`), Then a record from
  `app.worker` at INFO reaches a handler that the worker installed. The `app` logger's effective level is INFO,
  and `httpx`'s is still WARNING. Given a geocode sweep whose counts are all zero, Then it logs no line; given a
  non-zero count, the counts line logs (`test_nf3_worker_logs_no_address` keeps passing) —
  `api/tests/test_worker.py::test_ac8_worker_logs_its_info_lines`. Also checked by hand: with `make dev` up,
  the worker's compose log shows `view flush: 0` within a minute. The coder quotes the line in the PR body.
- [ ] AC9 Given the move, Then `not_suspended` and `owner_not_suspended` are defined only in
  `services/visibility.py`, nothing imports them from `services.search`, and every 0012a suspension test passes
  unchanged — `api/tests/test_moderation.py` (all), `test_people.py`, `test_market_people.py`,
  `test_flatmates.py`, `test_search.py`
- [ ] NF1 `make lint`, `make test`, `make i18n-check` pass; the 8 keys exist in `he.json` and are used. e2e runs
  in CI only: never `make e2e` locally (Speed rule 8)

## Tests to write
API (pytest, compose Postgres): AC1, AC2 in `test_photos.py`, reusing its fixtures (an owner, a listing, a valid
JPEG, the file store). The listing goes past expiry by setting `expires_at` in SQL, as
`test_listing_renewal.py` does. AC8 in `test_worker.py`, with the file's `httpx_log_level` fixture (and an
equivalent restore for the `app` logger's level and handlers, so other tests' `caplog` is not changed). AC9:
the existing suites. Web (vitest): AC3–AC7, each in the surface's existing test file (named in the AC),
mocking the fetch with a 429 and a `Retry-After` header as `ApplySection`'s and `JoinFlatPage`'s tests do.
E2E: none (the 429s are unit-level; the photo refusal is API-level).

## Risks / open questions
No open product question.
- **Overlap with 0013c (account deletion).** As drafted, 0013c deletes the leaving account's photo rows with a
  plain `DELETE` and the objects with `photos.object_names` and `photos._discard`, which it may make public. It
  does not go through `delete_listing_photo`, so this spec's refusal does not block it on an expired listing.
  Both specs edit `services/photos.py`, in different functions; the second to merge merges `origin/main`
  (CLAUDE.md rule 3). If 0013c's build ever routes deletion through `_lock_own_listing`, the orchestrator tells
  that session. 0013c may also touch `services/people.py` / `services/flatmates.py`, where this spec changes
  only an import line.
- **Overlap with 0013b:** `services/search.py` (this spec moves two functions out; 0013b's per-IP read limits sit
  in `routers/search.py`). `test_worker.py`: if 0013b adds a worker test for the view flush, both edit the
  file in different functions.
- **Overlap with 0013f (account deletion web):** it edits `ProfilePage.tsx`, `ProfilePage.test.tsx` and `he.json`
  (the delete-account section), the same files as Scope 2's profile line and AC5, in different places; the second
  to merge merges `origin/main` (`he.json`: different keys).
- **Overlap with 0013b, more:** it edits `services/market_people.py` (`count_browse` in `browse` and
  `my_people_likes`), where this spec changes only the import line, and adds a per-IP 429 to `GET /me/people-likes`
  (AC6's surface: the same 429 line, no change needed here). The second to merge merges `origin/main`.
- **Overlap with 0013a:** the worker's Fly process command is 0013a's; the logging fix lives inside
  `worker.py`, so 0013a needs nothing for it.
- **Freezing photo deletion too:** an owner who wants to take a photo down from an expired listing must renew it
  first, as for any field. The listing is not public while expired (`_public_listings`), so a photo of an
  expired listing is not shown to anyone else.
- **Main checkout only:** `graphify` lists `api/scripts/seed_promo.py` (Gilad's uncommitted script) as a caller
  of `_lock_own_listing`. It is not on `main`, and an expired listing in it would now be refused. Tell Gilad if
  the coder sees it.

## Blast radius
`graphify affected` on main's graph (the main checkout, 2026-11-15; hits confirmed with grep).
- `_lock_own_listing` (`services/photos.py`) → `add_listing_photo`, `delete_listing_photo`,
  `reorder_listing_photos` → `routers/photos.py` upload, delete (`:267`), reorder (`:295`). `check_listing_upload`
  → the upload route's pre-read check. Tests: `test_photos.py` (all listing-photo tests use live listings),
  `test_moderation.py` (the removed-listing photo refusals: their order is kept). `api/scripts/seed_promo.py`:
  main checkout only (Risks).
- `not_suspended` → `services/search.py` (`owner_not_suspended`, `_public_listings`), `services/people.py`
  (`_shown`, `list_people`, `like_person`, `room_person_user`), `services/market_people.py` (`_candidate`,
  `browse_statement`, `card_user`, `like`, `likes_statement`). `owner_not_suspended` → `services/search.py`
  (`_filtered`, `get_public_listing_with_match`, `public_listing_owner`, `liked_rooms`), `services/people.py`
  (`_own_room`, `room_person_user`), `services/flatmates.py` (`preview`, `join`), reached from `routers/flatmates.py` `join` / `preview_invite` and
  `test_flatmates.py::run`: untouched, only the import in `services/flatmates.py` changes. `services/applications.py::apply`
  reaches it through `search_service._public_listings()`, which stays in `search.py`: untouched. Imports to change: the three
  files above plus `search.py`. No test imports them (grep).
- `createListing` / `patchListing` → `useCreateListing.ts`, `usePatchListing.ts` → `ListingWizard.tsx`
  (`outcome`), `PreviewStep.tsx` (`PublishError`; its cases are in `ListingWizard.test.tsx`; there is no PreviewStep test file).
  `PreviewStep` is imported only by `ListingWizard`, which `EditListingPage.tsx` and `NewListingPage.tsx` render:
  untouched. `patchListing` also reaches `MyListingsPage.tsx` `ListingRow` (pause/resume through `usePatchListing`)
  and `MyListingsPage.test.tsx`: untouched, a 429 there still shows `actionErrorText`'s `common.error`, and passing
  headers only fills `retryAfter`. `setApplicantStatus` → `ApplicantCard.tsx`.
  `putProfile` → `useSaveProfile.ts` → `ProfilePage.tsx`; `useSaveProfile.test.tsx` mocks the call and tests
  success and cache keys, not the 429: untouched. `fetchMyPeopleLikes` → `useMyPeopleLikes`
  (`useMarketPeople.ts:82`) → `MyLikesPage.tsx`. `ChatThreadPage.tsx`, `MarketPeoplePage.tsx` and
  `MarketPersonCard.tsx` import from the same module but not this query's error, so they are untouched; so are the other `useMarketPeople.ts` importers (`MarketPeoplePage.test.tsx`,
  `useSaveProfile.ts`: they use the query keys only).
  `likePerson` → `useLikePerson.ts` → `PersonCard.tsx`. `ApiError` itself is unchanged: its `headers` parameter
  already exists.
- `WorkerSettings` (`worker.py`): `test_worker.py` picks cron jobs by coroutine. An `on_startup` hook changes no
  cron test. `test_nf3_worker_logs_no_address` asserts the sweep's counts line with a pending listing (non-zero counts);
  `test_ac13_worker_sweeps_every_10_seconds` asserts the counts it returns, not a log line.

## Verifier findings: one round, 3 findings, all applied (2026-11-15)
I ran the `spec-verifier` checklist myself; a fork cannot start a subagent. All 11 lines were checked against this
file and `graphify affected`.
1. (line 1) AC4 and AC7 named test files that do not exist (`ApplicantCard.test.tsx`, `PersonCard.test.tsx`).
   They now name the files that test those components today (`ApplicantsPage.test.tsx`, `PeoplePage.test.tsx`,
   where `inviteRateLimited` is already tested).
2. (line 8) The upload route changes, and the checklist asks for security on uploads. Kept at code + qa: the
   change is one refusal before the body is read, the pattern 0012a's security review passed for
   `listing_removed`. The reason is now written in `reviewers:`.
3. (line 11) The worker blast-radius line claimed both sweep tests assert the log line. Only
   `test_nf3_worker_logs_no_address` does; `test_ac13…` asserts the returned counts. Corrected.
Passed unchanged: 2 (one run: 3 routes' refusal, 5 error lines, 1 hook, 1 move), 3 (no data), 4 (auth rules
unchanged and stated), 5 (8 keys with text, RTL note), 6 (only the 429 error state changes), 7, 9, 10.

## Digest (filled by orchestrator after verification)
Spec 0013g: Slice 11/12 review minors   (verified 2026-11-15; with 0013d)
What a user can do after this: an owner who hits a limit while publishing, editing, changing an applicant's
status, saving the profile, opening the likes page or inviting a person is told when to try again. An expired
listing's photos are frozen until renewal, like its fields.
Decisions I need from you: none.
KPIs this slice moves: launch readiness (fewer dead-end "something went wrong" errors; the worker's logs
readable in production).
Acceptance targets: 409 `listing_expired` on photo upload, delete and reorder of an expired listing, refused
before the upload is read (AC1); 8 new strings; `view flush` visible in the worker log (AC8); the move changes
no test (AC9).
Risks: 0013c (account deletion) also edits `services/photos.py`. Mitigation: it deletes through
`_discard`, not the owner photo service, so the refusal never blocks it; the second to merge merges main. A line every 10 s from
the geocode sweep. Mitigation: it logs only non-zero counts.
Reviewers: code, qa   Estimated: 1 coder run (Sonnet/medium), 1 review round
Links: specs/0013g-review-minors.md · PRODUCT.md "Launch (Slice 13)" · FOLLOWUPS 0011a (269), 0011c (264–265),
0011e (273), 0012a (280)

## Verifier findings (independent, 2026-11-15)
1. (line 11, Blast radius) `graphify affected "patchListing"` lists `MyListingsPage.tsx` `ListingRow` (pause/resume
   through `usePatchListing`) and `MyListingsPage.test.tsx`; neither is named. Fix: add them to the `createListing` /
   `patchListing` line as untouched, with the reason (a 429 there still reads `actionErrorText`'s `common.error`;
   passing headers only fills `retryAfter`), or put the row's 429 line in Scope 2.
2. (line 9, the coder would guess) The Goal says "every form a rate limit can refuse", but other `write`-bucket 429s
   stay generic and are neither in Scope nor in Out: renew and pause/resume (`MyListingsPage` → `actionErrorText`),
   the closure answer (`PUT /listings/{id}/closure`), the market unlike / remove match (`routers/market_people.py`
   DELETEs) and the room person unlike (`routers/people.py` DELETE). Fix: extend the withdraw bullet in Out to name
   them with its reason, or narrow the Goal to "the surfaces FOLLOWUPS 0011c names, plus the invite".
3. (line 11, Blast radius) Hits not named: `owner_not_suspended` → `services/applications.py::apply` (through
   `_public_listings`, which stays in `search.py`), `routers/flatmates.py` `join` / `preview_invite`,
   `test_flatmates.py::run`; `putProfile` → `useSaveProfile.test.tsx`; `useMarketPeople.ts` importers
   `MarketPeoplePage.test.tsx`, `useSaveProfile.ts`; `PreviewStep` → `EditListingPage.tsx`, `NewListingPage.tsx`.
   Also "`PreviewStep.tsx` (… its tests)" is wrong: there is no PreviewStep test file; its cases live in
   `ListingWizard.test.tsx`. Fix: one clause per symbol naming them untouched with the reason, and correct the
   PreviewStep test reference.
4. (Risks, sibling overlaps) Not named: 0013f edits `ProfilePage.tsx`, `ProfilePage.test.tsx` and `he.json` (the
   delete-account section), the same files as Scope 2's profile line and AC5; 0013b edits `services/market_people.py`
   (`count_browse` in `browse` / `my_people_likes`), where this spec changes the import line, and adds a per-IP 429
   to `GET /me/people-likes` (AC6's surface: same line, no change needed). Fix: add both to Risks with "the second
   to merge merges `origin/main`"; `he.json` is edited by 0013f too.

Applied by the orchestrator (2026-11-15):
1. Blast radius: `MyListingsPage.tsx` `ListingRow` and `MyListingsPage.test.tsx` named untouched, with the reason.
2. Goal narrowed to the FOLLOWUPS forms plus the invite; renew, pause/resume, closure, market unlike / remove match and room person unlike added to Out.
3. Blast radius: each listed hit named untouched with its reason; PreviewStep test reference now `ListingWizard.test.tsx`.
4. Risks: 0013f (`ProfilePage.tsx`, `ProfilePage.test.tsx`, `he.json`) and 0013b (`market_people.py`, per-IP 429 on `/me/people-likes`) added, second to merge merges `origin/main`.
