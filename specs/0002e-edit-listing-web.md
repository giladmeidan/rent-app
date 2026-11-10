---
id: 0002e
title: An owner opens one of their listings from "my listings", edits its facts in the same wizard they published it with, and saves only what changed
status: in-review
depends_on: []           # 0002a, 0002b, 0002d, 0003b are merged
reviewers: [code, qa, ux]   # ux: new route + edit link on a changed screen; no security: no new endpoint, ownership is 0002a's PATCH (404 in SQL), no PII
estimate: 1 coder run
---

## Goal
After this ships, an owner clicks "עריכה" on a card on `/me/listings`, lands on
`/me/listings/:id/edit`, sees the listing wizard (`0002b`) prefilled with that listing's facts, changes
what they want, reviews the preview and saves; the web sends `PATCH /listings/{id}` (`0002a`) with **only
the changed fields** and returns to "my listings" with the updated card. Serves Dev Plan slice 2 (Owner
posts listing): `0002b` Out named "editing a published listing's fields (next listings spec; the API
already supports it)". PRODUCT.md rows "Listings" (no drafts: edits apply to the live row at once) and
"Brokers" (cap).

## Scope
**In:**
- Route in `web/src/app/routes.tsx`: `me/listings/:id/edit` → `EditListingPage`, inside the existing
  `<Route element={<RequireOwner />}>` (logged out → `/login`, seeker → `/`, `/me` pending → skeleton,
  `/me` error → `ErrorState`; `RequireOwner` itself is unchanged).
- `web/src/features/listings/EditListingPage.tsx` (new): reads `:id` with `useParams`, uses
  `useMyListings()` (the `['me','listings']` cache, fetched if absent or stale) and finds the listing by id.
  States in UI. When found it renders `<ListingWizard key={listing.id} listing={listing} />` inside the same
  `max-w-[480px]` section as `NewListingPage`. **No new fetch function and no `GET /listings/{id}` call:**
  the public endpoint (`0003a`) hides paused and expired listings, and `GET /me/listings` already returns
  every own listing in one query.
- `ListingWizard.tsx`: one optional prop `listing?: ListingOut`. Without it, behaviour is exactly `0002b`'s.
  With it (edit mode):
  - **baseline snapshot:** `const [base] = useState(() => listing)` — the listing as it was when the page
    opened. Every diff (dirty and save) is against `base`, never the live `listing` prop, so a background
    refetch of `['me','listings']` that changes the prop neither overwrites what the owner typed nor adds
    fields another tab changed to the PATCH body (verifier 1);
  - initial form = `formFromListing(base)` (`useState` initialiser); initial step = **2**; step 1 stays
    reachable with `common.back` (type is editable, see Risks Q3);
  - `<h1>` = `listings.edit.title`; step 3's primary button = `listings.save`; a link
    `listings.edit.backToMine` → `/me/listings` above the `<h1>` (≥ 44 px, as `listing.backToSearch` on
    `ListingPage`);
  - save = `changedFields(base, toListingIn(current))` (`current = withArea(form)`, as the create path
    sends); empty → `navigate('/me/listings')` with no
    request and no saved message; otherwise `usePatchListing(listing.id).mutate(patch)` with the same
    same-tick double-submit guard (`publishing` ref) the create path has; success →
    `navigate('/me/listings', { state: { saved: true } })`;
  - `usePatchListing` is called unconditionally (`usePatchListing(listing?.id ?? '')`, rules of hooks) and only
    mutated in edit mode; `goTo` resets both mutations; `isPending` of the active one drives
    `disabled`/`aria-busy`;
  - expired listing (`listingState(listing, now) === 'expired'`): a `<p>` `listings.edit.expiredHint` (amber
    `bg-warn text-warn-text`, as the expired badge) under the progress bar on every step; saving works as for
    any listing (Risks Q1);
  - unsaved changes (Risks Q2): "dirty" = `changedFields(base, toListingIn(form))` is non-empty — from
    `form`, **not** `current`: `withArea` yields `area_id: ''` while `GET /areas` is pending or failed (and
    another id in the one-active-area case of Risks), which would mark an untouched form dirty (verifier 2).
    While dirty, a `beforeunload`
    listener calls `event.preventDefault()` (reload / tab close; the browser shows its own text, so no key);
    a click on `listings.edit.backToMine` while dirty asks `window.confirm(t('listings.edit.leaveConfirm'))`
    and stays on cancel. Browser Back and header links are **not** guarded (that needs a data router; see Q2).
