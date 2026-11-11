---
id: 0006a
title: A seeker saves a housing profile (budget, move-in, areas, household, pets, smoking, contract length, parking) and needs it to apply; an owner sets who the listing suits (households, smoking, minimum contract)
status: in-progress
depends_on: [0005a]      # migration chain 0006 -> 0007 (0005a adds revision "0006"); also edits services/applications.py beside 0005a
reviewers: [code, qa, security]   # security: a new personal-data table readable only by its seeker, a new gate on apply; qa: validation table, PATCH merge of the new listing fields
estimate: 1 coder run
---

## Goal
After this ships, a seeker can `PUT /me/profile` their housing preferences and read them back with
`GET /me/profile`; applying to a listing (`POST /listings/{id}/applications`, `0004a`) needs that profile
(409 `seeker_profile_required` otherwise — not `profile_required`, which `POST /auth/otp/verify` already uses for
the signup profile); and an owner's listing carries three preferences — accepted households,
smoking allowed, minimum contract length — set on create / PATCH and shown on every listing response. These are
the inputs the match score (`0006b`, `0006c`) is computed from. Serves Dev Plan slice 6 (Match score), part a of
seven. PRODUCT.md "Matching" (Slice 6 batch, 2026-11-11): profile = housing preferences only; smoking and pets are
deal-breakers, household and contract length only lower the score; a seeker must have a profile to apply.

**Slice 6 is split in seven** (one coder run each):
- `0006a` (this) — profile table + API, owner preferences on listings, the apply gate.
- `0006b` — `api/app/matching/`: the score and its explanation; `match` on `GET /listings` (and `sort=match`)
  and on `GET /listings/{id}`. `depends_on: [0006a]`.
- `0006c` — the owner inbox: `match` and a profile summary per applicant, sorted by match. `depends_on:
  [0006b, 0005a]`.
- `0006d` — web: seeker profile page `/me/profile`, the apply gate on the listing page. `depends_on: [0006a]`.
- `0006e` — web: wizard step "העדפות" (create + edit) and "מה בעל הדירה מחפש" on the listing page.
  `depends_on: [0006a]`.
- `0006f` — web: match % on search cards and pins, "sorted by match", the listing-page match card, the profile
  nudge. `depends_on: [0006b, 0006d]`.
- `0006g` — web: the owner inbox sorted by match, score / summary / chips / "למה ההתאמה?" per applicant.
  `depends_on: [0006c, 0006f, 0005b]`.

## Scope
**In:**
- Migration `api/alembic/versions/0007_matching_inputs.py` (revision `"0007"`, down `"0006"`): table
  `seeker_profiles` and three `listings` columns (Data); working `downgrade` (drops the table and the columns).
- `api/app/models/seeker_profile.py` (new): `SeekerProfile`, registered in `api/app/models/__init__.py`
  (`__all__` too); `api/app/models/listing.py` gains the three columns and their CHECKs. Autogenerate sees no
  diff (`test_migrations.py::test_ac4_autogenerate_sees_no_diff_with_postgis_extensions` stays green).
- `api/app/schemas/profile.py` (new): `Household = Literal["single", "couple", "family", "roommates"]`,
  `HOUSEHOLDS` (that tuple, the canonical order), `ContractMonths = Literal[6, 12, 24, 36]`,
  `AcceptedHouseholds = Annotated[list[Household], Field(min_length=1, max_length=4), AfterValidator(…)]` (the
  validator raises `ValueError` on a duplicate — a 422 — and returns the list in `HOUSEHOLDS` order),
  `SeekerProfileIn`, `SeekerProfileOut` (API).
- `api/app/services/profiles.py` (new): `get_profile(db, user_id) -> SeekerProfile | None`,
  `put_profile(db, seeker, data) -> SeekerProfile` (the area check, then one `INSERT … ON CONFLICT (user_id) DO
  UPDATE … RETURNING`), `has_profile(db, user_id) -> bool`. The area check is one `SELECT count(*) FROM areas
  WHERE id = ANY(:ids) AND is_active`; a count below `len(area_ids)` (already distinct) raises
  `services/listings.py`'s `UnknownAreaError`.
- `api/app/routers/profiles.py` (new), included in `api/app/main.py`: `GET /me/profile`, `PUT /me/profile`,
  mapping `UnknownAreaError` to 422 `unknown_area` as `routers/listings.py` does; `responses=` 401, 403
  `seeker_only`, 404 `seeker_profile_not_found` (GET), 422 (`unknown_area` or a malformed body, PUT) and 503,
  with `ErrorOut`, as `_SEEKER_ONLY` does.
