---
id: 0006d
title: A seeker fills or edits a short housing profile at /me/profile, and the listing page sends a seeker without one there (and back) before applying
status: verified
depends_on: [0006a]      # GET/PUT /me/profile and the 409 seeker_profile_required on apply
reviewers: [code, qa, ux]   # ux: a new form screen with no artboard of its own; qa: the apply gate's states. No security: no new trust boundary, safeNext reused (AC6), the profile cache key is under ['me', …] so logout clears it
estimate: 1 coder run
---

## Goal
After this ships, a seeker opens "הפרופיל שלי" from the header (or is sent there from a listing), fills budget,
move-in date (+ flexible), preferred areas, household, pets, smoking, contract length and parking once, and saves;
the form reopens prefilled for edits. On a listing page a seeker with no profile sees, instead of the apply
button, a short line and "מילוי פרופיל" that opens `/me/profile?next=/listings/<id>` and returns there after
saving. Serves Dev Plan slice 6, part d of seven (overview in `0006a`); PRODUCT.md "Matching" (Slice 6 batch): a
seeker must have a profile to apply. `Main.dc.html` step 1 is the copy source: "ממלאים פרופיל קצר — תקציב, תאריך
כניסה, אורח חיים והעדפות דיור — פעם אחת." **Must merge before any deploy after `0006a`** (until it does, applying
from the web silently does nothing for a seeker without a profile).

