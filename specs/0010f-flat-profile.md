---
id: 0010f
title: A room listing says more about the flat (room size, private bathroom, balcony, bills, who is posting), and flatmates who choose to, plus a lister who lives there, appear on the room's page as people, to seekers only
status: verified
depends_on: [0010c, 0010d]   # 0010c: the personal part of the profile (gender, birth year, about me, answers) without a looking part, migration chain 0015 -> 0016; 0010d: `users.photo_key` and the photo URL builder
reviewers: [code, qa, security, ux]   # security: flatmates' personal data on a public page, behind the decision-13 seeker rule and each flatmate's own choice; qa: wizard, room page, join, my flats; ux: three screens change
estimate: 1 coder run   # coder Opus/high (migration + personal data on a public response; Speed rule 6)
---

## Goal
After this ships:
- a room's lister may add five optional facts: the room's own size, a private bathroom, a balcony, whether
  bills are included, and who is posting (I live in the flat / I am leaving the room / the landlord);
- a person joining a flat chooses whether to be shown on the room's page ("להציג אותי בעמוד החדר", default
  off) and can change it later from "הדירות שלי";
- on the room's page, a **seeker** (decision 13) sees "גרים בדירה": each shown flatmate, and the lister when
  they said they live there, as a person (name, photo, age, gender, about me, their own questionnaire answers).
  Anyone else sees the room as today.

This serves PRODUCT.md "שוק השותפים" (decision 17: shown only by their own choice at join, default off; Q17,
Q21, Q22, Q23) and `specs/MARKET-PLAN.md` section 3 step 4 and section 7 "Flat profile (0010f)".

## Scope
**In (API):**
- Migration `api/alembic/versions/0016_flat_profile.py` (revision `"0016"`, down `"0015"`), see Data.
- `api/app/models/listing.py`: five nullable columns (Data) and their CHECKs; `ck_listings_room_fields`
  rewritten as in Data (same name). `api/app/models/flatmate.py::ListingFlatmate.shown`.
- `api/app/schemas/listing.py` (the "apartment holds the defaults" rule lives here and in the CHECK; 0010a
  removed the type-switch write in `services/listings.py`):
  - `Poster = Literal["lives_here", "leaving", "landlord"]`; `RoomSizeSqm = Annotated[int, Field(ge=4, le=100)]`.
  - `ROOM_FIELD_DEFAULTS` gains `room_size_sqm`, `private_bathroom`, `balcony`, `bills_included`, `poster`,
    all `None`.
  - `ListingIn` gains the five, each `X | None = None`. `_room_fields` already loops over
    `ROOM_FIELD_DEFAULTS`, so an apartment sending any of them is a 422; its message lists the room-only fields
    from `ROOM_FIELD_DEFAULTS`' keys instead of the hard-coded four. New rule in the same validator:
    `room_size_sqm` is at most `size_sqm` ("room_size_sqm must not exceed size_sqm").
  - `ListingPatch` gains the five as `X | None = None`, and all five join `NULLABLE_FIELDS` (an explicit
    `null` clears an optional fact). `_merged` picks them up through `ListingIn.model_fields`.
  - `ListingOut` (and so `MyListingOut`) lists the five explicitly.
- `api/app/schemas/search.py`:
  - `ListingPublic` lists the five explicitly, **public** to every caller (they describe the flat, not a
    person; not in `SEEKER_ONLY_FIELDS`). `poster` is public too: it says who posts, never their name.
  - `FlatPersonOut {display_name: str, photo_url: str | None, age: int | None, gender: SeekerGender | None, about_me:
    str | None, lifestyle: Lifestyle, lister: bool}`. No id of any kind (no user, membership or card id).
    `age` is the current UTC year minus `birth_year`, as `routers/applications.py::_applicant_out` does.
    `photo_url` is 0010d's `person_photo_url(key)` (the small size, the one `PersonOut.photo_url` uses).
  - `ListingDetail` gains `people: list[FlatPersonOut]`: the lister first (when `lister` is true), then shown
    flatmates by `joined_at`. Always `[]` for an apartment and for a caller who is not a seeker.
