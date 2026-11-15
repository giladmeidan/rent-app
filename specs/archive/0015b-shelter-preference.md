---
id: 0015b
title: "A seeker says whether they need a protected space (any, or a ממ״ד in the flat), and the match score treats it as a deal-breaker; listers must answer the protected-space question"
status: done
depends_on: []           # 0015a (listings.shelter) is merged
reviewers: [code, qa, ux, perf]   # perf: the match score runs in search, the map box, the inbox and people browse
estimate: 1 coder run    # a long one: full stack + ~15 test files touched; coder Opus/high (migration, matching)
---

## Goal
After this ships, a seeker can say in their profile that they need a protected space (מרחב מוגן) or specifically a
ממ״ד in the flat, and every listing that does not have one is scored as failing a hard filter (capped at 59, the
shelter named as its "differs" line, never hidden). Listers must state the flat's protected space, so the answer
always exists for new listings. Serves PRODUCT.md "Matching" and "Listings"; follow-up named in 0015a's Out.
Decided 2026-11-15 (Gilad): three values, a hard criterion, a listing that does not say fails it, weight 10 taken
from criteria that keep points (no criterion goes to 0), and the listing field becomes required.

## Scope
**In:**
- Profile: one new column `seeker_profiles.shelter_needed` (looking part), read/written through `GET/PUT /me/profile`.
- Match score: one new hard criterion `shelter` in `app/matching/score.py`, new weights.
- Owner's inbox: the applicant's `shelter_needed` in `ApplicantProfileOut` (like `parking_needed`) so the owner
  reason lines can say it.
- Listing: `shelter` becomes **required** on create (`ListingIn`) and can no longer be cleared by PATCH; the wizard
  drops its "לא לציין" option and requires a choice.
- Web: the profile form control; reason lines for the new criterion in every map of `match/reasons.ts`; the
  applicant details row; i18n.

**Out:**
- Making `listings.shelter` NOT NULL in the database: dev databases hold rows from before this spec. The column stays
  nullable; the API refuses to create or clear one; a NULL row fails the criterion (below).
- Any search filter on the seeker's preference (the 0015a `shelter=true` filter is unchanged and separate).
- Distance to a public shelter.

**New dependencies:** none.

