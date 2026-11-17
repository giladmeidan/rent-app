---
id: 0018b
title: "A lister sees every upcoming tour of their listings on one page, by day, and can cancel one there; a seeker sees the tours they booked on the same page"
status: done
depends_on: [0018a, 0018e]   # 0018a owns the migration (`tours`), the `Tour` model, `services/tours.py`, `schemas/tours.py`, `routers/tours.py`, POST /tours/{id}/cancel and the web `features/tours/` files (`api.ts::cancelTour`, `useTourActions.ts::useCancelTour`, `format.ts`, `errors.ts::tourErrorText`). 0018a's web half is split into 0018e-tour-slots-web: the web files above are 0018e's, and the web half of this spec builds on them. Branch from the dependency's branch while its PR is open; merge origin/main after it lands (Speed rule 3)
reviewers: [code, ux, qa]   # code: the one read statement and its visibility rule; ux: a new page and three header links; qa: a new endpoint, a cancel flow, time-zone grouping. No security: read-only, scoped to the caller's own rows, reuses 0018a's cancel (reviewed there). No perf: ≤200 rows over 0018a's indexes
estimate: 1 coder run   # coder Sonnet/high (read-only endpoint, no migration); about 14 files, half tests
---

## Goal
After this ships a signed-in person opens `/tours` ("סיורים") and sees an agenda of their upcoming tours, grouped by
day in Israel time: the tours others booked at their listings ("מגיעים לראות"), and the tours they booked themselves
("סיורים שקבעתי"). Each row shows the time, the listing, who is coming (or whose place it is) and a link to the chat,
and the person can cancel a tour from the row. PRODUCT.md "Tours"; `specs/TOURS-PLAN.md` step 5 and the shared
contract.

## Decisions this spec builds on (Gilad, 2026-11-16; do not reopen)
1. Booking is instant for a shortlisted seeker; no pending requests exist, so the page has no "requests" section
   and the header no badge (PRODUCT.md "Tours").
2. Apartments and rooms both; only a room's listing owner sees its tours (flatmates see nothing).
3. Either side cancels; the page reuses 0018a's `POST /tours/{id}/cancel`, which writes the chat line (and, after
   0018c, the email).
4. The calendar-feed link (0018d) lives on this page; 0018b leaves the header's `actions` slot for it.

## Orchestrator defaults in this spec (challenge in verification)
- **D1 Seekers too.** The same endpoint returns the caller's tours on both sides, each row tagged `role`. In the
  market every account is lister and seeker (0010b), so one page for both costs one `UNION ALL` branch and one
  section. (Risks R1.)
- **D2 No horizon, a cap.** Every upcoming booked tour, earliest first, at most `TOURS_AGENDA_LIMIT = 200` rows. 3
  live listings (PRODUCT.md "Brokers") make 200 unreachable for a real lister; no pagination.
- **D3 Entry points, not a tab.** The bottom tab bar already has 4–5 tabs on a phone (`AuthMenu`); `/tours` is a
  shared path (no `side.ts` change) reached by a "הסיורים שלי" link in the headers of "my listings" (apartments),
  "my applications" (apartments) and the market's "שלי".

