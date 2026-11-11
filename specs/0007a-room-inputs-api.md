---
id: 0007a
title: An owner's room listing stores who the room is for, how many flatmates live there (and, optionally, their ages) and the flat's questionnaire; a seeker saves a profile "room section" (gender, birth year, flatmates preference, questionnaire). Stored and validated only; rooms stay hidden from search
status: in-review
depends_on: []           # migration chain 0008 -> 0009 (0008 is main's head); 0007b adds 0010 on top
reviewers: [code, qa, security]   # security: gender and birth year are new personal data on seeker_profiles; qa: validation table, PATCH merge and type-switch rules
estimate: 1 coder run
---

## Goal
After this ships, an owner can create or edit a **room** listing (`POST /listings`, `PATCH /listings/{id}`)
with who the room is for (נשים / גברים / לא משנה), how many flatmates already live there, their ages
(optional, some or all) and the flat's answers to the 7-question lifestyle questionnaire, and reads them back
on `GET /me/listings`. A seeker can save a **room section** on `PUT /me/profile`: own gender (אישה / גבר / אחר),
an optional birth year, a flatmates preference (נשים / גברים / לא משנה) and their own questionnaire answers,
and reads it back on `GET /me/profile`. These are the inputs of the room fit rule and the `lifestyle` match
criterion (`0007b`) and of the owner inbox room fields (`0007c`). Rooms stay hidden from search, the listing
page and applying until `0007b`. Serves Dev Plan slice 7 (Rooms + questionnaire), part a of seven.
PRODUCT.md rows "Rooms" (2026-11-11), "Gender preference", "Listings" (rooms hidden until Slice 7) and
"Listing edit" (an edit may switch apartment/room).

**Slice 7 is split in six** (one coder run each):
- `0007a` (this): migration `0009_room_inputs`, the room listing fields, the seeker room section, the shared
  `Lifestyle` type, validation on create / PATCH / type switch.
- `0007b`: rooms public in search, listing page and map, the `listing_type` filter, per-seeker gender hiding,
  the apply gate for rooms, `listing_type_at_apply` (migration `0010`), the `lifestyle` match criterion.
  `depends_on: [0007a]`.
- `0007c` (`specs/0007c-room-inbox.md`): owner inbox, API and web card: applicant gender, age and answers on
  room applications only (the former `0007g` was merged into it). `depends_on: [0007b, 0007d, 0006g]`.
- `0007d`: web: the `/me/profile` room section and the shared `web/src/features/lifestyle/`.
  `depends_on: [0007a]`.
- `0007e`: web: listing wizard room fields (create and edit) and the flat's questionnaire.
  `depends_on: [0007a, 0007d, 0006e]`.
- `0007f`: web: search type filter, room card, room facts on the listing page, the "שותפים בגילך" chip, room
  apply gate UX. `depends_on: [0007b, 0007d, 0006f]`.

## Scope
**In:**
- Migration `api/alembic/versions/0009_room_inputs.py` (revision `"0009"`, down `"0008"`): four `listings`
  columns, four `seeker_profiles` columns and their CHECKs (Data). Existing rows get the defaults. A working
  `downgrade` drops the CHECKs, then the columns.
- `api/app/models/listing.py`: the four columns and five CHECKs. `api/app/models/seeker_profile.py`: the four
  columns and five CHECKs. `lifestyle` is `sqlalchemy.dialects.postgresql.JSONB`, the first `jsonb` column in the
  repo (`Mapped[dict[str, int]]`). `flatmate_ages` is `ARRAY(SmallInteger)` (`Mapped[list[int]]`).
  Autogenerate sees no diff
  (`test_migrations.py::test_ac4_autogenerate_sees_no_diff_with_postgis_extensions` stays green; `env.py` compares
  neither CHECKs nor server defaults). Both module docstrings name the new fields. `seeker_profile.py`'s privacy
  note gains the room section and its future readers (`0007b` fit rule and score, `0007c` inbox on room
  applications).
- `api/app/schemas/profile.py` (it already holds the types that listings and profiles share, such as
  `AcceptedHouseholds`) gains:
  - `SeekerGender = Literal["woman", "man", "other"]`;
  - `GenderPreference = Literal["any", "women", "men"]`, used by both a listing's `gender_preference` and a
    seeker's `flatmate_gender`;
  - `LifestyleKey = Literal["cleanliness", "guests", "night", "social", "kosher", "shabbat", "work_from_home"]`
    and `LIFESTYLE_KEYS: tuple[LifestyleKey, ...] = get_args(LifestyleKey)` (canonical order, like
    `HOUSEHOLDS`);
  - `LifestyleAnswer = Literal[1, 2, 3]` and **`Lifestyle = dict[LifestyleKey, LifestyleAnswer]`**. An unknown
    key or a value outside 1–3 is a 422. A `BeforeValidator` refuses more than 7 keys or any unknown key as one error at
    `["body", "lifestyle"]` that names no key (review round 1, security). Only answered keys are stored and returned. Pydantic's lax mode turns
    `true` into 1 and `2.0` into 2 (stored as JSON integers), as it already does for `contract_months`; no test
    relies on either. Key order in a response is not significant (jsonb stores keys shortest first, then
    bytewise): clients iterate `LIFESTYLE_KEYS`. No sorting validator;
  - `AGE_MIN = 18`, `AGE_MAX = 99`, and `BirthYear = Annotated[int, AfterValidator(_adult_birth_year)]`. The
    validator raises `ValueError` unless `Y - AGE_MAX <= value <= Y - AGE_MIN`, where
    `Y = dt.datetime.now(dt.UTC).year`.

  `SeekerProfileIn` gains:
  - `gender: SeekerGender | None = None`;
  - `birth_year: BirthYear | None = None`;
  - `flatmate_gender: GenderPreference = Field(default_factory=lambda: "any")`;
  - `lifestyle: Lifestyle = Field(default_factory=dict)`;
  - `@model_validator(mode="after") _room_section_needs_gender`: with `gender` None, a `birth_year`, a
    `flatmate_gender` other than `"any"` or a non-empty `lifestyle` raises `ValueError` (a 422, mirroring
    `ck_seeker_profiles_room_section`).

  Defaults use factories for the same reason `ListingIn` gives (`schemas/listing.py:114`): a JSON-schema
  `default` makes the generated web type require the key, and `0006d`'s `toProfileIn` sends none of the four
  until `0007d`. A `None` default stays optional in the web type. `SeekerProfileOut` gains
  `gender: SeekerGender | None`, `birth_year: int | None`, `flatmate_gender: GenderPreference` and
  `lifestyle: Lifestyle`, listed explicitly.
