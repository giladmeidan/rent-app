---
id: 0006g
title: An owner's applicant inbox is sorted by match, each card shows the score, a household / move-in line, two chips and a "למה ההתאמה?" disclosure with the reasons and the applicant's housing details
status: in-progress
depends_on: [0006c, 0006f, 0005b]   # 0006c: match + profile per applicant; 0006f: features/match (badge, chips, reasons); 0005b: also edits ApplicantCard (chat link) and renames the e2e inbox test
reviewers: [code, qa, ux]   # ux: the inbox card vs Inbox.dc.html / InboxDesktop.dc.html; qa: sort toggle with filters and in-place updates
estimate: 1 coder run
---

## Goal
After this ships, `/me/listings/:id/applicants` (`0004d`) lists applicants by match (the API's default order) with
a toggle to "לפי תאריך"; each card shows the score badge (or "אין ציון" for an applicant from before Slice 6), a
line like "זוג · כניסה 1.1.27 (גמיש)", up to two chips (top agreeing, differing) in the owner's voice, and a
"למה ההתאמה?" disclosure with the three agreeing lines, the differing line and the applicant's housing details
(household, move-in, contract length, pets, smoking, parking). Serves Dev Plan slice 6, part g of seven
(overview in `0006a`). Artboards: `Inbox.dc.html` ("ממוין לפי ציון התאמה · שינוי", "94% התאמה", the two chips),
`InboxDesktop.dc.html` (the detail panel: "משק בית", "תאריך כניסה", "משך חוזה רצוי", "חיות מחמד", "למה ההתאמה
גבוהה" and its four lines).

## Scope
**In:**
- `web/src/features/applicants/ApplicantsPage.tsx`: a sort toggle — two buttons with `aria-pressed`
  (`applicants.sort.match` "לפי התאמה" / `applicants.sort.newest` "לפי תאריך", default match) in their own
  `role="group"` with `aria-label` `applicants.sort.label`, rendered together with (but outside) the filter
  group, i.e. only for a loaded non-empty list (no disabled state). The order is computed **client-side** from
  the one loaded list: match = the API's order as received; newest = `shown.toSorted((a, b) =>
  Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id < b.id ? -1 : 1))` on a copy, never the cached
  array (never compare `created_at` as strings: Pydantic drops zero microseconds). The query key, the PATCH's
  in-place `setQueryData` (`useSetApplicantStatus.ts`) and the totals / filters stay as they are. Toggle state
  is component state (as the filter is), not URL.
- `web/src/features/applicants/ApplicantCard.tsx`, in this order:
  1. the name row: `<h2>`, the status chip, then `MatchBadge` (`0006f`) when `applicant.match`, else a muted pill
     `match.noScore` ("אין ציון");
  2. `applicants.appliedAt`;
  3. when `applicant.profile`: the summary `applicants.summary` ("{{household}} · כניסה {{date}}") +
     `applicants.flexible` (" (גמיש)") when flexible;
  4. `MatchChips voice="owner"`;
  5. the message;
  6. a disclosure button `applicants.why` ("למה ההתאמה?", `aria-expanded`, `aria-controls` = the panel id
     `${headingId}-why`) and its panel: a `<ul>` of the owner-voice agree `<li>`s with `0006f` `MatchCard`'s teal
     ✓ and the differ `<li>` with its amber ! (icons `aria-hidden`), then a `<dl>` of the profile rows
     (UI table); every card with a profile has it, declined cards included;
  7. the actions row (which holds `0005b`'s chat link).
  Cards without a profile have no summary, chips or disclosure.
  Every displayed profile date (summary, `<dl>`, the `move_in` lines and chip) shows the later of
  `move_in_date` and `todayInIsrael()`, formatted with `formatDate` (`features/listings/format.ts`) — as `0006b`
  scores a past date as today.
- `web/src/features/applicants/api.ts`: `export type ApplicantProfileOut =
  components['schemas']['ApplicantProfileOut']`.
- `web/src/features/match/reasons.ts` (`0006f`): `ownerShort(criterion, kind, profile, t)` and
  `ownerReason(criterion, kind, profile, spots: number, t)` — the owner copy reads only `parking_spots` from the
  listing (`ApplicantsPage` already has the `MyListingOut` from `useMyListings`). `MatchChips`' props become a
  union on `voice`, as `ApplicationStatusChip`'s `viewer`: `{ voice?: 'seeker'; …0006f's props unchanged } | {
  voice: 'owner'; match: MatchOut; profile: ApplicantProfileOut; spots: number }`.
- `web/src/features/applicants/__tests__/fixtures.ts`: `applicant()` defaults to `match: null, profile: null`
  (`0006c` added them; a default profile would add the "למה ההתאמה?" button to `buttonsOf()` and break the
  existing ac4 / ac5).
- `web/src/locales/he.json`: the keys in the UI tables.
- `web/e2e/inbox.spec.ts` (AC8).

**Out:**
- The seeker's budget and areas: the API never sends them (`0006c`); the owner sees only the `budget` / `area`
  codes as words ("התקציב מתאים למחיר").
- Ages, occupation, "מאומתים בטלפון" (PRODUCT.md "Matching"; verification is Slice 10). The desktop side panel
  layout of `InboxDesktop.dc.html` (the disclosure serves both widths; FOLLOWUPS if ux wants the panel).
- An owner-specific order of the reasons (that would be a `0006b` change).

**New dependencies:** none.

## Data
None (web only).

## API
Reads `match` and `profile` on `GET /listings/{id}/applications` and the PATCH response (`0006c`). Sends no
`sort` (the API's default is match; "newest" is sorted client-side). `make client` before building.

## UI
Owner-voice copy (`match.owner.<c>.*`; chips `match.owner.short.<c>.*`). `{{parking}}` = `t('profile.parking.
<needed>')` ("חניה אחת" / "2 חניות", `0006d`); `{{date}}` as above; `{{household}}` / `{{months}}` from
`profile.household.*` / `profile.contract.*` (`0006d`):

| criterion | agree | differ | chips agree / differ |
| --- | --- | --- | --- |
| budget | "התקציב מתאים למחיר" | "המחיר מעל התקציב שלהם" | "בתקציב" / "מעל התקציב" |
| move_in | "תאריך הכניסה מתאים ({{date}})" | "מבקשים כניסה ב־{{date}}" | "כניסה מתאימה" / "כניסה {{date}}" |
| area | "מחפשים באזור הזה" | "מחפשים באזור אחר" | "באזור" / "אזור אחר" |
| household | "{{household}} — כפי שביקשת" | "{{household}} — לא ברשימה שלך" | "משק בית מתאים" / "משק בית אחר" |
| contract | "מחפשים חוזה ל{{months}}" | "מחפשים חוזה ל{{months}} בלבד" | `agreeLong` "חוזה ארוך טווח" (≥ 24) / `agree` "חוזה מתאים" / `differ` "חוזה קצר" |
| parking | "צריכים {{parking}} — יש"; needed 0 → `agreeNone` "לא צריכים חניה" | "ביקשו {{parking}}, בדירה יש {{spots}}"; spots 0 → `differNone` "ביקשו {{parking}}, בדירה אין חניה" | "חניה" / "חסרה חניה" |
| smoking | `smoker` false → "לא מעשנים"; true → `agreeSmoker` "מעשנים — מותר אצלך" | "מעשנים" | "לא מעשנים" · `agreeSmoker` "מעשנים, מותר" / "מעשנים" |
| pets | `has_pets` false → "בלי חיות מחמד"; true → `agreePet` "עם חיית מחמד — מותר אצלך" | "עם חיית מחמד" | "בלי חיות" · `agreePet` "חיית מחמד, מותר" / "עם חיית מחמד" |

Whenever `parking_spots < parking_needed` (`m_parking` 0.5 can be an agree), the parking line uses the differ
wording. Other keys:

| key | value |
| --- | --- |
| `applicants.sort.label` | מיון |
| `applicants.sort.match` / `.newest` | לפי התאמה / לפי תאריך |
| `applicants.summary` | {{household}} · כניסה {{date}} |
| `applicants.flexible` | (גמיש) |
| `applicants.why` | למה ההתאמה? |
| `applicants.profile.household` | משק בית |
| `applicants.profile.moveIn` | תאריך כניסה (+ `listings.fields.entryFlexible` in parentheses when flexible) |
| `applicants.profile.contract` | משך חוזה רצוי (value `profile.contract.*`) |
| `applicants.profile.pets` | חיות מחמד (value `listing.yes` / `listing.no`: "יש" / "אין") |
| `applicants.profile.smoker` | מעשנים (value `applicants.profile.yes` "כן" / `applicants.profile.no` "לא") |
| `applicants.profile.parking` | חניה (value `profile.parking.*`) |
| `match.noScore` | אין ציון |

States: as `0004d` (loading, error, empty, filter-empty). The disclosure starts closed; opening it moves no
focus. 390 px first, logical properties, targets ≥ 44 px.

## Acceptance criteria
Vitest + Testing Library with `features/applicants/__tests__/fixtures.ts` (extended with `match` / `profile`
overrides).
- [ ] AC1 Given `GET /listings/{id}/applications` answering A (94, newest-but-one), B (59, newest), C (`match: null`, oldest), Then the cards render A, B, C (the API's order) with "התאמה 94%", "התאמה 59%" and "אין ציון"; `applicants.sort.match` has `aria-pressed="true"` in the group `applicants.sort.label` — `web/src/features/applicants/__tests__/ApplicantsPage.test.tsx::ac1_sorted_by_match`
- [ ] AC2 When pressing `applicants.sort.newest`, Then B, A, C with no new request; pressing match again restores A, B, C; with the "shortlist" filter active, the toggle orders the filtered cards the same way and the totals do not change — `ApplicantsPage.test.tsx::ac2_sort_toggle_is_client_side`
- [ ] AC3 Given A with `profile {household: "couple", move_in_date: <a future date>, move_in_flexible: true, …}`, Then its card shows "זוג · כניסה <that date> (גמיש)"; C shows no summary, no chips and no `applicants.why` button — `ApplicantsPage.test.tsx::ac3_summary_line`
- [ ] AC4 Given A with `match {score: 98, agrees: [budget, move_in, area], differs: parking}` (`0006b` AC1 row 10), `parking_needed` 2 and the listing's `parking_spots` 1, When pressing `applicants.why`, Then `aria-expanded="true"` and a list of three agree items plus "ביקשו 2 חניות, בדירה יש 1", then the six profile rows with A's values; pressing again hides them — `ApplicantsPage.test.tsx::ac4_why_disclosure`
- [ ] AC5 Given A (94) `submitted` and B (59), When the owner shortlists A and the PATCH returns A with score 50, Then A keeps its place (first) in match order, shows "התאמה 50%", the order does not jump, and focus is on A's `<h2>` (`0004d`'s rules) — `ApplicantsPage.test.tsx::ac5_patch_keeps_place`
- [ ] AC6 `reasons.ts` owner voice: every criterion × agree/differ returns the table's copy with the right values, including both profile sides of smoking and pets (`agreeSmoker`, `agreePet`), parking (1, 0) → `differNone`, (2, 1) as agree → differ wording, needed 0 → `agreeNone`, contract 24 → `agreeLong`, and a past `move_in_date` shown as today — `web/src/features/match/__tests__/reasons.test.ts::ac6_owner_copy` (parametrized)
- [ ] AC7 No "₪" appears inside any applicant `<article>` (a budget line interpolating a price would) — `ApplicantsPage.test.tsx::ac7_no_amount_in_cards`
- [ ] AC8 Given `make dev` is up, When `0005b`'s `ac12_shortlist_chat_decline` runs (its seeker has a profile through `0006a`'s `putProfile`; `postListing` 7,200 ₪, `israelDay(30)`, parking 1 and `P` score 100), Then after the owner opens the inbox and before the shortlist the card shows "התאמה 100%", `applicants.why` reveals a list with at least one `listitem` and the `match.owner.budget.agree` text; the existing line 52 `getByRole('button')).toHaveCount(0)` on the declined card is replaced by a check that none of the three `applicants.actions.*` buttons is present (the disclosure button stays). No new `test()` and no new signup (the suite is at 9 of `OTP_RATE_LIMIT_IP = 10`) — `web/e2e/inbox.spec.ts::ac12_shortlist_chat_decline` (extended)
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` clean; every existing `ApplicantsPage` test passes with the fixture defaults (`match: null, profile: null`) — CI `web`, `e2e`
- [ ] NF2 Accessibility: the toggle buttons expose `aria-pressed` inside a labelled group; the disclosure is a real `button` with `aria-expanded` / `aria-controls`; the score is never colour-only (the badge has the number, the chips words) — ux reviewer

## Tests to write
Component: `ApplicantsPage.test.tsx` (AC1–AC5, AC7); unit: `reasons.test.ts` (AC6); E2E: `web/e2e/inbox.spec.ts`
`ac12_shortlist_chat_decline` extended (AC8).

## Risks / open questions
- Sorting "newest" client-side means the `sort` query param of `0006c` is unused by the web; it stays for API
  completeness (one `Literal`, already tested there).
- With `0006b`'s weights the owner will usually see budget, move-in and area as the three agree lines and
  "בתקציב" as the chip; the artboard's household and smoking lines appear only when those differ. An
  owner-specific order would be a `0006b` change — Gilad can ask for it in the digest batch.
- Copy is the orchestrator's, from the InboxDesktop lines where they exist. Gilad can amend wording in the
  digest.
- No open product questions.

## Verifier findings — one round, 12 findings, all applied
Verdict: reject as written (checklist 1 and 5 fail). Every fix below is concrete; no split, no product question.

1. (major) E2E: AC8 breaks the test it extends and needs no new signup. Once `0006a`'s `putProfile(seekerPage)` gives
   the seeker a profile, the declined card keeps the "למה ההתאמה?" button, so `web/e2e/inbox.spec.ts:52`
   `await expect(applicant.getByRole('button')).toHaveCount(0)` fails. `0005b` keeps that line in its renamed
   `ac12_shortlist_chat_decline`. **Fix:**
   - AC8 is steps inside `ac12_shortlist_chat_decline`, after the owner opens the inbox and before the shortlist.
     No new `test()` and no new signup (the 10 OTP requests per IP per 15 min; `0005b` counts 9 used). Name the AC's
     test `web/e2e/inbox.spec.ts::ac12_shortlist_chat_decline` (extended).
   - Replace line 52 with a check that none of the three action buttons (`applicants.actions.*`) is present.
   - The ✓ icons are `aria-hidden`, so a "✓ line" cannot be seen by role. Assert instead that the panel's list has at
     least one `listitem`. `postListing` (7,200 ₪, `israelDay(30)`, parking 1) and `putProfile` (`P`: budget 7500,
     the same date and area, parking 1) score 100 with agrees `[budget, move_in, area]`, so the test can also assert
     the `match.owner.budget.agree` text.
2. (major) Two owner-voice lines say false things about the applicant. `0006b` gives `m_smoking = 1` unless
   `smoker AND NOT smoking_allowed`, and `m_pets = 1` unless `has_pets AND NOT pets_allowed`. So:
   - A smoker on a listing that allows smoking agrees on smoking, and gets the line and chip "לא מעשנים".
   - A pet owner on a listing that allows pets gets the chip "בלי חיות".

   **Fix:** pick the agree copy from the profile:
   - smoking: `smoker` false → "לא מעשנים" (line and chip). `smoker` true → `match.owner.smoking.agreeSmoker`
     "מעשנים — מותר אצלך" and the chip `match.owner.short.smoking.agreeSmoker` "מעשנים, מותר".
   - pets: the chip for `has_pets` true is `match.owner.short.pets.agreePet` "חיית מחמד, מותר". The line already has
     its variant.
   - AC6's parametrization covers both profile sides of smoking and pets.
3. (major) The parking copy is wrong Hebrew in common cases, and one agree line can be false.
   - `parking_needed` is 0, 1 or 2, so parking differs only for (needed, spots) = (1, 0), (2, 0) and (2, 1). The
     current copy gives "ביקשו 1 חניות, בדירה יש 0" and "צריכים 1 חניות — יש".
   - `m_parking = 0.5` (2 needed, 1 spot) counts as agreeing (≥ 0.5) when parking is not the differs criterion. The
     copy would then say "צריכים 2 חניות — יש", which is false.

   **Fix:** set `{{parking}}` = `t('profile.parking.<needed>')` ("חניה אחת" / "2 חניות", from `0006d`).
   - agree: "צריכים {{parking}} — יש". When needed is 0: "לא צריכים חניה" (`match.owner.parking.agreeNone`).
   - differ: "ביקשו {{parking}}, בדירה יש {{spots}}". When spots is 0: `match.owner.parking.differNone`
     "ביקשו {{parking}}, בדירה אין חניה".
   - Whenever `parking_spots < parking_needed`, the agree line uses the differ wording.
   - AC4's expected text "ביקשו 2 חניות, בדירה יש 1" does not change.
   - `0006f`'s seeker row "ביקשת {{needed}} חניות" has the same defect with 1 spot needed. Raise it with that spec.
4. (major) Checklist 5: some i18n keys have no value or no name. The `applicants.profile.*` labels, the `<dl>` yes/no
   values, the flexible suffix, the sort group label and the variant keys (`contract` ≥ 24 chip, pets with a pet,
   parking none) are not listed. **Fix:** add this table to UI (together with the keys named in 2 and 3):

   | key | value |
   | --- | --- |
   | `applicants.sort.label` | `מיון` |
   | `applicants.profile.household` | `משק בית` |
   | `applicants.profile.moveIn` | `תאריך כניסה` |
   | `applicants.profile.contract` | `משך חוזה רצוי` |
   | `applicants.profile.pets` | `חיות מחמד` (value `listing.yes` / `listing.no`: "יש" / "אין", as the artboard) |
   | `applicants.profile.smoker` | `מעשנים` (value `applicants.profile.yes` `כן` / `applicants.profile.no` `לא`) |
   | `applicants.profile.parking` | `חניה` (value `profile.parking.*`) |
   | move-in flexible in the `<dl>` | reuse `listings.fields.entryFlexible` ("גמיש ±2 שבועות") in parentheses |
   | `match.owner.pets.agreePet` | `עם חיית מחמד — מותר אצלך` |
   | `match.owner.short.contract.agreeLong` / `.agree` / `.differ` | `חוזה ארוך טווח` / `חוזה מתאים` / `חוזה קצר` |
5. (minor) The sort toggle's states contradict each other, and its comparator is underspecified.
   - The filters render only for a non-empty loaded list (`ApplicantsPage.tsx:143`, `:189`), so a toggle beside
     them is never shown while loading. "Disabled while loading" therefore cannot happen.
   - **Fix:** render the toggle only together with the filter group. Drop the disabled state. Give it its own
     `role="group"` with `aria-label` `applicants.sort.label`, outside the filter group (the tests' `filters()`
     helper scopes queries to that group).
   - "newest" sorts a copy of `shown` with `toSorted` (the `ES2023` lib is on), never the cached array (AC2's
     "match again restores A, B, C" pins this). The comparator is
     `Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id < b.id ? -1 : 1)`, the same order as `0006c`'s
     `created_at DESC, id`.
   - Do not compare `created_at` as strings. Pydantic drops zero microseconds, so a `…:00Z` string sorts after
     `…:00.5Z`.
6. (minor) `0006f` does not define `MatchChips`'s props. Its seeker inputs (`SeekerProfileOut`, a public listing) do
   not fit the owner's (`ApplicantProfileOut`, `MyListingOut`). **Fix:** state the interfaces here.
   - The props become a union on `voice`, as `ApplicationStatusChip`'s `viewer` (`0004d`):
     `{ voice?: 'seeker'; …0006f's props unchanged } | { voice: 'owner'; match: MatchOut; profile: ApplicantProfileOut }`.
   - Add `ownerShort(criterion, kind, profile, t)` and `ownerReason(criterion, kind, profile, spots: number, t)`.
   - The owner table reads only `parking_spots` from the listing. Drop the claim that it needs five `MyListingOut`
     fields.
   - `features/applicants/api.ts` exports `ApplicantProfileOut = components['schemas']['ApplicantProfileOut']`.
7. (minor) A move-in date in the past shows as a past date. `0006b` scores a past `move_in_date` as today, but the
   card would print it as-is (for example "כניסה 3.10.26"). **Fix:** every displayed profile date (summary,
   `<dl>`, the `move_in` lines and chip) shows the later of `move_in_date` and `todayInIsrael()`, formatted with
   `formatDate` (`features/listings/format.ts`). This matches how `0006f` treats `available_from`. Add one AC6
   case for it.
8. (minor) The card order is open, and `ux` / `0005b` will both touch the card. **Fix:** state the order:
   1. The name row: `<h2>`, the status chip, then `MatchBadge` or `match.noScore`.
   2. `applicants.appliedAt`.
   3. The summary line.
   4. The chips.
   5. The message.
   6. The disclosure button and its panel. The agree `<li>`s carry `0006f` `MatchCard`'s teal ✓ and the differ
      line its amber !, both icons `aria-hidden`. The `<dl>` follows. The panel's id is `${headingId}-why`, used by
      `aria-controls`.
   7. The actions row, which holds `0005b`'s chat link.

   Every card with a profile has the disclosure, declined cards included (see 1).
9. (minor) The test data does not cover what the ACs claim.
   - **Fixture defaults.** `applicant()` must default to `match: null, profile: null` (NF1).
     `buttonsOf()` (`ApplicantsPage.test.tsx:86`) lists every button in a card, so a default profile would add
     "למה ההתאמה?" and break `ac4` / `ac5`.
   - **AC4's explanation cannot happen.** `agrees [household, smoking, move_in]` with `differs parking` never comes
     out of `0006b`'s `explain`. Budget (25) and area (20) outrank household (10) whenever they agree, and a soft
     differs means nothing failed. Use `0006b` AC1 row 10 instead: score 98, agrees `[budget, move_in, area]`,
     differs `parking`, 2 needed, 1 spot. The household and smoking copy stays covered by AC6.
   - **AC5 cannot fail.** Have the PATCH return A with a different score (50, below B's 59). Then assert that A
     keeps its place in match order, shows "התאמה 50%", and has focus on its `<h2>`.
10. (minor) AC7 cannot fail: the fixtures hold no budget or area value. **Fix:** either drop AC7 (`0006c` AC6 proves
    the API never sends them) or make it check something: no "₪" inside any applicant `<article>` (the header price
    is the only one). That catches a budget line that interpolates the price.
11. (note, Risks) With `0006b`'s weights, the owner will usually see budget, move-in and area as the three lines and
    "בתקציב" as the chip. The artboard's household and smoking lines appear only when those fail. Add this to Risks
    so Gilad sees it in the digest. An owner-specific order would be a `0006b` change, not this spec's.
12. (note, cross-spec, nothing edited there)
    - `0006c` names the web half as `0006f` in Out, UI and Tests. It should be `0006g`.
    - The e2e OTP budget: `0005b` puts the suite at 9 of 10. `0006d`'s `profile.spec.ts` and `0006f`'s
      `match.spec.ts` each sign up a fresh owner and seeker, which makes 13. The `e2e` job this spec needs green then
      fails, unless those specs reuse signups or a CI-only limit override (FOLLOWUPS `0001b`) lands first.

## Digest (filled by orchestrator after verification)

    Spec 0006g - Inbox match web: scores, summary, chips, "למה ההתאמה?"   (verified, part 7 of 7, depends on 0006c, 0006f, 0005b)
    What a user can do after this: an owner's inbox is sorted by match (toggle "לפי תאריך"); each card shows the
             score or "אין ציון", "זוג · כניסה 1.1.27 (גמיש)", two chips and a disclosure with reasons + details.
    Decisions I need from you (non-blocking): 3. With these weights owners mostly see budget / move-in / area as
             the top reasons; household and smoking lines show only when they differ (recommend: accept for now).
    KPIs this slice moves: time from first applicant to first shortlist; decline rate.
    Acceptance targets: NF1 lint/test/i18n/build/e2e clean - NF2 aria-pressed toggle, real disclosure button.
    Risks: e2e declined-card button check breaks - mitigation: extends 0005b's inbox test, checks action buttons only.
    Reviewers: code, qa, ux   Estimated: 1 coder run, 1 review round
    Links: specs/0006g-inbox-match-web.md - PRODUCT.md "Matching" - design/screens-v1/Inbox.dc.html, InboxDesktop.dc.html