- `api/app/schemas/listing.py`: `ListingIn`, `ListingPatch` and `ListingOut` gain `accepted_households`
  (`AcceptedHouseholds`), `smoking_allowed`, `min_contract_months`; `"min_contract_months"` joins
  `NULLABLE_FIELDS` (so `ListingPatch`'s null rule lets an explicit `null` through). `api/app/schemas/search.py`
  `ListingPublic` gains the same three (so `ListingDetail` and search items carry them; `MyListingOut` gets them
  from `ListingOut`). `services/listings.py` needs no change (both paths read a validated `ListingIn`).
- `api/app/services/applications.py` `apply`: **first** (before the rate-limit count, so a refused call costs
  nothing) `if not profiles_service.has_profile(db, seeker.id): raise ProfileRequiredError`;
  `routers/applications.py` maps it to 409 `seeker_profile_required`; the existing 409 `responses` entry's
  description becomes "already_applied, or seeker_profile_required: the seeker has no housing profile (0006a)".
- Tests infrastructure: `api/tests/conftest.py` `db_engine`'s `TRUNCATE` also lists `seeker_profiles` (Postgres
  refuses to truncate `users` while an FK points at it); `make_profile` (Tests to write).
  `test_migrations.py` `_LISTINGS_CHECKS` gains `ck_listings_accepted_households` and
  `ck_listings_min_contract_months`. `test_search.py` `PUBLIC_KEYS` gains the three keys and
  `test_ac2_public_shape_hides_owner_and_lifecycle`'s expected dict gains `"accepted_households": ["single",
  "couple", "family", "roommates"], "smoking_allowed": True, "min_contract_months": None` (`test_applications.py`
  imports `PUBLIC_KEYS`; `test_inbox.py` / `test_geocoding.py` derive theirs from `ListingOut.model_fields`).
- Web (types only, no behaviour): after `make client`, `web/src/features/listings/api.ts` `ListingInBody =
  Required<Omit<ListingIn, 'rooms' | 'accepted_households' | 'smoking_allowed' | 'min_contract_months'>> & {
  rooms: number }` — the wizard sends none of the three until `0006e` (which adds them with an array-aware
  `changedFields`); `web/src/features/listings/__tests__/fixtures.ts` `listing()` and
  `web/src/features/search/__tests__/fixtures.ts` `publicListing()` gain the three defaults.
- `README.md`: a `curl -b seeker.txt -X PUT localhost:8000/me/profile …` (`P`'s body, `$AREA`) before the apply
  curl, and one sentence saying applying needs it.

**Out:**
- The score, `sort=match`, explanations: `0006b` (listings) and `0006c` (inbox). Owners see nothing of a profile
  in this spec.
- Ages, occupation, income, "stable income" (PRODUCT.md: housing preferences only). Room-only preferences
  (gender, roommates' ages, questionnaire): Slice 7.
- Deleting a profile (no `DELETE`; it gates applying, so removing it has no use yet). Profiles for owners. A
  role switch (slice TBD). `GET /me` is unchanged (the web asks `GET /me/profile` when it needs to).
- Rate limit on `PUT /me/profile`: none — one row per user, an idempotent upsert behind a session.
- A "fill your profile" nudge after signup: the web gate (`0006d`) covers it.

**New dependencies:** none.

## Data
`seeker_profiles` (one row per seeker):

| Column | Type | Rule |
| --- | --- | --- |
| `user_id` | `uuid` PK | FK `users.id` `ON DELETE CASCADE` |
| `budget_max_ils` | `integer` NOT NULL | CHECK `ck_seeker_profiles_budget` `BETWEEN 500 AND 100000` (the listing price range) |
| `move_in_date` | `date` NOT NULL | the API refuses a past date or one more than 365 days ahead; a stored date may later pass (`0006b` reads `greatest(move_in_date, current_date)`) |
| `move_in_flexible` | `boolean` NOT NULL DEFAULT `false` | "גמיש ±2 שבועות" |
| `area_ids` | `uuid[]` NOT NULL | CHECK `ck_seeker_profiles_area_ids` `cardinality(area_ids) BETWEEN 1 AND 20`; no FK (arrays cannot carry one): the API checks every id is an active area at write time; a later-deactivated area simply never matches |
| `household` | `text` NOT NULL | CHECK `ck_seeker_profiles_household` `IN ('single','couple','family','roommates')` |
| `has_pets` | `boolean` NOT NULL | |
| `smoker` | `boolean` NOT NULL | |
| `contract_months` | `smallint` NOT NULL | CHECK `ck_seeker_profiles_contract_months` `IN (6, 12, 24, 36)` — the length the seeker wants |
| `parking_needed` | `smallint` NOT NULL DEFAULT `0` | CHECK `ck_seeker_profiles_parking_needed` `BETWEEN 0 AND 2` |
| `created_at`, `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | the upsert sets `updated_at = now()` |

