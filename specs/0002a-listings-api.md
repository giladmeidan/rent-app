---
id: 0002a
title: An owner creates an apartment or room listing through the API, sees their own listings, and can edit, pause or resume one, with the 3-active-listings cap and the active-area rule enforced
status: in-review
depends_on: [0001a]
reviewers: [code, qa, security]   # security: ownership checks on PATCH (IDOR), role gate, cap race
estimate: 1 coder run
---

## Goal
After this ships, a logged-in **owner** can `POST /listings` with the apartment facts the artboards show
(type, rooms, floor, size, price, entry date, elevator, parking, furnished, pets, arnona, vaad, description,
city, street, launch area), list their own listings with `GET /me/listings`, and edit, pause or resume one
with `PATCH /listings/{id}`. Serves Dev Plan slice 2 (Owner posts listing), part a of two; part b (`0002b`)
is the web wizard and the "my listings" page. PRODUCT.md rows: "Brokers — Owner cap: 3 active listings per
account (admin may raise)", "Launch area — areas are a config table, listings outside are hidden", "Scope —
whole-apartment rentals AND both roommate flows", "Trust (MVP) — listing auto-expiry 30 days".

## Scope
**In:**
- Table `listings` and column `users.listing_cap` (migration `0003_listings`, see Data).
- `api/app/models/listing.py` (`Listing`), exported from `models/__init__.py`; `User` gains `listing_cap`.
  Models declare every named CHECK, FK and index exactly as the migration does, so
  `test_ac4_autogenerate_sees_no_diff_with_postgis_extensions` stays green.
- `api/app/schemas/listing.py`: `ListingIn`, `ListingPatch`, `ListingOut` (fields in Data). Shared text
  rule: `city`, `street`, `description` are stripped (`str_strip_whitespace=True`) and must pass the same
  "visible characters only" validator as `display_name` in `schemas/auth.py` — move that validator to
  `api/app/schemas/_text.py::visible_characters_only(value, *, allow_newlines=False)` and import it from both
  files (no behaviour change for auth; `test_ac11_validation_rejects_bad_input` stays green).
- `api/app/services/listings.py`: `create_listing(db, owner, data)`, `list_own_listings(db, owner)`,
  `update_listing(db, owner, listing_id, patch)`, `_count_live_listings(db, owner_id)` (the cap count, called
  inside the locked section; AC9 monkeypatches it); errors `ListingCapReachedError`, `UnknownAreaError`,
  `ListingNotFoundError`; constant `LISTING_TTL_DAYS = 30`.
- `api/app/auth.py`: dependency `current_owner` = `current_user` + `role == 'owner'`, else 403
  `{"detail":"owner_only"}`.
- `api/app/routers/listings.py`: the three endpoints in API, thin; included in `main.py`.
- Tests: `api/tests/test_listings.py` (new); `conftest.py`: `db_engine` truncates
  `listings, sessions, users, areas`; new helper `signup(client, outbox, email, role) -> TestClient`: signs up through the OTP
  endpoints, then **clears `client.cookies`** and returns a fresh `TestClient(client.app, cookies={"rent_session":
  token})`, so owners A and B in one test never share a cookie jar (lifted from `test_auth.py::_signup`, which
  keeps working); fixture `gush_dan` (depends on `db_engine`; runs `scripts/seed.py::seed_areas` on the test
  engine, then selects and returns the id of slug `gush-dan`); `test_migrations.py` extended.
- `README.md`: one paragraph "Posting a listing locally" with the curl for `POST /listings`.
- No Makefile, compose, CI or `.env.example` change: nothing new is configured.

**Out:**
- Public listing read and search (`GET /listings/{id}`, `GET /listings?…`): Slice 3 (`0003a`). Nothing in this
  slice is readable by anyone but the owner.
