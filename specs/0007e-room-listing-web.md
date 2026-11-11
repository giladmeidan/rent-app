---
id: 0007e
title: An owner posting or editing a room says who it is for, how many flatmates live there, their ages and the flat's lifestyle, in the wizard's "העדפות" step
status: verified
depends_on: [0007a, 0007d, 0006e]   # 0007a: the four listing fields on POST / PATCH / GET; 0007d: features/lifestyle; 0006e: the four-step wizard and its PreferencesStep
reviewers: [code, qa, ux]           # ux: a new block in the wizard; qa: the edit diff for an array and an object field
estimate: 1 coder run
---

## Goal
After this ships, an owner who picks "חדר בדירת שותפים" (`/listings/new` or `/me/listings/:id/edit`) sees, in the
**העדפות** step, a room block: who the room is for (נשים / גברים / לא משנה, default לא משנה), how many flatmates
already live there (1–7, required), their ages (optional, at most one per flatmate, 18–99) and the flat's lifestyle
questionnaire (optional); the preview shows them, publish sends them, an edit sends only what changed. Serves Dev
Plan slice 7, part e of seven; PRODUCT.md "Rooms", "Listings", "Listing edit". Artboard: `CreateListing.dc.html` (the
step bar and form anatomy; it has no room fields, so the copy and layout below are the orchestrator's).

## Scope
**In:**
- Where the fields live: **in step 3 (העדפות), below the general preferences, as a `<section>` rendered only when
  `form.listing_type === 'room'`.** Why: step 3 is already "who this listing suits", the gender preference is exactly
  that; the details step is the longest screen and holds facts about the place, not about people; a fifth step for
  one block would break `0006e`'s four-step bar and every wizard test it just amended. The cost is that a room owner
  meets the "required" count on step 3, so `validatePreferences` carries it (the wizard already blocks "next" there
  and the preview is only reachable from it).
- `web/src/features/listings/api.ts`: `export type GenderPreference = ListingOut['gender_preference']` (the
  generated schema inlines the `Literal`, like `Furnished`). `ListingInBody` goes back to
  `Required<Omit<ListingIn, 'rooms'>> & { rooms: number }`: this removes `0007a`'s temporary `Omit` of the four
  room fields, as `0006e` did for its three (with the keys still omitted, `toListingIn`'s four new keys are excess
  properties and `tsc` fails).
- `web/src/features/listings/constants.ts`: `GENDER_PREFERENCES: readonly GenderPreference[] = ['women', 'men',
  'any']` (display order, like `HOUSEHOLDS`).
- `web/src/features/listings/validate.ts`:
  - `LIMITS` gains `flatmate_age: { min: 18, max: 99 }` and `flatmates_count: { min: 1, max: 7 }` (API bounds,
    `0007a`).
  - `ListingForm` gains `gender_preference: GenderPreference` (default `'any'`), `flatmates_count: number | null`
    (default `null`; the control converts, like `min_contract_months` in `0006e`), `flatmate_ages: string[]` (the
    strings typed, slot `i` is flatmate `i + 1`; default `[]`; slots beyond the count are kept but ignored, so
    lowering and raising the count loses nothing; readers use `ages[i] ?? ''`) and `lifestyle: LifestyleAnswers`
    (from `features/lifestyle`).
  - `FIELD_ORDER` gains **`flatmates_count`, `flatmate_ages`** after `min_contract_months` (the visual order of
    step 3); `gender_preference` and `lifestyle` stay out: the client always sends valid values, a stray 422 on them
    falls to `PreviewStep`'s `common.error`. `validate()`'s `found` lists both as `undefined`.
  - `validatePreferences(form)` (from `0006e`) also, **only for `listing_type === 'room'`**: `flatmates_count ===
    null` → `listings.errors.required`; and for slots `0 … count − 1`, the existing `integer(slot,
    LIMITS.flatmate_age, true)` (trims, lets an empty slot pass, rejects "2x", "17", "100") → `listings.errors.range`
    on `flatmate_ages` (one error for the group; the slot that carries the id is the first invalid one). No new
    `FieldError` kind.
  - `toListingIn`: always sends the four fields so `ListingInBody` is satisfied. For an apartment the **defaults**
    (`'any'`, `null`, `[]`, `{}`; `0007a` §API: an apartment has exactly the defaults, so a POST of them is fine);
    for a room `gender_preference`, `flatmates_count`, the first `count` slots that are non-empty after trim as
    `Number(slot.trim())`, **sorted numerically** (`(a, b) => a - b`, never the default sort), and the `lifestyle`
    object built by iterating `LIFESTYLE_KEYS` and keeping the answered keys.
  - `formFromListing`: `flatmate_ages: [...listing.flatmate_ages].sort((a, b) => a - b).map(String)` (a copy: the
    array is the TanStack cache object), `lifestyle: { ...listing.lifestyle }` (the generated `{ [key: string]: 1 |
    2 | 3 }` and `LifestyleAnswers` are assignable both ways: no type guard, no cast).
  - `changedFields`: **an apartment never sends room fields** (the API resets them on room → apartment, and a
    `null` `flatmates_count` is a 422 on PATCH): when `body.listing_type === 'apartment'` the four room keys are
    skipped (on an apartment that stays an apartment they are equal anyway). For a room: `flatmate_ages` compared
    as sorted **copies** (`[...x].sort((a, b) => a - b)`, never in place: `listing` is the cache object) and
    `lifestyle` **by entries** (same keys, same values); `===` on them compiles and `patch as ListingPatch` hides
    it, so only AC9 guards this. Scalars as today. Doc comment: "an apartment never sends room fields: the API
    resets them on the switch".
- `web/src/features/listings/PreferencesStep.tsx` (from `0006e`): below the minimum-contract select, when the type
  is a room, renders `<RoomFields>`; the `<h2>` reads `listings.prefs.titleRoom` instead of `listings.prefs.title`
  for a room.
- `web/src/features/listings/RoomFields.tsx` (new): the block (UI below). Props: `form`, `onChange`, `errors`,
  `fieldId`.
- `web/src/features/listings/RoomPreview.tsx` (new): read-only chips for the preview, from `body` (`ListingInBody`);
  `PreviewStep.tsx` renders it under the card, before `OwnerPreferences`, when `body.listing_type === 'room'`. The
  public listing page's room facts are `0007f`'s; this component is the wizard's own and is not shared with it.
- `web/src/features/listings/ListingWizard.tsx`: `PREFERENCE_FIELDS = ['accepted_households',
  'min_contract_months', 'flatmates_count', 'flatmate_ages']`; `onSaveError` goes to step 3 when `first` is in it
  (replaces `0006e`'s two-name test); `update()` keeps re-checking through `validatePreferences` as in `0006e`.
  Nothing else changes: back is `step − 1`, edit opens at 2.
- `web/src/locales/he.json`: `listings.prefs.titleRoom`, `listings.room.*`, `listings.roomPreview.*` (UI). The
  preference labels `rooms.genderPreference.*` and `lifestyle.*` come from `0007d`; this spec adds none of them.
- Test harness: `web/src/features/listings/__tests__/wizard.tsx` gains `chooseTypeAndContinue(label)`
  (`chooseApartmentAndContinue` calls it) and exports `toPreferences(client, type)`.
- Fixtures: none. `0007a` adds the four defaults to `listing()`; `publicListing()` must **not** gain them (it is a
  `ListingPublic` literal and `0007a` leaves that type untouched; `0007b` adds the fields).

**Out:**
- The "my listings" card: it shows no flatmates count. `ListingCard` is also the search result card, which `0007f`
  reworks for rooms; a chip here would collide with it, and the count is one tap away in the edit form.
- Room facts and the flat's lifestyle on the public listing page, the search card and the type filter: `0007f`.
  Applicants' answers in the inbox: `0007c` (`specs/0007c-room-inbox.md`). Seeker side and `/me/profile`: `0007d`.
- A separate room-only step, room-specific wording of the household / smoking controls (they apply as in `0006e`).
- Changes to `ChoiceGroup`, `Switch` or `LifestyleFields` (the gender control is a plain `ChoiceGroup`; the count a
  `<select>`; the ages native inputs).

**New dependencies:** none.

## Data
None (web only). Mirrors `0007a`: `gender_preference` any|women|men, `flatmates_count` 1–7 required for rooms,
`flatmate_ages` 18–99 each, at most `flatmates_count` of them, `lifestyle` an object of `LIFESTYLE_KEYS` → 1|2|3.

## API
Uses `POST /listings`, `PATCH /listings/{id}`, `GET /listings/{id}`, `GET /me/listings` with the four fields of
`0007a`. Auth unchanged: `current_owner`, own listing (`0002a` / `0002e`). A 422 naming `flatmates_count` or
`flatmate_ages` (`loc: ["body", name]`) returns to step 3 with `listings.errors.invalid`. A legacy room
(`flatmates_count` null) is rejected by the API on an edit that does not send one, so the wizard blocks it first
(pause / resume send `{status}` only and are unaffected). On room → apartment the PATCH is `{listing_type:
"apartment"}` and `0007a` resets the room fields server-side. `make client` before building.

## UI
Mobile first at 390 px, logical properties only, RTL inherited (the ages grid and the chips flow from the inline
start, the first slot at the right; digits joined by ", " in an RTL paragraph read in order, so they need no
isolation).

**Room block** (`RoomFields`), one `<section aria-labelledby={h3 id}>` with `<h3>` `listings.room.title` ("על החדר
והשותפים") holding items 1–4; the lifestyle fields sit inside it, so they take `headingLevel={4}` (0007d's optional
prop, default 3) and the headings do not clash:
1. `gender_preference` — `ChoiceGroup` (`name="gender_preference"`), legend `listings.room.genderPreference` ("מי
   יכול/ה לגור בחדר?"), options in `GENDER_PREFERENCES` order labelled `rooms.genderPreference.women|men|any`
   ("נשים", "גברים", "לא משנה"); the segmented buttons are 44 px; no error state (always valid). Below it a `<p
   className="text-sm text-muted">` `listings.room.genderHint` ("חדר לנשים בלבד או לגברים בלבד לא יוצג למחפשים שלא
   מתאימים לו").
2. `flatmates_count` — `<select>` with DetailsStep's `a11y(name, true)` / `errorText` pattern (`aria-describedby` =
   hint id plus error id; copy that helper into `RoomFields`, `PreferencesStep`'s has no hint), id
   `fieldId('flatmates_count')`, label `listings.room.flatmatesCount` ("כמה שותפים כבר גרים בדירה?"), hint
   `listings.room.flatmatesHint` ("לא כולל מי שייכנס לחדר"), a first option `listings.fields.choose` ("בחירה…",
   value `''`) then 1 … 7 as digits; empty on "next" → `listings.errors.required` in a `role="alert"`. The control
   converts (`String(count ?? '')`, back through a lookup over 1…7, no cast).
3. `flatmate_ages` — rendered only when a count is chosen: `<fieldset aria-invalid aria-describedby>` (hint id plus
   error id) + `<legend>` `listings.room.ages` ("גילאי השותפים (לא חובה)"), a hint `listings.room.agesHint` ("אפשר
   למלא רק חלק מהגילאים"), and `count` slots in `grid grid-cols-3 gap-2`; each slot is a visible `<label>`
   `listings.room.ageOf` ("שותף/ה {{n}}") plus `<input type="text" inputMode="numeric">` with `min-h-[48px]`; an
   out-of-range slot carries `aria-invalid="true"`; the error `listings.errors.range` (18, 99) in a `role="alert"`
   after the grid. Ids: the target slot (first invalid, else the first) carries `fieldId('flatmate_ages')`, the
   others `${fieldId('flatmate_ages')}-${i}` (the households pattern, no collision when the target moves). A slot
   write is `Array.from({ length: Math.max(ages.length, i + 1) }, (_, j) => (j === i ? value : (ages[j] ?? '')))`
   (no sparse arrays).
4. `lifestyle` — `<LifestyleFields perspective="flat" headingLevel={4} value={form.lifestyle} onChange={…} />` from
   `features/lifestyle`; per `0007d` it renders its own `<section>` with the `lifestyle.title.flat` heading (an `<h4>` here), the nudge
   `lifestyle.nudge` and one optional `ChoiceGroup` per key with a per-question "ניקוי"; `RoomFields` adds no
   lifestyle heading; unanswered keys are simply absent from the object.

Switching the type to apartment (step 1, also in edit mode) hides the whole block and `RoomPreview`; the values stay
in the form (going back to "room" restores them) but the body carries the defaults, so nothing stale is sent.

**Preview** (`RoomPreview`), `<ul aria-label={t('listings.room.title')}>` of chips in the same style as
`OwnerPreferences`, only for rooms: `listings.roomPreview.for` ("מתאים ל: {{who}}", `who` from
`rooms.genderPreference.*`) **only when `gender_preference` is not `any`**; `listings.roomPreview.flatmates`
("{{count}} שותפים בדירה") or `listings.roomPreview.flatmatesAges` ("{{count}} שותפים בדירה ({{ages}})", `ages` the
sorted ages joined with ", " in plain `t()`) when ages were given; `listings.roomPreview.lifestyle` ("שאלון הדירה:
נענו {{count}} מתוך {{total}}") when at least one key is answered. Count 1 reads `listings.roomPreview.flatmatesOne`
("שותף/ה אחד/ת בדירה"; with an age: `listings.roomPreview.flatmatesOneAge`, "שותף/ה אחד/ת בדירה ({{age}})").

States: no async state of its own (the step is local form state). Loading: the wizard's areas select as today.
Empty: no count chosen → no age slots; no answers → no lifestyle chip; `any` → no gender chip. Error: the inline
errors above, and a publish / save 422 on a room field returns to step 3 (AC5). Success: unchanged (navigate to
`/me/listings`).

**i18n keys added** (`he.json`, gender-neutral):
`listings.prefs.titleRoom` "למי החדר מתאים?"; `listings.room.title` "על החדר והשותפים";
`listings.room.genderPreference` "מי יכול/ה לגור בחדר?"; `listings.room.genderHint` "חדר לנשים בלבד או לגברים בלבד
לא יוצג למחפשים שלא מתאימים לו"; `listings.room.flatmatesCount` "כמה שותפים כבר גרים בדירה?";
`listings.room.flatmatesHint` "לא כולל מי שייכנס לחדר"; `listings.room.ages` "גילאי השותפים (לא חובה)";
`listings.room.agesHint` "אפשר למלא רק חלק מהגילאים"; `listings.room.ageOf` "שותף/ה {{n}}";
`listings.roomPreview.for` "מתאים ל: {{who}}"; `listings.roomPreview.flatmates` "{{count}} שותפים בדירה";
`listings.roomPreview.flatmatesAges` "{{count}} שותפים בדירה ({{ages}})";
`listings.roomPreview.flatmatesOne` "שותף/ה אחד/ת בדירה"; `listings.roomPreview.flatmatesOneAge` "שותף/ה אחד/ת
בדירה ({{age}})"; `listings.roomPreview.lifestyle` "שאלון הדירה: נענו {{count}} מתוך {{total}}".
Labels go through static maps / literal keys (`i18n-check` only verifies string-literal keys).

## Acceptance criteria
Vitest + Testing Library with the existing wizard harness (`features/listings/__tests__/wizard.tsx`, `fixtures.ts`);
AC1–AC5 in the new `web/src/features/listings/__tests__/RoomFields.test.tsx`, AC6–AC8 in `EditListingPage.test.tsx`
(as `0006e` put its edit test there), AC9 in `validate.test.ts`.
- [ ] AC1 Given the wizard with type "דירה שלמה", Then step 3 has no `listings.room.title` region and the published body carries `gender_preference: "any"`, `flatmates_count: null`, `flatmate_ages: []`, `lifestyle: {}`; Given type "חדר בדירת שותפים", Then step 3 shows the `<h2>` `listings.prefs.titleRoom` and, after the minimum-contract select, the region `listings.room.title` with the gender radios in the order נשים, גברים, לא משנה ("לא משנה" checked) and the count select, and, inside it, the region `lifestyle.title.flat` as an `<h4>` (`perspective="flat"`) — `RoomFields.test.tsx::ac1_room_block_only_for_rooms`
- [ ] AC2 Given a room, step 3, When "next" with no count chosen, Then no step change, `listings.errors.required` in a `role="alert"` on the count select (`aria-invalid`, `aria-describedby` naming hint and error), focus on it; choosing a count removes it; the age slots appear, exactly as many as the count (3 → 3 slots); typing into slot 3 first leaves no sparse array; lowering the count to 2 hides the third slot, raising it again shows the third slot with its typed age — `RoomFields.test.tsx::ac2_count_required_and_age_slots`
- [ ] AC3 Given a room with count 3, When an age slot holds "17" (or "100", or "2x") and "next" is pressed, Then `listings.errors.range` (18, 99) in a `role="alert"` on the ages fieldset (`aria-invalid`), that slot `aria-invalid`, focus on the first invalid slot; empty slots are valid; correcting it removes the error — `RoomFields.test.tsx::ac3_ages_validated`
- [ ] AC4 Given a complete room (details filled), When the owner picks "נשים", count 2, ages "30" then "27", answers the first lifestyle question "3", and publishes, Then within `screen.getByRole('list', { name: he.listings.room.title })` the preview shows the chips "מתאים ל: נשים", "2 שותפים בדירה (27, 30)", "שאלון הדירה: נענו 1 מתוך 7", and exactly one `POST /listings` has `gender_preference: "women"`, `flatmates_count: 2`, `flatmate_ages: [27, 30]`, `lifestyle: {cleanliness: 3}` (the key of the first question); with ages left empty the chip is "2 שותפים בדירה" and `flatmate_ages: []`; with "לא משנה" there is no `מתאים ל` chip — `RoomFields.test.tsx::ac4_room_fields_previewed_and_sent`
- [ ] AC5 Given a publish answering 422 `detail: [{loc: ["body","flatmates_count"], …}]` (and likewise `flatmate_ages`), Then the wizard returns to step 3 with `listings.errors.invalid` on that control and focus there — `RoomFields.test.tsx::ac5_server_error_returns_to_step_3`
- [ ] AC6 Given the edit page for a room listing with `gender_preference "men"`, `flatmates_count 2`, `flatmate_ages [30, 27]` (any order), `lifestyle {guests: 2, night: 1}`, Then step 3 opens with "גברים" checked, count 2, the slots "27" and "30" (sorted) and the two answers set; untouched, `beforeunload` is not prevented and next → next → save sends no PATCH (the URL is `/me/listings`, no `listings.edit.saved`); When only the gender is changed to "לא משנה" and saved, Then exactly one `PATCH` with body `{gender_preference: "any"}`; when only one age is changed (27 → 28), Then `{flatmate_ages: [28, 30]}`; when only one lifestyle answer is changed, Then `{lifestyle: {guests: 3, night: 1}}` (whole object) — `web/src/features/listings/__tests__/EditListingPage.test.tsx::ac6_room_patch_only_changes`
- [ ] AC7 Given the edit page for a legacy room (`flatmates_count: null`, everything else default), When the owner changes the price and goes next → next, Then step 3 refuses with `listings.errors.required` on the count and nothing is sent; after choosing 2 and saving, one `PATCH` `{price_ils, flatmates_count: 2}`; a legacy room left untouched reports `dirty` false — `EditListingPage.test.tsx::ac7_legacy_room_needs_count`
- [ ] AC8 Given the edit page for a room with room fields set, When the owner goes back to step 1, picks "דירה שלמה" and saves, Then step 3 shows no room block, the preview no room chips, and exactly one `PATCH` with body `{listing_type: "apartment"}` (no room key: the API resets them); Given an apartment edited into a room, Then the same flow requires the count and the PATCH carries `listing_type: "room"` and the chosen room fields — `EditListingPage.test.tsx::ac8_switching_type_hides_and_resets`
- [ ] AC9 `toListingIn` sorts ages numerically (`["30", "27"]` → `[27, 30]`; `["100", "27"]` → `[27, 100]`, not the lexicographic order), drops empty slots and slots beyond the count, trims, sends only answered lifestyle keys in key order, and sends the apartment defaults for an apartment; `formFromListing` → `toListingIn` round-trips the four fields and does not reorder `listing.flatmate_ages` in place; `changedFields` reports `flatmate_ages` only when the sorted lists differ (`[30,27]` vs `[27,30]` → no change) and `lifestyle` only when the entries differ (key order irrelevant); a room form switched to `apartment` diffs to `{listing_type: 'apartment'}` with no room key; `validatePreferences` requires the count and the age range for rooms only — `web/src/features/listings/__tests__/validate.test.ts::ac9_room_helpers`
- [ ] AC10 Given `make dev` is up, When `ac12_owner_edits_listing` (the same owner, who holds one live listing so the cap of 3 has room) is extended with `test.step('ac13 owner creates a room listing', …)` after its edit assertions: walks type "חדר בדירת שותפים" → details with a fresh unique street → step 3: picks "נשים", count 2, ages 27 and 30 (labels from `he.listings.room.ageOf.replace('{{n}}', '1')`), answers one lifestyle question → the preview shows "מתאים ל: נשים" → publishes inside `page.waitForResponse` (POST `/listings`, 201), Then `GET /me/listings` through `page.request` returns the item with that `id` having `gender_preference: "women"`, `flatmates_count: 2`, `flatmate_ages: [27, 30]` and the answered key — `web/e2e/listings.spec.ts::ac12_owner_edits_listing` (extended; no new signup: the suite already uses 9 of the 10 OTP requests per 15 minutes; `make e2e` run locally on the final head and reported in the digest, CLAUDE.md rule 7)
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` clean; `make e2e` run locally on the final head and its result reported in the digest (CLAUDE.md rule 7, 2026-11-11); every existing test named in Tests to write updated in the same change — CI `web`
- [ ] NF2 Accessibility at 390 px: the room block is a named region; the gender group, the ages and the lifestyle questions are `fieldset` + `legend`; the count and each age slot have visible labels; targets ≥ 44 px (slots 48 px); logical properties only; errors are `role="alert"` linked with `aria-describedby`; the step `<h2>` and the gender legend differ; no new same-named buttons — ux reviewer

## Tests to write
New: `RoomFields.test.tsx` `ac1`…`ac5`; in `EditListingPage.test.tsx` `ac6`…`ac8`; in `validate.test.ts` `ac9`;
the room `test.step` in `web/e2e/listings.spec.ts::ac12_owner_edits_listing` (AC10); `wizard.tsx` helpers as in Scope.
Existing, amended (all certain: `0007a` omits the fields, it does not touch `toListingIn`):
- `validate.test.ts:138` `ac8_body_is_trimmed_and_typed`: the exact `toEqual` gains `gender_preference: 'any',
  flatmates_count: null, flatmate_ages: [], lifestyle: {}`.
- `ListingWizard.test.tsx:68` `expectedBody` gains the same four (this also covers the `listing({...expectedBody})`
  at `:129` and `ac3_chosen_preferences_sent`'s `...expectedBody` at `:458`, with no further edit).
- `validate.test.ts:280` `ac11_form_from_listing_and_changed_fields`: no edit, but it is the regression guard (its
  `stored` list includes a legacy room, and `===` on `[]` / `{}` would fail it).
- The `0006e` step tests (`toPreview()`, `changePriceAndSave()`) do not change: no step is added and an apartment's
  step 3 is untouched. `ac9_owner_creates_and_pauses_listing` is unchanged; `ac12`'s exact PATCH body `{price_ils,
  arnona_ils}` also proves end to end that the default room fields cause no false diff on an apartment.

## Risks / open questions
- Copy is the orchestrator's; the artboard has no room fields. Gilad can amend wording in the digest (including the
  `listings.room.genderHint` line, which tells the owner a gendered room is hidden from misfit seekers; the seeker
  twin is `profile.room.genderNote` in `0007d`).
- Decided by the orchestrator: (1) `toListingIn` always sends the four fields (apartment defaults), and
  `changedFields` never sends them for an apartment; (2) `LifestyleFields` renders its own heading, nudge and
  per-question clear, and takes `headingLevel={4}` inside the room `<h3>` section (0007d's prop); (3) the households and no-smokers controls stay as
  `0006e` has them, for rooms too (revisit with real owner feedback).
- Which step: step 3 (this spec) versus the end of details; decided: step 3, reasons in Scope.
- No open product questions.

## Verifier findings — one round, 17 findings, all applied
Verdict: **reject** (stays `draft`). 17 findings: 1 blocker, 4 major, 12 minor. No split needed, because the
scope fits one coder run. Checked against `main` (`d917d05`) and the 0006e worktree `../rent-app-0006e`
(`88c91ba` plus uncommitted `validate.ts`, `ListingWizard.tsx`, `PreferencesStep.tsx`, `api.ts`). Two facts differ
from the brief. First, 0006e is `in-progress` in that worktree, not "verified, not built". Second, 0006f is already
merged (`1308156`). It touched only `ListingPage.tsx` and `he.json` under `features/listings`, so it does not
collide with this spec. Every `:line` below for a 0006e file refers to the worktree.

**The orchestrator's decisions are applied as decided:**
- (1) Option (a). `toListingIn` always sends the four fields, and the apartment defaults for an apartment.
  0007a §API says "An `apartment` has exactly the defaults", so a POST of the defaults is fine. For the PATCH, see
  finding 1.
- (2) `LifestyleFields` renders its own `lifestyle.title.flat` `<h3>`, the nudge and the per-question "ניקוי".
  `RoomFields` adds no lifestyle heading (see finding 12 for the nesting).
- (3) Option (a). The households and no-smokers controls stay as in 0006e.

**Checked against 0007a, no change needed:**
- *Lowering the count:* the diff sends both fields whenever both changed. For example, stored `3, [27,30,35]`
  edited to count 2 gives `{flatmates_count: 2, flatmate_ages: [27, 30]}`. When the kept ages still fit, only the
  count goes.
- *Age rules:* the UI renders exactly `count` slots, and `toListingIn` takes only slots `0…count−1`. So the
  "at most count" rule and 18–99 can never be a 422 from a form that passes.
- *Legacy room:* the step-3 rule blocks an edit with a null count (AC7). Pause and resume still work, because
  `MyListingsPage.tsx:44` sends `{ status: next }` only, which is 0007a's `status_only` path.
- *Diff:* the array and object diff is right as specified, apart from findings 1 and 8.

1. **blocker — Switching a room to an apartment in edit sends `flatmates_count: null`, which is a 422.**
   - `changedFields` (`validate.ts:324-335`) sends every key whose value differs. For a stored room with
     count 2, `toListingIn` of the apartment gives `flatmates_count: null`, so the PATCH carries `null`.
   - 0007a keeps the four fields out of `NULLABLE_FIELDS` (`api/app/schemas/listing.py:86-88`). The null rule at
     `:174-177` therefore raises "may not be null", and 0007a AC3 lists "`null` for each of the four fields →
     422".
   - That error is model-level (`loc: ["body"]`), so the wizard shows only `PreviewStep`'s generic error. AC8 as
     written asserts the failing body.

   **Fix:**
   - In `changedFields`, skip the four room keys when `body.listing_type === 'apartment'`. The server resets them
     on room → apartment (0007a `_merged` / `update_listing`). On an apartment that stays an apartment they are
     equal anyway.
   - Doc comment: "an apartment never sends room fields: the API resets them on the switch".
   - AC8's body becomes exactly `{listing_type: "apartment"}`.
   - AC9 adds: "a room form switched to `apartment` diffs to `{listing_type: 'apartment'}` with no room key".

2. **major — `ListingInBody` does not "keep `Required<…>`" by itself.**
   - 0007a's web edit (its Scope, "Web (types only)") adds `'gender_preference' | 'flatmates_count' |
     'flatmate_ages' | 'lifestyle'` to the `Omit` list. Today `api.ts:18` on the 0006e branch reads
     `Required<Omit<ListingIn, 'rooms'>> & { rooms: number }`, and whichever of the two merges second keeps both
     edits.
   - With the four keys still omitted, `toListingIn`'s four new keys are excess properties, so `tsc` fails.

   **Fix,** Scope `api.ts` bullet: "`ListingInBody` goes back to `Required<Omit<ListingIn, 'rooms'>> & { rooms:
   number }`. This removes 0007a's temporary `Omit` of the four room fields, as 0006e did for its three."

3. **major — The fixture and test homework is wrong in two places.**
   - (a) **`publicListing()` must not gain the room fields.** `search/__tests__/fixtures.ts:8` returns a
     `ListingPublic` literal. 0007a leaves `ListingPublic` untouched (its Scope: "`publicListing()` is
     unchanged"), and only 0007b, which this spec does not depend on, adds the fields. Adding them here is a
     `tsc` excess-property error.
     **Fix:**
     - Strike `publicListing()` from Scope "Fixtures" and from Tests to write.
     - `listing()` already carries the four defaults from 0007a, so the line reads "Fixtures: none; 0007a adds
       the defaults to `listing()`".
   - (b) **"Only if 0007a did not already do it" is false for the body tests.** 0007a omits the fields instead of
     touching `toListingIn`. So these amendments are certain:
     - `validate.test.ts:138` `ac8_body_is_trimmed_and_typed`: the exact `toEqual` gains `gender_preference: 'any',
       flatmates_count: null, flatmate_ages: [], lifestyle: {}`.
     - `ListingWizard.test.tsx:68` `expectedBody` gains the same four. This also covers `:129`'s
       `listing({...expectedBody})` and `ac3_chosen_preferences_sent`'s `...expectedBody` at `:458`, with no
       further edit.
     - `validate.test.ts:280` `ac11_form_from_listing_and_changed_fields` needs no edit, but it is the regression
       guard. Its `stored` list includes a legacy room (`:299`), and `===` on `[]` / `{}` would make it fail.

     **Fix:** drop "(only if `0007a` did not already do it)" and list these three.

4. **major — AC10 adds an e2e signup the OTP budget cannot hold, and its "run by CI" is stale.**
   - The suite on `main` signs up 9 times: auth 1, applications 2, inbox 2, listings 2, search 1, map 1. The limit
     is `OTP_RATE_LIMIT_IP = 10` (`api/app/services/auth.py:39`) per 15 min.
   - 0005b, 0006d, 0006f (finding 7), 0007d, 0007f and 0007c (which now holds the former 0007g) all add **no**
     signup for this reason. One more signup leaves zero headroom for a retry. Local runs make this worse: every
     run spends the budget, and a second run inside the same 15 minutes gets a 429.
   - The current CLAUDE.md Speed rule 7 (`d917d05`) says e2e runs **locally**: every web spec runs `make e2e` on
     its final head and reports the result in its digest, because CI e2e is off (`E2E_IN_CI=off`). AC10's
     "written and type-checked; run by CI" contradicts this rule.

   **Fix:**
   - No new `test()`. Extend `web/e2e/listings.spec.ts:102` `ac12_owner_edits_listing` with
     `test.step('ac13 owner creates a room listing', …)` after its edit assertions. The same owner holds one live
     listing, so the cap (3) has room.
   - The step walks type "חדר בדירת שותפים" → details with a fresh unique street → step 3: "נשים", count 2, ages
     27 and 30, one lifestyle answer → the preview chip → publish inside `page.waitForResponse` (POST, 201). Then
     it reads `GET /me/listings` through `page.request` and finds the item by `id`.
   - Use the `he` catalogue for labels: `he.listings.room.ageOf.replace('{{n}}', '1')`.
   - AC10 names `listings.spec.ts::ac12_owner_edits_listing` (extended).
   - AC10 and NF1 say "`make e2e` run locally on the final head and reported in the digest (CLAUDE.md rule 7,
     2026-11-11)".

5. **major — The `<bdi>` per age breaks AC4 and cannot be written with `t()`.**
   - "Each wrapped in `<bdi>`" needs `<Trans>` or a hand-split string, because `listings.roomPreview.flatmatesAges`
     interpolates `{{ages}}` as one string.
   - With child `<bdi>` elements, Testing Library's `getByText('2 שותפים בדירה (27, 30)')` no longer matches. It
     compares an element's own text nodes only, so AC4's literal chip fails.
   - Isolation is not needed. In an RTL paragraph, digits joined by ", " resolve as R for the neutrals (UAX #9,
     N1), so the chip reads 27, 30 in order.

   **Fix:** drop "each wrapped in `<bdi>`" and use `ages: sorted.join(', ')` in plain `t()`. The RTL note becomes
   "the digits need no isolation".

6. **minor — The gender option order contradicts itself.**
   - Scope defines `GENDER_PREFERENCES = ['any', 'women', 'men']`.
   - UI item 1 says "options in `GENDER_PREFERENCES` order labelled … ("נשים", "גברים", "לא משנה")".
   - 0007d's profile group uses women, men, any.

   **Fix:** `GENDER_PREFERENCES: readonly GenderPreference[] = ['women', 'men', 'any']` with the comment "display
   order" (like `HOUSEHOLDS`, `constants.ts:7-8`). AC1 also asserts the order of the three radios.

7. **minor — `lifestyle` needs no type guard.**
   - The generated `{ [key: string]: 1 | 2 | 3 }` (0007a) and 0007d's `LifestyleAnswers =
     Partial<Record<LifestyleKey, 1 | 2 | 3>>` are assignable both ways. This was checked with the repo's tsc 5.9.3,
     `--strict --noUncheckedIndexedAccess`.

   **Fix:**
   - `formFromListing`: `lifestyle: { ...listing.lifestyle }` (a copy, no guard, no cast).
   - `toListingIn`: build the object by iterating `LIFESTYLE_KEYS` and keeping defined answers. Strike "through a
     small type guard if the generated type is wider".

8. **minor — The age order on load and the in-place sort.**
   - AC6 expects the slots "27" and "30" in sorted order, but Scope's `formFromListing` only says "to strings".
   - `changedFields`' "sorted arrays" must not sort `listing.flatmate_ages` in place. That array is `base`
     (`ListingWizard.tsx:137`), the TanStack cache object.

   **Fix:**
   - `formFromListing`: `flatmate_ages: [...listing.flatmate_ages].sort((a, b) => a - b).map(String)`.
   - `changedFields`: compare `[...x].sort((a, b) => a - b)` copies.
   - `toListingIn`: sort numerically, never with the default lexicographic sort.

9. **minor — Slot writes leave holes, and the age range has a ready helper.**
   - `next[i] = value` on a shorter array (typing into slot 3 first) creates a sparse array. `validatePreferences`
     and `toListingIn` then read `undefined`.

   **Fix:**
   - `RoomFields` writes with `Array.from({ length: Math.max(ages.length, i + 1) }, (_, j) => (j === i ? value :
     ages[j] ?? ''))`.
   - Readers use `ages[i] ?? ''`.
   - The age check is the existing `integer(slot, LIMITS.flatmate_age, true)` (`validate.ts:164-176`). It trims,
     lets an empty slot pass and rejects "2x", "17" and "100" with `listings.errors.range`.
   - Put `flatmate_age: { min: 18, max: 99 }` and `flatmates_count: { min: 1, max: 7 }` in `LIMITS`
     (`validate.ts:107`) instead of `AGE_RANGE` / `FLATMATES_MAX` in `constants.ts`.
   - `toListingIn` sends `Number(slot.trim())` for the trimmed non-empty slots.

10. **minor — The step heading and the gender legend have identical text.**
    - `listings.prefs.titleRoom` and `listings.room.genderPreference` are both "למי החדר מתאים?". A screen reader
      hears the question twice, and `getByText` finds two elements.

    **Fix:** keep the `<h2>` and make the legend "מי יכול/ה לגור בחדר?".

11. **minor — The "מתאים ל: לא משנה" chip reads wrong.**
    - With the default `any`, the `for` chip renders "מתאים ל: לא משנה".

    **Fix:**
    - Render no `for` chip when `gender_preference === 'any'`, as `OwnerPreferences` shows no chip for defaults
      (`OwnerPreferences.tsx:39-56`).
    - AC4's ages-empty variant adds "with 'לא משנה' there is no `מתאים ל` chip".

12. **minor — The headings nest.**
    - `RoomFields` is a `<section>` with an `<h3>`, and inside it sits `LifestyleFields`' own `<section>` with an
      `<h3>` (0007d). That makes two same-level headings, one inside the other's region.

    **Fix:**
    - `RoomFields` returns a fragment: the room `<section>` (gender, count, ages), then `<LifestyleFields
      perspective="flat" …>` as its sibling. Both `<h3>`s then sit under the step's `<h2>`.
    - AC1 reads "the region `listings.room.title` with the gender group and the count select, followed by the
      region `lifestyle.title.flat`".

13. **minor — The a11y wiring is not specified exactly.**
    - Count `<select>`: use DetailsStep's `a11y(name, true)` with `hintId` (`DetailsStep.tsx:63-73`).
      PreferencesStep's `a11y` has no hint (`PreferencesStep.tsx:34-38`). So `aria-describedby` is the hint's id
      plus the error's id.
    - Ages fieldset: `aria-describedby` is the `agesHint` id plus the error id.
    - Slot ids: the target slot gets `fieldId('flatmate_ages')`, and the others get
      `${fieldId('flatmate_ages')}-${i}`. This is the households pattern (`PreferencesStep.tsx:75`), so no two
      ids collide when the target moves.
    - Each out-of-range slot also carries `aria-invalid="true"`.
    - Inputs are `type="text" inputMode="numeric"` (0007d's birth year).

14. **minor — `RoomPreview` has no accessible name.**
    - It is a bare `<ul>` next to the card's chips, so AC4 cannot scope it (0006e's ac3 scopes by
      `getByRole('article')` / region).

    **Fix:** `<ul aria-label={t('listings.room.title')}>`. AC4 reads
    `within(screen.getByRole('list', { name: he.listings.room.title }))`.

15. **minor — The new test files cannot reach the harness they need.**
    - `toPreferences` / `toPreview` are local to `ListingWizard.test.tsx:38-55`.
    - `openEdit`, `stored` and `saveButton` are local to `EditListingPage.test.tsx:36-98`.
    - `chooseApartmentAndContinue` (`wizard.tsx:30`) only picks an apartment.

    **Fix:**
    - Put AC6–AC8 in `EditListingPage.test.tsx`, as 0006e put `ac6_preferences_patch_only_changes` there.
    - Put AC9 in `validate.test.ts`, which reuses `valid`.
    - Add `chooseTypeAndContinue(label)` to `wizard.tsx`, with `chooseApartmentAndContinue` calling it, and export
      `toPreferences(client, type)` from there.
    - Rename the ACs' test paths to match. `RoomFields.test.tsx` (AC1–AC5) may stay.

16. **minor — Risks and API still read as open.**
    - Rewrite Risks to record the three decisions above as decided by the orchestrator.
    - Delete the conditional branches: "if it renders no heading…" and "if it would 422 them…".
    - API: add "Auth unchanged: `current_owner`, own listing (`0002a`/`0002e`)" (checklist 4).

17. **minor (copy, Gilad may strike) — Owners are not told the consequence of choosing a gender.**
    - PRODUCT.md "Rooms" says a misfit room is hidden from that seeker, but the owner who picks "נשים" is not told.

    **Fix:** a `<p className="text-sm text-muted">` after the gender group: `listings.room.genderHint`, "חדר לנשים
    בלבד או לגברים בלבד לא יוצג למחפשים שלא מתאימים לו". It goes in the i18n list. 0007d has the seeker-side
    twin, `profile.room.genderNote`.

## Digest (filled by orchestrator after verification)

    Spec 0007e - Room fields in the listing wizard (web)   (verified, Slice 7 part 5 of 6, depends on 0007a, 0007d, 0006e)
    What a user can do after this: an owner posting or editing a room says who it is for (נשים / גברים /
             לא משנה), how many flatmates live there, optionally their ages, and the flat's lifestyle answers,
             in the "העדפות" step; the preview shows them; an edit sends only what changed.
    Decisions I need from you: none new. Copy is mine (incl. the hint that a gendered room is hidden from misfit seekers).
    KPIs this slice moves: share of room listings with the questionnaire answered.
    Acceptance targets: NF1 lint/test/i18n/build clean + make e2e green locally - NF2 named region,
             fieldset + legend, visible labels, 44 px targets.
    Risks: switching a room back to an apartment - mitigation: the edit sends only {listing_type: "apartment"}
             and the API resets the room fields (verifier blocker, fixed). A legacy room must fill its flatmates
             count before an edit saves; pause/resume still works.
    Reviewers: code, qa, ux   Estimated: 1 coder run, 1 review round
    Links: specs/0007e-room-listing-web.md - PRODUCT.md "Rooms", "Listing edit" - design/screens-v1/CreateListing.dc.html