`listings` gains (existing rows get the defaults = "no preference"; nothing else changes):

| Column | Type | Rule |
| --- | --- | --- |
| `accepted_households` | `text[]` NOT NULL DEFAULT `'{single,couple,family,roommates}'` | CHECK `ck_listings_accepted_households` `cardinality(accepted_households) BETWEEN 1 AND 4 AND accepted_households <@ ARRAY['single','couple','family','roommates']::text[]` |
| `smoking_allowed` | `boolean` NOT NULL DEFAULT `true` | `false` = "ללא מעשנים", a deal-breaker for a smoker (`0006b`) |
| `min_contract_months` | `smallint` NULL | CHECK `ck_listings_min_contract_months` `min_contract_months IS NULL OR min_contract_months IN (6, 12, 24, 36)`; `NULL` = no minimum |

`pets_allowed` already exists (`0002a`) and becomes the second deal-breaker in `0006b`; nothing changes here.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /me/profile | `current_seeker` | — | 200 `SeekerProfileOut` | 401; 403 `seeker_only`; 404 `seeker_profile_not_found` (no profile yet) |
| PUT | /me/profile | `current_seeker` | `SeekerProfileIn` | 200 `SeekerProfileOut` (created or replaced) | 401; 403; 422 malformed (list `detail`) or `unknown_area` (string `detail`, as listings) |
| POST | /listings/{id}/applications | as `0004a` | as `0004a` | as `0004a` | **new:** 409 `seeker_profile_required` when the caller has no profile — checked before the rate limit and the listing lookup |
| POST, PATCH | /listings, /listings/{id} | as `0002a` | `ListingIn` / `ListingPatch` + the three fields | `ListingOut` + the three | 422 for a bad value (below) |
| GET | /me/listings, /listings, /listings/{id} | as before | — | items gain the three fields | — |

`SeekerProfileIn` (`extra="ignore"`, like `ListingIn`): `budget_max_ils: int` (500–100000), `move_in_date: date`
(today UTC … today + 365, `MOVE_IN_MAX_DAYS = 365`), `move_in_flexible: bool = False`, `area_ids: list[uuid]`
(1–20 items, no duplicates), `household: Household`, `has_pets: bool`, `smoker: bool`, `contract_months:
ContractMonths`, `parking_needed: int = 0` (0–2). Every other field is required (a deliberate answer, no
default). `SeekerProfileOut`: those nine fields plus `updated_at`, listed explicitly; `area_ids` in the order
sent.

Listing fields: `accepted_households: list[Household]` (1–4, no duplicates; `ListingIn` default all four),
`smoking_allowed: bool` (default `True`), `min_contract_months: ContractMonths | None` (default `None`). In
`ListingPatch` all three are optional; an explicit `"min_contract_months": null` clears the minimum (it is in
`NULLABLE_FIELDS`, and `_merged` treats a sent `null` as a value); an explicit `null` for `accepted_households` or
`smoking_allowed` is a 422 from `ListingPatch`'s null rule (neither is in `NULLABLE_FIELDS`). Responses return
`accepted_households` in `HOUSEHOLDS` order.

## UI
None (web: `0006d`, `0006e`). `make client` regenerates `web/src/api/schema.d.ts`; the web needs the type-only
edits in Scope so `tsc` stays green; the wizard keeps working because the new listing fields have defaults.