- Photos (uploads, R2): `0002c`, specced after Gilad confirms R2's free tier (PRODUCT.md "Pricing").
- Owner preferences for applicants (artboard step 4 "העדפות", the chips on `Listing.dc.html`): Slice 6
  (matching inputs) and Slice 7 (room gender filter, roommates count, questionnaire).
- Drafts ("שמירה כטיוטה" on the artboard): a listing is active the moment it is created; the web preview step
  (`0002b`) is the review-before-publish. Deleting a listing (pause covers the need; hard delete needs the
  applications table from Slice 4 to decide cascade rules). Geocoding / exact address / map pin: Slice 3
  (search map) — this slice stores `city` + `street` text and the launch `area_id` only. The 30-day expiry
  **job** (Slice 10): this slice sets `expires_at` and treats an expired listing as not active; nothing
  flips rows yet. Renewal (`expires_at` reset): Slice 10 with the job. Admin raising `listing_cap`:
  Slice 11 (the column exists so the cap is per account from day one).

**New dependencies:** none. `Decimal` and `datetime` are stdlib; everything else is already pinned.

## Data
Migration `api/alembic/versions/0003_listings.py`, `revision = "0003"`, `down_revision = "0002"`.
Upgrade: `ALTER TABLE users ADD COLUMN listing_cap`, then `CREATE TABLE listings` and its two indexes.
Downgrade: drop the indexes, drop `listings`, drop the column. Additive; nothing running reads these.

`users` (changed)
| column | type | notes |
| --- | --- | --- |
| listing_cap | smallint NOT NULL default 3 | `ck_users_listing_cap`: `listing_cap BETWEEN 0 AND 100`. PRODUCT.md "Owner cap: 3 … (admin may raise)" |

`listings` (new). Money is integer ILS, never float. Text is `text` with `char_length` CHECKs (code points,
like `display_name`). Enumerations are `text` with named CHECKs, not Postgres enums (as in `0001a`).
| column | type | notes |
| --- | --- | --- |
| id | uuid PK default gen_random_uuid() | |
| owner_id | uuid NOT NULL FK users(id) ON DELETE CASCADE | index `ix_listings_owner_id` |
| area_id | uuid NOT NULL FK areas(id) ON DELETE RESTRICT | index `ix_listings_area_id`; must be an `is_active` area at create/update time (service check → 422 `unknown_area`) |
| listing_type | text NOT NULL | `ck_listings_type`: `IN ('apartment','room')`. Room-specific fields come in Slice 7; a room listing uses the same facts (the apartment it sits in) |
| status | text NOT NULL default 'active' | `ck_listings_status`: `IN ('active','paused')`. **Live** = `status = 'active' AND expires_at > now()` |
| city | text NOT NULL | `ck_listings_city_length`: `char_length BETWEEN 1 AND 40` |
| street | text NOT NULL | `ck_listings_street_length`: `char_length BETWEEN 1 AND 80`. Street name only; no house number is collected (artboard: "המיקום המדויק יישלח לאחר אישור") |
| rooms | numeric(3,1) NOT NULL | `ck_listings_rooms`: `rooms BETWEEN 1 AND 20 AND rooms * 2 = floor(rooms * 2)` (half rooms allowed, 3.5) |
| floor | smallint NOT NULL | `ck_listings_floor`: `BETWEEN -2 AND 100` (0 = ground, negatives = basement) |
| total_floors | smallint NULL | `ck_listings_total_floors`: `total_floors IS NULL OR total_floors >= floor` |
| size_sqm | smallint NOT NULL | `ck_listings_size_sqm`: `BETWEEN 5 AND 1000` |
| price_ils | integer NOT NULL | `ck_listings_price_ils`: `BETWEEN 500 AND 100000` (monthly) |
| available_from | date NOT NULL | a past date means "immediate" (Search artboard "כניסה מיידית"); schema caps it at today + 730 days |
| entry_flexible | boolean NOT NULL default false | artboard "גמיש ±2 שבועות" |
| elevator | boolean NOT NULL | |
| parking_spots | smallint NOT NULL default 0 | `ck_listings_parking_spots`: `BETWEEN 0 AND 5` |
| furnished | text NOT NULL | `ck_listings_furnished`: `IN ('none','partial','full')` (Listing artboard shows "חלקית") |
| pets_allowed | boolean NOT NULL | |
| arnona_ils | integer NULL | `ck_listings_arnona_ils`: `BETWEEN 0 AND 20000` (bi-monthly bill as shown, "~480 ₪") |
| vaad_ils | integer NULL | `ck_listings_vaad_ils`: `BETWEEN 0 AND 5000` (monthly) |
| description | text NULL | `ck_listings_description_length`: `char_length <= 2000` |
| created_at | timestamptz NOT NULL default now() | |
| updated_at | timestamptz NOT NULL default now() | set by the service on every PATCH (`now()` from the DB, not Python) |
| expires_at | timestamptz NOT NULL | set by the service at create to `now() + LISTING_TTL_DAYS`; never moved in this slice |

