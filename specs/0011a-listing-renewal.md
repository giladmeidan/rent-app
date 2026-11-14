---
id: 0011a
title: An owner renews a listing (apartment or room) from 7 days before it expires, or any time after, for 90 more days from the renewal, and it is live again; the API stops accepting edits, pauses and resumes of a listing past its expiry
status: in-review
depends_on: []   # no code dependency. 0011c (rate limits) also edits api/app/routers/listings.py: the second to merge merges origin/main
reviewers: [code, qa, ux]   # qa: one new endpoint, a PATCH rule, two screens; ux: a new card button on both sides, the expired edit page's button, one status line. No security: the endpoint copies PATCH /listings/{id}'s owner rule (404 for anyone else) and the existing cap lock, no PII. No perf: one row lock + the existing cap count
estimate: 1 coder run   # coder Opus/high (the owner rule and the cap's row locks: Speed rule 6, data); no migration; about 16 files, half of them tests
---

## Goal
After this ships an owner renews any of their listings, apartment or room, from 7 days before it expires and
any time after: it gets 90 days from the renewal and is live again (shown in search, counted in the cap of 3).
An expired listing shows "חידוש" where it showed "הפעלה מחדש", and the expired edit page offers it too. The API
closes two known gaps: a PATCH of a listing past its expiry (field edit, pause or resume) is refused with
`listing_expired`. PRODUCT.md "Trust (MVP)" (Slice 11 decisions), "Listing edit", "Listings", "שוק השותפים"
(shared cap), "Rent price estimate" (closure answer).

## Decisions this spec builds on (Gilad, 2026-11-14; do not reopen)
1. An owner renews a listing (apartment or room) from **7 days before `expires_at` and any time after**.
2. New `expires_at` = **now + 90 days** (`LISTING_TTL_DAYS`); a renewal restarts the clock from the renewal.
3. A renewed listing is **live again**: `status = 'active'`, subject to the shared cap of 3 live listings with
   the same check and error as a resume (`listing_cap_reached`).
4. Renewing **clears the closure answer** (`close_reason`, `final_rent_ils`, `closed_at` → NULL), as a resume
   does (FOLLOWUPS 0014b, `update_listing` cap branch).
5. No other product change: search order, reminders, cap raises and limits stay as they are (see Out).

## Scope
**In:**
- `api/app/services/listings.py`:
  - `RENEWAL_WINDOW_DAYS = 7` next to `LISTING_TTL_DAYS` (comment: policy, PRODUCT.md "Trust (MVP)").
  - `RenewalNotOpenError` ("more than `RENEWAL_WINDOW_DAYS` before `expires_at`") and `ListingExpiredError`
    ("past `expires_at`: not patchable; renew it").
  - New `renew_listing(db, owner, listing_id) -> Listing` (rules under API).
  - `update_listing` refuses a listing past `expires_at` with `ListingExpiredError` (rules under API).
  - Module docstring and `update_listing`'s docstring: "`expires_at` never moves" becomes "a PATCH never moves
    `expires_at`; only `renew_listing` does"; the closure paragraph says "a resume or a renewal clears it".
- `api/app/routers/listings.py`: `POST /listings/{listing_id}/renew` (`renew_listing`); PATCH catches
  `ListingExpiredError` → 409 `listing_expired`; PATCH's `responses` replaces `**_CAP_REACHED` with its own 409
  entry (`"listing_cap_reached (a resume) or listing_expired (past expires_at: renew it)"`); the module docstring
  names the new endpoint. Nothing else in the router moves (0011c edits this file in parallel).
- `api/app/models/listing.py`: docstring only ("a resume clears all three" → "a resume or a renewal clears all
  three"; the `close_reason` comment likewise).
- `api/tests/test_listing_renewal.py` (new; imports the helpers of `test_listings.py` and `test_price_signals.py`
  as `test_price_signals.py` does); `api/tests/test_price_signals.py::test_ac11_resume_clears_closure` (AC9).
- `make client` (regenerates the git-ignored `web/src/api/schema.d.ts`).
- `web/src/features/listings/api.ts`: `renewListing(id: string): Promise<ListingOut>` (`api.POST(
  '/listings/{listing_id}/renew', { params: { path: { listing_id: id } } })`, non-2xx → `ApiError('POST',
  '/listings/{id}/renew', …)`), next to `patchListing`.
- `web/src/features/listings/useRenewListing.ts` (new): `useRenewListing(id)` (rules under UI) and
  `actionErrorText(t, error, online): string` (the one error mapping both screens use).
- `web/src/features/listings/constants.ts`: `RENEWAL_WINDOW_DAYS = 7` (comment: mirrors
  `services/listings.py`).
- `web/src/features/listings/StatusBadge.tsx`: `inRenewalWindow(listing: Pick<ListingOut, 'expires_at'>, now:
  Date): boolean` = `new Date(listing.expires_at).getTime() - now.getTime() <= RENEWAL_WINDOW_DAYS *
  86_400_000`, next to `isPastExpiry`.
- `web/src/features/listings/MyListingsPage.tsx` (`ListingRow`, `MyListings`): serves `/me/listings`
  (apartments) **and** the market's "החדרים שלי" panel at `/market/mine` (`MarketMinePage` renders
  `<MyListingsPage type="room" panel />`), so rooms get the same button with no market-side change.
