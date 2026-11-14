---
id: 0002b
title: An owner creates a listing from the web app in a short wizard (type → details → preview → publish) and sees, pauses and resumes their listings on a "my listings" page
status: done
depends_on: [0001b, 0002a]
reviewers: [code, qa, ux]   # ux: two new screens + header link; no security: no uploads, no new credentials, data is the listing's public facts
estimate: 1 coder run
---

## Goal
After this ships, a logged-in owner opens http://localhost:5173/listings/new, picks apartment or room, fills
the facts from `CreateListing.dc.html`, reviews a preview card and publishes; `/me/listings` lists their
listings with a live / paused / expired badge and a pause-or-resume button; the header shows a
"המודעות שלי" link for owners. Serves Dev Plan slice 2 (Owner posts listing), part b of two, on top of
`0002a` (API) and `0001b` (router, `useMe`, header `AuthMenu`). Seekers and logged-out visitors are sent
away from both routes (the first protected routes, as `0001b` Out foresaw).

## Scope
**In:**
- Routes in `web/src/app/routes.tsx` (from `0001b`): `/listings/new` → `NewListingPage`, `/me/listings` →
  `MyListingsPage`, both wrapped in `RequireOwner`. The catch-all and `Layout` are unchanged.
- `web/src/features/auth/RequireOwner.tsx`: reads `useMe`; pending → one `Skeleton`; error (network failure,
  `data` undefined) → `ErrorState` with `onRetry={() => refetch()}` and **no** redirect; `null` → `<Navigate
  to="/login" replace />`; `role !== 'owner'` → `<Navigate to="/" replace />`; owner → `<Outlet />`.
- `AuthMenu` (from `0001b`): when the user is an owner, a link `header.myListings` → `/me/listings` sits
  before the greeting. One added line; the `0001b` tests stay green (they use `role: "seeker"` or do not
  assert on the link).
- `web/src/features/listings/`: `api.ts` (`createListing`, `fetchMyListings`, `patchListing` over the
  `openapi-fetch` client; typed from `schema.d.ts` after `make client`), `useMyListings.ts` (TanStack Query
  `['me','listings']`), `useCreateListing.ts` and `usePatchListing.ts` (mutations; on success set/patch the
  `['me','listings']` cache), `ListingWizard.tsx` (3 steps, state in `useState`), `TypeStep.tsx`,
  `DetailsStep.tsx`, `PreviewStep.tsx`, `ListingCard.tsx` (the preview and the "my listings" row),
  `StatusBadge.tsx`, `NewListingPage.tsx`, `MyListingsPage.tsx`, `validate.ts` (pure field rules, mirrors
  `0002a` Data; trims and counts code points like `0001b`'s name rule; unit-tested), `format.ts` (`formatIls`,
  `formatDate` via `Intl` with `he-IL`, `formatRooms`: `3.5` → `3.5`, integers plain). `LISTING_CAP = 3` constant
  in `features/listings/constants.ts` (PRODUCT.md cap; replaced by `GET /me` `listing_cap` in a later slice).