- Error mapping (shared by both modes, one code path in `ListingWizard`'s `outcome()`): unchanged for 401,
  403, 409 (`listings.errors.capReached`), 422 `unknown_area` (`listings.errors.areaInactive` + back), network
  / 5xx (`common.error` + retry, which re-sends the same body). New:
  - **422 with a list `detail`**: every item whose `loc` is exactly `["body", <name>]` with `<name>` in
    `FIELD_ORDER` becomes `{ key: 'listings.errors.invalid' }` on that field; if at least one maps, the wizard
    goes to step 2, shows those errors (`role="alert"`, `aria-invalid`, `aria-describedby`, as client errors),
    and focuses the first one in `FIELD_ORDER`.
    **Separate state (verifier 3):** server errors live in their own `serverErrors: FieldErrors` state, not in
    `errors` (whose `update()` keep-only-what-`validate`-finds rule and the step wrapper's `onBlur`
    re-validation would drop them on the next keystroke or blur anywhere). `DetailsStep` receives
    `{ ...serverErrors, ...errors }` (a client error wins on the same field); `update(patch)` deletes from
    `serverErrors` exactly the keys present in `patch`; a save starting clears `serverErrors`. So a server
    error stays until its own field changes or the next save.
    **Focus (verifier 4):** the `useEffect(…, [step])` that focuses the `<h1>` on a step change would override
    a focus set from `onError` (step 2 is not rendered yet then). The server-error path sets a
    `focusAfterStep` ref to the first mapped field's element id before `goTo(2)`; the `[step]` effect, when
    the ref is set, focuses that element instead of the heading and clears the ref.
    Items that do not map (model-level `loc: ["body"]`, e.g. the merged-row `total_floors >= floor`
    check, or `listing_type` / `furnished` / `entry_flexible`, which have no error slot) → `common.error` on
    step 3 as today. Mapping reads `loc` only; `type` is not needed (every field item gets the same key) and
    **`msg` is never read or rendered** (it is English).
  - **404** (edit mode only; e.g. the session changed to another owner in another tab):
    `setQueryData(MY_LISTINGS_KEY, old => old?.filter(l => l.id !== listing.id))`, then
    `invalidateQueries({ queryKey: MY_LISTINGS_KEY })`, so `EditListingPage` no longer finds the id and renders
    the not-found state at once, without waiting for (or depending on) the refetch (verifier 5).
- `validate.ts`: `FieldError` gains `{ key: 'listings.errors.invalid' }`; two pure functions, unit-tested:
  - `formFromListing(listing: ListingOut): ListingForm` — numbers → `String(n)`, `null` → `''`, booleans and
    `furnished` / `listing_type` / `available_from` / `area_id` as stored, `parking_spots` → `String(n)`;
  - `changedFields(listing: ListingOut, body: ListingInBody): ListingPatch` — every `ListingInBody` key whose
    value differs from the listing's (`===`; `rooms` compared as numbers); a nullable field emptied in the form
    is `null` because `toListingIn` already yields `null` (`total_floors`, `arnona_ils`, `vaad_ils`,
    `description`); never `status`.
- `DetailsStep.tsx`: if `form.rooms` is non-empty and not in `ROOM_OPTIONS` (a listing posted by API with
  10.5–20 rooms), it is rendered as one extra `<option>` so the select shows the stored value (one line).
- `MyListingsPage.tsx` `ListingRow`: a `<Link>` `listings.actions.edit` → `/me/listings/{id}/edit` on
  **every** card (live, paused, expired), next to the pause/resume button, ≥ 44 px, styled as that button;
  `aria-describedby` = the card title's id, so its accessible description names the listing (the pause/resume
  button gets the same attribute). `ListingCard` gains one optional prop `titleId?: string` set on its `<h2>`.
  The page shows `<p role="status">` `listings.edit.saved` under the heading row when
  `location.state?.saved === true`.
- `usePatchListing.ts` `onSuccess`: also `invalidateQueries({ queryKey: ['listing', updated.id] })`, so the
  public page (`usePublicListing`) is not stale after an edit or a pause (one line).
