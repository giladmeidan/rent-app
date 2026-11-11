---
id: 0006f
title: A seeker with a profile sees "התאמה 87%" on search cards and map pins, results sorted by match, and a "ההתאמה שלך" card on the listing page saying what fits and what does not
status: in-review
depends_on: [0006b, 0006d]   # 0006b: match on GET /listings(/{id}) and sort=match; 0006d: useProfile / PROFILE_KEY, the profile page the nudge links to, and the e2e flow AC10 extends
reviewers: [code, qa, ux]    # ux: new badge, card and nudge on two existing screens vs the artboards; qa: sort / URL rules, cache reset on logout
estimate: 1 coder run        # at the top of the range; coder on Opus/high (copy logic across eight criteria, a cache-privacy fix)
---

## Goal
After this ships, a seeker with a profile sees on `/search` a match badge on every card ("התאמה 87%") with up to
two short chips (the top agreeing and the differing criterion), the count line "38 דירות · ממוינות לפי התאמה"
with "לפי התאמה" in the sort menu (the default for them), map pins "7,200 ₪ · 87%", and on `/listings/:id` a
badge by the price and a "ההתאמה שלך" card: the score, a label (high / good / partial), up to three agreeing
lines and one differing line, in words built from the listing and their own profile. A seeker without a profile
sees a one-line nudge to fill it; visitors and owners see today's pages; logging out drops every score from the
screen. Serves Dev Plan slice 6, part f of seven (overview in `0006a`). Artboards: `Search.dc.html`,
`SearchDesktop.dc.html`, `Listing.dc.html` ("ההתאמה שלך 87% · התאמה גבוהה · על בסיס הפרופיל שלך והעדפות בעלת
הדירה", the agree lines and the amber line).

## Scope
**In:**
- `web/src/features/match/` (new) — props and signatures pinned (`0006g` builds on them; the reasons map is keyed
  by criterion so `0006g` adds `ownerShort` / `ownerReason` beside them):
  - `MatchBadge {score}` — a pill `match.badge` ("התאמה {{score}}%"); tone by bucket, as the artboards: high →
    `bg-accent text-white`; good and partial → `bg-[#E7E5E4] text-[#44403C]` (amber stays the "differs" colour).
  - `bucket.ts` — `bucket(score): 'high' | 'good' | 'partial'` (≥ 80, 60–79, < 60).
  - `reasons.ts` — `seekerReason(criterion, kind: 'agree' | 'differ', listing, profile: SeekerProfileOut, t) →
    string` and `seekerShort(criterion, kind, listing, profile: SeekerProfileOut | undefined, t) → string |
    null` (chips; `null` = omit: only the `move_in` differ chip needs the profile). Pure; the only place
    criterion codes become copy; variant rules in the UI table. Numbers via `formatIls`, dates via `formatDate`
    (`features/listings/format.ts`).
  - `MatchChips {match: MatchOut; listing: ListingPublic; profile: SeekerProfileOut | undefined}` — a `<ul
    data-testid="match-chips">` of up to two chips: `agrees[0]` (accent tint) and `differs` (amber), short copy.
  - `MatchCard` — the listing-page card (UI).
  - `ProfileNudge` — `match.nudge` + link `match.fillProfile` to `/me/profile?next=<encoded current path +
    search>`; rendered only for a seeker whose `useProfile()` is `null`.
- `web/src/features/auth/useLogout.ts`: `clearSession` also calls `queryClient.resetQueries` for `['search']`,
  `['search-map']` and `['listing']` (reset, not remove, so an open page refetches as the new viewer; `OtpForm`
  already calls `clearSession` on login). Correct the `usePublicListing.ts` comment ("the same for every visitor,
  kept across logout" is no longer true: `0006b` scores per caller and marks it `Cache-Control: private`).
- `web/src/features/search/filters.ts`: `SORTS` gains `'match'` (parsed from the URL like the others);
  `toSearchParams` **keeps** an explicit `sort`; `DEFAULT_SORT` is deleted — amends `0003b`'s URL rule and its
  AC2 / AC8 tests (Tests to write).
- `web/src/features/search/SortSelect.tsx` + `SearchPage.tsx`: the select's value is `search.data?.pages[0]?.sort`
  once an answer has arrived (the API decides from the cookie), else `(filters.sort === 'match' && !hasProfile) ?
  'newest' : filters.sort ?? (hasProfile ? 'match' : 'newest')`; the `match` option `search.sort.match` ("לפי
  התאמה") is rendered, as the **first** option, when `hasProfile || value === 'match'`.
- `web/src/features/search/ResultsList.tsx`: the count line gains `search.sortedByMatch` (" · ממוינות לפי
  התאמה") when the response's `sort` is `'match'` **and** `total > 0` (list view only; the map's count line is
  unchanged); `ListingCard` gets `badge={<MatchBadge/>}` and `children={<MatchChips/>}` when `item.match` is set
  (the existing slots).
- `web/src/features/search/SearchMap.tsx`: a pin's `text` becomes `search.map.pinTextMatch` ("{{price}} ₪ ·
  {{score}}%") and its `label` gains `search.map.pinMatch` (", התאמה {{score}}%") when set; the selected pin's card
  under the map gets the same badge and chips.
- `web/src/features/search/SearchPage.tsx`: `ProfileNudge` above the results.
- `web/src/features/listings/ListingPage.tsx`: `MatchBadge` next to the price when `listing.match`; `MatchCard`
  directly before `ApplySection`; nothing for `match: null` (the apply gate of `0006d` already invites a seeker
  without a profile). Final page order with `0006e`: description → `OwnerPreferences` → location → `MatchCard` →
  `ApplySection` (the artboard's).
- `web/e2e/helpers.ts`: `postListing(page, street, overrides: Record<string, unknown> = {})`, spread into `data`.
- `web/src/locales/he.json`: `match.*`, `search.sort.match`, `search.sortedByMatch`, `search.map.pinMatch`,
  `search.map.pinTextMatch`.

**Out:**
- The owner inbox: `0006g`. Weights / formula: API (`0006b`).
- Re-fetch on profile save: none added. Navigation refetches (TanStack's default `staleTime` 0, `app/App.tsx`
  sets only `retry`), so returning to `/search` or a listing after saving shows the new score (the cached list
  shows for a moment first). Optional for the coder: the same `resetQueries` in `0006d`'s `useSaveProfile`.
- "שמור חיפוש", the desktop side-panel layout (FOLLOWUPS `0003b`), nearby-places line: later.

**New dependencies:** none.

## Data
None (web only).

## API
Reads `match` and `sort` from `GET /listings` / `GET /listings/{id}` (`0006b`) and `GET /me/profile`
(`0006a`, via `0006d`'s `useProfile`). Sends `sort=match` only when chosen. `make client` before building.

## UI
Copy (`he.json`; `{{…}}` from the listing and profile; the seeker voice is second person, as the artboard;
`{{household}}` = `t('profile.household.' + profile.household)`, `{{households}}` = `listing.accepted_households`
in API order mapped through `profile.household.*` and joined with `new Intl.ListFormat('he', { type:
'disjunction' })` — never a hardcoded " או " in a `.ts` file, which `i18n-check` does not scan):

| criterion | agree (`match.seeker.<c>.agree…`) | differ (`match.seeker.<c>.differ…`) | chips (`match.short.<c>.…`) |
| --- | --- | --- | --- |
| budget | "התקציב שלך (עד {{budget}} ₪) מתאים למחיר" | "המחיר ({{price}} ₪) מעל התקציב שלך ({{budget}} ₪)" | "בתקציב" / "מעל התקציב" |
| move_in | "תאריך הכניסה שלך ({{date}}) תואם" — date = the later of `profile.move_in_date` and today | `differLate` "הכניסה לדירה ({{date}}) מאוחרת מדי" (date = `available_from`, always future) when the listing's date is after the seeker's · `differEarly` "הדירה פנויה כבר מ־{{date}}" when earlier and `available_from` > today · `differNow` "הדירה פנויה כבר עכשיו" when `available_from` ≤ `todayInIsrael()` | "מועד כניסה תואם" / "כניסה מאוחרת מדי" · "כניסה מוקדמת מדי" (differ chip needs the profile; omitted without) |
| area | "באזור שבחרת" | "מחוץ לאזורים שבחרת" | "באזור שלך" / "מחוץ לאזור המועדף" |
| household | "מתאים ל{{household}} — כמוך" | "בעל הדירה מחפש {{households}}" | "מתאים למשק הבית" / "משק בית אחר" |
| contract | "משך החוזה שביקשת מתאים" | "בעל הדירה מבקש חוזה של {{months}} חודשים לפחות" (`listing.min_contract_months`, never null when contract differs) | "חוזה מתאים" / "חוזה קצר מדי" |
| parking | `agreeNotNeeded` "לא ביקשת חניה" (`parking_needed` 0) · `agree` "יש חניה כפי שביקשת" (spots ≥ needed) · `agreePartial` "יש מקום חניה אחד מתוך 2 שביקשת" (2 vs 1) | `differNone` "ביקשת חניה — בדירה אין חניה" (spots 0) · `differ` "ביקשת {{needed}} חניות — בדירה יש {{spots}}" (`{{spots}}` = `listing.parkingOne` / `listing.parkingMany`: "ביקשת 2 חניות — בדירה יש מקום אחד") | spots > 0 "חניה", else `agreeNotNeeded` "חניה לא נדרשת" / "חסרה חניה" |
| smoking | `smoking_allowed` false → "ללא מעשנים — ואת/ה לא מעשן/ת"; true → "מותר לעשן" | "בעל הדירה מבקש ללא מעשנים" | "עישון מתאים" / "ללא מעשנים" |
| pets | `pets_allowed` → "חיות מחמד מותרות"; else `agreeNoPets` "ללא חיות מחמד — ואין לך חיית מחמד" | "ללא חיות מחמד" | "חיות מחמד" · `agreeNoPets` "בלי חיות — מתאים" / "ללא חיות מחמד" |

**MatchCard** (`<section aria-labelledby>`, as the artboard): heading `match.card.title` ("ההתאמה שלך"), the score
large `match.card.score` ("{{score}}%"), `match.bucket.{high,good,partial}` ("התאמה גבוהה", "התאמה טובה",
"התאמה חלקית"), sub-line `match.card.basis` ("על בסיס הפרופיל שלך והעדפות בעל הדירה"), a `<ul>` of the `agrees`
lines with a teal ✓ icon (`aria-hidden`) and, when `differs`, one line with an amber ! icon; then a link
`match.card.edit` ("עריכת הפרופיל") to `/me/profile?next=${encodeURIComponent('/listings/' + id)}`, ≥ 44 px.
Skeleton lines only while `profile.isLoading` (pending **and** fetching: a disabled query never stops pending);
with no profile data otherwise, score and bucket only.

**Badges and chips**: `MatchBadge` in the card's price row (`ListingCard`'s `badge` slot) and on the listing page
next to the price; chips in the card body, wrapping (not interactive). "87%" is one European-number run (bidi rule
W5): no `dir` attribute.

**ProfileNudge**: one line in the artboard's tint box, `match.nudge` ("רוצה לראות ציון התאמה לכל דירה? ממלאים
פרופיל קצר פעם אחת.") and the link `match.fillProfile` ("מילוי פרופיל"), ≥ 44 px target.

All RTL with logical properties.

## Acceptance criteria
Vitest + Testing Library with the search / listing harnesses (`features/search/__tests__/fixtures.ts`,
`features/listings/__tests__/fixtures.ts`); profile fixture from `features/profile/__tests__/fixtures.ts`
(`0006d`). AC2 asserts rendered Hebrew strings, not keys.
- [ ] AC1 `bucket` and `MatchBadge`: 80 → high + accent classes; 79 and 60 → good, 59 → partial, both neutral `#E7E5E4`; the text is "התאמה {{score}}%" — `web/src/features/match/__tests__/MatchBadge.test.tsx::ac1_buckets`
- [ ] AC2 `reasons.ts` for every criterion × agree/differ and each variant returns the table's string with the right values: budget 7500 / price 7600; households `["couple","family"]` → "בעל הדירה מחפש זוג או משפחה", three → "יחיד/ה, זוג או שותפים"; contract 12 → "בעל הדירה מבקש חוזה של 12 חודשים לפחות"; parking (0, any) `agreeNotNeeded`, (1, 1) `agree`, (2, 1) as agree `agreePartial`, (1, 0) `differNone`, (2, 1) differ "ביקשת 2 חניות — בדירה יש מקום אחד"; pets allowed / not with no pets; smoking both sides; `move_in` `differLate` / `differEarly` / `differNow` by date order, and a past stored move-in shown as today in the agree line; `seekerShort` returns `null` for the `move_in` differ chip without a profile — `web/src/features/match/__tests__/reasons.test.ts::ac2_reason_copy` (parametrized)
- [ ] AC3 Given a seeker with a profile (resolved) and `GET /listings` answering `sort: "match"` with items scoring 100 (agrees `[budget, move_in, area]`, no differs) and 59 (differs `move_in`), Then the count line ends with "· ממוינות לפי התאמה", the first card shows "התאמה 100%" and only the chip "בתקציב" in its `match-chips` list, the second "התאמה 59%" with "בתקציב" and the amber "כניסה מאוחרת מדי"; with the profile request answering 500, Then the badges and "בתקציב" but no `move_in` chip — `web/src/features/search/__tests__/SearchPage.test.tsx::ac3_cards_show_match`
- [ ] AC4 Given a seeker with a profile at `/search` (no `sort` in the URL), Then the select shows "לפי התאמה" (first option) selected and the request has no `sort` param; choosing "החדשות ביותר" puts `sort=newest` in the URL and the request; given a seeker without a profile, Then no match option and newest selected; given the profile request pending or answering 500 with a search answer of `sort: "match"`, Then the select shows match; given `/search?sort=match` for a visitor with an answer of `sort: "newest"`, Then the select shows newest and the count line has no "ממוינות לפי התאמה" — `SearchPage.test.tsx::ac4_sort_select_and_url`
- [ ] AC5 `filters.ts`: `parseFilters('sort=match')` keeps it; `toSearchParams(parse('sort=newest&pets=true'))` is `'pets=true&sort=newest'`; every other canonical-URL case unchanged — `web/src/features/search/__tests__/filters.test.ts::ac5_match_sort_in_url`
- [ ] AC6 Given the map view and items with `match`, Then each pin's text is "7,200 ₪ · 87%" and its accessible label ends with ", התאמה 87%"; items with `match: null` keep today's text; the selected pin's card shows the badge and chips; the map's count line has no "ממוינות לפי התאמה" — `web/src/features/search/__tests__/SearchMap.test.tsx::ac6_pins_show_match`
- [ ] AC7 Given a seeker whose `GET /me/profile` is 404 `{"detail":"seeker_profile_not_found"}`, Then `/search` shows `match.nudge` with a link to `/me/profile?next=` + the encoded current `/search?…`; given a profile, a visitor or an owner, Then no nudge (and a visitor / owner sends no `GET /me/profile`) — `SearchPage.test.tsx::ac7_profile_nudge`
- [ ] AC8 Given `GET /listings/{id}` with `match {score: 87, agrees: [budget, move_in, contract], differs: parking}` and the seeker's profile (budget 7500, parking 2; listing parking 1), Then the page shows "התאמה 87%" by the price and a section `match.card.title` with "87%", "התאמה גבוהה", three list items with the agree copy and one with "ביקשת 2 חניות — בדירה יש מקום אחד", before the apply section, and an edit link with `href` `/me/profile?next=%2Flistings%2F<id>`; with `match: null`, Then no badge and no section — `web/src/features/listings/__tests__/ListingPage.test.tsx::ac8_match_card`
- [ ] AC9 Given the listing page with `match` set and the profile request in flight, Then score and bucket render with skeleton lines; with the profile request failed, Then score and bucket only, no reason lines and no skeleton — `ListingPage.test.tsx::ac9_match_card_without_profile_numbers`
- [ ] AC10 Given `make dev` is up, When `web/e2e/applications.spec.ts::ac9_fill_profile_apply_withdraw` (`0006d`) runs — its owner also posts, before the seeker signs up, a second listing at 7600 (`postListing(page, <unique street>, { price_ils: 7600 })`), and its seeker's profile form is filled with `P` (budget 7500, move-in `israelDay(30)`, the listing's area, couple, no pets, non-smoker, 24 months, parking 1) — Then, in a `test.step('ac10 …')` after the apply / withdraw steps: `/search`'s count line has "ממוינות לפי התאמה" and the fitting listing's card (found by its unique street) is on the first page with "התאמה 100%"; the 7600 listing's page shows "התאמה 59%" and its budget differ line; the fitting listing's page shows the `match.card.title` section. No new signup, no overall-order assertion (the shared e2e database holds other 100s; `0006b` AC2 proves the order) — `web/e2e/applications.spec.ts::ac9_fill_profile_apply_withdraw` (extended)
- [ ] AC11 Given a seeker on `/search` with a scored card and a second `GET /listings` answering `match: null`, When logging out through `AuthMenu`, Then no "התאמה" badge text remains — `web/src/features/match/__tests__/logout.test.tsx::ac11_logout_drops_scores` (modelled on `listings/__tests__/logout.test.tsx`)
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` clean; no hardcoded copy (the % sign is inside the i18n strings); logical properties only; the amended existing tests in Tests to write pass — CI `web`, `e2e`
- [ ] NF2 Accessibility at 390 px: the badge's text is readable by screen readers as part of the card (no colour-only meaning: the bucket word is in the card, the chips carry words); the card is a labelled `section`; ✓ / ! icons `aria-hidden` — ux reviewer

## Tests to write
Unit: `features/match/__tests__/reasons.test.ts` (AC2), `MatchBadge.test.tsx` (AC1), `logout.test.tsx` (AC11),
`filters.test.ts` (AC5). Component: `SearchPage.test.tsx` (AC3, AC4, AC7), `SearchMap.test.tsx` (AC6),
`ListingPage.test.tsx` (AC8, AC9). E2E: `applications.spec.ts` extended (AC10) + `helpers.ts` `postListing`
overrides. Existing tests amended (`0003b` AC2 / AC8): `filters.test.ts` `ac8_filter_rules` (the mixed URL uses
`sort=foo` instead of `sort=match`; `['sort=match', {sort: 'match'}, 0]` moves to the valid table and `'sort=foo'`
joins the invalid list; `:101-102` becomes `toSearchParams(parse('sort=newest&pets=true'))` →
`'pets=true&sort=newest'`); `SearchPage.test.tsx` `ac2_url_is_the_filter_state` (the mixed URL uses `sort=foo`);
`ac6`'s three-option list stays (no `/me` mock = a visitor). Fixtures: if `0006b` has not already, `publicListing()`
gains `match: null` and `page(items, total = items.length, sort: SearchSort = 'newest')`.

## Risks / open questions
- Copy is the orchestrator's, built from the artboard lines; household / contract / smoking agree lines have no
  artboard source. Gilad can amend wording in the digest.
- `toSearchParams` keeping `sort=newest` changes canonical URLs for anyone who picks "newest" explicitly — the
  only way to ask a seeker-with-profile's search for newest order. Old links without `sort` keep working.
- A seeker whose profile changes in another tab sees the old score on `/search` until the next refetch (focus
  refetch); the listing page (`refetchOnWindowFocus: false`) until the next navigation. Acceptable.
- `0006e` also edits `ListingPage.tsx` and `he.json`; the two web specs never build at the same time (port 5173);
  whichever merges second rebases, keeping the page order in Scope.
- No open product questions.

## Verifier findings — one round, 12 findings, all applied (kept as one spec, coder Opus/high)
Verdict: **would reject as written.** Findings 6 and 7 turn `make test`, `make lint` or `make e2e` red on the
coder's first run. Findings 1, 2 and 4 ship wrong copy or leak one seeker's scores to the next person on the
device. Every finding comes with its exact fix, so the orchestrator can apply them and mark the spec verified.
Checklist: lines 1–4 and 7–9 pass; line 5 fails (keys missing, findings 2, 10 and 11), line 6 fails (search-page
states while the profile loads, finding 9), line 10 fails (files missing from Scope, findings 4, 6 and 7).
PRODUCT.md "Matching" and "Search": no contradiction. Scope fits one coder run, at the top of the range (note at
the end).

1. (major) Some agree lines are false. In `0006b`, `m_pets = 1` for any seeker without pets, `m_parking = 1` when
   `parking_needed = 0`, `m_smoking = 1` for any non-smoker, and `agrees` takes any criterion with `m ≥ 0.5`
   (parking 2 wanted vs 1 spot is 0.5). These criteria reach `agrees` whenever three of budget / move_in / area /
   household / contract do not agree. That is common now that capped listings stay in results. So "חיות מחמד
   מותרות" and the chip "חיות מחמד" would show on a listing that refuses pets, and "יש חניה כפי שביקשת" on a
   listing with no parking for a seeker who asked for none. **Fix:** choose each of these agree lines from the
   facts that made it agree, and add the rows to AC2:
   - pets: `listing.pets_allowed` → `agree` "חיות מחמד מותרות" and short "חיות מחמד"; otherwise → `agreeNoPets`
     "ללא חיות מחמד — ואין לך חיית מחמד" and short `agreeNoPets` "בלי חיות — מתאים".
   - parking (long): `profile.parking_needed === 0` → `agreeNotNeeded` "לא ביקשת חניה";
     `listing.parking_spots >= parking_needed` → `agree` "יש חניה כפי שביקשת"; otherwise (2 vs 1) →
     `agreePartial` "יש מקום חניה אחד מתוך 2 שביקשת". Short: `parking_spots > 0` → "חניה", otherwise
     `agreeNotNeeded` "חניה לא נדרשת". The short form needs only the listing.
   - smoking: keep the table's two variants, keyed on `smoking_allowed`.
2. (major) Three differ lines come out as broken Hebrew, and one also differs from the artboard:
   - contract: "בעל הדירה מבקש חוזה ל{{months}} לפחות" renders "חוזה ל12 לפחות". **Fix:** "בעל הדירה מבקש חוזה
     של {{months}} חודשים לפחות", with `{{months}}` = `listing.min_contract_months`. It is never null when
     contract differs.
   - parking: parking differs only for (needed, spots) = (1, 0), (2, 0) or (2, 1), so the current line renders
     "ביקשת 1 חניות". **Fix:** spots 0 → `differNone` "ביקשת חניה — בדירה אין חניה"; spots ≥ 1 → `differ`
     "ביקשת {{needed}} חניות — בדירה יש {{spots}}", where `{{spots}}` = `t('listing.parkingOne')` /
     `listing.parkingMany` (existing keys). That renders the artboard's exact line "ביקשת 2 חניות — בדירה יש מקום
     אחד". AC8 expects that string, not "… יש 1".
   - household: `{{households}}` = `listing.accepted_households` in API order (`0006a` already returns them in
     `HOUSEHOLDS` order, so the web needs no constant), mapped through `profile.household.*` (`0006d`) and joined
     with `new Intl.ListFormat('he', { type: 'disjunction' })`. That gives "זוג או משפחה" and "יחיד/ה, זוג או
     שותפים"; AC2 expects these strings. Do not hardcode " או " in `reasons.ts`: it is a `.ts` file, which
     `i18n-check` does not scan. The agree line's `{{household}}` = `t('profile.household.' + profile.household)`,
     giving "מתאים לזוג — כמוך".
   - State the formatters in the UI section: `{{budget}}` / `{{price}}` use `formatIls`, dates use `formatDate`.
3. (minor) The `move_in` direction rule is consistent with `0006b`. `differs = move_in` means `d > 0`, so the
   two clamped dates differ, and clamping either side to today never flips the order. Only the `{{date}}` values
   need pinning:
   - `differLate`: `listing.available_from`, which is always in the future.
   - `differEarly`: when `available_from ≤ todayInIsrael()`, use `differNow` "הדירה פנויה כבר עכשיו". The page
     above already says "כניסה מיידית", so a past date here would contradict it.
   - the agree line: the later of `profile.move_in_date` and today. A stored date may have passed (`0006a`);
     `0006g` uses the same rule.
   Add these rows to AC2.
4. (major) Scored results survive logout and login. `['search', …]`, `['search-map', …]` and `['listing', id]`
   are not under `['me', …]`, so `clearSession` (`features/auth/useLogout.ts:16`) keeps them.
   `usePublicListing.ts:5-8` even says "the same for every visitor, kept across logout". `0006b` makes that false
   and marks these responses `Cache-Control: private`. Two repros:
   - A seeker logs out on `/search`. The open page keeps their badges and "מעל התקציב" chips, because the query
     key does not change and nothing refetches.
   - On a listing page, the badge stays. `useProfile` is now disabled, so TanStack v5 reports it as `isPending`
     forever, and the card shows skeleton lines forever.
   **Fix:** add `features/auth/useLogout.ts` to Scope. `clearSession` also calls `queryClient.resetQueries` for
   `['search']`, `['search-map']` and `['listing']`. Use reset, not remove, so the open page refetches as the new
   viewer; `OtpForm` already calls `clearSession` on login. Correct the `usePublicListing` comment. New AC11:
   - Given a seeker on `/search` with a scored card and a second `GET /listings` answering `match: null`, When
     logging out through `AuthMenu`, Then no `match.badge` text remains.
   - Test: `web/src/features/match/__tests__/logout.test.tsx::ac11_logout_drops_scores`, modelled on
     `listings/__tests__/logout.test.tsx`.

   Out-line correction: "no refetch needed" is right for navigation. `App.tsx:12` sets only `retry`, so
   `staleTime` is 0 and both queries refetch on mount. But the cached, unscored list shows first for a moment.
   Optional: call the same reset in `0006d`'s `useSaveProfile` `onSuccess`. Also, the Risks line's "focus
   refetch" does not apply to the listing page (`refetchOnWindowFocus: false`).
5. (major) The sort select and the list can disagree. `hasProfile` comes from `GET /me/profile` (after `GET
   /me`), while the API picks the order from the cookie on the search request itself, and the two requests race.
   On first load, the list can arrive in match order with "ממוינות לפי התאמה" while the select shows "החדשות
   ביותר" and has no match option. If the profile request fails, it stays that way.
   **Fix:**
   - Once an answer has arrived, it decides: `value = search.data?.pages[0]?.sort ?? <the spec's rule>`.
   - Render the `match` option when `hasProfile || value === 'match'`, as the first option.
   - Delete `DEFAULT_SORT`.

   AC4 changes:
   - Add a case: profile request pending, or answering 500, with a search answer of `sort: "match"` → the
     select shows match.
   - Replace "the API answer's `sort: "newest"` is respected" with "the count line has no `search.sortedByMatch`".
6. (blocker) Existing tests break, and the spec does not name them:
   - `filters.test.ts` `ac8_filter_rules`: `'sort=match'` is in the invalid list (`:65`) and in the mixed URL
     (`:90`), and `:101-102` asserts that `newest` is omitted.
   - `SearchPage.test.tsx` `ac2_url_is_the_filter_state` (`:98`) expects the mixed URL with `sort=match` to send
     only `limit` and `offset`.

   **Fix:** in both mixed URLs use `sort=foo`. Move `sort=match` to the valid table as `['sort=match', {sort:
   'match'}, 0]` and add `'sort=foo'` to the invalid list. `:101-102` becomes
   `toSearchParams(parse('sort=newest&pets=true'))` → `'pets=true&sort=newest'`. Say that `0003b` AC2 and AC8
   are amended, not only its URL rule. `ac6`'s three-option list stays: with no `/me` mock the viewer is a
   visitor.

   Fixtures: `0006b` declares `ListingPublic.match` and `ListingSearchOut.sort` without a default, so they are
   required in `schema.d.ts`. Its UI section says the web needs no change, but `publicListing()` and `page()` in
   `search/__tests__/fixtures.ts` stop type-checking at its `make client`. If `0006b` does not add them, this
   spec does: `match: null` in `publicListing`, and `page(items, total = items.length, sort: SearchSort =
   'newest')`. AC3 needs `sort` anyway.
7. (blocker) AC10 breaks the e2e OTP budget and is flaky.
   - **Budget.** The suite uses 9 signups (auth 1, applications 2, inbox 2, search 1, map 1, listings 2) against
     the API's limit of 10 OTP requests per IP per 15 min (`0005b` Risks). `0006d`'s `profile.spec.ts` adds 2,
     making 11. AC10 adds 2 more, making 13. **Fix:** no new signup. AC10 extends the flow in which `0006d`'s
     seeker saves the profile (`profile.spec.ts::ac9_fill_profile_then_apply` as drafted) as
     `test.step('ac10 …')`. Its owner posts the second listing before the seeker signs up. `0006d`'s own overflow
     needs the CI-only limit override (FOLLOWUPS `0001b`); that is for its verifier or the orchestrator.
   - **Order.** "the fitting listing is first" is not stable. The shared e2e database and the spec files running
     in parallel keep posting 7,200 ₪ listings available in 30 days, which score 100 for this profile and can
     sit above it. The over-budget listing (≤ 59) sinks below every listing scoring 60 or more, and after a few
     local runs it is off the first page. **Fix:** assert that
     - the count line has "ממוינות לפי התאמה";
     - the fitting card, found by its unique street, is on the first page with "התאמה 100%";
     - the over-budget listing's page shows "התאמה 59%" and the budget differ line;
     - the fitting listing's page shows the `match.card.title` section.
     `0006b` AC2 and AC3 here already prove the order.
   - **Helper.** `postListing` (`e2e/helpers.ts:86`) hardcodes 7200. Scope gains `postListing(page, street,
     overrides: Record<string, unknown> = {})`, spread into `data`. The over-budget listing is 7600 (`0006b` AC1
     row 2 → 59).
8. (minor) The badge colours contradict the artboards. All three artboards give ≥ 80 (87 %, 82 %) a solid
   `{{accent}}` background with white text, and both 64 % and 58 % `#E7E5E4` / `#44403C`. The spec's colours (a
   tint for high, `#F5F5F4` for good, amber for partial) match none of these. Amber is the README's colour for
   "differs / new" and would sit right next to the amber differ chip. **Fix:** high → `bg-accent text-white`;
   good and partial → `bg-[#E7E5E4] text-[#44403C]`. AC1: 80 → accent; 79, 60 and 59 → neutral, with the bucket
   still asserted as high / good / partial.
9. (minor) The spec does not say what the search page shows while the profile is pending or failed. Only the
   direction of the `move_in` differ chip needs the profile (the other short chips need only the listing, after
   finding 1). **Fix:**
   - `seekerShort(criterion, kind, listing, profile: SeekerProfileOut | undefined, t)`. Rename `shortReason` to
     `seekerShort`, to match `0006g`'s `ownerShort`.
   - Without a profile, the `move_in` differ chip is omitted and the badge stays.
   - AC3 asserts only after the profile has resolved, and gains a case: profile 500 → the badge and "בתקציב", no
     `move_in` chip.
   - `MatchCard`: show skeleton lines only while `profile.isLoading` (pending and fetching). With no data
     otherwise, show score and bucket only. A disabled query never stops pending.
10. (minor) Map view:
    - Adding `search.sortedByMatch` to `search.map.tooMany` reads "…לראות את כולן. · ממוינות לפי התאמה", and
      pins have no order to describe. **Fix:** add it in `ResultsList` only, and only when `total > 0` (not "0
      דירות · …").
    - The pin text `${price} ₪ · ${score}%` puts the % sign in code, against NF1. **Fix:** a key
      `search.map.pinTextMatch` "{{price}} ₪ · {{score}}%".
    - State that the card under the map for the selected pin (`SearchMap.tsx:113-116`) gets the same badge and
      chips.
    - The card's large score "87%" also needs a key: `match.card.score` "{{score}}%".
11. (minor) Small gaps:
    - The `match.card.edit` href is encoded as `0006d`'s gate does
      (`/me/profile?next=${encodeURIComponent('/listings/' + id)}`), with a ≥ 44 px target.
    - The RTL note "`dir="ltr"` … only if the percent sign misplaces" leaves the call to the coder. "87%" is one
      European-number run (bidi rule W5) and renders as the artboard does: no `dir`.
    - AC2 asserts the rendered Hebrew strings, not keys. `i18n-check` sees neither `.ts` files nor dynamic keys.
    - `MatchChips` renders a `<ul data-testid="match-chips">`, so AC3's "only" is counted apart from
      `ListingCard`'s `listing-chips`.
    - AC7's 404 mock uses whatever `detail` `0006a` / `0006d` settle on (`seeker_profile_not_found` if `0006a`
      finding 7 is applied).
12. (minor, other specs) Two other specs touch the same code:
    - `0006g` (verified) builds on this module with "0006f's props unchanged", so pin them. `MatchBadge {score}`;
      `MatchChips {match: MatchOut; listing: ListingPublic; profile: SeekerProfileOut | undefined}`;
      `seekerReason(criterion, kind, listing, profile, t)` and `seekerShort(…)` as in finding 9. Keep the
      reasons map keyed by criterion, so `0006g` can add `ownerShort` / `ownerReason` beside them.
    - `0006e` also edits `ListingPage.tsx` and `he.json`. It places `OwnerPreferences` between the description
      and the location. Add to Risks: the two web specs never build at the same time (port 5173); whichever
      merges second rebases. The final order is description → `OwnerPreferences` → location → `MatchCard` →
      `ApplySection`, the artboard's order.

Verifier note on scope: one coder run fits. The spec touches two existing screens, adds one small module, needs
no API work and adds about 50 keys, but with the amendments above it sits at the top of the range. If the
orchestrator wants margin, move the listing-page half into `0006h` (`depends_on: [0006f]`): `MatchCard`, the long
`match.seeker.*` copy, AC8, AC9 and the e2e listing-page assertions. `0006g` would then depend only on `0006f`.
Run the coder on Opus/high: copy logic across eight criteria and a cache-privacy fix.

## Digest (filled by orchestrator after verification)

    Spec 0006f - Match web: badges, sort by match, pins, the listing-page match card   (verified, part 6 of 7, depends on 0006b, 0006d)
    What a user can do after this: a seeker with a profile sees "התאמה 87%" + two chips on search cards and pins,
             "ממוינות לפי התאמה" with match as the default sort, and a "ההתאמה שלך" card on the listing page; a
             seeker without a profile sees a nudge; logout drops every score from the screen.
    Decisions: none new (copy is mine).
    KPIs this slice moves: click-through from search to listing; apply rate on listings scoring >= 80.
    Acceptance targets: NF1 lint/test/i18n/build/e2e clean - NF2 score never colour-only, labelled card.
    Risks: one seeker's scores surviving logout - mitigation: clearSession resets search/listing caches (AC11).
             Top of one coder run - mitigation: Opus/high coder; split listing-page half to 0006h if it overruns.
    Reviewers: code, qa, ux   Estimated: 1 coder run (Opus/high), 1 review round
    Links: specs/0006f-match-web.md - PRODUCT.md "Matching", "Search" - design/screens-v1/Search.dc.html, SearchDesktop.dc.html, Listing.dc.html

    Spec 0006f - Match web: badges, sort by match, pins, the listing-page match card   PR OPEN (not merged)
    Shipped: a seeker with a profile sees "התאמה N%" + up to two chips on search cards, "7,200 ₪ · 87%" pins,
             match as the default sort with "· ממוינות לפי התאמה", and a "ההתאמה שלך" card on the listing page;
             a seeker without a profile gets a nudge to /me/profile; logout/login reset every scored cache.
    Demo: make dev -> sign up as seeker, fill /me/profile -> /search shows badges sorted by match -> open a
          listing: badge by the price + the card -> log out: scores gone.
    Tests: +9 unit (AC1-AC9, AC11; AC2 covers 43 copy cases), +0 integration, +1 e2e step (AC10, no new signup)
    Findings: 0 blockers, 0 majors; 4 minors fixed (chip key, AC5 test name, skeleton role=status,
              useSaveProfile resets search caches), 4 minors to FOLLOWUPS, 8 nits dropped
    Changed in PRODUCT.md: nothing
    Next: 0006e (owner preferences web) on port 5173, then 0006g (reuses features/match).
