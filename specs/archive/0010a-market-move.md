---
id: 0010a
title: The app has two sides, דירות and שוק השותפים, behind a switch at the top; rooms leave the apartment search and live in the market (its own search, its own "שלי", its own bottom bar), and a listing can no longer switch between apartment and room
status: done
depends_on: []   # Wave 1 with 0010d (no shared files). 0010b, 0010c, 0010e build on the names fixed here (MARKET-PLAN.md section 7)
reviewers: [code, qa, ux]   # qa: the search default flips for every client and ~15 tests move; ux: a new header control, two new pages, a regrouped bottom bar
estimate: 1 coder run   # coder Opus/high (Speed rule 6, "when in doubt the stronger one"): no auth or data, but ~25 source files and ~20 test files across api, web and e2e
---

## Goal
After this ships, every visitor and signed-in person sees a two-way switch at the top, **דירות** / **שוק השותפים**.
- דירות is today's app with rooms taken out: `/search` lists whole apartments only, "המודעות שלי" shows
  apartments only, "המועמדויות שלי" shows apartment applications only.
- שוק השותפים is a new area: `/market` is the rooms search (list and map), `/market/mine` ("שלי") holds the
  person's own rooms or room applications, and the bottom bar shows the market's own tabs.
- A room keeps its address `/listings/:id`; its back link returns to the market. Old `/search?listing_type=room`
  links land in the market.
- `GET /listings` without `listing_type` returns apartments only, so no client gets a mixed list by leaving the
  parameter out.
- An edit can no longer switch a listing between apartment and room (`PATCH` refuses `listing_type`), and the
  wizard can start on a given type (`/listings/new?type=room|apartment`).

Owner and seeker roles still apply everywhere in this spec; `0010b` removes them inside the market. This is
`specs/MARKET-PLAN.md` section 3 "Step 1" and section 7 (binding names), and PRODUCT.md "שוק השותפים" (Gilad,
2026-11-13: Q1 switch at the top, Q2 a room keeps its address, Q3 redirect, Q4 no type switch, Q6 landing page
unchanged, Q7 one landing entry point).

## Scope
**In — API:**
- `api/app/schemas/search.py`: `SearchParams.listing_type: ListingType = "apartment"` (was `ListingType | None =
  None`, "Omitted: both types"). The comment becomes "Omitted: `apartment` (spec 0010a); rooms are asked for
  explicitly by the market". The module docstring's "Rooms are public (spec 0007b), next to apartments;
  `SearchParams.listing_type` narrows to one type" is rewritten to say each type is searched on its own.
  `services/search.py::_filtered` keeps `if params.listing_type is not None` → becomes an unconditional
  `query.where(Listing.listing_type == params.listing_type)`. The map (same endpoint with a bbox) follows by
  itself. `GET /listings/{id}` is unchanged (both types).
- `api/app/schemas/listing.py::ListingPatch`:
  - the `listing_type` field is deleted;
  - `model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")`.
  
  **Decision (422, not ignore):** a PATCH body that still carries `listing_type` (a stale cached PWA, a script)
  gets FastAPI's 422 with `{"type": "extra_forbidden", "loc": ["body", "listing_type"], ...}`, so nobody is told
  "saved" while the type did not change. The same 422 now meets any unknown key. The web client sends only
  known keys (`changedFields` iterates `ListingInBody`'s keys, and those are the `ListingPatch` fields plus
  `listing_type`, see Web). The existing 422 handler must still not echo the body
  (`test_listings.py::test_review_validation_error_never_echoes_request_body`).
