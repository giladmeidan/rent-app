---
id: 0007d
title: A seeker looking for a room switches on "חיפוש חדר" in /me/profile and fills gender, birth year, flatmates preference and the lifestyle questionnaire
status: verified
depends_on: [0007a]      # GET/PUT /me/profile carry gender, birth_year, flatmate_gender, lifestyle; `make client` before building
reviewers: [code, qa, ux, security]   # security: collects gender and birth year, writes the privacy copy, adds the ?section=room entry point (a Sonnet pass over the copy, links.ts and the entry point is enough); ux: a new revealed form section and the shared questionnaire UI that 0007e/f/c reuse; qa: the switch-off-clears and the entry point
estimate: 1 coder run
---

## Goal
After this ships, `/me/profile` has a "מחפש/ת חדר בדירת שותפים" switch. On, it reveals the room section: own gender
(אישה / גבר / אחר, required), an optional birth year, an optional flatmates preference (נשים / גברים / לא משנה,
default לא משנה) and the 7-question lifestyle questionnaire (optional, with a nudge); a privacy line says who sees
it. Off, the section is cleared on save. `/me/profile?section=room&next=…` lands on the section and returns to
`next` after saving (0007f's apply gate). The spec also creates the shared `web/src/features/lifestyle/` module
(keys, "אני…" / "בדירה…" labels, one fields component, a compare helper) that 0007e/f/c reuse. Serves Dev Plan
slice 7, part d of seven (overview in `0007a`); PRODUCT.md rows "Rooms", "Gender preference", "Matching".
No artboard covers this section (`design/screens-v1/` has none): it reuses the profile form's anatomy.

## Scope
**In:**
- `web/src/features/lifestyle/` (new, no barrel file; importers use the file paths below):
  - `keys.ts`: `LIFESTYLE_KEYS` (`readonly ['cleanliness','guests','night','social','kosher','shabbat','work_from_home']`,
    the contract's order, `as const`), `type LifestyleKey = (typeof LIFESTYLE_KEYS)[number]`, `type LifestyleAnswer =
    1 | 2 | 3`, `type LifestyleAnswers = Partial<Record<LifestyleKey, LifestyleAnswer>>` (only answered keys are
    present), `compareLifestyle(a: LifestyleAnswers, b: LifestyleAnswers): { shared: number; same: number;
    differing: LifestyleKey[] }` (keys answered by **both**; `same` = equal answers; `differing` in
    `LIFESTYLE_KEYS` order). Pure; 0007c uses it for the inbox disclosure, 0007f for the reason copy.
  - `LifestyleFields.tsx`: `<LifestyleFields value={LifestyleAnswers} onChange={(next: LifestyleAnswers) => void}
    perspective="seeker" | "flat" />`. Renders a `<section aria-labelledby>` with an `<h3>` (`<h4>` when `headingLevel` is 4) `lifestyle.title.<perspective>`,
    a `<p>` `lifestyle.nudge`, then one existing `ChoiceGroup` per key (`legend` = `lifestyle.<key>.question.<perspective>`,
    `name` = `lifestyle-<key>`, options `lifestyle.<key>.answer.1|2|3`, `value` = the answer or `null`) and, under a
    group that has an answer, a "ניקוי" button (`lifestyle.clear`, `aria-label` `lifestyle.clearAria` with the question)
    that deletes the key (a question can go back to unanswered; `ChoiceGroup` has no clear and is not changed). The button is `<button type="button">` (the component sits inside a `<form onSubmit>`; an untyped button would submit it) and after a clear focus moves to the first radio of that group (`input[name="lifestyle-<key>"]`), since the button unmounts. Optional prop `headingLevel?: 3 | 4` (default 3; 0007e passes 4 inside its own `<h3>` section).
    `onChange` always gets a new object holding only answered keys. Labels are looked up by template key
    (`t(\`lifestyle.${key}.answer.${n}\`)`); `i18n-check` only verifies literal keys, so AC1 checks the catalogue.
- `web/src/features/profile/api.ts`: `export type Gender = NonNullable<SeekerProfileOut['gender']>` and
  `export type FlatmateGender = SeekerProfileOut['flatmate_gender']` (Pydantic inlines the Literals, as `Household`).
- `web/src/features/profile/validate.ts`: `ProfileForm` gains `room: boolean`, `gender: Gender | null`, `birth_year:
  string` (as typed), `flatmate_gender: FlatmateGender`, `lifestyle: LifestyleAnswers`; `emptyProfileForm` all
  off / `null` / `''` / `'any'` / `{}`; `formFromProfile`: `room = profile.gender !== null`, `birth_year =
  String(profile.birth_year ?? '')`; `FIELD_ORDER` gains `'gender'`, `'birth_year'` after `'parking_needed'`
  (`validate()`'s `found` lists both; a 422 naming them already maps through `serverFieldErrors`); with `room` on:
  `gender` null → `listings.errors.required`; `birth_year` non-empty and not digits, or outside
  `birthYearRange()` → `{ key: 'listings.errors.range', min, max }`; with `room` off neither is
  checked. `export function birthYearRange(now: Date = new Date()): { min: number; max: number }`: `max =
  now.getUTCFullYear() − 18`, `min = Number(todayInIsrael(now).slice(0, 4)) − 99`; `validate()` calls
  `birthYearRange()` (its own signature and every existing call stay unchanged); `birth_year` is trimmed like
  `budget` before the digits test and in `toProfileIn` (the API computes the age from the UTC year; near 1 January the Israel year is ahead, so the
  client's bounds are never wider than the API's: no 422 from a form that passes). `toProfileIn`: **room off →
  the four keys are omitted** ("PUT replaces": omitting clears them, so every existing body assertion is
  unchanged); room on → `gender`, `birth_year` (only when non-empty, as a number), `flatmate_gender`, `lifestyle`.
- `web/src/features/profile/ProfilePage.tsx`: the room block after the parking group and before the save button
  (UI). A new `web/src/features/profile/links.ts`: `roomSectionHref(next: string): string` =
  `` `/me/profile?section=room&next=${encodeURIComponent(next)}` `` (0007f cites it for the gate link).
- `web/src/locales/he.json`: `profile.room.*`, `lifestyle.*`, `rooms.genderPreference.*` (UI).
- Fixture `features/profile/__tests__/fixtures.ts` `profile()`: `0007a` already adds `gender: null, birth_year: null, flatmate_gender: 'any', lifestyle: {}`; verify it is present (every other test imports `profile()`).
- Tests (Tests to write); `web/e2e/applications.spec.ts` extended (AC9).

**Out:** the listing wizard's room fields and the flat's questionnaire (0007e); search type filter, room card,
`room_fit` UX and the apply-gate link itself (0007f; this spec only makes the entry point); the inbox applicant card
(0007c, its web part); the match score's `lifestyle` criterion (0007b). No change to `ChoiceGroup`, `Switch` or `safeNext`. No
profile-completeness meter, no confirm dialog on switching off (decided, Q2).

**New dependencies:** none.

## Data
None (web only).

## API
Uses `GET /me/profile` and `PUT /me/profile` with the four fields of `0007a`; no other endpoint. Auth unchanged
(`RequireSeeker`). `make client` first. Room off sends none of the four keys; room on sends all but an empty
`birth_year`.

## UI
Page states are 0006d's, unchanged (profile or areas loading → `Skeleton`; either failing with nothing cached →
`ErrorState` with retry; areas empty → `EmptyState`, no save button; save failed → `ErrorState` retry; saved →
`profile.saved` `role="status"`). The room block has no async state of its own. Mobile first (390 px, `max-w-[480px]`
column), logical properties only, RTL inherited: radios and checkboxes flow from the inline start, the birth-year
input is `text-start` with `dir` inherited (digits stay LTR inside it by the Unicode rules; no `dir` override).

**Room block** (`<section aria-labelledby={h2 id}>`), in this order:
1. `<h2 tabIndex={-1}>` `profile.room.title` ("חדר בדירת שותפים"); `<p>` `profile.room.hint`.
2. `Switch` `profile.room.switch` in the page's `card` wrapper (checked = `form.room`).
3. When on, a `div` with the revealed content (nothing of it is in the DOM when off):
   a. `<p>` `profile.room.privacy` (the privacy line, before any field).
   b. `ChoiceGroup` `profile.room.fields.gender`, `name="gender"`, options `profile.room.gender.woman|man|other`
      (אישה / גבר / אחר), error `listings.errors.required`; under it `<p class="text-sm text-muted">`
      `profile.room.genderNote`.
   c. Birth year: `<label>` `profile.room.fields.birthYear` + `<input type="text" inputMode="numeric" maxLength=4>`
      in DetailsStep/profile `box` styling with `a11y('birth_year')`, `aria-describedby` = the hint's id plus the
      error id when invalid; hint `<p>` `profile.room.birthYearHint`; `errorText('birth_year')`.
   d. `ChoiceGroup` `profile.room.fields.flatmates`, `name="flatmate_gender"`, options (this order)
      `rooms.genderPreference.women`, `.men`, `.any`; default `any` selected.
   e. `<LifestyleFields perspective="seeker" />` (h3 `lifestyle.title.seeker`, nudge, 7 optional groups).
- **Entry point.** `?section=room`: the form starts with `room` on (even for a profile with no gender) and, once
  mounted, focuses the room `<h2>` (which scrolls it into view). `?next=` keeps today's behaviour (`safeNext`, `replace`
  navigation after a successful save, an unsafe value stays on the page). Without `section=room` the h2 is not
  focused. An unknown `section` value is ignored. Saving with `room` on and no gender shows the error and focuses
  the first gender radio (`focus('gender')` works by `input[name="gender"]`).
- **Switch off** drops any `gender` / `birth_year` error (so it does not reappear on switching on) and keeps what was typed in memory (switching on again restores it) but the save omits the four keys, so
  the server clears the section; the response becomes the cached profile, and the form reopens with the switch off.
- **Targets and a11y**: switch row and radio labels ≥ 44 px, the "ניקוי" button `min-h-[44px]`; every group is a
  `fieldset` + `legend` (`ChoiceGroup`); errors `role="alert"` wired by `aria-describedby`; the seven clear buttons
  have distinct accessible names (`lifestyle.clearAria`).

**i18n keys (`web/src/locales/he.json`)** — gender-neutral, in the codebase's "יחיד/ה" style; the answers read
after either stem ("אני…" / "בדירה…"), so one answer set serves both perspectives; `topic` is a short neutral noun per question (0007c's inbox row title, 0007f's match-reason copy; not rendered by `LifestyleFields`):

| key | Hebrew |
| --- | --- |
| `profile.room.title` | חדר בדירת שותפים |
| `profile.room.hint` | רק אם את/ה מחפש/ת חדר. הפרטים נדרשים כדי להגיש מועמדות לחדר לנשים בלבד או לגברים בלבד. |
| `profile.room.switch` | אני מחפש/ת חדר בדירת שותפים |
| `profile.room.privacy` | בעלי חדרים שהגשת או שתגיש/י אליהם מועמדות רואים את המגדר, הגיל והתשובות שלך כפי שהם שמורים עכשיו. אחרים לא רואים אותם. כיבוי המתג ושמירה מוחקים אותם. |
| `profile.room.fields.gender` | המגדר שלי |
| `profile.room.gender.woman` / `.man` / `.other` | אישה / גבר / אחר |
| `profile.room.genderNote` | חדרים לנשים בלבד או לגברים בלבד שלא מתאימים למגדר שלך או להעדפת השותפים שלך לא יוצגו לך בחיפוש. |
| `profile.room.fields.birthYear` | שנת לידה (לא חובה) |
| `profile.room.birthYearHint` | בעלי החדרים רואים רק את הגיל, לא את שנת הלידה. |
| `profile.room.fields.flatmates` | עם מי אני מעדיפ/ה לגור? |
| `rooms.genderPreference.any` / `.women` / `.men` | לא משנה / נשים / גברים |
| `lifestyle.title.seeker` | אורח החיים שלי |
| `lifestyle.title.flat` | אורח החיים בדירה |
| `lifestyle.nudge` | כל השאלות לא חובה. התשובות עוזרות לחשב התאמה מדויקת יותר בין שותפים לדירה. |
| `lifestyle.clear` | ניקוי |
| `lifestyle.clearAria` | ניקוי התשובה: {{question}} |
| `lifestyle.cleanliness.question.seeker` / `.flat` | אני שומר/ת על ניקיון וסדר… / בדירה שומרים על ניקיון וסדר… |
| `lifestyle.<key>.topic` (one per key: `cleanliness`, `guests`, `night`, `social`, `kosher`, `shabbat`, `work_from_home`) | ניקיון / אורחים / שעות לילה / חברתיות / כשרות / שבת / עבודה מהבית |
| `lifestyle.cleanliness.answer.1` / `.2` / `.3` | בגישה רגועה / ברמה ממוצעת / בקפדנות |
| `lifestyle.guests.question.seeker` / `.flat` | אני מארח/ת אורחים… / בדירה מתארחים אורחים… |
| `lifestyle.guests.answer.1` / `.2` / `.3` | לעיתים רחוקות / מדי פעם / לעיתים קרובות |
| `lifestyle.night.question.seeker` / `.flat` | אני הולך/ת לישון… / בדירה הולכים לישון… |
| `lifestyle.night.answer.1` / `.2` / `.3` | מוקדם / בשעות משתנות / מאוחר בלילה |
| `lifestyle.social.question.seeker` / `.flat` | את הזמן בבית אני מעביר/ה… / בדירה מעבירים את הזמן… |
| `lifestyle.social.answer.1` / `.2` / `.3` | בנפרד / לפעמים יחד / הרבה יחד |
| `lifestyle.kosher.question.seeker` / `.flat` | כשרות המטבח בשבילי… / כשרות המטבח בדירה… |
| `lifestyle.kosher.answer.1` / `.2` / `.3` | לא כשר / אין העדפה / כשר |
| `lifestyle.shabbat.question.seeker` / `.flat` | בשבת אצלי… / בשבת בדירה… |
| `lifestyle.shabbat.answer.1` / `.2` / `.3` | ללא הגבלות / יש גמישות / שמירת שבת |
| `lifestyle.work_from_home.question.seeker` / `.flat` | אני עובד/ת מהבית… / בדירה עובדים מהבית… |
| `lifestyle.work_from_home.answer.1` / `.2` / `.3` | כמעט אף פעם / לפעמים / רוב הזמן |

The scale follows the contract (1 → 3): cleanliness relaxed / average / very tidy · guests rarely / sometimes /
often · night early / varies / owl · social alone / sometimes together / together · kosher not kosher / doesn't
matter / kosher kitchen · shabbat no restrictions / flexible / observant · work-from-home rarely / sometimes /
mostly. `rooms.genderPreference.*` is the one label set for the profile's flatmates preference, 0007e's wizard,
the cards and the listing page; `profile.room.gender.*` is the seeker's own gender only. Reused existing keys:
`listings.errors.required`, `listings.errors.range`, `profile.save`, `profile.saved`.

## Acceptance criteria
Vitest + Testing Library with the existing profile harness (`ProfilePage.test.tsx`: `renderPage`, `mockApi`,
`fixtures.ts`).
- [ ] AC1 `LIFESTYLE_KEYS` equals the contract tuple in order; `he.json` has, for every key, `question.seeker`,
  `question.flat`, `topic` and `answer.1|2|3` as non-empty strings, plus `lifestyle.title.*`, `lifestyle.nudge`,
  `rooms.genderPreference.*`, `profile.room.gender.*`; no seeker question is equal to its flat question —
  `web/src/features/lifestyle/__tests__/keys.test.ts::ac1_keys_and_catalogue`
- [ ] AC2 `compareLifestyle`: keys answered by both only; `{}` vs anything → `{shared:0,same:0,differing:[]}`;
  `{cleanliness:1,guests:2,night:3}` vs `{cleanliness:1,guests:3,social:2}` → `{shared:2,same:1,differing:['guests']}`;
  `differing` follows `LIFESTYLE_KEYS` order; inputs not mutated — `keys.test.ts::ac2_compare`
- [ ] AC3 `<LifestyleFields perspective="seeker">` renders the `lifestyle.title.seeker` heading, the nudge, seven
  groups named by the seeker questions, three radios each, none checked for `{}`; `perspective="flat"` shows the
  flat title and flat questions; picking an answer calls `onChange` with only that key; picking another answer on
  another key keeps both; a group with an answer shows a "ניקוי" button (distinct `aria-label`s) that calls
  `onChange` without the key; groups with no answer have no clear button; checked radios match `value`; clicking "ניקוי" inside `<form onSubmit={spy}>` does not call `spy` and leaves the group's first radio focused; `headingLevel={4}` renders an `<h4>` —
  `web/src/features/lifestyle/__tests__/LifestyleFields.test.tsx::ac3_fields_both_perspectives_pick_and_clear`
- [ ] AC4 Given a seeker with no profile (404), When the page renders, Then the `profile.room.switch` switch is
  unchecked and none of the room content is in the DOM (no gender group, no birth-year field, no questionnaire);
  turning it on shows, in order, the privacy line, the gender group (no radio checked), the birth-year field, the
  flatmates group with `לא משנה` checked, and the questionnaire; a save with the switch off sends exactly the
  existing `AC2_BODY` (no `gender`, `birth_year`, `flatmate_gender`, `lifestyle` keys) —
  `ProfilePage.test.tsx::ac4_room_switch_reveals_and_off_omits`
- [ ] AC5 Given the filled housing form and the room switch on, When saving with no gender, Then no PUT, the gender
  group shows `listings.errors.required` in a `role="alert"` (radios `aria-invalid`), first gender radio focused;
  after choosing "אישה", leaving birth year empty, picking `גברים` and answering `cleanliness`=3 and `kosher`=1,
  one `PUT` whose body is `AC2_BODY` plus exactly `{gender:'woman', flatmate_gender:'men', lifestyle:{cleanliness:3,
  kosher:1}}` (no `birth_year` key); switching off with the gender error showing and on again shows no stale alert — `ProfilePage.test.tsx::ac5_room_gender_required_and_body`
- [ ] AC6 Birth year: `""` is valid (omitted); with `room` on, `"abcd"`, `"19x5"`, a year making the age 17 and a
  year making it 100 each show `listings.errors.range` (with `birthYearRange()` min/max) on the field (asserted as `aria-invalid="true"`, focus, `toHaveAccessibleDescription(expect.stringContaining(message))` and `role="alert"` on the element with the error id, since the input's `aria-describedby` also holds the hint; `expectError` is unchanged), and send nothing; the oldest and youngest valid years save as numbers; with `room` off a junk value is
  ignored and not sent; `birthYearRange(new Date('2026-12-31T22:30:00Z'))` (Israel already in 2027) is `{min: 1928, max: 2008}` —
  `ProfilePage.test.tsx::ac6_birth_year_rules` and `web/src/features/profile/__tests__/validate.test.ts::ac6_birth_year_range`
- [ ] AC7 Given a stored profile with `gender:'man'`, `birth_year:1995`, `flatmate_gender:'women'`, `lifestyle:
  {night:3, shabbat:2}`, Then the switch opens checked, `גבר` and `נשים` are checked, the field shows `1995`, those
  two answers are checked and nothing else; When the seeker turns the switch off and saves, Then one `PUT` with
  exactly `AC2_BODY`-shaped fields and none of the four room keys, the cached profile becomes the response, and
  the page shows `profile.saved`; turning the switch off and on again before saving restores the typed values;
  When the stored profile has `gender:null` the switch opens unchecked — `ProfilePage.test.tsx::ac7_prefilled_and_off_clears`
- [ ] AC8 Entry point: Given `/me/profile?section=room&next=%2Flistings%2Fabc` and a profile with `gender:null`,
  Then the switch is on, the room `<h2>` has focus, and after choosing "אישה" and saving the app navigates to
  `/listings/abc` (replace); `/me/profile?section=room` stays on the page after saving with `profile.saved`;
  `/me/profile` and `?section=other` leave the switch off for a no-room profile and focus nothing special;
  `?section=room&next=%2F%2Fevil.example` stays on the page after saving; `roomSectionHref('/listings/abc')` is
  exactly `/me/profile?section=room&next=%2Flistings%2Fabc` — `ProfilePage.test.tsx::ac8_section_room_entry_point`
  and `web/src/features/profile/__tests__/links.test.ts::ac8_room_section_href`
- [ ] AC9 Given `make dev` is up, When `web/e2e/applications.spec.ts::ac9_fill_profile_apply_withdraw` fills the
  profile through the gate (as today), also turns on the room switch, picks "אישה", types a birth year
  (`String(new Date().getUTCFullYear() - 30)`), picks `נשים` as flatmates preference and answers one question, and
  saves (these steps sit before `test.step('ac10 …')`, apartments only, so the 100 / 59 scores are unaffected), Then
  it still lands on the listing; Given it reopens `/me/profile`, Then the switch is checked and the values are back
  (room radios and answers are found inside their group: `page.getByRole('group', { name: <legend> }).getByRole('radio',
  { name, exact: true })`, because "גבר" is a substring of "גברים"); Given it then loads `/me/profile?section=room`,
  Then the room heading is focused; When it turns the switch off and saves, then `page.goto('/me/profile')` (not
  `reload`: `section=room` would force the switch on again), Then the switch is unchecked and no room content is
  shown — `web/e2e/applications.spec.ts::ac9_fill_profile_apply_withdraw` (extended; `make e2e` on the final local
  head with port 5173 free, result in the digest; CI `e2e` is off, CLAUDE.md rule 7)
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` clean, `make e2e` green on the final local
  head (reported in the digest); no hardcoded Hebrew or English in components; every existing profile test still
  passes unchanged — CI `web`
- [ ] NF2 Accessibility at 390 px: every group a `fieldset` + `legend`, switch and birth-year labelled, targets ≥ 44 px,
  errors `role="alert"`, the privacy line visible before the fields, the seven "ניקוי" buttons distinguishable by
  name, logical properties only, three answers stay one row at 390 px, a label may wrap to two lines, no horizontal overflow — ux reviewer

## Tests to write
New: `lifestyle/__tests__/keys.test.ts` (AC1, AC2), `lifestyle/__tests__/LifestyleFields.test.tsx` (AC3),
`profile/__tests__/links.test.ts` (AC8 href), `ProfilePage.test.tsx` AC4–AC8, `validate.test.ts` AC6 range.
Existing: `profile/__tests__/fixtures.ts` `profile()` carries the four defaults (added by `0007a`; verify); `ProfilePage.test.tsx` helpers
stay (`toggle(name)` finds the new switch by name; `ac1_empty_form`'s `screen.queryByRole('alert')` stays null
because nothing room-related renders when off); `validate.test.ts::ac4_rules` is unaffected (room off by default
in `valid`); `AC2_BODY` is the unchanged body proof for "off". `web/e2e/applications.spec.ts`: the only e2e that
touches the profile form; no new signup (the suite is near the OTP rate budget: 0006d finding 1). Per CLAUDE.md rule 7 (commit d917d05) the spec session runs `make e2e` on its final local head and reports it in its digest; CI `e2e` is off.
Breakage homework: after `make client`, `SeekerProfileOut` gains four required fields; the only literal is `profile()` (fixed by `0007a`).

## Risks / decisions
1. **Decided: per-question button.** `ChoiceGroup` has no "none" and this spec does not change it, so a per-question
   "ניקוי" button lives in `LifestyleFields`. Alternative: a fourth "אין העדפה" radio per question (stored as
   absence). Recommend the button: it keeps the 3-point scale visible and the key absent.
2. **Decided: no confirm dialog.** Switching off with filled data deletes it on save without a confirm; the privacy line says so. Options:
   (a) none (recommended: cheap to refill, the line states it), (b) a `window.confirm`-style dialog only when
   answers or gender exist. Gilad's call, UX reviewer may raise it.
3. **Decided: keep `profile.room.genderNote`.** It states the product rule (rooms for another gender are hidden from you). It is
   copy derived from PRODUCT.md "Rooms", not a new decision; Gilad can strike it. Without it a seeker sees fewer
   rooms with no explanation.
4. **Accepted.** `?section=room` (who may use it): it force-opens the switch even when the seeker never wanted a room section
   (a link someone shares only moves the UI; nothing is saved until "שמירה"). Accepted.
5. **Decided: bounds as written (the web range is a subset of the API's).** Birth-year bounds are computed client-side from two clocks (UTC for the youngest, Israel for the oldest) so a
   passing form is never a 422; at the year boundary a valid birth year may be refused by the client for a few
   hours. Accepted.
6. Copy for the 7 questions is the orchestrator's; kosher answer 2 is "אין העדפה" (neutral for both stems) where the
   contract says "doesn't matter". Gilad can amend wording in the digest.
7. `0007e`/`0007f`/`0007c` cite the exports named in Scope; `0006e`'s and `0006d`'s `profile.household.*` /
   `listings.prefs.*` duplication note applies to nothing here.

## Verifier findings — one round, 16 findings, all applied
Verdict: **reject** (stays `draft`; all findings applied, rulings: e2e per CLAUDE.md rule 7 at d917d05, privacy line covers past applications, separate-neutral nudge, 0007g now 0007c); every fix below is a spec-text edit, no re-scope (one coder run holds).
Checked against `main` at `d917d05`. These were confirmed against the code and need no change: the cited
`ChoiceGroup` props (`web/src/components/ChoiceGroup.tsx:5-14`, `value: T | null`, no clear), `Switch` (`label`,
`checked`, `onChange`), `focus(name)` by `input[name=…]` (`web/src/features/profile/ProfilePage.tsx:83-85`), the
safe-next path (`ProfilePage.tsx:109-110`, `safeNext` + `replace`, reused unchanged), `listings.errors.required|range`
in `he.json`, `i18n-check` checking literal keys only, with no unused-key check (`web/scripts/i18n-check.mjs:89-95`),
`escapeValue: false` (`web/src/app/i18n.ts:11`, so the "/" in an interpolated question is not escaped), and the
existing exact-body tests staying green with the room switch off (`ProfilePage.test.tsx:208,238-250,433`;
`validate.test.ts:19-21,64-70`). The generated `lifestyle` type `{ [key: string]: 1 | 2 | 3 }`
(`specs/0007a-room-inputs-api.md:159`) is assignable to and from `LifestyleAnswers` both ways. I checked that with the
repo's `tsc` (strict, `noUncheckedIndexedAccess`, also under `exactOptionalPropertyTypes`). No silent contract
deviation: `lifestyle.clear`/`clearAria` are additions and the kosher "אין העדפה" is declared (Q6).

1. **major — the "ניקוי" button submits the form, and focus is lost after a clear.** `LifestyleFields` sits inside
   `<form onSubmit>` (`ProfilePage.tsx:231`; in `0007e` inside the wizard's form). A `<button>` with no `type` is
   a submit button, so "ניקוי" would run `onSubmit` (validate + PUT) or advance the wizard. The button is also only
   rendered "under a group that has an answer", so clicking it unmounts it and focus falls to `<body>`. **Fix (Scope
   `LifestyleFields.tsx`, and add to AC3):** "`<button type="button">`; after a clear, focus moves to the first radio
   of that group (`input[name="lifestyle-<key>"]`)". AC3 also asserts that clicking "ניקוי" inside a `<form
   onSubmit={spy}>` does not call `spy`, and that the group's first radio has focus afterwards.

2. **major — `birthYearRange` has three different signatures.** Scope says `birthYearRange()` (line 46), calls it
   as `birthYearRange(todayInIsrael(), now)` (line 45), and AC6 calls it "with a fixed clock". `validate(form,
   areas, today)` has no clock (`validate.ts:110-114`), and `todayInIsrael(now = new Date())` already takes a
   `Date` (`web/src/features/listings/format.ts:32`). **Fix:** "`export function birthYearRange(now: Date = new
   Date()): { min: number; max: number }` with `max = now.getUTCFullYear() - 18` and `min =
   Number(todayInIsrael(now).slice(0, 4)) - 99`. `validate` calls `birthYearRange()` (its signature and every
   existing call stay unchanged). `birth_year` is trimmed like `budget` (`validate.ts:87`) before the `DIGITS` test
   and in `toProfileIn`." AC6's unit test is `birthYearRange(new Date('2026-12-31T22:30:00Z'))` →
   `{min: 1928, max: 2008}`.

3. **major — the privacy line understates who sees the data.** `profile.room.privacy` says owners of rooms "שתגיש/י
   אליהם" (future only). `0007c`'s `room` is **live** (`specs/0007c-room-inbox-api.md:57`: "a seeker who edits or
   clears the room section changes or removes it in every owner's inbox at once"), so owners of rooms already
   applied to see it as soon as it is saved. PRODUCT.md "Rooms" ("On a **room** application the owner's inbox shows
   the applicant's gender, age, score and reasons, with the questionnaire answers") applies to past applications
   too. **Fix copy:** "בעלי חדרים שהגשת או שתגיש/י אליהם מועמדות רואים את המגדר, הגיל והתשובות שלך. אחרים לא רואים
   אותם. כיבוי המתג ושמירה מוחקים אותם." The rest of the line is accurate: `flatmate_gender` is never shown to
   owners, apartment owners never see the section, and the deletion on save matches decision 2.

4. **major — `lifestyle.nudge` is shared by both perspectives but written for the seeker only, and it says the
   wrong thing.** `LifestyleFields` renders it for `perspective="flat"` too (`0007e` line 112 shows it to owners), so
   "ציון ההתאמה לחדרים" makes no sense to an owner. "משפרות" is also wrong: by the contract's formula answers can
   lower the score as well as raise it. **Fix copy:** "כל השאלות לא חובה. התשובות עוזרות לחשב התאמה מדויקת יותר
   בין שותפים לדירה."

5. **major — the e2e rule cited is out of date.** AC9 says "written and type-checked locally, run by CI", and Tests
   to write says "Per CLAUDE.md rule 7 … not run locally". `CLAUDE.md:38-42` now says (commit `d917d05`) "**e2e runs
   locally for now (Gilad, 2026-11-11)** … CI's `e2e` job is switched off (`E2E_IN_CI=off`) and every spec that
   touches the web runs `make e2e` on its final local head and reports the result in its digest". As written, AC9
   would never run anywhere. **Fix:** in AC9, NF1 and Tests to write: "`make e2e` on the final local head (port 5173
   free first), result in the digest; CI `e2e` is off". The orchestrator's brief said "never run locally": it
   predates `d917d05`, so the orchestrator should decide and keep the spec and CLAUDE.md in line.

6. **major — AC9's e2e steps as worded fail.** (a) "turns the switch off and saves and reloads, Then the switch is
   unchecked": the save happens on `/me/profile?section=room`, and a `page.reload()` there opens the switch **on**
   again (`section=room` forces it on). It must be `page.goto('/me/profile')`. (b) Playwright's `getByRole` name
   match is a case-insensitive **substring** unless `exact: true`. The new page-level check `getByRole('radio', {
   name: he.profile.room.gender.man })` ("גבר") also matches "גברים" (`rooms.genderPreference.men`), which is a
   strict-mode violation. The existing page-level radio checks (`web/e2e/applications.spec.ts:91-95`) stay
   unambiguous. **Fix (AC9):** "after switching off and saving, `page.goto('/me/profile')`; room radios and answers
   are found inside their group (`page.getByRole('group', { name: <legend> }).getByRole('radio', { name, exact: true
   })`); the birth year is `String(new Date().getUTCFullYear() - 30)`; the room steps sit before `test.step('ac10
   …')` (apartments only, so the 100 / 59 scores are unaffected)".

7. **minor — open questions are decided; move them out of "open".** Orchestrator decisions (2026-11-11, as the
   writer recommended): Q1 a per-question "ניקוי" button, `ChoiceGroup` unchanged; Q2 no confirm dialog, and the
   privacy line says the data is deleted on save; Q3 keep `profile.room.genderNote` (wording per finding 13); Q5
   birth-year bounds as written (the web range is a subset of the API's). Q4 is accepted, Q6 stays a copy note for
   Gilad's digest, and Q7 is informational. **Fix:** rename the section to "Risks / decisions", mark each item
   "Decided:", and change Out's "(open question 2)" (line 63) to "(decided, Q2)". `0007e`'s assumption (line 172,
   that an owner can clear an answer) is met by Q1.

8. **minor — AC6 cannot use the existing `expectError` helper.** The birth-year input's `aria-describedby` holds two
   ids (hint and error). `description(el)` joins both texts, so `toBe(message)` fails, and
   `document.getElementById(<both ids>)` is `null` (`ProfilePage.test.tsx:104-120`). **Fix (AC6):** "asserts
   `aria-invalid="true"`, focus, `toHaveAccessibleDescription(expect.stringContaining(message))`, and that the
   element with the error id has `role="alert"`; `expectError` is unchanged".

9. **minor — stale gender and birth-year errors survive the switch.** `change(patch, field)` clears one field's error
   (`ProfilePage.tsx:87-91`). If the seeker switches off with a gender error showing and then on again, the old
   alert reappears before any new submit. **Fix (UI "Switch off"):** "toggling `room` also drops the `gender` and
   `birth_year` errors"; AC5 adds one line for it.

10. **minor — the fixture edit is already in `0007a`.** `specs/0007a-room-inputs-api.md:154-155` adds `gender: null,
    birth_year: null, flatmate_gender: 'any', lifestyle: {}` to `profile()`. Nothing else builds a `SeekerProfileOut`
    literal: `features/applications/__tests__/ApplySection.test.tsx`, `match/__tests__/reasons.test.ts`,
    `search/__tests__/*` and `listings/__tests__/ListingPage.test.tsx` all import `profile()`. **Fix:** Scope and
    Tests to write say "already added by `0007a`; verify it is present", and the "e.g. in
    `features/applications/__tests__/`" clause is deleted.

11. **minor — NF2's "longest answer is 11 characters" is wrong.** "לעיתים קרובות" and "לעיתים רחוקות" are 13
    characters, "בשעות משתנות" is 12. `ChoiceGroup` lays the options out in a `flex gap-2` row that never wraps, with
    `flex-1 px-3` labels (`ChoiceGroup.tsx:34-50`). At 390 px that leaves about 80 px of text per label, so those
    answers wrap to two lines inside the label. That is fine: the row holds, the label grows past 44 px and nothing
    overflows. **Fix (NF2):** "three answers stay one row at 390 px; a label may wrap to two lines; no horizontal
    overflow".

12. **minor — four stems read badly (copy, Gilad's call per Q6).** The seeker social stem "אני מבלה עם השותפים…" +
    "בנפרד" contradicts itself; "בשבת אצלי יש… ללא הגבלות" is ungrammatical ("יש ללא"); the flat kosher stem
    "המטבח בדירה הוא… אין העדפה" does not parse; the legend "מעדיפ/ה לגור עם" + "לא משנה" is awkward.
    **Proposal**, keeping every `topic` and the answers that `0007f` AC7/AC11 quote ("בקפדנות", "לא כשר"):
    social "את הזמן בבית אני מעביר/ה…" / "בדירה מעבירים את הזמן…"; kosher "כשרות המטבח בשבילי…" / "כשרות המטבח
    בדירה…"; shabbat "בשבת אצלי…" / "בשבת בדירה…" with `answer.2` "יש גמישות" (this changes the example "שבת:
    גמישות" at `0007f:231`); `profile.room.fields.flatmates` "עם מי אני מעדיפ/ה לגור?". The other stems and
    answers read naturally after both "אני…" and "בדירה…".

13. **minor — `genderNote` and `birthYearHint` copy.** "חדרים שמיועדים רק למגדר אחר" is ambiguous for a seeker
    who picked "אחר". It also omits the second hiding rule in PRODUCT.md "Rooms" (a room "that contradicts the
    seeker's flatmates preference … is hidden"). **Fix:** "חדרים לנשים בלבד או לגברים בלבד שלא מתאימים למגדר שלך
    או להעדפת השותפים שלך לא יוצגו לך בחיפוש." `birthYearHint` "בעל החדר רואה…" is masculine singular; use
    "בעלי החדרים רואים רק את הגיל, לא את שנת הלידה." (the style of `profile.privacy`).

14. **minor — reviewers.** Checklist line 8 says "security for … anything touching phone numbers or PII". This spec
    collects gender and birth year, writes the privacy copy, and adds a link (`?section=room`) that opens the form
    section. `0007a` and `0007c` both carry `security`. **Fix:** add `security` to `reviewers` (a Sonnet pass over
    the privacy copy and `links.ts`/the entry point is enough), or state in the header comment why the API specs'
    security reviews cover it.

15. **minor — `LifestyleFields` hard-codes `<h3>`.** In `0007e` it sits inside `RoomFields`' own `<h3>` section
    (`specs/0007e-room-listing-web.md:96`), so the sub-section heading ends up at the same level as its parent.
    **Fix:** an optional `headingLevel?: 3 | 4` prop (default 3; `0007e` passes 4). Leaving it as is is acceptable
    if the orchestrator prefers no extra prop; then say so in `0007e`.

16. **minor — what the consumer specs use.** Every name that `0007e`/`0007f`/`0007g` cite exists here with the same
    shape: `LIFESTYLE_KEYS`, `LifestyleAnswers`, `compareLifestyle → {shared, same, differing}`, the
    `LifestyleFields` props, `roomSectionHref`, `rooms.genderPreference.*`, `profile.room.gender.*`,
    `lifestyle.title.flat`, `.topic` and `.answer.n`. Three differences are for the orchestrator to apply in
    those specs:
    (a) `0007g` titles answer rows with `lifestyle.<key>.question.flat` (`0007g:57,62`; its open question at
    `:118-121`). The contract defines `lifestyle.<key>.topic` for exactly "inbox rows", and this spec has it, so
    `0007g` should switch to `topic` and close that question.
    (b) `0007e:48` ("a small" lifestyle conversion) and `0007g:52-53` ("narrows … once") are unnecessary: the
    generated type assigns to `LifestyleAnswers` directly (see the preamble).
    (c) `0007f:5` credits `SeekerProfileOut.birth_year` to `0007d`; it comes from `0007a`. This is harmless.
    `0007d` creates the top-level `rooms` object in `he.json`, and `0007e`/`0007f` add sibling sub-keys to it after
    rebasing.

## Digest (filled by orchestrator after verification)

    Spec 0007d - Room section of the seeker profile (web)   (verified, Slice 7 part 4 of 6, depends on 0007a)
    What a user can do after this: a seeker switches on "חיפוש חדר" in /me/profile and gives gender, an optional
             birth year, an optional flatmates preference and the 7-question lifestyle questionnaire; switching
             it off clears them on save. Also builds the shared features/lifestyle module 0007e/f/c reuse.
    Decisions I need from you: none new. Copy is mine (7 questions x 3 answers, two perspectives) - amend any line.
    KPIs this slice moves: share of seekers with a room section; share of those who answer the questionnaire.
    Acceptance targets: NF1 lint/test/i18n/build clean + make e2e green locally - NF2 fieldset + legend,
             44 px targets, focus kept after "ניקוי".
    Risks: the privacy line must match who sees the data (owners of rooms applied to, past and future, see
             gender, age and answers live) - mitigation: copy fixed in the verifier round, security reviewer added.
    Reviewers: code, qa, ux, security   Estimated: 1 coder run, 1 review round
    Links: specs/0007d-room-profile-web.md - PRODUCT.md "Rooms" - no artboard (follows /me/profile from 0006d)
