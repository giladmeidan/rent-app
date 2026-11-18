---
id: 0024a
title: "homie launches with no promise of a rent estimate and no nadlan.gov.il content in its public pages or test data"
status: verified
depends_on: []
reviewers: [code]   # text, test data and one static page; no behaviour change
estimate: 1 coder run   # coder Sonnet/medium (mechanical; the wording is fixed here; the fixture work is the bulk)
---

## Goal
After this ships, nothing a visitor reads promises a rent estimate or names nadlan.gov.il as a source, the settlement
list credits CBS, and the current tree of the public repo holds no copy of nadlan.gov.il files.

Serves PRODUCT.md "Rent price estimate" and "Launch area" (changed 2026-11-18): nadlan.gov.il's terms forbid commercial
use without prior written approval and automated collection, and Gilad postponed the estimate engine past launch.

## Scope
**In:**
1. `web/src/locales/he.json`:
   - `legal.terms.s6` stops describing an estimate and becomes the data-source credit. Keeping the section keeps the
     numbering of sections 7 onward. Replace every other key under `legal.terms.s6`, if any.
     - `title`: `6. מקורות מידע`
     - `p1`: `רשימת היישובים בהומי מבוססת על: הלשכה המרכזית לסטטיסטיקה (הלמ״ס), קובץ היישובים 2023 (נשלף ב־17.11.2026), https://data.gov.il/he/datasets/cbs/localities-in-israel, בעיבוד של הומי, לפי רישיון השימוש של הלמ״ס: https://www.cbs.gov.il/en/Pages/Enduser-license.aspx. הלמ״ס אינה קשורה להומי ואינה ממליצה על השירות.`
   - `listings.closure.intro`: `התשובה פרטית ולא מוצגת באתר. היא עוזרת לנו להבין את שוק השכירות.`
2. `web/src/features/legal/LegalPage.tsx:57`: add `[overflow-wrap:anywhere]` to the paragraph (pattern:
   `ApplicantCard.tsx:209`), so the long URLs do not scroll the page sideways at 320 px. The URLs stay plain text. Do
   **not** wrap them in `<bdi>`: `LegalPage.test.tsx:67` requires every `<bdi>` to be the contact email.
3. `waitlist/public/index.html`: remove the list item promising a rent estimate from official data (line 81 at
   `f9f3906`), keeping the list valid.
4. `api/tests/fixtures/rent_reference/`: replace the contents with invented data in the same JSON shape.
   - Keep `settlement_5000.json` and `settlement_565.json` and their `settlementID`s: these are CBS codes, already in
     `api/data/settlements.csv`, and `parse_rent_file` rejects a file whose id differs from the one requested.
   - Rename `neighborhood_65210029.json` to `neighborhood_99000001.json`. Neighbourhood ids become 99000001 (has a
     file) and 99000002 (no file).
   - Invent every name, street title, street id, coordinate and price, including `countryPrice` and the top-level price
     fields. Keep the shape, years, months, `numRooms`, `hasDeals` and `version`.
   - Tel Aviv coordinates: `x=180000, y=666000`, which must stay inside the box at `test_rent_reference.py:192-193`.
     Recompute `REVIVIM_CENTRE` with PostGIS, and replace the literal at `test_migrations.py:2658`.
   - Keep what the tests rely on: Tel Aviv lists two neighbourhood ids, one with a file, and one id stays a string
     (`settlement_5000.json:158`). The neighbourhood has 6 street rows with 1 repeat (`test_rent_reference.py:172`). All
     its 4-room quarters are null, and 3-room 2025-06 is null (`:176-177`). Azor lists no neighbourhoods, 5-room Q2 2026
     is null (`:151`), and it has exactly three 3-room figures, at 2026-06, 2026-03 and 2025-09 (`:319`).
   - Update: `test_rent_reference.py:36-37,63-65,140,146-147,158-159,169-170,178,251,265-266,527`; `:230`, whose leak
     check must use the **new** names or it passes without checking anything; `test_areas.py:33-34,105,112,114,136,140,148,155,161,164,172,174`;
     `test_seed.py:44-46`.
   - Leave alone (own literals, they do not read these fixtures): `conftest.py:309`, `test_rent_estimate*.py`,
     `test_hardening.py:85`, `test_listings.py:356`, `test_profiles.py:718`, `DetailsStep.test.tsx`.