Pydantic (`schemas/listing.py`). **Every bound in the table above is repeated on the Pydantic field**
(`Field(ge=…, le=…)`, `min_length`/`max_length` after strip, `Literal[...]`), so a bad value is a 422 with a
list `detail`, never a DB `IntegrityError` (a 500). `ListingIn` fields, explicitly: required —
`listing_type: Literal['apartment','room']`, `area_id: UUID`, `city: str` (1–40), `street: str` (1–80),
`rooms: Decimal` (`max_digits=3, decimal_places=1`, `ge=1, le=20`, validator "multiple of 0.5"),
`floor: int` (−2..100), `size_sqm: int` (5..1000), `price_ils: int` (500..100000), `available_from: date`
(validator `<= today + 730 days`, UTC today), `elevator: bool`, `furnished: Literal['none','partial','full']`,
`pets_allowed: bool`; optional — `total_floors: int | None = None` (model validator `>= floor` when set),
`entry_flexible: bool = False`, `parking_spots: int = 0` (0..5), `arnona_ils: int | None = None` (0..20000),
`vaad_ils: int | None = None` (0..5000), `description: str | None = None` (≤ 2000 after strip; `""` → `None`).
There is **no** `status` in `ListingIn` (a client never sets it on create). `rooms` is serialised as a JSON
number via `Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]` (Pydantic v2
would otherwise emit the string `"3.5"`).
Text rule: `city`, `street`, `description` use `schemas/_text.py::visible_characters_only(value, *,
allow_newlines=False)`; `description` first normalises `\r\n` → `\n` and calls it with
`allow_newlines=True` (multi-line descriptions are valid; `display_name` keeps rejecting newlines, so
`test_ac11` is unchanged).
`ListingPatch` = every `ListingIn` field as `| None` with **no defaults applied** plus
`status: Literal['active','paused'] | None`; model validator "at least one key sent" (`model_fields_set`
non-empty, else 422). Semantics: a key **not sent** leaves the column unchanged; an explicit `null` clears a
nullable column (`total_floors`, `arnona_ils`, `vaad_ils`, `description`) and is a 422 on any other field.
The service merges the sent keys onto the current row's values and re-validates the result with
`ListingIn.model_validate(...)`; a `ValidationError` there is re-raised as FastAPI's
`RequestValidationError(exc.errors())`, so cross-field rules (`total_floors >= floor`) answer 422 with a
list `detail`, never a DB CHECK failure.
`ListingOut` = `ListingIn` fields + `id`, `owner_id`, `status`, `created_at`, `updated_at`, `expires_at`.
No `is_live` flag: clients compute `status === 'active' && expires_at > now`.