- `web/tailwind.config.ts`: tokens `warn: '#FEF3C7'`, `warn-text: '#92400E'` from `design/README.md`.
- `web/e2e/helpers.ts`: the outbox code reader from `0001b` AC7, lifted out of `auth.spec.ts` if it is inline
  there (one-file change; `0001b`'s test keeps passing).
- `web/src/components/ChoiceGroup.tsx`: `<fieldset>` + `<legend>` + native radios styled as the artboard's
  segmented buttons — the same anatomy as `0001b`'s `RoleChoice`, generalised (`options: {value, label}[]`).
  `RoleChoice` is **not** touched in this slice (duplication noted in FOLLOWUPS by the coder; `0001b` may
  still be in review when this builds).
- `web/src/components/Switch.tsx`: `<input type="checkbox" role="switch">` with a visible `<label>`,
  styled as the artboard's toggle (52×32, accent when on). Native: keyboard and `aria-checked` come free.
- `he.json` keys in UI below. Tests in `web/src/features/listings/__tests__/`, e2e `web/e2e/listings.spec.ts`.
- No Makefile/CI change: `make client`, `make test-web`, `make e2e` already cover the new files.

**Out:**
- Photos step (`0002c`), owner-preferences step (Slice 6/7), drafts and "שמירה כטיוטה" (no drafts in `0002a`),
  editing a published listing's fields (next listings spec; the API already supports it), deleting, the
  public listing page and search (Slice 3), map / geocoding (Slice 3), price hints ("הממוצע לדירות 4
  חדרים…", needs data), persisting wizard state across reloads (component state only), desktop layout
  beyond the centred column, the bottom tab bar on `Search.dc.html` (Slice 3/9).

**New dependencies:** none. `react-router` 7.x (library mode) arrives with `0001b`; dates and currency use `Intl`.

## Data
None. Consumes `0002a`.

## API
No new endpoints. Consumes from `0002a` (all with credentials): `POST /listings` (201 / 401 / 403 / 409
`listing_cap_reached` / 422 `unknown_area` or validation), `GET /me/listings` (200 / 401 / 403),
`PATCH /listings/{id}` (200 / 404 / 409 / 422), and `GET /areas` from `0000a` for the area select.

## UI
Tokens from `Main.dc.html`; form anatomy, stepper, chips and toggles from `CreateListing.dc.html`; the
preview card's title block and facts grid from `Listing.dc.html`. Single column `max-w-[480px]` centred,
`px-4`; logical properties only; `<form noValidate>`; every validation message from `he.json`.

**Header**: owner → link `header.myListings` (≥ 44 px tap target) before `header.greeting`. Seeker/logged
out: unchanged from `0001b`.

**`RequireOwner`** (both routes): loading → `Skeleton`; error → `ErrorState` + retry, no redirect; logged out →
`/login`; seeker → `/`. No message (nothing links a seeker here yet).

**`/listings/new` (`NewListingPage` → `ListingWizard`)**. `<h1>` = `listings.new.title`. Top: a stepper of
three labels `listings.steps.type` / `listings.steps.details` / `listings.steps.preview` (`<ol>`, current
step `aria-current="step"`, done steps with the check icon), and a progress bar (`role="progressbar"`,
`aria-valuenow` 1–3, `aria-valuemax` 3, `aria-labelledby` = the `<h1>`'s id). Bottom bar: secondary `common.back` (hidden on step 1) and primary
`listings.next` (step 3: `listings.publish`), both ≥ 52 px tall, full-width pair as on the artboard.
- Step 1 (`TypeStep`): `ChoiceGroup` legend `listings.type.label`, options `listings.type.apartment` /
  `listings.type.room`; `listings.next` disabled until chosen. empty/loading/error: none (no fetch).
- Step 2 (`DetailsStep`): in artboard order —
  `listings.fields.area` (`<select>` from `GET /areas`; loading → disabled select with `common.loading`
  as its only option; error → `ErrorState` with retry in place of the field; `[]` → `EmptyState` `areas.empty`
  in place of the select and validation reports `listings.errors.required` on the area; exactly one area →
  preselected; ≥ 2 → placeholder option `listings.fields.choose` selected), `listings.fields.city` (text, max 40), `listings.fields.street` (text, max 80, hint
  `listings.fields.streetHint`), `listings.fields.rooms` (`<select>`: placeholder `listings.fields.choose`, then 1 … 10 in steps of 0.5,
  labels via `formatRooms`), `listings.fields.floor` + inline `listings.fields.of` +
  `listings.fields.totalFloors` (two `type="number"` inputs in one row as on the artboard; `aria-label` for
  the second is a `t()` value, which `i18n-check` allows), `listings.fields.size` with suffix
  `listings.units.sqm`, `listings.fields.price` with suffix `listings.units.ils` (`type="text"
  inputMode="numeric"`, digits only, thousands separator shown via `formatIls` on blur), `listings.fields.availableFrom`
  (`type="date"`, `min` = today), `Switch` `listings.fields.entryFlexible`, `Switch` `listings.fields.elevator` (every `Switch` defaults to off),
  `listings.fields.parking` (`<select>` 0–5, default `0`), `ChoiceGroup` `listings.fields.furnished` with
  `listings.furnished.none/partial/full` (default `none`), `Switch` `listings.fields.pets`, optional `listings.fields.arnona`
  and `listings.fields.vaad` (number, hint `listings.fields.optional`), `listings.fields.description`
  (`<textarea>`, counter `listings.fields.charsLeft` `{{count}}`, max 2000).
  Validation on `listings.next` (not on every keystroke). After the first attempt a new error appears on blur, and an error already shown updates or clears as soon as its field changes (so a fixed field's message does not shift the layout under the next click): `validate.ts`
  returns per-field keys — `listings.errors.required`, `listings.errors.range` (`{{min}}`, `{{max}}`),
  `listings.errors.floors`, `listings.errors.tooLong` (`{{max}}`), `listings.errors.dateRange`; each shown
  under its field with `role="alert"` and `aria-describedby` on the input; focus moves to the first invalid
  field. Ranges are the `0002a` Data ranges; text lengths are counted in code points after `trim()` (as
  `0001b`'s name rule), so `" "` is empty and an emoji is one character. The date upper bound on the client is
  `today + 729` days: the client's today is Israel time and the API's is UTC, so `+730` could pass here and be
  a 422 there near midnight.
- Step 3 (`PreviewStep`): `listings.preview.hint`, then `ListingCard` with the entered values exactly as
  `/me/listings` will render it (price `formatIls` + `listings.units.perMonth`, title
  `listings.card.title` `{{rooms}}`, `{{street}}`, `{{city}}`, facts row `listings.card.floorOf`
  `{{floor}}`, `{{total}}` or `listings.card.floor` when no total, size, `listings.card.availableFrom`
  `{{date}}` or `listings.card.immediate` when the date ≤ today, then the chip row, in this order and with these
  rules: `listings.card.room` first when `listing_type === 'room'`; `listings.card.elevator` or
  `listings.card.noElevator`; parking per the parking rule below the key table; `listings.furnished.{value}`
  (the same key the form uses); `listings.card.pets` only when `pets_allowed`). Submit = `listings.publish`: disabled + `aria-busy` while pending.
  error (`role="alert"` above the button): 409 → `listings.errors.capReached`; 422 `unknown_area` →
  `listings.errors.areaInactive` with `common.back` to step 2; 422 list detail → `common.error`
  (client validation should have caught it; the coder logs nothing); 401 → `<Navigate to="/login" />`;
  403 → `/`; network / 5xx → `common.error` + `common.retry` (retry re-submits). success: `setQueryData(['me','listings'], old => old ? [created, ...old] : old)`, then
  `invalidateQueries(['me','listings'])` (fresh data on the next render either way), `navigate('/me/listings')`.
- `common.back` keeps all entered values (state lives in `ListingWizard`).

**`/me/listings` (`MyListingsPage`)**. `<h1>` = `listings.mine.title`; primary link `listings.mine.new`
→ `/listings/new` (≥ 44 px, top end of the heading row).
- loading: three `Skeleton` rows in a `<ul aria-busy aria-label={common.loading}>` (as `AreasList`).
- error: `ErrorState` with retry.
- empty: `EmptyState` `listings.mine.empty` (the `listings.mine.new` link stays visible).
- success: `<ul>` of `ListingCard`s newest first (API order), each with `StatusBadge` — `listings.status.live`
  (accent tint), `listings.status.paused` (line grey), `listings.status.expired` (amber `#FEF3C7` / `#92400E`
  from `design/README.md`; add `warn`/`warn-text` to `tailwind.config.ts` tokens) computed as
  `status === 'active' && new Date(expires_at) > now` / `status === 'paused'` / otherwise — and a button
  `listings.actions.pause` on a live listing or `listings.actions.resume` on a paused one (none on an
  expired one; renewal is Slice 10). The button is disabled with `aria-busy` while its PATCH is pending;
  on success the row re-renders from the response; on 409 the row shows `listings.errors.capReached`
  (`role="alert"`) and stays paused; on any other failure `common.error` on that row and the state is
  unchanged. Counter line under the heading: `listings.mine.count` `{{live}}`, `{{cap}}` — `cap` is `LISTING_CAP`
  (also interpolated into `listings.errors.capReached`) until `GET /me` exposes `listing_cap` (FOLLOWUPS).

**RTL**: inherited `dir="rtl"`; every input keeps the inherited direction with `text-start` (digits read
fine in RTL fields; the `0001b` `dir="ltr"` rule is for email and code inputs only). The stepper's first
step sits at the inline start; the bottom bar's primary button is at the inline end (artboard).

**i18n keys added to `he.json`** (placeholder copy; Slice 9 owns final wording):

| key | value |
| --- | --- |
| `header.myListings` | `המודעות שלי` |
| `common.back` | `חזרה` |
| `listings.new.title` | `מודעה חדשה` |
| `listings.steps.type` | `סוג` |
| `listings.steps.details` | `פרטים` |
| `listings.steps.preview` | `תצוגה מקדימה` |
| `listings.next` | `הבא` |
| `listings.publish` | `פרסום המודעה` |
| `listings.type.label` | `מה מפרסמים?` |
| `listings.type.apartment` | `דירה שלמה` |
| `listings.type.room` | `חדר בדירת שותפים` |
| `listings.fields.area` | `אזור` |
| `listings.fields.city` | `עיר` |
| `listings.fields.street` | `רחוב` |
| `listings.fields.streetHint` | `בלי מספר בית — הכתובת המדויקת נשלחת רק למי שתאשרו` |
| `listings.fields.rooms` | `מספר חדרים` |
| `listings.fields.floor` | `קומה` |
| `listings.fields.of` | `מתוך` |
| `listings.fields.totalFloors` | `סך הקומות בבניין` |
| `listings.fields.size` | `שטח` |
| `listings.fields.price` | `שכר דירה חודשי` |
| `listings.fields.availableFrom` | `תאריך כניסה` |
| `listings.fields.entryFlexible` | `גמיש ±2 שבועות` |
| `listings.fields.elevator` | `מעלית` |
| `listings.fields.parking` | `חניה` |
| `listings.fields.furnished` | `ריהוט` |
| `listings.fields.pets` | `חיות מחמד מותרות` |
| `listings.fields.arnona` | `ארנונה (לחודשיים)` |
| `listings.fields.vaad` | `ועד בית (לחודש)` |
| `listings.fields.optional` | `לא חובה` |
| `listings.fields.choose` | `בחירה…` |
| `listings.fields.description` | `על הדירה` |
| `listings.fields.charsLeft` | `נשארו {{count}} תווים` |
| `listings.units.sqm` | `מ״ר` |
| `listings.units.ils` | `₪` |
| `listings.units.perMonth` | `/ חודש` |
| `listings.furnished.none` | `לא מרוהטת` |
| `listings.furnished.partial` | `מרוהטת חלקית` |
| `listings.furnished.full` | `מרוהטת` |
| `listings.errors.required` | `שדה חובה` |
| `listings.errors.range` | `הערך צריך להיות בין {{min}} ל-{{max}}` |
| `listings.errors.floors` | `מספר הקומות בבניין לא יכול להיות קטן מהקומה` |
| `listings.errors.tooLong` | `עד {{max}} תווים` |
| `listings.errors.dateRange` | `התאריך צריך להיות בשנתיים הקרובות` |
| `listings.errors.capReached` | `הגעתם למכסה של {{cap}} מודעות פעילות. אפשר להשהות מודעה כדי לפרסם חדשה` |
| `listings.errors.areaInactive` | `האזור שנבחר לא פעיל כרגע` |
| `listings.preview.hint` | `ככה המודעה תיראה למחפשים. אפשר לחזור ולתקן.` |
| `listings.card.title` | `{{rooms}} חדרים, רחוב {{street}}, {{city}}` |
| `listings.card.floorOf` | `קומה {{floor}} מתוך {{total}}` |
| `listings.card.floor` | `קומה {{floor}}` |
| `listings.card.availableFrom` | `כניסה {{date}}` |
| `listings.card.immediate` | `כניסה מיידית` |
| `listings.card.elevator` | `מעלית` |
| `listings.card.noElevator` | `ללא מעלית` |
| `listings.card.parkingOne` | `חניה` |
| `listings.card.parkingMany` | `{{count}} חניות` |
| `listings.card.pets` | `חיות מחמד` |
| `listings.card.room` | `חדר בדירת שותפים` |
| `listings.mine.title` | `המודעות שלי` |
| `listings.mine.new` | `מודעה חדשה` |
| `listings.mine.empty` | `עוד אין לכם מודעות. המודעה הראשונה לוקחת שתי דקות.` |
| `listings.mine.count` | `{{live}} מתוך {{cap}} מודעות פעילות` |
| `listings.status.live` | `פעילה` |
| `listings.status.paused` | `מושהית` |
| `listings.status.expired` | `פג תוקף` |
| `listings.actions.pause` | `השהיה` |
| `listings.actions.resume` | `הפעלה מחדש` |

Parking chip: `0` hides it, `1` → `listings.card.parkingOne`, `2`–`5` → `listings.card.parkingMany` (no i18next plural suffixes).

## Acceptance criteria
- [ ] AC1 Given `/me` resolves to an owner, When `/listings/new` and `/me/listings` are opened, Then each renders its `<h1>`; Given `/me` is 401, Then both redirect to `/login`; Given a seeker, Then both redirect to `/`; Given `/me` pending, Then a skeleton and no redirect; Given `/me` fails with a network error, Then `ErrorState` with `common.retry` and no redirect — `web/src/features/listings/__tests__/RequireOwner.test.tsx::ac1_owner_only_routes`
- [ ] AC2 Given the wizard at step 1, Then `listings.next` is disabled until a type is chosen; When apartment is chosen and next clicked, Then step 2 shows with `aria-current="step"` on `listings.steps.details` and `aria-valuenow="2"`; When `common.back` is clicked, Then step 1 shows apartment still selected — `web/src/features/listings/__tests__/ListingWizard.test.tsx::ac2_type_step_and_back_keeps_state`
- [ ] AC3 Given step 2 with `GET /areas` returning one area, Then it is preselected; Given it returns `[]`, Then `areas.empty` shows in place of the select and next reports `listings.errors.required` on the area; When next is clicked with everything empty, Then `listings.errors.required` appears under city, street, rooms, floor, size, price and available-from (each `role="alert"`, each input `aria-invalid="true"` and `aria-describedby` pointing at its message), focus is on the city input and no request is made; When `floor: 3, totalFloors: 2`, Then `listings.errors.floors`; When `price: 100`, Then `listings.errors.range` with 500 and 100000; When a 41-char city, Then `listings.errors.tooLong` with 40 — `web/src/features/listings/__tests__/DetailsStep.test.tsx::ac3_client_validation`
- [ ] AC4 Given a fully valid step 2 (rooms 3.5, floor 3 of 5, 95 sqm, 7200, a date 30 days ahead, elevator on, parking 1, partial, pets on, description), When next, Then the preview shows `listings.card.title` with `3.5`, the street and city, `7,200 ₪`, `listings.card.floorOf` 3 / 5, and exactly the chips `מעלית`, `חניה`, `מרוהטת חלקית`, `חיות מחמד` in that order; When `listings.publish` is clicked, Then `POST /listings` receives `{listing_type:"apartment", rooms:3.5, floor:3, total_floors:5, size_sqm:95, price_ils:7200, available_from:"YYYY-MM-DD", entry_flexible:false, elevator:true, parking_spots:1, furnished:"partial", pets_allowed:true, arnona_ils:null, vaad_ils:null, description:"…", city, street, area_id}` with `credentials: 'include'`, the button is disabled with `aria-busy` while pending, and on 201 (with the `['me','listings']` cache seeded with one older listing) the app navigates to `/me/listings` where the new card is listed first and no skeleton is shown — `web/src/features/listings/__tests__/ListingWizard.test.tsx::ac4_preview_then_publish_navigates`
- [ ] AC5 Given publish answers 409, Then `listings.errors.capReached` in a `role="alert"` and the wizard stays on step 3; Given a network error, Then `common.error` + `common.retry` and retry re-POSTs; Given 422 `{"detail":"unknown_area"}`, Then `listings.errors.areaInactive`; Given 422 with a list `detail`, Then `common.error`; Given 401, Then redirect to `/login`; Given 403, Then redirect to `/` — `web/src/features/listings/__tests__/ListingWizard.test.tsx::ac5_publish_errors`
- [ ] AC6 Given `GET /me/listings` pending, Then three skeletons with `aria-busy`; Given it fails, Then `ErrorState` and retry refetches; Given `[]`, Then `listings.mine.empty` and the `listings.mine.new` link; Given three listings (one live, one paused, one whose `expires_at` is past), Then three cards in API order with badges `listings.status.live`, `listings.status.paused`, `listings.status.expired`, pause button only on the live one, resume only on the paused one, and `listings.mine.count` with `1` and `3` — `web/src/features/listings/__tests__/MyListingsPage.test.tsx::ac6_states_and_badges`
- [ ] AC7 Given a live listing, When `listings.actions.pause` is clicked, Then `PATCH /listings/{id}` receives `{"status":"paused"}`, the button is disabled with `aria-busy`, and on 200 the badge reads `listings.status.paused` and the button `listings.actions.resume`; When resume answers 409, Then `listings.errors.capReached` on that row and the badge stays paused; When pause answers 500, Then `common.error` on that row and the badge stays live — `web/src/features/listings/__tests__/MyListingsPage.test.tsx::ac7_pause_resume`
- [ ] AC8 `validate.ts` unit table: every `0002a` Data range at its boundaries (rooms 0.5 / 1 / 20 / 20.5 / 2.3, price 499 / 500 / 100000 / 100001, size 4 / 5 / 1000 / 1001, floor −3 / −2 / 100 / 101, parking 6, arnona 20001, vaad 5001, description 2000 / 2001 code points (an emoji counts once), city `" "` (required) and `" גבעתיים "` (ok, trimmed), date today−1 (ok: immediate) / today+729 (ok) / today+730 (error)) — `web/src/features/listings/__tests__/validate.test.ts::ac8_field_rules`
- [ ] AC9 Given `make dev` is up, When Playwright signs up an owner through the outbox (as `0001b` AC7), opens `/listings/new`, picks apartment, fills the details with the AC4 values, publishes, Then the URL is `/me/listings`, one card shows the street and `7,200 ₪` with `listings.status.live`; clicking `listings.actions.pause` shows `listings.status.paused`; the header shows `header.myListings` — `web/e2e/listings.spec.ts::ac9_owner_creates_and_pauses_listing`
- [ ] NF1 `make i18n-check`, `eslint`, `prettier --check`, `tsc --noEmit` clean — CI `web` job
- [ ] NF2 Every input has a visible `<label>` bound by `htmlFor` (or `<legend>` + per-radio labels; the second floor input has an `aria-label` from `he.json`); errors `role="alert"` + `aria-describedby`; the stepper is an `<ol>` with `aria-current`; the progress bar has `role="progressbar"`; switches are native checkboxes with `role="switch"` — enforced by the label/role queries in AC2–AC7 and the ux reviewer in a browser (keyboard through the whole wizard, RTL order of the stepper and bottom bar)
- [ ] NF3 Wizard state is component state only (no `localStorage`/`sessionStorage`/URL), no `console.*` under `features/listings/` — checked by the code reviewer

## Tests to write
Unit (vitest, testing-library `fireEvent`, mocked `fetch` sequences, `MemoryRouter`, `QueryClient` with
`retry: false`): AC1–AC8. Integration: none. E2E: AC9 (`make e2e`), reusing `0001b`'s outbox helper
(lift it into `web/e2e/helpers.ts` if `0001b` left it inline; one-file change, `0001b` tests unaffected).

## Risks / open questions
- Builds on `0001b` (router, `useMe`, `AuthMenu`, `Layout`, `Skeleton`) and `0002a` (schema). Per Speed
  rule 3 the branch starts from `spec/0001b-auth-web` once that PR is open and rebases after it merges;
  `make client` must be run against a stack running the `0002a` API (`spec/0002a-listings-api` merged into
  this worktree's branch, or rebased after its merge). If `0001b` changes `AuthMenu`'s structure in review,
  the one added link line is re-applied on rebase.
- `<input type="date">` renders locale-dependent and has a weak jsdom; AC3/AC4 set its value with
  `fireEvent.change` as `YYYY-MM-DD`, and the ux reviewer checks it in a real browser (Chrome/Safari show a
  native picker; acceptable for MVP, Slice 9 may replace it).
- `formatIls` uses `Intl.NumberFormat('he-IL')`, which yields `7,200` in Node 22 and browsers; the e2e
  asserts on `7,200 ₪` as a regex tolerant to the bidi marks `Intl` may insert (`/7,200\s*₪/`).
- `LISTING_CAP = 3` is a client constant until `GET /me` exposes `listing_cap` (follow-up; Slice 11 admin
  needs it anyway). The client's date bound is one day tighter than the API's because of the Israel/UTC gap.
- No photos means a listing without a picture; the card has a neutral placeholder tile (artboard's
  `#DDD6CE` with the image icon). Accepted until `0002c`.
- Product assumptions are `0002a`'s (listed there); nothing is decided here beyond copy placeholders.

Changes after verifier round 1 (2026-11-10): `RequireOwner` error state; `GET /areas` empty state and the
`listings.fields.choose` placeholder with stated defaults; one chip rule with the furnished key reused and
`card.room` / `card.noElevator` placed; publish success = `setQueryData` then `invalidateQueries`, AC4 reworded
to a seeded cache and no skeleton; AC6 count fixed; `validate.ts` trims and counts code points, client date
bound `today + 729`; `{{cap}}` from `LISTING_CAP`; progress bar labelled by the `<h1>`; AC5 gains the 403 and
list-422 cases; tokens, `e2e/helpers.ts` and `formatRooms` moved into Scope.

Verifier notes (2026-11-10): round 1 rejected with 12 findings, all applied above; one verifier round per spec,
so the orchestrator set `verified`.

## Digest (filled by orchestrator after verification)

    Spec 0002b — Listings web: 3-step wizard + "my listings"   (verified, part 2 of 2, depends on 0001b and 0002a)
    What a user can do after this: an owner opens /listings/new, picks דירה שלמה or חדר, fills the details, reviews the preview card and publishes; /me/listings shows their listings with פעילה / מושהית / פג תוקף badges and a pause/resume button; the header gets "המודעות שלי".
    Decisions I need from you (reply with numbers):
      1. Approve build of 0002b once the 0001b PR is open and 0002a is merged or open (recommend: yes).
      2. Placeholder Hebrew copy for 63 new keys (recommend: accept; Slice 9 owns wording).
      3. Native <input type="date"> and <select> for rooms/parking instead of the artboard's chips (recommend: accept for MVP; Slice 9 polish).
    KPIs this slice moves: listing-creation completion rate (owner funnel).
    Acceptance targets: NF1 i18n-check, eslint, prettier, tsc clean · NF2 every input labelled, errors role=alert + aria-describedby, native switches/radios, stepper <ol> with aria-current · NF3 wizard state in memory only, no console.* in features/listings.
    Risks: builds on two unmerged branches — mitigation: branch from spec/0001b-auth-web, rebase after each merge; one added line in AuthMenu.
           Israel/UTC date gap at midnight — mitigation: client bound today+729 vs API today+730.
    Reviewers: code, qa, ux   Estimated: 1 coder run, 1 review round
    Links: specs/0002b-listings-web.md · PRODUCT.md "Brokers" (cap), "Scope" · design/screens-v1/CreateListing.dc.html (form, stepper), Listing.dc.html (card)

Build digest (spec session, 2026-11-10):

    Spec 0002b — Listings web: 3-step wizard + "my listings"   MERGED b5686be (PR #6, 2026-11-10)
    Shipped: an owner creates a listing in a type → details → preview → publish wizard and pauses/resumes it on /me/listings; seekers and logged-out visitors are redirected; the header shows "המודעות שלי" for owners.
    Demo: 1. make dev, sign up as owner at /signup (code in .outbox/)  2. "המודעות שלי" → "מודעה חדשה", pick דירה שלמה, fill, preview, "פרסום המודעה"  3. on /me/listings click "השהיה" → מושהית, then "הפעלה מחדש" → פעילה
    Tests: +12 unit, +0 integration, +1 e2e (web 31 total; api 123 unchanged)   CI on the final head 270a005: api 55s · web 57s · e2e 3m06s
    Findings: 0 blockers, 2 majors fixed (pasted Hebrew with invisible bidi marks/tabs passed the form and failed at the API with no hint → now stripped silently like trim(), matching the API rule; price re-entry by keyboard appended digits → now selects), 6 minors fixed (double-click published twice, owner header truncation at 390 px, switch tap target, test name, spec wording, FOLLOWUPS), 3 minors + 1 noticed item logged in FOLLOWUPS (Hebrew singular/gender forms, colour tokens, browser Back drops wizard state, listings cache after session expiry), 0 waived
    Changed in PRODUCT.md: nothing (this slice; main's 2026-11-10 0002a batch needs no web change: the count line already counts live listings only)
    Next spec I propose: 0002c — listing photos (needs your decisions: photo count/size limits and the R2 bucket)