## Acceptance criteria
Fixtures as `0004a`/`0004c` (`gush_dan`, `make_owner`, `make_listing`, `make_seeker`, `make_application`,
`signup`, `redis_clean`, `outbox`, `statements`). "Seeker" = `signup(client, outbox, "s@example.com",
"seeker")`. `P` = a valid profile body: budget 7500, move-in today + 30, flexible false, `area_ids: [gush_dan]`,
household `couple`, no pets, non-smoker, 24 months, parking 1.
- [ ] AC1 Given a seeker with no profile, When `GET /me/profile`, Then 404 `{"detail":"seeker_profile_not_found"}`; When `PUT /me/profile` with `P`, Then 200 whose key set is exactly `{budget_max_ils, move_in_date, move_in_flexible, area_ids, household, has_pets, smoker, contract_months, parking_needed, updated_at}` with `P`'s values, and a following `GET` returns the same body — `api/tests/test_profiles.py::test_ac1_seeker_creates_and_reads_profile`
- [ ] AC2 Given that profile, When `PUT` again with budget 9000, household `family`, `has_pets: true`, Then 200 with the new values, `seeker_profiles` still has exactly one row for the seeker, and `updated_at` is later than the first response's — `test_profiles.py::test_ac2_put_replaces_profile`
- [ ] AC3 When `GET` or `PUT /me/profile` with no cookie, Then 401; with an owner's cookie, Then 403 `seeker_only` and no row is written — `test_profiles.py::test_ac3_profile_is_seeker_only`
- [ ] AC4 Given `P` with one change each — `budget_max_ils` 499, 100001, 7500.5; `move_in_date` yesterday, today + 366; `area_ids` `[]`, `[gush_dan, gush_dan]`, 21 distinct uuids; `household` `"group"`; `contract_months` 18; `parking_needed` 3, −1; and `P` minus `has_pets`, minus `smoker`, minus `household` — When `PUT`, Then 422 with a list `detail`; with `area_ids` `[<random uuid>]` or `[<an inactive area>]`, Then 422 `{"detail":"unknown_area"}`; and in every case no row is written — `test_profiles.py::test_ac4_profile_validation` (parametrized)
- [ ] AC5 Given a seeker with no profile and a public listing L, When `POST /listings/{L}/applications`, Then 409 `{"detail":"seeker_profile_required"}`, no `applications` row, and the Redis keys `rl:apply:user:<id>` / `rl:apply:user:day:<id>` do not exist; When the seeker then `PUT`s `P` and applies again, Then 201 — `test_applications.py::test_ac5_apply_requires_profile`
- [ ] AC6 Given a seeker with no profile who already has a `submitted` application (made by `make_application`, as before Slice 6), When they withdraw it and list `GET /me/applications`, Then 200 both (the gate is on applying only) — `test_applications.py::test_ac6_existing_application_needs_no_profile`
- [ ] AC7 Given an owner, When `POST /listings` with the `0002a` AC1 body (none of the three fields), Then 201 with `accepted_households` `["single","couple","family","roommates"]`, `smoking_allowed` true, `min_contract_months` null; When `POST` with `accepted_households: ["couple","single"]`, `smoking_allowed: false`, `min_contract_months: 12`, Then 201 with `["single","couple"]`, false, 12, and the same three values appear on that listing in `GET /me/listings`, `GET /listings/{id}` and the `GET /listings` item — `test_listings.py::test_ac7_owner_preferences_on_create_and_reads`
- [ ] AC8 Given that listing, When `PATCH {"min_contract_months": null}`, Then 200 with null and every other field unchanged; When `PATCH {"accepted_households": ["family"]}`, Then `["family"]`; When `PATCH` with `accepted_households` `[]`, `["single","single"]`, `["group"]`, `null`, `smoking_allowed: null` or `min_contract_months: 18`, Then 422 each and the row is unchanged — `test_listings.py::test_ac8_owner_preferences_patch`
- [ ] AC9 Given a database at revision `"0006"` with one listing, When upgraded to `"0007"`, Then that listing has the three defaults; At `"0007"`: the five `seeker_profiles` CHECK names exist and its FK to `users` is `ON DELETE CASCADE`; an UPDATE of the listing to `accepted_households = '{}'` or `'{group}'` fails with `ck_listings_accepted_households` and `min_contract_months = 18` with `ck_listings_min_contract_months`; deleting a seeker inserted by SQL with a profile also deletes the profile row. When downgraded to `"0006"`, Then `seeker_profiles` and the three columns are gone and the listing row survives — `test_migrations.py::test_ac9_matching_inputs_upgrade_downgrade`
- [ ] AC10 Given seeker S with a profile and another seeker T, When T calls `GET /me/profile`, Then T's own 404 (no endpoint takes a user id; nothing in this spec returns S's profile to anyone but S) — `test_profiles.py::test_ac10_profile_is_private_to_its_seeker`
- [ ] NF1 `make lint` clean (ruff, mypy --strict, and the web `tsc` / eslint after `make client`); `make client` regenerates `schema.d.ts` with the two new operations, `SeekerProfileIn` / `SeekerProfileOut` and the three listing fields; `make test` green (api and web), including every existing listings / search / applications / inbox test (the apply gate adds one statement to `apply`: update any statement-count assertion on it, in the same commit) — CI `api` and `web`
- [ ] NF2 Privacy: `seeker_profiles` is read only by `GET /me/profile`, by `has_profile` (existence only, in `apply`) and (from `0006b`/`0006c`) by the matching queries; `SeekerProfileOut` lists its fields explicitly — AC1 key set + security reviewer