**Out:**
- The estimate engine, `/rent-estimate`, the rent import code and the `listings.estimate.*` strings stay in place and
  dormant. With `RENT_REFERENCE=off` the rent tables stay empty, the API answers `no_figures` and the listing wizard
  shows no hint.
- `import_areas` and the runbook: spec 0013a, in progress, makes production settlements-only.
- Purging old fixture versions from git history.
- Deploying the waitlist: the orchestrator does this after the merge (approved by Gilad 2026-11-18).
- `specs/FOLLOWUPS.md`: the coder leaves it alone; the orchestrator updates it at archive time.
- The rest of the legal text (FOLLOWUPS "Before going public").

**New dependencies:** none.

## Data
None.

## API
No change.

## UI
Terms page: section 6's text, plus wrapping long words in legal paragraphs. Listing closure dialog: one sentence.
Waitlist page: one list item fewer. No new states. RTL: the URLs read left to right inside the Hebrew paragraph and stay
plain text.

## Acceptance criteria
- [ ] AC1 Given `he.json`, Then `legal.*` holds neither `nadlan` nor `הערכת שכר דירה`, and `legal.terms.s6` is the credit above: `web/src/features/legal/__tests__/LegalPage.test.tsx::ac1_terms_s6_is_the_cbs_credit`.
- [ ] AC2 Given a `no_figures` answer, Then the listing details step renders no estimate hint: existing `ac11 rent estimate hint`, `web/src/features/listings/__tests__/DetailsStep.test.tsx:596-615` (no new test).
- [ ] AC3 Given `waitlist/public/index.html`, Then it holds neither `nadlan` nor `הערכת שכר דירה`: `waitlist/test/build.test.js::ac3_no_rent_estimate_promise`.
- [ ] AC4 Given the replaced fixtures, Then `make test` passes, and the sets of names, neighbourhood ids, street ids, coordinates and prices from `git show f9f3906:<file>` and from the new files do not intersect, `settlementID` 5000 and 565 excepted: coder check, reported in the digest (a committed test would have to contain the old values).

## Tests to write
As named in the ACs. E2E: none new; CI runs the existing suite.

## Blast radius
Graph is from the main checkout; greps cover what it missed.
- `api/tests/fixtures/rent_reference/*`: read by `scripts/seed.py` (`FixtureFetcher`, so `make seed`, `make dev`, CI's stack) and `tests/test_rent_reference.py` (`_load`/`_files`), reused by `test_areas.py` and `test_seed.py`. In Scope.
- `seed_areas`: `scripts/seed.py` main, `test_seed.py`. Code unchanged; the seeded neighbourhood gets the invented name and id. No e2e or web test names it.
- `FakeRentFetcher` / `_files`: `test_rent_reference.py`, `test_areas.py`, `test_seed.py`. In Scope.
- `parse_rent_file` / `import_areas`: unchanged; their id checks constrain the fixtures. 0013a adds `fetcher=None`; seed still passes a fetcher.
- `termsDoc` / `LegalPage`: `routes.tsx`, `LegalPage.test.tsx` (reads every `he.json` line, so it follows the new text). Only the paragraph class changes.
- `legal.terms.s6.*`: `content.ts:70-73` only; no `/terms#s6` link and no reference to section 6 inside the terms.
- `listings.closure.intro`: `ClosureDialog.tsx:64` only.
- `useRentEstimate` / `DetailsStep` / `listings.estimate.*`: untouched, dormant; `ListingWizard`, `NewListingPage`, `EditListingPage`, `DetailsStep.test.tsx` and `web/e2e/screens/listings.screens.ts:389` stay valid.
- `waitlist/public/index.html:81`: no test or script reads this item; `build.test.js` gains AC3.

## Risks / open questions
- The repo is already public, and the real fixtures have been published since `183bef3`. This spec fixes the current
  tree only. Old versions stay in git history (about 11 KB, three areas); purging needs a force push and probably GitHub
  Support, and would disrupt live spec branches. Default: leave history alone, Gilad may decide otherwise.
- The live waitlist keeps the old promise until it is redeployed after the merge.
- The access date in the credit is the commit date of the CSV (`5464c67`). The data.gov.il page renders client-side; the
  dataset was confirmed through its API.
- Round 1 rejected with 10 findings, all applied; second round waived.

## Digest (filled by orchestrator after verification)
Nothing public promises a rent estimate any more, the terms credit CBS for the settlement list, and the test data no
longer copies nadlan.gov.il. The engine stays in the repo, switched off. No behaviour changes for users beyond text.
