---
id: 0003b
title: Anyone opens /search, filters live apartments by price, rooms, entry date and features, sorts and pages the results, and opens a public listing page
status: done
depends_on: [0003a, 0002b]
reviewers: [code, qa, ux]   # ux: two new screens + header link; no security: public read-only data, no new credentials; no perf: query cost is 0003a's NF2, the page renders ≤ 20 cards per fetch
estimate: 1 coder run
---

## Goal
After this ships, anyone (logged in or not) opens http://localhost:5173/search, narrows the list with the filters
from `SearchDesktop.dc.html` (price from/to, rooms from/to, entry date, pets / furnished / elevator / parking),
changes the sort, loads more results, and opens `/listings/{id}` — the public listing page from `Listing.dc.html`
without the parts later slices own. Filters live in the URL, so a search can be shared, reloaded and walked back
with the browser's back button. Serves Dev Plan slice 3 (Seeker search), part b of two, on top of `0003a` (API) and
`0002b` (`ListingCard`, `format.ts`, `ChoiceGroup`, listings i18n keys).

## Scope
**In:**
- Routes in `web/src/app/routes.tsx`: `/search` → `SearchPage`, `/listings/:id` → `ListingPage`, both public (no
  `RequireOwner`). `0002b`'s `/listings/new` stays a static route, which react-router 7 ranks above `:id` (AC1
  proves it).
- `web/src/app/Layout.tsx`: a link `header.search` → `/search` for everyone, between the brand and `AuthMenu`; the
  header row gets `flex-wrap` so it wraps at 390 px instead of overflowing. `AuthMenu` is not touched (`0002b` owns
  its owner link).
- `web/src/features/search/`: `filters.ts` (pure: `type Filters`, `parseFilters(URLSearchParams): Filters`,
  `toSearchParams(Filters): URLSearchParams`, `countActive(Filters): number`; unit-tested), `api.ts`
  (`searchListings(filters, offset)`, over the `openapi-fetch` client, typed from `schema.d.ts` after `make client`),
  `useSearch.ts` (TanStack `useInfiniteQuery`, key `['search', filters]`, `limit` 20, `initialPageParam: 0`,
  `getNextPageParam: (last, pages) => { const loaded = pages.reduce((n, p) => n + p.items.length, 0); return
  last.items.length > 0 && loaded < last.total ? loaded : undefined; }`), `SearchPage.tsx`, `FiltersForm.tsx`,
  `SortSelect.tsx`, `ResultsList.tsx`. When flattening pages, an id already seen is skipped (a listing created
  mid-paging shifts offsets by one; the repeat is dropped, not shown); the next offset still counts raw items.
- `web/src/features/listings/` (from `0002b`): `ListingPage.tsx`, `usePublicListing.ts` (key `['listing', id]`),
  `fetchPublicListing(id)` added to `api.ts`, `ListingFacts.tsx` (the `<dl>` grid). `ListingCard` gains one optional
  prop `to?: string`: when set, the card's title is a `<Link to={to}>` (the rest of the card unchanged, so `0002b`'s
  wizard preview and "my listings" rows render exactly as before and their tests stay green). If its data prop is
  typed `ListingOut`, it is narrowed to `Pick<ListingOut, …the fields it renders>` so a `ListingPublic` (no
  `status` / `expires_at` / `owner_id`) is assignable; no runtime change. `ListingPage` copies the photo-placeholder
  markup rather than extracting it.
- `he.json` keys in UI below. Tests in `web/src/features/search/__tests__/` and
  `web/src/features/listings/__tests__/ListingPage.test.tsx`; e2e `web/e2e/search.spec.ts` (reuses
  `web/e2e/helpers.ts` from `0002b`).
- No Makefile / CI change.

**Out:**
- The map tab and the desktop map pane (`0003c`, after Gilad picks a tile source — see `0003a` Risks).
- The desktop three-column layout of `SearchDesktop.dc.html` (filters aside, results, map): Slice 9 polish. This
  slice stays in `Layout`'s `max-w-[640px]` column on every width, filters in a collapsible panel.
- Active-filter chips under the search bar (`Search.dc.html` "עד 8,000 ₪ · 3–4 חדרים"); the filters button shows
  the active count instead. Slice 9 may add the chips.