- `api/app/schemas/listing.py`:
  - `FlatmatesCount = Annotated[int, Field(ge=1, le=7)]`;
  - `FlatmateAges = Annotated[list[Annotated[int, Field(ge=AGE_MIN, le=AGE_MAX)]], Field(max_length=7)]`;
  - `ROOM_FIELD_DEFAULTS: dict[str, Any] = {"gender_preference": "any", "flatmates_count": None,
    "flatmate_ages": [], "lifestyle": {}}`, the apartment values that `ck_listings_room_fields` requires.
    Never mutated.

  `ListingIn` gains:
  - `gender_preference: GenderPreference = Field(default_factory=lambda: "any")`;
  - `flatmates_count: FlatmatesCount | None = None`;
  - `flatmate_ages: FlatmateAges = Field(default_factory=list)`;
  - `lifestyle: Lifestyle = Field(default_factory=dict)`;
  - one more `@model_validator(mode="after") _room_fields(self, info: ValidationInfo)`, with three checks:
    (1) an `apartment` whose four room fields differ from `ROOM_FIELD_DEFAULTS` raises "gender_preference,
    flatmates_count, flatmate_ages and lifestyle are for a room only";
    (2) a `room` with `flatmates_count` None raises "a room needs flatmates_count", unless
    `(info.context or {}).get("status_only")` is set;
    (3) `len(flatmate_ages) > (flatmates_count or 0)` raises "flatmate_ages lists more people than
    flatmates_count".

  `ListingPatch` gains the four fields as `… | None = None`. **None of them joins `NULLABLE_FIELDS`**, so an
  explicit `null` is a 422 from the existing null rule, `flatmates_count` included. A room → apartment switch
  sends only `{"listing_type": "apartment"}` and the server resets the four (`0007e`'s `changedFields` drops the
  four room keys on that switch). `ListingOut` gains `gender_preference: GenderPreference`,
  `flatmates_count: int | None`, `flatmate_ages: list[int]` and `lifestyle: Lifestyle`. `MyListingOut` gets them
  through `ListingOut`. The module docstring's "every bound of the CHECKs is repeated here" now covers the new
  CHECKs too.
- `api/app/services/listings.py`:
  - `create_listing`: no change. `**data.model_dump()` already carries the four fields, and `ListingIn` refuses
    a room without a count.
  - `_merged(listing, patch)`: when `sent` sets `listing_type` to `"apartment"`, first overlay
    `ROOM_FIELD_DEFAULTS` on `current`. Switching to an apartment clears the room fields server-side, and sent
    room fields still win, so they fail rule (1). Then validate with
    `ListingIn.model_validate({**current, **sent}, context={"status_only": not sent})`. A pause or resume
    (`{"status": …}` only, so `sent` is empty) of a legacy room with a NULL count is not an edit and still
    works. Any other PATCH of that room must carry `flatmates_count`.
  - `update_listing`: when `"listing_type"` is in `patch.model_fields_set`, `values` also gets
    `{name: getattr(data, name) for name in ROOM_FIELD_DEFAULTS}`. This writes the reset on room → apartment,
    and the merged values (sent or default) on apartment → room.
  - The module docstring gains one paragraph on the room fields and the switch rule.

  `services/profiles.py` needs no code change: `put_profile` upserts `data.model_dump()`, so the four new
  fields are written on every `PUT`, and omitting them clears the room section. Its docstring's privacy note
  gains the room section. The routers need no change: their existing 422 `responses` entries already say
  "malformed body (list `detail`)".
- Rooms stay hidden: `services/search.py` `_public_listings()` keeps `listing_type == "apartment"`.
  `ListingPublic` (`schemas/search.py`), `ApplicationListingOut` and `ApplicantProfileOut` gain nothing in this
  spec. `0007b` adds the four listing fields to `ListingPublic`, and `0007c` adds the inbox room fields.
- Tests infrastructure:
  - `api/tests/conftest.py` `make_listing` and `make_profile` wrap any `dict` value in
    `psycopg.types.json.Jsonb`, one line each, so `lifestyle={…}` overrides work for this spec's tests and for
    `0007b` / `0007c`. psycopg 3 cannot adapt a plain `dict`, while a `list` such as `flatmate_ages=[27, 30]`
    adapts as is. The `db_engine` TRUNCATE needs no change because there is no new table.
  - `api/tests/test_migrations.py` `_LISTINGS_CHECKS` (`:150`) gains the five `ck_listings_*` names below
    (`test_ac10_listings_roundtrip` compares the set exactly).
  - `api/tests/test_profiles.py` `PROFILE_KEYS` (`:18`) gains `gender`, `birth_year`, `flatmate_gender` and
    `lifestyle`. A module constant `ROOM_OFF = {"gender": None, "birth_year": None, "flatmate_gender": "any",
    "lifestyle": {}}` is added. `test_ac1_seeker_creates_and_reads_profile` and `test_ac2_put_replaces_profile`
    compare the response (minus `updated_at`) with `{**ROOM_OFF, **body}` instead of `body`.
  - Unchanged on purpose:
    - `test_search.py` `PUBLIC_KEYS`, because `ListingPublic` is untouched;
    - `test_inbox.py` `PROFILE_KEYS` (`:555`), because `ApplicantProfileOut` lists its fields;
    - `test_inbox.py` `LISTING_OUT_KEYS` and `test_geocoding.py:182`, because they derive from
      `ListingOut.model_fields`;
    - `test_chat.py` `LISTING_SUMMARY_KEYS`;
    - the existing `make_listing(…, listing_type="room")` rows in `test_search.py:113` and
      `test_applications.py:230`, because a room with the defaults passes every CHECK;
    - every statement-count assertion, because `GET /me/listings` and `PUT /me/profile` keep their statements.