## API
All three endpoints require the `rent_session` cookie (`0001a`) **and** `role = 'owner'` via `current_owner`:
401 `{"detail":"unauthenticated"}` without a valid session, 403 `{"detail":"owner_only"}` for a seeker. A
seeker never gets a listing-shaped response; role switching is a later slice (`PATCH /me`).

| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | /listings | owner session (`current_owner`) | `ListingIn` | 201 `ListingOut`, `status='active'`, `expires_at = now()+30d`. Cap rule: inside one transaction, `SELECT … FOR UPDATE` the owner's `users` row, count the owner's **live** listings; if `count >= listing_cap` → 409, else insert. The row lock makes two concurrent creates serialise (AC9) | 401 · 403 `owner_only` · 409 `{"detail":"listing_cap_reached"}` · 422 `{"detail":"unknown_area"}` when `area_id` is not an active area · 422 validation (list `detail`) · 503 DB |
| GET | /me/listings | owner session | – | 200 `list[ListingOut]`: every listing whose `owner_id` is the caller (active, paused and expired alike), newest `created_at` first. One query. `[]` for an owner with none | 401 · 403 `owner_only` · 503 |
| PATCH | /listings/{id} | owner session **and** `listing.owner_id == user.id` | `ListingPatch` (≥ 1 field) | 200 `ListingOut` with the changed fields and a fresh `updated_at`. `status: 'active'` on a paused listing re-applies the cap rule (the resumed listing is not counted; 409 when the others already fill the cap). `area_id` re-checked like create. `expires_at` is untouched (resuming an expired listing leaves it expired; renewal is Slice 10) | 401 · 403 `owner_only` · 404 `{"detail":"not_found"}` for an unknown id **and** for another owner's listing (same body and status: no existence leak) · 409 `listing_cap_reached` · 422 `unknown_area` / validation (incl. empty body) · 503 |

No `DELETE`, no public `GET` (Out). Router file `routers/listings.py`; the `/me/listings` route lives there
too (same tag `listings`), not in `routers/auth.py`.

## UI
None in this part. The wizard and "my listings" page are `0002b`.