- `api/app/services/flatmates.py`:
  - `shown_people(db, listing, viewer_id) -> Sequence[Row]`: **one statement**, a `UNION ALL` of
    - the lister's branch (only when `listing.poster == 'lives_here'`; skipped in Python otherwise): `users U
      LEFT JOIN seeker_profiles P ON P.user_id = U.id WHERE U.id = :owner_id`, with `true AS lister`,
      `NULL::timestamptz AS joined_at`;
    - the flatmates' branch: `listing_flatmates F JOIN users U ON U.id = F.user_id LEFT JOIN seeker_profiles P
      ON P.user_id = U.id WHERE F.listing_id = :id AND F.shown`, with `false AS lister`, `F.joined_at`;

    each selecting by name `U.display_name`, `U.photo_key`, `P.gender`, `P.birth_year`, `P.about_me`,
    `P.lifestyle`, and ordered `lister DESC, joined_at`. Both branches add **decision 7's gender rule** (a
    person is hidden from a viewer whose gender contradicts that person's flatmates preference): `coalesce(
    P.flatmate_gender, 'any') = 'any' OR P.flatmate_gender = (SELECT CASE V.gender WHEN 'woman' THEN 'women'
    WHEN 'man' THEN 'men' END FROM seeker_profiles V WHERE V.user_id = :viewer_id)`, so a viewer with no
    gender sees only people whose preference is `'any'` (the rule 0010h applies to people browse). Never
    `budget_max_ils`, `area_ids` or any other looking field, never the user id into Python. A person with no
    profile row or no personal part gets `gender`, `age`, `about_me` null and `lifestyle` `{}`.
  - `join(db, r, me, token, shown: bool)`: the INSERT writes `shown`. The idempotent re-join of a member
    leaves `shown` (and `joined_at`) as stored.
  - `set_shown(db, me, listing_id, shown) -> bool`: `UPDATE listing_flatmates SET shown = :shown WHERE
    listing_id = :id AND user_id = :me RETURNING id`; `False` when no row (not a member → 404). Commits.
  - `my_flats` also selects `F.shown`.
- `api/app/schemas/flatmates.py`: `JoinIn(InviteTokenIn)` with `shown: bool = False` (the join body; the
  preview keeps `InviteTokenIn`); `MyFlatOut` gains `shown: bool`; `ShownIn {shown: bool}` (`extra="forbid"`). The PATCH answers 204; the web
  refetches "my flats".
- `api/app/routers/flatmates.py`: `join` takes `JoinIn`; new `PATCH /me/flats/{listing_id}`.
- `api/app/routers/search.py::get_listing`: compute `seeker = _is_seeker(user)` **once** and reuse it for the
  like state, `from_listing` and people (today it is called three times, `:113`, `:122`, and through
  `_profile_user_id`; after 0010b it may query). `people = flatmates_service.shown_people(db, listing, user.id)
  if seeker and listing.listing_type == "room" and room_fit is not False else []` (a room hidden from this
  seeker by the fit rule shows no people either), mapped to `FlatPersonOut`, passed to
  `ListingDetail.from_listing` with the other caller-dependent fields. `_is_seeker` is decision 13's rule as
  0010b wrote it (seeker role, or the looking part filled, `has_profile` from 0010c). The search list and the
  map do **not** carry `people` (cards stay light; the page is where people show).
- Tests: `api/tests/test_flat_profile.py` (new), amendments to `test_migrations.py` (`_LISTINGS_CHECKS` gains
  `ck_listings_room_size_sqm`, `ck_listings_poster`; the equality at head, `:244`, stays an equality),
  `test_search.py:19` `PUBLIC_KEYS` (gains the five), the detail key sets at `test_search.py:180` and
  `test_applications.py:507` (gain the five and `people`), `test_flatmates.py:789` (`MyFlatOut` key set gains
  `shown`).
  `conftest.make_listing` takes the new columns as it takes any column; `make_flatmate` gains `shown: bool =
  False`.

**In (web):**
- `web/src/features/listings/RoomFields.tsx` (rendered from `PreferencesStep.tsx`), after the flatmates block:
  - "גודל החדר במ״ר (לא חובה)" number input (`listings.room.roomSize`, hint `listings.room.roomSizeHint`);
  - three `ChoiceGroup`s with the options כן / לא / לא לציין (`common.yes`, `common.no`,
    `listings.room.unset`; "לא לציין" sends `null` and is the default): private bathroom, balcony, bills
    included;
  - "מי מאחורי המודעה?" `ChoiceGroup` (`listings.room.poster.*`, four options with "לא לציין"), with
    `listings.room.poster.livesHereHint` under it while "גרים בדירה" is picked.
  - `listings.room.flatmatesHint` and `listings.room.agesHint` get Q17/Q23's wording (UI keys).
- `web/src/features/listings/validate.ts` (the room field touch-points at `:47-54`, `:104-105`, `:136`,
  `:349-352`, `:382-386`, `:410-432`): the five form fields (`room_size_sqm: string`, the three as `'yes' |
  'no' | ''`, `poster: Poster | ''`), a room-size check (whole number, 4 to the flat's `size_sqm`, else
  `listings.errors.range` with `min`/`max`), the body mapping (`''` → `null`; an apartment never sends them),
  and the edit form's initial values from `ListingOut`. The five join `ROOM_FIELDS` (so `changedFields`,
  `:418-423`, treats them as room keys), `room_size_sqm` joins `FIELD_ORDER` (`:104`), and
  `ListingWizard.tsx:51` `PREFERENCE_FIELDS` gains `room_size_sqm`.
- `web/src/features/listings/RoomPreview.tsx`: one chip per set fact (`listings.roomPreview.roomSize`,
  `.privateBathroom`, `.balcony`, `.bills.included`/`.bills.notIncluded`, `.poster.*`).
- `web/src/features/rooms/RoomFacts.tsx`: one `FactCell` per set fact (`rooms.facts.roomSize`,
  `.privateBathroom`, `.balcony`, `.bills`, `.poster` with values from `rooms.facts.values.*`), after today's
  two; none renders when `null`. Uses the existing fact icons (`factIcons.tsx`); no new icon.
- `web/src/features/rooms/FlatPeople.tsx` (new), rendered by `ListingPage.tsx` right after `RoomFacts` only
  when `listing.people.length > 0`: a `section` with `h2` `rooms.people.title` ("גרים בדירה") and a list
  (`ul`, `aria-labelledby` the heading) of person rows: the photo (`img` with `alt=""`, 48 px circle, 1:1
  crop) or the initial-letter circle the other person surfaces use (`PersonCard.tsx:113-115`); the name; a
  line "{age} · {gender}" with whichever is known (`rooms.people.ageGender`, `rooms.people.age`, gender from
  `profile.room.gender.*`); a tag `rooms.people.lister` on the lister's row; `about_me` as plain text; the
  answered questionnaire keys as `RoomFacts`' answer list does (`lifestyle.<key>.answer.<n>`). If 0010e's
  `components/Avatar.tsx` is on `main` when this builds, use it instead of the inline image/initial (the
  inline one carries `// shortcut: inline avatar, swap for 0010e's Avatar once merged`).