- Web (types only, no behaviour), so that `make lint` stays green after `make client`:
  - `web/src/features/listings/api.ts` `ListingInBody`: the `Omit<ListingIn, …>` key list gains
    `'gender_preference' | 'flatmates_count' | 'flatmate_ages' | 'lifestyle'`. `Required<…>` would otherwise
    make the four new optional keys required, and `toListingIn` (`validate.ts`) sets none of them. On `main`
    today the list is `'rooms' | 'accepted_households' | 'smoking_allowed' | 'min_contract_months'`;
    `0006e`'s branch shortens it to `'rooms'`. Whichever merges second keeps both edits. The doc comment says
    that the room fields stay at their server defaults until `0007e`.
  - `web/src/features/listings/__tests__/fixtures.ts` `listing()` (`MyListingOut`) gains
    `gender_preference: 'any', flatmates_count: null, flatmate_ages: [], lifestyle: {}`.
  - `web/src/features/profile/__tests__/fixtures.ts` `profile()` (`SeekerProfileOut`) gains
    `gender: null, birth_year: null, flatmate_gender: 'any', lifestyle: {}`.
  - `web/src/features/search/__tests__/fixtures.ts` `publicListing()` is unchanged (`ListingPublic` is
    untouched).

  `make client` emits `lifestyle` as `{ [key: string]: 1 | 2 | 3 }`, which was checked against
  openapi-typescript 7.13, so `{}` type-checks. `0007d` types the keys from its own `LIFESTYLE_KEYS` copy.

**Out:**
- Search, map, listing page, `listing_type` filter, fit rule, apply gate for rooms, `room_fit`,
  `listing_type_at_apply`, the `lifestyle` criterion: `0007b`. Owner inbox room fields (API and card): `0007c`. The other
  web screens: `0007d`–`0007f`.
- Group chats with flatmates (Slice 8). A role switch for room listers (PRODUCT.md: they keep the owner role).
- A `DELETE` for the room section: `PUT` without it clears it.
- Server-side trimming of `flatmate_ages` when the count drops: the client sends both, and the API returns 422
  otherwise.
- README: no change. Its `POST /listings` example is an apartment and still works.

**New dependencies:** none (`psycopg.types.json.Jsonb` ships with the pinned `psycopg[binary]`).

## Data
Migration `0009_room_inputs`. `listings` gains:

| Column | Type | Rule |
| --- | --- | --- |
| `gender_preference` | `text` NOT NULL DEFAULT `'any'` | CHECK `ck_listings_gender_preference` `gender_preference IN ('any', 'women', 'men')`. Who the room is for |
| `flatmates_count` | `smallint` NULL | CHECK `ck_listings_flatmates_count` `flatmates_count IS NULL OR flatmates_count BETWEEN 1 AND 7`. People already living there. NULL on apartments, and on legacy rooms until their next edit |
| `flatmate_ages` | `smallint[]` NOT NULL DEFAULT `'{}'` | CHECK `ck_listings_flatmate_ages` `cardinality(flatmate_ages) <= coalesce(flatmates_count, 0) AND 18 <= ALL (flatmate_ages) AND 99 >= ALL (flatmate_ages) AND array_position(flatmate_ages, NULL) IS NULL`. Optional: none, some or all of the flatmates, in the order sent. The last clause rejects a NULL element, which `ALL` would let through |
| `lifestyle` | `jsonb` NOT NULL DEFAULT `'{}'` | CHECK `ck_listings_lifestyle` `jsonb_typeof(lifestyle) = 'object'`. The flat's answers. The API checks keys and values |

Plus CHECK `ck_listings_room_fields`: `listing_type = 'room' OR (gender_preference = 'any' AND flatmates_count
IS NULL AND flatmate_ages = '{}' AND lifestyle = '{}'::jsonb)`.

`seeker_profiles` gains (the "room section"; `gender` NULL = not looking for a room):

| Column | Type | Rule |
| --- | --- | --- |
| `gender` | `text` NULL | CHECK `ck_seeker_profiles_gender` `gender IS NULL OR gender IN ('woman', 'man', 'other')` |
| `birth_year` | `smallint` NULL | CHECK `ck_seeker_profiles_birth_year` `birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100`. This loose range is the last line of defence; the API requires age 18–99 in the current UTC year |
| `flatmate_gender` | `text` NOT NULL DEFAULT `'any'` | CHECK `ck_seeker_profiles_flatmate_gender` `flatmate_gender IN ('any', 'women', 'men')` |
| `lifestyle` | `jsonb` NOT NULL DEFAULT `'{}'` | CHECK `ck_seeker_profiles_lifestyle` `jsonb_typeof(lifestyle) = 'object'` |

Plus CHECK `ck_seeker_profiles_room_section`: `gender IS NOT NULL OR (birth_year IS NULL AND flatmate_gender =
'any' AND lifestyle = '{}'::jsonb)`.

**Backwards compatibility.** Every existing listing (apartment or room) and every profile gets the defaults, which
satisfy every new CHECK. Existing rooms, such as those from `api/scripts/seed_demo.py`, become "legacy rooms":
`'any'` and a NULL `flatmates_count`, filled on their next edit (API). The 3-point scale behind each key
(1 → 3) is fixed by the Slice 7 contract and lives in the web copy (`0007d`). The API stores numbers only.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | /listings | `current_owner` (as `0002a`) | `ListingIn` + the four room fields | 201 `ListingOut` + the four | as before; **new** 422 (list `detail`): a room without `flatmates_count`; an apartment with a non-default room field; ages beyond the count; a bad value |
| PATCH | /listings/{id} | `current_owner`, own listing (as `0002a`) | `ListingPatch` + the four | 200 `ListingOut` + the four | as before; **new** 422: an explicit `null` on any of the four (`flatmates_count` included); the merged row breaks a rule above (type switches below) |
| GET | /me/listings | `current_owner` (as `0004c`) | — | items gain the four | — |
| GET | /me/profile | `current_seeker` (as `0006a`) | — | `SeekerProfileOut` + `gender`, `birth_year`, `flatmate_gender`, `lifestyle` | as before |
| PUT | /me/profile | `current_seeker` (as `0006a`) | `SeekerProfileIn` + the four, optional | as GET | as before; **new** 422 (list `detail`): a bad value; room-section fields without `gender` |
| GET | /listings (incl. the `0003c` map box), /listings/{id} | public (as `0003a`/`0003c`) | — | **unchanged**: rooms still excluded or 404 | — |