## Tests to write
Unit/integration (pytest, Postgres via compose): `api/tests/test_profiles.py` (AC1–AC4, AC10), additions to
`test_applications.py` (AC5, AC6), `test_listings.py` (AC7, AC8), `test_migrations.py` (AC9). A
`make_profile(engine, user_id, area_id, **overrides) -> None` helper in `conftest.py` (direct insert of `P`'s
values with `area_ids=[area_id]` and a UTC-based move-in date) for `0006b`/`0006c` to reuse; `test_applications.py`'s
`seeker` fixture takes `gush_dan` and calls it. **Every seeker in an existing test that reaches `apply`, through the
endpoint or `applications_service.apply`, however it was created, first gets `make_profile`** (the gate runs before
the listing lookup and the rate limit, so 404 / 409 / 429 expectations break too). At build time, grep `api/tests`
for apply POSTs and `applications_service.apply` — on `main`: `test_applications.py` (`seeker` fixture, `test_ac2`'s
local seeker, `test_ac4`'s `fresh_seeker`, `test_ac9`'s `other` / `daily` / `counted`), `test_inbox.py` (`x`, `y`,
`seeker`, `third_seeker`); on `0005a`'s branch `test_chat.py`'s `_apply`; and anything `0005c` adds. Dates in AC1,
AC2, AC4 and `make_profile` come from `dt.datetime.now(dt.UTC).date()` (as `_not_too_far`), never
`dt.date.today()`: pytest runs on the Mac in Israel time. E2E: none new (`0006d` adds the profile flow); `web/e2e/helpers.ts`
gains `putProfile(page)` (the area from `GET /areas` as `postListing` gets it, `move_in_date: israelDay(30)`, `P`'s
other values, expects 200); `applications.spec.ts` calls it right after `signUp(page, 'seeker', …)` and before
the apply click, `inbox.spec.ts` calls `putProfile(seekerPage)` after the seeker's `signUp` — no new signups (the
OTP budget). `0005b` renames that inbox test (`ac12_shortlist_chat_decline`); whichever merges second rebases and
keeps the `putProfile` line.

## Risks / open questions
- `area_ids` as `uuid[]` without a FK: chosen because scoring is `listing.area_id = ANY(profile.area_ids)` in one
  expression and areas are never deleted (`ON DELETE RESTRICT` from listings). A deactivated area stays in old
  profiles and never matches; the profile page (`0006d`) shows only active areas and drops unknown ids on save.
- The gate breaks every existing seeker flow that applies without a profile, in tests and e2e: the spec makes
  fixing them part of this change (Tests to write).
- Between this merge and `0006d`'s, applying from the web silently does nothing for a seeker without a profile
  (the `0004b` hook reads any 409 as `already_applied`). Nothing is deployed and there are no users, so this is
  accepted; `0006d` maps `seeker_profile_required` to the profile gate and **must merge before any deploy**. The
  e2e tests create the profile through the API.
- Coder on Opus/high (Speed rule 6): a migration on `listings`, a new personal-data table, edits across eight
  existing test files plus web types.
- `contract_months` is one value (the length the seeker wants), not a range: the artboard's "2–3 שנים" maps to
  24, "חוזה קצר בלבד" to 6. A seeker agrees with a listing when `contract_months >= min_contract_months`.
- No open product questions: PRODUCT.md "Matching" (2026-11-11) decided the field list, the deal-breakers and the
  gate.

## Verifier findings — one round, 16 findings, all applied
Verdict: **would reject as written**. Findings 1–6 each turn `make test` or `make lint` red on the coder's first
run. Every finding below comes with its exact fix, so the spec can be marked verified once they are applied.
Checklist: lines 1, 2, 4–10 pass; line 3 (the running app) fails on finding 8. PRODUCT.md "Matching" (2026-11-11):
no contradiction found. The field list, the deal-breakers and the apply gate match it.

