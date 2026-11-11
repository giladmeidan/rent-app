---
id: 0007b
title: Rooms appear in search, on the map and on their page next to apartments (with an apartment/room filter); a seeker never sees a room whose gender preference does not fit them and cannot apply to one; every application records the type it was made to
status: in-review
depends_on: [0007a]      # 0007a: listings.gender_preference / flatmates_count / flatmate_ages / lifestyle, seeker_profiles.gender / flatmate_gender, `GenderPreference` / `Lifestyle` (app.schemas.profile), migration 0009
reviewers: [code, qa, security, perf]   # perf: a caller-dependent join + filter on the public search hot path; security: the first per-caller hiding rule, an apply gate ahead of the rate limiter, a snapshot that 0007c keys PII on; qa: the 13-caller fit table, a migration
estimate: 1 coder run    # coder on Opus/high (migration, apply gate). Split from the original 0007b at Gilad's word (verifier finding 1); the lifestyle score is 0007g
---

## Goal
After this ships, rooms appear next to apartments in `GET /listings` (the list and the map box) and on
`GET /listings/{id}`, carrying the four room fields. `GET /listings` also takes `listing_type=apartment|room`.

Some seekers have a room section in their profile (`0007a`). Such a seeker never sees a room whose gender
preference does not fit them: it is missing from their items, their map and their `total`. They can still open
the room by link, and its page then says `room_fit: false`.

Applying to a room can be refused with `409 seeker_gender_required` or `409 room_gender_mismatch`. Neither
refusal costs rate-limit budget.

Every application now records the listing type it was made to (`applications.listing_type_at_apply`, migration
`0010`). `0007c` keys the owner's room fields on it, and `0007g` keys the owner-side lifestyle criterion on it.

This spec serves Dev Plan slice 7, part b (`0007a`–`0007g`; `0007c` holds the inbox API and web, `0007g` the
lifestyle score). PRODUCT.md rows: "Rooms", "Gender preference", "Search", "Applications". Artboards:
`Search.dc.html` / `SearchDesktop.dc.html` (room cards; the web side is `0007f`).

## Scope
**In:**
- `api/app/matching/fit.py` (new): `room_fit(listing, profile) -> ColumnElement[bool | None]`.
  - The arguments are entities or aliases, as for `match_columns`.
  - It is the one SQL statement of PRODUCT.md "Rooms"' hiding rule (Data).
  - It is NULL for an apartment and for a profile without a room section. Under an outer join it is also NULL
    when there is no profile row. Otherwise it is never NULL.
  - Search, the map box, the count, the listing page and the apply gate all use this one expression. None of them
    restates any part of it.
- `api/app/schemas/search.py`:
  - `SearchParams.listing_type: ListingType | None = None`. None means both types.
  - `ListingPublic` gains four fields: `gender_preference: GenderPreference`, `flatmates_count: int | None`,
    `flatmate_ages: list[int]` (as stored) and `lifestyle: Lifestyle` (answered keys only).
    - `GenderPreference` and `Lifestyle` come from `app.schemas.profile` (`0007a`). They are typed exactly as on
      `ListingOut`.
    - None of the four has a default, so OpenAPI marks all four required.
    - `flatmate_ages` and `lifestyle` are emptied (`[]` / `{}`) for visitors and owners, the listing's own owner
      included; only a signed-in seeker, with or without a profile, gets the stored values (Gilad (b),
      2026-11-11). One builder, `ListingPublic.from_listing`, does it for search items, the map and
      `ListingDetail`, with the seeker-only set in one constant (`SEEKER_ONLY_FIELDS`). The types stay
      required; `ListingOut` / `MyListingOut` (`GET /me/listings`) are unchanged.
  - `ListingDetail` gains `room_fit: bool | None`. It is required and nullable, and the router always sets it.
    Search items do not carry it, because a misfit room never reaches them.
  - Docstring: rooms are public, plus the four fields and `room_fit`.
