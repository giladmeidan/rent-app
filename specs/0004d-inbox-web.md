---
id: 0004d
title: An owner opens the applicants of a listing from "my listings", reads each applicant's name and message, filters by status, and shortlists, un-shortlists or declines them
status: done
depends_on: [0004b, 0004c]   # 0004c: the API; 0004b: the e2e helpers (signUp, postListing), ApplicationStatusChip and the he.json `applications.*` block this spec sits next to
reviewers: [code, qa, ux]    # ux: a new screen from the Inbox artboards and a changed card; no security: no new endpoint, ownership and PII exposure are 0004c's (security-reviewed there), messages render as text (NF2)
estimate: 1 coder run
---

## Goal
After this ships, an owner sees on each card of `/me/listings` a link "מועמדויות (12) · 5 חדשות", opens
`/me/listings/:id/applicants`, and gets the applicant inbox of `design/screens-v1/Inbox.dc.html` /
`InboxDesktop.dc.html` without the parts later slices own: the listing's title and price, totals (applicants,
shortlisted, new), filters (all / new / shortlist / declined), and one card per applicant with name, status,
date and message, with "לרשימה הקצרה", "הסרה מהרשימה" and "דחייה". Serves Dev Plan slice 4 (Apply + inbox),
part d of four (split in `0004a` Goal). API: `0004c`. PRODUCT.md "Chat — opens only on owner shortlist" (the
shortlist is stored here; chat is Slice 5).

## Scope
**In:**
- `web/src/features/listings/api.ts`: `export type MyListingOut = components['schemas']['MyListingOut']`;
  `fetchMyListings(): Promise<MyListingOut[]>`. `useMyListings` is typed by it (key unchanged).
  `usePatchListing.ts` `onSuccess`: **merge** the PATCH result into the cached row (`{ ...listing, ...updated }`,
  `setQueryData<MyListingOut[]>`) instead of replacing it, because `PATCH /listings/{id}` returns `ListingOut`
  without the two counts (one line; AC7 pins it). `useCreateListing.ts` `onSuccess`: prepend `{ ...created,
  applicant_count: 0, new_applicant_count: 0 }` with `setQueryData<MyListingOut[]>` (the POST's
  `ListingOut` has no counts either; verifier 1).
- `web/src/features/applicants/` (new feature folder):
  - `api.ts`: `ApplicantOut`, `ApplicantStatus` (generated schema); `fetchApplicants(listingId)`,
    `setApplicantStatus(listingId, applicationId, status)`, throwing `ApiError` (from `features/listings/api.ts`).
  - `useApplicants.ts`: key `['me', 'applicants', listingId]` (per-user, removed on logout by `useLogout`).
  - `useSetApplicantStatus.ts` (mutation, per card): server-confirmed, not optimistic — the cache is written only
    in `onSuccess(updated)` (replace by id in the applicants cache, then `invalidateQueries({ queryKey:
    MY_LISTINGS_KEY })` for the counts on "my listings"), so an error has nothing to roll back. On a **401** it
    calls `setQueryData(ME_KEY, null)` (`RequireOwner` then redirects to `/login`); on a **403** it calls
    `invalidateQueries({ queryKey: ME_KEY, exact: true })` (`RequireOwner` redirects to `/` once `/me` returns a
    seeker) — the same mechanism as `ListingWizard.onSaveError`, never a hard `navigate`.
  - `ApplicantsPage.tsx` and `ApplicantCard.tsx`: see UI.
- `web/src/features/applications/ApplicationStatusChip.tsx` (from `0004b`): props become a discriminated union
  `{ viewer?: 'seeker'; status: ApplicationStatus } | { viewer: 'owner'; status: ApplicantStatus }`; the owner
  labels are a `Record<ApplicantStatus, string>` of `applicants.status.*` keys (no `withdrawn` key, no fallback),
  the seeker labels stay `0004b`'s `Record<ApplicationStatus, …>`. `ApplicantCard` passes `viewer="owner"` and an
  `ApplicantStatus` (verifier 7).
- `web/src/app/routes.tsx`: `me/listings/:id/applicants` → `ApplicantsPage`, inside the existing
  `<Route element={<RequireOwner />}>`.
