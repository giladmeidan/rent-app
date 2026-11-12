---
id: 0009b
title: Counts read as correct Hebrew for one, two and many, every line uses the app's gender-neutral forms, and a room listing is described as a room
status: in-progress
depends_on: []
reviewers: [code, qa, ux]   # ux: the wording tables and the conventions; qa: one/two/many on every count screen; no security or perf: text only, no API
estimate: 1 coder run   # coder Opus/medium (verifier: the checker is CI-gating AST work; Speed rule 6 "when in doubt, the stronger one")
---

> **Brand kit amendment (orchestrator, 2026-11-12, no verifier re-run):** `design/brand/` (README.md, tokens.json) wins over the artboards and over any older wording below for colour, type (Fredoka for display/h1/h2, Rubik for the rest), radii, no card shadows, the name homie / הומי, the mascot and the voice (no slash forms: plural, infinitive or noun; action-noun buttons; errors say "what happened. what to do."). Token and kit names are those of 0009d. Where this spec still names a teal token, Heebo or a slash form, the builder applies the brand equivalent.

## Goal
After this ships, every count in the app reads as correct Hebrew for 1, 2 and more: "חדר אחד", "נותר תו
אחד", "2 חדשות". It works through i18next's native plural forms for `he`, and `make i18n-check` fails on a
plural that is missing a form. Lines that spoke to or about a person in the masculine only use the app's
neutral forms. A room listing reads "מרוהט" and "חדר ב־4 חדרים" on every screen.

This serves PRODUCT.md "Language" (Hebrew only at launch, i18n from the first commit) and Dev Plan slice 9
("Landing + polish"), part b. No artboard changes: the artboards' copy is the Hebrew this spec corrects.

This file was split by its author before verification (size): copy that needs a component change before it
can show (offline vs server error, OTP hints, the date read-back, `not_withdrawable`, `Retry-After`, the
owner's apply section, the inbox action error, the owner parking chip, the people "why" lines, the join-flat
links, the empty `/chat` for a flatmate) is `0009f`, which builds on this spec's checker.

## Conventions
The tables follow these rules. The `PRODUCT.md` row proposed under Risks carries them forward.
1. **One addressed person**: slash forms, with the base form first and its final letter kept: "את/ה",
   "מחפש/ת", "מעדיף/ה", "תגיש/י".
   *For this spec's values the brand amendment replaces this rule (Gilad 2026-11-12): no slash forms;
   the plural, an infinitive or a noun instead. The rows marked "brand voice" below carry his wording;
   the other slash forms in `he.json` are a FOLLOWUPS sweep.*
2. **Instructions**: the plural imperative or "אפשר ל…": "נסו שוב", "שלחו לי קוד", "אפשר לנסות שוב".
3. **The other side, inside a sentence**: plural, e.g. "בעלי הדירה מחפשים", "מבקשים כניסה ב־…". A role
   label for one named person stays "בעל/ת הדירה" (`chat.roles.owner`). Hebrew's generic "מי ש…", "כל מי
   ש…" and "אף אחד" with a masculine verb is the language's gender-neutral generic, not an address to one
   person, so it stays (`flatmates.invite.hint`, `…onceWarning`, `listings.room.flatmatesHint`,
   `applications.form.hint`, `flatmates.list.empty`).
4. **Buttons and states**:
   - a state that reads as the person acting is a verbal noun ("בשליחה…");
   - a state that describes the page may keep the masculine present ("טוען…", `common.loading`,
     unchanged);
   - buttons are verbal nouns ("שמירה", "שליחת המועמדות"), except a call to action copied from an artboard,
     which keeps the artboard's words ("הגש/י מועמדות", `applications.apply`, `Listing.dc.html`).
     *Brand amendment (Gilad 2026-11-12): `applications.apply` is the verbal noun "הגשת מועמדות" too.*
5. **Counts**:
   - one is a word ("חדר אחד", "מודעה אחת"), 2 and up are digits;
   - a count after a colon, a "·" or in parentheses needs no plural form ("שיחות חדשות: 3", "הכול (3)").
6. **Typography**:
   - A maqaf (U+05BE) joins a one-letter prefix to a digit, or to a variable whose value can start with a
     digit or a Latin letter ("ב־{{date}}", "ל־{{max}}", "ב־{{rooms}}").
   - A variable that is always a Hebrew word takes the prefix directly ("ל{{who}}", "ל{{household}}",
     "ל{{label}}").
   - Write "הכול" in full spelling (as `search.any`).
7. **A room is a room**: a room listing uses masculine adjectives ("מרוהט") and the "חדר ב־N חדרים" title.
   Search lists both types, so its counts use a word that covers both (Q1).

## Scope
**In:**

### 1. The checker learns plurals (`web/scripts/i18n-check.mjs`)
Facts checked on this machine on 2026-11-12:
- i18next 27.0.1 (`web/package.json`) resolves `he` to the suffixes `_one`, `_two` and `_other`
  (`i18next.services.pluralResolver.getSuffixes('he')`).
- Node 22.23.2 (`web/.nvmrc` 22, `infra/Dockerfile.web`; ICU 78.2, CLDR 48) gives
  `new Intl.PluralRules('he').resolvedOptions().pluralCategories` = `['one', 'two', 'other']`. 0, 3, 11, 20,
  100 and 1.5 select `other`; CLDR 42 dropped Hebrew `many`.
- i18next also uses a `_zero` form for `count: 0` when the key has one.
- A family without `_two` renders the **raw key** for `count: 2`. With only `c_zero` / `c_one` / `c_other`,
  `t('c', { count: 2 })` returned `"c"`. That is why the checker must fail on a missing form.