- `he.json` keys in UI. Tests: `web/src/features/listings/__tests__/EditListingPage.test.tsx` (new),
  additions to `validate.test.ts`, `MyListingsPage.test.tsx`, `ListingWizard.test.tsx` (AC7),
  `RequireOwner.test.tsx` (AC1: the edit path joins its `PATHS` / `TITLES` and route tree), the edit route in
  `__tests__/wizard.tsx`'s `routes`; `web/src/features/auth/__tests__/harness.tsx`: `renderRoutes`'s `path`
  widens from `string` to react-router's `InitialEntry` (`string | Partial<Location>`), so AC10 can pass
  `{ pathname: '/me/listings', state: { saved: true } }` (one-line type change; `renderAt` and every
  existing caller unchanged); e2e in `web/e2e/listings.spec.ts`, with `signUpOwner(page)` lifted into
  `web/e2e/helpers.ts` for the new test (the two existing copies may stay).
- `specs/FOLLOWUPS.md`: the `0002d` · `validate.ts` entry gains "· partly done in 0002e: a server 422 now names
  the field (`listings.errors.invalid`); the rule itself is still not mirrored".

**Out:**
- Any API change (see API: the PATCH has everything this needs). A single-listing owner `GET`.
- Pausing / resuming from the edit page (stays on `/me/listings`; the edit form never sends `status`).
- Renewing an expired listing (Slice 10). Deleting a listing. Photos (`0002c`).
- A guard for browser Back / header links (Q2 option b; merges with FOLLOWUPS `0002b` · `ListingWizard.tsx`
  browser Back), persisting edits across reloads, optimistic updates, conflict detection between two tabs
  (only changed fields are sent, so the last save wins per field, never for the whole row).
- Mirroring the API's combining-marks rule client-side (FOLLOWUPS `0002d`).

**New dependencies:** none.

## Data
None. Consumes `0002a`'s `listings` table through its API.

## API
No endpoint is added or changed; `make client` produces no diff. The PATCH contract already covers every
need of this screen:
partial update (`model_fields_set`), explicit `null` clears exactly the four nullable columns
(`NULLABLE_FIELDS`), the merged row is re-validated with `ListingIn` (cross-field 422, never a 500),
another owner's id is 404 in SQL, `area_id` is re-checked when sent, `expires_at` never moves, and the cap is
re-checked only on `status: 'active'` from paused — which this screen never sends.

| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /me/listings (consumed) | owner session (`current_owner`) | – | 200 `list[ListingOut]`, all own listings | 401 · 403 `owner_only` · 503 |
| GET | /areas (consumed, `0000a`) | public | – | 200 `list[AreaOut]` (active areas) | 503 |
| PATCH | /listings/{id} (consumed) | owner session **and** `listing.owner_id == user.id` | `ListingPatch`: only the changed fields; `null` for a cleared nullable field; never `status` | 200 `ListingOut` | 401 · 403 · 404 `not_found` · 409 `listing_cap_reached` (unreachable from this screen, mapped anyway) · 422 `unknown_area` / list `detail` · 503 |

## UI
No artboard for editing; the form, stepper and bottom bar are `design/screens-v1/CreateListing.dc.html`
(as built in `0002b`), the card is `Listing.dc.html`. There is no MyListings artboard; the edit link follows
the existing pause/resume button. Single column `max-w-[480px]`, `px-4`, logical properties only.

**`/me/listings/:id/edit` (`EditListingPage`)**, behind `RequireOwner`:
- loading (`useMyListings` pending, no cache): one `Skeleton` block (`aria-busy`, label `common.loading`).
  With a cached list the form renders at once (no skeleton) while a stale list refetches in the background.
- error: `ErrorState` with retry (refetches `GET /me/listings`).
- not found (the id is not in the list: another owner's listing, an unknown uuid, a malformed id; or a
  PATCH 404): `<h1>` `listings.edit.notFound` and the link `listings.edit.backToMine`. No PATCH is ever sent
  and nothing distinguishes "someone else's" from "does not exist".