- `api/app/services/listings.py`: the type-switch code goes.
  - `_merged` loses `if sent.get("listing_type") == "apartment": current.update(ROOM_FIELD_DEFAULTS)` and its
    docstring sentence.
  - `update_listing` loses the whole `if "listing_type" in patch.model_fields_set:` block, which today resets the
    room fields and clears `flatmate_invite_hash` (0008d).
  - The module docstring (`:14-22`) loses its type-switch sentences ("A switch to an apartment resets the
    four…", "any `listing_type` change writes all four", and the whole "Flatmates (spec 0008d): a switch to an
    apartment also turns the listing's invite link off" paragraph).
  - `ROOM_FIELD_DEFAULTS` stays (`ListingIn` still uses it on create).
  - `routers/listings.py` is unchanged.
- `api/app/routers/search.py`, `services/search.py`: docstrings that say "both types" are corrected. No logic
  change beyond the default.

**In — Web:**
- `web/src/app/side.ts` (new):
  - `type Side = 'apartments' | 'market'`.
  - `sideOf(pathname: string): Side | null` uses `matchPath`.
    - `'market'`: `/market`, `/market/*`, `/me/likes`, `/me/flats`, `/flatmates/join`,
      `/me/listings/:id/people`, `/me/listings/:id/flatmates`.
    - `'apartments'`: `/search`, `/me/listings` (exact), `/me/applications`.
    - `null` (shared): everything else, e.g. `/`, `/listings/:id`, `/listings/new`, `/me/listings/:id/edit`,
      `/me/listings/:id/applicants`, `/chat/*`, `/me/profile`, `/login`, `/signup`.
  - `setSide(side: Side): void` writes `localStorage['homie.side']` (try/catch, a failure is ignored) and
    notifies subscribers.
  - `useSide(): Side` returns `sideOf(useLocation().pathname)`, else the stored side, else `'apartments'`. It
    reads the store through `useSyncExternalStore` (a module-level listener set), so `setSide` re-renders the
    header at once.
  - A side page records itself: `Layout` runs `useEffect(() => { const s = sideOf(pathname); if (s) setSide(s); },
    [pathname])`. The side is a device preference and survives logout.
  - No module-level cache: `getSnapshot` reads `localStorage` each time (try/catch), so tests cannot leak a
    side through module state. `web/src/test-setup.ts`'s `afterEach` adds
    `window.localStorage.removeItem('homie.side')` beside its `sessionStorage.clear()`.
- `web/src/app/SideSwitch.tsx` (new): the header switch, rendered by `Layout.tsx` between the lockup and
  `<AuthMenu />`, signed in and out.
  - Markup: `<nav aria-label={t('side.label')}>` holding two `Link`s. The active one (`useSide()`) carries
    `aria-current="page"` when its home is the current path, and `aria-current="true"` otherwise.
  - Links: **דירות** → `me.data ? homeFor(me.data.role) : '/search'` (`features/landing/home.ts`; owner
    `/me/listings`, everyone else `/search`, and `/search` while `/me` is loading or failed); **שוק השותפים** → `/market`. Each click also calls `setSide`.
  - Look: a segmented pill pair from the kit tokens: `rounded-full`, `border-border`; active `bg-accent-soft
    text-accent-strong font-semibold`; each link `min-h-tap px-4`; logical properties only.
  - Below `md` the switch sits on its own second header row, full width with two equal halves (the lockup and
    logout already fill 390 px). From `md` it is inline after the lockup.
  - It is never hidden by `FOCUSED_ROUTES` (it is not the bottom bar).
- `web/src/features/auth/AuthMenu.tsx`:
  - The signed-in `<nav data-bottom-nav>` renders the tabs of `useSide()` (MARKET-PLAN section 7 "Bottom bar per
    side", roles still apply). Each tab is the existing `NavTab` / `ChatNavLink` / `LikesNavLink`.

    | Side | Owner | Seeker |
    | --- | --- | --- |
    | apartments | המודעות שלי `/me/listings` · צ'אט · חיפוש `/search` | חיפוש `/search` · מועמדויות `/me/applications` · צ'אט · פרופיל `/me/profile` |
    | market | שלי `/market/mine` · צ'אט · שוק `/market` | שוק `/market` · לייקים `/me/likes` · שלי `/market/mine` · צ'אט · פרופיל `/me/profile` |

    לייקים leaves the apartments bar (a seeker's likes are rooms). The market tabs reuse `searchIcon` for שוק and
    the המודעות שלי house icon for שלי.
  - The anonymous nav drops its `NavLink to="/search"` ("חיפוש דירות"; the switch replaces it) and keeps "כניסה".
    The `header.search` key stays (KitPreview and `Button.test.tsx` use it).
  - `FOCUSED_ROUTES` is unchanged: the market adds no focused route in this spec (`/market` is a search page).
- Routes (`web/src/app/routes.tsx`):
  - `market` → `<SearchPage type="room" />` (public);
  - `market/mine` → `<MarketMinePage />` inside `RequireUser`;
  - `search` → `<SearchPage type="apartment" />`.
- `web/src/features/search/SearchPage.tsx` gains a prop `type: 'apartment' | 'room'`.
  - Title `search.title` or `market.title`, for both the `<h1>` and `usePageTitle`.
  - Both `useSearch` and `useMapSearch` get `{ ...filtersWithoutView, listing_type: type }`. The type is part of
    each query key, so `['search', …]` and `['search-map', …]` hold the two sides apart. The existing reset lists
    (`auth/useLogout.ts:41`, `profile/useSaveProfile.ts:21`) reset both sides by prefix and need no new entry.
  - With `type="apartment"`, a URL whose `listing_type` param is `room` renders `<Navigate replace
    to={`/market?${rest}`} />`, where `rest` is the URL's params without `listing_type` (Q3). Any other
    `listing_type` value is ignored.
  - `SearchMap` gets the type through its `filters` prop, as above. The listing page link from a card is
    unchanged.
- `web/src/features/search/filters.ts`:
  - `parseFilters` no longer reads `listing_type`, `toSearchParams` no longer writes it, and `'listing_type'`
    leaves `KEYS`.
  - `LISTING_TYPES`, `ListingTypeFilter` and `isListingType` are deleted.
  - `Filters.listing_type` stays, typed `ListingType` (from `features/listings/api.ts`): it is set only by
    `SearchPage` and is never a URL key.
  - `countActive` must not count it.
- `web/src/features/search/FiltersForm.tsx`: the type fieldset (`:215-257`, `typeBox`, `oneType`,
  `typeHintId`, the `apartment` / `room` form values) is deleted. `ActiveFilterTags.tsx:53-54` are deleted. The
  date hint is `search.availableByHint` for apartments and `market.availableByHint` for rooms (a `type` prop
  passed down from `SearchPage`).
- `web/src/features/listings/ListingPage.tsx`:
  - The back link is `/market` + `listing.backToMarket` for a room and `/search` + `listing.backToSearch` for an
    apartment. While loading or on an error, it follows `useSide()`.
  - The not-found button (`:78`) follows `useSide()`: `market.toSearch` → `/market`, or `listing.toSearch` →
    `/search`.
  - On success the page calls `setSide(l.listing_type === 'room' ? 'market' : 'apartments')` in an effect, so the
    bar matches the listing.
- `web/src/features/listings/NewListingPage.tsx` reads `?type=` (`apartment` | `room`, anything else ignored) and
  passes `initialType` to `ListingWizard`.
- `web/src/features/listings/ListingWizard.tsx`:
  - New prop `initialType?: ListingType`. The form starts with `listing_type: initialType ?? null`.
  - `firstStep = editing || initialType !== undefined ? 2 : 1`. The step state starts at `firstStep`, and the
    back button shows only while `step > firstStep`. This fixes edit mode reaching `TypeStep` (MARKET-PLAN
    section 3: `ListingWizard.tsx:535-545`).
  - The internal `step` (1–4) and `goTo` are unchanged; only what is shown is renumbered. With `shown = step -
    firstStep + 1` and `total = 5 - firstStep`:
    - `listings.stepOf` gets `{ n: shown, total }`;
    - the step list (`:417-419`, today `n = i + 1` compared with `step`) drops `listings.steps.type` when
      `firstStep === 2` and compares each item's own shown number with `shown`;
    - the progressbar (`:455-463`) has `aria-valuenow={shown}`, `aria-valuemax={total}` and width
      `shown / total`.

    Edit mode therefore reads "1 of 3" where it read "2 of 4": every `aria-valuenow` / `aria-valuemax` / "שלב N
    מתוך 4" assertion in `EditListingPage.test.tsx` (e.g. `:774`, `:779`) drops by one and its max becomes 3.
  - After publish: `navigate(room ? '/market/mine' : '/me/listings', { state: { published: true } })`. The edit
    save goes by the listing's type too (the back link and leave are listed below). `BackToMine` (`:100-103`)
    has no importers and is deleted.
  - `TypeStep.tsx` is unchanged and still reached by `/listings/new` with no `type`.
- `web/src/features/listings/validate.ts::changedFields` skips the `listing_type` key (never in a PATCH). Its
  `body.listing_type === 'apartment' && ROOM_FIELDS.has(key)` line stays.
- `web/src/features/listings/MyListingsPage.tsx` and `web/src/features/applications/MyApplicationsPage.tsx` each
  take `type: ListingType` (default `'apartment'`) and `panel?: boolean`.
  - **The filter:**
    - `MyListingsPage` shows `listings.filter((l) => l.listing_type === type)`. Its "N מתוך cap" count still
      counts live listings of **both** types, because the cap is shared (Q5).
    - `MyApplicationsPage` shows `applications.filter((a) => a.listing.listing_type === type)`.
    - Neither needs an API change.
  - **With `panel`:** no `PageContainer`, no `usePageTitle` call (the market page owns the title), and
    `PageHeader` renders an `<h2>`: `components/PageHeader.tsx` gains `level?: 1 | 2` (default 1), with a
    `PageHeader.test.tsx` case. The page header's actions move
    with it. The new-listing button links to `/listings/new?type=apartment` (apartments) or `?type=room`
    (`market.mine.newRoom`). The published / saved banner (`isPublished` / `isSaved`, `:24-33`) works in both.
  - **Empty states by type:**
    - apartments keep `listings.mine.empty` + `listings.mine.emptyAction` → `/listings/new?type=apartment`, and
      `applications.mine.empty` + `applications.mine.search` → `/search`;
    - rooms show `market.mine.empty` + `market.mine.emptyAction` → `/listings/new?type=room`, and
      `market.mine.applicationsEmpty` + `market.toSearch` → `/market`.

- `web/src/features/market/MarketMinePage.tsx` (new, `/market/mine`):
  - `<h1>` `market.mine.title` ("שלי").
  - While roles apply, there is one panel and no tablist: an owner gets `<MyListingsPage type="room" panel />`,
    a seeker `<MyApplicationsPage type="room" panel />`.
  - The pill `Tabs` (`components/Tabs.tsx`, `variant="pill"`, `label={t('market.mine.tabs.label')}`) with items
    `listings` / `applications` and the `?tab=applications` deep link are built now, behind
    `const panels = me.role === 'owner' ? ['listings'] : ['applications']`. The tablist renders only when
    `panels.length > 1`. `0010b` sets both panels for every account.
  - An unknown or unavailable `?tab` falls back to the first panel.
- Hard-coded links that would send someone in a room context to a page that no longer shows the room:
  - `features/flatmates/JoinFlatPage.tsx:47-49` (declined, full, invalid) → `/market` +
    `flatmates.join.toSearch`; `:45-46` (`own`, `applied`) → `/market/mine` (`own`; `?tab=applications` for
    `applied` once 0010b shows that panel to everyone, plain `/market/mine` here);
  - `MyApplicationsPage.tsx:210`, by type, as above;
  - always the market (these pages exist only for rooms): `people/PeoplePage.tsx:59`,
    `flatmates/FlatmatesPage.tsx:321` back links → `/market/mine` + `market.mine.back`;
    `likes/MyLikesPage.tsx:210` ("alreadyApplied") → `/market/mine`;
  - by the listing's type (`market.mine.back` → `/market/mine` for a room, today's link for an apartment):
    `applicants/ApplicantsPage.tsx:162`, `listings/EditListingPage.tsx:53`, the wizard's edit back link `to`
    (`ListingWizard.tsx:393`) and its unsaved-changes leave (`:406`);
  - `applications/ApplySection.tsx:304` ("viewMine") → `/market/mine` for a room, `/me/applications` for an
    apartment.
- `web/src/features/landing/LandingPage.tsx`: one entry point to the market under the two hero CTAs, a
  `Button variant="ghost" to="/market"` with `landing.cta.market` (Q7). The hero and the two CTAs are
  unchanged.
- `web/src/locales/he.json`:
  - **New keys:**

    | Key | Hebrew |
    | --- | --- |
    | `side.label` | "בחירת אזור" |
    | `side.apartments` | "דירות" |
    | `side.market` | "שוק השותפים" |
    | `nav.market` | "שוק" |
    | `nav.mine` | "שלי" |
    | `market.title` | "חדרים בדירות שותפים" |
    | `market.availableByHint` | "חדרים שאפשר להיכנס אליהם עד התאריך הזה" |
    | `market.toSearch` | "לשוק השותפים" |
    | `market.mine.title` | "שלי" |
    | `market.mine.back` | "חזרה לשלי" |
    | `market.mine.tabs.label` | "שלי בשוק השותפים" |
    | `market.mine.tabs.listings` | "החדרים שלי" |
    | `market.mine.tabs.applications` | "מועמדויות לחדרים" |
    | `market.mine.newRoom` | "חדר חדש" |
    | `market.mine.empty` | "עוד לא פרסמתם חדר. פרסום חדר לוקח שתי דקות." |
    | `market.mine.emptyAction` | "פרסום חדר" |
    | `market.mine.applicationsEmpty` | "עוד לא הגשתם מועמדות לחדר" |
    | `listing.backToMarket` | "חזרה לשוק השותפים" |
    | `landing.cta.market` | "מחפשים שותפים? לשוק השותפים" |
  - **Rewritten keys:**

    | Key | Hebrew | Why |
    | --- | --- | --- |
    | `search.availableByHint` | "דירות שאפשר להיכנס אליהן עד התאריך הזה" | rooms left |
    | `listings.mine.empty` | "עוד לא פרסמתם דירה. מודעה ראשונה לוקחת שתי דקות." | an owner with only rooms has listings, just none here |
    | `listing.toSearch` | "לחיפוש דירות" | |
    | `applications.mine.search` | "לחיפוש דירות" | |
    | `flatmates.join.toSearch` | "לשוק השותפים" | |
    | `auth.role.owner` | "מפרסמים דירה או חדר" | was "יש לי דירה / חדר": a slash form, brand voice |
    | `auth.role.seeker` | "מחפשים דירה או חדר" | was "אני מחפש/ת"; `0010b` narrows both to apartments |
  - **Deleted keys:** `search.type.*` (`legend`, `apartment`, `room`, `hint`).
  - **Checked and kept:** `app.tagline` ("מוצאים דירה ושותפים בגוש דן" names both sides), `header.search`,
    `search.title`, `listings.type.*` (the type step), the rest of `listings.mine.*`, the rest of `landing.*`.
  - `make i18n-check` passes.

**Out:**
- Role-free market, `is_mine`, signup from the market, `/me/profile` for any account (`0010b`). Until then a
  seeker's market "שלי" shows applications only, and only owners post rooms.
- The market's inner חדרים / אנשים switch and people browse (`0010h`). Photos (`0010d`/`0010e`). Flat profile
  (`0010f`).
- The side map (`0009x`) and other map specs: `SearchPage type` is the only change they must rebase over.
- A per-side chat list. Chat is the same in both bars, and a chat thread records no side, because `ThreadOut`
  carries no listing type, so it keeps the last one.
- PRODUCT.md rows "Search", "Listing edit", "Rooms": the orchestrator rewrites them when the slice's specs lock
  (MARKET-PLAN section 5).

**New dependencies:** none.

## Data
None. No migration. Existing rooms and apartments are untouched. A listing switched before this spec keeps its
type and its rows.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/listings` (changed) | public (`optional_user`), as today | `listing_type` omitted = `apartment`; `room` or `apartment` explicit; map bbox as today | 200 `ListingSearchOut` of that one type | 422 (an invalid `listing_type`, e.g. `house` or empty, as today); 503 |
| PATCH | `/listings/{listing_id}` (changed) | `current_owner`, own listing, as today | `ListingPatch` without `listing_type`; unknown keys forbidden | 200 `ListingOut` | as today, plus 422 `extra_forbidden` at `["body","listing_type"]` (or any unknown key); nothing written |

`GET /listings/{id}`, `POST /listings` and every other endpoint are unchanged. `make client` regenerates
`web/src/api/schema.d.ts`: the search query's `listing_type?:` stays optional (it now has a server default of `apartment`) and
`ListingPatch` loses `listing_type`.

## UI
No artboard has the switch or the market pages (PRODUCT.md: no new artboards). They are designed here from
the kit (`design/brand/`, `specs/0009-brand-amendment.md`) and the existing pages.
- **Header switch** (every route): see Scope. RTL: דירות at the inline start, שוק השותפים after it.
  Keyboard: two links in tab order, focus ring `focusRing`. At 390 px the second-row switch must not cause
  horizontal scroll.
- **`/market`** = `SearchPage type="room"`: the same states as `/search` (loading skeletons, empty mascot,
  error with retry, list / map toggle, load more), title "חדרים בדירות שותפים", no type filter. Room cards are
  today's room `ListingCard` ("חדר" tag, flatmates line, gender line).
- **`/market/mine`**: `<h1>` "שלי", then one panel. An owner sees their rooms with today's cards and actions
  (applicants, "מחפשים חדר", "שותפים בדירה"), the "חדר חדש" button, the shared count line, and the empty state
  "עוד לא פרסמתם חדר…" + "פרסום חדר". A seeker sees their room applications, or the empty state + "לשוק
  השותפים". Loading and error states are the embedded page's own.
- **`/me/listings`, `/me/applications`**: as today, apartments only. The new-listing button and the empty CTA go
  to `?type=apartment`.
- **Wizard** with `?type=`: opens on details, "שלב 1 מתוך 3", and has no back button on the first step (PRODUCT.md
  "no back link in the new-listing wizard"). Edit mode is the same, "שלב 1 מתוך 3", and can never show
  `TypeStep`.
- **Listing page**: back link by type; the bar follows the listing's side.
- **Landing**: the ghost link "מחפשים שותפים? לשוק השותפים" under the CTAs, full width below `lg`.

## Acceptance criteria
- [ ] AC1 Given a live apartment and a live room in an active area, When anyone calls `GET /listings` with no
  `listing_type`, Then only the apartment is returned and `total` is 1. The same holds with a bbox (the map),
  for a visitor and for a seeker with a room-section profile. `?listing_type=room` returns only the room,
  `?listing_type=apartment` only the apartment, and `?listing_type=` / `house` are 422. —
  `api/tests/test_search.py::test_ac1_listing_type_defaults_to_apartment`
- [ ] AC2 Given an owner's room `R`, When they PATCH `R` with `{"listing_type": "apartment"}` or `{"listing_type":
  "room", "price_ils": 5000}`, Then 422 with an error at `["body", "listing_type"]` of type `extra_forbidden`,
  the body is not echoed, and the row (type, price, room fields, `flatmate_invite_hash`) is unchanged. A PATCH
  `{"price_ils": 5000}` still succeeds. This replaces `test_ac4_type_switch_room_fields`. —
  `api/tests/test_listings.py::test_ac2_patch_cannot_switch_type`
- [ ] AC3 Regression (rooms asked for explicitly): each of these passes with its search calls made with
  `listing_type=room` (or a room-only assertion moved to it), and nothing else changed:
  - `test_search.py::test_ac1_only_live_listings_in_active_areas` (the room at `:117` is absent by default and
    listed with `listing_type=room`);
  - `test_room_search.py::test_ac1_rooms_are_public_with_room_fields`;
  - `test_ac2_listing_type_filter` (rewritten: no param = apartments only);
  - `test_ac3_misfit_rooms_hidden_per_seeker`;
  - `test_ac4_fit_filter_pages_counts_and_adds_no_statement` (its statement count unchanged);
  - `test_ac7_room_ages_and_answers_only_to_seekers`;
  - `test_listings.py::test_ac1_room_fields_on_create_and_reads`;
  - `test_lifestyle_match.py::test_ac1_lifestyle_score_and_explanation` (its `_search(seeker)` at `:148` adds
    `listing_type=room` for the room rows).
  
  — the files named
- [ ] AC4 (security, kept without the switch) `test_flatmates.py::test_ac5_apartment_applications_have_no_flatmates`
  is rewritten. The listing still starts as an apartment with a shortlisted application chat. It becomes a room
  by direct SQL (`UPDATE listings SET listing_type = 'room', flatmates_count = 2`), as a listing switched before
  0010a would be, instead of the PATCH at `:652`. `F` joins and still cannot see that conversation. A new room
  application, once shortlisted, is visible to `F`. The "switch back clears the hash" part (`:674`) is deleted
  with the code it tested. The same SQL type flip replaces the PATCH in the three snapshot tests that guard
  listings switched before 0010a, their assertions kept:
  - `test_inbox.py::test_ac4_apartment_applicant_lifestyle_never_scored_for_owner` (`:1140`);
  - `test_inbox.py::test_ac3_apartment_applicants_stay_hidden_after_switch_to_room` (`:1304`);
  - `test_inbox.py::test_ac4_room_applicants_keep_room_after_switch_to_apartment` (`:1347`).

  `test_listings.py::test_ac5_legacy_room_fills_count_on_next_edit` loses only its switch leg (`:922`). —
  `api/tests/test_flatmates.py::test_ac5_apartment_applications_have_no_flatmates`, the three `test_inbox.py`
  functions, `test_listings.py::test_ac5_legacy_room_fills_count_on_next_edit`
- [ ] AC5 `sideOf` maps every path in Scope to its side or `null` (a table test over all three lists, plus
  `/market?view=map`, `/me/listings/abc` (→ null), `/listings/new` (→ null)). `useSide()` returns the stored side
  on a shared path and `'apartments'` when storage is empty or throws. `setSide` re-renders a subscriber. —
  `web/src/app/__tests__/side.test.ts::ac5_side_of_paths_and_store`
- [ ] AC6 The switch:
  - renders for a visitor, an owner and a seeker, as a `nav` named `side.label` with two links;
  - דירות → `/me/listings` for an owner and `/search` otherwise, שוק השותפים → `/market`;
  - the active side has `aria-current`;
  - on `/listings/:id` of a room the market side is active once the listing loads;
  - below `md` it is in its own row (`data-side-switch-row`).
  
  — `web/src/app/__tests__/SideSwitch.test.tsx::ac6_switch_links_and_current`
- [ ] AC7 The bottom bar per side and role is exactly the MARKET-PLAN table (labels and hrefs, in order) for owner
  and seeker on `/search` and on `/market`. On `/chat` it follows the last side. The anonymous nav has "כניסה"
  and no "חיפוש דירות" link. The existing tab tables in `ac6_anonymous_header` and `ac7_signed_in_nav` are
  updated to these values. — `web/src/app/__tests__/Layout.test.tsx::ac7_signed_in_nav`,
  `::ac6_anonymous_header`, `::ac7_bar_per_side`
- [ ] AC8 `/search` sends `listing_type=apartment` on the list and map requests and shows no type fieldset or type
  tag. `/market` sends `listing_type=room`, titles the page "חדרים בדירות שותפים" and uses
  `market.availableByHint`. A cached `/search` result is not shown on `/market` (different keys).
  `/search?listing_type=room&price_max=5000&view=map` lands on `/market?price_max=5000&view=map` (replace).
  `/search?listing_type=apartment` stays on `/search` with the param dropped from requests. —
  `web/src/features/search/__tests__/SearchPage.test.tsx::ac8_type_per_side_and_redirect`
- [ ] AC9 Web test moves:
  - `SearchPage.test.tsx::ac2_type_filter` is deleted;
  - `::ac2_active_filter_tags` loses its type row (`:978`);
  - `::ac5_similar_age_chip` and `::ac6_room_with_match_chips` render `<SearchPage type="room" />` at `/market`;
  - `SearchPage.test.tsx`'s harness route (`:70`) renders `<SearchPage type="apartment" />` at `/search`
    and adds `<SearchPage type="room" />` at `/market`; every `/search` query assertion built with
    `fixtures.ts::expected({...})` adds `listing_type: 'apartment'` explicitly (the helper stays a plain sort);
  - `SearchMap.test.tsx`: the harness (`:64`) gets the same two routes; `ac3_map_sends_type` (`:385`) renders
    `/market?view=map` and expects `listing_type=room`; every other map query expects
    `listing_type=apartment`;
  - `filters.test.ts` drops the `listing_type` parse and round-trip cases and asserts `parseFilters('listing_type=room')`
    has no `listing_type`;
  - `features/search/__tests__/routes.test.tsx:21-23,45` expect the switch in place of the anonymous "חיפוש
    דירות" link.
  
  — the files named
- [ ] AC10 Wizard:
  - `/listings/new?type=room` opens on the room details step, shows "שלב 1 מתוך 3", has no back button there,
    posts `listing_type: 'room'` and lands on `/market/mine` with the published banner;
  - `?type=apartment` lands on `/me/listings`;
  - `?type=house` and no param show `TypeStep` ("שלב 1 מתוך 4");
  - in edit mode the back button is absent on details and `TypeStep` is unreachable;
  - `changedFields` never returns `listing_type`.
  
  `EditListingPage.test.tsx:680-841` (the type-switch cases via `toPreferencesAs`) are rewritten: an edited room
  stays a room, an edited apartment stays an apartment, and no PATCH holds `listing_type`. —
  `web/src/features/listings/__tests__/ListingWizard.test.tsx::ac10_type_param_skips_type_step`,
  `EditListingPage.test.tsx::ac10_edit_never_switches_type`, `validate.test.ts::ac10_changed_fields_never_type`
- [ ] AC11 "My" pages:
  - an owner with one apartment and one room sees only the apartment on `/me/listings` (count line "2 מתוך 3",
    both are live) and only the room on `/market/mine`, with "חדר חדש" → `/listings/new?type=room`;
  - a seeker with one apartment and one room application sees one on each;
  - `/market/mine` shows no tablist for either role, and `?tab=applications` for an owner falls back to their
    rooms;
  - each empty state shows its own copy and CTA.
  
  These existing cases render room fixtures and move to `type="room"` (or `/market/mine`):
  `MyListingsPage.test.tsx::ac1_owner_block`, `::ac3_badges_one_two_many`, `::ac5_flatmates_link`,
  `::ac7_people_link`; `MyApplicationsPage.test.tsx::ac4_room_title`. `EditListingPage.test.tsx::ac3_prefilled_from_listing`
  loses its "step 1 is reachable" block (`:269-272`). `AuthMenu.test.tsx::ac3_likes_badge_forms` and
  `::ac6_likes_link` render at `/market` (the likes tab is market-only).
  — `web/src/features/market/__tests__/MarketMinePage.test.tsx::ac11_mine_split_by_type`,
  `MyListingsPage.test.tsx::ac11_apartments_only`, `MyApplicationsPage.test.tsx::ac11_apartments_only`
- [ ] AC12 Listing page:
  - a room's back link is "חזרה לשוק השותפים" → `/market`, an apartment's "חזרה לחיפוש" → `/search`;
  - a 404 after the stored side was `market` offers "לשוק השותפים" → `/market`;
  - `JoinFlatPage`'s declined, full and invalid outcomes link to `/market`.
  
  — `ListingPage.test.tsx::ac12_back_link_by_type`, `JoinFlatPage.test.tsx::ac12_outcomes_to_market`
- [ ] AC13 The landing page shows the market link → `/market` under the two CTAs; the CTAs are unchanged. —
  `web/src/features/landing/__tests__/LandingPage.test.tsx::ac13_market_entry_point`
- [ ] AC14 (e2e, CI only) A visitor on `/search` sees the apartment and not the room. Through the switch they
  reach `/market` and see the room and not the apartment. They open the room, and its back link returns to
  `/market`. `/search?listing_type=room` lands on `/market`. An owner signs up, opens "שוק השותפים" → "שלי" →
  "חדר חדש", posts a room through the 3-step wizard, and lands on `/market/mine` with the room. axe passes on
  `/market` and `/market/mine` at 390 and 1280 px. — `web/e2e/market.spec.ts::ac14_two_sides`
- [ ] AC15 (e2e moves, CI only)
  - `search.spec.ts` ac12 (`:131-170`): the room is looked for on `/market` with no type filter; the "Rooms only"
    uncheck block and its `?listing_type=room` URL assertion are deleted; and the visitor's `/search` asserts the
    room card is absent.
  - `applications.spec.ts:263` `page.goto('/search?listing_type=room')` → `page.goto('/market')`.
  - `likes.spec.ts`:
    - the 390 px tab-bar check runs after `page.goto('/market')` and still expects 5 tabs (the seeker's
      market bar);
    - `:126` `page.goto('/search')` → `page.goto('/market')` for the לייקים link;
    - `:168` `page.goto('/me/applications')` → `page.goto('/market/mine')` (the mutual-match room
      application; a seeker's only panel there in 0010a).
  - `flatmates.spec.ts:54` and `people.spec.ts:41` `page.goto('/me/listings')` → `page.goto('/market/mine')`
    (the room's flatmates / people links live there).
  - `listings.spec.ts` (wizard at `/listings/new` with no param) is unchanged.
  - `helpers.ts::signUp`'s default `expectUrl` is unchanged (Q6: homes do not move).
  
  — the files named

## Tests to write
Integration (api): AC1–AC4 (one new, the rest amended). Unit (web): AC5–AC13 (`side.test.ts`, `SideSwitch.test.tsx`,
`MarketMinePage.test.tsx` new; the rest amended). E2E: `web/e2e/market.spec.ts` (new, AC14) and the AC15 moves.
**e2e runs only in CI** (no local `make e2e`): the spec session runs `make lint`, `make test` and
`make i18n-check` locally and relies on the PR's CI `e2e` job.

## Risks / open questions
- **Every client's search changes meaning.** An old cached PWA bundle that leaves `listing_type` out loses
  rooms from its mixed list. Accepted: there are no real users yet, and the market is the new home of rooms.
- **`extra="forbid"` on `ListingPatch`** turns any unknown key into a 422, not only `listing_type`. A grep of
  `web/src` and `web/e2e` shows only known keys sent. If a review finds a caller that sends extras, the fallback
  is a `model_validator(mode="before")` that rejects `listing_type` alone. That is a spec-session call, not a
  product one.
- **Header width at 390 px**: lockup + switch + logout do not fit one row, hence the second row below `md`. The ux
  reviewer checks the second row against the bottom bar's own height (`--bottom-nav-h`) for vertical space on
  small phones.
- **Side for shared pages** is the last side stored. A person who opens `/chat` straight from a notification
  link on a fresh device sees the apartments bar. Accepted.
- **The `/me/listings` count line** counts both types' live listings (the shared cap), while the list shows one
  type. The line says "N מתוך 3 מודעות פעילות", which is still true. The web's `LISTING_CAP = 3` constant
  (FOLLOWUPS:32) is not touched here; the live cap is `users.listing_cap`.
- **Map specs in flight (`0009v`–`0009y`)** edit `SearchPage.tsx` / `SearchMap.tsx`. Whichever merges second
  rebases. The only contract here is the `type` prop and `listing_type` inside `filters`.
- MARKET-PLAN section 7 says chat records a side through `setSide`. `ThreadOut` has no listing type, so this
  spec records none in chat (see Out). The orchestrator may overrule this by adding `listing_type` to the
  thread in `0010g`.
- **Size.** About 25 source files and ~35 test files, most of them one-line moves. Cut line if the run overflows:
  only the wizard `?type=` and the landing link (AC10, AC13, and AC14's wizard leg, posting via the API
  instead) move to `0010a2`. `MarketMinePage`, the "my" filtering and the link moves stay here, because the
  bars link to `/market/mine`.
- `e2e/screens/*.screens.ts` are not in the CI e2e run; their room fixtures on `/me/listings` and
  `/me/applications` will render differently and are refreshed when those screen sets are next used.
- Spec-verifier round 1: 13 findings applied (2 blockers, 6 majors, 4 minors, 1 process).

## Digest (filled by orchestrator after verification)
See `/digest`.