**Listing rules.** All of them are checked on the merged row of a `PATCH`.
- A `room` needs `flatmates_count` (1–7), except on a pause or resume. `flatmate_ages` holds 0 to
  `flatmates_count` ages, each 18–99. `gender_preference` defaults to `"any"` and `lifestyle` to `{}`.
- An `apartment` has exactly the defaults. Sending `"gender_preference": "any"` to an apartment is fine;
  sending any other room value is a 422.
- `lifestyle` in a `PATCH` replaces the whole object (`{}` clears every answer); keys are never merged.
- Type switch room → apartment: the body is exactly `{"listing_type": "apartment"}` (what `0007e` sends). The
  server resets the four fields to the defaults and writes them. If the same PATCH also sends a non-default room
  field, the whole PATCH is a 422. An explicit `null` for any of the four (including `"flatmates_count": null`)
  stays a 422 from `ListingPatch`'s null rule, on a switch or not.
- Type switch apartment → room: the PATCH must send `flatmates_count`. An apartment's count is always NULL, so
  "already stored" never applies. The other three fields take the sent values or the defaults.
- Error locations: field-level errors (a bad count, age, key or value) are at `["body", <field>, …]`. Rules
  (1)–(3) are model-level, so they are at `["body"]`, like `total_floors must be at least floor` (`_merged` keeps
  that loc, `services/listings.py:131`).

**Profile rules.** `PUT` keeps "PUT replaces":
- All four room fields are optional. Omitting them clears the room section; there is no merge with the stored
  row.
- `gender` alone is a valid room section.
- `birth_year` must give an age of 18–99 in the current UTC year.

`SeekerProfileOut` always carries the four fields, as `null` / `null` / `"any"` / `{}` when the profile has no
room section.

## UI
None. The screens are `0007d` (profile) and `0007e` (wizard). `make client` regenerates
`web/src/api/schema.d.ts`, and the type-only web edits in Scope keep `tsc` green. The current wizard compiles
and still creates and edits apartments. Room create/edit from the web is a known gap until `0007e` (Risks).

## Acceptance criteria
Fixtures are as in `0006a` (`gush_dan`, `make_owner`, `make_listing`, `make_seeker`, `make_profile`,
`make_application`, `signup`, `redis_clean`, `outbox`). Shorthands used below:
- "Owner" = `signup(client, outbox, "owner@example.com", "owner")`.
- `R` = the room body `_room(gush_dan)` = `_body(gush_dan, listing_type="room", rooms=4, flatmates_count=2,
  flatmate_ages=[27, 30], gender_preference="women", lifestyle={"cleanliness": 3, "night": 1})`.
- `P` = `test_profiles.py`'s `_p(gush_dan)`.
- `S` = `{"gender": "woman", "birth_year": Y - 30, "flatmate_gender": "women", "lifestyle": {"cleanliness": 3,
  "guests": 1, "night": 2, "social": 3, "kosher": 2, "shabbat": 1, "work_from_home": 3}}`.
- `Y` = `dt.datetime.now(dt.UTC).year`.

"Row unchanged" means `_row(db_engine, id)` equals its value before the call.

- [ ] AC1 Given an owner, When `POST /listings` with `R`, Then 201 with `gender_preference` `"women"`, `flatmates_count` 2, `flatmate_ages` `[27, 30]`, `lifestyle` exactly `{"cleanliness": 3, "night": 1}`; the same four values appear on that item in `GET /me/listings` and in the `listings` row. When `POST` the `0002a` AC1 apartment body (no room fields), Then 201 with `"any"`, `null`, `[]`, `{}`. When `POST` `R` with `flatmates_count` 3 and `flatmate_ages` `[41]`, Then 201 with `[41]` (some ages only). (Three creates = the default cap of 3; pause one before adding a fourth.) When an anonymous client asks for `R`'s listing, Then `GET /listings/{id}` is 404 `not_found` and no `GET /listings` item has its id (rooms stay hidden) — `api/tests/test_listings.py::test_ac1_room_fields_on_create_and_reads`
- [ ] AC2 Given an owner, When `POST` `R` with one change each, Then 422 with a list `detail` and no `listings` row, in every case. The changes:
  - `flatmates_count`: removed; 0; 8; `null`;
  - `flatmate_ages`: `[17]`; `[100]`; `[27, 30, 31]` (three ages for two flatmates); `[27, null]`;
  - `gender_preference`: `"female"`; `null`;
  - `lifestyle`: `{"pets": 2}`; `{"night": 0}`; `{"night": 4}`; `{"night": "2"}`; `{"night": 2.5}`; `{"night": null}`; `[]`; `"often"`; `null`;
  - and the apartment body `_body(gush_dan)` plus one of `gender_preference: "women"`, `flatmates_count: 2`, `flatmate_ages: [30]`, `lifestyle: {"night": 2}`.

  — `test_listings.py::test_ac2_room_fields_validation` (parametrized)
- [ ] AC3 Given room `R` created through the API, When the owner `PATCH`es in turn:
  - `{"gender_preference": "any"}`, Then 200 with `"any"` and every other field unchanged except `updated_at`;
  - `{"flatmates_count": 1}` (two ages stored), Then 422 and the row unchanged;
  - `{"flatmates_count": 3, "flatmate_ages": [27, 30, 35]}`, Then 200 with both;
  - `{"flatmate_ages": [27, 30, 35, 40]}`, Then 422;
  - `{"lifestyle": {"guests": 2}}`, Then 200 with `lifestyle` exactly `{"guests": 2}` (replaced, not merged);
  - `{"lifestyle": {}}` and `{"flatmate_ages": []}`, Then 200 with `{}` and `[]`;
  - `null` for each of the four fields, `{"lifestyle": {"pets": 1}}` or `{"gender_preference": "female"}`, Then 422 each with a list `detail` and the row unchanged.

  — `test_listings.py::test_ac3_room_fields_patch`