- `web/src/features/flatmates/JoinFlatPage.tsx`: above the join CTA, a `Switch`
  `flatmates.join.show` (default off) and its hint `flatmates.join.showHint`; `joinFlat(token, shown)` sends
  it (`flatmates/api.ts`).
- `web/src/features/flatmates/MyFlatsPage.tsx`: on each flat card, the same `Switch` (`flatmates.join.show`)
  bound to `flat.shown`; toggling calls `PATCH /me/flats/{id}` (`useSetShown` in `flatmates/api.ts`,
  invalidates the my-flats query and `['listing', id]`; that refetch counts one view, accepted); the switch is disabled while
  pending; a failure reverts it and shows `common.error` under the card.
- `web/src/locales/he.json`: see UI.
- Tests: `listings/__tests__/RoomFields.test.tsx`, `validate.test.ts`, `ListingWizard.test.tsx`,
  `ListingPage.test.tsx`, `flatmates/__tests__/JoinFlatPage.test.tsx` (its body assertions at `:103` and `:353`
  become `{ token: T, shown: false }`), `MyFlatsPage.test.tsx`. Listing literals that gain the five (and
  `people` where typed `ListingDetail`): `listings/__tests__/fixtures.ts`, `flatmates/__tests__/fixtures.ts`,
  `search/__tests__/fixtures.ts`, `likes/__tests__/fixtures.ts`, `ListingCard.test.tsx`, `SearchMap.test.tsx`,
  `SearchPage.test.tsx`, `ApplicantsPage.test.tsx`, `ApplySection.test.tsx`.