## Acceptance criteria
- [ ] AC1 Given a logged-in owner (`signup(..., role="owner")`) and the seeded `gush_dan` area, When `POST /listings` with a full valid body (`listing_type: "apartment"`, `rooms: 3.5`, `floor: 3`, `total_floors: 5`, `size_sqm: 95`, `price_ils: 7200`, `available_from` 30 days ahead, `entry_flexible: true`, `elevator: true`, `parking_spots: 1`, `furnished: "partial"`, `pets_allowed: true`, `arnona_ils: 480`, `vaad_ils: 150`, `city: " גבעתיים "`, `street: "כצנלסון"`, `description: "דירה מוארת"`), Then 201, the body has `status: "active"`, `rooms: 3.5`, `city: "גבעתיים"` (stripped), `owner_id` = the caller's id, `expires_at` between 29 and 31 days after `created_at`, and exactly one `listings` row exists — `api/tests/test_listings.py::test_ac1_owner_creates_listing`
- [ ] AC2 Given no cookie, When `POST /listings`, `GET /me/listings`, `PATCH /listings/{uuid}`, Then 401 `unauthenticated` each; Given a logged-in seeker, Then 403 `owner_only` each and no row is written — `api/tests/test_listings.py::test_ac2_requires_owner_session`
- [ ] AC3 Given an owner with 3 live listings, When a 4th `POST`, Then 409 `listing_cap_reached` and still 3 rows; When one is `PATCH`ed to `status: "paused"` and the `POST` is repeated, Then 201; When `listing_cap` is set to 5 by SQL, Then another `POST` succeeds; Given one of the live listings has `expires_at` moved into the past by SQL, Then it no longer counts (a `POST` that was 409 becomes 201) — `api/tests/test_listings.py::test_ac3_cap_counts_live_listings_only`
- [ ] AC4 Given bodies with `rooms: 2.3`, `rooms: 0.5`, `rooms: 20.5`, `price_ils: 100`, `price_ils: 7200.5`, `size_sqm: 3`, `floor: 3, total_floors: 2`, `city` of 41 code points, `city: " "`, `street` of 81, `description` of 2001, `available_from` 3 years ahead, `listing_type: "villa"`, `furnished: "yes"`, `parking_spots: 6`, a `description` containing `\u202e`, a `city` containing `\n`, and a body missing `elevator`, When `POST`, Then 422 with a list `detail` for each and no row is written; Given a `description` of three lines joined with `\r\n`, Then 201 and the stored value uses `\n` — `api/tests/test_listings.py::test_ac4_validation_rejects_bad_input`
- [ ] AC5 Given `area_id` of a random uuid, and given the seeded area with `is_active = false` (SQL), When `POST`, Then 422 `{"detail":"unknown_area"}` both times and no row — `api/tests/test_listings.py::test_ac5_unknown_or_inactive_area_rejected`
- [ ] AC6 Given owner A with two listings created 1 s apart (the second paused) and owner B with one, When A calls `GET /me/listings`, Then exactly A's two, newest first, the paused one with `status: "paused"`; When a fresh owner calls it, Then `[]`; the request executes exactly 2 SQL statements in total (the session lookup and the list), of which exactly one contains `FROM listings` (counted with a SQLAlchemy `before_cursor_execute` listener on the test engine) — `api/tests/test_listings.py::test_ac6_me_listings_is_own_newest_first`
- [ ] AC7 Given owner A's listing, When A `PATCH`es `{"price_ils": 7500, "status": "paused"}`, Then 200 with both values and `updated_at > created_at`, other fields unchanged; When B `PATCH`es the same id, Then 404 `not_found` and A's row is unchanged; When A `PATCH`es an unknown uuid, Then 404 with the identical body; When A sends `{}`, Then 422; When A sends `{"total_floors": 1}` on a listing with `floor: 3`, Then 422 with a list `detail` (not a 500); When A sends `{"arnona_ils": null}`, Then 200 and `arnona_ils` is `null`; When A sends `{"price_ils": null}`, Then 422 and the price is unchanged — `api/tests/test_listings.py::test_ac7_patch_own_listing_only`
- [ ] AC8 Given an owner at the cap with one paused listing, When the paused one is `PATCH`ed to `active`, Then 409 `listing_cap_reached` and it stays paused; Given the owner then pauses a live one, When the first is resumed, Then 200 `status: "active"` and `expires_at` unchanged — `api/tests/test_listings.py::test_ac8_resume_reapplies_cap`
- [ ] AC9 Given an owner with `listing_cap - 1` live listings, When `services.listings.create_listing` is called from two threads, each with its own `Session` (as `test_auth.py::test_otp_single_use_under_concurrency` does), a `threading.Barrier(2)` **before** the call (never inside the locked section: the second thread waits on the row lock and the barrier would time out), and `_count_live_listings` monkeypatched to call the real function and then `sleep(0.3)` so the count-then-insert sections overlap, Then exactly one call returns a listing and the other raises `ListingCapReachedError`, and the owner has exactly `listing_cap` live rows (without the `FOR UPDATE` lock this test fails with `listing_cap + 1` rows) — `api/tests/test_listings.py::test_ac9_concurrent_creates_respect_cap`
- [ ] AC10 Given an empty DB, When `upgrade head` → `downgrade base` → `upgrade head`, Then `listings` exists with every CHECK named in Data, `ix_listings_owner_id`, `ix_listings_area_id`, and `users.listing_cap` exists with default 3 and `ck_users_listing_cap` (queried from `pg_constraint` / `pg_indexes` / `information_schema.columns`); `test_ac4_autogenerate_sees_no_diff_with_postgis_extensions` stays green — `api/tests/test_migrations.py::test_ac10_listings_roundtrip`
- [ ] NF1 `make lint` clean (ruff, mypy --strict); `make client` regenerates `web/src/api/schema.d.ts` with the three paths (the CI `web` job runs it) — CI `api` and `web` jobs
- [ ] NF2 Money and sizes are integers end to end (`price_ils`, `arnona_ils`, `vaad_ils`, `size_sqm` are `int` in `ListingIn`/`ListingOut`; `7200.5` is a 422 in AC4) and `rooms` round-trips as `3.5`, never `3.50000001` (`Decimal` in the schema, `numeric(3,1)` in the DB) — AC1, AC4