- [ ] AC4 Given an apartment `A` created through the API, When the owner `PATCH`es in turn:
  - `{"listing_type": "room"}`, Then 422 and the row unchanged;
  - `{"listing_type": "room", "flatmates_count": 2, "flatmate_ages": [30], "gender_preference": "men", "lifestyle": {"kosher": 3}}`, Then 200: a room with those values;
  - `{"listing_type": "apartment", "gender_preference": "women"}` or `{"listing_type": "apartment", "flatmates_count": null}`, Then 422 each and the row unchanged (an explicit `null` stays a 422);
  - exactly `{"listing_type": "apartment"}` (the body `0007e` sends on this switch), Then 200 with `"any"`, `null`, `[]`, `{}` in the response **and** in the row;
  - on that apartment, `{"gender_preference": "women"}`, `{"flatmates_count": 2}`, `{"flatmate_ages": [30]}` or `{"lifestyle": {"night": 2}}`, Then 422 each and the row unchanged;
  - `{"gender_preference": "any"}`, Then 200.

  — `test_listings.py::test_ac4_type_switch_room_fields`
- [ ] AC5 Given two legacy rooms `L1`, `L2` inserted with `make_listing(db_engine, <owner id>, gush_dan, listing_type="room")` (NULL count, as migrated rows), When the owner calls `GET /me/listings`, Then both show `"any"`, `null`, `[]`, `{}`. When the owner `PATCH`es `L1`:
  - `{"price_ils": 3000}`, Then 422 and the row unchanged;
  - `{"status": "paused"}` and then `{"status": "active"}`, Then 200 each (a pause or resume is not an edit);
  - `{"price_ils": 3000, "flatmates_count": 2}`, Then 200 with both.

  When the owner `PATCH`es `L2` with `{"listing_type": "apartment"}`, Then 200 (an apartment needs no count). — `test_listings.py::test_ac5_legacy_room_fills_count_on_next_edit`
- [ ] AC6 Given a seeker, the following steps all go through `PUT /me/profile`:
  - With `{**P, **S}`, Then 200 whose key set is exactly `PROFILE_KEYS` (now 14 keys) with `S`'s values, and `GET /me/profile` returns the same body.
  - With `{**P, "gender": "other", "lifestyle": {"night": 3}}`, Then 200 with `birth_year` `null`, `flatmate_gender` `"any"` and `lifestyle` exactly `{"night": 3}` (gender alone is a room section).
  - With `{**P, "gender": "man", "birth_year": Y - 18}` and with `Y - 99`, Then 200 each (age bounds inclusive).
  - With `P` alone, Then 200 with `gender` `null`, `birth_year` `null`, `"any"`, `{}`, the `seeker_profiles` row holds the same values, and there is still one row (PUT replaces; omitting the section clears it).

  — `api/tests/test_profiles.py::test_ac6_room_section_saved_read_and_cleared`
- [ ] AC7 Given a seeker with no profile, When `PUT /me/profile` with `P` plus one change each, Then 422 with a list `detail` and no `seeker_profiles` row, in every case. The changes:
  - `gender`: `"female"`; `""`;
  - `birth_year` (with `gender: "woman"`): `Y - 17`; `Y - 100`; `1990.5`;
  - `flatmate_gender` (with `gender: "woman"`): `"mixed"`; `null`;
  - `lifestyle` (with `gender: "woman"`): `{"pets": 2}`; `{"night": 0}`; `{"night": 4}`; `{"night": "2"}`; `[]`; `null`;
  - no gender: `{"birth_year": Y - 30}`; `{"flatmate_gender": "women"}`; `{"lifestyle": {"night": 2}}`; `{"gender": null, "birth_year": Y - 30}`.

  For the `Y - 17`, `Y - 100` and `"female"` cases, the response text does not contain the sent value: the existing handler drops `input`, and `_adult_birth_year`'s message names the bounds, never the value. — `test_profiles.py::test_ac7_room_section_validation` (parametrized, the `_CASES` style)
- [ ] AC8 Given seeker `S1` whose profile has a room section (`make_profile(…, gender="woman", birth_year=Y - 30, flatmate_gender="women", lifestyle={"night": 3})`) and who applied (`make_application`) to the owner's room `make_listing(…, listing_type="room", flatmates_count=2)`, When the owner lists that listing's applicants and `PATCH`es `S1` to `shortlisted`, Then for each response, on `item_wo_room = {k: v for k, v in item.items() if k != "room"}` (a comment line says: "`room` is `0007c`'s and is excluded on purpose"; in `0007a` no `room` key exists, so this is the full item):
  - `S1`'s `profile` key set is exactly the `0006c` `PROFILE_KEYS`;
  - `_keys_and_numbers(item_wo_room)` finds no key `gender`, `birth_year`, `flatmate_gender` or `lifestyle`;
  - `"woman"` is not in `json.dumps(item_wo_room)`;

  and over the whole response, no key `birth_year` or `flatmate_gender` appears and `Y - 30` is not among the numbers. Owners never see the room section through `profile` or any other existing key; `0007c` (`specs/0007c-room-inbox.md`) adds its own `room` assertions without editing these. — `api/tests/test_inbox.py::test_ac8_room_section_never_outside_room_field`
- [ ] AC9 Given a database at revision `"0008"` with an apartment, a room and a seeker profile inserted by SQL, When upgraded to `"0009"`, Then both listings hold `('any', NULL, '{}', '{}')` and the profile holds `(NULL, NULL, 'any', '{}')`. At `"0009"`:
  - the `seeker_profiles` CHECK set equals exactly the five `0007` names plus the five new ones (an exact set, as `test_migrations.py:682-688` and `:238`);
  - each UPDATE below violates exactly one CHECK and fails with that name:
    - the room: `gender_preference = 'mixed'` (`ck_listings_gender_preference`); `flatmates_count = 8` (`ck_listings_flatmates_count`); `flatmates_count = 2, flatmate_ages = '{17}'`, `'{27,30,31}'` or `'{27,NULL}'` (`ck_listings_flatmate_ages`); `lifestyle = '[]'` (`ck_listings_lifestyle`);
    - the apartment: `gender_preference = 'women'`, `flatmates_count = 2` or `lifestyle = '{"night": 2}'` (`ck_listings_room_fields`);
    - the profile: `gender = 'woman', birth_year = 1800` (`ck_seeker_profiles_birth_year`); `gender = 'female'` (`ck_seeker_profiles_gender`); `gender = 'woman', flatmate_gender = 'mixed'` (`ck_seeker_profiles_flatmate_gender`); `gender = 'woman', lifestyle = '[]'` (`ck_seeker_profiles_lifestyle`); `birth_year = 1990` with `gender` NULL (`ck_seeker_profiles_room_section`);
  - `UPDATE … SET flatmates_count = 2, flatmate_ages = '{27}'` on the room succeeds.

  When downgraded to `"0008"`, Then the eight columns are gone and all three rows survive; upgrading to head works again. — `api/tests/test_migrations.py::test_ac9_room_inputs_upgrade_downgrade`