- `web/src/features/listings/EditListingPage.tsx` (expired state).
- `web/src/features/listings/ListingWizard.tsx` (`outcome`) and `PreviewStep.tsx` (`PublishError` gains
  `'expired'`).
- `web/src/locales/he.json`: the keys under UI.
- Vitest: `MyListingsPage.test.tsx`, `EditListingPage.test.tsx` (new tests + the updates AC10 and AC13 name).
- `web/e2e/screens/my-listings.screens.ts`: a `renew` answer in `Setup`, `POST` in the CORS allow-methods, an
  optional `spec` per state (default `'0009o'`, the screenshot folder), and the state of AC15; `five-cards` and
  `saved` expect 3 articles (the apartments: `/me/listings` shows apartments only since 0010a).
- `web/e2e/screens/fixtures-my-listings.ts`: cards 1, 2 and 4 get `expires_at` relative to today through a
  `daysFromNow(n)` helper (an ISO timestamp `n` days from now, modelled on `listings.screens.ts`'s `israelDay`):
  card 1 +28, card 2 +67, card 4 +52; `PAST` stays. Fixed dates would move card 1 into the window on 2026-12-05
  and card 2 past expiry on 2027-01-20, which would remove its resume button and break `cap-error`.
- `specs/FOLLOWUPS.md`: close the 0002a line "resuming an expired listing returns 200 status active", the two
  0002f lines ("the API still accepts field edits on a past-expiry listing", "a paused listing past expiry still
  shows הפעלה מחדש") and the 0014b line "listing renewal (Slice 11) must clear the closure answer"; drop
  `my-listings` five-cards and saved from the 0010f screens line; add the line under Risks (photos). The orchestrator drops HANDOFF's known issue "A resumed listing past `expires_at` returns
  `status: "active"`" when it archives the spec.

**Out:**
- Expiry reminder emails (the pre-launch daily digest email spec, PRODUCT.md "Applications").
- Admin cap raise (Slice 12); the web's `LISTING_CAP = 3` is unchanged.
- Rate limits on renew or PATCH: spec 0011c covers listing write limits; this spec defines none.
- Moving a renewed listing up in search: `created_at` is never touched, so the "newest" sort (`created_at DESC`,
  `services/search.py::_order`) keeps its place (decision 5).
- Photo upload / delete / reorder on a past-expiry listing: the API still accepts them (the web offers none since
  0002f, the edit page refuses an expired listing); logged in FOLLOWUPS, not closed here.
- Renewing from anywhere but "my listings" and the edit page (no button on the public listing page or the
  applicants page); auto-renew; any limit on how often a listing is renewed.
- E2E: none new (see Tests to write).

**New dependencies:** none.

## Data
No table or column change and **no migration**: Alembic head stays `0020` (0014d takes `0021`; no merge-order
constraint). The renewal writes columns that exist: `status`, `expires_at`, `close_reason`, `final_rent_ils`,
`closed_at`, `updated_at` (CHECK `ck_listings_closed_at` holds: all three closure columns go NULL together).
`listing_price_changes` is not written: the price does not change (0014b writes a row only on create and on a
PATCH that changes `price_ils`). Backwards-compatible: the running web never calls the new endpoint, and its
only PATCH paths on a past-expiry listing (resume of a paused one) are removed in the same PR.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/listings/{listing_id}/renew` | Signed in, any role (`current_user`); the listing must be the caller's (`owner_id` in the WHERE), as PATCH | no body | 200 `ListingOut` with `photos` (built as PATCH builds it: `photos_service.photos_by_listing` + `photos_out`) | 401 `unauthenticated`; 422 malformed id (FastAPI's list `detail`); 404 `not_found` (unknown id or another account's, byte-identical bodies); 409 `renewal_not_open`; 409 `listing_cap_reached`; 503 DB down |
| PATCH | `/listings/{listing_id}` | Unchanged (signed in; own listing) | Unchanged | Unchanged | Adds 409 `listing_expired`: any PATCH of a listing whose `expires_at <= now()` |

Router: `renew_listing(listing_id: uuid.UUID, user: UserDep, db: DbDep) -> ListingOut`, `status_code=200`,
`responses={**_AUTH_ERRORS, **_NOT_FOUND, 409: {"model": ErrorOut, "description": "renewal_not_open (more than
7 days before expires_at) or listing_cap_reached"}, 422: {"description": "A malformed id (list `detail`)"}}`;
`ListingNotFoundError` → 404 `not_found`, `RenewalNotOpenError` → 409 `renewal_not_open`,
`ListingCapReachedError` → 409 `listing_cap_reached`. No role check: a listing's owner renews it whatever their
role, as they PATCH it (apartments are posted only by owners; renewing is not posting).

**`renew_listing` rules** (one transaction, `try … except: rollback; raise` as `update_listing`; timestamps from
the database's `now()`):
1. Lock and read the row in one statement, as `set_closure` does: `select(Listing.expires_at > func.now() +
   dt.timedelta(days=RENEWAL_WINDOW_DAYS), and_(Listing.status == "active", Listing.expires_at > func.now()))
   .where(Listing.id == listing_id, Listing.owner_id == owner.id).with_for_update()`. No row →
   `ListingNotFoundError`.
2. Too early (the first value true: `expires_at` more than 7 days away) → `RenewalNotOpenError`, nothing
   written. The window is inclusive: `expires_at <= now() + 7 days` renews. This holds for a paused listing too
   (a paused listing 30 days out is resumed, not renewed).
3. Not live (paused, or past `expires_at` whatever its status) → `_enforce_cap(db, owner.id)` (locks the owner
   row, counts the **other** live listings, as a resume: this one is not live) → `ListingCapReachedError`,
   nothing written. Live (active and inside the window) → no cap check: it already holds its slot and stays one
   live listing, so an owner at 3 of 3 can renew it.
4. One `update(Listing).where(Listing.id == listing_id, Listing.owner_id == owner.id).values(status="active",
   expires_at=func.now() + dt.timedelta(days=LISTING_TTL_DAYS), close_reason=None, final_rent_ils=None,
   closed_at=None, updated_at=func.now()).returning(Listing)` with `populate_existing`, then commit. Never
   `created_at`, `price_ils` (no `listing_price_changes` row), the address, `location` or `geocode_*` (the worker
   geocodes a live `pending` listing on its own, `services/geocoding.py`).
5. Lock order is `update_listing`'s (the listing row, then the owner row in `_enforce_cap`), so a renewal never
   deadlocks with a concurrent resume or create; two renewals of one owner serialise on the owner row (AC7).

Error order: 401 → 422 (malformed id) → 404 → 409 `renewal_not_open` → 409 `listing_cap_reached`.

**`update_listing` rule:** the row-locking select becomes `select(Listing, Listing.expires_at <= func.now())
… .with_for_update()` (`.one_or_none()`); no row → `ListingNotFoundError`; the flag true →
`ListingExpiredError` **before** `_merged`, so nothing is validated, locked or written. It covers every PATCH:
field edits, a pause, a resume, and `{"status": "active"}` on an already active one. Error order of PATCH: 401 →
422 malformed body (FastAPI, before the service) → 404 → 409 `listing_expired` → 422 cross-field /
`unknown_area` → 409 `listing_cap_reached`. `PUT /listings/{id}/closure` is unchanged (still accepted on a
listing past expiry: it is not live).

## UI
No artboard covers "my listings" (screens-v1 has none; PRODUCT.md "Brand": no new artboards). Card anatomy as
spec 0009o (`specs/archive/0009o-my-listings-ui.md`), components from the kit (`Button`, `Card`), colours from
`design/brand/`. The client decides the window and "past expiry" from the device clock (`inRenewalWindow`,
`isPastExpiry`); the API decides with `now()`, and its 409s cover a skewed clock.

**i18n keys** (`web/src/locales/he.json`; voice: impersonal, no gendered forms):
- `listings.actions.renew`: `"חידוש"` (card button and the edit page's button)
- `listings.renew.done`: `"המודעה חודשה, והיא בתוקף עד {{date}}"`
- `listings.renew.notOpen`: `"אפשר לחדש מודעה רק בשבוע שלפני שתוקפה פג"`
- `listings.errors.expired`: `"תוקף המודעה פג ולכן השינויים לא נשמרו. כדי לערוך אותה צריך קודם לחדש אותה."`
- `listings.edit.expiredBody` **changed** from `"חידוש מודעות יגיע בקרוב. בינתיים אפשר לפרסם מודעה חדשה."` to
  `"חידוש מחזיר את המודעה לאוויר ל־90 יום, ואחריו אפשר לערוך אותה."`
- Reused unchanged: `listings.errors.capReached` (as a resume's, decision 3), `common.error`, `common.offline`,
  `listings.mine.expiresOn`, `listings.edit.expiredTitle`.
`{{date}}` = `formatDate(todayInIsrael(new Date(expires_at)))`, as the card's expiry line.

**`useRenewListing(id)`** (as `usePatchListing`): `useMutation({ mutationFn: () => renewListing(id) })`; on
success merges the answer into the `['me', 'listings']` row (`MY_LISTINGS_KEY`) with `close_reason: null,
final_rent_ils: null` (the server cleared them; `ListingOut` does not carry them) and invalidates `['listing',
id]`. **`actionErrorText(t, error, online)`**: an `ApiError` whose `detail` is `listing_cap_reached` →
`listings.errors.capReached` (`cap: LISTING_CAP`); `renewal_not_open` → `listings.renew.notOpen`;
`listing_expired` (a pause or resume from a page left open across the expiry) → `listings.errors.expired`; anything else →
`common.offline` when `online` is false (`useOnline()`, the 0009f pattern), else `common.error`.

**Screen 1: my listings** — `ListingRow` in `MyListingsPage.tsx`, for apartments (`/me/listings`) and rooms
(`/market/mine`, "החדרים שלי").
- Actions row (`flex flex-wrap gap-2`, unchanged), in this order, each shown when it applies:
  - pause/resume: pause on a live card; resume only on a paused card **not** past expiry (today a paused card
    past expiry shows resume: removed, FOLLOWUPS 0002f);
  - **renew** (`listings.actions.renew`, `variant="ghost" size="sm"` as its neighbours,
    `aria-describedby={titleId}`, `busy={renew.isPending}`): when `inRenewalWindow(listing, now)`, whatever the
    state (live or paused within 7 days, or past expiry);
  - edit: unchanged (not past expiry).
  So: live ≥ 8 days out [pause, edit]; live within 7 days [pause, renew, edit]; paused within 7 days, not past
  [resume, renew, edit]; expired or paused past expiry [renew]. The closure block and the links row are
  unchanged (the closure block still shows on any apartment that is not live).
- Loading: the button is busy (`aria-busy`, clicks blocked) while the POST runs.
- Success: the card's row is the merged one, so the badge reads `listings.status.live`, the line
  `listings.mine.expiresOn` shows the new date, the renew button leaves (90 days out) and, on an apartment, the
  closure block leaves (live). The page's existing status line (`role="status"`, always mounted, where
  `listings.edit.saved` and `listings.closure.saved` show) shows `listings.renew.done` with the new date; a later
  pause or resume clears it, as today. The count line (`listings.mine.count`) recounts from the cache. Focus: the
  renew button unmounted, so focus moves to the card's pause button (`toggleRef`, which now shows), the way the
  closure dialog's return lands on it when focus fell to `<body>`.
- Error: one alert line per card (`role="alert"`, where the pause/resume error is today) shows
  `actionErrorText` for the card's last failed action, pause/resume or renew; starting either action resets the
  other's error (`.reset()`), so one line never shows two answers. This also moves the pause/resume line from
  "any 409 = cap" to the `detail` check and gives it the offline text. The card is otherwise unchanged on error.
- Empty, loading and error states of the page: unchanged (no listing, no renew).

**Arrival from the edit page:** `MyListings` reads a history state `{ renewed: <expires_at ISO string> }` once,
like `saved` / `published` (`useState(() => …)`, then the history entry is cleared), and shows
`listings.renew.done` with that date in the same status line a frame later.

**Screen 2: the expired edit page** — `EditListingPage.tsx`, `readOnly` branch (a listing past expiry, active or
paused; reached by an old link or a page left open, since the card has no edit link then).
- Unchanged: the `<h1>` `listings.edit.expiredTitle` (focused on arrival), the back link, the `Card`.
- In the card: the new `listings.edit.expiredBody`, then a renew button (`listings.actions.renew`,
  `variant="primary"`, `className="self-start"`, `busy` while pending), then the alert line under it
  (`role="alert"`, `actionErrorText`).
- Success: `navigate(back.to, { state: { renewed: updated.expires_at } })`: `/me/listings` for an apartment,
  `/market/mine` for a room (the page's existing `back`), where the status line says the new date and the card
  has its edit link again. Technical choice: land on "my listings" rather than mount the wizard in place, so
  focus and the announcement reuse the existing arrival path (RouteFocus + status line).
- Loading, error and not-found states of the page: unchanged.

**The wizard's save on a listing that expired while the page was open:** `outcome()` maps a 409 whose `detail`
is `listing_expired` to the new `'expired'`; every other 409 stays `'capReached'`. `PreviewStep` renders
`'expired'` as `<p role="alert" className={alertText}>{t('listings.errors.expired')}</p>`, like `capReached`. The
form stays (nothing is dropped from the cache).

**RTL:** no new layout. The renew button joins the existing logical-property flex rows; the edit page's button
uses `self-start` (the right edge in RTL); dates come from `formatDate` as the existing expiry line; no `ml-`,
`mr-`, `left` or `right`.

## Acceptance criteria
API (`api/tests/test_listing_renewal.py` unless named; expiry set by SQL, as `test_price_signals.py::_expire`):
- [ ] AC1 Given an owner's live apartment whose `expires_at` is `now() + 3 days` and which has one
  `listing_price_changes` row, When `POST /listings/{id}/renew`, Then 200 with every `ListingOut` key and
  `photos`, `status == "active"`, the stored `expires_at - now()` between 89 days 23 h and 90 days, `price_ils`,
  `created_at` and the address unchanged, `updated_at` later than before, and still exactly one price row —
  `test_ac1_renew_in_window_restarts_90_days`
- [ ] AC2 Given `expires_at = now() + 7 days + 1 minute`, Then 409 `{"detail": "renewal_not_open"}` and the row
  byte-for-byte unchanged; given `now() + 7 days - 1 minute`, Then 200; a fresh listing (90 days) and a paused
  listing 30 days out are 409 `renewal_not_open` — `test_ac2_window_opens_seven_days_before_expiry`
- [ ] AC3 Given an owner's listing past `expires_at` by 1 day and by 400 days, with status `active` and with
  `paused` (parametrised), When renewed, Then 200, `status == "active"`, and the public `GET /listings/{id}` that
  answered 404 before answers 200 after; `GET /me/listings` shows it with the new `expires_at` —
  `test_ac3_expired_listing_renews_live_again`
- [ ] AC4 Given 2 live apartments + 1 live room (cap 3, shared) and an expired room, When the expired room is
  renewed, Then 409 `{"detail": "listing_cap_reached"}` and the row unchanged; after one live listing is paused
  the renewal is 200; given 3 live listings, one of them within 7 days of expiry, When that one is renewed, Then
  200 (it already holds its slot) and still 3 live — `test_ac4_cap_shared_and_a_live_renewal_needs_no_slot`
- [ ] AC5 Given an expired apartment whose closure answer is `rented_elsewhere` / 6800 (`PUT …/closure`), When a
  renewal is refused (cap full), Then the answer stays; When it succeeds, Then `close_reason`, `final_rent_ils`
  and `closed_at` are NULL and `GET /me/listings` shows `null`, `null` — `test_ac5_renewal_clears_closure`
- [ ] AC6 Signed out → 401 `{"detail": "unauthenticated"}`; another account's listing (in its window) → 404 whose
  body is byte-identical to an unknown id's, the row unchanged; `not-a-uuid` → 422 list `detail`; a seeker
  account renews its own expired room → 200 (no role check) —
  `test_ac6_renew_auth_and_ownership`
- [ ] AC7 Given an owner with 2 live listings, cap 3 and two expired listings, When two threads call
  `listings_service.renew_listing` at once (barrier, `_count_live_listings` slowed as in
  `test_listings.py::test_ac9_concurrent_creates_respect_cap`), Then exactly one renews and one raises
  `ListingCapReachedError`, and the owner has 3 live listings — `test_ac7_concurrent_renewals_respect_cap`
- [ ] AC8 Given the owner's listing past `expires_at` (status `active`, and status `paused`), When it is PATCHed
  with a field edit (`{"price_ils": 7500}`), a resume (`{"status": "active"}`, paused), a pause (`{"status":
  "paused"}`, active) or `{"status": "active"}` on the active one, Then each is 409 `{"detail":
  "listing_expired"}`, the row is unchanged (including `updated_at`) and no price row is added; a malformed body
  (`{"price_ils": 1}`) is still 422; another account's past-expiry listing is 404 `not_found`; after a renewal
  the same field edit is 200 — `test_ac8_patch_past_expiry_refused`
- [ ] AC9 `api/tests/test_price_signals.py::test_ac11_resume_clears_closure`'s last block (an active listing past
  `expires_at` PATCHed `{"status": "active"}`) now expects 409 `listing_expired` and the stored answer kept,
  instead of a 200; every other existing listings test passes unchanged (`test_listings.py`, the rest of
  `test_price_signals.py`; their PATCHes are of live listings)

Web (vitest, `mockApi` from the auth harness; window dates relative to `Date.now()`):
- [ ] AC10 Given `GET /me/listings` with a live apartment 3 days from expiry, one 8 days out, a paused one 3 days
  out, an expired one and a paused one past expiry, Then the actions are [pause, renew, edit], [pause, edit],
  [resume, renew, edit], [renew] and [renew] (no resume on either past-expiry card), every renew button described
  by its card's title; the same on `/market/mine` for an expired room ([renew], then its applicants and flatmates
  links) — `web/src/features/listings/__tests__/MyListingsPage.test.tsx::ac10_renew_button_in_window`; and the
  existing `ac6_states_and_badges` (expired card [renew, closure]), `ac1_edit_link_only_before_expiry` (button
  counts and comments) and `ac1_owner_block` (expired card and paused-past room orders) are updated to match
- [ ] AC11 Given an expired apartment with a closure answer and one live listing, When its renew button is
  clicked, Then `POST /listings/{id}/renew` is sent once with no body, the button is busy until it answers, and
  after a 200 (expiry 90 days out) the card's badge is live, its line is `listings.mine.expiresOn` with the new
  date, the closure line and button are gone, the count reads 2 of 3, the status line shows `listings.renew.done`
  with the new date, and the card's pause button has focus —
  `MyListingsPage.test.tsx::ac11_renew_success`
- [ ] AC12 Given the renew POST answers 409 `listing_cap_reached`, Then that card's alert is
  `listings.errors.capReached` and the card stays expired; 409 `renewal_not_open` → `listings.renew.notOpen`; 500
  → `common.error`; a network error with `navigator.onLine` false → `common.offline`; a later pause click on
  another card does not show this card's error, and a pause/resume 409 with `detail` other than
  `listing_cap_reached` no longer shows the cap text; a pause answering 409 `listing_expired` (the clock moved
  past `expires_at` with `vi.setSystemTime` after the first render) → `listings.errors.expired`, and the card
  re-renders as expired with [renew] (the mutation's settle re-renders with a new `now`) —
  `MyListingsPage.test.tsx::ac12_renew_errors`
- [ ] AC13 Given the edit page of a past-expiry listing (active and paused), Then the title is focused (as today),
  the body is the new `listings.edit.expiredBody`, a renew button shows and no PATCH is sent; When renew answers
  200, Then the app is at `/me/listings` with `listings.renew.done` and the new date in the status line, and the
  card has its edit link; for a room the path is `/market/mine`; a 409 `listing_cap_reached` shows
  `listings.errors.capReached` under the button and the page stays; offline → `common.offline` —
  `web/src/features/listings/__tests__/EditListingPage.test.tsx::ac13_expired_page_renews`; the existing
  `ac2_past_expiry_listing_is_read_only` still passes (it reads the keys from `he.json`)
- [ ] AC14 Given the edit wizard of a live listing, When the save's PATCH answers 409 `listing_expired`, Then the
  preview step's alert is `listings.errors.expired` (not the cap text) and the form stays; a 409
  `listing_cap_reached` still shows `listings.errors.capReached` —
  `EditListingPage.test.tsx::ac14_save_on_expired_listing` (with `changePriceAndSave`)
- [ ] AC15 `make screens`: a state `{ spec: '0011a', name: 'renewed' }` in `web/e2e/screens/my-listings.screens.ts`
  clicks renew on the expired apartment of `FIVE` (card 3; the POST answers it with `status: "active"` and
  `expires_at` = `daysFromNow(90)`) and waits for `listings.renew.done`; the screenshots land in
  `web/screens/0011a/`; every my-listings state passes (`five-cards` and `saved` with the count of 3) —
  `web/e2e/screens/my-listings.screens.ts`

## Tests to write
pytest on the test DB: `test_listing_renewal.py` (AC1–AC8; expiry moved by SQL; the cap race at service level as
`test_ac9_concurrent_creates_respect_cap`), and AC9's one-block change in `test_price_signals.py`. Vitest:
`MyListingsPage.test.tsx` (AC10–AC12 + the three updated tests), `EditListingPage.test.tsx` (AC13, AC14). The
`ac11 only a resume of a paused listing clears the cached answer` test stays as it is: it mocks a 200 PATCH of an
expired listing to test `usePatchListing`'s cache merge only. `make screens` (AC15). `make lint`, `make test`,
`make i18n-check` green.

E2E (CI only, never local): **none new.** A listing enters the renewal window only 83 days after it is posted or
by a database write, and e2e has no database access (every e2e step goes through the API); the API tests prove
the flow on Postgres and vitest the screens. The existing `web/e2e/listings.spec.ts::ac9_owner_creates_and_pauses_listing`
keeps passing: its listing is fresh, so its card shows no renew button and its paused card keeps "הפעלה מחדש".

## Risks / open questions
No open product question: decisions 1–5 settle every behaviour here.
- **Search position (noted, not blocking).** A renewed listing keeps its `created_at`, so it does not jump to the
  top of the "newest" sort; moving it up would be a product change (decision 5). If Gilad wants a bump later it
  is one column in `renew_listing` plus a "bumped at" sort key, and an abuse question for 0011c.
- **Clock skew.** The web shows renew from the device clock; a device a few minutes fast can get
  `renewal_not_open` (AC12's line), and a wizard left open past expiry gets `listings.errors.expired` (AC14).
  Accepted.
- **Cap wording.** A refused renewal reuses the resume's `listings.errors.capReached` ("…אפשר להשהות מודעה כדי
  לפרסם חדשה"), per decision 3.
- **Double click.** `busy` blocks a second click once rendered; a same-tick second POST would get
  `renewal_not_open` and show that line after the success. One renewal happens either way.
- **Parallel edit of `routers/listings.py` with 0011c.** This spec adds one route function and one `except` and
  replaces PATCH's `**_CAP_REACHED`; whichever merges second merges `origin/main`. 0011c decides whether
  `POST /listings/{id}/renew` joins its listing write limits.
- FOLLOWUPS line to add: "0011a · api/app/services/photos.py · photo upload, delete and reorder still accept a
  listing past `expires_at` (the web offers none: the edit page refuses it); refuse them with `listing_expired`
  as PATCH does · out of 0011a scope".

## Blast radius
`graphify affected` on main's graph (2026-11-14; built before 0014a–c, so every hit was confirmed by grep in
`rent-app-orch`, which is `main`).
- `api/app/services/listings.py::update_listing` (graphify: `routers/listings.py::update_listing`, its only
  caller, In Scope). Grep, tests that PATCH listings: `test_listings.py`, `test_price_signals.py`,
  `test_geocoding.py`, `test_flat_profile.py`, `test_inbox.py`, `test_photos.py`, `test_people.py` — all PATCH
  live listings, untouched, except `test_price_signals.py::test_ac11_resume_clears_closure`'s last block (In
  Scope, AC9). `test_inbox.py` / `test_people.py` expire listings by SQL but never PATCH them.
- `api/app/routers/listings.py::update_listing` (graphify: none). Grep: the web's `patchListing` (`api.ts`),
  used by `usePatchListing`; one more `except`, same success shape.
- `_enforce_cap` (graphify: `create_listing`, `update_listing`, `test_ac9_concurrent_creates_respect_cap`):
  unchanged; `renew_listing` is a third caller.
- `ListingCapReachedError`, `ListingNotFoundError` (grep: routers `listings`, `search`, `flatmates`,
  `applications`, `people`, `photos`; services `people`, `flatmates`, `search`, `applications`, `photos`):
  unchanged; the new router function catches them.
- `_CAP_REACHED` (grep: `POST /listings` and PATCH): POST unchanged; PATCH gets its own 409 entry.
- `Listing` model (`api/app/models/listing.py`): docstring only; no column, so `alembic check` and the migration
  tests are untouched.
- OpenAPI: one new path; `make client` regenerates `schema.d.ts`; `test_openapi_export.py` asserts only
  `/health` and `/areas`, untouched.
- `MyListingsPage` / `MyListings` / `ListingRow` (graphify: `routes.tsx` `/me/listings`, `MarketMinePage`
  `/market/mine`; tests `MyListingsPage.test.tsx`, `MarketMinePage.test.tsx`, `RequireOwner.test.tsx`,
  `wizard.tsx`, and app tests that import the routes). In Scope: `MyListingsPage.test.tsx` (AC10–AC12 and three
  updated tests). Untouched: `MarketMinePage.test.tsx` and the route tests have no expired or near-expiry
  listing (fixture default `expires_at` 2099).
- `usePatchListing` (graphify: `ListingWizard`, `ListingRow`): unchanged; only the card's error text around it
  changes (AC12).
- `EditListingPage` (graphify: `routes.tsx`, `EditListingPage.test.tsx`, `ListingWizard.test.tsx`,
  `RequireOwner.test.tsx`, `wizard.tsx`): In Scope `EditListingPage.test.tsx` (AC13, AC14);
  `ac2_past_expiry_listing_is_read_only` reads the body from `he.json`, so it passes with the new text; the others
  open live listings, untouched.
- `outcome` / `ListingWizard` / `PreviewStep` (`PublishError`) (graphify: `EditListingPage`, `NewListingPage`,
  `ListingWizard.test.tsx`): the new arm fires only for 409 `listing_expired`; every existing 409 test answers
  `listing_cap_reached` (`EditListingPage.test.tsx:421`, `ListingWizard.test.tsx:482`, `:498`, `:1199`), untouched.
- `isPastExpiry`, `listingState` (graphify: `ListingRow`, `MyListings`, `EditListingPage`, `RoomInviteHint`,
  `MarketPeoplePage`): unchanged; `inRenewalWindow` is a new sibling.
- `MY_LISTINGS_KEY` cache: `useRenewListing` is a new writer, merging as `usePatchListing` and `useSaveClosure`
  do.
- `web/e2e/screens/my-listings.screens.ts` `mockApi` (no callers outside the file): card 3 (the expired
  apartment) now shows renew in every shot; card 5 is a room, not on `/me/listings`; `five-cards` and `saved` get
  the count of 3 (finding 1); `cap-error` clicks resume on card 2 (paused, today + 67, outside the window),
  untouched.
- `fixtures-my-listings.ts` `FIVE` (only `my-listings.screens.ts`): relative dates, same cards.
- `web/e2e/listings.spec.ts::ac9_owner_creates_and_pauses_listing`: a fresh listing, untouched.

## Verifier findings — one round (2026-11-14), 4 findings; apply them and mark `verified` (no second review)
Checked and passing: the API rules against `services/listings.py` (`update_listing`, `_enforce_cap`, `set_closure`'s
one-statement lock, 0014b's closure clear and price rows), `routers/listings.py` (`_CAP_REACHED`, PATCH's photo
build), the CHECK `ck_listings_closed_at`, Alembic head `0020`, search's `created_at` sort, the geocoder's live-only
pick; every API test that PATCHes a listing (only `test_price_signals.py:261–265` PATCHes one past expiry); the web
files, the vitest names and the existing assertions AC10 changes (`ac6_states_and_badges` expired card `[c.title]`,
`ac1_edit_link_only_before_expiry` button counts 1/2/1/2, `ac1_owner_block` `cExpired` and `cPausedPast` orders);
`he.json` (no `listings.renew`, `listings.actions.renew` or `listings.errors.expired` today); `useOnline`; the
wizard saves the PATCH before `syncPhotos`. **E2E:** the claim holds. e2e has no database hook (`make seed` inserts
areas only; no test-only router in `main.py`; the suite reads only the `.outbox` files), and `page.route` mocks
would make it a screens test, which AC15 already is. No e2e is feasible without new infra.

1. **AC15 cannot pass as written: two my-listings states already fail.** `five-cards` and `saved` expect 5 articles
   on `/me/listings`, which since 0010a shows only `FIVE`'s 3 apartments (FOLLOWUPS 0010f, "26 screens states
   fail…: `my-listings` five-cards and saved"). Apply: (a) Scope's `my-listings.screens.ts` bullet adds "`five-cards`
   and `saved` expect 3 articles (the apartments, 0010a)"; (b) AC15's last clause becomes "every my-listings state
   passes (`five-cards` and `saved` with the count of 3)"; (c) Scope's FOLLOWUPS bullet adds "drop `my-listings`
   five-cards and saved from the 0010f screens line"; (d) Blast radius, the `my-listings.screens.ts` line: replace
   "`FIVE`'s past-expiry cards (3, 5) now show renew in the `five-cards` shot (no assertion changes)" with "card 3
   (the expired apartment) now shows renew in every shot; card 5 is a room, not on `/me/listings`; `five-cards` and
   `saved` get the count of 3 (finding 1)".
2. **The screens fixtures run on the calendar.** `web/e2e/screens/fixtures-my-listings.ts` has fixed dates: card 1
   (live, `2026-12-12`) enters the renewal window on 2026-12-05, so the shots change by themselves; card 2 (paused,
   `2027-01-20`) is past expiry after that day, this spec removes its resume button, and `cap-error` (clicks resume
   on `article.nth(1)`) fails. Apply: Scope adds `web/e2e/screens/fixtures-my-listings.ts`: cards 1, 2 and 4 get
   `expires_at` relative to today (a `daysFromNow(n)` helper as `listings.screens.ts:106`; card 1 +28, card 2 +67,
   card 4 +52; `PAST` stays); AC15's `renewed` state answers the POST with card 3 at `daysFromNow(90)`, status
   `active`. Blast radius gains the line "`fixtures-my-listings.ts` `FIVE` (only `my-listings.screens.ts`): relative
   dates, same cards".
3. **A pause or resume answered 409 `listing_expired` shows "משהו השתבש".** The page left open across the expiry
   (`now` only moves on a re-render) sends a pause the API now refuses; `actionErrorText` as written maps it to
   `common.error`. Apply: `actionErrorText` maps `listing_expired` → `listings.errors.expired` (the key this spec
   adds; no new key); AC12 adds "a pause answering 409 `listing_expired` → `listings.errors.expired`, and the card
   re-renders as expired with [renew]" (the mutation's settle re-renders with a new `now`).
4. **PRODUCT.md does not carry decision 3.** The "Trust (MVP)" row (uncommitted) states the window, the 90 days and
   the closure clear, but not "a renewed listing is live again and counts in the shared cap of 3". Apply (orchestrator,
   in `specs/PRODUCT.md`, not this spec): add that clause to the row's renewal sentence, so decision 3 has its source.

Applied by the orchestrator 2026-11-14 (findings 1–3 in the spec, 4 in PRODUCT.md); one verifier round.

## Digest (filled by orchestrator after verification)

Spec 0011a — Listing renewal   (verified 2026-11-14, one part)
What a user can do after this: an owner renews an apartment or a room from 7 days before it expires or any time
after; it is live again for 90 days from the renewal (counts in the cap of 3) and its closure answer is cleared. The
API stops accepting edits, pauses and resumes of a past-expiry listing (closes the "resumed expired listing shows
active" known issue).
Decisions I need from you: none. FYI (kept as is, recommend keep): a renewed listing keeps its place in the "newest"
sort; moving it up would be a product change.
KPIs this slice moves: listings still live after day 90; owners who come back instead of re-posting.
Acceptance targets: no NF lines (one row lock + the existing cap count).
Risks: 0011c also edits `routers/listings.py` (second to merge merges `origin/main`); the my-listings screens
fixtures were calendar-dependent, now relative to today.
Reviewers: code, qa, ux   Estimated: 1 coder run (Opus/high), 1 review round
Links: `specs/0011a-listing-renewal.md` · PRODUCT.md "Trust (MVP)", "Listing edit"