- Match % and "sorted by match" (Slice 6), saved search (later), type filter and roommate rows (Slice 7/8),
  balcony (no field), photos / gallery / "12 תמונות" (`0002c`), share and save buttons, the owner block and
  "מה בעל הדירה מחפש" (Slice 4/6/10), "הגש/י מועמדות" and "קבע/י סיור" (Slice 4), the bottom tab bar (Slice 9),
  nearby-places line ("4 דק׳ לרכבת הקלה", needs geodata).

**New dependencies:** none. `useInfiniteQuery` is TanStack Query (already pinned); `useSearchParams` is react-router 7.

## Data
None. Consumes `0003a`.

## API
No new endpoints. Consumes `0003a`: `GET /listings` (`SearchParams` query → 200 `ListingSearchOut {items, total}` /
422) and `GET /listings/{listing_id}` (200 `ListingPublic` / 404 `not_found` / 422 non-uuid). Both public; the
client still sends `credentials: 'include'` (the shared `api` client does), which the API ignores.

## UI
Tokens and card anatomy from `0002b`; search structure and copy from `Search.dc.html` / `SearchDesktop.dc.html`;
listing page from `Listing.dc.html`. Logical properties only; every string from `he.json`.

**Header** (`Layout`): `header.search` link (≥ 44 px tap target) for every visitor; `aria-current="page"` when on
`/search` (react-router `NavLink`).

**`/search` (`SearchPage`)**. The URL is the only filter state: `parseFilters(useSearchParams())` → `Filters` → the
query key. `<h1>` = `search.title`.
- Toolbar row: a button `search.filters` (when `countActive > 0`: `search.filtersActive` `{{count}}`) with
  `aria-expanded` and `aria-controls` = the panel's id, toggling the filters panel (closed on first load, open
  after a toggle until toggled again; the open state is component state, not URL); at the inline end `SortSelect`
  (`<label>` `search.sort.label`, options `search.sort.newest` / `search.sort.price_asc` / `search.sort.price_desc`).
  Changing the sort updates the URL at once (`setSearchParams`, `replace: false`), without the apply button.
- Filters panel (`FiltersForm`, `<form noValidate>`, initial values from the URL). `SearchPage` renders
  `<FiltersForm key={searchParams.toString()} …>`, so any URL change (back, clear, sort) remounts the form with the
  URL's values and discards unsaved edits. `<fieldset>` `search.price` with
  two inputs labelled `search.from` / `search.to` (`type="text" inputMode="numeric"`; non-digits are stripped on
  change with `value.replace(/\D/g, '')`, no thousands separator; suffix `listings.units.ils`); `<fieldset>` `search.rooms` with two `<select>`s labelled `search.from` / `search.to`
  (first option `search.any` = no bound, then 1 … 10 in steps of 0.5 via `formatRooms`); `search.availableBy`
  (`type="date"`, hint `search.availableByHint`); `<fieldset>` `search.features` with four native checkboxes styled as
  the artboard's chips: `search.feature.pets`, `search.feature.furnished`, `search.feature.elevator`,
  `search.feature.parking`. Buttons: primary submit `search.apply`, secondary `search.clear`.
  Apply validates (on submit only): price outside 0–100000 → `listings.errors.range` (`{{min}}`, `{{max}}`); price
  from > to → `search.errors.priceOrder` under the price "to" input; rooms from > to → `search.errors.roomsOrder`
  under the rooms "to" select; each message `role="alert"` + `aria-describedby`, focus on the first invalid field,
  URL unchanged. Valid → `setSearchParams(toSearchParams({ ...parseFilters(current), ...formValues }))` (a new
  history entry; `sort` survives apply; empty and default values omitted, so a clean search is `/search`).
  Clear → `setSearchParams({})` (drops `sort` too) and the form resets via the `key`.
- Results (`ResultsList`), under a count line `<p aria-live="polite">` that is **always mounted** (empty while
  loading or on error, so the first announcement is heard). First-page states branch on `data === undefined`
  (`isPending` → skeleton, else ErrorState), never on `isError`, which v5 also sets on a failed next page:
  - loading (first page): three `Skeleton` rows in `<ul aria-busy aria-label={common.loading}>` (as `AreasList`).
  - error (first page): `ErrorState` with retry (`refetch`).
  - empty (`total === 0`): `EmptyState` `search.empty`, plus the `search.clear` button when `countActive > 0`.
  - success: count line `search.countOne` when `total === 1`, else `search.count` `{{count}}`; a `<ul>` of
    `ListingCard to={`/listings/${id}`}` in API order; below, while `loaded < total`, a button `search.more`
    (`fetchNextPage`; disabled with `aria-busy` while fetching). A next-page failure (`isFetchNextPageError`) shows
    `common.error` + `common.retry` (retry = `fetchNextPage`) under the list and keeps the loaded cards.