## Tests to write
Unit: AC4 (schema only, via the endpoint for simplicity). Integration (Postgres via `TEST_DATABASE_URL`,
`redis_clean` + `outbox` for the OTP-based `signup` helper): AC1–AC9. AC10 on the `_mig` database like
`0000a` AC4 / `0001a` AC13. E2E: none (API only; `0002b` AC covers the browser flow).

## Risks / open questions
- **Product assumptions taken by the orchestrator (2026-11-10), for Gilad's batch approval via the digest;
  the coder follows them as written:** (1) the field list above is the artboards' field list; (2) no drafts
  — a listing is live on create, the web preview is the review step; (3) `expires_at` is set at create,
  30 days, and nothing renews it until Slice 10; (4) a `room` listing uses the same fields as an apartment
  for now; (5) `arnona_ils` is the bi-monthly bill as the artboard shows it, `vaad_ils` monthly; (6) the cap
  counts live listings only (paused/expired free a slot). A different decision on any of these before the
  build is a spec edit, not a product blocker; after the build it is one migration or none.
- `ON DELETE CASCADE` from `users`: deleting an account (Slice 10) takes its listings with it; Slice 4
  must decide what happens to applications on such a listing before that becomes reachable.
- The cap race is closed with `SELECT … FOR UPDATE` on the owner's `users` row, which also serialises
  concurrent PATCHes by the same owner — fine at this scale; AC9 proves the create path only.
- 404 for another owner's listing (not 403) means a bug that hands out wrong ids is invisible to the
  client; the security reviewer checks the ownership predicate is in the SQL `WHERE`, not in Python after
  a `SELECT` by id.
- `area_id` is chosen by the client from `GET /areas`; with one seeded area there is no real choice yet.
  Slice 3 adds geocoding and the "inside the area polygon" check; until then "listings outside are hidden"
  is enforced by the FK + `is_active` check alone.
- Room listings created here have no gender-preference field, while PRODUCT.md makes gender a hard filter
  on ROOM listings. Slice 3 search must exclude `listing_type = 'room'` until Slice 7 adds the field (or
  Slice 7 backfills it before rooms become searchable). Written into `0003a` when it is specced.
- `available_from` has no lower bound (past = immediate). Search (Slice 3) renders dates ≤ today as
  `כניסה מיידית`.
- No open product questions beyond the assumptions above; PRODUCT.md rows "Brokers" (cap), "Launch area",
  "Scope", "Trust (MVP)" are followed as written.

Changes after verifier round 1 (2026-11-10): `ListingIn` fields listed explicitly (`area_id` in, `status`
out, defaults stated); every DB bound repeated on the Pydantic field; `rooms` serialised as a JSON number;
`visible_characters_only(allow_newlines=…)` so descriptions may span lines; PATCH null semantics and
merge-then-revalidate (cross-field rules answer 422, not 500); AC9 rewritten around the service call with a
delayed `_count_live_listings`; `signup` returns a client with its own cookie jar, `gush_dan` returns the id,
AC6 counts statements precisely; room/gender risk handed to Slice 3.

Verifier notes (2026-11-10): round 1 rejected with 8 findings, all applied above; one verifier round per spec,
so the orchestrator set `verified`.