**Out:**
- Search filters or match-score inputs on the new facts (MARKET-PLAN section 3 step 4, rec).
- Linking the typed `flatmates_count` / `flatmate_ages` to joined flatmates: the typed count and ages stay as
  the lister types them; the hint asks the lister to leave out the ages of flatmates who are shown (Q17).
- Showing `shown` to the lister on `FlatmatesPage` (`FlatmateOut` is unchanged).
- People on search/map cards; liking or chatting with a shown flatmate (person likes are `0010h`).
- The photo upload itself (`0010d`/`0010e`); this spec only reads `users.photo_key`.

**New dependencies:** none.

## Data
Migration `0016_flat_profile` (down `0015`):
- `listings.room_size_sqm smallint NULL`, `ck_listings_room_size_sqm`: `room_size_sqm IS NULL OR
  (room_size_sqm BETWEEN 4 AND 100 AND room_size_sqm <= size_sqm)`.
- `listings.private_bathroom boolean NULL`, `listings.balcony boolean NULL`, `listings.bills_included boolean
  NULL`.
- `listings.poster text NULL`, `ck_listings_poster`: `poster IS NULL OR poster IN ('lives_here', 'leaving',
  'landlord')`.
- `ck_listings_room_fields` is dropped and re-created with the same name: `listing_type = 'room' OR
  (gender_preference = 'any' AND flatmates_count IS NULL AND flatmate_ages = '{}' AND lifestyle = '{}'::jsonb
  AND room_size_sqm IS NULL AND private_bathroom IS NULL AND balcony IS NULL AND bills_included IS NULL AND
  poster IS NULL)`.
- `listing_flatmates.shown boolean NOT NULL DEFAULT false`.