- `parseFilters` rules (the URL is user input): `price_min` / `price_max` match `/^\d{1,6}$/` and are ≤ 100000
  (`0` is a kept value, not a default); `rooms_min` / `rooms_max` match `/^\d{1,2}(\.5)?$/` and are 1–10 (the
  select's range); `available_by` matches `/^\d{4}-\d{2}-\d{2}$/` and `new Date(s + 'T00:00:00Z')
  .toISOString().slice(0, 10) === s`; `pets`, `furnished`, `elevator`, `parking` only the exact string `true`;
  `sort` one of the three values (`newest` parses, but `toSearchParams` omits it as the default). Anything else is
  dropped (not sent, not shown in the form). If a min and its max are both valid but min > max, the max is
  dropped. So no URL can produce a 422 from `0003a`. `toSearchParams` key order: `price_min, price_max, rooms_min,
  rooms_max, available_by, pets, furnished, elevator, parking, sort`. `countActive` = the number of non-`sort` keys
  present after parsing (`price_min` and `price_max` count separately).

**`/listings/:id` (`ListingPage`)**. Top: link `listing.backToSearch` → `/search` (the browser back button keeps
the filters, since they are in the URL).
- loading: `Skeleton` blocks for the title, price and facts.
- not found (API 404 **or** 422 for a malformed id): `<h1>` `listing.notFound`; the top `listing.backToSearch`
  link stays and is the only one (no second link).
- error (network / 5xx): `ErrorState` with retry.
- success, in artboard order: the neutral photo placeholder tile from `0002b`'s card; price `formatIls` +
  `listings.units.perMonth`; `<h1>` `listings.card.title` (`{{rooms}}`, `{{street}}`, `{{city}}`); facts row
  `listings.card.floorOf` / `listings.card.floor`, size + `listings.units.sqm`, `listings.card.availableFrom` /
  `listings.card.immediate` (date ≤ today), and `listings.fields.entryFlexible` when `entry_flexible`; then
  `ListingFacts`, a `<dl>` of label/value pairs: `listings.fields.elevator` → `listing.yes` / `listing.no`;
  `listings.fields.parking` → `listing.no` (0), `listing.parkingOne` (1), `listing.parkingMany` `{{count}}` (2–5);
  `listings.fields.furnished` → `listings.furnished.{value}`; `listings.fields.pets` → `listing.allowed` /
  `listing.notAllowed`; `listings.fields.arnona` → `formatIls` (row omitted when `null`); `listings.fields.vaad` →
  `formatIls` (omitted when `null`). Then, when `description` is set, `<h2>` `listings.fields.description` and the
  text with `whitespace-pre-line` (line breaks kept, no HTML). Then `<h2>` `listing.location`: `{{street}},
  {{city}}` via `listing.address` and the hint `listing.locationHint`.
- No apply / tour / share / save buttons (Out).

**RTL**: inherited `dir="rtl"`; "from" fields sit at the inline start of each pair; the sort select at the
inline end of the toolbar; number inputs `text-start` as in `0002b`.

**i18n keys added to `he.json`** (placeholder copy; Slice 9 owns final wording). Reused from `0002b` unchanged:
`listings.card.*`, `listings.units.*`, `listings.furnished.*`, `listings.fields.*`, `listings.errors.range`.

| key | value |
| --- | --- |
| `header.search` | `חיפוש דירות` |
| `search.title` | `חיפוש דירות` |
| `search.filters` | `מסננים` |
| `search.filtersActive` | `מסננים · {{count}}` |
| `search.price` | `מחיר חודשי` |
| `search.rooms` | `חדרים` |
| `search.from` | `מ־` |
| `search.to` | `עד` |
| `search.any` | `הכול` |
| `search.availableBy` | `תאריך כניסה` |
| `search.availableByHint` | `דירות שאפשר להיכנס אליהן עד התאריך הזה` |
| `search.features` | `מאפיינים` |
| `search.feature.pets` | `חיות מחמד` |
| `search.feature.furnished` | `מרוהטת` |
| `search.feature.elevator` | `מעלית` |
| `search.feature.parking` | `חניה` |
| `search.apply` | `הצגת תוצאות` |
| `search.clear` | `ניקוי` |
| `search.sort.label` | `מיון` |
| `search.sort.newest` | `החדשות ביותר` |
| `search.sort.price_asc` | `מחיר: מהנמוך לגבוה` |
| `search.sort.price_desc` | `מחיר: מהגבוה לנמוך` |
| `search.count` | `{{count}} דירות` |
| `search.countOne` | `דירה אחת` |
| `search.empty` | `לא מצאנו דירות שמתאימות לחיפוש. אפשר להרחיב את המסננים.` |
| `search.more` | `עוד דירות` |
| `search.errors.priceOrder` | `המחיר המינימלי גבוה מהמקסימלי` |
| `search.errors.roomsOrder` | `מספר החדרים המינימלי גבוה מהמקסימלי` |
| `listing.backToSearch` | `חזרה לחיפוש` |
| `listing.notFound` | `המודעה לא נמצאה או שכבר אינה פעילה` |
| `listing.yes` | `יש` |
| `listing.no` | `אין` |
| `listing.parkingOne` | `מקום אחד` |
| `listing.parkingMany` | `{{count}} מקומות` |
| `listing.allowed` | `מותר` |
| `listing.notAllowed` | `לא מותר` |
| `listing.location` | `מיקום` |
| `listing.address` | `{{street}}, {{city}}` |
| `listing.locationHint` | `המיקום המדויק יישלח לאחר אישור` |

## Acceptance criteria
Unit tests reuse `web/src/features/auth/__tests__/harness.tsx` (`mockApi`, `renderRoutes`, `testQueryClient`,
`currentPath`; import, do not copy): `MemoryRouter` with `initialEntries`, `retry: false`, mocked `fetch`
sequences, testing-library `fireEvent`. Request params are compared as a set, read from `new
URL(call.request.url).searchParams`. Duplicate accessible names are expected (`header.search` = `search.title`;
both pairs use `search.from` / `search.to`), so tests use `getByRole('heading', {level: 1})`,
`within(getByRole('banner'))`, and `within(getByRole('group', {name: search.price | search.rooms}))`.
- [ ] AC1 Given `/me` resolves to 401 (logged out), then to a seeker, then to an owner, When `/search` is opened, Then `search.title` renders each time with no redirect and the header shows `header.search`; When `/listings/{uuid}` is opened logged out, Then the listing page requests `GET /listings/{uuid}`; Given an owner, When `/listings/new` is opened, Then `0002b`'s `listings.new.title` renders (not `ListingPage`) — `web/src/features/search/__tests__/routes.test.tsx::ac1_public_routes_and_static_new_wins`
- [ ] AC2 Given the URL `/search?price_max=8000&rooms_min=3&pets=true&sort=price_asc`, Then exactly one `GET /listings` is sent with those four params plus `limit=20&offset=0`, the filters toggle reads `search.filtersActive` with `3` (sort is not a filter), and when opened the form shows 8000, 3 and pets checked; Given `/search?price_max=abc&rooms_min=2.3&pets=maybe&sort=match&available_by=2027-02-30&colour=red`, Then the request carries only `limit` and `offset`; Given `/search?price_min=9000&price_max=8000`, Then only `price_min=9000` is sent — `web/src/features/search/__tests__/SearchPage.test.tsx::ac2_url_is_the_filter_state`
- [ ] AC3 Given `/search`, When the panel is opened, "to" price set to `8000`, pets checked and `search.apply` clicked, Then the location's search is `?price_max=8000&pets=true` and a new `GET /listings` is sent with them; When `search.clear` is clicked, Then the search is empty and the form is reset; When the history goes back one entry (the test renders a probe `<button onClick={() => navigate(-1)}>` using `useNavigate()` next to the routes and clicks it), Then the URL is `?price_max=8000&pets=true` again and the form shows it; Given price from `9000` and to `8000`, When apply, Then `search.errors.priceOrder` with `role="alert"` and `aria-describedby` on the "to" input, focus on it, and the URL unchanged; the same for rooms from 4 / to 3 with `search.errors.roomsOrder` under the rooms "to" select; Given `/search?sort=price_asc`, When pets is checked and applied, Then the search is `?pets=true&sort=price_asc` — `web/src/features/search/__tests__/SearchPage.test.tsx::ac3_apply_clear_back_and_validation`
- [ ] AC4 Given `GET /listings` pending, Then three skeletons with `aria-busy`; Given it fails, Then `ErrorState` and retry re-requests; Given `{"items": [], "total": 0}` on `/search?pets=true`, Then `search.empty` and a `search.clear` button (and on `/search` with no filters, no clear button); Given one item, Then `search.countOne`; Given three items and `total: 3`, Then `getByText('3 דירות').closest('[aria-live="polite"]')` is not null, three cards in API order, each title a link to `/listings/{id}`, and no `search.more` button — `web/src/features/search/__tests__/SearchPage.test.tsx::ac4_result_states`
- [ ] AC5 Given the first page answers 20 items with `total: 25`, Then `search.more` shows; When clicked, Then `GET /listings` is sent with `offset=20` and the same filters, the button is disabled with `aria-busy` while pending, and on 200 with 5 items there are 25 cards and no button; Given the second page fails instead, Then `common.error` + `common.retry` under the 20 cards (still shown) and retry re-requests `offset=20` — `web/src/features/search/__tests__/SearchPage.test.tsx::ac5_load_more`
- [ ] AC6 Given `/search?pets=true`, When the sort select changes to `search.sort.price_desc`, Then the URL becomes `?pets=true&sort=price_desc` without clicking apply and a request with `sort=price_desc&offset=0` is sent — `web/src/features/search/__tests__/SearchPage.test.tsx::ac6_sort_applies_at_once`
- [ ] AC7 Given `GET /listings/{id}` pending, Then skeletons; Given 200 with the `0002a` AC1 values (rooms 3.5, floor 3 of 5, 95 sqm, 7200, `entry_flexible: true`, elevator, parking 1, partial, pets, arnona 480, vaad 150, a two-line description), Then `<h1>` `3.5 חדרים, רחוב כצנלסון, גבעתיים`, the price matches `/7,200[\s‎‏]*₪/` (`Intl` may insert bidi marks), the facts row includes `listings.fields.entryFlexible`, the `<dl>` pairs read elevator `יש`, parking `מקום אחד`, furnished `מרוהטת חלקית`, pets `מותר`, arnona and vaad with `480` / `150`, the description element's `textContent` contains `\n` (the default whitespace normaliser would hide it from `getByText`), and `listing.locationHint` shows; Given `arnona_ils: null`, Then no arnona row; Given 404, and given 422, Then `listing.notFound` and exactly one `listing.backToSearch` link, to `/search`; Given 500, Then `ErrorState` and retry re-requests — `web/src/features/listings/__tests__/ListingPage.test.tsx::ac7_public_listing_page`
- [ ] AC8 `filters.ts` unit table: `parseFilters` keeps valid values (including `price_min=0`) and drops each invalid one listed in AC2 (plus `price_max=-1`, `price_max=100001`, `price_max=8000.5`, `price_max=8e3`, `price_max=%208000`, `price_max=`, `rooms_max=0.5`, `rooms_max=10.5`, `parking=1`, `furnished=TRUE`, `available_by=2027-2-3`), drops the max when min > max (price and rooms), `sort=newest` parses and is omitted on output, `countActive` counts each kept non-`sort` key, and `toSearchParams(parseFilters(p))` omits defaults and empty values, emits the key order in UI, and round-trips every valid combination in the table (table rows are written in canonical form) — `web/src/features/search/__tests__/filters.test.ts::ac8_filter_rules`
- [ ] AC9 Given `make dev` is up, When Playwright signs up a fresh owner in the UI on `page` (as `auth.spec.ts`, using `latestCode` from `web/e2e/helpers.ts`), then calls `page.request.get(API + '/areas')` for the `area_id` and `page.request.post(API + '/listings', {data})` with street `e2e <run id>` and price 7200, where `API = 'http://localhost:' + (process.env.API_PORT ?? '8000')` (`localhost`, not `127.0.0.1`, so the session cookie is sent; `make e2e` exports `API_PORT`), then `page.context().clearCookies()` and `page.goto('/search')`, Then a card on the first page (newest first; other runs and `0002b`'s parallel `listings.spec.ts` may add rows) has that street and matches `/7,200[\s‎‏]*₪/`; one fresh owner posts one listing, so the cap never applies; When the "to" price is set to 5000 and applied, Then no card has that street; When `search.clear` is clicked, Then it is back; When its title is clicked, Then the URL is `/listings/{id}`, the `<h1>` has the street, and a reload shows the same page — `web/e2e/search.spec.ts::ac9_visitor_searches_and_opens_listing`
- [ ] NF1 `make i18n-check`, `eslint`, `prettier --check`, `tsc --noEmit` clean; `0002b`'s tests pass unchanged with the `ListingCard` `to` prop — CI `web` job
- [ ] NF2 Every control has a visible `<label>` (price and rooms pairs inside `<fieldset>` + `<legend>`); the filters toggle has `aria-expanded` / `aria-controls`; the count line is `aria-live="polite"`; validation errors are `role="alert"` + `aria-describedby`; each card is reachable as one link named by its title; tap targets ≥ 44 px — the label/role queries in AC2–AC7 and the ux reviewer in a browser at 390 px and 1280 px (keyboard through filters → results → listing → back)
- [ ] NF3 Filter state lives only in the URL (no `localStorage` / `sessionStorage`, no copy in component state beyond the form's unsaved edits); no `console.*` under `features/search/` — checked by the code reviewer

## Tests to write
Unit (vitest): AC1–AC8. Integration: none. E2E: AC9 (`make e2e`), on the shared e2e database where earlier runs
leave listings, hence the per-run street and "first card" under the default newest sort.

## Risks / open questions
- Builds on `0002b` (not yet open as a PR) and `0003a`. Per Speed rule 2 two web specs do not build at once on this
  Mac (port 5173), so this starts after `0002b`'s PR is open: branch from `spec/0002b-listings-web` with
  `spec/0003a-search-api` merged in, run `make client` against a stack running `0003a`, rebase after each merges.
  If `0002b` names `ListingCard`'s props or `format.ts` differently in review, the coder follows the merged code;
  the `to` prop and the type narrowing are the only changes to it.
- Offset paging plus newest-first: a listing created while a visitor pages shifts later pages by one. The flatten
  step skips ids already seen (Scope), so no duplicate key and no repeated card; the shifted-out listing is the
  new one, which is at the top on the next search. Accepted at this scale.
- `<input type="date">` and the jsdom weak spot are as in `0002b` (`fireEvent.change` with `YYYY-MM-DD`).
- The header gains a second link next to `0002b`'s owner link; at 390 px the row wraps. The ux reviewer checks it
  against `Search.dc.html`'s header in a browser.
- Product assumptions are `0003a`'s (public search, no map, newest-first, entry-date meaning, rooms hidden, no
  owner identity). Nothing is decided here beyond placeholder copy and the 640 px column.

Changes after verifier round 1 (2026-11-10): history-back probe in AC3; form remounts on URL change via `key` and
`sort` survives apply; canonical key order and set comparison of request params; exact `parseFilters` regexes,
rooms 1–10, `countActive` defined; `useInfiniteQuery` page params and first-page vs next-page error branches;
duplicate ids skipped when flattening; bidi-tolerant `₪` regex; live region always mounted; duplicate-name query
strategy and one back link on not-found; `ListingCard` type narrowing; AC9 rewritten around `page.request` with the
`localhost` API and `clearCookies`; price digit stripping and rooms error placement; reviewer comment; harness
reuse and `textContent` line-break check.

Verifier notes (2026-11-10): round 1 rejected with 15 findings, all applied above; one verifier round per spec,
so the orchestrator set `verified`.

## Digest (filled by orchestrator after verification)

    Spec 0003b — Search web: /search + public listing page   (verified, part 2 of 2, depends on 0003a and 0002b)
    What a user can do after this: anyone opens /search, filters by price, rooms, entry date and features, sorts, loads more, and opens /listings/{id} with the facts grid, description and location hint; filters live in the URL (shareable, back button works); the header gets "חיפוש דירות".
    Decisions I need from you (reply with numbers):
      1. Placeholder Hebrew copy for 39 new keys (recommend: accept; Slice 9 owns wording).
      2. One 640 px column on desktop too, filters in a collapsible panel; the artboard's three-column desktop layout and active-filter chips wait for Slice 9 (recommend: accept).
      3. The listing page has no apply / tour / share / save buttons until Slice 4 (recommend: accept).
    KPIs this slice moves: search → listing-page click-through.
    Acceptance targets: NF1 i18n-check, eslint, prettier, tsc clean, 0002b tests unchanged · NF2 labelled controls in fieldsets, aria-expanded filter toggle, live result count, ≥ 44 px targets · NF3 filter state only in the URL.
    Risks: builds on 0002b, still being built — mitigation: starts only once 0002b's PR is open (one web spec at a time on port 5173), branches from it with 0003a merged in, rebases after each merge.
    Reviewers: code, qa, ux   Estimated: 1 coder run, 1 review round
    Links: specs/0003b-search-web.md · design/screens-v1/Search.dc.html, SearchDesktop.dc.html, Listing.dc.html
