---
id: 0007c
title: On a room application the owner's inbox shows the applicant's gender and age beside the match score and reasons, with the questionnaire answers, compared with the flat's, behind "עוד פרטים"; never on an apartment application
status: in-review
depends_on: [0007g, 0007d, 0006g]   # 0007g (specs/0007g-lifestyle-match-api.md, on 0007b): the lifestyle criterion, the inbox's match_columns(listing_type=Application.listing_type_at_apply), the owner-voice lifestyle reason copy; 0007b via 0007g: applications.listing_type_at_apply (migration 0010); 0007a via 0007b: the seeker's room section, MyListingOut.lifestyle; 0007d: features/lifestyle (keys, labels, topic, compareLifestyle); 0006g: the card this extends
reviewers: [code, qa, security, ux]   # security: gender, age and lifestyle answers (sensitive PII) shown to an owner, keyed on a snapshot so a type switch cannot expose apartment applicants, explicit field lists; qa: nulls, type switches both ways, live edits and clearing, answer comparison cases; ux: a new line and disclosure on the inbox card; no perf: three CASE columns in the same statement, no new join or statement (0006c AC4 / AC5 counts unchanged)
estimate: 1 coder run   # coder Opus/high (PII gate, Speed rule 6); see Risks
---

## Goal
After this ships, each applicant in the owner's inbox (`GET /listings/{listing_id}/applications` and the status
`PATCH`, `0004c` / `0006c`) carries `room: {gender, age, lifestyle} | null`. It is non-null only when two things
hold: the seeker applied to a **room** (`applications.listing_type_at_apply = 'room'`, `0007b`), and the seeker
has a room section now (`seeker_profiles.gender` not null, `0007a`).

On `/me/listings/:id/applicants` (`0004d`), each such card shows the applicant's gender and age beside `0006g`'s
match score, chips and "למה ההתאמה?" reasons. The age is left out when the applicant gave none. A "עוד פרטים"
disclosure holds the applicant's answers next to the flat's, with the differing ones marked.

An owner who switches an apartment to a room never sees the gender, age or answers of the people who applied to
the apartment. `0007g` keeps the score from revealing them too, and AC3 re-checks that in the inbox.