## Scope
**In:**
- `web/src/features/profile/` (new): `api.ts` (`fetchProfile(): Promise<SeekerProfileOut | null>` — 404
  `seeker_profile_not_found` → `null`, other failures throw `ApiError` as `features/listings/api.ts` does;
  `putProfile(body)`), `useProfile.ts` (`PROFILE_KEY = ['me', 'profile']`; `useProfile(enabled)` copies
  `useMyApplications`: an `enabled` parameter — true only for a seeker — and an effect that runs `clearSession`
  on a 401), `useSaveProfile.ts` (PUT; on 200 `setQueryData(PROFILE_KEY, saved)`; on 401 `clearSession` only, so
  `RequireSeeker` sends the person to `/login`, as `0004b`'s `MyApplicationsPage`), `ProfilePage.tsx`,
  `validate.ts` (`MOVE_IN_MAX_DAYS = 364` — one day less than the API's 365, because the client's today is
  Israel's and the API's is UTC, as the wizard's 729 vs 730), `__tests__/` with `fixtures.ts`
  (`profile(overrides) → SeekerProfileOut`: AC2's values, `area_ids: [gushDan.id]`, an `updated_at`).
- `web/src/components/ChoiceGroup.tsx`: `T extends string | number` (the radio id becomes
  `${id}-${String(option.value)}`), and an optional `error?: string` that renders `<p id=… role="alert">` inside
  the fieldset after the options and gives every radio `aria-invalid="true"` and `aria-describedby` to it.
  `DetailsStep` passes neither and does not change. The profile form keeps the API's own types
  (`ContractMonths | null`, `number`, `Household | null`): no string/number conversion.
- `web/src/app/routes.tsx`: `me/profile` inside the `RequireSeeker` group.
- `web/src/features/auth/AuthMenu.tsx`: for a seeker, a "הפרופיל שלי" link (`header.myProfile`) after "המועמדויות
  שלי", same classes; the logged-in inner `div` gains `flex-wrap` (`0005b` makes the same one-word change; keep
  one copy); owners and visitors unchanged.
- `web/src/features/applications/ApplySection.tsx`: `useProfile(isSeeker)`; the controls follow this order:
  1. `/me` pending, or the seeker's list pending → skeleton;
  2. visitor → as today (the condition also includes `hasStatus(profile.error, 401)`, as it does for the list);
  3. owner → nothing;
  4. list error with no data → `ErrorState`, as today;
  5. an application to this listing whose status is not `withdrawn` → `Applied`, whatever state the profile
     query is in;
  6. profile pending → skeleton;
  7. profile error with no data → `ErrorState` whose retry refetches `GET /me/profile`;
  8. profile `null` → `ProfileGate` (new, same folder): `applications.profileRequired` and a primary link
     `applications.fillProfile` to `/me/profile?next=${encodeURIComponent('/listings/' + id)}`;
  9. otherwise → `ApplyForm`.
- `web/src/features/applications/useApply.ts`: a 409 whose `detail` is `seeker_profile_required` invalidates
  `PROFILE_KEY` (the gate then renders); a 409 `already_applied` keeps today's refetch of the list.
  `ApplySection`'s `onError` keeps ignoring both 409s.
- Existing tests: `ApplySection.test.tsx`'s `renderSeeker` defaults and `ac1`'s seeker viewer add
  `'GET /me/profile': [json(profile())]` (an unmocked route answers 599 and would hit step 7), every assertion
  unchanged.
- `web/src/locales/he.json`: the keys in the UI table.
- `web/e2e/applications.spec.ts` (extended, AC9): its seeker goes through the gate in the UI; `0006a`'s
  `putProfile(page)` call is removed from this file (kept in `inbox.spec.ts`, which applies through the API).

**Out:**
- Match scores anywhere: `0006f`. Owner preferences: `0006e`.
- A post-signup redirect to the profile; a profile completeness meter; deleting a profile.
- Ages, occupation, income (PRODUCT.md "Matching": housing preferences only).
- A return path after a 401 (guard redirects keep no `next`, as `0004b` Out).

**New dependencies:** none.

## Data
None (web only).

## API
Uses `GET /me/profile`, `PUT /me/profile`, `GET /areas` and `POST /listings/{id}/applications` as defined in
`0006a` / `0000a` / `0004a`. `make client` before building (the generated `schema.d.ts` carries
`SeekerProfileIn` / `SeekerProfileOut`).

## UI
No artboard for this screen: it reuses `CreateListing.dc.html`'s form anatomy (labels above fields, the input
classes of `features/listings/DetailsStep.tsx`, `ChoiceGroup`, `Switch`, 52 px primary button), single column,
390 px first, logical properties only.

`/me/profile` (`ProfilePage`) renders the form only once `GET /me/profile` and `GET /areas` (`useQuery({ queryKey:
['areas'], queryFn: fetchAreas })`, the key `AreasList` and `ListingWizard` use) have both succeeded: while either
is pending one skeleton (`common.loading`); if either fails one `ErrorState` whose retry refetches the failed
query or queries. Top to bottom:
1. `<h1>` `profile.title`; intro `profile.intro`; note `profile.privacy` (must stay true with `0006c` AC6:
   owners never see the budget or the areas).
2. `budget_max_ils` — number input `profile.fields.budget`, unit `listings.units.ils`, `inputMode="numeric"`;
   rules as the API (500–100000, digits only) → `listings.errors.range` with `{min: 500, max: 100000}` (as the
   wizard's price); empty → `listings.errors.required`.
3. `move_in_date` — date input `profile.fields.moveIn`, `min = todayInIsrael()`, `max = addDays(today,
   MOVE_IN_MAX_DAYS)` (both from `features/listings/format.ts`); empty → `listings.errors.required`, out of
   range → `profile.errors.moveIn`; `Switch` `profile.fields.flexible`. A stored date that has passed (`0006a`
   allows it) prefills as it is and fails on save with `profile.errors.moveIn` until the seeker changes it.
4. `area_ids` — `<fieldset>` + `<legend>` `profile.fields.areas`, `flex flex-wrap gap-2`, one native `<input
   type="checkbox" name="area_ids" class="peer sr-only">` per area from `GET /areas` (`name_he`) with
   `ChoiceGroup`'s label classes; ≥ 1 → `profile.errors.areas`. The body's `area_ids` is `areas.data.filter((a)
   => checked.has(a.id)).map((a) => a.id)` (in `GET /areas` order) and the ≥ 1 rule counts the same list, so an
   id the list does not hold (a deactivated area in a stored profile) is never shown, counted or sent. No
   active areas → `EmptyState` `areas.empty` replaces the fieldset and there is no save button.
5. `household` — `ChoiceGroup` `profile.fields.household` with `profile.household.{single,couple,family,
   roommates}`, required → `listings.errors.required` (via `ChoiceGroup`'s `error`).
6. `has_pets` — `Switch` `profile.fields.pets`; `smoker` — `Switch` `profile.fields.smoker`. Both default off.
7. `contract_months` — `ChoiceGroup` `profile.fields.contract` with `profile.contract.{6,12,24,36}`, required.
8. `parking_needed` — `ChoiceGroup` `profile.fields.parking` with `profile.parking.{0,1,2}`, default 0.
9. Save button `profile.save`; while pending disabled + `aria-busy`; on 200 a `role="status"` line
   `profile.saved` and, with a `?next=` (through `features/auth/next.ts` `safeNext`; `/` when unsafe or absent
   means stay), `navigate(next)`.

Profile `null` → the empty form (defaults above, nothing preselected for household / contract); a profile → the
form prefilled. Client validation runs on submit: `aria-invalid`, `aria-describedby` to the error, focus the first
invalid field in form order (for a radio group or the areas, its first input via `form.querySelector('input[name=
"<name>"]')`). Server errors: a 422 list maps each item with `loc[0] === 'body'` and `loc[1]` a form field —
whatever the length of `loc` (a bad uuid gives `["body","area_ids",0]`) — to `listings.errors.invalid` on that
field and focuses the first one marked; a list with no such item, or any other failure, → `ErrorState` with retry
of the same body; a 422 `unknown_area` refetches `GET /areas` and shows `profile.errors.areaInactive` on the areas
fieldset. A failed background refetch never overwrites what the seeker has typed (the form keeps its own state
after first render).

Listing page gate (`ProfileGate`, inside the existing apply section): `applications.profileRequired` and the
primary link `applications.fillProfile`, 52 px.

i18n (new keys; reused: `listings.errors.required`, `listings.errors.range`, `listings.errors.invalid`,
`listings.units.ils`, `common.loading`, `areas.empty`):

| key | value |
| --- | --- |
| `header.myProfile` | הפרופיל שלי |
| `profile.title` | הפרופיל שלי |
| `profile.intro` | כמה פרטים, פעם אחת — מהם מחושב ציון ההתאמה לכל דירה, ובעלי הדירות שתגיש/י אליהם מועמדות רואים אותם. |
| `profile.privacy` | התקציב והאזורים שבחרת לא מוצגים לבעלי דירות. |
| `profile.fields.budget` | תקציב חודשי מקסימלי |
| `profile.fields.moveIn` | תאריך כניסה רצוי |
| `profile.fields.flexible` | גמיש/ה ±2 שבועות |
| `profile.fields.areas` | אזורים מועדפים |
| `profile.fields.household` | משק הבית |
| `profile.household.single` / `.couple` / `.family` / `.roommates` | יחיד/ה / זוג / משפחה / שותפים |
| `profile.fields.pets` | יש לי חיית מחמד |
| `profile.fields.smoker` | אני מעשן/ת |
| `profile.fields.contract` | משך חוזה רצוי |
| `profile.contract.6` / `.12` / `.24` / `.36` | חצי שנה / שנה / שנתיים / 3 שנים ומעלה |
| `profile.fields.parking` | חניה |
| `profile.parking.0` / `.1` / `.2` | לא צריך/ה / חניה אחת / 2 חניות |
| `profile.save` | שמירה |
| `profile.saved` | הפרופיל נשמר |
| `profile.errors.moveIn` | התאריך צריך להיות בשנה הקרובה |
| `profile.errors.areas` | צריך לבחור לפחות אזור אחד |
| `profile.errors.areaInactive` | אחד האזורים שבחרת כבר לא פעיל. כדאי לבדוק את הבחירה ולשמור שוב |
| `applications.profileRequired` | כדי להגיש מועמדות צריך פרופיל קצר: תקציב, תאריך כניסה והעדפות. ממלאים פעם אחת. |
| `applications.fillProfile` | מילוי פרופיל |

## Acceptance criteria
Vitest + Testing Library with the existing harness (`features/auth/__tests__/harness.tsx`, `mockApi`) and
`fetch` mocks as `ApplySection.test.tsx`; fixtures in `features/profile/__tests__/fixtures.ts`.
- [ ] AC1 Given a seeker and `GET /me/profile` 404, When `/me/profile` renders, Then the `<h1>` `profile.title`, an empty form with one checkbox per area from `GET /areas`, `parking_needed` 0 selected, no household / contract selected, all three switches off — `web/src/features/profile/__tests__/ProfilePage.test.tsx::ac1_empty_form`
- [ ] AC2 Given that form filled (7500, a date 30 days ahead, flexible on, one area, couple, pets on, 24, parking 1), When "שמירה", Then exactly one `PUT /me/profile` with exactly `{budget_max_ils: 7500, move_in_date, move_in_flexible: true, area_ids: [id], household: "couple", has_pets: true, smoker: false, contract_months: 24, parking_needed: 1}` (numbers as JSON numbers), then `profile.saved` in a `role="status"` — `ProfilePage.test.tsx::ac2_saves_profile`
- [ ] AC3 Given a stored profile with an area id that `GET /areas` no longer lists, When the page renders, Then every field is prefilled, that id is not checked anywhere, and a save sends `area_ids` without it — `ProfilePage.test.tsx::ac3_prefills_and_drops_inactive_area`
- [ ] AC4 Given AC2's valid form with one change per row — budget `""`, `499`, `100001`, `7500.5`; date `""`, yesterday, `today + 365` (the first day the client refuses); no area; no household; no contract — When submitting, Then no request, the row's error (`listings.errors.required` / `listings.errors.range` / `profile.errors.moveIn` / `profile.errors.areas`) on that field with `aria-invalid`, and focus on it; one more row submits the empty form: errors on budget, date, areas, household and contract, focus on the budget input — `ProfilePage.test.tsx::ac4_client_validation` (parametrized); the pure rules — `features/profile/__tests__/validate.test.ts::ac4_rules`
- [ ] AC5 Given `PUT` answering 422 with `detail: [{loc: ["body","budget_max_ils"], …}]`, Then `listings.errors.invalid` on the budget field, focused; with `[{loc: ["body","area_ids",0], …}]`, Then on the areas fieldset; with `detail: "unknown_area"`, Then `GET /areas` is requested again and `profile.errors.areaInactive` shows on the areas fieldset, and when that second answer leaves out the chosen id a second save sends `area_ids` without it (or, with no area left, the client refuses it with `profile.errors.areas`); with 500, Then `ErrorState`, and its retry sends the same body; with 401, Then the location becomes `/login` — `ProfilePage.test.tsx::ac5_server_errors`
- [ ] AC6 Given `/me/profile?next=%2Flistings%2Fabc`, When the save succeeds, Then the app navigates to `/listings/abc`; with `next=%2F%2Fevil.example` or no `next`, Then it stays on `/me/profile` with `profile.saved` — `ProfilePage.test.tsx::ac6_next_is_safe`
- [ ] AC7 Given a seeker with `GET /me/applications` → `[]`: profile 404 → `applications.profileRequired` and a link `applications.fillProfile` with `href` `/me/profile?next=%2Flistings%2F<L>`, no apply button; a profile → the apply button as today; the profile pending → the skeleton; profile 500 → `ErrorState`, whose retry sends a second `GET /me/profile`; profile 401 → `applications.loginPrompt`. Given a `shortlisted` application to L with the profile pending or 404 → the applied state (no skeleton, no gate); a `withdrawn` application with profile 404 → the gate. A visitor and an owner send no `GET /me/profile` — `web/src/features/applications/__tests__/ApplySection.test.tsx::ac7_profile_gate`
- [ ] AC8 Given a cached profile and an apply that answers 409 `{"detail":"seeker_profile_required"}`, Then `GET /me/profile` is requested again (and, answering 404, the gate replaces the form); a 409 `already_applied` still refetches `GET /me/applications` and not the profile — `ApplySection.test.tsx::ac8_409_seeker_profile_required_refetches_profile`
- [ ] AC9 Given `make dev` is up, When `web/e2e/applications.spec.ts` signs its seeker up through the listing's signup link (`signUp(page, 'seeker', { start: signupHref, expectUrl: '/listings/<id>' })`), Then the section shows `applications.profileRequired` and no `applications.apply`; When it clicks `applications.fillProfile`, fills and saves the form, Then the URL is `/listings/<id>` with `applications.apply` visible; then today's apply and withdraw steps pass; finally `page.goto('/me/profile')` shows the saved values. No new e2e file and no new signup (the suite stays within `OTP_RATE_LIMIT_IP = 10`) — `web/e2e/applications.spec.ts::ac9_fill_profile_apply_withdraw`
- [ ] AC10 Given a seeker, Then the header shows `header.myProfile` linking to `/me/profile`, after `header.myApplications`; an owner and a visitor do not; Given a seeker with `GET /me/profile` 404 and `GET /areas` mocked, `/me/profile` through `AppRoutes` renders the `<h1>` `profile.title`; an owner opening `/me/profile` lands on `/`, a visitor on `/login` (the existing `RequireSeeker`) — `web/src/features/auth/__tests__/AuthMenu.test.tsx::ac10_profile_link` and `features/auth/__tests__/routes.test.tsx::ac10_profile_is_seeker_only`
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` clean; no hardcoded copy; logical properties only; existing web tests pass with only the `GET /me/profile` mock change in Scope — CI `web`, `e2e`
- [ ] NF2 Accessibility at 390 px: every control has a visible label, touch targets ≥ 44 px, the areas are a `fieldset` with a `legend`, errors announced (`role="alert"`), saved status `role="status"`; the header wraps with no horizontal scroll — ux reviewer + AC4

## Tests to write
Unit/component: `features/profile/__tests__/ProfilePage.test.tsx` (AC1–AC6), `validate.test.ts` (`ac4_rules`),
`ApplySection.test.tsx` additions (AC7, AC8) and the mock change in Scope, `AuthMenu.test.tsx` and
`routes.test.tsx` additions (AC10). E2E: `web/e2e/applications.spec.ts` extended (AC9).

## Risks / open questions
- The profile page has no artboard; the ux reviewer judges it against the wizard's anatomy and the Main
  artboard's copy. Copy above is the orchestrator's; Gilad can amend wording in the digest.
- Builds before or after `0005b`, not alongside it (both web, port 5173). The second to merge rebases
  `AuthMenu.tsx` (seeker order: `header.chat`, `header.myApplications`, `header.myProfile`) and `routes.tsx`
  (separate route groups). If `0005b` is on `main` when this builds, AC10's AuthMenu case mocks `'GET
  /me/conversations': [json([])]` and renders inside `ChatStreamProvider`, as `0005b` requires of every
  logged-in case.
- `ApplySection` grows a fourth query; keep `ProfileGate` a small separate component so `ApplyForm` / `Applied`
  are untouched.
- No open product questions.

## Verifier findings — one round, 11 findings, all applied (plus the 0006a code rename to seeker_profile_*)
Verdict: reject as written. Finding 1 would fail CI `e2e`, and findings 2–4 would fail existing tests or the spec's
own ACs. Every fix below is a spec edit; none needs a decision from Gilad. `0006a` is consistent with what this spec
uses from it (404 `profile_not_found`, 422 list / `unknown_area`, 409 `profile_required`). Two things there need
handling here: its UTC date bounds (finding 6) and its e2e profile `PUT` in `applications.spec.ts` (finding 1).

1. **E2E: AC9 goes over the OTP budget, and `applications.spec.ts` breaks under the gate.** The suite already
   makes 9 OTP requests per run: auth 1, listings 2, search 1, map 1, applications 2, inbox 2. The limit is
   `OTP_RATE_LIMIT_IP = 10` per 15 min, and the `rl:*` clear runs once per run (`0005b` Risks). AC9 adds a fresh
   owner and a fresh seeker, which makes 11, so the last signup gets a 429. Separately, `applications.spec.ts`
   signs its seeker up through the listing's signup link, so the page is back on the listing before a profile can
   exist. `0006a`'s `page.request.put('/me/profile')` can only run after that signup. By then `ApplySection` has
   already fetched `GET /me/profile`, got 404 and rendered the gate, so `applications.apply` is missing and the
   test fails once this spec ships.
   Fix: no new e2e file and no new signup. AC9 extends `web/e2e/applications.spec.ts`, renamed
   `ac9_fill_profile_apply_withdraw`:
   - After `signUp(page, 'seeker', { start: signupHref, expectUrl: '/listings/<id>' })`, assert
     `applications.profileRequired` in the section and no `applications.apply`.
   - Click `applications.fillProfile`, then fill and save the form.
   - Expect the URL `/listings/<id>` with `applications.apply` visible.
   - Run today's apply and withdraw steps.
   - Finally, `page.goto('/me/profile')` shows the saved values.

   Delete `0006a`'s profile `PUT` from this file. Keep it in `inbox.spec.ts`, which applies through the API. In
   Scope, AC9 and Tests to write, `web/e2e/profile.spec.ts (new)` becomes `web/e2e/applications.spec.ts (extended)`.

2. **ApplySection's state order contradicts itself and leaves cases out.** "While it is pending the existing
   skeleton" conflicts with "`Applied` never waits for the profile". "No live application" is undefined (does
   `declined` count?). Nothing says what happens on a 401 from `GET /me/profile`, or on a profile error when the
   seeker already has an application. Fix: the ApplySection Scope bullet uses this order:
   1. `/me` pending, or the seeker's list pending → skeleton.
   2. Visitor → as today. The condition also includes `hasStatus(profile.error, 401)`, as it already does for the
      list.
   3. Owner → nothing.
   4. List error with no data → `ErrorState`, as today.
   5. An application to this listing whose status is not `withdrawn` → `Applied`, whatever state the profile
      query is in.
   6. Profile pending → skeleton.
   7. Profile error with no data → `ErrorState`, whose retry refetches `GET /me/profile`.
   8. Profile `null` → `ProfileGate`.
   9. Otherwise → `ApplyForm`.

   `useProfile(enabled)` copies `useMyApplications`: an `enabled` parameter, and an effect that runs
   `clearSession` on a 401. AC7 gains these cases:
   - Profile pending with a `shortlisted` application → the applied state, no skeleton.
   - A `withdrawn` application with profile 404 → the gate.
   - Profile 500 with `[]` → `ErrorState`; its retry sends a second `GET /me/profile`.
   - Profile 401 → `applications.loginPrompt`.
   - A visitor and an owner send no `GET /me/profile`.

   AC7's existing "profile request pending" case uses `GET /me/applications` → `[]`.
3. **The existing ApplySection tests break.** Every seeker render in `ApplySection.test.tsx` now calls
   `GET /me/profile`: `renderSeeker`, and `ac1`'s seeker viewer. `mockApi` answers an unmocked route with a 599,
   which hits step 7 above, so the test sees `ErrorState` instead of the apply button. ac1, ac3, ac4 and ac5
   fail. Fix:
   - Scope names `features/profile/__tests__/fixtures.ts` with `profile(overrides)` → `SeekerProfileOut` (AC2's
     values, `area_ids: [gushDan.id]`, an `updated_at`).
   - Scope names the change to the existing tests: `renderSeeker`'s defaults and `ac1`'s seeker viewer add
     `'GET /me/profile': [json(profile())]`, with every assertion unchanged.
   - NF1 adds: "existing web tests pass with only that mock change".
4. **`ChoiceGroup` cannot take this form's values or errors, and no Scope line touches it.** It is typed
   `T extends string`. In the generated schema, `contract_months` is `6 | 12 | 24 | 36` and `parking_needed` is
   `number`. It also cannot show an error, set `aria-invalid` / `aria-describedby`, or be focused by id (its radio
   ids come from an internal `useId`). AC4 needs all three for household and contract. Fix: Scope adds
   `web/src/components/ChoiceGroup.tsx` with two changes:
   - `T extends string | number`; the radio id becomes `${id}-${String(option.value)}`.
   - An optional `error?: string`. When set, it renders `<p id=… role="alert">` inside the fieldset after the
     options, and every radio gets `aria-invalid="true"` and `aria-describedby` pointing at it.

   `DetailsStep` passes neither and does not change. The profile form keeps the API's own types
   (`ContractMonths | null`, `number`, `Household | null`), so there is no string/number conversion. For a radio
   group or the areas, "focus the first invalid field" means focusing its first input with
   `form.querySelector('input[name="<name>"]')`.
5. **Areas: the spec points at anatomy that does not exist, an inactive id can be re-sent, and AC1's "an
   inactive one absent" cannot be tested.** `DetailsStep` has no chip classes: its area control is a `<select>`.
   `GET /areas` returns active areas only (`list_active_areas`), so a mocked list never holds an inactive one.
   After a 422 `unknown_area` and the refetch, an id still in form state would be sent again and get another 422.
   Fix:
   - (a) Each area is a native `<input type="checkbox" name="area_ids" class="peer sr-only">` with `ChoiceGroup`'s
     label classes, inside a `<fieldset>` + `<legend>` with `flex flex-wrap gap-2`.
   - (b) Areas come from `useQuery({ queryKey: ['areas'], queryFn: fetchAreas })`, the same key `AreasList` and
     `ListingWizard` use.
   - (c) The body's `area_ids` is `areas.data.filter((a) => checked.has(a.id)).map((a) => a.id)`, in
     `GET /areas` order, and the ≥ 1 rule counts the same list. An id the list does not hold is then never shown,
     counted or sent.
   - (d) The page renders the form only once `GET /me/profile` and `GET /areas` have both succeeded. While either
     is pending it shows one skeleton; if either fails it shows one `ErrorState` whose retry refetches the failed
     query or queries. With no active areas, `EmptyState` `areas.empty` replaces the fieldset and there is no save
     button.
   - AC1: drop "(an inactive one absent)".
   - AC5's `unknown_area` case: the second `GET /areas` leaves out the chosen id. A second save then sends
     `area_ids` without it, or, if no area is left, the client refuses it with `profile.errors.areas`.
6. **Move-in date bounds: the client must allow one day less than the API.** `0006a` accepts
   `today UTC … today UTC + 365`. The app's "today" is Israel's (`todayInIsrael()`), which is a day ahead of UTC
   between 00:00 and 02:00/03:00. With `max = today + 365`, the client lets through a date the API refuses with a
   422. The wizard already solved this with `AVAILABLE_FROM_MAX_DAYS = 729` against the API's 730. Fix:
   - `validate.ts` declares `MOVE_IN_MAX_DAYS = 364`, with that one-line reason as a comment.
   - `min = todayInIsrael()` and `max = addDays(today, MOVE_IN_MAX_DAYS)`, both helpers from
     `features/listings/format.ts`.
   - AC4's date rows: `""` → required, yesterday, and `today + 365` (the first day the client refuses).
   - One line in UI: a stored date that has passed (`0006a` Data allows it) prefills as it is and fails on save
     with `profile.errors.moveIn` until the seeker changes it.
7. **Server error mapping and the 401 path are not pinned.**
   - (a) 422 list: an item maps to a field when `loc[0] === 'body'` and `loc[1]` is a form field, whatever the
     length of `loc` (a bad uuid gives `["body","area_ids",0]`). A list with no such item takes the `ErrorState`
     path. Focus moves to the first field marked.
   - (b) 401 on `PUT`: the spec navigates to `/login?next=/me/profile`. That differs from `0004b`'s
     `MyApplicationsPage`, which runs `clearSession` and lets `RequireSeeker` redirect to plain `/login` (`0004b`
     Out keeps guard redirects without a return path). It also has no AC. Fix: use the `0004b` behaviour,
     `clearSession` only, and add to AC5: "PUT 401 → location `/login`". A 401 on the first `GET /me/profile` goes
     the same way, through `useProfile` (finding 2).
8. **i18n: error copy is missing, two keys duplicate existing ones, the `₪` unit has no key, and one key breaks
   the naming pattern.** `profile.errors.{budget,moveIn,areas,required,invalid,areaInactive}` have no Hebrew
   values. `required` and `invalid` duplicate `listings.errors.required` / `.invalid`. "Unit `₪`" has no key.
   `header.profile` breaks the `header.myListings` / `header.myApplications` pattern.
   Fix, reusing existing keys:
   - `listings.errors.required` for household, contract and an empty date.
   - `listings.errors.range` with `{min: 500, max: 100000}` for the budget, as the wizard's price does.
   - `listings.errors.invalid` for a server 422.
   - `listings.units.ils`, `common.loading` and `areas.empty`.

   New keys, listed in a table in UI next to the keys UI already quotes:

   | key | value |
   | --- | --- |
   | `header.myProfile` | `הפרופיל שלי` |
   | `profile.errors.moveIn` | `התאריך צריך להיות בשנה הקרובה` |
   | `profile.errors.areas` | `צריך לבחור לפחות אזור אחד` |
   | `profile.errors.areaInactive` | `אחד האזורים שבחרת כבר לא פעיל. כדאי לבדוק את הבחירה ולשמור שוב` |

   The key names in AC4, AC5 and AC10 change to match. `profile.privacy` repeats `0006c` AC6 (owners never see
   the budget or the areas), so the two must change together.
9. **The overlap with `0005b` is not handled.** Both specs edit the logged-in branch of `AuthMenu.tsx` and
   `routes.tsx`. Both are web specs, so they do not build at the same time (Speed rule 2, port 5173). Once both
   land, a seeker's header holds the chat link, my applications, my profile and logout, which needs a row that
   wraps at 390 px. Fix:
   - A Risks line: "Builds before or after `0005b`, not alongside it. The second to merge rebases `AuthMenu.tsx`
     (seeker order: `header.chat`, `header.myApplications`, `header.myProfile`) and `routes.tsx` (separate route
     groups). If `0005b` is on `main` when this builds, AC10's AuthMenu case mocks
     `'GET /me/conversations': [json([])]` and renders inside `ChatStreamProvider`, as `0005b` requires of every
     logged-in case."
   - Scope: `AuthMenu`'s logged-in inner `div` gains `flex-wrap`. `0005b` makes the same one-word change; keep
     one copy.
   - NF2 adds: "the header at 390 px wraps with no horizontal scroll".
10. **AC10's route test passes even without the route.** An owner opening `/me/profile` lands on `/` through the
    `*` catch-all even if `me/profile` was never registered. Fix: AC10 adds "Given a seeker, with
    `GET /me/profile` 404 and `GET /areas` mocked, `/me/profile` through `AppRoutes` renders `<h1>`
    `profile.title`".
11. **AC wording.**
    - AC1 says "both switches off", but there are three (`flexible`, `pets`, `smoker`). It should read "all three
      switches off".
    - AC4: each row is AC2's valid form with one change. One more row submits the empty form: errors on budget,
      date, areas, household and contract, with focus on the budget input.
    - The pure validation rules are tested in `validate.test.ts::ac4_rules`, since tests are named after their
      AC.

## Digest (filled by orchestrator after verification)

    Spec 0006d - Profile web: /me/profile and the apply gate   (verified, part 4 of 7, depends on 0006a)
    What a user can do after this: a seeker fills or edits a short housing profile at /me/profile (header link
             "הפרופיל שלי"); a seeker without one sees "מילוי פרופיל" instead of apply, and returns to the listing.
    Decisions: none new (copy is mine; amend wording if you like).
    KPIs this slice moves: profile completion; drop-off between gate and apply.
    Acceptance targets: NF1 lint/test/i18n/build clean - NF2 390 px, 44 px targets, header wraps without scroll.
    Risks: e2e OTP budget (9 of 10 used) - mitigation: extends applications.spec.ts, no new signup. Overlaps
             0005b on AuthMenu/routes - mitigation: never built together (port 5173); second rebases.
    Reviewers: code, qa, ux   Estimated: 1 coder run, 1 review round
    Links: specs/0006d-profile-web.md - PRODUCT.md "Matching" - design/screens-v1/Main.dc.html (copy), CreateListing.dc.html (anatomy)