Rules added:
- **P1 Plural family.** A catalogue leaf whose last path segment ends in `_zero`, `_one`, `_two`, `_few`,
  `_many` or `_other` is a plural form of its base path (`applications.count_one` → `applications.count`):
  - every family has each category of `new Intl.PluralRules('he').resolvedOptions().pluralCategories`, read
    at run time, not hard-coded;
  - `_zero` is optional; `_few` and `_many` are errors ("he never selects it");
  - the base path must not also exist as a string or an object. i18next falls back to a base string last,
    so a base string would hide a missing form, and a base object breaks `t(base)`.

  Each problem prints `locales/he.json: <message>` and makes the run fail.
- **P2 Plural calls.** `t('base', …)` with a family's base is a known key. It is an error,
  `plural key 'base' called without count`, when there is no second argument, or when the second argument is
  an object literal with neither a `count` property nor a spread. A non-literal second argument (a
  variable) passes.
- **P3** `t('plain', { count })` on a plain string key passes, as today: a count after a colon.
- **P4 `.ts` files.** `.ts` files under `srcDir` are scanned for `t()` keys (the missing-key check and P2),
  except `.d.ts`, tests and `locales/`. They are not scanned for hardcoded copy, which stays `.tsx` only.
  `cardTitle.ts`, `rooms/flatmates.ts` and `match/reasons.ts` make plural calls.
- **FOLLOWUPS line 11.** The arguments after the key are visited, so copy in
  `t('k', { defaultValue: 'two words' })` is a hit.
- **FOLLOWUPS line 12.** `LATIN_WORD` accepts an apostrophe inside a word and wrapping brackets (`don't`,
  `(beta)`).
- **FOLLOWUPS line 13, conditional keys only.** `t(c ? 'a.b' : 'c.d', …)` checks both literal branches,
  each against the missing-key check and P2.
  `t(variable)` and template-literal keys stay unchecked, and the line stays open with that note.
- The header comment states the rules.

The checker still has no unused-key report. It never had one, and dynamic keys such as
`t(PERSON_BASE[c][k])` (`reasons.ts`) would make one unreliable, so it never reports a plural form as unused.

### 2. Count-bearing keys become plural families (Table A)
- Each family in Table A replaces the keys listed under "Replaces"; those keys are deleted from `he.json`.
- Callers pass `count` as a number and stop choosing a key in code: no `=== 1 ? …One : …` branches remain
  for these strings.
- `cardTitle(t, …)` passes `count: rooms` (the number) next to `rooms: formatRooms(rooms)`, so 2.5 selects
  `_other` and shows "2.5".
- `rooms.flatmates` (now an object `{one, many, withAges}`) becomes a family, so `withAges` moves to
  `rooms.flatmatesWithAges` (P1: a base cannot also be an object).
- `reasons.ts:251` `parkingShortfall` passes `spots: t('listing.parking', { count: spots })` to
  `match.owner.parking.differ`, as the seeker line already does (`reasons.ts:106-110`). The line then reads
  "ביקשו 2 חניות, בדירה יש מקום אחד", not "…בדירה יש 1". It shows on the 0.5 agree path too
  (`reasons.ts:282`).