- `web/src/features/listings/MyListingsPage.tsx` `ListingRow`: a link to `/me/listings/{id}/applicants` on every
  card (live, paused, expired), after the edit link, ≥ 44 px, styled as it; text `applicants.link`
  (`{{count}}` = `applicant_count`) followed, when `new_applicant_count > 0`, by a pill `applicants.newBadge`
  (`{{count}}` = `new_applicant_count`, amber `bg-warn text-warn-text`, as the artboard's "חדש") **inside** the
  link, so the accessible name carries both; `aria-describedby` = the card title's id (as the edit link).
- `web/src/locales/he.json`: the keys in UI.
- Tests: `web/src/features/applicants/__tests__/ApplicantsPage.test.tsx` (new), `fixtures.ts` (new:
  `applicant(overrides)` → `ApplicantOut`); `web/src/features/listings/__tests__/fixtures.ts` `listing()` returns
  `MyListingOut` (`applicant_count: 0, new_applicant_count: 0` defaults); additions to
  `MyListingsPage.test.tsx` and `RequireOwner.test.tsx` (the applicants path joins its `PATHS` / `TITLES` and
  route tree, with `'GET /listings/A/applications': [json([])]`).
- E2E: `web/e2e/inbox.spec.ts` (new), using `0004b`'s `signUp` (with its `name` option, so the seeker is
  `'\u05de\u05d9\u05db\u05dc'` and the owner keeps the default) and `postListing` helpers, and the
  `rl:*` clear `0004b` adds to the `make e2e` target.

**Out:**
- Match score, "sorted by match", the applicant's age / household / occupation / move-in / "why the match is high"
  (artboards): Slice 6 and 7. Phone-verified badge: Slice 10/12.
- "צ'אט" and "הצעת סיור" (InboxDesktop detail pane): Slice 5.
- The listing's view count (artboard header): Gilad, 2026-11-10 — owners see applicant counts only; `MyListingOut`
  has no `view_count` (`0004c` Q-B).
- The desktop two-pane layout (list + selected applicant detail): one responsive column (`max-w-[640px]`), as
  `0003b` chose for search; FOLLOWUPS candidate for Slice 9.
- An all-listings inbox ("כל המודעות" on desktop, "מועמדויות" in the artboard's bottom tab bar): per listing only.
- Undoing a decline (`0004c` Q6). Bulk actions. Marking as seen ("new" = submitted).

**New dependencies:** none.

## Data
None. Consumes `0004c`'s API.

## API
No endpoint is added or changed here. Consumed:
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /me/listings (`0004c`) | owner session | – | 200 `list[MyListingOut]` (with `applicant_count`, `new_applicant_count`) | 401 · 403 · 503 |
| GET | /listings/{id}/applications (`0004c`) | owner session, own listing | – | 200 `list[ApplicantOut]` | 401 · 403 · 404 · 422 · 503 |
| PATCH | /listings/{id}/applications/{application_id} (`0004c`) | owner session, own listing, application of that listing | `{"status": "shortlisted" \| "submitted" \| "declined"}` | 200 `ApplicantOut` | 401 · 403 · 404 · 409 `invalid_transition` · 422 · 503 |
| PATCH | /listings/{id} (`0002a`, from the pause / resume button) | owner session, own listing | `{"status": …}` | 200 `ListingOut` (no counts: merged into the cache) | unchanged |

## UI
Artboards: `design/screens-v1/Inbox.dc.html` (mobile) and `InboxDesktop.dc.html` (the list column only); the
card on "my listings" follows `0002e`'s edit link. Single column `max-w-[640px]`, `px-4`, logical properties only.

**`/me/listings/:id/applicants` (`ApplicantsPage`)**, behind `RequireOwner`:
- A link `listings.edit.backToMine` → `/me/listings` above the heading (≥ 44 px, as `EditListingPage`).
- loading (`useMyListings` with `data === undefined` and pending): one `Skeleton` (`aria-busy`, label
  `common.loading`).
- error (`GET /me/listings` failed with `data === undefined`): `ErrorState` with retry. A failed **background**
  refetch (every action invalidates `['me','listings']`) keeps the cached data on screen, as `EditListingPage`
  does; the same rule holds for `useApplicants` after a 404 / 409 refetch (verifier 5).
- not found (the id is not in the owner's list — another owner's, unknown, malformed): `<h1>`
  `applicants.notFound` and the back link; **no** `GET /listings/{id}/applications` is sent.
- found: `<h1>` `applicants.title`; under it the listing's `listings.card.title` (`<p>`, bold) and a muted line
  `formatIls(price_ils)` `listings.units.ils` (no view count: Gilad, 2026-11-10); then:
  - applicants loading (`data === undefined`): three `Skeleton` cards in a `<ul aria-busy>`; error (`data ===
    undefined`): `ErrorState`, retry refetches;
  - empty (no applicants): `EmptyState` `applicants.empty`; no totals, no filters;
  - success: a totals row (three items: the number large, then `applicants.stats.total`,
    `applicants.stats.shortlisted`, `applicants.stats.new`), counted from the loaded list; a filter group
    (`role="group"`, `aria-label` `applicants.filter.label`) of four toggle buttons with `aria-pressed`:
    `applicants.filter.all`, `.new`, `.shortlisted`, `.declined`, each with its `{{count}}`; default all;
    filter state is component state. A filter with no match → `applicants.emptyFilter`. Then a `<ul>` of
    `ApplicantCard`s in API order (newest first).
- A visually hidden `<p role="status">` that reads `applicants.statusChanged` (`{{name}}`, `{{status}}` = the
  owner chip text) after each successful change; a `role="alert"` line above the list for
  `applicants.errors.gone`.

**`ApplicantCard`** (`<li><article aria-labelledby>`): an initial avatar (first grapheme of the name,
`Array.from(name)[0]`, `aria-hidden`), the name as `<h2>` (with an id, `tabIndex={-1}`), `ApplicationStatusChip
viewer="owner"`, `applicants.appliedAt` (`{{date}}` = `formatDate(todayInIsrael(new Date(created_at)))`), the
message (`whitespace-pre-line break-words`, plain text). Actions (≥ 44 px, `aria-describedby` = the `<h2>` id):
`submitted` → `applicants.actions.shortlist` (primary) + `applicants.actions.decline`; `shortlisted` →
`applicants.actions.unshortlist` + `applicants.actions.decline`; `declined` → none.
- pending: both buttons disabled, the clicked one `aria-busy`; a same-tick guard (ref). Updates are
  server-confirmed: the card keeps its old status and chip until the PATCH succeeds.
- decline asks `window.confirm(t('applicants.declineConfirm', { name }))` first; cancel sends nothing.
- success: the card shows the new status and actions; focus moves to the card's `<h2>` (the clicked button may be
  gone) — unless the card left the filtered view (e.g. filter "new" and a shortlist), then focus moves to the
  pressed filter button; the status line announces; `['me','listings']` is invalidated.