- `api/app/services/search.py`:
  - `_public_listings()` drops `Listing.listing_type == "apartment"`. It is still the only visibility rule: a live
    listing, apartment or room, in an active area.
  - `_filtered` adds `Listing.listing_type == params.listing_type` when it is set.
  - `search_listings` (signature unchanged). With a `profile_user_id`:
    - The **filtered select itself** joins the seeker's one profile row (`SeekerProfile.user_id ==
      profile_user_id`, as `_with_match` joins it today).
    - It then adds `.where(room_fit(Listing, SeekerProfile).is_not(False))`.
    - The count subquery and the page are both built from that joined, fit-filtered select.
    - The page adds `match_columns` without joining a second time. Restructure `_with_match` so it does not
      re-join.
    - It is still exactly two statements, the count and then the page, so `0006b` AC8's 4 statements for a seeker
      still hold.
  - `get_public_listing_with_match(db, listing_id, profile_user_id) -> tuple[Listing, MatchOut | None, bool |
    None]`. The third element is `room_fit`.
    - With a `profile_user_id`, the same one statement adds `room_fit(Listing, SeekerProfile).label("room_fit")`.
    - Without one, `room_fit` is None.
    - It never filters on the fit: the page is public to everyone.
  - Delete `get_public_listing`. Its only caller (`apply`) moves to `get_public_listing_with_match`.
  - Module docstring: drop "Rooms stay hidden until Slice 7". The match never filters, but the room fit does. It
    is the first caller-dependent filter, applied to the page and the count alike, and only for a seeker with a
    room section. So `total` differs per caller.
- `api/app/routers/search.py`:
  - `get_listing` passes `room_fit` into `ListingDetail`.
  - Drop "room" from the 404 description.
  - Docstring: a cookie can now also remove misfit rooms. That is why `0006b`'s `Cache-Control: private` /
    `Vary: Cookie` cover it.
- `api/app/services/applications.py`:
  - New errors:
    - `SeekerGenderRequiredError`: "the room is for women or men only and the seeker has no room section; they
      must fill it first" (`0007a`).
    - `RoomGenderMismatchError`: "the room's gender preference does not fit the seeker" (PRODUCT.md "Rooms").
  - `apply` gets a new order. It still issues one SELECT for the listing and no new statement:
    1. `has_profile`. Raises `ProfileRequiredError` and costs nothing (unchanged).
    2. `search_service.get_public_listing_with_match(db, listing_id, seeker.id)`. Catch `ListingNotFoundError`
       and remember the listing as missing.
    3. **The gate**, run only when the listing exists and is not the caller's own:
       - `room_fit is False` raises `RoomGenderMismatchError`.
       - `room_fit is None and listing.gender_preference != "any"` raises `SeekerGenderRequiredError`. An
         apartment is always `'any'` (`ck_listings_room_fields`).
    4. `count_or_raise` (unchanged).
    5. A missing or own listing raises `ListingNotFoundError`. It is counted, as today.
    6. `_upsert`, then commit.
  - `_upsert` writes `listing_type_at_apply=listing.listing_type` and sets it again in `on_conflict_do_update`'s
    `set_`, next to the two `0006c` snapshot columns. `_applicants` is untouched here (`0007g`).
  - Docstring "Rules":
    - Rooms are open to applications.
    - The gate runs before the counter, so every apply reads the listing before the limiter, and a 429 now costs
      3 statements instead of 2.
    - A seeker who already applied to a room that no longer fits gets `room_gender_mismatch` on a re-POST, not
      `already_applied` (Risks, Q2).
    - The third snapshot column.
    - Replace the `get_public_listing` mentions at lines 12 and 196.
- `api/app/routers/applications.py`:
  - `apply` maps the two errors to 409 with `detail` `seeker_gender_required` / `room_gender_mismatch`.
  - The 409 description lists all four 409 codes.
  - Drop "room" from the 404 description.
- `api/app/models/application.py`:
  - New column `listing_type_at_apply: Mapped[str] = mapped_column(Text, nullable=False)`.
  - New check `CheckConstraint("listing_type_at_apply IN ('apartment', 'room')",
    name="ck_applications_listing_type_at_apply")`.
  - Column comment: the type the seeker applied to, set again on a reopen. `0007c` keys the inbox's room fields on
    it, and `0007g` the owner's lifestyle criterion. It is never in a response schema.
  - Docstring: "migrations 0005, 0008 and 0010".
- Migration `api/alembic/versions/0010_application_listing_type.py` (Data).
- Tests and fixtures. New `api/tests/test_room_search.py` and an addition to `test_migrations.py`. Amendments to
  existing tests:
  - `api/tests/test_search.py`:
    - `PUBLIC_KEYS` gains `"gender_preference", "flatmates_count", "flatmate_ages", "lifestyle"`.
      `test_applications.py` imports it.
    - `World`'s docstring now reads "`a` and `d` are public".
    - Rename `test_ac1_only_live_apartments_in_active_areas` to `test_ac1_only_live_listings_in_active_areas`. It
      now expects `[world.d, world.a]` (newest first) and `total` 2 for every caller.
    - `test_ac2_public_shape_hides_owner_and_lifecycle`:
      - It takes the item whose `id` is `world.a` rather than `items[0]`, because the room `d` is newer.
      - Its exact dict gains `"gender_preference": "any", "flatmates_count": None, "flatmate_ages": [],
        "lifestyle": {}`.
      - The page asserts `set(one) == PUBLIC_KEYS | {"applicant_count", "room_fit"}` and `one == {**item,
        "applicant_count": 0, "room_fit": None}`.
    - `test_ac9_public_listing_by_id`: `world.d` leaves `hidden` and returns 200.
    - `_BAD_QUERIES` gains `"listing_type=house"` and `"listing_type="`.
  - `api/tests/test_applications.py`:
    - `test_ac3_non_public_listing_is_404` drops its `listing_type="room"` row, because an `'any'` room is now
      open to applications (AC5).
    - `test_ac8_applicant_count_and_view_counter`'s page key set becomes `PUBLIC_KEYS | {"applicant_count",
      "room_fit"}`.
  - `api/tests/test_listings.py::test_ac1_room_fields_on_create_and_reads` (`0007a` AC1). Its hidden-room tail
    flips:
    - The anonymous `GET /listings/{R}` returns 200 with the four room fields and `room_fit: null`.
    - R's id is in `GET /listings`.
    - No other `0007a` test asserts that rooms are hidden: AC2–AC9 were checked against
      `specs/0007a-room-inputs-api.md`. `test_inbox.py::test_ac8_room_section_never_in_inbox` still passes,
      because this spec does not touch the inbox.
  - `api/tests/conftest.py`:
    - `make_application`'s snapshot tuple gains `("listing_type_at_apply", "listing_type")`. Its default is the
      listing's current type, which is what applying writes, and an override is still allowed.
    - Update its docstring.
    - `make_listing` / `make_profile` already take `lifestyle={…}` (`0007a` wraps a dict in `Jsonb`).
- Web: only `web/src/features/search/__tests__/fixtures.ts`, the type-only edit `make client` forces for `tsc`.
  - `publicListing()` gains `gender_preference: 'any', flatmates_count: null, flatmate_ages: [], lifestyle: {}`.
  - `listingDetail()` gains `room_fit: null`.
  - No other `web/src` literal builds a `ListingPublic` or `ListingDetail`. `0007f` takes these as done.

**Out:**
- The `lifestyle` match criterion, the `match_columns(listing_type=…)` keyword that keeps it off apartment
  applications in the owner's inbox, and the `Criterion` web stubs: `0007g`. `0007c` and `0007f` take the
  lifestyle criterion from `0007g`, not from this spec.
- `ListingOut` / `MyListingOut` carrying the four fields, and how those fields are written and validated:
  `0007a`.
- The inbox's room fields and card: `0007c`.
- All web behaviour (`0007f`): type filter, room card, room facts, the "שותפים בגילך" chip, `room_fit` and the
  409 UX.
- Hiding or flagging **existing** applications after a later gender change (decided, Risks Q2).
- A `listing_type` index (Risks).

**New dependencies:** none.

## Data
**Migration `0010_application_listing_type`** (revision `"0010"`, down_revision `"0009"`, `0007a`'s
`0009_room_inputs`). It follows `0008`'s pattern:
1. `add_column("applications", listing_type_at_apply text NULL)`.
2. `UPDATE applications SET listing_type_at_apply = 'apartment'`. This is the literal value, never
   `listings.listing_type`.
3. `alter_column(nullable=False)`.
4. `create_check_constraint("ck_applications_listing_type_at_apply", …)`.
5. Tighten `ck_listings_lifestyle` and `ck_seeker_profiles_lifestyle` to the 7 known keys and numeric values
   1–3, with a strict jsonpath, as drop + create; the downgrade restores the 0009 text. This is the 0007a
   FOLLOWUPS line, added at the orchestrator's request.

The downgrade drops the constraint, then the column. There is no server default, so a write path that forgets the
column fails loudly.

The backfill is literal because that is what was true:
- Since `0004a`, `apply` has reached a listing only through `get_public_listing` → `_public_listings()`.
- `_public_listings()` has held `Listing.listing_type == "apartment"` since `0003a`.
- So every existing application was made to an apartment.
- A listing switched to a room since then (`0002e` allows it) still carries apartment applicants. Copying its
  current type would expose them to `0007c`.
- `make_application` (tests) and the untracked `api/scripts/seed_demo.py` (apartments only) are the only other
  writers. Neither has production rows.

**Fit rule** (`room_fit`; `L` = the listing, `P` = the profile row):

    CASE WHEN L.listing_type = 'room' AND P.gender IS NOT NULL THEN NOT (
           (L.gender_preference = 'women' AND P.gender <> 'woman')
        OR (L.gender_preference = 'men'   AND P.gender <> 'man')
        OR (P.flatmate_gender   = 'women' AND L.gender_preference = 'men')
        OR (P.flatmate_gender   = 'men'   AND L.gender_preference = 'women'))
    END

- Inside the WHEN, every operand is NOT NULL: `gender` is set, so the row exists, and `flatmate_gender` and
  `gender_preference` are NOT NULL columns. So the result is never NULL there.
- An `'any'` room always fits, because all four disjuncts are false.
- Search keeps `room_fit IS NOT FALSE`. An apartment, or a seeker with no room section, gives NULL and is kept.
- Visitors, owners and seekers without a profile get no join and no filter.

The full table is in AC3.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /listings | public; `optional_user` (as `0006b`) | `SearchParams` + `listing_type` (`apartment` \| `room`; omitted = both) | 200 `ListingSearchOut`: items gain the four room fields; for a seeker with a room section, misfit rooms are absent from `items` and `total` | 422 as `0003a`, plus a bad `listing_type` |
| GET | /listings/{id} | public; `optional_user` | — | 200 `ListingDetail` + four room fields + `room_fit` | 404 `not_found` as `0003a`; a live room in an active area is no longer a 404, misfit or not |
| POST | /listings/{listing_id}/applications | as `0004a` (seeker session) | as `0004a` | 201 `MyApplicationOut` (unchanged) | as `0004a` / `0006a`, plus 409 `seeker_gender_required` and 409 `room_gender_mismatch` (neither counted); a public room is no longer a 404 |

`room_fit` is non-null exactly when the listing is a room **and** the caller is a seeker whose profile has a room
section. It is never on search items. The inbox endpoints (`GET /listings/{listing_id}/applications` and its
status `PATCH`) are unchanged here; `listing_type_at_apply` is not in any response.

**POST precedence:**
1. 401 / 403 / 422 (as `0004a`).
2. 409 `seeker_profile_required`. It is still checked before the listing.
3. 409 `room_gender_mismatch` or 409 `seeker_gender_required`, only for a public listing that is not the caller's
   own. The gate is skipped for a missing or own listing, so it never reveals whether a listing exists or who owns
   it.
4. 429.
5. 404.
6. 409 `already_applied`.

Two consequences of this order:
- (a) Every apply now reads the listing **before** the limiter. A 429 therefore costs 3 statements (session,
  profile check, listing), not 2.
- (b) A seeker who already applied to a room that no longer fits them gets `409 room_gender_mismatch` on a
  re-POST, not `already_applied`. `0007f` shows the applied state from `GET /me/applications` anyway.

## UI
None (`0007f`). After `make client`, the web needs only the fixture edit in Scope. Between this merge and
`0007f`'s:
- Rooms appear in the web's search, map and listing page with today's apartment card and facts.
- A gate 409 falls into `useApply`'s "any other 409" branch, which refetches my applications and shows nothing
  new.

Production has no users yet, and `0007f` follows.

## Acceptance criteria
**Fixtures.**
- In `test_room_search.py`, import helpers only from `test_matching.py`: `TODAY` (UTC), `_l0`, `_seeker`,
  `_execute`, `_area`, `_search`, `_ids`, `_user_id`.
- Redefine the pytest fixtures `owner` (a uuid from `make_owner`), `north` and `statements` locally, as each test
  file does. Importing them would be F811.
- Also use `make_listing`, `make_profile`, `make_application`, `set_location` and `signup` from `conftest.py`.
- `R0` = `_l0(db_engine, owner, gush_dan, listing_type="room", flatmates_count=2, **overrides)`.
  `gender_preference` defaults to `'any'`.
- A room section is `make_profile(…, gender=…, flatmate_gender=…)`.
- Every listing date comes from UTC `TODAY`.
- [ ] AC1 Given:
  - a live `R0` with `gender_preference` `women`, `flatmate_ages` `[27, 30]` and `lifestyle={"night": 3,
    "kosher": 2}`;
  - an `L0` apartment;
  - a paused room, an expired room, and a room in an inactive area (`_area(db_engine, "closed", active=False)`).

  When a visitor, an owner and a seeker with no profile each call `GET /listings`,
  Then each response holds exactly the live room and the apartment, with `total` 2:
  - The room item's key set is `PUBLIC_KEYS`, with `gender_preference` `"women"` and `flatmates_count` 2.
  - For the seeker, `flatmate_ages` is `[27, 30]` and `lifestyle` exactly `{"night": 3, "kosher": 2}`
    (answered keys only). For the visitor and the owner they are `[]` and `{}` (AC7).
  - The apartment item has `"any"`, `null`, `[]` and `{}`.
  - `GET /listings/{room}` returns 200 with `room_fit: null` for all three callers, and otherwise the same body
    as that caller's room item.
  - The three hidden rooms return 404 `not_found`, byte-identical to an unknown id.

  Test: `api/tests/test_room_search.py::test_ac1_rooms_are_public_with_room_fields`.
- [ ] AC2 Given two apartments and two `'any'` rooms located inside a box (`set_location`), plus one room outside
  it:
  - `listing_type=apartment` returns the two apartments (`total` 2).
  - `listing_type=room` returns the three rooms (`total` 3).
  - Omitting the parameter returns all five.
  - `listing_type=room` with the box returns the two rooms inside it.
  - `listing_type=house` and `listing_type=` return 422.

  Tests: `test_room_search.py::test_ac2_listing_type_filter` and
  `test_search.py::test_ac7_validation_rejects_bad_params` (amended `_BAD_QUERIES`).
- [ ] AC3 Given four public listings, all inside one box: rooms `W` (`women`), `M` (`men`) and `A` (`any`), and
  apartment `P`.
  When each caller below calls `GET /listings`, `GET /listings?<box>&limit=50` (the map) and
  `GET /listings?listing_type=room`,
  Then each response's id set and `total` are exactly the listings that fit the caller (`P` is absent from the
  `listing_type=room` call),
  And `GET /listings/{x}` returns 200 for all four, with `room_fit` as below. `P` is always `null`. ✓ means
  `true` and visible; ✗ means `false` and hidden from all three searches.

  | caller (gender / flatmates preference) | W | M | A |
  | --- | --- | --- | --- |
  | woman / any | ✓ | ✗ | ✓ |
  | woman / women | ✓ | ✗ | ✓ |
  | woman / men | ✗ | ✗ | ✓ |
  | man / any | ✗ | ✓ | ✓ |
  | man / women | ✗ | ✗ | ✓ |
  | man / men | ✗ | ✓ | ✓ |
  | other / any, other / women, other / men | ✗ | ✗ | ✓ |
  | profile without a room section; seeker without a profile; owner; visitor | all visible, `room_fit` null | | |

  Test: `test_room_search.py::test_ac3_misfit_rooms_hidden_per_seeker`, parametrized over the 13 callers.
- [ ] AC4 Given a seeker with `P0` and room section woman / any, and 30 public listings: 25 that fit (apartments,
  `'any'` rooms and `women` rooms) and 5 `men` rooms, with their created times interleaved.
  When the seeker pages `sort=match&limit=10` at offsets 0, 10 and 20,
  Then the concatenated ids are the 25 that fit, in the order of one `limit=50` request, with no duplicates, and
  every page's `total` is 25. A visitor's `total` is 30.
  Measured after a warm-up and `statements.clear()`:
  - The seeker's `GET /listings?limit=10` runs exactly 4 statements, and both `statements[2]` (the count) and
    `statements[3]` (the page) contain `seeker_profiles`.
  - The visitor's runs exactly 2.
  - `0006b` AC8 also keeps passing unchanged.

  Test: `test_room_search.py::test_ac4_fit_filter_pages_counts_and_adds_no_statement`.
- [ ] AC5 Given `W`, `M`, `A` and `P` as in AC3, the applications (`POST /listings/{id}/applications`) behave as
  follows:
  - A seeker with `P0` and no room section: `W` → 409 `{"detail": "seeker_gender_required"}`; `A` → 201;
    `P` → 201.
  - A seeker woman / any: `M` → 409 `{"detail": "room_gender_mismatch"}`; `W` → 201.
  - A seeker woman / men: `W` → 409 `room_gender_mismatch` (the flatmates contradiction).
  - A seeker without a profile: `W` → 409 `seeker_profile_required`, as before.

  After each 409, no `applications` row exists for the pair, and neither `rl:apply:user:{id}` nor
  `rl:apply:user:day:{id}` grew. An unknown id still returns 404 and counts 1, as in `0004a`.

  The gate runs before the counter. With `rl:apply:user:{id}` set to 10, the woman / any seeker gets 409
  `room_gender_mismatch` for `M` and 429 for `W`. Measured after a warm-up, a gated 409 is exactly 3 statements
  (session, profile check, listing row), and a 201 is exactly 4 (plus the upsert).

  Test: `test_room_search.py::test_ac5_room_apply_gate`.
- [ ] AC6 Snapshot:
  - Applying through the API to an `'any'` room stores `listing_type_at_apply` = `'room'` (read by SQL).
    Applying to an apartment stores `'apartment'`.
  - The seeker then withdraws, and the listing is switched to a room by SQL (`_execute(…, "UPDATE listings SET
    listing_type = 'room', flatmates_count = 2 WHERE id = :id", …)`). A re-apply stores `'room'`: the reopened
    row snapshots again.
  - `make_application` defaults the column to the listing's current type.
  - Walking the `POST` / `GET /me/applications` bodies and the owner's list finds no key `listing_type_at_apply`
    at any depth.

  Migration test:
  - At revision `0009`, insert an apartment listing, then an application with `price_ils_at_apply` and
    `area_id_at_apply` set. Both are NOT NULL with no default since `0008`, unlike `test_migrations.py:794`, which
    inserts at `0007`. Then run `UPDATE listings SET listing_type = 'room'`.
  - Upgrade to `0010`: the value is `'apartment'` and the column is NOT NULL.
  - Setting the value to `'house'` raises an `IntegrityError` that names `ck_applications_listing_type_at_apply`.
  - Downgrade to `0009`: the column is gone, `ck_applications_listing_type_at_apply` is absent from
    `pg_constraint`, and the row survives.
  - Upgrade to `head` succeeds.

  Tests: `test_room_search.py::test_ac6_listing_type_snapshot_on_apply_and_reapply` and
  `test_migrations.py::test_ac6_application_listing_type_backfill_and_downgrade`. The existing
  `test_ac4_autogenerate_sees_no_diff_with_postgis_extensions` keeps passing.
- [ ] AC7 Given a public `women` room with `flatmate_ages` `[27, 30]` and `lifestyle={"night": 3, "kosher": 2}`,
  When each caller below reads the room's item in `GET /listings` and `GET /listings/{room}`:
  - a visitor, another owner and the room's own owner get `flatmate_ages` `[]` and `lifestyle` `{}`. Every other
    field (`gender_preference` `"women"`, `flatmates_count` 2, and the rest) is the same as for a seeker without
    a profile;
  - a seeker without a profile, a seeker with a profile and no room section, and a seeker woman / any get the
    stored values.

  The own owner's `GET /me/listings` still shows the stored values (Gilad (b), 2026-11-11).

  Test: `api/tests/test_room_search.py::test_ac7_room_ages_and_answers_only_to_seekers`.
- [ ] NF1 `make lint` is clean (ruff, mypy --strict, and web eslint / prettier / `tsc`) and `make test` is green
  for api and web, with the amendments in Scope. `make client` regenerates `schema.d.ts` with `SearchParams`'
  `listing_type` query parameter, the four required `ListingPublic` fields and `ListingDetail.room_fit`.
  CLAUDE.md Speed rule 7 (commit d917d05) has CI e2e switched off (`E2E_IN_CI=off`). This spec touches the web,
  so `make e2e` must be green locally on the final head and reported in the digest. Rooms become public; no e2e
  test is expected to change.

  Checks: CI `api`, `web`, and the local `make e2e`.
- [ ] NF2 Performance, measured by the perf reviewer.
  - Harness: 5,000 public listings, 2,000 of them rooms (a third `women`, a third `men`, a third `any`), and a
    seeker with room section woman / any.
  - Calls, 50 local requests each:
    - the seeker's `GET /listings?limit=20` (match order);
    - the seeker's `GET /listings?listing_type=room&limit=20`;
    - the map query (`<box>&limit=50`);
    - a visitor's `GET /listings?limit=20`, as the no-join control.
  - Each call's p95 must be ≤ 80 ms, which is 2× `0006b`'s 39.5 ms baseline (FOLLOWUPS `0006b`). Otherwise it is
    a perf finding, with the `EXPLAIN`.
  - `EXPLAIN (ANALYZE)` of the count and of the page shows no `SubPlan`, `seeker_profiles` read once per statement
    through its primary key, and one sort over the filtered rows.

  Numbers go in the digest. `0007g` re-measures with every room answered.
- [ ] NF3 Privacy:
  - No response carries a profile value. `room_fit` is the caller's own fit, and no response has `gender` or
    `flatmate_gender`.
  - A visitor's or an owner's search response differs from today's only by the four room fields and by the rooms
    now in it.
  - A room's flatmates' ages and questionnaire answers go only to a signed-in seeker; a visitor or an owner gets
    `[]` and `{}` (AC7).

  Checks: AC1, AC3, AC6, AC7, and the security reviewer.

## Tests to write
`api/tests/test_room_search.py` (new) holds AC1–AC7: integration tests, with dates from UTC `TODAY`.
`api/tests/test_migrations.py` gains AC6's migration test.

Amendments, as listed under Scope "Tests and fixtures":
- `test_search.py`: `PUBLIC_KEYS`, AC1 (renamed), AC2, AC9 and `_BAD_QUERIES`.
- `test_applications.py`: AC3, and AC8's key set.
- `test_listings.py`: `test_ac1_room_fields_on_create_and_reads`'s tail.
- `conftest.py`: `make_application`.
- `web/src/features/search/__tests__/fixtures.ts`.

E2E: no new test. `make e2e` runs locally (NF1).

## Risks / open questions
- **Q2 decided** (orchestrator, 2026-11-11; Gilad via digest): (a), existing applications stay put. A later
  gender change by either side leaves existing applications in the inbox and in `GET /me/applications`, and the
  owner can decline them. No new state is needed. Consequence (b) under API: a re-POST answers
  `room_gender_mismatch`.
- **Decided (b)** (Gilad, 2026-11-11): a room's raw flatmates' ages and questionnaire answers were public to
  visitors (security review round 1, major). Now only signed-in seekers see them; visitors and owners get `[]` /
  `{}` (AC7). `MyListingOut` is unchanged.
- **Hidden, not capped.** This is the first caller-dependent filter. `0006b`'s line "`total` can never differ by
  caller" no longer holds for seekers with a room section. Caching is already per caller: every 200 sends
  `Vary: Cookie`, plus `Cache-Control: private` when a cookie is present (`0006b`). `0006b` AC6 keeps passing:
  its `P0` has no room section.
- **The gate runs before the rate limiter.** A refused apply can be repeated without limit. Each repeat costs the
  same 3 cheap reads as the public, unthrottled listing page. The security reviewer to confirm.
- **One bad stored row breaks public search.** `ListingPublic.lifestyle: Lifestyle` is validated on the way out.
  A row with a key outside `LIFESTYLE_KEYS`, or a value outside 1–3, makes every page that includes that row a
  500. `ck_listings_lifestyle` checked only `jsonb_typeof`; 0010's CHECKs now refuse such rows (step 5 of
  the migration). SQL and seed writers must use `0007a`'s keys and values 1–3. The untracked `api/scripts/seed_demo.py` is one
  such writer.