- empty: n/a (an empty list is the not-found case).
- success (found): the wizard in edit mode — `listings.edit.backToMine` link, `<h1>` `listings.edit.title`,
  stepper and progress bar as `0002b` starting at step 2 (step 1 shown done), the expired hint when expired,
  `DetailsStep` prefilled, step 3 `PreviewStep` with `listings.save`; save pending → button disabled +
  `aria-busy`; save errors as in Scope; saved → `/me/listings` with the status line.

**`/me/listings`** (changed): edit link on every card; `role="status"` `listings.edit.saved` after a save.
States otherwise unchanged from `0002b`.

**RTL**: inherited `dir="rtl"`. The back-to-my-listings link sits at the inline start above the heading (as
`ListingPage`'s back link); the edit link follows the pause/resume button in inline order; the expired hint
is `text-start`. No physical properties.

**a11y**: the edit link's accessible name is `listings.actions.edit` and its description the card title
(`aria-describedby`); server field errors use the same `role="alert"` + `aria-describedby` + focus-first rule
as client errors; the saved line is `role="status"` (announced politely after navigation); the leave
confirmation is the native `confirm` dialog (keyboard and screen-reader accessible).

**i18n keys added to `he.json`** (placeholder copy; Slice 9 owns final wording):

| key | value |
| --- | --- |
| `listings.edit.title` | `עריכת מודעה` |
| `listings.edit.backToMine` | `חזרה למודעות שלי` |
| `listings.edit.notFound` | `המודעה לא נמצאה` |
| `listings.edit.saved` | `השינויים נשמרו` |
| `listings.edit.expiredHint` | `תוקף המודעה פג. השינויים יישמרו, אבל המודעה לא תוצג למחפשים עד שתחודש.` |
| `listings.edit.leaveConfirm` | `יש שינויים שלא נשמרו. לצאת בלי לשמור?` |
| `listings.save` | `שמירת השינויים` |
| `listings.actions.edit` | `עריכה` |
| `listings.errors.invalid` | `הערך לא התקבל. כדאי לבדוק אותו ולנסות שוב` |

## Acceptance criteria
Unit tests use the existing harness (`mockApi`, `renderRoutes`, `testQueryClient()` with `retry: false`,
`fixtures.ts::listing()`); "no request" means the `mockApi` call log has no such route. Non-ASCII test inputs are written as `\uXXXX`
escapes in the tests (and here).
- [ ] AC1 Given `/me` resolves to an owner and `GET /me/listings` returns `[listing({id: A})]`, When `/me/listings/A/edit` is opened, Then `<h1>` `listings.edit.title`; Given `/me` is 401, Then redirect to `/login`; Given a seeker, Then redirect to `/`; Given `/me` pending, Then a skeleton and no redirect — the edit path is added to `PATHS` / `TITLES` and to the `<RequireOwner />` route tree of the existing test (with `'GET /me/listings': [json([listing({ id: A })])]`), so it runs under every case that test already covers — `web/src/features/listings/__tests__/RequireOwner.test.tsx::ac1_owner_only_routes`
- [ ] AC2 Given `GET /me/listings` pending, Then a skeleton with `aria-busy`; Given it fails, Then `ErrorState` and retry refetches; Given it returns only listing A, When `/me/listings/B/edit` (B = another owner's id), `/me/listings/<random uuid>/edit` and `/me/listings/abc/edit` are opened, Then each shows `<h1>` `listings.edit.notFound` with a link to `/me/listings`, and no `PATCH` and no `GET /listings/{id}` is made; Given the `['me','listings']` cache is seeded with A, Then the form renders with no skeleton; When the owner types price `7500` and a background refetch then returns A with a different `street` **and** `price_ils: 9000`, Then the price field still shows `7500`, and on save the PATCH body is exactly `{"price_ils": 7500}` (the other tab's street is not sent back) — `EditListingPage.test.tsx::ac2_loads_from_my_listings_and_not_found`
- [ ] AC3 Given listing A (`rooms: 3.5, floor: 3, total_floors: 5, size_sqm: 95, price_ils: 7200, available_from` 30 days ahead, `elevator: true, parking_spots: 1, furnished: "partial", pets_allowed: true, arnona_ils: 480, vaad_ils: null, description: "\u05e9\u05d5\u05e8\u05d4\n\u05e9\u05e0\u05d9\u05d9\u05d4"`), When the edit page opens, Then step 2 is current (`aria-current="step"` on `listings.steps.details`, `aria-valuenow="2"`) and every field shows A's value (price `7,200` at rest, vaad empty, the elevator and pets switches checked, `\u05de\u05e8\u05d5\u05d4\u05d8\u05ea \u05d7\u05dc\u05e7\u05d9\u05ea` checked, the two-line description); When `common.back` is clicked, Then step 1 with apartment checked; Given a listing with `rooms: 12`, Then the rooms select shows `12` — `EditListingPage.test.tsx::ac3_prefilled_from_listing`
- [ ] AC4 Given A, When price is changed to `7500`, arnona is cleared, `listings.next` clicked, Then the preview shows `formatIls(7500)` with `listings.units.ils`; When `listings.save` is clicked, Then exactly one `PATCH /listings/A` with body **exactly** `{"price_ils": 7500, "arnona_ils": null}` and `credentials: 'include'`, the button disabled with `aria-busy` while pending; on 200 the URL is `/me/listings`, the card shows the new price with no skeleton, `role="status"` reads `listings.edit.saved`, and the `['listing', 'A']` query is invalidated; Given an unchanged form, When saved, Then no `PATCH`, the URL is `/me/listings` and there is no status line — `EditListingPage.test.tsx::ac4_save_sends_only_changed_fields`
- [ ] AC5 Given A, When city is cleared and price set to `100` and `listings.next` clicked, Then `listings.errors.required` under city and `listings.errors.range` (500, 100000) under price, focus on city, still step 2, no `PATCH` — `EditListingPage.test.tsx::ac5_reuses_wizard_validation`
- [ ] AC6 Given a changed price and `listings.save`: answer 422 `{"detail":[{"loc":["body","city"],"type":"value_error","msg":"city has too many combining marks in a row"}]}` → step 2, city `aria-invalid="true"` with `listings.errors.invalid` in its `aria-describedby` alert, focus on city (`document.activeElement`, not the `<h1>`), and the English `msg` text is nowhere in the document; then a blur out of city, and a change of street, both keep the city error; a change of city clears it; 422 `{"detail":[{"loc":["body"],"type":"value_error","msg":"bad row"}]}` → `common.error` on step 3; 422 `{"detail":"unknown_area"}` → `listings.errors.areaInactive` with `common.back`; 409 → `listings.errors.capReached`; 404 → `<h1>` `listings.edit.notFound` at once, with **no** second `GET /me/listings` response queued in `mockApi` (A was removed from the cache by `setQueryData`); 401 → `/login`; 403 → `/`; network error → `common.error` + `common.retry`, and retry re-sends the identical PATCH body — `EditListingPage.test.tsx::ac6_save_errors`
- [ ] AC7 Create wizard, same mapping: in `ac5_publish_errors` the existing list-422 case changes its fixture to `loc: ["body"]` (still `common.error`, no retry), and a new case `loc: ["body","city"]` → back on step 2 with `listings.errors.invalid` under city and focus on the city input (`document.activeElement`, via `focusAfterStep`, not the `<h1>`), and a blur out of city keeps the error — `web/src/features/listings/__tests__/ListingWizard.test.tsx::ac5_publish_errors`
- [ ] AC8 Given A with `expires_at` in the past (status `active`), Then the edit page shows `listings.edit.expiredHint` on steps 1–3, and a price change saves with body `{"price_ils": \u2026}` (no `status`); Given a live or a paused listing, Then no hint — `EditListingPage.test.tsx::ac8_expired_listing_editable_with_hint`
- [ ] AC9 Given the edit page with nothing changed, When a `beforeunload` event is dispatched, Then `defaultPrevented` is false, and clicking `listings.edit.backToMine` navigates without calling `window.confirm`; Given a changed field, Then `defaultPrevented` is true, and clicking the link calls `confirm` with `listings.edit.leaveConfirm` — `false` stays on the page with the value kept, `true` lands on `/me/listings`; after a successful save no listener remains (a dispatched event is not prevented); Given `GET /areas` still pending (`deferred()`) on an untouched form, Then a dispatched `beforeunload` is not prevented (dirty reads `form`, not `withArea`'s `area_id: ''`) — `EditListingPage.test.tsx::ac9_unsaved_changes_guard`
- [ ] AC10 Given three listings (live, paused, expired), Then each card has a link `listings.actions.edit` to `/me/listings/{id}/edit` whose `aria-describedby` names an element containing that card's title, and the pause/resume button has the same description; Given the page is entered with `state: { saved: true }`, Then `role="status"` `listings.edit.saved`; without it, no status — `web/src/features/listings/__tests__/MyListingsPage.test.tsx::ac10_edit_link_on_every_card`
- [ ] AC11 `formFromListing` / `changedFields` table: for `listing()` fixtures with nulls everywhere nullable, `rooms` 3 / 3.5 / 12, a two-line description and a past `available_from`, `changedFields(l, toListingIn(formFromListing(l)))` is `{}` and `validate(formFromListing(l), today)` is `{}`; clearing total floors → `{total_floors: null}`; description set to `"  "` → `{description: null}`; rooms `"3.5"`→`"4"` → `{rooms: 4}`; city `" \u05d2\u05d1\u05e2\u05ea\u05d9\u05d9\u05dd "` on a stored `"\u05d2\u05d1\u05e2\u05ea\u05d9\u05d9\u05dd"` → `{}` (cleaned before compare); another `area_id` → `{area_id}`; `status` is never a key — `web/src/features/listings/__tests__/validate.test.ts::ac11_form_from_listing_and_changed_fields`
- [ ] AC12 Given `make dev` is up, When Playwright signs up an owner (`helpers.ts::signUpOwner`), posts a listing through `page.request` with `arnona_ils: 480` (as `search.spec.ts`), opens `/me/listings`, clicks `listings.actions.edit`, changes the price to `7500`, clears arnona, goes to the preview and clicks `listings.save`, Then the PATCH request's `postDataJSON()` equals `{price_ils: 7500, arnona_ils: null}`, the URL is `/me/listings`, the card shows `/7,500[\s\u200e\u200f]*\u20aa/` with `listings.status.live` and `listings.edit.saved` is visible, and `GET /me/listings` (via `page.request`) has `arnona_ils: null` — `web/e2e/listings.spec.ts::ac12_owner_edits_listing`
- [ ] NF1 `make lint`, `make test`, `make i18n-check` clean; `0002b`'s and `0003b`'s web tests pass unchanged except the AC7 fixture; no file under `api/` changes and `make client` leaves `web/src/api/schema.d.ts` unchanged — CI `web` job, code reviewer
- [ ] NF2 Edit state is component state only (no `localStorage` / `sessionStorage` / URL query), no `console.*` under `features/listings/`, no second form component (the edit page renders `ListingWizard` / `DetailsStep`, never a copy) — code reviewer; keyboard through the edit flow in RTL at 390 px — ux reviewer in a browser

## Tests to write
Unit (vitest, testing-library `fireEvent`, `mockApi` fetch sequences, `MemoryRouter`, `QueryClient`
`retry: false`): AC2–AC6, AC8, AC9 in `EditListingPage.test.tsx`; AC1 in `RequireOwner.test.tsx`; AC7 in
`ListingWizard.test.tsx`; AC10 in `MyListingsPage.test.tsx` (via the widened `renderRoutes`); AC11 in
`validate.test.ts`. AC9 stubs `window.confirm` with `vi.spyOn` and
dispatches `new Event('beforeunload', { cancelable: true })` on `window`. Integration: none (no API change).
E2E: AC12 (`make e2e`).

## Risks / open questions
**Product questions for Gilad.** The coder builds the recommendation of each; a different answer before the
build is a spec edit, after it a small change.
- **Q1 — Can an owner edit an expired listing?** (PATCH allows it; renewal is Slice 10.)
  (a) Editable, with the hint "edits are saved but it stays hidden until renewed" — **recommended**: no
  extra code path, the owner can fix the price now and renew later with Slice 10, nothing becomes public.
  (b) Read-only: no edit link on expired cards; the edit URL shows "expired, renewal comes later".
  (c) Editing renews it (`expires_at` reset) — needs an API change and decides Slice 10's renewal rule early;
  not recommended.
- **Q2 — How hard do we guard unsaved edits?** The app uses `BrowserRouter` (library mode), where
  react-router's `useBlocker` does not work.
  (a) `beforeunload` (reload / close tab) plus a confirm on the page's own "back to my listings" link;
  browser Back and header links leave silently — **recommended** for now: no router change, a few lines.
  (b) Switch `App.tsx` to `createBrowserRouter` + `RouterProvider` so `useBlocker` guards every in-app
  navigation incl. browser Back, for edit **and** the create wizard (closes FOLLOWUPS `0002b` browser Back);
  costs a router migration and a data-router variant of the shared test harness — a separate small spec.
  (c) No guard at all.
- **Q3 — May an edit change the listing type (apartment ↔ room)?** The PATCH allows it.
  (a) Yes, step 1 is reachable with "back" as in the create wizard — **recommended**: zero extra code and
  fixes a mis-picked type; a listing switched to room drops out of search until Slice 7, exactly like a room
  listing created today.
  (b) Lock the type in edit mode (step 1 read-only); a wrong type means pause and re-create, which costs a
  cap slot only while live.

**Assumptions (orchestrator, not Gilad calls):** an edit applies to the live row immediately (PRODUCT.md
"no drafts"); an edit does not bump the listing's position in "newest" search order (`created_at` is
unchanged; bumping would invite edit-to-top gaming); after a save the owner lands on `/me/listings`.

**Technical risks the verifier should challenge:**
- **Area preselect:** `ListingWizard.withArea` preselects the only active area. If a listing's stored area
  was deactivated and exactly one other area is active, the edit form shows that area and a save sends
  `area_id` (visible in the select, re-checked by the API). With one seeded area this cannot happen today.
- **Text stored before `0002d`:** the API re-validates the merged row, so a stored city that now fails
  `require_alnum` makes any PATCH 422 at `["body","city"]` even if city was not sent; AC6's field mapping then
  points the owner at city. Dev data only (no production yet).
- **Stale cache:** the edit form starts from `['me','listings']` (App `retry: 1`, default `staleTime` 0, so
  it refetches on mount). Only fields changed against the `base` snapshot are sent, so a field changed in
  another tab is not overwritten unless the owner also changed it here (AC2 pins it).
- **Shared mapping touches create:** AC7 changes one `0002b` test fixture (a list 422 at `body.city` now shows
  the field error instead of `common.error`); intended, and it partly closes FOLLOWUPS `0002d` · `validate.ts`.
- **Date input:** a stored `available_from` in the past sits below the input's `min={today}`; `noValidate`
  keeps it submittable and `validate` accepts past dates (reads "immediate"), as AC11 pins.
- Web-only spec: per Speed rule 2 it does not build at the same time as another web spec (Vite port 5173).

## Verifier findings — one round, 7 findings, all applied
1. Diff baseline: `base` snapshot taken once in `ListingWizard`; dirty and save diff against it (Scope; AC2 refetch-with-other-street case).
2. Dirty reads `form`, not `withArea(current)` (Scope; AC9 pending-areas case).
3. Server field errors in their own `serverErrors` state, cleared per changed field and on save (Scope; AC6 blur/street/city cases).
4. `focusAfterStep` ref so the `[step]` effect focuses the first server-error field, not the `<h1>` (Scope; AC6, AC7).
5. 404 removes the id with `setQueryData` before invalidating, so not-found renders at once (Scope; AC6 404 case).
6. `renderRoutes` `path` widened to `InitialEntry`; `harness.tsx` named in Scope (AC10).
7. AC1 moved to `RequireOwner.test.tsx::ac1_owner_only_routes`, edit path added to its tree (AC1, Tests to write).

## Digest (filled by orchestrator after verification)

    Spec 0002e - Edit a listing (web)   (verified, web only, no API change, no depends_on open)
    What a user can do after this: an owner opens /me/listings/:id/edit from an edit link on each card, changes any
             field in the same wizard form, and saves; only changed fields are sent, a cleared optional field is
             cleared, server errors land on the named field.
    Decisions I need from you (built on the recommendation meanwhile):
      Q1. Expired listings: (a) editable with a "stays hidden until renewal" notice [rec] (b) read-only (c) edit renews it.
      Q2. Unsaved edits: (a) warn on reload/close + confirm on the page's back link [rec] (b) router switch so every
          navigation is guarded, own spec (c) no guard.
      Q3. Listing type on edit: (a) can switch apartment/room [rec] (b) locked.
    Reviewers: code, qa, ux   Estimated: 1 coder run, 1 review round
