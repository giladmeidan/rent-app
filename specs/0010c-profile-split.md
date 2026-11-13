---
id: 0010c
title: Any account fills a personal part of the profile (gender, age, about me, answers) on its own, and the "what I am looking for" part becomes optional, needed only to apply, to like a room or to show a card in שוק השותפים
status: in-progress
depends_on: [0010b, 0010g]   # 0010b: GET/PUT /me/profile open to every account and `_is_seeker` = seeker role or has_profile; 0010g: migration chain 0014 -> 0015
reviewers: [code, qa, security, ux]   # security: personal data, a CHECK rewrite on seeker_profiles, every "has a profile" gate (apply, like, people browse, inbox, match); qa: gates and the profile page; ux: the profile page is reorganised
estimate: 1 coder run   # coder Opus/high (migration on personal data; Speed rule 6)
---

## Goal
After this ships, any signed-in account fills the profile in two independent parts:
- a **personal part** ("עליי": gender, optional birth year, optional about me, the questionnaire; the photo
  joins it in `0010e`), which someone who already lives in a flat can fill alone;
- a **"what I am looking for" part** ("מה מחפשים": budget, move-in, areas, household, pets, smoker, contract,
  parking, flatmates preference), needed only to apply, to like a room, to get a match score, or to show a card
  in שוק השותפים.

The single visibility switch is re-worded "להציג את הכרטיס שלי בשוק השותפים" and needs both parts.

This serves PRODUCT.md "שוק השותפים" (decision 16, Q19: "the profile splits in two"; Q12/decision 14: one
switch) and `specs/MARKET-PLAN.md` section 7 "Profile (0010c)". `0010f` reads the personal part of flatmates, and
`0010h` reads both parts for people browse.

## Scope
**In (API):**
- Migration `api/alembic/versions/0015_profile_split.py` (revision `"0015"`, down `"0014"`), see Data.
- `api/app/models/seeker_profile.py`: the 7 housing columns become `Mapped[... | None]` with `nullable=True`;
  the three new CHECKs of Data are added to `__table_args__` with the same text as the migration
  (`test_ac4_autogenerate_sees_no_diff_with_postgis_extensions` must stay green). The module docstring
  replaces "the room section" with "the personal part" and adds the looking part.
- `api/app/schemas/profile.py`:
  - `SeekerProfileIn`: `budget_max_ils`, `move_in_date`, `area_ids`, `household`, `has_pets`, `smoker`,
    `contract_months` become `X | None = None` (same annotated types, so every bound still applies when sent).
    `extra="ignore"` stays.
  - `_room_section_needs_gender` is replaced by `_parts`, one `model_validator(mode="after")` that raises
    `ValueError` (a 422 with a list `detail`, no value named) for, in this order:
    1. the 7 looking fields neither all set nor all `None` → "budget_max_ils, move_in_date, area_ids, household,
       has_pets, smoker and contract_months are sent together (the looking part)";
    2. looking part empty and `move_in_flexible`, `parking_needed != 0`, `flatmate_gender != "any"` or
       `people_visible` set → "move_in_flexible, parking_needed, flatmate_gender and people_visible need the
       looking part" (the same four columns as `ck_seeker_profiles_looking_defaults`, so no valid body can reach
       an `IntegrityError`);
    3. `gender` is `None` and `birth_year`, `flatmate_gender != "any"`, `lifestyle`, `people_visible` or
       `about_me` set → today's message, re-worded "… need gender (the personal part)";
    4. neither part (`gender is None` and looking empty) → "fill the personal part, the looking part or both".
    So `people_visible` needs both parts (2 and 3), and `flatmate_gender` needs gender, as today.
  - `SeekerProfileOut`: the same 7 fields become `X | None`. The docstring says a `null` budget means the
    looking part is empty.
  - Module docstring: the personal part and the looking part replace "the room section".