Backwards compatibility: every column is nullable or defaulted, so existing rows (and existing flatmates, who
are not shown) pass with no backfill, and today's web and API keep working until they ship. Downgrade, in
this order: drop `ck_listings_room_fields`, `ck_listings_room_size_sqm` and `ck_listings_poster`; drop the five
columns and `shown` (Postgres would silently drop the multi-column CHECK with the first column otherwise); re-create
`ck_listings_room_fields` with its `0009` text. The migration docstring says the room facts and every `shown`
choice are lost on downgrade.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/listings` (changed) | as today (0010b) | `ListingIn` + the five optional facts | 201 `ListingOut` + the five | 422 (an apartment with any of them; `room_size_sqm` > `size_sqm` or out of 4–100; unknown `poster`) |
| PATCH | `/listings/{listing_id}` (changed) | as today | `ListingPatch` + the five (explicit `null` clears) | 200 `ListingOut` | as today; 422 as above |
| GET | `/listings`, map, `/me/listings` (changed) | as today | — | items carry the five | as today |
| GET | `/listings/{listing_id}` (changed) | public (`optional_user`) | — | `ListingDetail` + the five + `people` (non-empty only for a seeker, decision 13, on a room that fits them, filtered by decision 7) | as today |
| POST | `/flatmate-invites/join` (changed) | `current_user` | `JoinIn {token, shown: bool = false}` | 200 `JoinOut` (a member's re-join keeps the stored `shown`) | as today (0008d) |
| GET | `/me/flats` (changed) | `current_user` | — | `MyFlatOut` + `shown` | 401 |
| PATCH | `/me/flats/{listing_id}` (new) | `current_user`, a member of that flat only | `ShownIn {shown: bool}` | 204 | 401; 404 `not_found` (not a member, unknown listing); 422 |

## UI
No artboard for these screens' new parts (PRODUCT.md: no new artboards); the design is here, from the brand kit
and the existing room fields, fact cells and person cards.
- **Wizard, room step** (`RoomFields.tsx`): the new fields follow the flatmates block in the same column.
  States: unchanged (the step has no load of its own); errors inline per field as today. RTL: logical
  properties only; the size input uses the existing number input (`dir="ltr"` digits as the other numbers).
- **Wizard preview** (`RoomPreview.tsx`): extra chips; nothing when a fact is unset.
- **Listing page, room** (`RoomFacts.tsx`, `FlatPeople.tsx`): loading/error/not-found are the page's own
  (unchanged). Empty: no "גרים בדירה" section at all when `people` is empty (also the visitor's and the
  owner's view). Success: the list. RTL: photo at the inline start of each row, text after it; the tag sits at
  the inline end of the name line.
- **Join page** (`JoinFlatPage.tsx`): the switch shows in the "ready to join" state only (not in invalid, own,
  applied, declined, full, member states). Loading/error states unchanged.
- **My flats** (`MyFlatsPage.tsx`): the switch on each card; empty, loading and error states unchanged;
  per-card pending (disabled) and error (`common.error` under the card).
- **i18n keys** (`web/src/locales/he.json`; brand voice: no slash forms, never one gender):
  - `listings.room.roomSize`: "גודל החדר במ״ר (לא חובה)"
  - `listings.room.roomSizeHint`: "רק החדר עצמו. גודל הדירה כבר מופיע בפרטי הדירה."
  - `listings.room.privateBathroom`: "שירותים ומקלחת צמודים לחדר"
  - `listings.room.balcony`: "מרפסת"
  - `listings.room.bills`: "חשבונות (חשמל, מים, גז, אינטרנט) כלולים במחיר"
  - `listings.room.unset`: "לא לציין"
  - `listings.room.poster.title`: "מי מאחורי המודעה?"
  - `listings.room.poster.lives_here`: "גרים בדירה"
  - `listings.room.poster.leaving`: "עוזבים את החדר"
  - `listings.room.poster.landlord`: "בעלי הדירה"
  - `listings.room.poster.livesHereHint`: "בחירה ב'גרים בדירה' מציגה אתכם בעמוד החדר, עם השם, התמונה והפרטים מ'עליי' שבפרופיל. רק מחפשי דירה או חדר רואים את זה."
  - `listings.room.flatmatesHint` (changed): "לא כולל את מי שייכנסו לחדר ואת מפרסמי המודעה"
  - `listings.room.agesHint` (changed): "אפשר למלא רק חלק מהגילאים. שותפים שהצטרפו בקישור ההזמנה ובחרו להופיע מוצגים עם הפרטים שלהם, ואת הגיל שלהם אין צורך להקליד."
  - `listings.roomPreview.roomSize`: "חדר של {{size}} מ״ר"
  - `listings.roomPreview.privateBathroom`: "שירותים ומקלחת צמודים"
  - `listings.roomPreview.balcony`: "מרפסת"
  - `listings.roomPreview.bills.included`: "חשבונות כלולים"
  - `listings.roomPreview.bills.notIncluded`: "חשבונות לא כלולים"
  - `rooms.facts.roomSize`: "גודל החדר"; `rooms.facts.privateBathroom`: "שירותים ומקלחת צמודים";
    `rooms.facts.balcony`: "מרפסת"; `rooms.facts.bills`: "חשבונות"; `rooms.facts.poster`: "מפרסמי המודעה"
  - `rooms.facts.values.sqm`: "{{size}} מ״ר"; `rooms.facts.values.yes`: "יש"; `rooms.facts.values.no`: "אין";
    `rooms.facts.values.billsIncluded`: "כלולים במחיר"; `rooms.facts.values.billsNotIncluded`: "לא כלולים";
    `rooms.facts.values.poster.lives_here`: "גרים בדירה"; `.leaving`: "עוזבים את החדר"; `.landlord`:
    "בעלי הדירה"
  - `rooms.people.title`: "גרים בדירה"
  - `rooms.people.lister`: "מפרסמים את החדר"
  - `rooms.people.ageGender`: "{{age}} · {{gender}}"; `rooms.people.age`: "גיל {{age}}" (shown alone when gender is unknown; `ageGender` uses the bare number)
  - `flatmates.join.show`: "להציג אותי בעמוד החדר"
  - `flatmates.join.showHint`: "מחפשי דירה או חדר יראו את השם, התמונה והפרטים מ'עליי' שבפרופיל. אפשר לשנות בכל רגע ב'הדירות שלי'."
  - `common.yes` / `common.no` (added, they do not exist yet): "כן" / "לא".
  - `profile.about.privacy` (0010c's string, amended here because the personal part now also reaches seekers
    through a shown flatmate or a lister who lives there): "בעלי חדרים שמגישים אליהם מועמדות רואים את המגדר, הגיל והתשובות כפי שהם שמורים עכשיו. אם בוחרים להופיע בעמוד של דירה, גם מחפשי דירה או חדר רואים אותם שם. כיבוי המתג ושמירה מוחקים אותם."
  The poster values are dynamic keys (`rooms.facts.values.poster.${poster}`, `listings.room.poster.${p}`):
  a catalogue test asserts every `Poster` value has both (as 0007d's lifestyle catalogue test does).

## Acceptance criteria
- [ ] AC1 Given owner `O`, When `O` POSTs a room with `room_size_sqm: 12`, `private_bathroom: true`, `balcony:
  false`, `bills_included: true`, `poster: "lives_here"`, Then 201 echoes them, and `GET /listings`, the map
  and `GET /listings/{id}` return them to an anonymous caller too. A room without them stores `null`s. —
  `api/tests/test_flat_profile.py::test_ac1_room_facts_roundtrip_and_public`
- [ ] AC2 422 (list `detail`, nothing written): an apartment with any one of the five; `room_size_sqm: 3`, `101`,
  or larger than `size_sqm`; `poster: "agent"`. A PATCH with `"balcony": null` clears it; a PATCH setting
  `room_size_sqm` above the stored `size_sqm` is a 422. — `test_flat_profile.py::test_ac2_room_fact_rules`
- [ ] AC3 (security, decision 13 and 17) Given room `R` of `O` with `poster: "lives_here"`, flatmate `F1`
  joined with `shown: true` (personal part: woman, birth year, about me, two answers, a photo) and `F2` joined
  without `shown`, When a seeker GETs `/listings/{R}`, Then `people` is `[O (lister: true), F1]` with `F1`'s
  name, `photo_url` (small), age, gender, about me and answers, and no `F2`. An anonymous caller, an
  owner-role account with no looking part, and `O` (unless `O` is a seeker by the rule) get `people: []`. No
  user id, membership id or email is anywhere in the body (the test serialises it and searches for each).
  Decision 7: with `F1` preferring `flatmate_gender: "women"`, a seeker who is a man and a seeker with no
  gender do not get `F1` (they still get `O` if `O`'s preference is `any`); a woman does. On a women-only room,
  a man (`room_fit` false) gets `people: []`. — `test_flat_profile.py::test_ac3_people_seekers_only_by_choice`,
  `test_flat_profile.py::test_ac3b_people_follow_the_gender_rule`
- [ ] AC4 A shown flatmate with no profile row appears with `gender`, `age`, `about_me` null and `lifestyle` `{}`;
  a lister with `poster` other than `lives_here` is absent. Statements (the existing `before_cursor_execute`
  recorder): for a seeker on a room exactly one recorded statement mentions `listing_flatmates`, for a
  non-seeker or an apartment none does, and a seeker's total count is the same with 1 and with 3 shown
  flatmates. —
  `test_flat_profile.py::test_ac4_people_edge_cases_and_statement_count`
- [ ] AC5 Join and toggle: `POST /flatmate-invites/join` with `shown: true` stores it; without the key it is
  false; a member's second join with `shown: false` keeps `true`. `PATCH /me/flats/{R}` `{shown: false}`
  returns 204, `GET /me/flats` then has `shown: false` and `F1` leaves `people`; a non-member's PATCH gives 404, no session
  401, `{}` or an extra key 422. `GET /me/flats` carries `shown`. —
  `test_flat_profile.py::test_ac5_join_shown_and_toggle`
- [ ] AC6 Migration: on a database at `"0015"` with a room, an apartment and a membership, upgrade to `"0016"`
  keeps them (`shown` false); the new CHECKs exist by name; an apartment with `balcony = true` fails
  `ck_listings_room_fields`; `room_size_sqm` > `size_sqm` fails `ck_listings_room_size_sqm`. Downgrade to
  `"0015"` drops the columns and restores the old `ck_listings_room_fields` text; upgrade again works.
  `_LISTINGS_CHECKS` gains the two names and `test_ac10_listings_roundtrip`'s equality passes. —
  `api/tests/test_migrations.py::test_ac6_flat_profile_upgrade_downgrade`
- [ ] AC7 Web wizard: on the room step the five fields render with "לא לציין" preselected; picking values and a
  room size of 12 on a 60 m² flat sends them in the body; 70 on a 60 m² flat shows `listings.errors.range`
  (4–60); "גרים בדירה" shows `livesHereHint`; editing a room preloads them; an apartment never shows or sends
  them; the wizard preview shows one chip per set fact and none for "לא לציין". —
  `web/src/features/listings/__tests__/RoomFields.test.tsx`, `validate.test.ts`, `ListingWizard.test.tsx`
  (`ac7 …` cases)
- [ ] AC8 Web listing page: a room with the facts shows their fact cells, a room with none shows today's two;
  with `people` (lister + one flatmate, one with a photo and one without) "גרים בדירה" lists both in order,
  the lister tagged, the photo as `img alt=""`, the other as the initial; `people: []` renders no section. —
  `web/src/features/listings/__tests__/ListingPage.test.tsx` (`ac8 …` cases)
- [ ] AC9 Web join and my flats: the join switch is off by default and its value is sent; on "הדירות שלי" the
  switch reflects `shown`, a toggle sends the PATCH and disables the switch until it settles, and a failure
  reverts it and shows `common.error`. — `web/src/features/flatmates/__tests__/JoinFlatPage.test.tsx`,
  `MyFlatsPage.test.tsx` (`ac9 …` cases)
- [ ] AC10 Every `Poster` value has its `listings.room.poster.*` and `rooms.facts.values.poster.*` keys. —
  `web/src/features/rooms/__tests__/poster.test.ts`

## Tests to write
- Integration (API): AC1–AC6 as named; `test_room_search.py:585`'s public-fields test lists the five;
  `test_flatmates.py`'s join tests keep passing with `JoinIn` (the key is optional).
- Unit (web): AC7–AC10.
- E2E (CI only, no local `make e2e`): no existing test asserts the room facts' cell count or the join body, so
  none should break; the build checks `search.spec.ts:206` (`room-facts` visible), `applications.spec.ts:251`
  and the `listing`, `listings` and `flatmates` screen files still pass and regenerates their screenshots
  (new fact cells, the join switch, the my-flats switch). New: one step in `web/e2e/flatmates.spec.ts`
  `ac6_invite_and_join`: the flatmate turns on "להציג אותי בעמוד החדר" before joining, then a seeker context
  (`putProfile`) opens the room and sees the flatmate's name under `he.rooms.people.title`.

## Risks / open questions
- **The lister's name on the room page (decided, Gilad 2026-11-13, option a).** When `poster = 'lives_here'`
  the room page shows the lister's full card (name, photo, age, gender, about me, answers) to seekers only,
  and the wizard says plainly that picking "גרים בדירה" shows them there (`livesHereHint`). This is Gilad's
  exception to PRODUCT.md "Search" (no owner name on the public listing) and "Applications" (owner unnamed until
  chat), for rooms whose lister lives there; the orchestrator writes it into PRODUCT.md.
- **Decision 7 on the room page.** Shown people follow the same two-way gender rule as people browse (0010h),
  and a room the fit rule hides from a seeker shows them no people. This applies Gilad's decision 7; it is not a
  new rule.
- **Consent wording.** A flatmate shown before 0010c had no personal part to show; from here the switch's hint
  names exactly what is shown and to whom. Existing memberships default to not shown (decision 17).
- **Seeker rule reuse.** `people` uses `_is_seeker` exactly; any later change to decision 13's rule changes who
  sees flatmates too, which is the intent.
- **Typed ages vs shown people (Q17).** The server cannot tell which typed age belongs to a shown flatmate, so
  the lister is asked (hint) to type only the others; a lister who types them all shows an age twice. Accepted;
  no data link is built.
- **Avatar overlap with 0010e.** Both build in the same wave; the inline image/initial here is marked as a
  shortcut to swap for `Avatar` when 0010e merges first or second (whichever merges second rebases).
- **`photo_url` is 0010d's** `person_photo_url(key)` (0010d draft); if it is renamed there, the coder follows
  it. The field name `photo_url` and "small size" are the section-7 contract.
- **Verifier.** Round 1: 12 findings applied (1 blocker: the lister-name question, now Gilad's decision (a);
  3 majors: decision 7's gender rule on shown people and fit-hidden rooms, the full list of API and web tests
  that break, a valid UNION ALL ordering; 8 minors: statement-count AC, PATCH returns 204, Hebrew copy without
  one-gender forms, `profile.about.privacy` amended, downgrade order, `ROOM_FIELDS`/`FIELD_ORDER`/
  `PREFERENCE_FIELDS`, preview chips tested, `display_name` and `person_photo_url` naming).

## Digest (filled by orchestrator after verification)
See `/digest`.
