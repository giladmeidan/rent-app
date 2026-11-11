---
id: 0006e
title: An owner says who the listing suits — households, no smokers, minimum contract — in a new wizard step "העדפות" (create and edit), and the listing page shows "מה בעל הדירה מחפש"
status: verified
depends_on: [0006a]      # the three listing fields on POST / PATCH / GET, and 0006a's type-only web edits (ListingInBody Omit, fixture defaults)
reviewers: [code, qa, ux]   # ux: a new wizard step and a new listing-page section; qa: the edit diff for an array field
estimate: 1 coder run
---

## Goal
After this ships, the listing wizard (`/listings/new`, `/me/listings/:id/edit`) has four steps — type → details →
**preferences** → preview — where the owner picks the accepted households (default: all), "ללא מעשנים" and a
minimum contract length; publish sends them, an edit sends only what changed; the public listing page shows a
"מה בעל הדירה מחפש" section when the owner set any preference. Serves Dev Plan slice 6, part e of seven
(overview in `0006a`); PRODUCT.md "Matching" (Slice 6 batch): smoking and pets are deal-breakers, household and
contract only lower the score. `0002a` "Out" deferred this step ("artboard step 4 העדפות"). Artboards:
`CreateListing.dc.html` (the step bar and form anatomy; its step 4 is "העדפות"), `Listing.dc.html` ("מה בעל הדירה
מחפש" chips, after "מיקום").

## Scope
**In:**
- `web/src/features/listings/api.ts`: `ListingInBody` goes back to `Required<Omit<ListingIn, 'rooms'>> & { rooms:
  number }` (undoing `0006a`'s temporary `Omit` of the three fields); `export type Household =
  ListingOut['accepted_households'][number]` and `export type ContractMonths =
  NonNullable<ListingOut['min_contract_months']>` (Pydantic inlines the `Literal`s, so `schema.d.ts` has no such
  components — the same way `Furnished` is derived).
- `web/src/features/listings/constants.ts`: `HOUSEHOLDS: readonly Household[] = ['single', 'couple', 'family',
  'roommates']` (`0006f` reuses it).
- `web/src/features/listings/validate.ts`: `ListingForm` gains `accepted_households: Household[]`,
  `smoking_allowed: boolean`, `min_contract_months: ContractMonths | null` (the form holds the API values; no
  string conversion); `emptyForm` defaults all four households, `true`, `null`; `FIELD_ORDER` gains
  **`accepted_households` and `min_contract_months` only**, after the details fields (`smoking_allowed` stays
  out: the client always sends a boolean; a stray 422 on it falls through to PreviewStep's `common.error`);
  `FieldError` gains `{ key: 'listings.errors.households' }`; `validate()`'s `found` lists the two new names as
  `undefined`; `validatePreferences(form)` (new: ≥ 1 household); `toListingIn` sends the three (households in
  `HOUSEHOLDS` order); `formFromListing` reads them; `changedFields` compares `accepted_households` **as a set**
  (same length, every item included — `===` on arrays compiles and `patch as ListingPatch` hides it, so only AC9
  guards this).
- `web/src/features/listings/PreferencesStep.tsx` (new) — the step (UI); gets `errors={{ ...serverErrors,
  ...errors }}` as `DetailsStep` does.
- `web/src/features/listings/OwnerPreferences.tsx` (new) — the read-only chips block, used by `ListingPage.tsx`
  (after the location `<section>`, before `<ApplySection>`) and by `PreviewStep.tsx` (under the card).
- `web/src/features/listings/ListingWizard.tsx`: `Step = 1 | 2 | 3 | 4`; labels `listings.steps.{type, details,
  preferences, preview}`; progress `step / 4` (`aria-valuemax="4"`); details "next" → 3 (after `validate`),
  preferences "next" → 4 (after `validatePreferences`); **back goes to `step − 1` in both modes** (`goTo((step -
  1) as Step)` replaces `step === 3 ? 2 : 1`): edit still opens at step 2 and can go back to step 1 (`0002e`,
  PRODUCT.md "Listing edit"); `update()` re-checks with `{ ...validate(withArea(next), today),
  ...validatePreferences(next) }` once attempted; `onSaveError` becomes `goTo(first === 'accepted_households' ||
  first === 'min_contract_months' ? 3 : 2)` (details fields come first in `FIELD_ORDER`, so a 422 naming both
  kinds lands on 2) with `focusAfterStep` as today.
- `web/src/features/listings/PreviewStep.tsx`: `onBackToDetails` stays `goTo(2)` (the area lives on details); the
  `areaInactive` alert's button gets its own key `listings.preview.backToDetails` ("חזרה לפרטים"), since the
  sticky "חזרה" now goes to step 3; doc comment "Step 3" → "Step 4".
- `web/src/locales/he.json`: `listings.steps.preferences`, `listings.prefs.*`, `listings.errors.households`,
  `listings.preview.backToDetails`, `listing.ownerLooksFor.*` (UI).
- Existing tests updated for the fourth step (Tests to write) and `web/e2e/listings.spec.ts` (AC8).
- Fixtures: `features/listings/__tests__/fixtures.ts` `listing()` and `features/search/__tests__/fixtures.ts`
  `publicListing()` carry the three defaults (`0006a` adds them; add only if missing on the branch).

**Out:**
- The pets deal-breaker control: `pets_allowed` stays where it is (details step, `0002b`); the hint mentions it.
- Scores and the seeker's match card: `0006f`. Room-only preferences (gender, roommates): Slice 7. "הכנסה יציבה"
  and the owner's name / phone-verified line on the artboard: not collected (PRODUCT.md "Matching", "Search":
  no owner name on the public listing).
- Changes to the shared `ChoiceGroup` / `Switch` (the step uses a `<select>` and native checkboxes instead).

**New dependencies:** none.

## Data
None (web only).

## API
Uses `POST /listings`, `PATCH /listings/{id}`, `GET /me/listings`, `GET /listings/{id}` with the three fields of
`0006a`. `make client` before building.

## UI
**Preferences step** (`PreferencesStep`), same anatomy as `DetailsStep`, 390 px first, logical properties, RTL
inherited (chips and checkboxes flow from the inline start, households in `HOUSEHOLDS` order):
1. `<h2>` `listings.prefs.title` ("למי הדירה מתאימה?"), `<p>` hint `listings.prefs.hint` ("ההעדפות נכנסות לחישוב
   ציון ההתאמה. ‘ללא מעשנים’ כאן ו‘חיות מחמד מותרות’ בשלב הקודם הם תנאי סף; שאר ההעדפות רק מורידות את הציון.").
2. `accepted_households` — `<fieldset aria-invalid={…} aria-describedby={errorId}>` + `<legend>`
   `listings.prefs.households` ("מי יכול/ה להגיש"); four native `<input type="checkbox" className="peer
   sr-only">` each with a label styled as `ChoiceGroup`'s segmented button (`peer-checked:` accent tint,
   `peer-focus-visible:` ring, `min-h-[44px]`), in `grid grid-cols-2 gap-2`; labels through a static map
   (`{ single: t('listings.prefs.household.single'), … }`, like DetailsStep's `furnished`; `i18n-check` only
   verifies string-literal keys): "יחיד/ה", "זוג", "משפחה", "שותפים"; all checked by default; the **first
   checkbox** carries `id={fieldId('accepted_households')}` so the focus loop and `focusAfterStep` work
   unchanged; none checked on "next" → `listings.errors.households` ("צריך לבחור לפחות אפשרות אחת") in a
   `role="alert"`.
3. `smoking_allowed` — `Switch` `listings.prefs.noSmokers` ("ללא מעשנים") in DetailsStep's `card` wrapper;
   checked means `smoking_allowed: false`; default unchecked.
4. `min_contract_months` — a `<select>` with DetailsStep's `a11y('min_contract_months')` and `errorText`
   pattern, label `listings.prefs.minContract` ("משך חוזה מינימלי"), options `listings.prefs.contract.{none,
   6, 12, 24, 36}` ("ללא מינימום", "חצי שנה", "שנה", "שנתיים", "שלוש שנים") with `none` as value `''`; the
   control converts (`value={String(form.min_contract_months ?? '')}`, back through a lookup over `[6, 12, 24,
   36]`, no cast).

**Owner looks for** (`OwnerPreferences`): `<section aria-labelledby={h2 id}>` (a named region) with `<h2>`
`listing.ownerLooksFor.title` ("מה בעל הדירה מחפש"), the chips as `<ul>` / `<li>` in the artboard's white card
(border `line`, radius 16, `flex flex-wrap gap-2`; each chip 13 px / 600, `bg-[#F5F5F4]`, `border-[#E7E5E4]`,
pill, `px-3 py-[6px]`): the households when fewer than four, as the bare list joined with `new
Intl.ListFormat('he', { type: 'disjunction' })` ("יחיד/ה או זוג"; three → "יחיד/ה, זוג או משפחה");
`listing.ownerLooksFor.noSmokers` ("ללא מעשנים") when `smoking_allowed` is false;
`listing.ownerLooksFor.minContract` ("חוזה ל{{label}} לפחות", the label from `listings.prefs.contract.*`:
לחצי שנה / לשנה / לשנתיים / לשלוש שנים) when set. When none applies the section is not rendered (no empty
heading). It lists no owner identity.

States: the step has no async state of its own; publish / save errors keep today's handling (`PreviewStep`).

## Acceptance criteria
Vitest + Testing Library with the existing wizard harness (`features/listings/__tests__/wizard.tsx`,
`fixtures.ts`).
- [ ] AC1 Given the create wizard, Then the step bar shows four steps in order (`type`, `details`, `preferences`, `preview`) with `aria-current="step"` on the current one, the progress `aria-valuemax="4"` and `aria-valuenow` 1…4 as the owner advances; back from preview lands on preferences, then details, then type, keeping every value; in edit mode back from details reaches type — `web/src/features/listings/__tests__/ListingWizard.test.tsx::ac1_four_steps`
- [ ] AC2 Given a complete details step and an untouched preferences step, When publishing, Then exactly one `POST /listings` whose body is the existing `expectedBody` plus `accepted_households: ["single","couple","family","roommates"]`, `smoking_allowed: true`, `min_contract_months: null` — `ListingWizard.test.tsx::ac4_preview_then_publish_navigates` (amended)
- [ ] AC3 Given the preferences step, When the owner unchecks all four households, then checks "זוג", then "יחיד/ה", turns "ללא מעשנים" on and picks "שנה", Then the preview shows the three chips under the card ("יחיד/ה או זוג", "ללא מעשנים", "חוזה לשנה לפחות"), and publishing sends `accepted_households: ["single","couple"]`, `smoking_allowed: false`, `min_contract_months: 12` — `ListingWizard.test.tsx::ac3_chosen_preferences_sent`
- [ ] AC4 Given every household unchecked, When "next", Then no step change, `listings.errors.households` in a `role="alert"`, the fieldset `aria-invalid`, focus on its first checkbox; toggling "ללא מעשנים" keeps the error; checking one household removes it (`aria-invalid` false) — `ListingWizard.test.tsx::ac4_households_required`
- [ ] AC5 Given a publish answering 422 `detail: [{loc: ["body","min_contract_months"], …}]`, Then the wizard returns to step 3 with `listings.errors.invalid` on that select and focus there; with both a details field and `accepted_households` named, Then step 2 — `ListingWizard.test.tsx::ac5_server_error_on_preference_returns_to_step_3`
- [ ] AC6 Given the edit page for a listing with `accepted_households ["couple","single"]` (any order from the API), smoking allowed, no minimum, When the owner changes only the minimum to "שנתיים" and saves, Then exactly one `PATCH` with body exactly `{min_contract_months: 24}`; Given the same listing untouched, Then `beforeunload` is not prevented (as the first case of `ac9_unsaved_changes_guard`) and after next → next → save no PATCH is sent, the URL is `/me/listings` and there is no `listings.edit.saved` line; a listing with `smoking_allowed: false` opens with the `listings.prefs.noSmokers` switch checked — `web/src/features/listings/__tests__/EditListingPage.test.tsx::ac6_preferences_patch_only_changes`
- [ ] AC7 Given `GET /listings/{id}` with `accepted_households ["single","couple"]`, `smoking_allowed false`, `min_contract_months 12`, Then the listing page shows, after the location section, the region `listing.ownerLooksFor.title` with chips "יחיד/ה או זוג", "ללא מעשנים", "חוזה לשנה לפחות"; with all four households, smoking allowed and no minimum, Then no such heading is rendered — `web/src/features/listings/__tests__/ListingPage.test.tsx::ac7_owner_looks_for`
- [ ] AC8 Given `make dev` is up, When `ac9_owner_creates_and_pauses_listing` walks the new step with `getByRole('switch', { name: he.listings.prefs.noSmokers }).check()`, wraps the publish in `page.waitForResponse` (POST `/listings`, 201) and reads `id`, Then **before pausing** `page.goto('/listings/' + id)` shows `getByRole('region', { name: he.listing.ownerLooksFor.title })` containing "ללא מעשנים"; then back to `/me/listings` and pause as today — `web/e2e/listings.spec.ts::ac9_owner_creates_and_pauses_listing` (extended)
- [ ] AC9 `validate.test.ts`: `toListingIn` orders households canonically; `formFromListing` → `toListingIn` round-trips the three fields; `changedFields` reports `accepted_households` only when the set differs (`["couple","single"]` vs `["single","couple"]` → no change) — `web/src/features/listings/__tests__/validate.test.ts::ac9_preference_helpers`
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` clean; every existing test in Tests to write updated in the same change — CI `web`, `e2e`
- [ ] NF2 Accessibility at 390 px: the households are a `fieldset` + `legend`, the switch and select have visible labels, targets ≥ 44 px, logical properties only, no two same-named buttons with different targets on one screen — ux reviewer

## Tests to write
New: `ListingWizard.test.tsx` `ac1_four_steps`, `ac3_…`, `ac4_households_required`, `ac5_…`;
`EditListingPage.test.tsx` `ac6_…`; `ListingPage.test.tsx` `ac7_…`; `validate.test.ts` `ac9_…`.
Existing, amended for the fourth step:
- `ListingWizard.test.tsx`: `toPreview()` (one more next, then `aria-valuenow` '4'; used by
  `ac4_preview_then_publish_navigates`, `ac5_publish_errors`, `ac4_publish_double_click_posts_once`);
  `ac2_type_step_and_back_keeps_state` (`aria-valuemax` '3' → '4'); `ac4_preview_then_publish_navigates`
  (`expectedBody` gains the three defaults — AC2); `ac5_publish_errors` (the cap case '3' → '4'; the
  `unknown_area` and city cases stay '2'; `within(alert).getByRole('button', { name: he.common.back })` →
  `he.listings.preview.backToDetails`).
- `EditListingPage.test.tsx`: `changePriceAndSave()` (one more next, then '4'); the bare next → save in
  `ac2_loads_from_my_listings_and_not_found`, `ac4_save_sends_only_changed_fields`,
  `ac4_unchanged_form_saves_nothing` (one more next each); `ac6_save_errors` (the model-level case '3' → '4';
  its alert button as above).
- `validate.test.ts`: `ac8_body_is_trimmed_and_typed` (the exact body gains the three defaults);
  `ac11_form_from_listing_and_changed_fields` (green once `listing()` has the fields).
- `web/e2e/listings.spec.ts`: `ac9_owner_creates_and_pauses_listing` (AC8) and **`ac12_owner_edits_listing`**
  (one more next before `listings.preview.hint`; its exact PATCH body `{price_ils, arnona_ils}` also proves end to
  end that the households array causes no false diff). No other e2e walks the wizard.

## Risks / open questions
- Copy is the orchestrator's; the artboard only names the step ("העדפות") and three chips. Gilad can amend
  wording in the digest.
- `0006d` adds `profile.household.*` / `profile.contract.*` with the same Hebrew as `listings.prefs.household.*` /
  `listings.prefs.contract.*`; the duplication is accepted (different voices may diverge); whichever lands second
  may reuse the first's keys instead.
- No open product questions.

## Verifier findings — one round, 14 findings, all applied
Verdict: **reject** (stays `draft`). Checked against `main`. Findings 1–6 are fixes the coder could not
work out alone; 7–14 make the spec precise enough for one run.

1. **Edit mode loses step 1 (contradicts `0002e` and PRODUCT.md).** Scope says "back 4 → 3 → 2 (→ 1 when
   creating)". Today edit mode's back from step 2 goes to step 1 (`0002e` Scope: "step 1 stays reachable with
   `common.back`", Q3 (a)). PRODUCT.md "Listing edit": "an edit may switch apartment/room".
   `EditListingPage.test.tsx::ac3_prefilled_from_listing` asserts it. **Fix:** "back goes to `step − 1` in both
   modes (`goTo((step - 1) as Step)` replaces `step === 3 ? 2 : 1`); edit still opens at step 2 and can go back
   to step 1".

2. **AC6's second half describes behaviour that does not exist.** No code disables "save" on an unchanged form.
   `publish()` finds an empty `changedFields` and navigates to `/me/listings` with no PATCH (`0002e` AC4,
   `ac4_unchanged_form_saves_nothing`). Also, "opens the preview" does not check the place where a false array
   diff would show up: `dirty`. **Fix**, AC6 second sentence: "Given the same listing untouched, Then
   `beforeunload` is not prevented (as the first case of `ac9_unsaved_changes_guard`); after next → next → save
   no PATCH is sent, the URL is `/me/listings` and there is no `listings.edit.saved` line". Add: "a listing with
   `smoking_allowed: false` opens with the `listings.prefs.noSmokers` switch checked".

3. **AC4/AC5's focus and error wiring cannot work with the controls the UI section names.** Focus after a 422
   goes through `focusAfterStep` → `document.getElementById(fieldId(name))`. The `errorFor()` harness needs
   `aria-invalid` and an `aria-describedby` that points at the `role="alert"`. `ChoiceGroup` builds its radio
   ids from its own `useId()` and takes no `id`, `aria-invalid` or `aria-describedby`. `Switch` is the same. As
   written, AC5 needs a change to a shared component that Scope does not list. **Fix (smallest):**
   - Render `min_contract_months` as a `<select>` with DetailsStep's `a11y('min_contract_months')` and
     `errorText` pattern (rooms and parking are already a select where the artboard draws segmented buttons).
     Its options are `listings.prefs.contract.{none,6,12,24,36}`, with `none` as value `''`.
   - Render the households as native checkboxes in
     `<fieldset aria-invalid={…} aria-describedby={errorId}>`. The **first checkbox** carries
     `id={fieldId('accepted_households')}`, so the step-2 focus loop and `focusAfterStep` work unchanged.
   - Keep `smoking_allowed` **out of** `FIELD_ORDER`. The client always sends a boolean, so the API cannot
     reject it. A stray 422 on it falls through to PreviewStep's `common.error`, like any unmapped `loc`.
     `Switch` then needs no change.
   - So `FIELD_ORDER` gains only `accepted_households` and `min_contract_months`.
   - `FieldError` gains `{ key: 'listings.errors.households' }`.
   - `validate()`'s `found: Record<FieldName, …>` must list both new names as `undefined`.
   - `onSaveError` becomes `goTo(first === 'accepted_households' || first === 'min_contract_months' ? 3 : 2)`.
     Details fields come first in `FIELD_ORDER`, so a 422 naming both kinds lands on 2.
   - PreferencesStep gets `errors={{ ...serverErrors, ...errors }}`, as DetailsStep does.

   If UX insists on segmented buttons instead: add `web/src/components/ChoiceGroup.tsx` to Scope with optional
   `inputId` (on the checked radio, else the first), `invalid` and `describedBy` props. TypeStep and DetailsStep
   stay untouched.

4. **The households error disappears while the step is still invalid.** After `attempted`, `update()` re-runs
   `validate()` only. It keeps a shown error only if `validate` still finds it, and `validatePreferences` errors
   are never in that result. So toggling "ללא מעשנים" or the contract while no household is checked removes
   the alert. **Fix:** in `update`, use
   `const found = { ...validate(withArea(next), today), ...validatePreferences(next) }`. Add to AC4: "toggling
   'ללא מעשנים' keeps the error; checking one household removes it (`aria-invalid` false)".

5. **The form's `min_contract_months` contradicts itself, and the named types do not exist.**
   - Scope says `ListingForm.min_contract_months: ContractMonths | null` with `emptyForm` `null`. The UI section
     says "string values … convert in `toListingIn` / `formFromListing`". **Keep Scope's version.** The form
     holds the API value, `toListingIn`/`formFromListing` pass it through, and `changedFields`' `===` already
     works for it. The control converts: `value={String(form.min_contract_months ?? '')}`, and a lookup over
     `[6, 12, 24, 36]` going back, so no cast. Delete the UI sentence.
   - "Types from the generated schema": Pydantic inlines `Literal` aliases, so `schema.d.ts` has no `Household`
     or `ContractMonths` component. Export them in `api.ts`, as that file does for `Furnished`:
     `export type Household = ListingOut['accepted_households'][number]` and
     `export type ContractMonths = NonNullable<ListingOut['min_contract_months']>`.
   - Define the web `HOUSEHOLDS: readonly Household[] = ['single','couple','family','roommates']` in
     `features/listings/constants.ts`, where `0006f` can reuse it.
   - `changedFields`: compare `accepted_households` as a set (same length, every item included). Comparing
     arrays with `===` compiles, and `patch as ListingPatch` hides any mismatch, so `tsc` will not catch the bug.
     Only AC9 guards it.

6. **`0006a` says the current web keeps working; at compile time it does not, and this spec inherits the
   break.**
   - `ListingInBody = Required<Omit<ListingIn, 'rooms'>>` (`api.ts`) makes the three new `ListingIn` fields
     required. After `make client`, `toListingIn` (`validate.ts`) fails `tsc`.
   - `ListingOut` and `ListingPublic` gain three required output fields (FastAPI 0.162 uses separate output
     schemas). So `features/listings/__tests__/fixtures.ts::listing()` and
     `features/search/__tests__/fixtures.ts::publicListing()` also fail `tsc`.
   - `schema.d.ts` is git-ignored and regenerated by CI's `web` job, which runs on `0006a`'s api-only PR
     (`paths-ignore` skips only md, `specs/` and `design/`). So `0006a`'s own PR goes red.

   **Fix here:** Scope names both fixture files. `listing()` and `publicListing()` default
   `accepted_households` to all four, `smoking_allowed: true` and `min_contract_months: null`, unless they are
   already on the branch. **For the orchestrator:** `0006a` needs the minimal web edit to stay green (toListingIn
   sends the three defaults, plus these two fixtures). That edit belongs in `0006a`; 0006e then builds on it.

7. **The existing tests the fourth step breaks are not named** (NF1 only says "every existing … test"):
   - `ListingWizard.test.tsx`:
     - `toPreview()` asserts `aria-valuenow` '3' after details. It needs one more next, then '4'. It is used by
       `ac4_preview_then_publish_navigates`, `ac5_publish_errors` and `ac4_publish_double_click_posts_once`.
     - `ac2_type_step_and_back_keeps_state`: `aria-valuemax` '3' → '4'.
     - `ac4_preview_then_publish_navigates`: `expectedBody` is an exact `toEqual` and gains the three defaults.
       That **is** AC2, so point AC2 at this test instead of writing `ac2_default_preferences_sent`.
     - `ac5_publish_errors`: the cap case goes '3' → '4'; the `unknown_area` and city cases stay at '2'.
   - `EditListingPage.test.tsx`:
     - `changePriceAndSave()` asserts '3'. It needs one more next, then '4'.
     - The bare next → save in `ac2_loads_from_my_listings_and_not_found`, `ac4_save_sends_only_changed_fields`
       and `ac4_unchanged_form_saves_nothing` each need one more next.
     - `ac6_save_errors`: the model-level case goes '3' → '4'.
   - `validate.test.ts`:
     - `ac8_body_is_trimmed_and_typed`: the exact body gains the three defaults.
     - `ac11_form_from_listing_and_changed_fields` goes green once `listing()` has the fields (finding 6).
   - `web/e2e/listings.spec.ts`:
     - `ac9_owner_creates_and_pauses_listing`.
     - **`ac12_owner_edits_listing`** (not mentioned in the spec). After details "next" it expects
       `listings.preview.hint`, so it needs one more next. Its exact PATCH body `{price_ils, arnona_ils}` also
       proves end to end that the households array causes no false diff.
   - No other e2e walks the wizard: applications, inbox, search and map post listings through the API.

8. **AC8's e2e cannot reach the public page as described, and a second wizard walk is wasted slow-tier time.**
   My-listings cards do not link to `/listings/:id`. `ac9_…` pauses the listing, after which the public page
   returns 404. **Fix:** extend `ac9_owner_creates_and_pauses_listing` instead of adding a test:
   - At the new step, `getByRole('switch', { name: he.listings.prefs.noSmokers }).check()`.
   - Wrap the publish in `page.waitForResponse` (POST `/listings`, 201) and read `id` from it.
   - **Before pausing**, `page.goto('/listings/' + id)` and assert that
     `getByRole('region', { name: he.listing.ownerLooksFor.title })` contains "ללא מעשנים".
   - Go back to `/me/listings` and pause as today.

   AC8 then names `listings.spec.ts::ac9_owner_creates_and_pauses_listing`.

9. **The listing-page placement contradicts the artboard.** `Listing.dc.html` puts "מה בעל הדירה מחפש" **after**
   "מיקום" and before the match card and CTA. **Fix:** render it after the location `<section>`, before
   `<ApplySection>`. Also specify:
   - `<section aria-labelledby={h2 id}>`, so it is a named region (finding 8) like a landmark.
   - The chips as `<ul>`/`<li>` in the artboard's white card: border `line`, radius 16, `flex flex-wrap gap-2`;
     each chip 13 px/600, `bg-[#F5F5F4]`, `border-[#E7E5E4]`, pill, `px-3 py-[6px]`.
   - RTL note: inherited `dir="rtl"`, chips flow and wrap from the inline start, and the households appear in
     `HOUSEHOLDS` order.

10. **The preview half of AC7 is in a file that cannot test it.** "The preview step renders the same block from
    the form" cannot run in `ListingPage.test.tsx`, which has no wizard. **Fix:** move that clause to AC3
    (`ListingWizard.test.tsx::ac3_chosen_preferences_sent`): before publishing, the preview shows the three chips
    under the card.

11. **Copy that does not match the app or reads wrong:**
    - (a) The hint names a control that does not exist. The details step's switch is `listings.fields.pets`
      "חיות מחמד מותרות", not "ללא חיות מחמד". Suggested: "ההעדפות נכנסות לחישוב ציון ההתאמה. ‘ללא מעשנים’ כאן
      ו‘חיות מחמד מותרות’ בשלב הקודם הם תנאי סף; שאר ההעדפות רק מורידות את הציון."
    - (b) "חוזה ל{{label}} לפחות" with "3 שנים" renders "חוזה ל3 שנים לפחות" (a prefix letter on a digit needs a
      maqaf). Make `listings.prefs.contract.36` "שלוש שנים". The other three read right: לחצי שנה, לשנה, לשנתיים.
    - (c) The artboard chip is the bare list "זוג או יחיד/ה", under a heading that already says what it is.
      Drop `listing.ownerLooksFor.households` and `.or`, and join the labels with
      `new Intl.ListFormat('he', { type: 'disjunction' })`: one platform call and no keys, giving
      "יחיד/ה, זוג או משפחה" for three. AC7's chip becomes "יחיד/ה או זוג".
    - Look labels up through a static map (`{ single: t('listings.prefs.household.single'), … }`, like
      DetailsStep's `furnished`), not through template-literal keys: `i18n-check` only verifies string-literal
      keys.

12. **The PreviewStep "back to details" path is not covered.** `onBackToDetails` must stay `goTo(2)`, because the
    area lives on details. The '2' assertions in `ac5_publish_errors` and `ac6_save_errors` stay. But the sticky
    "חזרה" now goes to 3 while the `areaInactive` alert's "חזרה" goes to 2: two buttons with the same name and
    different targets on one screen. **Fix:**
    - Give the alert's button its own key, `listings.preview.backToDetails` ("חזרה לפרטים").
    - Update the two `within(alert).getByRole('button', { name: he.common.back })` lines.
    - Change PreviewStep's doc comment "Step 3" to "Step 4".

13. **AC3 does not prove the canonical order.** All four households start checked. Unchecking family and
    roommates leaves `[single, couple]`, which is already in canonical order, so the test proves nothing about
    ordering. **Fix:** "uncheck all four, then check 'זוג', then 'יחיד/ה'" → body `["single","couple"]`.

14. **The new step's anatomy and the AC1 bound are left open.** The artboard only names step 4, and the repo has
    no checkbox component. Specify:
    - The step heading is an `<h2>` and the hint a `<p>`.
    - Each household is a native `<input type="checkbox" className="peer sr-only">` plus a label styled as
      ChoiceGroup's segmented button (`peer-checked:` accent tint, `peer-focus-visible:` ring, `min-h-[44px]`),
      in `grid grid-cols-2 gap-2` at 390 px.
    - The smoking switch sits in DetailsStep's `card` wrapper.
    - RTL note as finding 9.
    - AC1 also asserts `aria-valuemax="4"`.

Cross-spec note for the orchestrator (no change here): `0006d` adds `profile.household.*` and
`profile.contract.*` with the same Hebrew as `listings.prefs.household.*` and `listings.prefs.contract.*`. That
duplication is fine, but whichever lands second could reuse the first's keys.

## Digest (filled by orchestrator after verification)

    Spec 0006e - Owner preferences web: wizard step "העדפות" + "מה בעל הדירה מחפש"   (verified, part 5 of 7, depends on 0006a)
    What a user can do after this: an owner picks accepted households, "ללא מעשנים" and a minimum contract in a new
             wizard step (create and edit, only changes sent); the listing page shows the chips.
    Decisions: none new (copy is mine).
    KPIs this slice moves: share of listings with at least one preference set.
    Acceptance targets: NF1 lint/test/i18n/build/e2e clean - NF2 fieldset + legend, 44 px targets, no two
             same-named buttons with different targets.
    Risks: the fourth step shifts every existing wizard test - mitigation: each one is named in Tests to write.
             Array diff could mark every edit changed - mitigation: set comparison + e2e PATCH body check.
    Reviewers: code, qa, ux   Estimated: 1 coder run, 1 review round
    Links: specs/0006e-owner-preferences-web.md - PRODUCT.md "Matching", "Listing edit" - design/screens-v1/CreateListing.dc.html, Listing.dc.html