- `api/app/services/profiles.py`:
  - `has_profile` keeps its name and becomes "the looking part is filled": `exists().where(SeekerProfile.user_id
    == user_id, SeekerProfile.budget_max_ils.is_not(None))` (contract in MARKET-PLAN section 7). Docstring
    updated. Its callers (`routers/search.py::_profile_user_id`, and `_is_seeker` as 0010b left it) need no
    edit: a personal-only profile gets no match, no room fit and, unless the account's role is seeker, no
    seekers-only fields.
  - `put_profile` calls `_check_areas` only when `data.area_ids is not None`.
  - Docstring: "room section" → "personal part".
- `api/app/routers/profiles.py`: the auth rule is `current_user` (0010b's change; if `0010b` merged with
  `current_seeker` still on these two routes, this spec swaps it and drops `seeker_only` from `_SEEKER_ONLY`).
  The 404 `seeker_profile_not_found` stays for "no row".
- Every consumer that took "a profile row" to mean "looking" (each one line):
  - `services/applications.py::apply` (:192): the gate's EXISTS adds `SeekerProfile.budget_max_ils.is_not(None)`.
    A personal-only applicant gets 409 `seeker_profile_required`, as with no row. The docstring says so.
  - `services/applications.py::list_applicants` (:387): `SeekerProfile.user_id.is_(None)` →
    `SeekerProfile.budget_max_ils.is_(None)`, so a personal-only applicant sorts with the no-profile ones.
  - `routers/applications.py::_applicant_out` (:173): `has_profile = row.household is not None` is already
    right (household is NULL exactly when the looking part is empty). Only its docstring changes. `room`
    keeps coming from the personal part (`room_gender`), so a room application from someone who later
    emptied the looking part still shows gender, age and answers, with no match and no housing summary.
  - `services/people.py::like_room` (:452-460): the profile SELECT adds `SeekerProfile.budget_max_ils`;
    `profile is None or profile.budget_max_ils is None` → `ProfileRequiredError` (409
    `seeker_profile_required`), then `gender is None` → `RoomSectionRequiredError` (409
    `room_section_required`, the code is kept; the web words it as the personal part).
  - `services/people.py::_fits` (:136-145): adds `SeekerProfile.budget_max_ils.is_not(None)`. A seeker who liked
    a room and then emptied the looking part leaves that room's people page (the card needs areas and
    move-in, and the score needs the budget). `pending_seeker_like` stays as is (its `shortcut:` already
    says fit and opt-in are not re-checked; add "nor the looking part" to it).
  - `services/search.py`: search, map and the listing page join the profile only when `_profile_user_id`
    returned an id, which now needs the looking part (no change there). **`liked_rooms`** (:211-221) is
    called directly by `routers/people.py:237` (`GET /me/likes`) and inner-joins the profile to compute the
    match: it adds `SeekerProfile.budget_max_ils.is_not(None)` to its WHERE. Without it a NULL `m_score`
    reaches `explain` (`matching/score.py:244`, `int(values["m_score"])`) and `GET /me/likes` is a 500. A
    personal-only profile gets empty lists there, as `_fits` drops them from people browse.
  - `matching/`: no change. Every match path is reached only through one of the gates above (search by
    `has_profile`, inbox by `household`, people by `_fits`, my likes by `liked_rooms`' WHERE).
- Tests: `api/tests/test_profiles.py` (new ACs, and today's tests whose 422 message for a room field without
  gender changed), `test_migrations.py` (AC9), `test_applications.py`, `test_people.py`, `test_inbox.py`,
  `test_room_search.py` (one test each, named below). `conftest.py`: `NO_LOOKING` (a dict of the 7 columns set
  to `None` **plus `parking_needed: 0`**, since `make_profile` defaults it to 1, `conftest.py:263`, and
  `ck_seeker_profiles_looking_defaults` refuses that), so `make_profile(engine, uid, area_id, gender="woman", **NO_LOOKING)` writes a personal-only row.

**In (web):**
- `web/src/features/profile/api.ts`: `type LookingProfile = SeekerProfileOut & { budget_max_ils: number;
  move_in_date: string; area_ids: string[]; household: Household; has_pets: boolean; smoker: boolean;
  contract_months: ContractMonths }` and `hasLooking(p: SeekerProfileOut | null | undefined): p is
  LookingProfile` (`p?.budget_max_ils != null`). `Household` and `ContractMonths` become
  `NonNullable<…>`. Every place below narrows with it; no `!`.
- `web/src/features/profile/links.ts`: `roomSectionHref` is replaced by
  `profileHref(next: string, ...open: ProfileSection[])` with `type ProfileSection = 'about' | 'looking'`,
  giving `/me/profile?section=about&section=looking&next=…` (repeatable `section`, `next` encoded as today).
- `web/src/features/profile/validate.ts`:
  - `ProfileForm.room` is renamed `personal` and a `looking: boolean` is added.
  - `validate`: the looking fields (`budget_max_ils`, `move_in_date`, `area_ids`, `household`,
    `contract_months`) are checked only while `looking`; `gender`, `birth_year`, `about_me` only while
    `personal`. Neither on → `{ form: { key: 'profile.errors.onePart' } }`; `FieldName` gains `'form'`, last in
    `FIELD_ORDER` (no input carries it; the page shows it as the save bar's alert).
  - `toProfileIn`: `looking` off → the 7 sent as `null`, `move_in_flexible: false`, `parking_needed: 0`;
    `personal` off → `gender`, `birth_year`, `about_me` `null`, `lifestyle: {}`; `flatmate_gender` is sent
    only when both are on, else `'any'`; `people_visible` only when both are on, else `false`. Its `throw`s
    for a missing household/contract apply only while `looking`.
  - The form's initial state from a stored profile (`formFromProfile`, `validate.ts:81-99`): `looking =
    hasLooking(p)`, `personal = p.gender !== null`; when `!hasLooking(p)` the looking fields take
    `emptyProfileForm`'s values (budget `''`, move-in `''`, an empty area set, household `null`, pets and
    smoker `false`, contract `null`, parking `0`), never `String(null)`. With no profile (404): `looking:
    true`, `personal: false` (today's default).
- `web/src/features/profile/ProfilePage.tsx`, reorganised into three parts in this order (each a `<section>`
  with an `h2` labelled section, the existing `Switch` and `mutedNote`, no new component):
  1. `#profile-about` "עליי" (`profile.about.title`, hint `profile.about.hint`): switch
     `profile.about.switch`. On: gender (`profile.room.fields.gender` choices, kept), birth year, about me
     (moved here from the people sub-section), the questionnaire (`#profile-lifestyle`, kept), and the
     privacy line `profile.about.privacy`.
  2. `#profile-looking` "מה מחפשים" (`profile.sections.search`, kept, now this part's `h2`): switch
     `profile.looking.switch` with the hint `profile.looking.hint` under it. On: the existing
     `#profile-search` block **without its own heading** (`ProfilePage.tsx:336-337`, so the text is not
     repeated) and the `#profile-household` block (its heading becomes an `h3`), plus
     the flatmates preference (`profile.room.fields.flatmates`, moved here), shown only while "עליי" is on,
     with the note `profile.looking.flatmatesNeedsAbout` in its place while it is off.
  3. `#profile-people` "שוק השותפים" (`profile.people.title`), shown only while both switches are on: the
     switch `profile.people.visible` ("להציג את הכרטיס שלי בשוק השותפים") and its hint
     `profile.people.visibleHint`. While either part is off: `profile.people.needsBoth` in its place.
  - The side index (`profile.nav.label`) lists the three parts (and `#profile-lifestyle` under "עליי").
  - `?section=about` / `?section=looking` (repeatable) switch those parts on when the page opens and focus the
    first listed part's `h2` (today's `roomEntry` logic, generalised to `params.getAll('section')`). The
    `?section=room` handling is removed (its only producers change in this spec).
  - Saving with both switches off shows `profile.errors.onePart` in the save bar's error slot; nothing is sent.
  - Switching a part off keeps its fields in the form (switching back on restores them) and clears them on
    save, as the room switch does today.
- Gates and readers of "has a profile" (each narrows with `hasLooking`):
  - `features/match/ProfileNudge.tsx:16`: shown when `!hasLooking(profile.data)` (and the profile has
    loaded); link `profileHref(here, 'looking')`.
  - `features/applications/ApplySection.tsx:428-435`: `RoomGate` when the room is women- or men-only and
    `profile.data?.gender` is not set; else `ProfileGate` when `!hasLooking(profile.data)`.
  - `features/applications/ProfileGate.tsx`: link `profileHref('/listings/' + id, 'looking')`.
  - `features/rooms/RoomGate.tsx`: link `profileHref('/listings/' + id, 'about', 'looking')`; copy key
    `rooms.apply.fillRoomSection` gets the new wording below.
  - `features/likes/LikeRoomButton.tsx:123`: `profileHref(location.pathname, 'about', 'looking')`.
  - `features/likes/MyLikesPage.tsx:154`: `/me/profile?section=room` → `profileHref('/me/likes', 'about',
    'looking')` (the card switch it points to needs both parts).
  - `features/match/MatchCard.tsx:58`, `features/search/SearchPage.tsx:39`, `features/likes/MyLikesPage.tsx:88`:
    pass the profile on only when `hasLooking(…)` (else `undefined`, today's "no profile" path); the
    reason-wording functions take `LookingProfile`, and so do the props typed `SeekerProfileOut | undefined`
    today: `match/MatchChips.tsx:18`, `search/ResultsList.tsx:25`, `search/SearchMap.tsx:22`,
    `likes/MyLikesPage.tsx:39` (all become `LookingProfile | undefined`).
- `web/src/locales/he.json`: see UI.
- Tests: `profile/__tests__/validate.test.ts`, `links.test.ts`, `ProfilePage.test.tsx`,
  `applications/__tests__/ApplySection.test.tsx`, `profile/__tests__/fixtures.ts` (a personal-only fixture).
  Existing unit tests that break and are updated: `app/__tests__/Layout.test.tsx:149-153` (`?section=room`,
  `he.profile.room.title` → `?section=about`, `he.profile.about.title`), `likes/__tests__/MyLikesPage.test.tsx:82`
  and `:274` (the href), `listings/__tests__/ListingPage.test.tsx:1016` (RoomGate href),
  `search/__tests__/SearchPage.test.tsx:677` (the nudge href gains `section=looking`).

**Out:**
- The person photo on the profile page (`0010e`).
- Showing the personal part to anyone new: flatmates on the room page are `0010f`; people browse people is
  `0010h`. In this spec the personal part reaches exactly who it reaches today (the room inbox, people browse
  for room listers, `_is_seeker`'s fields).
- Deleting the whole profile row (both parts off is refused; no `DELETE /me/profile`).
- Any change to the match score, to search filters, or to the role rules of 0010b.
- Re-wording the rest of the profile copy that still uses slash forms (only the strings this spec touches are
  rewritten; the rest is FOLLOWUPS' brand-voice pass).

**Build deviations (spec session, 2026-11-14):** `api/app/matching/score.py` (the smoker and pets terms use
`IS TRUE` so mypy accepts the nullable columns; scores unchanged, every score test passes as before);
`api/app/routers/people.py::my_likes` computes `seeker` with `_sees_room_privacy(user, _profile_user_id(db, user))`
instead of `True` (0010b's hand-over, FOLLOWUPS); `services/search.py::_with_profile` joins only a profile with the
looking part (review round 1: closes the read-committed window between `has_profile` and the match statement);
`web/src/features/search/SearchResults.tsx` (prop typed `LookingProfile | undefined`) and `web/src/app/RouteFocus.tsx`
(a comment).

**New dependencies:** none.

## Data
Migration `0015_profile_split` (down `0014`):
- `ALTER COLUMN … DROP NOT NULL` on `budget_max_ils`, `move_in_date`, `area_ids`, `household`, `has_pets`,
  `smoker`, `contract_months`.
- Three new CHECKs (every existing CHECK keeps its name and text; the value CHECKs on budget, areas, household and
  contract already pass on NULL):
  - `ck_seeker_profiles_looking`: `num_nulls(budget_max_ils, move_in_date, area_ids, household, has_pets,
    smoker, contract_months) IN (0, 7)` (all or none);
  - `ck_seeker_profiles_looking_defaults`: `budget_max_ils IS NOT NULL OR (NOT move_in_flexible AND
    parking_needed = 0 AND flatmate_gender = 'any' AND NOT people_visible)`;
  - `ck_seeker_profiles_parts`: `budget_max_ils IS NOT NULL OR gender IS NOT NULL` (a row is never empty).
- `ck_seeker_profiles_room_section` is unchanged: it already says the personal part needs `gender`, and that
  `flatmate_gender` and `people_visible` need it too. Its name stays (renaming a CHECK buys nothing).

Backwards compatibility: every existing row has all 7 set, so the upgrade passes every new CHECK with no backfill.
Today's web sends the whole looking part, which the new API still accepts. Downgrade: `DELETE FROM
seeker_profiles WHERE budget_max_ils IS NULL` (personal-only rows, which could not exist before), then drops the
three CHECKs and restores `NOT NULL`. That loss is stated in the migration's docstring.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/me/profile` (changed) | `current_user` (0010b) | — | 200 `SeekerProfileOut`, the 7 looking fields nullable | 401; 404 `seeker_profile_not_found` |
| PUT | `/me/profile` (changed) | `current_user`, own row only | `SeekerProfileIn`, the 7 looking fields nullable, the rules of `_parts` | 200 `SeekerProfileOut` | 401; 422 (list `detail`; `unknown_area`) |
| POST | `/listings/{id}/applications` (gate changed) | as today | as today | as today | 409 `seeker_profile_required` also for a personal-only profile |
| POST | `/listings/{id}/like` (gate changed) | as today | — | as today | 409 `seeker_profile_required` also for a personal-only profile; `room_section_required` for a looking-only one |
| GET | `/listings/{id}/people`, `/listings/{id}/applications`, `/listings`, `/listings/{id}` (behaviour changed, shape unchanged) | as today | as today | a personal-only profile counts as no profile | as today |
| GET | `/me/likes` (behaviour changed, shape unchanged) | as today | — | a personal-only profile gets both lists empty (never a 500) | as today |

## UI
Screen: `/me/profile` (`ProfilePage.tsx`). No artboard change: the layout is `0009r`'s (`design/screens-v1`
profile artboard + the brand kit); the three parts reuse its section, switch and side-index patterns.
- **States.** Loading: today's skeleton. Error (GET fails): today's `ErrorState` with retry. Empty (404): the
  form opens with "מה מחפשים" on and "עליי" off. Success: `profile.saved` in the save bar, then `?next=` as
  today. Save error: today's alert; `profile.errors.onePart` when both parts are off; a 422 list maps to fields
  as today (`serverFieldErrors`).
- **RTL.** No new layout: sections stack in the existing column; the side index stays at the inline start.
  Only logical properties.
- **i18n keys** (`web/src/locales/he.json`; brand voice: no slash forms, never one gender):
  - `profile.about.title`: "עליי"
  - `profile.about.hint`: "מגדר, גיל, כמה מילים ותשובות לשאלון. אפשר למלא את החלק הזה גם בלי לחפש דירה, למשל כשכבר גרים בדירת שותפים."
  - `profile.about.switch`: "למלא את הפרטים האישיים"
  - `profile.about.privacy`: "בעלי חדרים שמגישים אליהם מועמדות רואים את המגדר, הגיל והתשובות כפי שהם שמורים עכשיו. כיבוי המתג ושמירה מוחקים אותם."
  - `profile.looking.switch`: "מחפשים דירה או חדר"
  - `profile.looking.hint`: "נדרש כדי להגיש מועמדות, לסמן לייק לחדר ולקבל ציון התאמה."
  - `profile.looking.flatmatesNeedsAbout`: "העדפת השותפים נשמרת יחד עם המגדר, בחלק 'עליי'."
  - `profile.people.title`: "שוק השותפים"
  - `profile.people.visible`: "להציג את הכרטיס שלי בשוק השותפים"
  - `profile.people.visibleHint`: today's `profile.room.peopleVisibleHint` text, re-worded without slash forms:
    "בעלי חדרים רואים את השם, המגדר, הגיל, האזורים, תאריך הכניסה, התשובות לשאלון, 'קצת עליי' וציון התאמה. את התקציב רק כ'מתאים' או 'לא מתאים', אף פעם לא את הסכום."
  - `profile.people.needsBoth`: "כדי להציג כרטיס בשוק השותפים צריך למלא גם את 'עליי' וגם את 'מה מחפשים'."
  - `profile.errors.onePart`: "צריך למלא לפחות חלק אחד: 'עליי' או 'מה מחפשים'."
  - `rooms.apply.fillRoomSection` (changed text): "למילוי 'עליי' ו'מה מחפשים'"
  - `likes.errors.roomSection` (changed text; `useLikeRoom.ts:23` shows it for both `room_section_required` and `seeker_profile_required`): "כדי לסמן לייק לחדר צריך למלא בפרופיל את 'עליי' ואת 'מה מחפשים'."
  - `rooms.apply.roomSectionRequired` (changed text, it named the old section): "החדר מיועד ל{{who}} בלבד. כדי להגיש מועמדות צריך למלא בפרופיל את 'עליי' ואת 'מה מחפשים'."
  - `match.nudge` (changed text, build: it now shows on both sides to any account without the looking part): "רוצה לראות ציון התאמה? ממלאים בפרופיל את 'מה מחפשים' פעם אחת."
  - `profile.intro` (changed text, review round 1: it framed the page as housing-only and had a slash form): "כמה פרטים, פעם אחת. מ'מה מחפשים' מחושב ציון ההתאמה, ובעלי מודעות שמגישים אליהם מועמדות רואים חלק מהפרטים."
  - `likes.likedMeEmpty` (changed text, it named the old switch): "עוד אין חדרים שאהבו אותך. כדאי להפעיל בפרופיל את 'להציג את הכרטיס שלי בשוק השותפים'."
  - Removed (and from `i18n-check`'s allow-list if listed): `profile.room.title`, `profile.room.hint`,
    `profile.room.switch`, `profile.room.privacy`, `profile.room.peopleVisible`,
    `profile.room.peopleVisibleHint`, `profile.room.peopleTitle`. Kept: `profile.room.fields.*`,
    `profile.room.gender.*`, `profile.room.genderNote`, `profile.room.birthYearHint`, `profile.room.aboutMe`.

## Acceptance criteria
- [ ] AC1 Given a signed-in account with no profile, When it PUTs only the personal part (`gender: "man"`,
  `birth_year`, `about_me`, `lifestyle`), Then 200, `GET /me/profile` returns the 7 looking fields as `null`,
  `move_in_flexible` false, `parking_needed` 0, `flatmate_gender` "any", `people_visible` false. A PUT of the
  whole looking part with no `gender` also gives 200 (today's body). — `api/tests/test_profiles.py::test_ac1_either_part_alone`
- [ ] AC2 Each `_parts` rule is a 422 with a list `detail` naming no sent value: 6 of the 7 looking fields;
  `parking_needed: 1` or `move_in_flexible: true` without the looking part; `people_visible: true` with only
  the looking part and with only the personal part; `about_me` without `gender`; `flatmate_gender: "women"`
  without `gender`; `{gender: "woman", flatmate_gender: "women"}` with no looking part (rule 2, never a
  500); an empty body `{}`. Nothing is written by any of them. —
  `test_profiles.py::test_ac2_part_rules`
- [ ] AC3 A PUT that drops the looking part from a full profile clears it (the 7 `null`, the looking defaults
  restored, `people_visible` false) and keeps the personal part; a PUT with only the looking part clears the
  personal part. `unknown_area` is checked only when `area_ids` is sent. —
  `test_profiles.py::test_ac3_put_replaces_each_part`
- [ ] AC4 Given a personal-only profile, Then `has_profile` is false: `POST /listings/{apartment}/applications`
  gives 409 `seeker_profile_required`, `GET /listings` returns `match: null` on every item and the sort falls
  back to `newest`, and `GET /listings/{room}` gives `match: null`, `room_fit: null`. —
  `api/tests/test_applications.py::test_ac4_personal_only_cannot_apply`,
  `api/tests/test_room_search.py::test_ac4_personal_only_has_no_match`
- [ ] AC5 Like gate: a personal-only profile liking a room gets 409 `seeker_profile_required`; a looking-only
  profile gets 409 `room_section_required`; both parts → 200. — `api/tests/test_people.py::test_ac5_like_room_needs_both_parts`
- [ ] AC6 Given seeker `S` who liked room `R` and is `people_visible`, When `S` PUTs only the personal part,
  Then `S` no longer appears on `R`'s `GET /listings/{R}/people` (neither opted in, since `people_visible`
  became false, nor as a liker), and the page's total drops by one; and `S`'s `GET /me/likes` is 200 with both
  lists empty (not a 500 from a NULL score). — `test_people.py::test_ac6_no_looking_part_leaves_people_browse`,
  `test_people.py::test_ac6b_my_likes_without_looking_part`
- [ ] AC7 Inbox: given `S` applied to room `R` with both parts, When `S` drops the looking part, Then the
  owner's `GET /listings/{R}/applications` shows `S` with `match: null`, `profile: null`, `room` still set
  (gender, age, answers), and with `sort=match` `S` comes after every applicant who has the looking part. —
  `api/tests/test_inbox.py::test_ac7_personal_only_applicant`
- [ ] AC8 `GET`/`PUT /me/profile` work for an owner-role account (0010b's rule) and give 401 without a session.
  — `test_profiles.py::test_ac8_any_account`
- [ ] AC9 Migration: on a database at `"0014"` with one full profile, upgrade to `"0015"` keeps the row; the
  three CHECKs exist by name; inserting a row with 3 of the 7 looking columns NULL fails
  `ck_seeker_profiles_looking`, one with no looking part and `parking_needed = 1` fails
  `ck_seeker_profiles_looking_defaults`, one with neither part fails `ck_seeker_profiles_parts`; a
  personal-only row inserts. Downgrade to `"0014"` deletes the personal-only row, keeps the full one, and the 7
  columns are NOT NULL again; upgrade again works. —
  `api/tests/test_migrations.py::test_ac9_profile_split_upgrade_downgrade`
- [ ] AC10 Web validate: with `looking` off and `personal` on, the looking fields raise no error and
  `toProfileIn` sends them as `null` with `parking_needed: 0`, `move_in_flexible: false`, `flatmate_gender:
  'any'`, `people_visible: false`; with `personal` off, `gender`/`birth_year`/`about_me` are `null` and
  `lifestyle` `{}`; with both off, `validate` returns only `form: profile.errors.onePart`; with both on, every
  field is sent as today. — `web/src/features/profile/__tests__/validate.test.ts` (`ac10 …` cases)
- [ ] AC11 Web page: a 404 profile opens with "מה מחפשים" on and "עליי" off; a stored personal-only profile
  opens with "עליי" on and "מה מחפשים" off; the "שוק השותפים" switch is present only with both on, else
  `profile.people.needsBoth`; `?section=about&section=looking` switches both on and focuses the "עליי"
  heading; both off + save shows `profile.errors.onePart` and sends no request. —
  `web/src/features/profile/__tests__/ProfilePage.test.tsx` (`ac11 …` cases)
- [ ] AC12 Web gates: on an apartment, a personal-only profile shows `ProfileGate` linking to
  `/me/profile?section=looking&next=%2Flistings%2F…`; on a women-only room, a looking-only profile shows
  `RoomGate` linking to `?section=about&section=looking&next=…`; `profileHref` encodes `next` and repeats
  `section`. — `web/src/features/applications/__tests__/ApplySection.test.tsx`, `profile/__tests__/links.test.ts`

## Tests to write
- Integration (API): AC1–AC9 as named. Amend `test_profiles.py`'s existing room-section 422 test for the new
  message, and any test that asserts `SeekerProfileOut` with non-null types only (types, not values, change).
- Unit (web): AC10–AC12; `fixtures.ts` gains `personalOnlyProfile`.
- E2E (CI only, no local `make e2e`): this spec breaks and must update
  - `web/e2e/applications.spec.ts` `ac9_fill_profile_apply_withdraw`, line by line:
    `:58` `toHaveURL('/me/profile?next=…')` → `'/me/profile?section=looking&next=…'` (ProfileGate's new href);
    `:77` `ROOM.privacy` → `he.profile.about.privacy`; `:130` and `:187` `ROOM.switch` →
    `he.profile.about.switch`; `:185` `?section=room` → `?section=about`; `:186` heading `ROOM.title` →
    `he.profile.about.title`; the "switch off and save clears the section" step then checks the stored `gender`
    is `null` and the budget still `7500`; `:239` the RoomGate href expects `section=about`.
  - `web/e2e/likes.spec.ts` (:91-108): `ROOM.switch` → `he.profile.about.switch`, `ROOM.peopleVisible` →
    `he.profile.people.visible`; the about-me field now sits in "עליי".
  - `web/e2e/screens/profile.screens.ts`: `:138` `he.profile.room.switch` → `he.profile.about.switch`; `:175`
    `?section=room` → `?section=about`; `:179` `he.profile.room.title` → `he.profile.about.title`; regenerate
    its screenshots.
  - `web/e2e/helpers.ts::putProfile`: no change (it sends the whole looking part, still valid).
  No new e2e test: the API and unit tests cover the rules.

## Risks / open questions
- **Seekers-only fields for a personal-only account.** `_is_seeker` (0010b: seeker role or `has_profile`) now
  means "the looking part is filled" for a non-seeker account. A flatmate who filled only "עליי" does not see
  other flats' flatmate ages and answers. That is decision 13 as Gilad worded it (Section 7, 2026-11-13).
- **`flatmate_gender` sits in the looking part but still needs `gender`.** Section 7 puts it in the looking
  part; keeping today's rule that it needs `gender` keeps `room_fit` and `ck_seeker_profiles_room_section`
  unchanged (a preference without one's own gender would hide rooms through a half-rule nobody decided). The UI
  shows it in "מה מחפשים" only while "עליי" is on.
- **Emptying the looking part after acting.** Open applications and likes stay; the inbox shows such an
  applicant like a pre-Slice-6 one (no match, no housing summary), and people browse drops them. No 409 on the
  PUT: blocking an edit because of an old application would be a new rule.
- **Personal-only accounts see every room in search.** No match means no room fit, so a women-only room is not
  hidden from a man with only "עליי". He cannot apply or like it (both need the looking part, and the fit is
  checked there), which is today's rule for someone with no profile.
- **Downgrade deletes personal-only rows.** Unavoidable with NOT NULL; documented in the migration.
- **Verifier.** Round 1: 10 findings applied (2 blockers: the API rule now matches the looking-defaults CHECK for
  `flatmate_gender`; `liked_rooms` gets the looking-part filter so `GET /me/likes` cannot 500. 1 major on
  `NO_LOOKING`'s parking default, 1 major on unlisted e2e breaks, 6 minors: form mapping of NULL looking fields,
  unit tests that break, prop types, `likes.errors.roomSection` copy, the my-likes link, the duplicate heading).
- **Parallel specs.** `0010b` owns the auth swap on `/me/profile` and `_is_seeker`; if it merged without them,
  this spec does both (the Scope line says how). `0010e` adds the photo to "עליי" and must branch after this
  spec's page rework.

## Digest (filled by orchestrator after verification)
See `/digest`.