- [ ] NF1 `make lint` is clean: ruff, `mypy --strict`, and web eslint / prettier / `tsc` after `make client`. `make client` regenerates `schema.d.ts` with the four fields on `ListingIn` / `ListingPatch` (optional) / `ListingOut` / `MyListingOut` and on `SeekerProfileIn` (optional) / `SeekerProfileOut`. `make test` is green (api and web), including every existing listings / search / applications / inbox / profiles / migrations test with the edits named in Scope. `GET /me/listings` stays two statements (`test_ac6_me_listings_is_own_newest_first`). `make e2e` is green on the final local head (the existing suite, no new test; CLAUDE.md Speed rule 7 while `E2E_IN_CI=off`: this spec edits `web/src` types and fixtures, and the suite drives `POST` / `PATCH /listings` and `PUT /me/profile`), reported in the digest. — CI `api` and `web`, local `make e2e`
- [ ] NF2 Privacy. `gender`, `birth_year`, `flatmate_gender` and the seeker's `lifestyle` are personal data. In this spec they are returned only by `GET` / `PUT /me/profile` to their own seeker. `has_profile` still reads existence only, and the matching queries (`0006b`/`0006c`) do not read them until `0007b`. `SeekerProfileOut` and `ApplicantProfileOut` list their fields explicitly, and a 422 never echoes the sent value. Logs: no new log line reads them; SQL parameters are hidden (`make_engine(hide_parameters=True)`, `app/db.py:38`); the 422 handler drops `input` (`app/main.py:62`); `_adult_birth_year`'s message names the bounds, never the value. — AC6 key set, AC7, AC8, existing `test_profiles.py::test_ac10_profile_is_private_to_its_seeker`, security reviewer