## Digest (filled by orchestrator after verification)

    Spec 0002a — Listings API: create, my listings, edit/pause/resume   (verified, part 1 of 2, builds on main)
    What a user can do after this: an owner POSTs an apartment or room listing with the artboard's facts (rooms, floor, size, price, entry date, elevator, parking, furnished, pets, arnona, vaad, description, city, street, area), lists their own, and pauses/resumes/edits one; a 4th live listing is refused (cap 3).
    Decisions I need from you (reply with numbers; the build runs on the recommendations meanwhile):
      1. Field list = the CreateListing/Listing artboards' facts, no photos yet (recommend: accept; photos are 0002c once you confirm R2's free tier).
      2. No drafts: a listing is live on create, the web preview step is the review (recommend: accept; "save as draft" from the artboard is dropped for MVP).
      3. Expiry: expires_at = create + 30 days, no renewal until Slice 10's job (recommend: accept).
      4. Room listings use the same fields as apartments for now; Slice 3 search hides rooms until Slice 7 adds the gender filter (recommend: accept).
      5. Cap counts live listings only — paused or expired ones free a slot (recommend: accept).
    KPIs this slice moves: listings created (first supply-side number).
    Acceptance targets: NF1 ruff + mypy --strict clean, make client regenerates the three paths · NF2 money and sizes are integers, rooms round-trips as 3.5.
    Risks: cap race between two concurrent creates — mitigation: FOR UPDATE on the owner row, AC9 proves it.
           PATCH on another owner's listing — mitigation: 404 with the ownership predicate in SQL, security reviewer checks it.
    Reviewers: code, qa, security   Estimated: 1 coder run, 1 review round
    Links: specs/0002a-listings-api.md · PRODUCT.md "Brokers" (cap), "Launch area", "Scope", "Trust (MVP)" · design/screens-v1/CreateListing.dc.html, Listing.dc.html (field list)

    Spec 0002a — Listings API: create, my listings, edit/pause/resume   IN REVIEW · PR #5 (giladmeidan/rent-app), head = this commit
    Shipped: an owner POSTs an apartment or room listing (type, rooms, floor, size, price, entry date, elevator, parking,
             furnished, pets, arnona, vaad, description, city, street, launch area), lists their own with GET /me/listings and
             edits, pauses or resumes one with PATCH /listings/{id}; a 4th live listing is 409, a seeker is 403, another owner's
             listing is 404; a listing expires 30 days after creation (nothing renews it yet).
    Demo: 1) make dev; sign up as an owner via /auth/otp/request + /auth/otp/verify (code in .outbox/), AREA from GET /areas
          2) the curl in README "Posting a listing locally" → 201 with rooms 3.5; repeat it 3 more times → the 4th is 409 listing_cap_reached
          3) PATCH /listings/{id} {"status":"paused"} → 200; POST again → 201; GET /me/listings → 4 rows, newest first
    Tests: +0 unit, +16 integration (AC1–AC10 by name, plus CRLF, blank description, PATCH area re-check and 3 review regressions;
           123 collected vs 88 on main), +0 e2e   CI: api 59 s · web 1 min 04 s · e2e label-gated, runs on this head
    Findings: 0 blockers, 1 major fixed (FastAPI's default 422 handler echoed `input`: NaN/Infinity or a lone surrogate in a body
              gave a 500 and logged the body, email included; pre-existing on /auth too; now a custom handler without `input`),
              2 minors fixed (display_name message restored, invisible code points escaped in source), 4 follow-ups logged
              (lax number coercion, resumed-but-expired shows "active", more invisible characters before 0003a, unbounded total
              rows per owner / unpaginated list), 11 nits dropped
    Changed in PRODUCT.md: nothing (the 6 assumptions in Risks stand, pending Gilad's batch approval of the verified digest above)
    Next spec I propose: 0002b — Owner posts a listing (web wizard + my listings), already verified; start from this branch.
              Note for 0002b: a resumed listing whose expires_at is past returns status "active"; render it as expired.