## Data
- `seeker_profiles.shelter_needed TEXT NOT NULL DEFAULT 'any'` with
  `ck_seeker_profiles_shelter_needed`: `shelter_needed IN ('any', 'protected', 'mamad')`.
  - `any`: no preference · `protected`: ממ״ד, ממ״ק or מקלט (a listing's `mamad` / `mamak` / `building`) ·
    `mamad`: a ממ״ד in the flat only.
- It belongs to the **looking part**, like `parking_needed`: `ck_seeker_profiles_looking_defaults` gains
  `AND shelter_needed = 'any'` in its "no looking part" branch. Written identically in the model's `__table_args__`
  and the migration. Alembic's autogenerate check (`command.check`) does **not** compare CHECK text, so AC3 compares
  both CHECKs' `pg_get_constraintdef` with the model's text through a temp-table probe, as 0015a's
  `test_ac5_listing_shelter_migration` does (`_check_definition`).
- Migration `NNNN_shelter_needed.py`: the next number after the Alembic head on `main` when the build starts (today
  `0024`; Slice 13's `0013c` and `0013e` both claim `0025`, so expect `0026` or `0027`). The second to merge re-points
  its `down_revision` after merging `origin/main`, so there is one head.
  - **upgrade:** add the column with its default (existing rows read `any`) and the CHECK; drop and re-create
    `ck_seeker_profiles_looking_defaults` with the new term.
  - **downgrade:** re-create the old `ck_seeker_profiles_looking_defaults`, drop the CHECK and the column.
- `listings.shelter`: no schema change.
- Backwards-compatible: a `PUT /me/profile` without the field writes `any` (default), as today's clients do.
  Creating a listing **without** `shelter` becomes a 422; accepted, nothing is deployed and the web sends it.
- ORM: `SeekerProfile.shelter_needed: Mapped[str]` (`server_default=text("'any'")`, as `flatmate_gender`) next to
  `parking_needed` in `api/app/models/seeker_profile.py`; the module docstring's looking-part list names it.

## API
No new endpoints; auth rules unchanged.

| Method | Path | Auth rule | Change |
| --- | --- | --- | --- |
| GET / PUT | /me/profile | unchanged (signed in, own profile) | `SeekerProfileIn.shelter_needed: ShelterNeeded = 'any'` (a `Field(default_factory=…)`, as `flatmate_gender`, so the generated web type does not require the key) with `ShelterNeeded = Literal['any','protected','mamad']` in `schemas/profile.py`; `SeekerProfileOut.shelter_needed: ShelterNeeded`. `_parts`: `shelter_needed != 'any'` without the looking part → 422, added to the existing "need the looking part" check and its message |
| POST | /listings | unchanged (signed in) | `shelter` is required on create: missing or `null` → 422 (mechanism below) |
| PATCH | /listings/{listing_id} | unchanged (owner; 404 otherwise) | `"shelter"` **leaves** `NULLABLE_FIELDS`: an explicit `null` → 422; a value replaces; the key absent leaves it as it is (including a pre-0015b NULL), and so does a status-only PATCH (pause / resume) |
| GET | /listings/{listing_id}/applications (owner inbox) and PATCH …/applications/{id} (`set_applicant_status`, same `ApplicantOut`) | unchanged (owner) | `ApplicantProfileOut.shelter_needed: ShelterNeeded` (**not** nullable, exactly as `parking_needed: int`: the whole `profile` is already `null` for an applicant without the looking part, `routers/applications.py` `has_profile`); `_PROFILE_COLUMNS` in `services/applications.py` selects it by name, and `_applicant_out` (`routers/applications.py` ~line 222) maps it next to `parking_needed` |
| all match responses | search, map box, listing page, the seeker's liked/invited rooms (`liked_rooms`), inbox, people browse | unchanged | `Criterion` (`schemas/match.py`) gains `"shelter"`, so `MatchOut.agrees` / `differs` may carry it. No profile value is returned to a seeker view (NF3 unchanged) |

**Required on create, without breaking PATCH (verifier finding 1).** `services/listings.py::_merged` re-validates
every PATCH (pause / resume too) as a whole `ListingIn` built from the stored row plus the sent keys. A plain
`ListingIn.shelter: Shelter` would therefore turn every PATCH of a pre-0015b listing (NULL `shelter`) into a 422,
including "pause". So:
- `ListingIn.shelter: Shelter | None` with **no default** (the key is required; OpenAPI lists it in `required`), and a
  `model_validator` refuses `None` ("shelter is required") unless the validation context has `stored_row: True`.
- `_merged` passes `stored_row: True` in its context (next to `status_only`). An explicit `null` in a PATCH never
  reaches it: `ListingPatch` refuses it first, since `shelter` left `NULLABLE_FIELDS`. So in `_merged` a `None` can
  only be the stored pre-0015b value, which is kept.
- `POST /listings` validates with no context: missing → 422 (`missing`), `null` → 422 (the validator), as AC7 says.
- The generated web type is then `ListingIn['shelter']: Shelter | null` (required key), so `ListingInBody` and
  `toListingIn`'s `'' → null` mapping keep compiling (see UI: `toListingIn` must not throw).

### Match score (`app/matching/score.py`)
- `Criterion` order: `"budget", "move_in", "area", "household", "contract", "parking", "smoking", "pets",
  "shelter", "lifestyle"` (`shelter` before `lifestyle`, which stays last).
- `WEIGHTS`: `budget 20` (was 25), `move_in 20`, `area 15` (was 20), `household 10`, `contract 10`, `parking 5`,
  `smoking 5`, `pets 5`, `shelter 10`; sum stays 100. Budget and area are binary hard filters, so every listing that
  passes them already scores them in full; taking the points from them changes how passing listings rank least.
- `HARD` gains `"shelter"`.
- `m_shelter`:
  - `profile.shelter_needed = 'any'` → 1;
  - `'protected'` → 1 when `listing.shelter IN ('mamad','mamak','building')`, else 0;
  - `'mamad'` → 1 when `listing.shelter = 'mamad'`, else 0;
  - a NULL `listing.shelter` (rows from before this spec) is 0 for `protected` / `mamad`: the `CASE` must fall to its
    `else` on NULL, never return NULL (a NULL base criterion would make the whole score NULL).
  One way that cannot return NULL: `case((profile.shelter_needed == 'any', 1), (profile.shelter_needed == 'mamad',
  _ones_when(listing.shelter == 'mamad')), else_=_ones_when(listing.shelter.in_(('mamad','mamak','building'))))`
  (`_ones_when` is a `CASE … ELSE 0`, so `NULL IN (…)` gives 0).
- `f_shelter`: `m_shelter = 0` (never NULL, so the `or_` of the `HARD` fails and the 59 cap behave on NULL rows).
- The 9 base criteria sum to 100 and still share `BASE_SHARE` when lifestyle is scored; the `WEIGHTS` comment ("The 8
  base criteria") and the module docstring ("the 8 base criteria share `BASE_SHARE`") say 9.
- Read **live** from the listing in every caller (search, map, listing page, `liked_rooms`, inbox, people browse):
  no `match_columns` keyword is added. The inbox already shows the owner the applicant's need, so a live value leaks
  nothing (unlike price / area, security B1); people browse names it only as fit / no fit (`people.reason.shelter`,
  like parking).
- Update the module docstring (weights, the new hard filter) and PRODUCT.md "Matching" (the orchestrator does that).

## UI
Design: no artboard; follow the existing profile `ChoiceGroup`s (`design/brand/` for tokens).
- **Profile form** (`web/src/features/profile/ProfilePage.tsx`, `validate.ts`): a `ChoiceGroup` "מרחב מוגן" in the
  looking part, right after "חניה", built like the parking control: `any` / `protected` / `mamad`, default `any`.
  `validate.ts`: form type, `emptyProfileForm` default, `formFromProfile` (both branches: the saved value with the
  looking part, the empty form's without it), `toProfileIn` (the looking branch sends the value; the "looking part
  off" `else` branch, which today sends `parking_needed: 0`, sends `shelter_needed: 'any'`; the generated type makes
  the key optional, so `tsc` will not remind you). Export `ShelterNeeded = SeekerProfileOut['shelter_needed']` from
  `profile/api.ts` as `FlatmateGender` is. No new error state: a bad value cannot be picked.
- **Listing wizard / edit** (`DetailsStep.tsx` shelter control, `validate.ts`): remove the "לא לציין" option (the
  four types only), keep default `''` (nothing picked), and make it a required field: `''` → a field error
  `listings.errors.shelterRequired` on the details step, which blocks "next" like the other required fields:
  - `validate` sets `shelter` when `form.shelter === ''`; `'shelter'` joins `FIELD_ORDER` right before
    `'parking_spots'` (its place on the form), and the new key joins the `FieldError` union.
  - `ShelterField` passes the error to its `ChoiceGroup` (`error=`), as the profile's groups do.
  - Focus: the "next" handler focuses `document.getElementById(fieldId(name))` (`ListingWizard.tsx` ~line 440), and a
    `ChoiceGroup` renders no such id (its radio ids come from `useId`). Give the group a focus target with
    `id={fieldId('shelter')}` (e.g. the wrapper `div` with `tabIndex={-1}`, or an optional `id` prop on
    `ChoiceGroup` for its first radio); otherwise focus silently skips it.
  - `toListingIn` keeps `'' → null` and **must not throw**: it also runs on every render for the edit page's dirty
    check (`ListingWizard.tsx` ~line 212) and for the preview (~line 651), before any validation. Only the publish /
    save paths send it, and they run after `validate` passed.
  - From-listing keeps `null` → `''`, so editing a pre-0015b listing asks for an answer before saving.
    `ListingForm['shelter']` stays `Shelter | ''`.
- **Reason lines** (`web/src/features/match/reasons.ts`): a `shelter` entry in `SEEKER`, `SEEKER_SHORT`, `OWNER`,
  `OWNER_SHORT`, `PERSON_BASE` and `PERSON_REASON` (each is a `Record<Criterion, …>`, so `tsc` fails until all six
  have it). Seeker lines (`SEEKER`) read `p.shelter_needed` and `l.shelter`. The seeker chips (`SEEKER_SHORT`) may
  get `p === undefined`, so they read the listing only, as parking's do: `agree` is `match.short.shelter.agree` when
  `l.shelter` is `mamad` / `mamak` / `building`, else `.agreeNotNeeded`; `differ` is `.differUnknown` when
  `l.shelter` is NULL, `.differMamad` when it is `mamak` / `building` (only a `mamad` seeker fails there), else
  `.differ` (a constant "אין מרחב מוגן" would be false on a ממ״ק flat). The full seeker line picks the same way:
  NULL → `differUnknown`, `mamak` / `building` → `differMamad`, `none` → `differ`. Owner lines get
  `(profile, spots, t)` and no listing, so they read `p.shelter_needed` only, which suffices: an agree on
  `protected` / `mamad` means the flat has it, a differ that it has not (on a pre-0015b NULL listing the owner's
  differ line says "בדירה אין"; accepted, it is the owner's own listing and the edit page now asks). `{{shelter}}` in
  the owner lines is a short noun from a typed map `shelterNeedName` in `reasons.ts` (as `parkingName`):
  `protected` → `profile.fields.shelter` ("מרחב מוגן"), `mamad` → `listings.card.shelter.mamad` ("ממ״ד"), so the
  copy reads "צריכים ממ״ד — יש" / "ביקשו ממ״ד, בדירה אין". The owner chip's differ is `.differMamad` for a `mamad`
  need, else `.differ`. The people maps are key-only, like parking's.
- **Applicant details** (`ProfileFacts` in `web/src/features/applicants/ApplicantDetails.tsx`, rendered by
  `ApplicantCard` and `ApplicantPane`): a "מרחב מוגן" row after parking with the profile option's label
  (`profile.shelter.*`, through a typed map); no row when `shelter_needed` is `any`. (`ProfileFacts` only renders for
  a non-null `profile`, so there is no NULL case.)
- States: no new loading / empty / error states beyond the wizard's required-field error. RTL: no layout change.
- **i18n keys** (`web/src/locales/he.json`, beside the matching parking keys; gershayim `״` U+05F4, never `"`):
  - `profile.fields.shelter` "מרחב מוגן"
  - `profile.shelter.any` "לא חשוב לי", `.protected` "מרחב מוגן (ממ״ד, ממ״ק או מקלט)", `.mamad` "ממ״ד בדירה"
  - `applicants.profile.shelter` "מרחב מוגן"
  - `listings.errors.shelterRequired` "בחרו איזה מרחב מוגן יש בדירה"
  - `match.seeker.shelter.agreeNotNeeded` "לא ביקשת מרחב מוגן", `.agree` "יש מרחב מוגן כפי שביקשת",
    `.agreeMamad` "יש ממ״ד בדירה כפי שביקשת", `.differ` "ביקשת מרחב מוגן — בדירה אין",
    `.differMamad` "ביקשת ממ״ד בדירה — אין", `.differUnknown` "ביקשת מרחב מוגן — המפרסם לא ציין"
  - `match.short.shelter.agree` "מרחב מוגן", `.agreeNotNeeded` "מרחב מוגן לא נדרש", `.differ` "אין מרחב מוגן",
    `.differMamad` "אין ממ״ד", `.differUnknown` "מרחב מוגן לא צוין"
  - `match.owner.shelter.agree` "צריכים {{shelter}} — יש", `.agreeNone` "לא צריכים מרחב מוגן",
    `.differ` "ביקשו {{shelter}}, בדירה אין" (`{{shelter}}` = `shelterNeedName`: "מרחב מוגן" or "ממ״ד", above)
  - `match.owner.short.shelter.agree` "מרחב מוגן", `.agreeNone` "מרחב מוגן לא נדרש", `.differ` "אין מרחב מוגן",
    `.differMamad` "אין ממ״ד"
  - `people.short.shelter.agree` "מרחב מוגן: מתאים", `.differ` "מרחב מוגן: לא מתאים"
  - `people.reason.shelter.agree` "מבחינת מרחב מוגן, הדירה מתאימה להם",
    `.differ` "הם צריכים מרחב מוגן שאין בדירה"
  - Removed: none (`listings.room.unset` stays, other controls use it).
  - Labels read through typed maps (as `parkingName`), never a template-literal key, so `make i18n-check` sees them.
- Run `make client` after the API half so `web/src/api/schema.d.ts` has `shelter_needed` and the new `Criterion`.

## Acceptance criteria
- [ ] AC1 Given a seeker, When they PUT a profile with a looking part and `shelter_needed: "mamad"`, Then GET returns
  it; without the field it returns `"any"`; `"bunker"` → 422 —
  `api/tests/test_profiles.py::test_ac1_shelter_needed_round_trip`
- [ ] AC2 Given a PUT with only the personal part and `shelter_needed: "protected"`, Then 422 (needs the looking
  part); clearing the looking part writes `any` — `api/tests/test_profiles.py::test_ac2_shelter_needed_needs_looking_part`
- [ ] AC3 The migration upgrades and downgrades cleanly; existing profiles read `any`; the DB refuses an unknown
  value and a non-`any` value without the looking part; both CHECKs' definitions equal the model's text (probe, as
  0015a's AC5); `command.check` sees no diff — `api/tests/test_migrations.py::test_ac3_shelter_needed_migration`
- [ ] AC4 Given listings with `mamad`, `mamak`, `building`, `none` and NULL and a profile that otherwise matches all
  of them in full, When matching with `shelter_needed` `any` / `protected` / `mamad`, Then:
  `any` → every score 100 and no `f_shelter`; `protected` → `mamad`/`mamak`/`building` 100, `none` and NULL capped at
  59 with `differs: "shelter"`; `mamad` → only `mamad` 100, the rest capped with `differs: "shelter"` —
  `api/tests/test_matching.py::test_ac4_shelter_criterion`
- [ ] AC5 The weights are budget 20, move_in 20, area 15, household 10, contract 10, parking 5, smoking 5, pets 5,
  shelter 10, sum 100; a listing failing only household scores 90 —
  `api/tests/test_matching.py::test_ac5_weights_with_shelter`. Existing assertions are recomputed for the new
  weights, not deleted. The ones that change (verifier's arithmetic; everything else that pins a score or an
  explanation stays as it is: 100, 93, 91 and the 59 caps):
  - `test_inbox.py::test_ac3_match_ties_and_nulls`: S5 (budget, move-in and area fail) 35 → **45**, its match
    `_match(45, ["household", "contract", "shelter"], "budget")`; rename the `s5_35` key and fix the comments
    (an unscored row on the today listing is 45 too, so only "applicants with a profile first" keeps S5 ahead).
  - `test_matching.py::test_ac11_explain_rules[agrees_needs_half]`: agrees `["area", "parking", "smoking"]` →
    `["area", "shelter", "parking"]`.
  - `test_lifestyle_match.py::test_ac2_lifestyle_explain_rules[full_agreement_ties_budget]`: lifestyle (20) now beats
    budget (0.8 × 20 = 16): agrees `["lifestyle", "budget", "move_in"]`; rename the param id.
  - `test_matching.py` / `test_lifestyle_match.py` `_values` build `m_*` / `f_*` from `CRITERIA` / `HARD`, so they
    pick up `shelter` with no edit.
- [ ] AC6 Given an applicant with `shelter_needed: "mamad"` on a listing with `shelter: "none"`, When the owner reads
  the inbox, Then the row's match is capped at 59 with `differs: "shelter"` and the applicant profile carries
  `shelter_needed: "mamad"`; an applicant with no shelter need carries `"any"` (an applicant without the looking
  part still has `profile: null`, unchanged) —
  `api/tests/test_inbox.py::test_ac6_inbox_shelter_needed`
- [ ] AC7 Given a lister, When they POST a listing without `shelter` or with `null`, Then 422 with `loc`
  `["body", "shelter"]` and no row; with a value, 201 (an apartment and a room) —
  `api/tests/test_listings.py::test_ac7_shelter_required_on_create` (replaces 0015a's
  `test_ac1_create_listing_shelter`, whose "without the field it returns null" is now a 422)
- [ ] AC8 Given a listing, When the owner PATCHes `shelter: null`, Then 422; PATCH `shelter: "mamak"` reads back
  `mamak`. Given a pre-0015b listing with a NULL `shelter` (set by SQL or `make_listing`), a PATCH of another field
  (`price_ils`) and a status-only PATCH (pause, then resume) each return 200 and leave it NULL —
  `api/tests/test_listings.py::test_ac8_shelter_not_clearable` (replaces 0015a's `test_ac2_patch_listing_shelter`
  null-clearing assertion)
- [ ] AC9 The profile form shows "מרחב מוגן" with the three options in the looking part, defaults to "לא חשוב לי",
  sends the chosen value, and pre-selects the saved one — `web/src/features/profile/__tests__/ProfilePage.test.tsx`,
  `validate.test.ts`
- [ ] AC10 The wizard's details step shows the four shelter types and no "לא לציין"; "next" with none picked shows
  `listings.errors.shelterRequired` on the group and focus lands on it; editing a listing with `shelter: null`
  renders (no throw), starts with none picked and cannot save until one is — `web/src/features/listings/__tests__/DetailsStep.test.tsx`, `validate.test.ts`,
  `EditListingPage.test.tsx` (0015a's "clear back to null" cases are rewritten to this)
- [ ] AC11 Each of the six reason maps renders a line for `shelter` agree and differ: the seeker's
  `agreeNotNeeded` / `agree` / `agreeMamad` / `differ` / `differMamad` / `differUnknown` (listing NULL) by profile and
  listing value (a `mamad` seeker on a `mamak` flat gets `differMamad`, never "אין מרחב מוגן"); the owner's
  `agree` / `agreeNone` / `differ` with `{{shelter}}` "מרחב מוגן" / "ממ״ד"; the seeker chips with `profile`
  undefined; the owner and people chips —
  `web/src/features/match/__tests__/reasons.test.ts`
- [ ] AC12 The applicant details show a "מרחב מוגן" row for `protected` / `mamad` and none for `any` —
  `web/src/features/applicants/__tests__/ApplicantsPage.test.tsx`
- [ ] AC13 `make i18n-check` passes; no hardcoded Hebrew.

## Tests to write
Unit/integration as named in the ACs.
- **API listing bodies must gain `shelter`** (create now requires it; ≈40 `post("/listings"` calls, all through
  four builders): `api/tests/test_listings.py::_body` (and `_room`, which builds on it; imported by `test_inbox.py`,
  `test_photos.py`, `test_hardening.py`, `test_price_signals.py`, `test_flat_profile.py`, `test_moderation.py`,
  `test_listing_renewal.py` via `_create` / `_create_room`), `test_applications.py::_listing_body`,
  `test_geocoding.py::_listing_body`. Use `"none"` as `_body`'s default so no existing score moves.
  `conftest.py::make_listing` inserts SQL directly (NULL `shelter`) and needs nothing; with the `_merged` fix above,
  the many tests that PATCH a `make_listing` row keep working. `test_listings.py::test_ac9_concurrent_creates_respect_cap`
  validates `ListingIn` from `_body` directly: covered by `_body`.
- **0015a tests rewritten** (not deleted): `test_listings.py::test_ac1_create_listing_shelter` (asserts a create
  without `shelter` returns `null`) → folded into AC7; `test_ac2_patch_listing_shelter` (null-clearing) → AC8.
- **Exact-dict profile assertions gain `shelter_needed: "any"`**: `test_profiles.py` `test_ac1_seeker_creates_and_reads_profile`
  (~line 100), `test_ac2_put_replaces_profile` (~122), `test_ac3_profile_for_any_account` (~156),
  `test_ac1_either_part_alone` (~529), `test_ac3_put_replaces_each_part` (~629); `test_inbox.py::_p0_out` (the
  owner's `profile` dict, asserted whole at ~line 953; `_p0_body` spreads it into a PUT body, where the key is fine).
  `test_applications.py::_profile_body` and `conftest.py::make_profile` need nothing (the field defaults).
- **Web listing wizard tests:** `web/src/features/listings/__tests__/wizard.tsx::fillValidDetails` picks a shelter
  (it feeds `ListingWizard.test.tsx`, `DetailsStep.test.tsx`, `EditListingPage.test.tsx`, `PhotosStep.test.tsx`,
  `RoomFields.test.tsx`); `ListingWizard.test.tsx` cases that assert a create body with `shelter: null` are updated.
- **Web profile fixtures gain `shelter_needed`** (typed `SeekerProfileOut` / `ApplicantProfileOut`, so `tsc` fails
  without it): `web/src/features/profile/__tests__/fixtures.ts`, `web/src/features/applicants/__tests__/fixtures.ts`,
  `web/e2e/screens/fixtures-seeker.ts`, `web/e2e/screens/fixtures-profile.ts`. Untyped profile mocks that should carry
  it so the reason copy is right: `web/e2e/screens/applicants.screens.ts` (`profile()`), `market-people.screens.ts`,
  `search.screens.ts`. (`people.screens.ts` has no profile literal; it already spells `shelter: null` on listings.)
- **E2E listing bodies** (real `POST /listings`): `web/e2e/helpers.ts::postListing`, `listings.spec.ts` (~line 175),
  `search.spec.ts` (~51), `map.spec.ts` (~76). **E2E wizard walks** that pass the details step must now pick a
  shelter or "next" blocks: `listings.spec.ts` apartment flow (~43, already picks ממ״ד) and room flow (~250),
  `photos.spec.ts` (~30), `market.spec.ts` (~106 and ~173), `screens/listings.screens.ts` (the wizard helper ~118; its
  edit screens mock listings with `shelter: null` and must not click past details without one).
- E2E (CI only; never run e2e locally): extend the profile flow in `web/e2e/applications.spec.ts` (~line 74, where it
  picks parking) to pick "ממ״ד בדירה" and check it is pre-selected after reload (~136).

## Blast radius
`graphify affected` on the main checkout's graph (2026-11-15), confirmed by grep in `rent-app-orch` (origin/main
`f30feeb`). Graph hits that are only module `imports_from` are left out unless they read the symbol.
- `match_columns`: `services/search.py::_with_match` (search + map box), `get_public_listing_with_match` (listing
  page), `liked_rooms` (the seeker's liked / invited rooms; the spec's draft missed it), `services/applications.py::_applicants`
  (`list_applicants`, `set_applicant_status`), `services/people.py::list_people`, `tests/test_people.py::_expected_match`.
  No signature change: all get `m_shelter` / `f_shelter` and the new weights. `matching/fit.py` (room / person fit)
  does not use it: untouched.
- `WEIGHTS` / `HARD` / `CRITERIA` (no graph node; grep): only `score.py` (`match_columns`, `_weight`, `explain`) and
  `tests/test_matching.py` / `test_lifestyle_match.py` (`_values` loops them; the changed expectations are named in
  AC5).
- `Criterion` (api `schemas/match.py`, no graph node): `score.py`, `MatchOut`. Web `match/types.ts::Criterion` →
  `reasons.ts` (six `Record<Criterion, …>` maps), `MatchChips.tsx`, `PersonCard.tsx`, `reasons.test.ts`; the
  `MatchOut` renderers (`MatchCard`, `ResultsList`, `SearchMap`, `ApplicantCard`, `InvitesSection`, `PeoplePage`)
  only pass codes through: untouched.
- `explain` / `explain_row`: `routers/applications.py::_applicant_out`, `routers/people.py::_person_out`,
  `services/search.py` (search, listing page, `liked_rooms`), `test_matching.py::test_ac11_explain_rules`,
  `test_lifestyle_match.py::test_ac2_lifestyle_explain_rules`, `test_people.py`. No code change beyond the criterion.
- `SeekerProfile` (model): `score.py`, `fit.py`, `services/profiles.py` (`put_profile` writes `model_dump()`, so the
  new field lands with no service change), `services/search.py`, `applications.py`, `people.py`, `market_people.py`,
  `flatmates.py`, `conftest.py::make_profile` (SQL insert; column default), `test_migrations.py`; `api/admin/` imports
  it but lists no profile columns: untouched. `api/scripts/seed_demo.py` (main checkout only, uncommitted): inserts
  profiles, gets the default.
- `SeekerProfileIn` / `_parts` (api): `routers/profiles.py::put_profile`, `services/profiles.py::put_profile`,
  `tests/test_profiles.py` (`test_ac2_part_rules_messages` matches "need the looking part", which stays in the
  message). Web `profile/api.ts::SeekerProfileIn`: `ProfilePage.tsx`, `useSaveProfile.ts`, `profile/validate.ts`
  (`toProfileIn`), `ProfilePage.test.tsx`, `validate.test.ts`, `useSaveProfile.test.tsx`.
- `SeekerProfileOut` (api): `routers/profiles.py` get / put. Web: `ProfilePage.tsx`, `validate.ts`
  (`formFromProfile`), `LookingProfile` → `reasons.ts`; typed literals in `profile/__tests__/fixtures.ts`,
  `e2e/screens/fixtures-seeker.ts`, `fixtures-profile.ts` (in Tests to write); the other test importers use those
  fixtures.
- `ApplicantProfileOut` (api `schemas/application.py`): `routers/applications.py::_applicant_out` (used by
  `list_applicants` and `set_applicant_status`); `tests/test_inbox.py::_p0_out`. Web `applicants/api.ts`:
  `ApplicantDetails.tsx::ProfileFacts` (via `ApplicantCard`, `ApplicantPane`), `reasons.ts` owner maps,
  `MatchChips.tsx`, `applicants/__tests__/fixtures.ts`, `reasons.test.ts`, `MatchChips.test.tsx`.
- `_PROFILE_COLUMNS` (`services/applications.py`; the graph resolves the name to an unrelated
  `test_migrations.py::_profile_columns` helper, grep is authoritative): `_applicants` only.
- `ListingIn` (api): `routers/listings.py::create_listing`, `services/listings.py::create_listing` and **`_merged`**
  (re-validates every PATCH, hence the context rule in API), `test_listings.py::test_ac9_concurrent_creates_respect_cap`,
  and every test body builder (Tests to write). Web `ListingIn` → `ListingInBody` (`listings/api.ts`) →
  `toListingIn`, `changedFields`, `PreviewStep` / `ListingCard`; the graph has no edges for the web type.
- `NULLABLE_FIELDS` (no graph node; grep): only `schemas/listing.py::ListingPatch` validator.
- `DetailsStep` / `ShelterField`: `ListingWizard.tsx` (used by `NewListingPage`, `EditListingPage`),
  `ListingWizard.test.tsx`, `DetailsStep.test.tsx`, `EditListingPage.test.tsx`, test helper `__tests__/wizard.tsx`.
  `toListingIn`: `ListingWizard.tsx` (dirty check ~212, publish ~391, save ~399, preview ~651), `validate.test.ts`.
- `ProfilePage` / `toProfileIn` / `formFromProfile`: `routes.tsx`, `ProfilePage.test.tsx`, `PersonPhoto.test.tsx`,
  `validate.test.ts`; the route-level tests (`Layout`, `queryClient`, `LandingPage`, `MarketMinePage`, …) render it
  through fixtures only: untouched.
- `reasons.ts` maps: `seekerReason` → `MatchCard`, `ListingPage`; `seekerShort` / `ownerShort` / `personShort` →
  `MatchChips` (→ `ApplicantCard`, `InvitesSection`, `PersonCard`, `ResultsList`, `SearchMap`); `ownerReason` →
  `ApplicantCard`, `ApplicantPane`; `personReason` → `PersonCard`, `PeoplePage`; all tested in `reasons.test.ts`.
- `ApplicantDetails.tsx` (`ProfileFacts`): `ApplicantCard`, `ApplicantPane` (→ `ApplicantsPage`);
  `ApplicantsPage.test.tsx`.
- `api/scripts/seed_demo.py` / `seed_promo.py` exist only in the main checkout, uncommitted (Gilad's): they insert
  listings by SQL / ORM (NULL `shelter` is allowed) and may want a `shelter` value for demo matches; Gilad's call.

## Risks / open questions
- Score shift: for an `any` seeker (every existing profile) a score changes only where budget or area does not
  pass (each lost 5, shelter adds a full 10), and those are capped at 59 unless several criteria fail; the
  explanation order also moves (shelter 10 ties household and contract and comes after them in `CRITERIA`, so it
  can push parking out of the top-3 agrees; on rooms lifestyle 20 now outranks budget 16). The changed test expectations are
  named in AC5. Screen fixtures mock their scores: unchanged.
- A `protected` / `mamad` seeker sees every pre-0015b listing (NULL shelter) capped at 59. Accepted (Gilad,
  2026-11-15): pre-release, and new listings must answer.
- The `CASE` for `m_shelter` must not return NULL on a NULL listing value (AC4 covers it).
- Migration numbering clashes with Slice 13 (`0025` is claimed twice); handled in Data.
- No product question is open.

## Verifier findings (2026-11-15, one round)
Status set to `verified`: the one blocker had a mechanical fix inside Gilad's decision and is written into the spec.
1. **Blocker, fixed in spec (API).** `services/listings.py::_merged` re-validates every PATCH, pause / resume
   included, as a whole `ListingIn` from the stored row. With `ListingIn.shelter: Shelter` required, every PATCH of a
   pre-0015b listing (NULL `shelter`, and every `make_listing` row in the tests) would be a 422, so an owner could not
   even pause it. Now: `ListingIn.shelter: Shelter | None` with no default plus a validator that refuses `None` unless
   `_merged`'s context says `stored_row`; `ListingPatch` still refuses an explicit `null`. AC8 asserts the PATCH and
   pause / resume of a NULL row. Side effect, accepted: OpenAPI shows the key as required but nullable. **Orchestrator:
   glance at the "Required on create" block in API.**
2. **Major, fixed (web).** `toListingIn` runs on every render for the edit page's dirty check and for the preview,
   before validation, so it must not throw on `''`. Kept `'' → null` (the nullable type from 1 lets it compile).
3. **Major, fixed (web).** The wizard's required-field plan was incomplete: `'shelter'` must join `FIELD_ORDER` and
   the `FieldError` union, `ShelterField` must pass `error=`, and the "next" focus uses
   `getElementById(fieldId(name))`, which a `ChoiceGroup` never renders. All specified; AC10 checks focus.
4. **Major, fixed (tests).** AC5's "recompute" list was vague and partly wrong. Worked out: `test_inbox.py`'s S5
   35 → 45 with agrees `household, contract, shelter`; `test_matching.py` `agrees_needs_half` →
   `area, shelter, parking`; `test_lifestyle_match.py` `full_agreement_ties_budget` → `lifestyle, budget, move_in`.
   No score in `test_search.py` or `test_people.py` changes (100s and 59 caps).
5. **Major, fixed (e2e).** Five e2e wizard walks pass the details step without picking a shelter (`listings.spec.ts`
   room flow, `photos.spec.ts`, `market.spec.ts` ×2, `screens/listings.screens.ts`): they would block on "next" in CI.
   Listed. The unit-test helper `__tests__/wizard.tsx::fillValidDetails` likewise.
6. **Major, fixed (API schema).** `ApplicantProfileOut.shelter_needed` was `| None` "as parking's neighbours": wrong.
   `parking_needed` is `int`, and the whole `profile` is `null` without the looking part. Now non-null; AC6 and the
   applicant details row reworded (no NULL case).
7. Minor, fixed. Paths: `api/tests/test_profile.py` → `test_profiles.py` (AC1, AC2); `routers/profile.py` →
   `routers/profiles.py`; `test_inbox.py::_p0_body` is a profile body, not a listing body (the inbox posts through
   `test_listings.py::_body`); `people.screens.ts` has no profile literal, and `fixtures-profile.ts` (a typed
   `SeekerProfileOut`) was missing. Exact-dict profile tests that break (5 in `test_profiles.py`, `_p0_out`) are named.
8. Minor, fixed. Alembic's `command.check` does not compare CHECK text; AC3 compares both CHECKs by probe, as 0015a.
9. Minor, fixed. Owner copy: "lower-cased as the parking lines do" is meaningless in Hebrew, and the profile label
   ("מרחב מוגן (ממ״ד, ממ״ק או מקלט)") does not read inside "צריכים {{shelter}} — יש". Now a short-noun map
   (`shelterNeedName`: "מרחב מוגן" / "ממ״ד") from existing keys. UX reviewer to confirm the wording.
10. Minor, fixed. Seeker chips get `profile === undefined`; they now read the listing only, as parking's. The draft's
    constant differ chip "אין מרחב מוגן" was false for a `mamad` seeker on a ממ״ק / מקלט flat: added
    `match.short.shelter.differMamad` / `.differUnknown` and `match.owner.short.shelter.differMamad`.
11. Minor, fixed. `match_columns` also feeds `liked_rooms` and `set_applicant_status`: added to API and Blast radius.
12. Checked, true: the `m_shelter` CASE as written cannot return NULL on a NULL listing (`_ones_when` falls to its
    `ELSE 0`), so `f_shelter`, the 59 cap and `coalesce(with_lifestyle, base)` stay non-NULL; the migration's
    drop / re-create of `ck_seeker_profiles_looking_defaults` is safe (new rows default `any`); the profile form's
    "looking part off" payload exists (`toProfileIn`'s `else` branch); the i18n parents (`profile.parking`,
    `profile.fields`, `applicants.profile`, `match.seeker/short/owner/owner.short`, `people.short/reason`,
    `listings.errors`) exist and the new keys sit beside their parking / required siblings; `listings.room.unset` keeps
    3 other users; head is `0024`; people browse names the need as fit / no fit only, like parking.
13. **For the orchestrator (PRODUCT.md, same day):** "Matching" gains the shelter deal-breaker and the new weights;
    "Listings" ("… none, or not said") must say a new or edited listing has to answer (NULL stays only on older rows).
    Not a contradiction to block on: Gilad decided it 2026-11-15.
14. Reviewers unchanged (code, qa, ux, perf); no security reviewer: no auth, PII or new disclosure beyond the inbox's
    existing housing summary. Estimate kept at 1 coder run, noted as a long one.

## Digest (filled by orchestrator after verification)

Spec 0015b — seeker shelter preference; listing shelter required   MERGED 3fcb67c (PR #111)
Shipped: a seeker says whether they need a protected space (any / ממ״ד, ממ״ק or מקלט / a ממ״ד in the flat), a hard match criterion (weight 10; a listing without one or that does not say is capped at 59 with shelter as its "differs" line); listers must state the flat's protected space. Migration `0027_shelter_needed`.
Demo: profile → looking part → "מרחב מוגן" → "ממ״ד בדירה"; search: a flat with a ממ״ק shows ≤ 59 and "ביקשת ממ״ד בדירה — אין"; new listing wizard: the protected-space step has no "לא לציין" and needs a choice.
Tests: every AC (AC1–AC13) has a test; API 851 passed, vitest 776; e2e specs updated for the required shelter. CI: green on 08e93f0 with e2e (10 min).
Findings: 0 blockers, 0 majors, 5 minors (1 fixed, 2 logged in FOLLOWUPS, 2 no action), 6 nits dropped. CI's first run failed on `test_ac13_statement_counts_and_plan`, a planner flake already on `main` (autovacuum stats); the test now plans on analyzed, production-shaped pairs, assert unchanged.
Changed in PRODUCT.md: "Matching" and "Listings" lines (written with the spec, 2026-11-15).
Next spec I propose: none queued; `0013a` stays parked until paid hosting is approved.