## Scope
**In:**
- `api/app/schemas/tours.py` (0018a's file): `TourAgendaListingOut` (`id: UUID`, `listing_type:
  Literal['apartment','room']`, `rooms: float`, `street: str`, `city: str` — the facts `cardTitle` needs, typed as
  `ListingOut` types them) and `TourAgendaItemOut` (`id: UUID`, `role: Literal['lister','seeker']`, `starts_at:
  datetime`, `ends_at: datetime`, `conversation_id: UUID`, `other_name: str`, `listing: TourAgendaListingOut`).
- `api/app/services/tours.py` (0018a's file): `TOURS_AGENDA_LIMIT = 200`; `agenda_statement(me: User)` (returns the
  `union_all(…).order_by(…).limit(…)` compound select) and `list_agenda(db, me) -> Sequence[Row[Any]]` (rules under
  API). Docstring names this spec.
- `api/app/routers/tours.py` (0018a's file): `GET /tours` → `list[TourAgendaItemOut]`. Read-only: joins neither
  `LIMITED` nor `OWN` in `api/app/limits.py` (`test_hardening.py` AC1 checks write routes only).
- `api/tests/test_tours_agenda.py` (new): AC1–AC8, using `conftest.py`'s `make_owner` / `make_seeker` /
  `make_profile` and 0018a's tour test helpers (its spec names them; if it adds none, insert `tours` rows with SQL
  as `test_price_signals.py` inserts rows).
- `make client` (git-ignored `web/src/api/schema.d.ts`).
- `web/src/features/tours/` (0018a's folder; every file below except `useAgenda.ts`, `ToursPage.tsx` and
  `__tests__/ToursPage.test.tsx` is 0018a's and is extended, never duplicated):
  - `api.ts` (0018a's): add `type TourAgendaItemOut = components['schemas']['TourAgendaItemOut']`; `fetchAgenda():
    Promise<TourAgendaItemOut[]>` (`api.GET('/tours')`, non-2xx → `ApiError('GET', '/tours', …)`). The cancel call
    is 0018a's `cancelTour(id)`.
  - `useAgenda.ts` (new): `AGENDA_KEY = ['me', 'tours'] as const`; `useAgenda()` = `useQuery({ queryKey: AGENDA_KEY,
    queryFn: fetchAgenda })` (default focus refetch: the page refreshes when the person returns to it).
  - `format.ts` (0018a's): add `tourDay(iso): string` = `todayInIsrael(new Date(iso))` (the Israel calendar day,
    `YYYY-MM-DD`); `formatTourTime(iso): string` → `HH:mm` in `Asia/Jerusalem` (`hourCycle: 'h23'`, built from
    `formatToParts` as `chat/format.ts` does); `formatTourDay(isoDay, today): string` → `tours.day.today` /
    `tours.day.tomorrow` (via `addDays`) or `tours.day.other` with the weekday (`he-IL`, `weekday: 'long'`,
    `timeZone: 'UTC'` on `${isoDay}T00:00:00Z`, as `formatDate`) and `formatDate`'s day. 0018a's `TourTimesPage`
    also groups windows by `formatTourDay` and has `israelToday()`: if 0018a's branch already defines either, reuse
    it (and its signature) instead of adding a second; `today` comes from `israelToday()`.
  - `ToursPage.tsx` (new): the page (UI below), `usePageTitle(t('tours.title'))`.
  - Cancel: each row uses 0018a's `useCancelTour` (`useTourActions.ts`; it already invalidates the thread and
    `CONVERSATIONS_KEY`, so an open thread shows 0018a's line). The agenda part goes in per-call
    `mutate(id, { onSuccess, onError })` options from the row: success removes the row from `AGENDA_KEY`'s data;
    404 (`not_found`) or 409 (`tour_not_cancellable`, 0018a's only cancel codes) invalidates `AGENDA_KEY`. No second
    cancel hook; if 0018a's hook cannot take a per-row conversation id, extend its signature in its file.
  - `__tests__/ToursPage.test.tsx` (new); `__tests__/format.test.ts` (0018a's: add AC9's cases).
- `web/src/app/routes.tsx`: `<Route path="tours" element={<ToursPage />} />` inside the `RequireUser` group.
- Entry links (D3), one `Button variant="secondary" size="sm" to="/tours"` labelled `tours.link`:
  - `web/src/features/listings/MyListingsPage.tsx`: in the non-panel `PageHeader`'s `actions`, before `newButton`
    (a fragment with `gap-2`); the `panel` branch is unchanged.
  - `web/src/features/applications/MyApplicationsPage.tsx`: the non-panel `PageHeader` gains `actions` with it.
  - `web/src/features/market/MarketMinePage.tsx`: its `PageHeader` gains `actions` with it (covers both panels).
- `web/src/locales/he.json`: the `tours.*` keys under UI (0018a may already add a `tours` object: add these keys
  inside it, never a second object).
- `web/e2e/screens/tours.screens.ts` (new) + `fixtures-tours.ts`: states `agenda` (both sections, today / tomorrow /
  a later day), `lister-only`, `empty`, `cancel-dialog`, `error`, at each project's size, every request answered
  in the file as `my-listings.screens.ts` does; screenshots in `web/screens/0018b/`.
- Vitest updates: `MyListingsPage.test.tsx`, `MyApplicationsPage.test.tsx`, a `MarketMinePage` test (AC14).

**Out:**
- The calendar-feed link and its dialog: 0018d (it adds a button to this page's `PageHeader` `actions`).
- Emails: 0018c. Booking, rescheduling and windows: 0018a (the thread's slot picker). No reschedule button here:
  a seeker reschedules in the chat thread, where the free slots are (0018a).
- Past tours, cancelled tours, a month/week grid view, filters by listing, pagination, a nav tab or badge, live
  push of tour changes to this page (focus refetch is the refresh; 0018a's chat event is not consumed here).
- E2E: none new (see Tests to write).

**New dependencies:** none (`Intl.DateTimeFormat` for weekdays and times).

## Data
No migration, no table or column change: reads 0018a's `tours` with `listings`, `users`, `areas`. Needs 0018a's
index on `tours (seeker_id)` (partial `WHERE status = 'booked'` is enough) for the seeker branch; the lister branch
walks `listings.owner_id` (≤ a handful of listings per owner) then 0018a's `(listing_id, starts_at)` unique index.
If 0018a's migration lacks a `seeker_id` index, the verifier raises it on 0018a (contract item).

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/tours` | Signed in, any role (`current_user`); only tours where the caller is the listing's owner or the tour's seeker | none | 200 `list[TourAgendaItemOut]`, `starts_at` ascending then `id`; `[]` when none | 401 `unauthenticated`; 503 DB down |

Router: `list_tours(user: UserDep, db: DbDep) -> list[TourAgendaItemOut]`, `responses={**_AUTH_ERRORS}`; builds
each item from the row (no per-row query).

**`agenda_statement(me)`** — one statement, `UNION ALL` of two branches, then `ORDER BY starts_at, id LIMIT
TOURS_AGENDA_LIMIT`:
- Both branches: `Tour.status == 'booked'`, `Tour.ends_at > func.now()` (an in-progress tour still shows), and the
  **no listing-visibility filter** (orchestrator 2026-11-16, G2 option b: a booked tour on an expired or
  area-inactive listing stays booked per the contract, so it shows here as it does in 0018c's reminders and 0018d's
  feed; paused, hidden and suspended cases are already cancelled by 0018a). `_public_listings()` is not used.
- **Lister branch:** `Listing.owner_id == me.id`; `role = 'lister'`; `other_name = seeker.display_name`, with
  `not_suspended(Tour.seeker_id)` (`services/visibility.py`) so a suspended or deleted seeker's tour is not listed.
- **Seeker branch:** `Tour.seeker_id == me.id`; `role = 'seeker'`; `other_name = owner.display_name`, with
  `not_suspended(Listing.owner_id)` so a suspended or deleted lister's tour is not listed.
- `conversation_id = Tour.application_id` (an application chat's id is its application's,
  `ck_conversations_application_id`); no `conversations` join.
- `other_name` is never NULL under these filters (a deleted user is excluded; the users CHECK keeps a live user's
  name non-NULL); the schema types it `str`.

Error order: 401 → 503.

## UI
No artboard covers tours (screens-v1/v2 have none; PRODUCT.md "Brand": no new artboards). Anatomy follows the inbox
list (`design/screens-v1/Inbox.dc.html`, `InboxDesktop.dc.html`): a reading column (`PageContainer
width="default"`), day headings, one `Card` per tour. Kit components only (`PageHeader`, `Card`, `Button`,
`EmptyState`, `ErrorState`, `Skeleton`, `useConfirm`); colours and type from `design/brand/`. Logical properties
only (hard rule 5). Text that holds a person's name or a street sits in `<span dir="auto">`.

**`/tours` (`ToursPage`)**, `RequireUser` (anonymous → login with `next=/tours`):
- `PageHeader` title `tours.title`; `actions` empty (0018d's slot).
- **Loading:** three `Skeleton` cards, `aria-busy` on the list.
- **Error (no data):** `ErrorState` with retry (`refetch`). A refetch error with data keeps the data.
- **Empty:** `EmptyState` with `tours.empty.title` and `tours.empty.body`; no mascot, no button.
- **Success:** up to two sections, each an `<h2>` + its days; a section with no rows is not rendered:
  1. `tours.sections.lister` (rows with `role = 'lister'`), 2. `tours.sections.seeker` (`role = 'seeker'`).
  Inside a section, rows are grouped by `tourDay(starts_at)` in the order received; each group is an `<h3>`
  `formatTourDay(day, todayInIsrael())` and a `<ul>`. Each row (`<li>` → `Card`):
  - the time `tours.row.time` (`{{start}}–{{end}}`, `formatTourTime`) in `text-label font-semibold`;
  - the listing title `cardTitle(t, item.listing)`, linked to `/listings/{id}`;
  - `tours.row.with` with `other_name`, the same impersonal line for both roles;
  - actions: `Button variant="ghost" size="sm" to="/chat/{conversation_id}"` `tours.row.chat`; `Button
    variant="secondary" size="sm"` `tours.row.cancel` (`aria-describedby` = the row's time id), **only while
    `starts_at` is in the future**: 0018a's cancel answers 409 `tour_not_cancellable` once a tour has started, so
    an in-progress row (AC4) shows the chat link only.
- **Cancel:** `useConfirm` with `tours.cancel.title`, `tours.cancel.body` (`{{name}}` = `other_name`),
  `tours.cancel.confirm`, `tours.cancel.keep`. Confirm → the button shows busy and is disabled; success → the row
  leaves, a `role="status"` line (always mounted, `sr-only` while empty, as `MyListingsPage`'s) reads
  `tours.cancel.done`; 404/409 → status line `tours.cancel.gone` and the list refetches; any other error (429,
  5xx, offline) → `role="alert"` under the row with 0018a's `tourErrorText(t, error, online)` (`errors.ts`), the
  row stays. A day group left empty disappears; both sections empty → the empty state.

**i18n keys** (`web/src/locales/he.json`, under `tours`; voice: impersonal, no gendered forms):
- `tours.title`: `"סיורים"` · `tours.link`: `"הסיורים שלי"`
- `tours.sections.lister`: `"מגיעים לראות"` · `tours.sections.seeker`: `"סיורים שקבעתי"`
- `tours.day.today`: `"היום"` · `tours.day.tomorrow`: `"מחר"` · `tours.day.other`: `"{{weekday}}, {{date}}"`
- `tours.row.time`: `"{{start}}–{{end}}"` · `tours.row.with`: `"סיור עם {{name}}"` · `tours.row.chat`: `"לצ'אט"`
  · `tours.row.cancel`: `"ביטול הסיור"`
- `tours.empty.title`: `"אין סיורים קרובים"` · `tours.empty.body`: `"סיור שנקבע בצ'אט יופיע כאן"`
- `tours.cancel.title`: `"לבטל את הסיור?"` · `tours.cancel.body`: `"{{name}} יראו את הביטול בצ'אט."` ·
  `tours.cancel.confirm`: `"ביטול הסיור"` · `tours.cancel.keep`: `"השארה"` · `tours.cancel.done`: `"הסיור בוטל"` ·
  `tours.cancel.gone`: `"הסיור הזה כבר לא פעיל"` (other errors reuse 0018a's `tours.errors.*` via `tourErrorText`)

## Acceptance criteria
- [ ] AC1 Given an owner with an apartment and a room, each with a booked upcoming tour by different shortlisted
  seekers, When the owner GETs `/tours`, Then 200 with both rows, `starts_at` ascending, `role = 'lister'`,
  `other_name` = each seeker's display name, `conversation_id` = each application's id, and the listing facts —
  `api/tests/test_tours_agenda.py::test_ac1_lister_sees_tours_across_listings`
- [ ] AC2 Given the seeker of AC1's apartment tour, When they GET `/tours`, Then exactly that row with `role =
  'seeker'` and `other_name` = the owner's display name — `::test_ac2_seeker_sees_own_tour`
- [ ] AC3 Cancelled tours, tours whose `ends_at <= now()`, and other people's tours are absent; a third account gets
  `[]` — `::test_ac3_only_own_upcoming_booked_tours`
- [ ] AC4 A tour with `starts_at < now() < ends_at` is listed — `::test_ac4_in_progress_tour_listed`
- [ ] AC5 Present when the listing is past `expires_at` or in an inactive area (still booked); absent from the
  seeker's list when the lister is suspended or deleted, and from the lister's list when the seeker is —
  `::test_ac5_expired_listing_stays_people_drop_out`
- [ ] AC6 Anonymous → 401 `unauthenticated` — `::test_ac6_requires_login`
- [ ] AC7 201 upcoming tours → the 200 earliest (ties by id) — `::test_ac7_capped_at_limit`
- [ ] AC8 The endpoint is one SQL statement (statement-count via SQLAlchemy `before_cursor_execute`, as
  `test_chat.py` counts) — `::test_ac8_one_statement`
- [ ] AC9 `tourDay` puts `2026-11-17T22:30:00Z` on `2026-11-18`; `formatTourTime` gives `00:30`; `formatTourDay`
  gives היום / מחר / "יום …, d.M.yy" — `web/src/features/tours/__tests__/format.test.ts`
- [ ] AC10 With lister and seeker rows the page shows both sections in that order, grouped under day headings; with
  lister rows only, no seeker heading — `ToursPage.test.tsx::ac10_sections_and_days`
- [ ] AC11 Loading skeleton, error with working retry, and the empty state render as specified —
  `::ac11_loading_error_empty`
- [ ] AC12 Cancel → confirm → `POST /tours/{id}/cancel` once, row removed, status "הסיור בוטל"; "השארה" sends
  nothing; 409 → "הסיור הזה כבר לא פעיל" and a refetch; 500 → alert, row stays; an in-progress row has no cancel
  button — `::ac12_cancel_flow`
- [ ] AC13 The chat link points to `/chat/{conversation_id}`; the listing title links to `/listings/{id}` —
  `::ac13_links`
- [ ] AC14 "הסיורים שלי" links to `/tours` from `/me/listings`, `/me/applications` and `/market/mine` headers, and
  is not repeated inside `/market/mine`'s panels; `/tours` signed out redirects to login —
  `MyListingsPage.test.tsx::ac14_tours_link`, `MyApplicationsPage.test.tsx::ac14_tours_link`,
  `market/__tests__/MarketMinePage.test.tsx::ac14_tours_link`, `ToursPage.test.tsx::ac14_requires_login`
- [ ] AC15 `make lint`, `make i18n-check` and `make screens` (the new `tours` states) pass — CI / local

## Tests to write
Unit: `format.test.ts` (AC9). Integration: `test_tours_agenda.py` (AC1–AC8, Postgres via compose); Vitest
`ToursPage.test.tsx` and the three header tests (AC10–AC14). E2E (smoke): none — booking needs two signed-up
accounts and a shortlist, which pushes the per-shard OTP budget (HANDOFF "e2e OTP budget"); the screens check and
Vitest cover the page. e2e runs only in CI (rule 8); never run `make e2e` locally.

## Blast radius
`graphify affected` on `main` (verifier, 2026-11-16; the graph does not yet know 0018a's files):
- `MyListingsPage` → `routes.tsx` (`AppRoutes`), `MarketMinePage.tsx`, `MyListingsPage.test.tsx` (`render`,
  `renderRooms`), `EditListingPage.test.tsx`, `RequireOwner.test.tsx`, `__tests__/wizard.tsx`; via `AppRoutes` the
  route-level tests (`App.tsx`, `Layout.test.tsx`, `routes.test.tsx` ×2, `LandingPage.test.tsx`, `LegalPage.test.tsx`,
  …). Header change only in the non-panel branch; tests that query the header's links by role may now see two —
  check `getByRole('link', …)` calls in the first group; the route-level ones are untouched (no header query).
- `MyApplicationsPage` → `routes.tsx`, `MarketMinePage.tsx`, `MyApplicationsPage.test.tsx`,
  `RequireSeeker.test.tsx`, `auth/__tests__/LoginPage.test.tsx` (`Landing()` renders it after login: check its
  link queries).
- `MarketMinePage` → `routes.tsx`, `market/__tests__/MarketMinePage.test.tsx` (`renderMine`; AC14),
  `listings/__tests__/ListingWizard.test.tsx` (renders it after publishing a room: check its link queries).
- `routes.tsx::AppRoutes`: one route added, additive; no caller changes.
- `_public_listings`: not used (G2 option b), untouched. `visibility.not_suspended`:
  reused unchanged.
- 0018a's `features/tours/api.ts`, `format.ts`, `useTourActions.ts::useCancelTour`, `__tests__/format.test.ts`:
  extended additively; if `useCancelTour`'s signature changes, 0018a's `TourCard` call sites and
  `TourCard.test.tsx` change in this PR.
- `listings/format.ts::todayInIsrael`, `addDays`, `formatDate`, `cardTitle`, `usePageTitle`, `useConfirm`: reused
  unchanged.
- `sideOf`, `AuthMenu`: untouched (`/tours` is a shared path; no tab added).
- Screens: `my-listings.screens.ts` (also renders `/market/mine` and `?tab=applications`) and
  `seeker-lists.screens.ts` headers gain a button → their baseline images change; update them in this PR.

## Risks / open questions
- **R1 (D1, orchestrator default):** seekers on the same page. Alternative: lister-only, seekers see their tour only
  in the thread. The default costs one branch; the verifier may cut it if 0018a's thread card is enough.
- **R2:** a tour on a listing that is hidden for another reason (area deactivated) disappears from both sides' agenda
  while still `booked`; 0018a's cleanup does not cover area deactivation. Accepted: admin-only, rare.
- **R3:** listing expiry has no write event; the visibility filter hides those tours here whether or not 0018a's
  cleanup has cancelled them yet.
- **R4:** the tours page does not consume 0018a's chat event; a tour booked while the page is open appears on the next
  focus. Accepted (Out).
- **R5 (resolved by the verifier):** 0018a's cancel table: 404 `not_found`, 409 `tour_not_cancellable` (not booked
  or already started), 429. 404/409 → "gone"; 429 and the rest → `tourErrorText`.

## Verifier findings (one round, 2026-11-16)
Applied in this spec:
1. 0018a's schema file is `schemas/tours.py` (0018a's verifier settled the name; Scope, depends_on).
2. `useCancelTour.ts` would duplicate 0018a's `useTourActions.ts::useCancelTour`; the row now reuses it with per-call
   agenda options (Scope). `format.ts`, `api.ts`, `format.test.ts` are 0018a's files: extended, and 0018a's
   `formatTourDay` / `israelToday` reused if its branch defines them.
3. 0018a's cancel returns 409 for a started tour, yet AC4 lists in-progress tours: the cancel button now shows only
   before `starts_at` (UI, AC12).
4. Cancel errors aligned with 0018a's table (R5): 429 was unhandled; non-404/409 errors now use 0018a's
   `tourErrorText`, so `tours.cancel.error` is dropped.
5. `_public_listings` is already imported cross-module (`applications.py`, `people.py`): no rename (API, Blast radius).
6. `agenda_statement`'s return is a compound select, not `Select[Any]`.
7. Blast radius rerun with graphify: added `MarketMinePage` → `ListingWizard.test.tsx`, `LoginPage.test.tsx`'s
   `Landing()`, and 0018a's files this spec extends.
8. depends_on: 0018e does not exist yet; the comment says to add it if 0018a is split (its R1).

For Gilad (the spec builds on the defaults as written; the coder guesses nothing):
- **G1 (R1/D1) Seeker section.** PRODUCT.md "Tours" says "the lister gets a tours page"; D1 adds the seeker's own
  tours as a second section. Options: (a) keep, one more `UNION ALL` branch and section (default); (b) lister-only,
  the seeker sees the tour only in the thread card (drop AC2, the seeker branch and `tours.sections.seeker`).
- **G2 (R2/R3) — resolved by the orchestrator, option (b) applied (Gilad may overturn).** The contract says an expired listing's booked tours
  **stay** booked (no write at expiry), and area deactivation cancels nothing either; this spec's public-listing
  filter hides those still-booked tours from **both** agendas, while 0018c's reminder and 0018d's feed (by the
  contract) still carry them. Options: (a) keep the filter (spec as written; accept the mismatch, R2); (b) recommended:
  filter only `status = 'booked'`, `ends_at > now()` and the other party `not_suspended` (paused/hidden/suspended/
  deleted already cancel via 0018a), so the agenda matches the feed and the reminders; AC5 shrinks to suspended/
  deleted people.

## Digest
Spec 0018b — Tours page   MERGED a4f16a8 (PR #123, head 5eec724, ci green)
Shipped: `/tours` ("הסיורים שלי") shows a signed-in person's upcoming booked tours by day in Israel time: tours at
their listings ("מגיעים לראות") and tours they booked ("סיורים שקבעתי"), each with a chat link and cancel. `GET /tours`
is one `UNION ALL` statement (lister + seeker branch), capped at 200, no listing-visibility filter (G2 option b), the
other party must not be suspended or deleted. Links to it from the my-listings, my-applications and market-mine headers.
Demo (`make dev`): book a slot from a shortlisted seeker's chat → both sides see it on `/tours`; cancel there → it
disappears and the chat gets the cancel line.
Tests: API + web for every AC, screens states; no new e2e. pytest 989, vitest 852 locally.
Findings: 0 blockers, 3 qa majors fixed (tie order, day grouping, time-dependent screens fixtures); cheap minors fixed
(agenda invalidated by chat actions, focus after cancel, aria-describedby, unused join, AC8 strictness); the rest in
FOLLOWUPS.
Changed in PRODUCT.md: nothing.