1. (blocker) `PATCH {"min_contract_months": null}` returns 422 instead of clearing the minimum, so AC8's first step
   fails. `ListingPatch._at_least_one_key_and_null_only_where_nullable` (`schemas/listing.py:158`) refuses an
   explicit `null` on every field outside `NULLABLE_FIELDS` (`:85`), and it runs before `_merged` sees the
   request. The API section's line "the existing `_merged` re-validation already treats a sent `null` as a value"
   is true of `_merged`, but the request never reaches it. **Fix:** in the Scope bullet for `schemas/listing.py`,
   add `"min_contract_months"` to `NULLABLE_FIELDS`. In the API section, say that an explicit `null` for
   `accepted_households` / `smoking_allowed` is refused by `ListingPatch`'s null rule (neither is in
   `NULLABLE_FIELDS`), not by the merged `ListingIn`.
2. (blocker) Every integration test errors inside the `db_engine` fixture. `conftest.py:110` runs `TRUNCATE TABLE
   applications, listings, sessions, users, areas`, and `0005a` adds `messages, conversations` to that list.
   Postgres refuses to truncate `users` while `seeker_profiles` has an FK to it ("cannot truncate a table referenced
   in a foreign key constraint"), whatever the FK's `ON DELETE`. **Fix:** add to Scope / Tests to write: the
   `conftest.py` `db_engine` TRUNCATE also lists `seeker_profiles`.
3. (blocker) `test_migrations.py::test_ac10_listings_roundtrip` compares the `listings` CHECKs at head with
   `_LISTINGS_CHECKS` as an exact set (`:236`), so the two new CHECKs fail it. **Fix:** add to Scope:
   `_LISTINGS_CHECKS` (`:150`) gains `ck_listings_accepted_households` and `ck_listings_min_contract_months`.
4. (blocker) `test_search.py::test_ac2_public_shape_hides_owner_and_lifecycle` checks the hand-written
   `PUBLIC_KEYS` (`:19`, `:133`) and the item's exact values. `test_applications.py` imports `PUBLIC_KEYS` for two
   more exact key-set checks (`:492`, `:505`). All three fail once `ListingPublic` has the three new fields.
   **Fix:** add to Scope: `PUBLIC_KEYS` gains the three keys, and AC2's expected dict gains
   `"accepted_households": ["single", "couple", "family", "roommates"], "smoking_allowed": True,
   "min_contract_months": None` (the DB defaults that `make_listing` rows get). `test_inbox.py:29` and
   `test_geocoding.py:182` build their key sets from `ListingOut.model_fields` and need no change.
5. (blocker) After `make client`, `make lint` fails on the web `tsc` check. So "UI: None … the current wizard keeps
   working" is wrong at the type level:
   (a) `web/src/features/listings/api.ts:14` defines `ListingInBody = Required<Omit<ListingIn, 'rooms'>> & …`.
   This makes the three new optional `ListingIn` keys required, and `toListingIn` (`validate.ts`) does not set them.
   (b) Two test fixtures build complete objects that lack three newly required response keys:
   `web/src/features/listings/__tests__/fixtures.ts` `listing()` (`MyListingOut`) and
   `web/src/features/search/__tests__/fixtures.ts` `publicListing()` (`ListingPublic`).
   Do not fix this by adding the keys to `toListingIn`. `changedFields` compares values with `===`, so an array
   always counts as changed. Every edit PATCH would then carry `accepted_households`, the `0002e` unsaved-edits
   guard would fire on an untouched form, and two existing tests would fail: `validate.test.ts`
   (`changedFields(…)` `toEqual({})`) and `web/e2e/listings.spec.ts:134` (the exact PATCH body).
   **Fix:** Scope gains a "Web (types only, no behaviour)" bullet:
   - `ListingInBody = Required<Omit<ListingIn, 'rooms' | 'accepted_households' | 'smoking_allowed' |
     'min_contract_months'>> & { rooms: number }`. The wizard sends none of the three until `0006e`, which adds
     them along with an array-aware `changedFields`.
   - Both fixtures gain the three defaults.
   - NF1 names web `make lint` / `make test` too.
6. (blocker) "Every existing apply test that expects 201" is too narrow. The gate runs before the listing lookup and
   the rate limit, so tests that expect 404 / 409 / 429 from apply also get 409, and one test calls the service
   directly. The callers on `main`:
   - `test_applications.py`: the `seeker` fixture (AC1, AC3, AC4, AC5, AC7).
   - `test_applications.py`: `test_ac2`'s local seeker (expects 404 on its own listing).
   - `test_applications.py`: `test_ac4`'s `fresh_seeker` (`:275`, created with `make_seeker`; two threads call
     `applications_service.apply` and expect `["201", "409"]`).
   - `test_applications.py`: `test_ac9`'s `other`, `daily` (expects 429) and `counted` (expects 404 / 201 / 409 and
     hourly counts 1 / 2 / 3).
   - `test_inbox.py`: `x` and `y` (`test_ac1_reapply…`), `seeker` (`test_ac4_status_transitions`) and
     `third_seeker` (`:494`).
   - On the `0005a` branch: `test_chat.py`'s `_apply` helper, which asserts 201.
   **Fix:** in Tests to write, replace that sentence with: "Every seeker in an existing test that reaches `apply`,
   through the endpoint or `applications_service.apply`, however it was created, first gets `make_profile`. At build
   time, grep `api/tests` for apply POSTs and `applications_service.apply` (this also catches `test_chat.py` and
   anything `0005c` adds)."
   Also pin the helper: `make_profile(engine, user_id, area_id, **overrides) -> None`. It inserts `P`'s values with
   `area_ids=[area_id]` and a UTC-based move-in date (finding 9). The `seeker` fixture in `test_applications.py`
   takes `gush_dan` and calls it.