- **Legacy rooms** (`flatmates_count` NULL, `'any'`) become public, as PRODUCT.md "Rooms" decides. The web shows
  no flatmates line for them (`0007f`).
- **Snapshot read.** `listing_type_at_apply` comes from the row read just before the upsert, as the price and area
  snapshots do (`0006c`). A type switch committed in between gives the earlier value. Accepted.
- **Between this merge and `0007g`'s**, rooms are scored on the 8 base criteria only, and no criterion reads
  answers. So the apartment → room probe that `0007g` closes cannot happen yet.
- **Stale after merge.** PRODUCT.md "Search"'s "room listings stay hidden from search until Slice 7" and
  "Listings"' "hidden from search until then" both go stale. The orchestrator updates them.
- **Overlaps.** FOLLOWUPS `0003a` suggests a partial index `WHERE … listing_type='apartment'`. That predicate is
  now wrong, so whoever adds the index drops it. No `listing_type` index is added here; NF2 decides whether one is
  needed. The untracked `api/scripts/seed_demo.py` (someone else's file in the main checkout) builds `Application`
  rows directly. It already lacks `0008`'s columns and also needs `listing_type_at_apply`. It is not in this
  spec's diff.
- **`0007a` names.** `GenderPreference` and `Lifestyle` (a `dict[LifestyleKey, LifestyleAnswer]` alias) come
  from `app.schemas.profile`. `ListingOut` carrying the four fields is `0007a`'s, because `0007e` needs it before
  this spec merges.

## Digest (filled by orchestrator after verification)

    Spec 0007b - Rooms in search, map, listing page and apply (API)   (verified, Slice 7, depends on 0007a; split at Gilad's word, the lifestyle score is 0007g)
    What a user can do after this: rooms show next to apartments in GET /listings, the map and their page, with a
             listing_type filter; a room whose gender preference doesn't fit the seeker (or contradicts their
             flatmates preference) is hidden from that seeker and refused on apply (409 room_gender_mismatch);
             a seeker without a room section must fill it before applying to a women- or men-only room
             (409 seeker_gender_required). Applications record the listing type at apply time (migration 0010).
    Decisions I need from you: none new. Kept: existing applications stay after either side changes gender later.
    KPIs this slice moves: rooms reachable in search; applications to rooms.
    Acceptance targets: NF1 lint/test clean + make e2e green locally - NF2 p95 <= 80 ms (2x 0006b's 39.5 ms) for
             seeker, room-only, map and visitor searches over 5,000 listings - NF3 no gender data in responses.
    Risks: the first per-caller filter on the public search path - mitigation: one SQL fit expression for list,
             map, count, page and apply; perf + security reviewers; EXPLAIN in the NF.
    Reviewers: code, qa, security, perf   Estimated: 1 coder run (Opus/high), 1 review round
    Links: specs/0007b-room-search-api.md - PRODUCT.md "Rooms", "Gender preference", "Search" - no artboard

    Spec 0007b - Rooms in search, map, listing page and apply (API)   PR OPEN #29 (not merged), code head ee78420
    Shipped (API): rooms show next to apartments in search, map and their page (4 room fields, listing_type
             filter); a room whose gender rule doesn't fit a seeker's room section is hidden from them (room_fit:
             false on its page) and refused on apply (409, no rate budget); a room's flatmates' ages and answers go
             only to signed-in seekers (Gilad (b)); applications snapshot listing_type_at_apply (migration 0010,
             which also tightens the lifestyle CHECKs to 7 keys, values 1-3).
    Demo: make dev-api -> GET /listings?listing_type=room as a visitor (all rooms, ages [] / answers {}) -> as a
          seeker woman/any (men-only rooms gone, ages shown) -> POST /listings/{men room}/applications -> 409.
    Tests: +0 unit, +22 integration (AC1-AC7; AC3 x13 callers; gate own/hidden; re-POST after gender change;
           migration), +0 web, +0 e2e (api 406, web 224 with 0007d merged in)
    CI: api 1m45s + web 1m34s green on c7f666a; the final head's run is in the PR. e2e local (CI e2e off) on ee78420:
        10 of 10, 27.5 s (a first run under load timed out once on the map's OSM attribution; rerun clean)
    NF2 (5k listings, 2k rooms; p95 <= 80 ms): seeker match 35-43 ms, rooms 20-22, map 18-21, visitor 13-15; no index
    Findings: 0 blockers; 3 majors: 2 fixed (tests for "gate skipped on own/hidden listing" and "re-POST after a
              gender change"), 1 decided by you, (b), and done (AC7); 8 minors: 4 fixed, 2 to FOLLOWUPS (jsonpath
              1.0 cast note for 0007g/0007c; 50k perf numbers), 2 no action; 6 nits dropped. FOLLOWUPS 0007a
              lifestyle-CHECK line: done by 0010 (left unticked, the file is append-only)
    Decisions I need from you: none. Gilad chose (b) (2026-11-11): flatmate_ages / lifestyle on public listing
             responses only to signed-in seekers; visitors and owners get [] / {}; GET /me/listings unchanged.
    Changed in PRODUCT.md: nothing here; "Search"/"Listings" "rooms hidden until Slice 7" go stale on merge.
    Next: 0007g (lifestyle match) and 0007c (room inbox) build on listing_type_at_apply; 0007f on the 4 fields + room_fit.

## Verifier findings — one round, 9 findings, all applied
The verifier reviewed the original `0007b`. That spec was split into this file and `0007g` at Gilad's word
(finding 1). This record keeps what applies here; `0007g` keeps the rest. The verdict was **would reject as
written**, on findings 1 and 3 here (and 2 in `0007g`). Checklist: line 2 failed on finding 1; line 9 passes now
that the rulings are written in (finding 4).

**Ruling:** Q2 → (a), recorded in Risks.

**Checked against the code and found correct (no change needed):**
- AC3's 13 rows follow the fit rule and match PRODUCT.md "Rooms" word for word ("אחר" sees only `'any'` rooms).
- Statement counts:
  - `resolve_session` (`services/auth.py:210`) and `has_profile` (`services/profiles.py:29`) are one query each.
  - So a gated 409 is 3 statements, and a 201 is 4 (`_out` loads nothing; `expire_on_commit=False`).
  - A seeker's search stays at 4, with the count at index 2 and the page at index 3. `test_matching.py:400-426`
    keeps passing.
- The backfill. `Listing.listing_type == "apartment"` entered `_public_listings()` in b69b9e3 (0003a). `apply` has
  reached listings only through `get_public_listing` since 0c8691b (0004a). `seed_demo.py` (`:86-97`) applies
  only to apartments. The literal `'apartment'` is right.
- The migration pattern (`0008`). The existing migration tests survive `0010`: `test_ac9_application_snapshot_…`
  upgrades to `head` with a row present, and `test_ac10_applications_migration_roundtrip` has no row at `head`.
  `env.py` does not compare CHECKs.
- `conftest.py:238` derives `_APPLICATION_COLUMNS` from the model, so `0007c`'s
  `make_application(…, listing_type_at_apply="room")` works.
- The break list is complete for `test_search.py`, `test_applications.py`, `conftest.py` and `fixtures.ts`
  (`ApplySection.test.tsx:41` uses `listingDetail()`). `test_geocoding.py:326` and `test_chat.py` create no rooms.
- The fit rule is a single expression: list, map box, count (the same joined select), page label and gate all use
  it. The gate's `room_fit is None and gender_preference != 'any'` test is the "room section required" rule, not a
  restatement of the fit rule.
- Callers without a profile or a room section are unaffected.
- Precedence. The gate is skipped for a missing or own listing, so it reveals neither existence nor ownership. An
  unknown id still counts against the limit.
- Caching (`routers/search.py:47-54`).
- `0007c` and `0007f` read `listing_type_at_apply`, `room_fit`, `listing_type`, the four fields and the two 409
  codes exactly as written here.

**Findings (this file's share):**
1. (major) The original spec was too big for one coder run. It is now split: this file covers visibility, the
   filter, the fit rule, the gate and the snapshot; `0007g` covers the lifestyle criterion and the inbox keyword.
   The two run in series, because `0007g` needs `listing_type_at_apply` and public rooms. Applied: frontmatter,
   Goal, Scope, ACs (AC1–AC6), NF1, NF2 (fit filter only), NF3 (bullets 1–2).
3. (major) `0007a`'s `test_listings.py::test_ac1_room_fields_on_create_and_reads` asserts that rooms are hidden
   and would turn `make test` red. Applied: its tail flips (Scope, "Tests and fixtures"). `0007a`'s other ACs
   were checked, and none asserts hiding.
4. (minor) Write the rulings in. Applied: Q2 decided, in Risks. The note that PRODUCT.md "Search" goes stale is
   now a Risks line. Q1 lives in `0007g`.
5. (minor) AC6's migration test needs the `0008` columns at `0009`, and the CHECK must be absent after the
   downgrade. Applied in AC6.
6. (minor) Fixture imports. `north`, `statements` and `owner` are pytest fixtures; importing them is F811.
   Applied: helpers are imported, fixtures are redefined locally, and AC1's inactive area comes from `_area`.
7. (minor) NF2's 150 ms bound cannot catch a regression. Applied: the bound is ≤ 80 ms (2× the 39.5 ms
   baseline), and the visitor control is added.
8. (minor) One bad stored row makes public search 500. Applied: a line in Risks (the `ListingPublic` half; the
   `::numeric` half is in `0007g`).
9. (minor) Two consequences of the new order: a 429 costs 3 statements, and a re-POST to a misfit room answers
   `room_gender_mismatch`. Applied under "POST precedence" and in the `services/applications.py` docstring
   (Scope).
10. (minor) Stale cross-references. Applied:
    - `0006f` is merged (no longer referenced here).
    - `0007c` (`specs/0007c-room-inbox.md`) holds the inbox API and web.
    - The Goal names the parts `0007a`–`0007g`.
    - NF1 runs `make e2e` locally per Speed rule 7 (d917d05).