- errors: 404 → the applicants list is refetched, `applicants.errors.gone` shows, and focus moves to the pressed
  filter button (or the `<h1>` when no filter group remains); 409 → refetched, `common.error` (`role="alert"`)
  in the card and focus on the card's `<h2>`; 401 / 403 → the `ME_KEY` mechanism in Scope; network / 5xx →
  `common.error` in the card, the chip unchanged and the buttons enabled again (verifier 2, 3, 4).

**`/me/listings`** (changed): the applicants link with the optional new badge on every card. States otherwise
unchanged.

**RTL**: inherited `dir="rtl"`. The back link at the inline start above the heading; the avatar at the card's
inline start, name and chip after it; the action buttons in inline order (primary first); the totals and filter
rows wrap (`flex-wrap`); the new badge follows the link text. No physical properties.

**a11y**: filters are toggle buttons with `aria-pressed` in a labelled group; action buttons' accessible
description names the applicant; status changes are announced politely (`role="status"`), errors assertively;
focus is never lost after an action (the card's `<h2>`, else the pressed filter button, else the `<h1>`); the decline confirmation is the native `confirm` dialog.

**i18n keys added to `he.json`** (placeholder copy; Slice 9 owns final wording; `listings.edit.backToMine`,
`listings.card.title`, `listings.units.*`, `common.*` reused):
| key | value |
| --- | --- |
| `applicants.title` | `מועמדויות` |
| `applicants.stats.total` | `מועמדויות` |
| `applicants.stats.shortlisted` | `ברשימה הקצרה` |
| `applicants.stats.new` | `חדשות` |
| `applicants.filter.label` | `סינון מועמדויות` |
| `applicants.filter.all` | `הכל ({{count}})` |
| `applicants.filter.new` | `חדשות ({{count}})` |
| `applicants.filter.shortlisted` | `רשימה קצרה ({{count}})` |
| `applicants.filter.declined` | `נדחו ({{count}})` |
| `applicants.status.submitted` | `חדש` |
| `applicants.status.shortlisted` | `ברשימה הקצרה` |
| `applicants.status.declined` | `נדחה` |
| `applicants.actions.shortlist` | `לרשימה הקצרה` |
| `applicants.actions.unshortlist` | `הסרה מהרשימה` |
| `applicants.actions.decline` | `דחייה` |
| `applicants.declineConfirm` | `לדחות את המועמדות של {{name}}? אי אפשר לבטל דחייה.` |
| `applicants.appliedAt` | `הגיש/ה ב־{{date}}` |
| `applicants.empty` | `עוד אין מועמדויות למודעה הזו` |
| `applicants.emptyFilter` | `אין מועמדויות בסינון הזה` |
| `applicants.notFound` | `המודעה לא נמצאה` |
| `applicants.errors.gone` | `המועמדות הזו בוטלה על ידי המועמד/ת` |
| `applicants.statusChanged` | `{{name}}: {{status}}` |
| `applicants.link` | `מועמדויות ({{count}})` |
| `applicants.newBadge` | `{{count}} חדשות` |

## Acceptance criteria
Unit tests use the existing harness (`mockApi`, `renderRoutes`, `testQueryClient()` with `retry: false`,
`deferred()`); fixtures `listing()` (now `MyListingOut`), `applicant()`, `owner`, `seeker`. Non-ASCII test inputs
are written as `\uXXXX` escapes in the tests (and here).
- [ ] AC1 Given `/me` resolves to an owner and `GET /me/listings` returns `[listing({ id: A })]`, When `/me/listings/A/applicants` is opened, Then `<h1>` `applicants.title`; Given `/me` 401 → `/login`; a seeker → `/`; `/me` pending → skeleton and no redirect — the path joins `PATHS` / `TITLES` and the route tree of the existing test — `web/src/features/listings/__tests__/RequireOwner.test.tsx::ac1_owner_only_routes`
- [ ] AC2 Given `GET /me/listings` pending → skeleton with `aria-busy`; failing → `ErrorState`, retry refetches; returning only A, When `/me/listings/B/applicants`, `/me/listings/<random uuid>/applicants` and `/me/listings/abc/applicants` are opened, Then `<h1>` `applicants.notFound` with a link to `/me/listings`, and no `GET /listings/…/applications` request; Given A found and `GET /listings/A/applications` pending → skeleton cards with `aria-busy`; failing → `ErrorState`, retry refetches; `[]` → `applicants.empty` and no filter group — `web/src/features/applicants/__tests__/ApplicantsPage.test.tsx::ac2_states`
- [ ] AC3 Given A with `price_ils: 7200` and five applicants (2 submitted, 2 shortlisted, 1 declined), Then the listing's `listings.card.title`, the price line with no view count (no `צפיות`), totals 5 / 2 / 2, filter buttons `applicants.filter.all` (5), `.new` (2), `.shortlisted` (2), `.declined` (1) with only "all" `aria-pressed="true"` and five cards; When `.new` is clicked, Then exactly the two submitted cards and `.new` pressed; When `.declined`, Then one; Given a list with no declined applicant, When `.declined` is clicked, Then `applicants.emptyFilter` — `ApplicantsPage.test.tsx::ac3_header_totals_and_filters`
- [ ] AC4 Given an applicant `applicant_name: "\u05de\u05d9\u05db\u05dc"`, `status: "submitted"`, `message: "line one\nline two"`, Then the card shows the initial `"\u05de"` (`aria-hidden`), an `<h2>` with the name, the chip `applicants.status.submitted`, `applicants.appliedAt` with the formatted date, the message on two lines, and the buttons `applicants.actions.shortlist` and `applicants.actions.decline` whose `aria-describedby` names the `<h2>`; Given `shortlisted`, Then `applicants.actions.unshortlist` and `decline`; Given `declined`, Then the chip `applicants.status.declined` and no buttons — `ApplicantsPage.test.tsx::ac4_applicant_card`
- [ ] AC5 Given the submitted applicant P on A, When `applicants.actions.shortlist` is clicked with the PATCH `deferred()`, Then exactly one `PATCH /listings/A/applications/P` with body exactly `{"status": "shortlisted"}` and `credentials: 'include'`, both buttons disabled and the clicked one `aria-busy`; on 200 Then the chip `applicants.status.shortlisted`, the buttons `unshortlist` + `decline`, the totals' shortlisted count +1 and new −1, focus on the card's `<h2>`, the `role="status"` line contains the name, and the `['me','listings']` query is invalidated; Given filter `.new` is pressed, When a submitted applicant is shortlisted (200), Then that card is gone from the list and focus is on the `.new` filter button; When `unshortlist` is clicked, Then the body is `{"status": "submitted"}`; When `decline` is clicked and `window.confirm` (spied) returns `false`, Then it was called with the `applicants.declineConfirm` text containing the name and no PATCH is sent; returning `true`, Then the body is `{"status": "declined"}` and on 200 the card has no buttons — `ApplicantsPage.test.tsx::ac5_shortlist_unshortlist_decline`
- [ ] AC6 Given a click on `shortlist`, When the PATCH answers 404 (and the refetch no longer contains P), Then `GET /listings/A/applications` is requested again, `applicants.errors.gone` shows (`role="alert"`) and focus is on the pressed filter button; 409 `{"detail":"invalid_transition"}` (the refetch returns P as `declined`) → requested again, `common.error` in the card and focus on the card's `<h2>`; 401 → the location is `/login` (via `setQueryData(ME_KEY, null)`); 403, with `'GET /me': [json(owner), json(seeker)]` → the location is `/` (via the `ME_KEY` invalidation, not a hard navigate); a network error → `common.error` in the card, the chip still reads `applicants.status.submitted` and the buttons are enabled again; Given a cached inbox and a `GET /me/listings` background refetch that fails after a successful action, Then the inbox stays on screen (no `ErrorState`) — `ApplicantsPage.test.tsx::ac6_action_errors`
- [ ] AC7 Given three listings with (`applicant_count`, `new_applicant_count`) = (12, 5), (3, 0), (0, 0) on `/me/listings`, Then each card has a link to `/me/listings/{id}/applicants` whose accessible name contains `applicants.link` with its count, plus `applicants.newBadge` with 5 on the first card only, and whose `aria-describedby` names an element containing the card's title; When the first card's pause button is clicked and `PATCH /listings/{id}` answers 200 with a `ListingOut` (no counts), Then the link still reads 12 and the badge 5 (merged, not replaced) — `web/src/features/listings/__tests__/MyListingsPage.test.tsx::ac7_applicants_link`; and Given the create wizard publishes with a POST answering a `ListingOut` (no counts) into a seeded `['me','listings']` cache, Then on `/me/listings` the new card's link reads `applicants.link` with 0 and has no `applicants.newBadge` — `web/src/features/listings/__tests__/ListingWizard.test.tsx::ac4_preview_then_publish_navigates`
- [ ] AC8 Given `make dev` is up, When Playwright signs up an owner (`signUp(page, 'owner')`) and posts a listing (`postListing`), and in a second browser context signs up a seeker (`signUp(seekerPage, 'seeker', { name: '\u05de\u05d9\u05db\u05dc' })`) and applies to that listing through `page.request` with `{"message": "Hi, we are a quiet couple"}`, and the owner opens `/me/listings`, Then the card's link reads `applicants.link` with 1 and the `applicants.newBadge` pill; When the owner clicks it, Then the applicant `<article>`'s `<h2>` reads the seeker's name `'\u05de\u05d9\u05db\u05dc'` (distinct from the owner's default `signUp` name in the header) and the message is visible in that article; When the owner clicks `applicants.actions.shortlist`, Then `applicants.status.shortlisted`; When the owner accepts the dialog (`page.once('dialog', d => d.accept())`) after `applicants.actions.decline`, Then `applicants.status.declined` and no action buttons; and the seeker's `GET /me/applications` (its context's `request`) returns that application with `status` `"declined"` — `web/e2e/inbox.spec.ts::ac8_owner_shortlists_and_declines`
- [ ] NF1 `make lint`, `make test`, `make i18n-check` clean; existing web tests pass, with only the `listing()` fixture defaults, the `RequireOwner.test.tsx` additions and the `ListingWizard.test.tsx` assertion named in Scope / AC7; no file under `api/` changes — CI `web` job, code reviewer
- [ ] NF2 Messages and names are rendered as text only (React children; no `dangerouslySetInnerHTML` in `features/applicants/`); nothing on the page shows or requests a seeker's email or id — code reviewer