7. (major) The spec reuses an existing error code with a different meaning. `POST /auth/otp/verify` already returns
   422 `{"detail":"profile_required"}`, where "profile" means the signup profile (display name + role): see
   `routers/auth.py:71`, `web/src/features/auth/OtpForm.tsx` `isProfileRequired` and
   `test_auth.py::test_ac2_signup_requires_profile_then_creates_user`. This spec adds a 409 `profile_required` on
   apply that means the housing profile. A web error map keyed on `detail` (`0006d`) could not tell the two apart.
   **Fix:** name the new codes `seeker_profile_required` (apply, 409) and `seeker_profile_not_found`
   (`GET /me/profile`, 404) in Goal, Scope, API, AC1 and AC5. The path `/me/profile` and the class
   `ProfileRequiredError` can stay.
8. (major, checklist 3) From this merge until `0006d` merges, the running web cannot apply. No screen creates a
   profile, and `useApply.ts:38` / `ApplySection.tsx:80` treat every 409 as `already_applied` (refetch, then
   return). A seeker without a profile who presses send sees nothing happen. The spec only says "Production has no
   users yet". **Fix:** add to Risks: "Between this merge and `0006d`'s, applying from the web silently does
   nothing for a seeker without a profile: the `0004b` hook reads any 409 as `already_applied`. Nothing is deployed
   and there are no users, so this is accepted. `0006d` maps `seeker_profile_required` to the profile gate and must
   merge before any deploy. The e2e tests create the profile through the API."