## Tests to write
Unit/integration (pytest, Postgres via compose):
- `api/tests/test_listings.py`: AC1–AC5, plus a `_room(area_id, **overrides)` helper beside `_body` (`R`'s values).
- `api/tests/test_profiles.py`: AC6, AC7.
- `api/tests/test_inbox.py`: AC8.
- `api/tests/test_migrations.py`: AC9.

The existing-test edits are listed in Scope: `_LISTINGS_CHECKS`, `test_profiles.py` `PROFILE_KEYS` / `ROOM_OFF` in
AC1 and AC2, and the `Jsonb` wrap in `make_listing` / `make_profile`. `Y` and every date come from
`dt.datetime.now(dt.UTC)`, never `dt.date.today()`, because pytest runs on the Mac in Israel time (as `0006a`
finding 9).

Web: no new tests. The edited fixtures keep `vitest` and `tsc` green.

E2E: none new; the existing suite runs locally (`make e2e`, Speed rule 7). No e2e test creates a room (`web/e2e/*.spec.ts` post apartments only), and `putProfile` in
`web/e2e/helpers.ts` sends `P`, which stays valid.

## Risks / open questions
- **Web gap until `0007e`.** From this merge until `0007e` merges, the running web cannot create a room, switch
  a listing to a room, or edit any field of a legacy room. The wizard sends no `flatmates_count`, so the API
  returns a 422 list, which the wizard shows as its generic error. Pausing and resuming a legacy room still
  works. Nothing is deployed and there are no users, so this is accepted (as `0006a`'s apply gap was). `0007e`
  must merge before any deploy. No e2e test creates a room.
- **PUT replaces.** Until `0007d`, the profile page sends none of the room fields, so every save clears the room
  section. No screen can set one before `0007d`, so nothing is lost. `0007d`'s save must always send the room
  section that its form holds, or an edit of the housing part wipes it.
- **Legacy rooms.** A legacy room's NULL count is enforced on its next content edit only, not on pause or
  resume (`status_only` context). Leaving it NULL until then is harmless: rooms are hidden until `0007b`, and
  `0007b`/`0007f` treat a NULL count as unknown.
- **Shared type location.** `Lifestyle`, `LIFESTYLE_KEYS`, `GenderPreference`, `SeekerGender`, `AGE_MIN` and
  `AGE_MAX` live in `api/app/schemas/profile.py`, beside `AcceptedHouseholds` (the contract says only "in
  `api/app/schemas/`"). `0007b` (`matching/`), `0007c` and `0007d` import or mirror them from there.
- **Fewer ages after a count change.** Lowering `flatmates_count` below the number of stored ages is a 422, not a
  silent trim. `0007e` sends both fields when the count drops.
- **Merge order.** Merge clashes are resolved by whichever spec merges second, which keeps both edits:
  - `0006e` (in progress) also edits `ListingInBody` and the `listing()` fixture;
  - `0006f` (merged) and the `0006g` worktree use `profile()` with `Partial<SeekerProfileOut>` overrides and need nothing new;
  - `0007b` adds migration `0010` on top of `0009`.
- **Coder on Opus/high** (Speed rule 6): a migration on `listings` and `seeker_profiles`, new personal data
  (gender, birth year), and PATCH merge semantics.
- **Product questions:** none. PRODUCT.md "Rooms" (2026-11-11) and the Slice 7 contract fix the fields, values,
  defaults, legacy handling and the switch rule.

## Verifier findings — one round, 8 findings, all applied
Applied into the body above. Finding 1 was resolved per the orchestrator's ruling, not the verifier's fix:
`flatmates_count` stays out of `NULLABLE_FIELDS`. `0007e`'s `changedFields` now sends exactly
`{"listing_type": "apartment"}` on a room → apartment switch, and the server resets the four room fields. AC4
tests that body, plus `"flatmates_count": null` → 422. The API section says that an explicit `null` stays a
422. Finding 6 is applied as NF1 `make e2e` on the final local head (Speed rule 7, commit d917d05). Findings
2–5, 7 and 8 are applied as written, and AC8 is renamed `test_ac8_room_section_never_outside_room_field`. The
list below is kept as the record (1 blocker, 0 major, 7 minor).
Verdict: **would reject as written**, on finding 1 only (a consumer spec's PATCH body is refused). Checklist: lines
1, 2, 4–10 pass; line 3 passes (old code ignores the new columns, and an old-code `PUT /me/profile` leaves the room
section alone because its `ON CONFLICT … SET` lists only the old columns). No contradiction with PRODUCT.md "Rooms",
"Gender preference", "Matching", "Listings" or "Listing edit". `reviewers: [code, qa, security]` is right: no search,
matching or screen change, so no perf or ux. No silent deviation from the Slice 7 contract. Each deviation (count
"sent", not "sent or already stored"; the NULL-element clause; the status-only exception; types in `profile.py`;
`ListingOut` here, `ListingPublic` in `0007b`) is stated with a reason.

Checked against the code and found correct (no change needed):
- Every cited path and line: `schemas/listing.py:114`, `test_migrations.py:150`, `test_profiles.py:18`,
  `test_inbox.py:555`, `test_inbox.py:45`, `test_geocoding.py:182`, `test_chat.py:49`, `test_search.py:113`,
  `test_applications.py:230`, `services/search.py:45`. The cited helpers `_body`, `_row`, `_create`, `_patch`, `_p`,
  `_keys_and_numbers` and `_CASES` exist. The new test names collide with no existing test.
- Pydantic 2.14.3 lax mode, run against the proposed types. `{"night": true}` becomes `1` and `2.0` becomes `2`. Both
  are **stored as JSON integers**, so jsonb never holds `true`. `false`, `"2"` and `2.5` give `literal_error`. For
  ages, `"30"` and `30.0` become 30, and `true` becomes 1, which then fails `ge=18`. `[27, null]` gives `int_type`.
  `flatmates_count: true` becomes 1, the same as other int fields in the repo. `birth_year: 1990.5` gives
  `int_from_float`. Every AC2 and AC7 case gives the 422 that the spec expects.
- The NULL-element clause, evaluated in the running Postgres 16: `'{27,NULL}'` gives f, `'{NULL}'` f, `'{}'` t and
  `'{27,30}'` t. A 2-D array makes `array_position` raise an error instead of failing the CHECK. The row is still
  refused, and the API cannot send one.
- openapi-typescript 7.13 output from the proposed models: `lifestyle?: { [key: string]: 1 | 2 | 3 }` and
  `flatmate_gender?` on input, and `birth_year?: number | null` (a `None` default stays optional). The output types
  require all four keys. So the spec's web edits (`ListingInBody` Omit, the two fixtures) are the complete `tsc`
  fallout. Every other `MyListingOut` / `SeekerProfileOut` literal in `web/src` spreads one of those fixtures or a
  typed value (`useCreateListing.ts:15`, `ListingWizard.test.tsx:168`, `ApplicantsPage.test.tsx:286`).
- `conftest.py` needs no TRUNCATE change. `make_listing` / `make_profile` use `text()` inserts, so the `Jsonb` wrap
  is needed for dicts only. `test_migrations.py:682` checks the seeker CHECK set at revision `"0007"`, not at head,
  so `0009` does not break it.
- NF2: `ApplicantProfileOut` (`schemas/application.py:88`) and `_PROFILE_COLUMNS` (`services/applications.py:221`)
  list their columns by name. `match_columns` reads named columns only. `has_profile` reads existence only.
  0007d's toggle (room off omits the four keys, room on sends `gender`, `flatmate_gender`, `lifestyle` and
  `birth_year` only when filled) matches this API.

1. (blocker) 0007e's room → apartment PATCH is refused. `0007e` AC8 (`specs/0007e-room-listing-web.md:150`) and its
   `toListingIn` (`:43-47`) send `{"listing_type": "apartment", "gender_preference": "any", "flatmates_count": null,
   "flatmate_ages": [], "lifestyle": {}}`, because `changedFields` sends every key that differs from the stored room.
   This spec keeps `flatmates_count` out of `NULLABLE_FIELDS` (Scope, `ListingPatch` bullet). So
   `ListingPatch._at_least_one_key_and_null_only_where_nullable` (`schemas/listing.py:169-178`) returns 422 before
   `_merged` runs, and the web can never switch a room to an apartment. `null` is a real value of this column (every
   apartment and every legacy room holds it), as it was for `min_contract_months` (`0006a` finding 1). **Fix:**
   - Scope, `ListingPatch` bullet: "`flatmates_count` joins `NULLABLE_FIELDS`. The merged row decides: a room with
     a NULL count fails rule (2), an apartment's NULL is its default. An explicit `null` on the other three is a
     422 from the null rule."
   - API table, PATCH errors: "an explicit `null` on `gender_preference`, `flatmate_ages` or `lifestyle`".
   - AC3: keep "`null` for each of the four → 422" (on a room, `flatmates_count: null` now fails rule (2)).
   - AC4: add, on a room, the exact 0007e AC8 body above → 200, with `"any"`, `null`, `[]`, `{}` in the response and
     in the row. Also add `{"flatmates_count": null}` on the resulting apartment → 200.
   - AC5: add `{"flatmates_count": null, "price_ils": 3000}` on `L1` → 422.
2. (minor) Cross-field errors carry `loc: ["body"]`, not `["body", "<field>"]`. `_room_fields` is a model validator,
   so rules (2) and (3) ("a room needs flatmates_count", "flatmate_ages lists more people than flatmates_count") come
   back like `total_floors must be at least floor`, at the body level. `_merged` keeps that loc too
   (`services/listings.py:131`). `0007e` (`:88`, AC5) steers back to step 3 only for `loc: ["body", name]`. Its
   client checks make this harmless, but the contract should be written down. **Fix:** add one line to the API
   section's "Listing rules": "Field-level errors (a bad count, age, key or value) are at `["body", <field>, …]`.
   Rules (1)–(3) are at `["body"]`."
3. (minor) Key order of `lifestyle`. jsonb stores keys shortest first, then bytewise. Checked live:
   `{"guests":1,"night":2,"cleanliness":3,"work_from_home":1,"social":2}` comes back as
   `{"night","guests","social","cleanliness","work_from_home"}`. So POST, PATCH and GET return neither the sent
   order nor `LIFESTYLE_KEYS` order. Every AC compares dicts, so nothing fails. **Fix:** in the Scope's `Lifestyle`
   bullet, add "Key order in a response is not significant (jsonb reorders). Clients iterate `LIFESTYLE_KEYS`." Do
   not add a sorting validator. `0007d` / `0007e` already iterate the keys and compare by entries.
4. (minor) AC9 checks the new seeker CHECKs with "exist". The existing migration tests compare exact sets
   (`test_migrations.py:682-688`, `:238`). **Fix:** at `"0009"`, assert the `seeker_profiles` CHECK set equals the
   five `0007` names plus the five new ones.
5. (minor) NF2 does not cover logs, although gender and birth year are new personal data. **Fix:** add to NF2: "No
   new log line reads them. SQL parameters are hidden (`make_engine(hide_parameters=True)`, `app/db.py:38`). The 422
   handler drops `input` (`app/main.py:62`). `_adult_birth_year`'s message names the bounds, never the value." No
   new test is needed: AC7 already covers the response.
6. (minor) e2e process. `CLAUDE.md` Speed rule 7 (2026-11-11): CI e2e is off (`E2E_IN_CI=off`), and every spec
   that touches the web runs `make e2e` on its final local head and reports the result in the digest. This spec
   edits `web/src` types and fixtures. The existing e2e suite drives `POST` / `PATCH /listings` and
   `PUT /me/profile`, all of which this spec changes. NF1 names CI `api` and `web` only. **Fix:** add to NF1:
   "`make e2e` green on the final local head (the existing suite, no new test), reported in the digest". In "Tests
   to write", change "E2E: none new" to "E2E: none new; the existing suite runs locally (rule 7)".
7. (minor) AC1 creates three live listings (`R`, the apartment, `R` with count 3), which is exactly
   `users.listing_cap` = 3. It passes, but any further create in that test is a 409 `listing_cap_reached`. **Fix:**
   add a note in AC1: "(three creates = the default cap; pause one before adding a fourth)".
8. (minor) AC8 is written so that `0007c` has to break it. `specs/0007c-room-inbox.md:372-380` (amendment (c)) says
   `test_ac8_room_section_never_in_inbox` "stops holding" once a room application carries `room`. It then renames
   the test and rewrites it. The 0007a-era privacy claim is that owners never see the room section **through
   `profile` or any other existing key**. The test can say exactly that, so it stays true without edits. **Fix:**
   - Rename AC8's test to `test_inbox.py::test_ac8_room_section_never_outside_room_field`.
   - Assert, for each response, on `item_wo_room = {k: v for k, v in item.items() if k != "room"}`: the `profile` key
     set is exactly the `0006c` `PROFILE_KEYS`; `_keys_and_numbers(item_wo_room)` finds no key `gender`,
     `birth_year`, `flatmate_gender` or `lifestyle`; `"woman"` is not in `json.dumps(item_wo_room)`.
   - Over the whole response, assert that no key `birth_year` or `flatmate_gender` appears and that `Y - 30` is not
     among the numbers.
   - Add one comment line: "`room` is `0007c`'s and is excluded on purpose." In `0007a` no `room` key exists, so
     this is the same check as today.
   - Then `0007c` amendment (c) shrinks to adding its own `room` assertions (or the orchestrator drops (c)).

## Digest (filled by orchestrator after verification)

    Spec 0007a - Room inputs API   (verified, Slice 7 part 1 of 6, no Slice 7 deps)
    What a user can do after this: the API stores a room listing's gender preference, flatmates count, optional
             ages and the flat's questionnaire, and a seeker's profile "room section" (gender, birth year,
             flatmates preference, questionnaire); rooms stay hidden from search until 0007b.
    Decisions I need from you: none new.
    KPIs this slice moves: none on its own (inputs for 0007b's visibility and matching).
    Acceptance targets: NF1 lint/test clean after make client + make e2e green locally - NF2 gender, birth year
             and answers only in the seeker's own GET/PUT /me/profile, never logged.
    Risks: migration 0009 on live rows - mitigation: every existing listing/profile gets the defaults; existing
             rooms become "לא משנה" with no flatmates count (filled on their next edit). Until 0007d/0007e merge,
             the web cannot set the new fields (accepted, nothing deployed).
    Reviewers: code, qa, security   Estimated: 1 coder run (Opus/high: data + migration), 1 review round
    Links: specs/0007a-room-inputs-api.md - PRODUCT.md "Rooms", "Gender preference" - no artboard

    Spec 0007a - Room inputs API   PR OPEN #28 (not merged), code head 083d5e3
    Shipped: a room listing stores who it is for (any / women / men), its flatmates count (1-7), optional ages
             (18-99) and the flat's 7-question lifestyle answers (1-3). A seeker's profile stores a "room section"
             (gender, birth year, flatmates preference, own answers), returned only to that seeker. Rooms stay
             hidden from search, the listing page and applying until 0007b. API only.
    Demo: make dev-api -> an owner POSTs /listings with listing_type "room", flatmates_count 2 and a lifestyle
          object, then GET /me/listings -> a seeker PUTs /me/profile with gender, birth_year and lifestyle, then
          GET /me/profile. No screen until 0007d / 0007e.
    Tests: +49 integration (AC1-AC9 + NF2; AC2 and AC7 parametrized), +0 web, +0 e2e (api 384, web 214)
    CI: api + web on the push (api green in 81 s on 083d5e3); e2e local while CI e2e is off: 10 of 10, 24.4 s
    Findings: 0 blockers; 1 major fixed (security: an unbounded lifestyle dict let a 249 KB body return a 5.6 MB
              422; it is now one error that names no key); 2 minors fixed (that key echo, the loc ["body"] test);
              4 minors to FOLLOWUPS (tighten the lifestyle CHECKs before 0007b reads them, 2 PATCH null-rule
              notes, a 422 / body-size cap before deploy); 9 nits dropped
    Decisions I need from you: none.
    Changed in PRODUCT.md: nothing
    Next: 0007b (room search API) and 0007d (room profile web) branch from #28. 0007b should take the
          FOLLOWUPS lifestyle-CHECK line into migration 0010.