### 3. A room is described as a room
- `web/src/features/listings/furnished.ts` (new) exports `furnishedLabel(t, furnished, listingType)`, where
  `listingType` is `ListingType | null` (the wizard form's `listing_type` is nullable, `validate.ts:24`) and
  `null` reads the apartment forms. It holds
  two literal maps so the checker sees every key: an apartment reads `listings.furnished.*` (unchanged), a
  room reads `listings.furnishedRoom.*` (new, Table B; FOLLOWUPS 33). It is used by:
  - `ListingCard.tsx:94-100`'s chip;
  - `ListingFacts.tsx:26-31`'s grid row;
  - `DetailsStep.tsx:343-347`'s choice labels, which follow the form's `listing_type`.
- `cardTitle(t, listing)` becomes the only reader of `listings.card.title` / `listings.card.roomTitle`. These
  callers switch to it:
  - `MyApplicationsPage.tsx:57`;
  - `ApplicantsPage.tsx:286`;
  - `ChatListPage.tsx:73`;
  - `ChatThreadPage.tsx:127`.

  Each caller's `listing` has `listing_type`:
  - in `MyApplicationsPage`, `ChatListPage` and `ChatThreadPage` it is `ApplicationListingOut`
    (`api/app/schemas/application.py:72-78`); `ConversationOut.listing` and `ThreadOut.listing` are that
    type (`schemas/chat.py:80,98`);
  - in `ApplicantsPage` it is the `MyListingOut` from `useMyListings()` (`ApplicantsPage.tsx:46-47`).
  So FOLLOWUPS 147's "the chat screens need it from the API first" no longer holds, and 147 closes.
- **Partial ages** (FOLLOWUPS 154, accepted by Gilad 2026-11-12 Q5). In `rooms/flatmates.ts` `flatmatesText` and in
  `RoomPreview.tsx`, when fewer ages are given than flatmates, each missing age shows as
  `rooms.flatmateAgeUnknown` ("?") after the known ages, e.g. "2 שותפים (30, ?)". With no ages there are no
  parentheses, as today; a visitor, who gets no ages, is unchanged. `RoomPreview` keeps sorting the known
  ages, and `flatmatesText` keeps the API's order.

### 4. Wording (Table B, `he.json` only)
Gender, room vs apartment, the copy-only follow-ups, and typography. Nothing in Table B needs code beyond
Sections 2 and 3, apart from `listings.furnishedRoom.*` (Section 3).

**Out:**
- The landing, the product name and the header: `app.*` and `header.*` (`0009a`). `header.search` /
  `search.title` "חיפוש דירות" stay the navigation name.
- Copy that needs a component change to show: `0009f` (the list is in the Goal).
- Focus, live regions, landmarks, loading/empty/error behaviour (`0009c`). Layout, breakpoints and colour
  tokens (`0009d`).
- FOLLOWUPS items that are behaviour first, even though they carry copy:
  - 46: a recovery link in the not-found block;
  - 72: the message clamp with a "show more" control;
  - 83: the page alert when a card leaves the filter;
  - 182: MyLikesPage error states.

  `0009g` (state polish) has claimed them.
- An unused-key report (see Section 1).

**New dependencies:** none.

## Data
None.

## API
None.

## UI
Only text changes. The screens whose text changes:
- the search list and map (count, empty, more);
- the listing card, listing page and wizard preview (title, furnished, parking, flatmates);
- my listings (badges);
- the apply section (count);
- my applications, the inbox and chat (room titles);
- the inbox (status chips, the room summary);
- the composer;
- the people page (count);
- the header likes link (screen-reader label);
- the OTP resend button;
- the profile (one label);
- the match lines.

States: no screen gains or loses a state. Each keeps the loading, empty, error and success states its own
spec defined; only the words inside them change. RTL: no markup is added. "?" is a neutral character inside
an RTL run with European digits, as the ages already are (`flatmates.ts` comment, UAX 9 N1).

### Table A — plural families
"—" means the form does not exist. A `{{rooms}}` / `{{street}}` / `{{city}}` / `{{ages}}` variable is passed as
today.

| Family (base key) | `_zero` | `_one` | `_two` | `_other` | Replaces (current text) | Caller |
| --- | --- | --- | --- | --- | --- | --- |
| `auth.resendIn` | — | "שליחה חוזרת בעוד שנייה" | "שליחה חוזרת בעוד 2 שניות" | "שליחה חוזרת בעוד {{count}} שניות" | `auth.resendIn` "שליחה חוזרת בעוד {{seconds}} שניות" | `OtpForm.tsx:397` passes `{ count: secondsLeft }` |
| `listings.fields.charsLeft` | "לא נותרו תווים" | "נותר תו אחד" | "נותרו 2 תווים" | "נותרו {{count}} תווים" | "נשארו {{count}} תווים" | `DetailsStep.tsx:377`, `ProfilePage.tsx:460`, `ApplySection.tsx:184` (already pass `count`) |
| `chat.composer.remaining` | "לא נותרו תווים" | "נותר תו אחד" | "נותרו 2 תווים" | "נותרו {{count}} תווים" | "נותרו {{count}} תווים" (FOLLOWUPS 110) | `Composer.tsx:104` (already passes `count`) |
| `listings.roomPreview.flatmates` | — | "אדם אחד בדירה" | "2 שותפים בדירה" | "{{count}} שותפים בדירה" | `…flatmates` "{{count}} שותפים בדירה", `…flatmatesOne` "שותף/ה אחד/ת בדירה" | `RoomPreview.tsx:36-45`. **accepted by Gilad 2026-11-12 (brand voice: no slash forms)** |
| `listings.roomPreview.flatmatesAges` | — | "אדם אחד בדירה ({{ages}})" | "2 שותפים בדירה ({{ages}})" | "{{count}} שותפים בדירה ({{ages}})" | `…flatmatesAges` "{{count}} שותפים בדירה ({{ages}})", `…flatmatesOneAge` "שותף/ה אחד/ת בדירה ({{age}})" | `RoomPreview.tsx`. **accepted by Gilad 2026-11-12 (brand voice: no slash forms)** |
| `listings.card.title` | — | "חדר אחד, רחוב {{street}}, {{city}}" | "{{rooms}} חדרים, רחוב {{street}}, {{city}}" | "{{rooms}} חדרים, רחוב {{street}}, {{city}}" | "{{rooms}} חדרים, רחוב {{street}}, {{city}}" (FOLLOWUPS 33: "1 חדרים") | `cardTitle.ts` only |
| `listings.card.roomTitle` | — | "חדר בדירת חדר אחד, רחוב {{street}}, {{city}}" | "חדר ב־{{rooms}} חדרים, רחוב {{street}}, {{city}}" | "חדר ב־{{rooms}} חדרים, רחוב {{street}}, {{city}}" | "חדר ב־{{rooms}} חדרים, רחוב {{street}}, {{city}}" | `cardTitle.ts` only |
| `listings.card.parking` | — | "חניה" | "2 חניות" | "{{count}} חניות" | `…parkingOne` "חניה", `…parkingMany` "{{count}} חניות" | `ListingCard.tsx:90-93`: a chip when `parking_spots > 0` |
| `listing.parking` | — | "מקום אחד" | "2 מקומות" | "{{count}} מקומות" | `listing.parkingOne` "מקום אחד", `listing.parkingMany` "{{count}} מקומות" | `ListingFacts.tsx:19-23` (0 stays `listing.no`), `reasons.ts:106-110`, `reasons.ts:251` (Section 2) |
| `listings.mine.peopleLiked` | — | "אדם אחד אהב את החדר" | "2 אהבו את החדר" | "{{count}} אהבו את החדר" | `…peopleLiked` "{{count}} אהבו את החדר", `…peopleLikedOne` "אחד/ת אהב/ה את החדר" | `MyListingsPage.tsx:91-93`. **accepted by Gilad 2026-11-12 (brand voice: no slash forms)** |
| `applicants.newBadge` | — | "חדשה אחת" | "2 חדשות" | "{{count}} חדשות" | "{{count}} חדשות" (FOLLOWUPS 86: "1 חדשות"). **accepted by Gilad 2026-11-12 (Q2)** | `MyListingsPage.tsx:74` (already passes `count`) |
| `search.count` | — | "מודעה אחת" | "2 מודעות" | "{{count}} מודעות" | `search.count` "{{count}} דירות", `search.countOne` "דירה אחת". **accepted by Gilad 2026-11-12 (Q1)** | `ResultsList.tsx:52`, `SearchMap.tsx:87` |
| `applications.count` | "עוד אין מועמדים. אפשר להיות הראשונים" | "הוגשה מועמדות אחת" | "2 מועמדים הגישו מועמדות" | "{{count}} מועמדים הגישו מועמדות" | the object `applications.count` `{zero, one, many}` (same texts, `one` "מועמד/ת אחד/ת הגיש/ה מועמדות") | `ApplySection.tsx:271-277`. **accepted by Gilad 2026-11-12 (brand voice: no slash forms)** |
| `people.count` | — | "פרופיל אחד" | "2 מחפשים" | "{{count}} מחפשים" | `people.count` "{{count}} מחפשים", `people.countOne` "מחפש/ת אחד/ת" | `PeoplePage.tsx:125`. **accepted by Gilad 2026-11-12 (brand voice: no slash forms)** |
| `likes.badgeLabel` | — | "חדר אחד אהב אותך" | "2 חדרים אהבו אותך" | "{{count}} חדרים אהבו אותך" | `likes.badgeLabel` "{{count}} חדרים אהבו אותך", `likes.badgeLabelOne` "חדר אחד אהב אותך" | `LikesNavLink.tsx:34` |
| `rooms.flatmates` | — | "אדם אחד בדירה" | "2 שותפים" | "{{count}} שותפים" | `rooms.flatmates.one` "שותף/ה אחד/ת", `rooms.flatmates.many` "{{count}} שותפים" | `flatmates.ts:19-22`. **accepted by Gilad 2026-11-12 (brand voice: no slash forms)** |

These keys move or are new, with no plural:
- `rooms.flatmatesWithAges` "{{flatmates}} ({{ages}})" (moved from `rooms.flatmates.withAges`);
- `rooms.flatmateAgeUnknown` "?" (new, Q5).

**Kept as they are**, so the verifier can see the sweep:
- After a colon, a "·" or in parentheses (rule 5): `header.chatNew`, `chat.list.unread`,
  `search.filtersActive`, `chat.group`, `applicants.filter.*`, `applicants.link`, `listings.mine.flatmates`,
  `match.seeker.lifestyle.agreeSame`.
- The noun agrees with a number that is never 1: `listings.mine.count` and `listings.errors.capReached` (the
  cap, 3 or more); `search.map.tooMany` (`{{total}}` is above the shown cap); `match.seeker.contract.differ`
  (`{{months}}` is 6, 12, 24 or 36).
- Fixed numbers: `chat.thread.truncated` (200) and `flatmates.join.full` (7).
- `{{needed}}` is always 2: `match.seeker.parking.differ` "ביקשת {{needed}} חניות — בדירה יש {{spots}}".
  With spots left, it shows only when 2 were asked and 1 spot exists, because 0 spots is `differNone`.
  `{{spots}}` already reads `listing.parking`, e.g. "…בדירה יש מקום אחד" (`reasons.ts:101-111`).
- A prefix on a variable that is always a Hebrew word (rule 6): `listing.ownerLooksFor.minContract`
  "חוזה ל{{label}} לפחות", `match.seeker.household.agree` "מתאים ל{{household}} — כמוך",
  `rooms.card.forGender` "ל{{who}} בלבד", `rooms.apply.roomSectionRequired` "…ל{{who}} בלבד…".
- Hebrew's generic "מי ש…" / "אף אחד" (rule 3): `flatmates.invite.hint`, `flatmates.invite.onceWarning`,
  `listings.room.flatmatesHint`, `applications.form.hint`, `flatmates.list.empty`.
- ~~An artboard's call to action (rule 4): `applications.apply` "הגש/י מועמדות".~~ Changed instead:
  `applications.apply` "הגש/י מועמדות" → "הגשת מועמדות", an action-noun button. **accepted by Gilad 2026-11-12 (brand voice: no slash forms)**.
- Reworded to the colon form in Table B instead: `applicants.room.summary` (FOLLOWUPS 153) and
  `listings.roomPreview.lifestyle`.
- Not counts: `listings.room.ageOf` "שותף/ה {{n}}" (an ordinal label) and `common.loading` "טוען…" (rule 4).

### Table B — wording
The build applies this table verbatim. A later change from Gilad is an edit to this table. The numbers are
stable: B7 (`flatmates.invite.hint`) was dropped in verification under rule 3's generic "מי ש…".

| # | Key | Current | Proposed | Why | Gilad |
| --- | --- | --- | --- | --- | --- |
| B1 | `listing.ownerLooksFor.title` | "מה בעל הדירה מחפש" | "מה בעלי הדירה מחפשים" | rule 3 | |
| B2 | `match.card.basis` | "על בסיס הפרופיל שלך והעדפות בעל הדירה" | "על בסיס הפרופיל שלך והעדפות בעלי הדירה" | rule 3 | |
| B3 | `match.seeker.household.differ` | "בעל הדירה מחפש {{households}}" | "בעלי הדירה מחפשים {{households}}" | rule 3 | |
| B4 | `match.seeker.contract.differ` | "בעל הדירה מבקש חוזה של {{months}} חודשים לפחות" | "בעלי הדירה מבקשים חוזה של {{months}} חודשים לפחות" | rule 3 | |
| B5 | `match.seeker.smoking.differ` | "בעל הדירה מבקש ללא מעשנים" | "בעלי הדירה מבקשים ללא מעשנים" | rule 3 | |
| B6 | `profile.room.fields.flatmates` | "עם מי אני מעדיפ/ה לגור?" | "עם מי הכי נוח לי לגור?" | no slash form; first person without a gendered verb |**accepted by Gilad 2026-11-12 (brand voice: no slash forms)** |
| B8 | `chat.list.new` | "חדש" | "חדשה" | the pill marks a new conversation (`is_new`, `ChatListPage.tsx:35`): שיחה is feminine | |
| B9 | `chat.composer.sending` | "שולח…" | "בשליחה…" | rule 4 (FOLLOWUPS 110) | **accepted by Gilad 2026-11-12 (Q3)** |
| B10 | `chat.composer.viewingTemplate` | "אשמח לתאם סיור בדירה. מתי נוח לך?" | "אשמח לתאם סיור בדירה. מתי נוח לכם?" | a room chat can include the flatmates (`0008f`); the plural speaks to everyone in it (FOLLOWUPS 110) | **accepted by Gilad 2026-11-12 (Q3)** |
| B11 | `applicants.status.submitted` | "חדש" | "חדשה" | the chip is the application's status, as the seeker's "נשלחה" / "לא נבחרה" and the stats' "חדשות" (FOLLOWUPS 86) | **accepted by Gilad 2026-11-12 (Q2)** |
| B12 | `applicants.status.declined` | "נדחה" | "נדחתה" | as B11 | **accepted by Gilad 2026-11-12 (Q2)** |
| B13 | `applicants.statusChanged` | "{{name}}: {{status}}" | "המועמדות של {{name}}: {{status}}" | the announcement then reads "המועמדות של דנה: נדחתה" for anyone's name | **accepted by Gilad 2026-11-12 (Q2)** |
| B14 | `listings.furnishedRoom.none` | — (new) | "לא מרוהט" | rule 7 (FOLLOWUPS 33) | |
| B15 | `listings.furnishedRoom.partial` | — (new) | "מרוהט חלקית" | rule 7 | |
| B16 | `listings.furnishedRoom.full` | — (new) | "מרוהט" | rule 7 | |
| B17 | `search.feature.furnished` | "מרוהטת" | "ריהוט" | the filter matches partly or fully furnished apartments and rooms (`api/app/services/search.py:83-84`); a noun, like "מעלית", "חניה" and "חיות מחמד" next to it | |
| B18 | `search.availableByHint` | "דירות שאפשר להיכנס אליהן עד התאריך הזה" | "דירות וחדרים שאפשר להיכנס אליהם עד התאריך הזה" | search lists both types | |
| B19 | `listings.roomPreview.for` | "מתאים ל: {{who}}" | "ל{{who}} בלבד" | the public card's words (`rooms.card.forGender`); shown only for women or men | |
| B20 | `applications.mine.empty` | "עוד לא הגשת מועמדות לאף דירה" | "עוד לא הגשת אף מועמדות" | seekers apply to rooms too | |
| B21 | `search.empty` | "לא מצאנו דירות שמתאימות לחיפוש. אפשר להרחיב את המסננים." | "לא מצאנו מודעות שמתאימות לחיפוש. אפשר להרחיב את המסננים." | rule 7 | **accepted by Gilad 2026-11-12 (Q1)** |
| B22 | `search.more` | "עוד דירות" | "עוד מודעות" | rule 7 | **accepted by Gilad 2026-11-12 (Q1)** |
| B23 | `search.map.empty` | "אין דירות באזור הזה. אפשר להזיז את המפה או לשנות את המסננים." | "אין מודעות באזור הזה. אפשר להזיז את המפה או לשנות את המסננים." | rule 7 | **accepted by Gilad 2026-11-12 (Q1)** |
| B24 | `search.map.tooMany` | "מוצגות {{shown}} מתוך {{total}} דירות. אפשר להתקרב כדי לראות את כולן." | "מוצגות {{shown}} מתוך {{total}} מודעות. אפשר להתקרב כדי לראות את כולן." | rule 7 | **accepted by Gilad 2026-11-12 (Q1)** |
| B25 | `match.owner.contract.agree` | "מחפשים חוזה ל{{months}}" | "מחפשים חוזה של {{months}}" | "ל3 שנים ומעלה" had no maqaf; "של" reads well before every label: "של חצי שנה", "של 3 שנים ומעלה" (FOLLOWUPS 130) | **accepted by Gilad 2026-11-12 (Q4)** |
| B26 | `match.owner.contract.differ` | "מחפשים חוזה ל{{months}} בלבד" | "מחפשים חוזה של {{months}} בלבד" | as B25. FOLLOWUPS 130's "…ומעלה בלבד" cannot happen: 36 months is the top answer and never falls below a listing's minimum | **accepted by Gilad 2026-11-12 (Q4)** |
| B27 | `lifestyle.night.topic` | "שעות לילה" | "שעת שינה" | "שעות לילה: מאוחר בלילה" repeated לילה (FOLLOWUPS 150); also changes the match differ line's topics | |
| B28 | `lifestyle.social.topic` | "חברתיות" | "זמן בבית" | "חברתיות: בנפרד" did not answer the topic (FOLLOWUPS 150). The FOLLOWUPS suggestion "זמן משותף" reads oddly next to "בנפרד"; "זמן בבית" matches the question "את הזמן בבית אני מעביר/ה…" | |
| B29 | `applicants.room.summary` | "{{same}} מתוך {{shared}} תשובות זהות לדירה" | "תשובות זהות לדירה: {{same}} מתוך {{shared}}" | "1 מתוך 1 תשובות" (FOLLOWUPS 153); rule 5, correct for every number | |
| B30 | `listings.roomPreview.lifestyle` | "שאלון הדירה: נענו {{count}} מתוך {{total}}" | "שאלון הדירה: {{count}} מתוך {{total}} תשובות" | "נענו 1" put a plural verb on one answer | |
| B31 | `listings.errors.range` | "הערך צריך להיות בין {{min}} ל-{{max}}" | "הערך צריך להיות בין {{min}} ל־{{max}}" | rule 6: a hyphen-minus where the app uses a maqaf | |
| B32 | `applicants.filter.all` | "הכל ({{count}})" | "הכול ({{count}})" | rule 6, as `search.any` "הכול" | |
| B33 | `search.sortedByMatch` | " · ממוינות לפי התאמה" | " · לפי התאמה" | it shows whenever `total > 0` (`ResultsList.tsx:54`), so "מודעה אחת · ממוינות" put a plural participle after one item; the short form reads right for every count and every Q1 option | |
| B34 | `applications.mine.search` | "לחיפוש דירות" | "לחיפוש דירות וחדרים" | the same link as `0009f`'s `flatmates.join.toSearch` and `0009g`'s `listing.toSearch`; search lists both types | |

## Acceptance criteria
Hebrew in tests is written as `\uXXXX` escapes (the 0002d convention). A test that reads `he.json` directly
switches to `i18n.t(base, { count })` where its key became a family: for example `AuthMenu.test.tsx:262`
`he.likes.badgeLabelOne`.

- [ ] AC1 **The checker enforces plurals.** In `web/scripts/__tests__/i18n-check.test.ts` (temp-dir fixtures
  as today); the six existing tests pass unchanged:
  - **`ac1_plural_family_needs_every_he_form`**:
    - a catalogue with `x_one` and `x_other` fails, naming `x_two`;
    - `_one`, `_two` and `_other` pass, and adding `_zero` still passes;
    - adding `x_many` fails;
    - `x` also present as a string fails, and `x` present as an object next to the forms fails.
  - **`ac1_plural_call_needs_count`**:
    - `t('x')` and `t('x', { other: 1 })` fail with "called without count";
    - `t('x', { count: n })`, `t('x', { count })`, `t('x', opts)` and `t('x', { ...rest })` pass;
    - `t('missing', { count })` still fails as missing.
  - **`ac1_ts_files_checked_for_keys`**:
    - `a.ts` with `t('does.not.exist')` fails at `a.ts:1`;
    - `a.ts` with a Hebrew string literal passes;
    - a `.d.ts` file is not read.
  - **`ac1_later_arguments_and_conditional_keys`**:
    - `t('k', { defaultValue: 'two words' })` in a `.tsx` fails as hardcoded text;
    - `t(c ? 'k' : 'nope')` fails, naming `nope`;
    - `<p>don't stop</p>` and `<p>(beta) version</p>` fail.
- [ ] AC2 **Every family renders for every count**
  (`web/src/locales/__tests__/plurals.test.ts::ac2_every_family_renders`, new). The test walks `he.json` and
  calls the app's `i18n` (`app/i18n.ts`) for each family base, with `count` ∈ {0, 1, 2, 3, 11, 1.5} and a
  dummy value for every other `{{var}}` in its forms. Then:
  - the result is never the base key and never contains "{{";
  - `count` 1 gives the `_one` text, 2 the `_two` text, and 0 the `_zero` text when the family has one.

  The same file asserts that `new Intl.PluralRules('he').resolvedOptions().pluralCategories` equals
  `['one', 'two', 'other']`, so a Node or ICU change shows up as a failing test. `make i18n-check` passes on
  the real tree.
- [ ] AC3 **Counts on screen.**
  - `web/src/features/listings/__tests__/cardTitle.test.ts::ac3_titles_by_rooms_and_type` (new):
    - an apartment with 1 / 2 / 2.5 rooms → "חדר אחד, רחוב …" / "2 חדרים, …" / "2.5 חדרים, …";
    - a room in a 1-room / 4-room flat → "חדר בדירת חדר אחד, …" / "חדר ב־4 חדרים, …".
  - `ApplySection.test.tsx::ac3_applicant_count_forms`: `applicant_count` 0 / 1 / 2 / 7 show the four
    `applications.count` forms (1 → "הוגשה מועמדות אחת").
  - `MyListingsPage.test.tsx::ac3_badges_one_two_many`:
    - `new_applicant_count` 1 → "חדשה אחת", 2 → "2 חדשות";
    - `liked_me_count` 1 → "אדם אחד אהב את החדר", 3 → "3 אהבו את החדר".
  - `SearchPage.test.tsx::ac3_result_count_forms`: `total` 1 / 2 / 12 → "מודעה אחת" / "2 מודעות" / "12 מודעות".
    `SearchMap.test.tsx`'s count assertions are updated to the same words.
  - `OtpForm.test.tsx::ac3_resend_countdown_singular`: with 1 second left the button reads
    "שליחה חוזרת בעוד שנייה", and with 30 seconds "שליחה חוזרת בעוד 30 שניות".
  - `ChatThreadPage.test.tsx::ac3_composer_remaining_forms`: with 1 character left "נותר תו אחד", with 0
    "לא נותרו תווים".
  - `PeoplePage.test.tsx::ac3_people_count_one`: `total` 1 → "פרופיל אחד".
  - `AuthMenu.test.tsx::ac3_likes_badge_forms` (new): 1 → "חדר אחד אהב אותך", 2 → "2 חדרים אהבו אותך",
    both `sr-only`. 0008c's `ac6_likes_link` (line 238) keeps its name; its lines 250 and 262 switch to
    `i18n.t('likes.badgeLabel', { count })`.
  - `reasons.test.ts::ac3_owner_parking_shortfall_one_spot` (new): 2 asked and 1 spot gives "ביקשו 2 חניות,
    בדירה יש מקום אחד", on both the agree and the differ path. `ac6_owner_copy`'s rows at lines 515 and 524
    change to that text.
  - `ListingCard.test.tsx::ac3_parking_and_flatmates_forms` (the card shows the text, wherever `0009i` puts
    it):
    - parking 1 → "חניה", 2 → "2 חניות";
    - a room with 1 flatmate → "אדם אחד בדירה";
    - 2 flatmates with ages `[30]` → "2 שותפים (30, ?)";
    - 2 flatmates with no ages → "2 שותפים".
  - `ListingPage.test.tsx::ac3_facts_parking_forms`: the facts grid shows parking 1 → "מקום אחד", 2 →
    "2 מקומות", 0 → "אין".
  - `ListingWizard.test.tsx::ac3_room_preview_flatmates`: the preview chip for 2 flatmates with one age →
    "2 שותפים בדירה (30, ?)"; for 1 flatmate aged 30 → "אדם אחד בדירה (30)".
- [ ] AC4 **A room is described as a room.**
  - `ListingCard.test.tsx::ac4_room_furnished_forms`: for a room with `full` / `partial` / `none` the card
    shows "מרוהט" / "מרוהט חלקית" / "לא מרוהט", and for an apartment it still shows "מרוהטת".
  - `ListingPage.test.tsx::ac4_room_facts_furnished`: a room's facts grid shows "מרוהט".
  - `DetailsStep.test.tsx::ac4_furnished_choice_by_type`: the wizard's furnished choices are the room forms
    for a room and the apartment forms for an apartment.
  - `ChatListPage.test.tsx::ac4_room_title` and `MyApplicationsPage.test.tsx::ac4_room_title`: a room listing
    shows "חדר ב־4 חדרים, רחוב …".
  - `cardTitle.test.ts::ac4_only_cardTitle_reads_title_keys`: no `.ts` or `.tsx` file under `web/src`,
    other than `cardTitle.ts` and tests, contains `listings.card.title` or `listings.card.roomTitle` (the
    files are read with `fs`).
- [ ] AC5 **The tables are applied.**
  - `plurals.test.ts::ac5_replaced_keys_removed`: every key in Table A's "Replaces" column and
    `rooms.flatmates.withAges` is absent from `he.json`.
  - `plurals.test.ts::ac5_fixed_patterns_do_not_return`: no `he.json` value contains "בעל הדירה מחפש",
    "בעל הדירה מבקש", "מעדיפ/", "שולח…", "ל-{{", "הכל (" or "· ממוינות".
  - Component and e2e assertions on changed text are updated to the tables, never the other way round.

**Review check, not a test:** every Proposed value in Tables A and B is the `he.json` value for its key,
character for character. The code and ux reviewers check it row by row. A test copy of the tables would be a
second source to keep in step with Gilad's edits, so there is none.
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and a local `make e2e` are green on
  the final head (Speed rule 7). The e2e result goes in the digest. The diff has no bidi or zero-width
  characters: `grep -nP '[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}]' web/src/locales/he.json`
  prints nothing.

## Tests to write
- Unit (checker): `web/scripts/__tests__/i18n-check.test.ts`, four new tests (AC1).
- Unit (catalogue): `web/src/locales/__tests__/plurals.test.ts`, new (AC2, AC5).
- Component:
  - new: `web/src/features/listings/__tests__/cardTitle.test.ts` (AC3, AC4);
  - new cases in `ApplySection`, `MyListingsPage`, `SearchPage`, `OtpForm`, `ChatThreadPage`, `PeoplePage`,
    `AuthMenu`, `reasons`, `ListingCard`, `ListingPage`, `ListingWizard`, `DetailsStep`, `ChatListPage` and
    `MyApplicationsPage` tests (AC3, AC4);
  - existing assertions on changed text are updated.
- E2E: none new. The suite must pass with the new text, so any assertion on a changed string is updated.

## Risks / open questions
- **Q1 — the word for search results** (rule 7; Table A `search.count`, B21–B24). Search has listed apartments
  and rooms together since Slice 7, but its counts and empty lines say "דירות".
  - (a) **"מודעות"** in the counts and the empty, more and map lines, keeping "חיפוש דירות" as the page and
    nav name. It is accurate for both types. B33 makes the " · לפי התאמה" suffix right for every count under
    every option.
  - (b) Keep "דירות" as an umbrella word: no change; Table A's `search.count` forms become "דירה אחת" /
    "2 דירות" / "{{count}} דירות" and B21–B24 are dropped.
  - (c) "תוצאות": generic, but "תוצאה אחת" and "אין תוצאות באזור הזה" read flatter.

  Recommendation: (a). Written on (a), accepted by Gilad 2026-11-12.
- **Q2 — owner inbox status words** (FOLLOWUPS 86; `applicants.newBadge`, B11–B13).
  - (a) **The application's feminine forms**: "חדשה", "נדחתה", "המועמדות של {{name}}: {{status}}", and the
    badge "חדשה אחת" / "2 חדשות". They match the seeker side ("נשלחה", "לא נבחרה") and the inbox stats
    ("חדשות").
  - (b) The person's slash forms: "חדש/ה", "נדחה/תה", and "{{name}}: {{status}}" kept.
  - (c) Keep "חדש" / "נדחה" (masculine generic for the applicant).

  Recommendation: (a). Written on (a), accepted by Gilad 2026-11-12.
- **Q3 — the composer** (FOLLOWUPS 110; B9, B10).
  - (a) **"מתי נוח לכם?" and "בשליחה…"**.
  - (b) Keep "מתי נוח לך?" (unvocalised "לך" reads as either gender) and change only "בשליחה…".
  - (c) Keep both.

  Recommendation: (a), because a room chat can include flatmates. Written on (a), accepted by Gilad 2026-11-12. The
  remaining-characters forms in Table A are grammar, not a choice.
- **Q4 — the owner's contract line** (FOLLOWUPS 130; B25, B26).
  - (a) **"מחפשים חוזה של {{months}}"** for every label.
  - (b) Keep "ל{{months}}" and give the 36-month answer its own line, "מחפשים חוזה של 3 שנים ומעלה".
  - (c) A maqaf, "ל־{{months}}": it fixes the digit but reads badly before a word label ("ל־שנה").

  Recommendation: (a). Written on (a), accepted by Gilad 2026-11-12.
- **Q5 — flatmates with only some ages given** (FOLLOWUPS 154; Section 3).
  - (a) **"?" for each missing age**: "2 שותפים (30, ?)".
  - (b) Show the ages only when every age is given. This hides what the lister typed; the "שותפים בגילך"
    chip still uses the ages.
  - (c) Name the known ones: "2 שותפים, גיל ידוע: 30". This needs one more plural, on the known count.

  Recommendation: (a). Written on (a), accepted by Gilad 2026-11-12. The marker is the key `rooms.flatmateAgeUnknown`, so a
  different marker is a table edit.
- **Proposed `PRODUCT.md` row** (orchestrator to add once Q1–Q5 are answered). Topic **Copy**: "Decided
  2026-11-?? (Slice 9, Gilad): Hebrew copy follows 0009b's conventions:
  - slash forms for one addressed person ("את/ה", "מחפש/ת"), plural imperatives for instructions, and the
    other side in the plural ("בעלי הדירה");
  - counts through i18next plural forms (one / two / other, plus zero where 0 reads differently), enforced
    by `make i18n-check`;
  - a room listing is described in the masculine ("חדר מרוהט");
  - search counts say 'מודעות' (Q1), and the owner inbox's status words are the application's ('חדשה',
    'נדחתה') (Q2)."
- **ICU drift.** The categories come from the runtime (`Intl.PluralRules`), not a constant, and AC2 pins them,
  so a Node upgrade that changes Hebrew's categories fails a named test instead of rendering raw keys.
- **Test churn.** Many component tests assert text this spec changes, or read removed keys such as
  `he.likes.badgeLabelOne` or `he.applications.count.one`. They are updated to the tables (AC5). This is the
  bulk of the run, and is mechanical.
- **P4 may surface old problems.** `.ts` files were never key-checked, so the first run may report a `t()` key
  in a `.ts` file that is missing from `he.json`. Such a key would show raw text today. Fix it with the
  closest existing key. If none fits, add a key and note it in the digest.
- **Conflicts with the sibling specs.** Slice 9 now has about a dozen specs. Each overlap is a few lines, and
  the second to merge rebases.
  - `he.json`: every Slice 9 spec, on different keys.
  - **Keys this spec deletes that siblings read.** Whichever spec merges second switches the reads to the
    family, e.g. `t('likes.badgeLabel', { count: 1 })`:
    - `0009a:78` reads `likes.badgeLabel` / `likes.badgeLabelOne` (the header's accessible names);
    - `0009p:39` reads `people.count` / `people.countOne`;
    - `0009k:208` reads `listings.mine.peopleLikedOne`.
  - `0009g:142,180,285` builds on `applicants.statusChanged` and `applicants.status.*` (B11–B13 change their
    words, not their keys).
  - `0009i` restyles `ListingCard` and moves features into the facts line; its room example already reads
    "מרוהט". AC3 and AC4 assert what the card shows, not where.
  - `OtpForm.tsx` (one line): `0009c` (the resend live region), `0009f` and `0009m`.
  - `ApplySection.tsx`, `MyApplicationsPage.tsx`, `ApplicantsPage.tsx`, `ChatListPage.tsx`,
    `ChatThreadPage.tsx`: a few lines each, with `0009c` / `0009g` (focus, drafts, states), `0009f`, and the
    screen-styling specs `0009l` (inbox) and `0009q` (lists, chat).
  - `ListingCard.tsx` / `RoomPreview.tsx` / `DetailsStep.tsx`: logic only, while `0009d` / `0009i` / `0009k`
    restyle them.
- **Scope check.** About 20 source files change by a few lines each, plus the checker and its tests.
  Everything that needs new UI behaviour went to `0009f`.
- **FOLLOWUPS lines this spec closes** (the build ticks them, as of 8c3c480): 11, 12, 33, 86, 110, 130, 147,
  150, 153 and 154. Line 13 stays open with the note "`t(variable)` and template-literal keys stay
  unchecked".
- **Verification.** Verifier round 1: 15 findings, all applied, second round waived. The findings were:
  - rule 6 limited to digits and digit-or-Latin variables, with the word-variable keys kept;
  - rule 3's generic "מי ש…" stated, B7 dropped and the five generic lines kept;
  - B33 `search.sortedByMatch`;
  - the owner parking shortfall fixed through `listing.parking`;
  - AC5's row-by-row check moved to a review check;
  - `furnishedLabel` accepting `null`;
  - the ApplicantsPage listing type corrected;
  - the sibling map and the reads of deleted keys;
  - 0008c's `ac6_likes_link` kept, not renamed;
  - the closed FOLLOWUPS lines listed;
  - the CTA rule for `applications.apply`;
  - P2 for conditional keys;
  - the P1 wording;
  - B28 "זמן בבית";
  - the estimate raised to Opus/medium.

  The author also added B34, to match `0009f` and `0009g`'s search link.

## Digest (filled by orchestrator after verification)
See `/digest`.