9. (major) The date cases are flaky. `make test-api` runs `uv run pytest` on the host (this Mac,
   Asia/Jerusalem), but the move-in validator uses the UTC date. Between local midnight and 02:00–03:00,
   `dt.date.today()` (the existing tests' idiom) minus one day is still UTC today. AC4's "yesterday" case is then
   accepted and AC4 fails. **Fix:** in Tests to write, AC1, AC2, AC4 and `make_profile` take today from
   `dt.datetime.now(dt.UTC).date()`, as `_not_too_far` in `schemas/listing.py` does.
10. (minor) The spec does not say how up to 20 area ids are checked. `services/listings._check_area` is a private
    helper that takes one id, so calling it per id costs up to 20 statements. **Fix:** in the Scope bullet for
    `services/profiles.py`: "one `SELECT count(*) FROM areas WHERE id = ANY(:ids) AND is_active`. A count below
    `len(area_ids)` (already distinct) raises `listings_service.UnknownAreaError`, which `routers/profiles.py` maps
    to 422 `unknown_area` as `routers/listings.py:48` does."
11. (minor) The household ordering belongs in the schema, not the service. Scope puts "stores `accepted_households`
    in `HOUSEHOLDS` order" in `services/listings.py`, which would mean code in both `create_listing`
    (`data.model_dump()`) and `update_listing` (`getattr(data, name)`). Both paths read a validated `ListingIn`,
    because `_merged` re-validates every PATCH. **Fix:** add one
    `AcceptedHouseholds = Annotated[list[Household], Field(min_length=1, max_length=4), AfterValidator(…)]` to
    `schemas/profile.py`. Its validator raises `ValueError` on a duplicate (a 422) and returns the list in
    `HOUSEHOLDS` order. `ListingIn` and `ListingPatch` use it, and `services/listings.py` needs no change.
12. (minor) `POST /listings/{id}/applications` already documents `409: already_applied` (`routers/applications.py:76`).
    `responses` is a dict, so "documents it in `responses`" means editing that entry, not adding a second one.
    **Fix:** in Scope, that entry's description becomes "already_applied, or seeker_profile_required: the seeker
    has no housing profile (0006a)". `routers/profiles.py` declares `responses=` 401, 403 `seeker_only`, 404
    `seeker_profile_not_found` (GET), 422 (`unknown_area` or a malformed body, PUT) and 503 with `ErrorOut`, as
    `_SEEKER_ONLY` does.
13. (minor) AC9 checks only the defaults and the downgrade. The new CHECKs (`<@`, `cardinality`) and the FK are the
    last line behind the API, and nothing tests them. **Fix:** AC9 also asserts, at revision `"0007"`:
    - the five `seeker_profiles` CHECK names, and its FK to `users` with `ON DELETE CASCADE`;
    - an UPDATE of the listing to `accepted_households = '{}'` or `'{group}'` fails with
      `ck_listings_accepted_households`, and `min_contract_months = 18` fails with `ck_listings_min_contract_months`;
    - deleting a seeker inserted by SQL with a profile also deletes the profile row.
14. (minor) The README's "Applying needs a seeker session" curl (`README.md:67`) now returns 409. **Fix:** add to
    Scope: `README.md` gains one `curl -b seeker.txt -X PUT localhost:8000/me/profile …` (`P`'s body, `$AREA`)
    before the apply curl, plus one sentence saying applying needs it.
15. (minor) The e2e edits should be named exactly, with one shared helper. **Fix:** in Tests to write:
    - `web/e2e/helpers.ts` gains `putProfile(page)`: the area from `GET /areas` as `postListing` gets it,
      `move_in_date: israelDay(30)`, `P`'s other values, and it expects 200.
    - `applications.spec.ts` calls it right after `signUp(page, 'seeker', …)` and before the apply click.
    - `inbox.spec.ts` calls `putProfile(seekerPage)` after the seeker's `signUp`.
    - No new signup, which keeps the e2e OTP budget.
    `0005b` (verified) renames that inbox test to `ac12_shortlist_chat_decline` and extends it. Whichever spec
    merges second rebases and keeps the `putProfile` line.
16. (wording) Two sentences need correcting:
    - Scope says "`ListingPublic` gains the same three (so `ListingDetail`, `MyListingOut` …)". `MyListingOut`
      extends `ListingOut` (`schemas/listing.py`), not `ListingPublic`; it gets the fields from the `ListingOut`
      change.
    - NF2 omits that `has_profile` also reads `seeker_profiles` (existence only, in `apply`).
    **Fix:** correct both sentences.

Verifier note: run the coder on Opus/high (a migration on `listings`, a new personal-data table, and edits across
eight existing test files plus web types).

## Digest (filled by orchestrator after verification)

    Spec 0006a - Matching inputs API: seeker profile, owner preferences, apply gate   (verified, part 1 of 7, depends on 0005a - merged)
    What a user can do after this: a seeker saves a housing profile (budget, move-in, areas, household, pets,
             smoking, contract, parking) via GET/PUT /me/profile and needs it to apply (409
             seeker_profile_required); listings carry accepted households, smoking allowed, minimum contract.
    Decisions: answered (Gilad 2026-11-11, PRODUCT.md "Matching"): housing prefs only, profile required to apply,
             smoking + pets deal-breakers. Nothing new.
    KPIs this slice moves: profile completion rate among seekers; apply rate after the gate.
    Acceptance targets: NF1 lint/test green api + web tsc - NF2 profile readable only by its seeker.
    Risks: until 0006d merges the web cannot apply for a seeker without a profile - mitigation: nothing deployed,
             0006d must merge before any deploy; every existing apply test gets make_profile (listed).
    Reviewers: code, qa, security   Estimated: 1 coder run (Opus/high), 1 review round
    Links: specs/0006a-matching-inputs-api.md - PRODUCT.md "Matching" - design/screens-v1/CreateListing.dc.html (step 4)