## Tests to write
Unit (vitest + Testing Library, the auth harness): AC2–AC6 in `ApplicantsPage.test.tsx` (rendered through the
route `/me/listings/:id/applicants` with `renderRoutes`), AC1 in `RequireOwner.test.tsx`, AC7 in
`MyListingsPage.test.tsx` and `ListingWizard.test.tsx`. E2E (Playwright against `make dev`): AC8, two contexts
(owner, seeker). With `0004b` this brings the suite to 8 signups per run; `0004b`'s `make e2e` `rl:*` clear resets
the API's 10 OTP requests / IP / 15 min budget before each run (see Risks).

## Risks / open questions
**Decisions inherited (built on their recommendations):** `0004c` Q6 (a decline is final, so it is confirmed and
leaves no buttons), `0004a` Q1 (no notifications: the "N חדשות" badge on "my listings" is how an owner notices new
applicants), Q5 (what the seeker sees after a decline is `0004b`'s).

**Assumptions (orchestrator):** per-listing inbox only (no all-listings inbox until a later slice needs it);
filters are not kept in the URL; the totals are counted from the loaded list, so they always agree with the cards;
one column on desktop for now.

**Technical risks the verifier should challenge:**
- **Counts in two places:** the totals come from the applicants list, the link on "my listings" from `GET
  /me/listings`; after an action the latter is invalidated, so they agree once it refetches.
- **`usePatchListing` merge:** replacing the cached row with the PATCH's `ListingOut` would drop the counts and
  break the type; the merge is one line and AC7 pins it. `EditListingPage` (`0002e`) also reads this cache and
  is unaffected (it reads `ListingOut` fields only).
- **E2E OTP budget:** 8 signups per run from one IP leaves 2 spare under the 10 / 15 min limit; `0004b`'s
  `rl:*` clear in `make e2e` makes reruns safe, but a later spec that pushes one run past 10 signups needs a
  CI-only limit override (FOLLOWUPS `0001b`).
- Web-only spec: does not build at the same time as `0004b` or another web spec (Vite port 5173); it starts from
  `0004b`'s branch (with `0004c` merged or rebased in) and touches `MyListingsPage.tsx`, `routes.tsx`, `he.json`.

## Verifier findings — one round, 7 findings, all applied
1. `useCreateListing` prepends the created listing with zero counts (`setQueryData<MyListingOut[]>`, same generic in `usePatchListing`); `ListingWizard.test.tsx::ac4_preview_then_publish_navigates` asserts the new card's link reads 0 (Scope, AC7).
2. Focus targets when the acted-on card leaves the view: filtered out or 404 → the pressed filter button (else the `<h1>`), 409 → the card's `<h2>`; asserted in AC5 and AC6 (UI, AC5, AC6).
3. Status changes are server-confirmed, not optimistic; AC6 asserts the chip is unchanged after a network error (Scope, UI, AC6).
4. 401 → `setQueryData(ME_KEY, null)`, 403 → `invalidateQueries({ queryKey: ME_KEY, exact: true })`, as `ListingWizard.onSaveError`; AC6's 403 mocks `'GET /me': [json(owner), json(seeker)]` (Scope, AC6).
5. Loading / error states only when `data === undefined`, so a failed background refetch keeps the inbox on screen (UI, AC6).
6. The seeker signs up with a different name (`0004b`'s `signUp` gains a `name` option) and AC8 asserts it inside the applicant `<h2>` (Scope, AC8; `0004b` Scope).
7. `ApplicationStatusChip` props are a discriminated union; the owner labels are `Record<ApplicantStatus, string>` with no `withdrawn` key (Scope).

## Digest (filled by orchestrator after verification)

    Spec 0004d - Inbox web: the owner's applicants inbox   (verified, part 4 of 4, web, depends on 0004b + 0004c)
    What a user can do after this: an owner sees "applicants (N) · M new" on each card of /me/listings, opens the
             listing's inbox with totals and four filters, reads each applicant's name and message, and
             shortlists, un-shortlists or declines (with a confirmation).
    Decisions I need from you: none new; it follows 0004c's Q6 (a decline is final and confirmed) and 0004a's Q1 (no
             notifications: the "new" badge is the signal) [both on the rec].
    Risks: counts in two places (inbox totals vs the card on my listings) — mitigation: totals come from the loaded list,
             the card's counts are refetched after every action, and PATCH / POST results are merged so they never drop.
    Reviewers: code, qa, ux   Estimated: 1 coder run, 1 review round
    Links: specs/0004d-inbox-web.md · design/screens-v1/Inbox.dc.html, InboxDesktop.dc.html