This serves PRODUCT.md "Rooms" ("On a **room** application the owner's inbox shows the applicant's gender, age,
score and reasons, with the questionnaire answers (and later details) behind a 'see more'; never on apartment
applications"). It is Dev Plan slice 7, part c (contract: the Slice 7 overview). The contract's room-inbox web half is merged
into this spec; the id `0007g` now belongs to `specs/0007g-lifestyle-match-api.md`. No artboard shows rooms. The card follows `Inbox.dc.html` / `InboxDesktop.dc.html` as `0006g` built it, and the new line and
panel reuse its chip, teal and amber tokens.

## Scope
**In (API):**
- `api/app/services/applications.py`:
  - Add a module-level `_ROOM_COLUMNS` beside `_PROFILE_COLUMNS`. It holds `SeekerProfile.gender`,
    `SeekerProfile.birth_year` and `SeekerProfile.lifestyle`, each wrapped in
    `case((Application.listing_type_at_apply == "room", <column>))` and labelled `room_gender`,
    `room_birth_year` and `room_lifestyle`.
  - The gate lives in the SQL, so an apartment application's room data never leaves the database.
    `flatmate_gender` is never selected, and neither is the `SeekerProfile` entity (NF2).
  - `room_gender` is NULL without a profile row (LEFT JOIN) and without a room section. `gender` is NULL exactly
    when there is no room section (`ck_seeker_profiles_room_section`, `0007a`).
  - `_applicants(listing_id)` selects `*_ROOM_COLUMNS` after `*_PROFILE_COLUMNS`. Its `match_columns` call stays
    as `0007g` delivers it (`listing_type=Application.listing_type_at_apply`, see Risks). Its docstring and the
    module docstring each gain a "rooms (0007c)" line.
  - `list_applicants` and `set_applicant_status` are unchanged: both read through `_applicants`, so the PATCH
    response carries `room` too.
  - `api/app/matching/score.py` is not touched.
- `api/app/schemas/application.py`:
  - New `ApplicantRoomOut {gender: SeekerGender, age: int | None, lifestyle: Lifestyle}`, with both types from
    `schemas/profile.py` (`0007a`). The fields are listed explicitly; there is no `birth_year` and no
    `flatmate_gender`.
  - `lifestyle` is the stored object: only answered keys, values 1–3, as `SeekerProfileOut.lifestyle`.
  - `ApplicantOut` gains `room: ApplicantRoomOut | None`, with no default, like `match` / `profile`.
  - The module docstring gains one line.
- `api/app/routers/applications.py`, in `_applicant_out(row)`:
  - `room = ApplicantRoomOut(gender=row.room_gender, age=…, lifestyle=row.room_lifestyle) if row.room_gender is
    not None else None`.
  - `age = dt.datetime.now(dt.UTC).year - row.room_birth_year if row.room_birth_year is not None else None`.
    This is the same year `0007a`'s `BirthYear` validator uses.
  - `room` is independent of `profile` / `match`, which still follow `row.household`.
  - The router docstring gains one line.
- `api/app/models/seeker_profile.py`: the docstring's readers list gains "from 0007c, the owner's inbox reads
  `gender`, `birth_year` (as an age) and `lifestyle` on room applications only".
- Tests: API Tests to write, including the `APPLICANT_KEYS` amendments and `0007a`'s inbox test.

**In (web):**
- `web/src/features/applicants/ApplicantCard.tsx` builds on `0006g`'s order: name row, `appliedAt`, summary,
  chips, message, the "למה ההתאמה?" disclosure, then actions. It adds two things, both rendered only when
  `applicant.room` is non-null:
  1. A **room line**, right after `applicants.appliedAt`: `applicants.room.line` ("{{gender}} · גיל {{age}}"),
     with `gender` = `t('profile.room.gender.<gender>')` (`0007d`). When `room.age` is null, the line is the
     gender word alone.
  2. A **"עוד פרטים" disclosure**, right after the "למה ההתאמה?" panel and before the actions row:
     - The button is `applicants.more`: a native `<button>` (so Enter and Space work), with `aria-expanded`,
       `aria-controls` set to the panel id `${headingId}-more`, and the same `disclosure` class, chevron and
       `aria-describedby={headingId}` as the `applicants.why` button.
     - The panel is always rendered, with `hidden={!open}`, as `0006g`'s "why" panel is, so `aria-controls`
       always resolves. It starts closed, and opening it moves no focus.
     - Its open state is card state, independent of "למה ההתאמה?", so both can be open at once.
     - The button shows for every room applicant, including one who answered nothing (decided, see Risks).
     - The panel is the extension point: a later spec adds its block inside `RoomDetails` and touches nothing
       else.
- `web/src/features/applicants/RoomDetails.tsx` (new): the panel's content, with props
  `{ room: ApplicantRoom; flat: LifestyleAnswers; flatIsRoom: boolean }`, rendering the answers block in UI.
- `web/src/features/applicants/ApplicantsPage.tsx` passes two props to each card, next to `0006g`'s `spots`:
  - `flatLifestyle`: `listing.lifestyle`, from the owner's own `MyListingOut` (`useMyListings`, `0007a`).
  - `flatIsRoom`: `listing.listing_type === 'room'`.

  It makes no new request.
- `web/src/features/applicants/api.ts`: `export type ApplicantRoom = NonNullable<ApplicantOut['room']>`.
- `web/src/features/applicants/__tests__/fixtures.ts`: `applicant()` adds `room: null` beside
  `match: null, profile: null`.
  - `make client` makes `room` a required nullable key, so `tsc` fails without this line.
  - It is the only `ApplicantOut` literal: `ApplicantsPage.test.tsx` builds every applicant through
    `applicant()`, on `main` and on `0006g`.
  - The listings fixture `listing()` needs no change: it already has `listing_type: 'apartment'`, and `0007a`
    adds `lifestyle: {}`. Tests override `listing_type` / `lifestyle`.
- `web/src/locales/he.json`: the keys in UI.
- `web/e2e/helpers.ts` and `web/e2e/inbox.spec.ts` (AC14):
  - `putProfile(page, overrides: Record<string, unknown> = {})` spreads `overrides` into the body. This is the
    same signature `0007f` adds; whichever spec merges second keeps the one definition.
  - The room listing is `postListing(page, street, {listing_type: 'room', flatmates_count: 2, lifestyle:
    {cleanliness: 1}})`. `postListing` already takes overrides, so no `postRoomListing` helper is needed.

**Out:**
- A snapshot of the room section at apply time. Like `0006c`'s profile, `room` is **live**: a seeker who edits
  or clears the section changes or removes it in every owner's inbox at once. Only the listing type is frozen at
  apply (`0007b`'s `listing_type_at_apply`, set again by a re-apply after a withdrawal).
- `flatmate_gender` (the seeker's flatmates preference) and `birth_year` itself are never shown to the owner.
- Editing answers on either side (`0007d`, `0007e`). Room facts on the search and listing pages (`0007f`).
- The owner-voice `lifestyle` copy: `OWNER.lifestyle`, `OWNER_SHORT.lifestyle`, `match.owner.lifestyle.*` and
  `match.owner.short.lifestyle.*` in `0006g`'s `web/src/features/match/reasons.ts`. It comes from `0007g` and is
  used as is; AC6 checks that it reaches a room applicant's card.
- A score breakdown by answer.
- Contact details, verification, and anything later that joins "עוד פרטים".
- No change to who can call the two endpoints, to the order (still `0006c`'s), or to the `GET /me/listings`
  counts.

**New dependencies:** none.

## Data
No migration. The spec reads two sets of columns:
- `0007a`'s `seeker_profiles.gender`, `birth_year` and `lifestyle`, and `listings.lifestyle` (on `MyListingOut`).
- `0007b`'s `applications.listing_type_at_apply`: NOT NULL, `'apartment' | 'room'`, written by every apply and
  re-apply.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /listings/{listing_id}/applications | as `0004c` (owner, own listing) | as `0006c` (`sort`) | 200 `list[ApplicantOut]` (+ `room: ApplicantRoomOut \| null`) | as `0006c` |
| PATCH | /listings/{listing_id}/applications/{application_id} | as `0004c` | as `0004c` | 200 `ApplicantOut` (+ `room`) | as `0004c` / `0005a` |

`room` is null on every apartment application, judged by `listing_type_at_apply` whatever the listing is now. It
is also null on a room application whose seeker has no room section now. Otherwise it is
`{gender: 'woman'|'man'|'other', age: int | null, lifestyle: {<answered keys>: 1|2|3}}`, with `age` = current
UTC year − `birth_year`, or null without one. Withdrawn applications stay invisible (`0004c`).

The web makes no new calls. It runs `make client` after the API change. `room.lifestyle` and
`listing.lifestyle` are passed to `compareLifestyle` as they are: the generated `{ [key: string]: 1 | 2 | 3 }`
is assignable to `LifestyleAnswers` (`0007d` finding 16(b)).

## UI
From `features/lifestyle` (`0007d`) this uses exactly:
- `LIFESTYLE_KEYS`, `type LifestyleAnswers`, and `compareLifestyle`, which returns `{ shared, same, differing }`;
- the copy `lifestyle.<key>.topic` and `lifestyle.<key>.answer.1|2|3`;
- `profile.room.gender.woman|man|other`.

**Answers block.** It is a `<ul>` inside the panel, with one `<li>` per key the applicant answered, in
`LIFESTYLE_KEYS` order (the contract's). Each row has:
- the row title `lifestyle.<key>.topic` (a neutral noun such as "ניקיון" or "אורחים", decided, see Risks);
- `applicants.room.theirs` ("תשובה שלהם: …") with the applicant's answer label;
- `applicants.room.flat` ("בדירה: …") with the flat's answer label, only when the flat answered that key;
- for a row in `compareLifestyle(applicant, flat).differing`, the amber `DifferIcon` from
  `features/match/icons.tsx` (already `aria-hidden`, as on `0006g`'s differ line) plus the visible text
  `applicants.room.differs`. Agreeing rows carry no marker. The marker is never
  colour alone.

When `shared > 0`, `applicants.room.summary` ("{{same}} מתוך {{shared}} תשובות זהות לדירה") sits above the list.

**Panel states:**
- The applicant answered nothing: `applicants.room.noAnswers` and no list. The button still shows.
- The flat answered nothing: the applicant's rows without "בדירה" lines or markers. When `flatIsRoom`,
  `applicants.room.noFlatAnswers` appears once above the list, as a hint to fill the flat's questionnaire in
  edit. When the listing has since become an apartment, there is no hint, because an apartment has no
  questionnaire.
- The page's own states (loading, error, empty, filter-empty) are `0004d`'s and unchanged; this spec adds none.
  Success is the card as described.

**RTL and layout:**
- Logical properties only (`ms-`, `ps-`, `text-start`).
- The room line and the rows wrap at 390 px.
- The button is at least 44 px high, with the `focusRing` and the chevron of `0006g`'s "למה ההתאמה?" button
  (same look).
- The age and gender are text, with direction from the page.

| key | value |
| --- | --- |
| `applicants.room.line` | {{gender}} · גיל {{age}} |
| `applicants.more` | עוד פרטים |
| `applicants.room.summary` | {{same}} מתוך {{shared}} תשובות זהות לדירה |
| `applicants.room.theirs` | תשובה שלהם: {{answer}} |
| `applicants.room.flat` | בדירה: {{answer}} |
| `applicants.room.differs` | שונה מהדירה |
| `applicants.room.noAnswers` | לא מילאו את השאלון |
| `applicants.room.noFlatAnswers` | שאלון הדירה עוד לא מולא. אפשר להוסיף אותו בעריכת המודעה |

All new copy is gender-neutral (plural "הם", no "הגיש/ה" forms). The FOLLOWUPS item on `0004d`'s gendered
status copy is not widened here.

## Acceptance criteria
**API fixtures.** These come from `0006c`'s `test_inbox.py`: `owner`, `gush_dan`, `_l0`, `_p0_body`, `_ok`,
`_by_id`, `_applicants`, `_set_status`, `_keys_and_numbers`, `TOP3`, `_match`, and the owner PATCH / read
helpers `_edit_listing`, `_owner_match` and `_patched_match` (`test_inbox.py:907-917`). Also used: `signup`,
`make_seeker` and `make_application` (`0007b` snapshots `listing_type_at_apply` from the listing).
- Every seeker gets a distinct display name: `_room_seeker(…, name, **room)` (Tests to write) and
  `make_seeker(db_engine, "s0@example.com", "S0")`, in the `test_ac1_owner_lists_applicants` style.
- Room sections and the flat's answers are written **through the API**: the seeker's `PUT /me/profile`
  `_p0_body(gush_dan, gender=…, birth_year=…, flatmate_gender=…, lifestyle=…)` and the owner's
  `PATCH /listings/{id}`. This proves that what the seeker saves is what the owner sees.
- Applies go through `seeker.post(f"/listings/{id}/applications", …)`, so `0007b` writes the snapshot.
- `Y` = `dt.datetime.now(dt.UTC).year`.
- W = a `signup` seeker named "W" with `_p0_body(gush_dan, gender="woman", birth_year=Y - 27,
  flatmate_gender="women", lifestyle={"cleanliness": 3, "night": 1})`.
- R = `_l0(db_engine, owner_id, gush_dan, listing_type="room", flatmates_count=2)`: gender preference `any`, no
  flat answers.

- [ ] AC1 Given R with applications from these seekers:
  - W.
  - M ("M"): `signup`, `_p0_body(gush_dan, gender="man")`, no birth year, no answers.
  - N ("N"): `signup`, plain `_p0_body`, no room section.
  - S0 ("S0"): `make_seeker`, no profile row, applied with `make_application(db_engine, R, s0)`.
  - X ("Gone"): `signup`, room section, applied then withdrawn.

  When the owner calls `GET /listings/{R}/applications`, Then:
  - Exactly W, M, N and S0 appear (by id); X's id and the name "Gone" are absent.
  - Every item's key set is `0006c`'s plus exactly `room`.
  - W `room` = `{gender: "woman", age: 27, lifestyle: {"cleanliness": 3, "night": 1}}`, with key set exactly
    `{gender, age, lifestyle}`.
  - M `room` = `{gender: "man", age: null, lifestyle: {}}`.
  - N `room` is null, while N's `match` and `profile` are not.
  - S0 `room`, `match` and `profile` are all null.
  - Walking the parsed body finds no key `birth_year` or `flatmate_gender` at any depth, and `Y - 27` is not
    among `_keys_and_numbers`' numbers (the birth year under any key).

  Test: `api/tests/test_inbox.py::test_ac1_room_applicants_show_gender_age_lifestyle`.
- [ ] AC2 Given AC1's R:
  - When the owner PATCHes W to `shortlisted`, Then the body equals W's item in a following list, `room`
    included.
  - When the owner PATCHes M to `declined`, Then the body's `room` equals M's. A declined room applicant keeps
    `room`, as `0006c`'s `profile` does.
  - Neither body has a `birth_year` or `flatmate_gender` key at any depth.

  Test: `test_inbox.py::test_ac2_patch_returns_room_fields`.
- [ ] AC3 (security: apartment → room) Given apartment A = `_l0(…)` and W (with `lifestyle={"night": 3}`)
  applied to it through the API, so the row's `listing_type_at_apply` is `'apartment'`. The owner's item for W
  has `room: null` and `match` = `_match(100, TOP3, None)` (the baseline).

  When the owner PATCHes A to `{"listing_type": "room", "flatmates_count": 2, "lifestyle": {"night": 1}}`, Then:
  - W's own `GET /listings/{A}` `match` has `differs: "lifestyle"` and score 80. This view is live; by `0007g`'s
    formula the score is round(0.8 × 100 + 20 × 0).
  - The owner's list item and a status PATCH body for W both have `room: null` and `match` equal to the
    baseline, with no `lifestyle` in `agrees` / `differs`.
  - Walking both bodies finds no key `gender`, `age`, `birth_year`, `flatmate_gender` or `lifestyle`, and
    neither body's text contains `"woman"`.

  When W withdraws and re-applies (A is now an `any` room, so `0007b`'s gate passes), Then:
  - the row's `listing_type_at_apply` is `'room'`;
  - W's `room` = `{gender: "woman", age: 27, lifestyle: {"night": 3}}`;
  - the owner's `match` equals W's own (80, differs `lifestyle`).

  The `match` assertions are an inbox-side regression check on `0007g`'s snapshot-keyed lifestyle criterion
  (its apartment → room AC), here end to end beside `room`.

  Test: `test_inbox.py::test_ac3_apartment_applicants_stay_hidden_after_switch_to_room`.
- [ ] AC4 (room → apartment) Given W applied to R through the API, and the owner has PATCHed R with
  `{"lifestyle": {"night": 3}}` (`_edit_listing`), so W's owner `match` = `_match(80, TOP3, "lifestyle")`: W's
  `night` 1 against the flat's 3 gives `m_lifestyle` 0.

  When the owner PATCHes R to `{"listing_type": "apartment"}` (`0007a` resets the room fields), Then:
  - W's item still has W's `room`, unchanged, because the seeker applied to a room: `room` is keyed on
    `listing_type_at_apply`, which is still `'room'`;
  - `match` = `_match(100, TOP3, None)`;
  - R's `GET /me/listings` item has `lifestyle: {}`. The `0007a` reset is what nulls the criterion.

  Test: `test_inbox.py::test_ac4_room_applicants_keep_room_after_switch_to_apartment`.
- [ ] AC5 (live; clearing) Given W applied to R:
  - When W calls `PUT /me/profile` with `_p0_body(gush_dan, gender="woman", birth_year=Y - 30,
    lifestyle={"guests": 2})`, Then the owner's list shows W `room` = `{gender: "woman", age: 30, lifestyle:
    {"guests": 2}}`.
  - When W then PUTs the plain `_p0_body(gush_dan)`, which clears the room section ("PUT replaces", `0007a`),
    Then:
    - W's `room` is null in the list and in a status PATCH body;
    - `match` and `profile` are still set;
    - walking both bodies finds no `gender` key, and neither text contains `"woman"`.

  Test: `test_inbox.py::test_ac5_room_fields_follow_profile_edits_and_clearing`.

**Web.** Vitest and Testing Library, with `features/applicants/__tests__/fixtures.ts` (extended with `room`) and
the listing fixture with `lifestyle` / `listing_type` overrides.
- [ ] AC6 Given a room applicant with `room {gender: "woman", age: 27, lifestyle: {}}` and a `match` score of
  88, Then the card shows "התאמה 88%" and the line "אישה · גיל 27" right after the `applicants.appliedAt` line.

  Given a second room applicant with `match(80, ['budget', 'move_in', 'area'], 'lifestyle')`, a `room` and a
  profile, Then:
  - the amber chip reads `match.owner.short.lifestyle.differ`;
  - after `applicants.why` is opened, the panel has the line `match.owner.lifestyle.differ`.

  Both keys are `0007g`'s owner-voice copy.

  Test: `web/src/features/applicants/__tests__/ApplicantsPage.test.tsx::ac6_room_gender_age`.
- [ ] AC7 Given `room {gender: "other", age: null, …}`, Then the line is "אחר" only, with no "גיל" and no "·".

  Test: `ApplicantsPage.test.tsx::ac7_age_omitted`.
- [ ] AC8 Given an apartment applicant (`room: null`, with `match` and `profile` as in `0006g`'s AC3 / AC4), Then
  the card has no room line and no `applicants.more` button, and its buttons are exactly `0006g`'s. A room
  applicant with `room: null` is the same.

  Test: `ApplicantsPage.test.tsx::ac8_non_room_cards_unchanged`.
- [ ] AC9 Given a room applicant:
  - When the card first renders, Then `applicants.more` has `aria-expanded="false"` and its panel is not
    visible (`hidden`).
  - When the owner focuses it and presses Enter, Then `aria-expanded="true"`, the panel whose id equals the
    button's `aria-controls` is shown, and focus stays on the button.
  - Space closes it.

  Test: `ApplicantsPage.test.tsx::ac9_more_disclosure_keyboard`.
- [ ] AC10 Given applicant answers `{cleanliness: 3, guests: 2, night: 1}` and the flat's
  `{cleanliness: 1, guests: 2}` on a room listing, When the owner opens the panel, Then:
  - there are three rows in `LIFESTYLE_KEYS` order, titled `lifestyle.cleanliness.topic`,
    `lifestyle.guests.topic` and `lifestyle.night.topic`;
  - cleanliness shows both answer labels and `applicants.room.differs`;
  - guests shows both answer labels and no marker;
  - night shows only "תשובה שלהם" and no marker;
  - the summary reads "1 מתוך 2 תשובות זהות לדירה".

  Test: `ApplicantsPage.test.tsx::ac10_answers_compared_with_flat`.
- [ ] AC11 Empty answers:
  - Given an applicant with `lifestyle: {}`, Then the `applicants.more` button is still there, and the panel
    shows `applicants.room.noAnswers` and no list.
  - Given the flat's `lifestyle: {}` on a room listing, and an applicant who answered, Then the rows show
    without "בדירה" lines or markers, and `applicants.room.noFlatAnswers` appears once.
  - Given the same applicant on a listing that is now an apartment (`listing_type: 'apartment'`), Then the rows
    show and `applicants.room.noFlatAnswers` is absent.

  Test: `ApplicantsPage.test.tsx::ac11_empty_answers`.
- [ ] AC12 Given a `submitted` room applicant with the panel open, When the owner shortlists and the PATCH
  response carries the same `room`, Then:
  - the line and the open panel are still there;
  - focus is on the `<h2>` (`0004d`'s rule);
  - `applicants.more` and `applicants.why` toggle independently, and both can be open at once.

  Test: `ApplicantsPage.test.tsx::ac12_patch_and_independent_disclosures`.
- [ ] AC13 The panel and the line contain no element with the applicant's contact details and no "₪" amount. A
  declined room applicant still has the line and the button.

  Test: `ApplicantsPage.test.tsx::ac13_declined_room_card`.
- [ ] AC14 (e2e) Given `make dev` is up, When `ac12_shortlist_chat_decline` (`0005b`, extended by `0006g`) has
  run its seeker's `GET /me/applications` checks, which expect exactly one (declined) application, Then the
  following steps run after those checks and before `seekerContext.close()` (`0006g`'s
  `web/e2e/inbox.spec.ts:125-131`):
  1. The owner posts a second listing as a room: `postListing(…, {listing_type: 'room', flatmates_count: 2,
     lifestyle: {cleanliness: 1}})`.
  2. The same seeker re-saves the profile with a room section: `putProfile(seekerPage, {gender: 'woman',
     birth_year: <current UTC year − 27>, lifestyle: {cleanliness: 3}})`.
  3. The seeker applies to the room through the API.
  4. The owner opens `/me/listings/<room id>/applicants` and sees the room line. The expected text is built as
     `he.applicants.room.line.replace('{{gender}}', he.profile.room.gender.woman).replace('{{age}}', '27')`,
     like the file's `withScore`.
  5. The owner opens `applicants.more` and sees the `applicants.room.differs` text.
  6. Back on `/me/listings/${id}/applicants` (the apartment), the declined card has no `applicants.more` button.
     This is the snapshot gate end to end, after the seeker gained a room section.

  There is no new `test()` and no new signup (the e2e OTP budget). CI e2e is off (CLAUDE.md rule 7), so the test
  runs locally with `make e2e` on the final head, and the result is reported in the digest.

  Test: `web/e2e/inbox.spec.ts::ac12_shortlist_chat_decline` (extended).
- [ ] NF1 Lint, tests and builds:
  - `make lint` is clean: ruff, mypy --strict, and web eslint / prettier / `tsc` after `make client`.
  - `make client` regenerates `schema.d.ts` with `ApplicantRoomOut` and `ApplicantOut.room`.
  - `make test` is green for api and web, `make i18n-check` and `make build-web` are clean, and `make e2e` is
    green locally on the final head (reported in the digest).
  - Every existing `test_inbox.py` / `test_chat.py` / `ApplicantsPage` test passes with the amendments in Tests
    to write.
  - `0006c`'s statement counts hold as written: the list takes 3 statements, a shortlist PATCH 4, and any other
    PATCH 3. The tests are `test_ac4_still_three_statements`, `test_ac5_patch_returns_scored_applicant` and
    `test_chat.py::test_ac1_shortlist_opens_one_conversation`.

  Checked by: CI `api` and `web`, plus the local `make e2e`.
- [ ] NF2 Privacy:
  - `ApplicantRoomOut` lists exactly `gender`, `age` and `lifestyle`.
  - The inbox query selects `gender`, `birth_year` and `lifestyle` by name, and only inside the
    `listing_type_at_apply = 'room'` CASE. It never selects `flatmate_gender` or the `SeekerProfile` entity.
  - `birth_year` never reaches a response (age only).
  - The owner-side lifestyle criterion uses the type at apply (`0007g`; AC3 regression).

  Checked by: the AC1, AC3 and AC5 key walks, plus the security reviewer.
- [ ] NF3 Accessibility:
  - The disclosure is a native `button` with `aria-expanded` / `aria-controls` (always resolving: the panel is
    rendered with `hidden`) and `aria-describedby={headingId}`, 44 px high, with a visible focus ring.
  - The differing marker has text, and icons are `aria-hidden`.
  - The room line is plain text, in reading order after the name row.

  Checked by: the ux reviewer.

## Tests to write
**API.** Add AC1–AC5 to `api/tests/test_inbox.py` under a `# --- 0007c` header, and update the module
docstring. Two new helpers keep each test short:
- `_room_seeker(client, outbox, email, area, name, **room)`: `signup` with display name `name`, plus
  `PUT /me/profile` with `_p0_body(area, **room)`;
- `_apply(seeker, listing_id)`.

The owner's listing PATCHes and reads in AC3–AC5 reuse `_edit_listing`, `_owner_match` and `_patched_match`
(`test_inbox.py:907-917`); no new helper is added for them.

Each test signs up at most 5 users, the owner included (OTP IP limit 10 per 15 min, `redis_clean`).

Amendments, checked against `main` and the `0007a` / `0007b` / `0007g` specs:
- (a) `test_inbox.py` `APPLICANT_KEYS` gains `"room"`. It is used by `test_ac1_owner_lists_applicants`,
  `test_ac4_status_transitions`, `test_ac1_applicants_sorted_by_match` and
  `test_ac5_patch_returns_scored_applicant`. Their seekers have no room section and apply to apartments, so
  `room` is null and nothing else changes.
- (b) `api/tests/test_chat.py` `APPLICANT_KEYS` gains `"room"`. It appears in four
  `set(response.json()) == APPLICANT_KEYS` assertions in `test_ac1_shortlist_opens_one_conversation`. The
  statement counts there do not change, because the new columns join the existing SELECT.
- (c) `0007a`'s `test_inbox.py::test_ac8_room_section_never_outside_room_field` keeps passing unchanged. It
  ignores the `room` key, and its other checks still hold: no `birth_year` or `flatmate_gender` key at any
  depth, and `Y - 30` is not among the numbers, because the age is 30, not the birth year.
- (d) `0007g`'s inbox tests (a room applicant's `match` includes lifestyle; an apartment applicant's never does
  for the owner) keep passing unchanged: they compare `match` only.
- (e) No other test compares `ApplicantOut` keys; `test_chat_events.py` and `test_applications.py` were
  checked.

**Web, component.** Add AC6–AC13 to `ApplicantsPage.test.tsx`. The answer cases may render `RoomDetails` directly
if that is shorter. The only fixture that changes is `fixtures.ts` `applicant()` (`room: null`). The listings
fixture `listing()` is used as is, with `listing_type` / `lifestyle` overrides.

**Web, e2e.** Extend `web/e2e/inbox.spec.ts` `ac12_shortlist_chat_decline` (AC14), with the `putProfile`
overrides in `helpers.ts`. The six steps go after the seeker's `GET /me/applications` checks
(`toHaveLength(1)`) and before `seekerContext.close()`, so those checks still see only the declined application.
`0006g`'s declined-card check (no `applicants.actions.*` buttons) still holds, because the room section is added
to the profile only after that step. The test runs locally with `make e2e` (CI e2e is off).

## Risks / open questions
- **Lifestyle probe through the score (security; delivered by `0007g`).** Suppose the lifestyle criterion
  followed the listing's **live** type. An owner could switch an apartment to a room, set one flat answer, and
  read an apartment applicant's answer from the score or `differs`, one answer per edit. `0007g` prevents this
  by scoring the inbox with the type the seeker applied to (`match_columns(listing_type=…)` with
  `Application.listing_type_at_apply`). This spec adds no code for it; AC3 is the inbox-side regression check.
  The cost is that after a type switch, the owner's score for apartment applicants leaves out lifestyle while
  the seeker's own live view includes it. The two sides already diverge the same way after a price or area edit
  (B1).
- **Room → apartment keeps `room`.** The contract keys `room` on `listing_type_at_apply`. People who applied to
  the room keep showing gender, age and answers after the owner turns it into an apartment; they consented when
  they applied to a room. AC4 pins the API behaviour: `room` stays, and the lifestyle part of the score drops
  out because `0007a` resets the flat's answers. The card then hides the "fill the flat's questionnaire" hint
  (AC11).
- **Live, and visible after a decline.** Like `0006c`'s profile, `room` follows the seeker's current room
  section. Every owner of a room the seeker applied to sees it, including after a decline. That includes the
  case where the seeker filled the section only after applying to an `any` room. `0007d`'s profile copy says so
  (contract: "owners of rooms the seeker applies to see gender, age and answers"). Clearing the section hides it
  everywhere at once (AC5).
- **Age is "age this year"** (current UTC year − birth year), as the contract defines it; only the year is
  stored. It reads one year high until the birthday, and it changes at UTC New Year, not local New Year. It is
  shown as is.
- **Decided (row title):** each answer row is titled `lifestyle.<key>.topic`, the neutral noun `0007d` defines
  ("ניקיון", "אורחים", …). The flat-side question was not used, because it reads oddly above "תשובה שלהם".
- **Decided (disclosure for every room applicant):** "עוד פרטים" also shows for a room applicant who answered
  nothing, and the panel says so (`applicants.room.noAnswers`). The owner learns that this applicant skipped
  the questionnaire, and "later details" will join the panel.
- **Why one coder run fits.** The API half is small: no migration, no new query or statement, three CASE columns,
  one schema, one router line, and five integration tests. The web half is one new component, a card edit,
  eight keys, eight component tests and one e2e extension, which is the size the former room-inbox web draft
  was alone. It builds on the same branch right after `make client`, and the owner-voice `lifestyle` copy
  already exists (`0007g`). The verifier counted it within one run, with no split. If the run runs short, the
  clean cut is the API commit (with the `fixtures.ts` line) first, then the web.
- No open product questions.

## Verifier findings — one round, 8 findings, all applied
Orchestrator rulings, applied with the findings below:
- Gilad split `0007b`. The lifestyle criterion, the inbox's `match_columns(listing_type=…)` and the owner-voice
  `lifestyle` copy now come from `0007g` (`specs/0007g-lifestyle-match-api.md`); `listing_type_at_apply` stays
  with `0007b`. So `depends_on` is `[0007g, 0007d, 0006g]`, and findings 2 and 8 cite `0007g`.
- Finding 4: `0007a`'s AC8 is now `test_ac8_room_section_never_outside_room_field` and ignores `room`, so this
  spec does not change it and no longer renames it.
- e2e: CI e2e is off (CLAUDE.md rule 7). `make e2e` runs locally on the final head and is reported in the
  digest.

Original summary: 0 blocker, 2 major, 6 minor.
Verdict: **reject as written** (stays `draft`) on findings 1 and 2. Both are spec-text edits; no re-scope. **No
split**: 2 changed endpoints, 0 tables, 1 screen; API = 3 CASE columns + 1 schema + 1 router line + 5 tests, web = 1
component + a card edit + 8 component tests + 1 e2e extension. That is within one run. Checklist lines 3–7, 9 and 10
pass, and so does line 8 (`code, qa, security, ux` is right; no perf, since there is no new join or statement). No
contradiction with PRODUCT.md "Rooms", "Applications" or "Matching": a room → apartment switch keeps `room`, which
is consistent with "on a room application", because the snapshot defines what a room application is.

Checked against the code and found correct (no change needed):
- The endpoints and the code paths. `GET /listings/{listing_id}/applications` and its `PATCH` are at
  `api/app/routers/applications.py:180-232`. Both responses go through `_applicant_out` (`:150-177`). Both service
  paths read through `_applicants` (`api/app/services/applications.py:232-256`, used at `:273` and `:348`).
  `_PROFILE_COLUMNS` is at `:221`.
- `explain_row` reads `row._mapping` by the `m_*`/`f_*` labels only (`api/app/matching/score.py:154-177`), so extra
  `room_*` labels are harmless.
- `ApplicantOut.match` / `profile` have no default (`api/app/schemas/application.py:114-115`), so a required,
  nullable `room` follows them. The fixtures in `test_inbox.py` exist: `owner` `:113`, `_applicants` `:65`,
  `_set_status` `:71`, `TOP3` `:565`, `_l0` `:572`, `_p0_body` `:602`, `_match` `:612`, `_ok` `:624`, `_by_id`
  `:629` and `_keys_and_numbers` `:633`. `gush_dan` / `signup` / `make_seeker` / `make_application` are in
  `api/tests/conftest.py:175/188/222/271`.
- The `APPLICANT_KEYS` call sites in amendment (a) are exact (`test_inbox.py:165, :368, :679, :821`). So is (b): all
  four are in `test_chat.py::test_ac1_shortlist_opens_one_conversation`, at `:250, :263, :268, :276`. For (e),
  `applicant_name` occurs in no other api test. Statement counts hold (`test_inbox.py:758-787`, `:788-838`;
  `test_chat.py:251,264`). `test_ac3_applicants_is_three_statements` (`:273`) also holds.
- The SQL gate is sufficient. The three columns are selected only inside `CASE WHEN listing_type_at_apply =
  'room'`, the router builds `room` only from those labels, and the score probe is closed by `0007b`'s
  `listing_type=` keyword. Sort, counts and chat read none of the new columns. Withdrawn rows are excluded at
  `services/applications.py:254`. The type-switch cases are covered both ways: AC3 covers apartment → room, plus a
  re-apply that re-snapshots. AC4 covers room → apartment. Declined (AC2/AC13) and cleared (AC5) are covered. AC3's
  score of 80 holds under all three of `0007b`'s Q1 formulas.
- On the web, every `ApplicantOut` literal goes through `applicant()`
  (`../rent-app-0006g/web/src/features/applicants/__tests__/fixtures.ts:10-23`). The cards are keyed by
  `applicant.id` (`ApplicantsPage.tsx:256-258`), so the open state survives a PATCH (AC12). Focus goes to the `<h2>`
  (`:95-98`). The `headingId`-based panel id pattern exists (`ApplicantCard.tsx:54`). None of the new i18n keys
  collides (`applicants` has no `more` or `room`). `0007d` (now `verified`) defines `LIFESTYLE_KEYS`,
  `compareLifestyle`, `lifestyle.<key>.topic|answer.n` and `profile.room.gender.*` = אישה / גבר / אחר
  (`specs/0007d-room-profile-web.md:23-27, :117, :129-142`). The new Hebrew copy is gender-neutral. The spec file
  has no invisible bidi characters.

1. (major) **AC4's `match` assertion is vacuous.** AC4 reuses `R`, which is defined with "no flat answers"
   (`:193-194`). So W's owner-side `match` is `_match(100, TOP3, None)` both before and after the room → apartment
   switch. The claim "the flat's answers are gone, so `m_lifestyle` is NULL" (`:247`) tests nothing, and the
   room → apartment direction of the score is never exercised. **Fix (AC4):**
   - Before the switch, the owner PATCHes R with `{"lifestyle": {"night": 3}}` (`_edit_listing`,
     `test_inbox.py:907`). Assert that W's owner `match` = `_match(80, TOP3, "lifestyle")`: W's `night` 1 vs 3 gives
     `m_lifestyle` 0.
   - Then PATCH `{"listing_type": "apartment"}`. Assert W's `room` is unchanged and `match` = `_match(100, TOP3,
     None)`.
   - Also assert R's `GET /me/listings` item has `lifestyle: {}`: the `0007a` reset is what nulls the criterion.
2. (major) **No spec delivers or tests the owner-voice `lifestyle` reason.** The Out line "the `lifestyle` reason
   already reaches the card through `0006g`'s chips and reasons (`0007b`)" (`:107-108`) is false. Three facts:
   - `0006g`'s `OWNER` / `OWNER_SHORT` are `Record<Criterion, …>` (`../rent-app-0006g/web/src/features/match/reasons.ts:225,
     :271`), and `OwnerShort` returns `string` (`:192`).
   - `0007f` hands "the owner side of the `lifestyle` criterion and the inbox" to the former `0007g`, which is now
     this spec (`specs/0007f-room-search-web.md:84`).
   - `0007b`'s verifier finding 2 (`specs/0007b-room-search-api.md:618-635`) adds owner stubs with final copy:
     `match.owner.lifestyle.agree|differ` and `match.owner.short.lifestyle.agree|differ`. It asks this spec to name
     them.

   As written, nothing on the web tests that a room applicant whose `match.differs` is `lifestyle` shows a reason.
   PRODUCT.md "Rooms" requires the "score and reasons" on room applications. **Fix:**
   - Replace the Out bullet with: "The owner-voice `lifestyle` copy (`OWNER.lifestyle`, `OWNER_SHORT.lifestyle`,
     `match.owner.lifestyle.*`, `match.owner.short.lifestyle.*`) comes from `0007b` (its finding 2) and is used as
     is."
   - Extend AC6 (`ac6_room_gender_age`) with a second applicant: `match(80, ['budget','move_in','area'],
     'lifestyle')`, a `room`, and a profile. Assert the amber chip reads `match.owner.short.lifestyle.differ`, and
     that after `applicants.why` the panel has the line `match.owner.lifestyle.differ`.
3. (minor) **AC1's "X's name is absent" cannot pass with the helper as specified.** `signup` defaults
   `display_name` to "נועה" (`conftest.py:189`), and `_room_seeker(client, outbox, email, area, **room)` (`:358-359`)
   takes no name. So W, M, N and X all share one name. **Fix:**
   - Change the signature to `_room_seeker(client, outbox, email, area, name, **room)`, with names W "W", M "M", N
     "N" and X "Gone" (the `test_ac1_owner_lists_applicants` style, `test_inbox.py:142-170`), and
     `make_seeker(db_engine, "s0@example.com", "S0")`.
   - Add to AC1: "`Y - 27` is not among `_keys_and_numbers`' numbers" (the birth year under any key).
   - Reuse `_edit_listing` / `_owner_match` / `_patched_match` (`test_inbox.py:907-917`) for the owner PATCHes and
     reads in AC3–AC5 instead of new helpers.
4. (minor) **Amendment (c) clashes with `0007a` finding 8.** That finding (`specs/0007a-room-inputs-api.md:442-452`)
   renames `0007a`'s AC8 to `test_ac8_room_section_never_outside_room_field` and makes it exclude `room`, so it stays
   true here. This spec's (c) (`:372-380`) renames the same test to `test_ac8_room_section_only_in_room_field`.
   **Fix:** if the orchestrator applies `0007a` finding 8, rewrite (c) as "`0007a`'s
   `test_ac8_room_section_never_outside_room_field` keeps passing unchanged; add one assertion to it: `S1`'s `room`
   = `{gender: "woman", age: 30, lifestyle: {"night": 3}}`. Its `make_application` row snapshots `'room'`
   (`0007b`'s fixture default)". If it does not, keep (c) as written. Use one name in both specs either way.
5. (minor) **The disclosure differs from `0006g`'s pattern.** In `0006g` the panel is always in the DOM with
   `hidden`, so `aria-controls` always resolves (`ApplicantCard.tsx:189-191`). AC9's "its panel is absent"
   (`:277`) forces a dangling IDREF, or a test that fails on the house pattern. The button also lacks `0006g`'s
   `aria-describedby={headingId}` (`:169`). Without it, every card's "עוד פרטים" button has the same accessible
   description in a list of cards. **Fix:**
   - Scope web item 2: "the same `disclosure` class, chevron and `aria-describedby={headingId}` as the
     `applicants.why` button; the panel is always rendered, with `hidden={!open}`".
   - AC9: "its panel is not visible (`hidden`)" in place of "absent".
   - Answers block (`:146`): the marker is `DifferIcon` from `features/match/icons.tsx` (already `aria-hidden`).
6. (minor) **AC14's insertion point is wrong as worded.** The "decline step" is followed by seeker checks that
   assert `expect(items).toHaveLength(1)` on `GET /me/applications` (`../rent-app-0006g/web/e2e/inbox.spec.ts:125-130`).
   A room application added "after the decline step" makes that assertion fail. **Fix (AC14 and Tests to write):**
   - Append the five steps after `inbox.spec.ts:130` and before `seekerContext.close()`.
   - Build the expected line with `.replace('{{gender}}', he.profile.room.gender.woman).replace('{{age}}', '27')`,
     like the file's `withScore`.
   - Add a sixth step that costs nothing: back on `/me/listings/${id}/applicants` (the apartment), the declined card
     has no `applicants.more` button. This is the snapshot gate end to end, after the seeker gained a room section.
7. (minor) **Two stale web lines.**
   - API section (`:132-133`): "the coder narrows it to `LifestyleAnswers` once" is unnecessary. The generated `{
     [key: string]: 1 | 2 | 3 }` is assignable to `LifestyleAnswers` both ways
     (`specs/0007d-room-profile-web.md:252-254`, finding 16(b)). **Fix:** "`room.lifestyle` and
     `listing.lifestyle` are passed to `compareLifestyle` as is."
   - Scope fixtures (`:92-93`): `listing()` already has `listing_type: 'apartment'`
     (`web/src/features/listings/__tests__/fixtures.ts:24`), and `0007a` adds `lifestyle: {}`. **Fix:** "`listing()`
     needs no change (`0007a` adds `lifestyle`); tests override `listing_type` / `lifestyle`."
8. (minor) **Frontmatter.**
   - `0007b`'s verifier finding 1 proposes a split (`specs/0007b-room-search-api.md:605-617`), and its consumers
     move to `depends_on: [0007b2]`. If it is split, change `depends_on` to `[0007b2, 0007d, 0006g]`. The comment
     already names `listing_type_at_apply` and the keyword, which both come from `0007b1`/`0007b2`.
   - Under Speed rule 6, the API half gates PII, so add to `estimate:`: "coder Opus/high (PII gate)".

## Digest (filled by orchestrator after verification)

    Spec 0007c - Room applicants in the owner inbox (API + web)   (verified, Slice 7, depends on 0007g, 0007d, 0006g; merged from 0007c + 0007g-web at Gilad's word)
    What a user can do after this: on a room application the owner sees the applicant's gender and age beside the
             score and reasons, and a "עוד פרטים" panel compares the applicant's questionnaire answers with the
             flat's; apartment applications never show any of it, even if the listing later becomes a room.
    Decisions I need from you: none new. Note: room data follows the seeker's current profile, so it stays
             visible to owners of rooms they applied to (incl. after a decline) until they clear their room section.
    KPIs this slice moves: owner shortlist rate on room listings.
    Acceptance targets: NF1 lint/test/i18n/build clean + make e2e green locally - NF2 gender/age/answers only on
             room applications, keyed on the type at apply time - NF3 disclosure is a button with aria-expanded /
             aria-controls, keyboard-operable.
    Risks: PII shown to owners - mitigation: the SQL gate selects it only for room applications; security reviewer;
             type switches tested both ways.
    Reviewers: code, qa, security, ux   Estimated: 1 coder run (Opus/high, PII gate), 1 review round
    Links: specs/0007c-room-inbox.md - PRODUCT.md "Rooms", "Applications" - design/screens-v1/Inbox.dc.html, InboxDesktop.dc.html
