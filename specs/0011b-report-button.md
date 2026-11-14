---
id: 0011b
title: A signed-in user reports a listing (apartment or room) from its page, or a person from their card in שוק השותפים, with a reason and an optional note; the report is stored for the admin and nothing else happens; the API already takes reports from a chat, the owner's inbox and a room's people page (their buttons are 0011d)
status: verified
depends_on: []
reviewers: [code, security, qa, ux]   # security: a new write path holding user text about other users, five visibility rules reused (one 404, no existence oracle), a new table of PII; qa: API + dialog states; ux: a new dialog and two entry points
estimate: 1 coder run   # coder Opus/high (new table + migration + user text + five visibility rules; Speed rule 6). The other entry points are 0011d
---

## Goal
After this ships, a signed-in user who meets something wrong on homie can report it where they meet it: a
listing from its page (apartment or room), a person from their card in שוק השותפים (people browse and the likes
page). They pick a reason, may add a note, and see "תודה, הדיווח התקבל". The report is stored in a `reports`
table for Slice 12's admin; **nothing else happens** (nothing is hidden, no email, no notification, the
reported user never learns of it). `POST /reports` also accepts reports from a chat, from the owner's inbox and
from a room's people page, so `0011d` adds those buttons with no API change. PRODUCT.md "Trust (MVP)" ("report
button everywhere"; decided 2026-11-14).

## Decisions this spec builds on (Gilad, 2026-11-14; PRODUCT.md "Trust (MVP)")
1. Reports are **stored only** until Slice 12's admin lists them: nothing is hidden automatically, no email,
   no notification to anyone, and the reported user never learns of it. No read endpoint here.
2. The table lets Slice 12 list reports newest first, group them by target (and by person), and see where each
   was made from and by whom.
3. "Report button everywhere": every place a signed-in user meets another user's content. This spec: the
   listing page and the market person card; `0011d`: the chat, the owner's inbox and a room's people page.

## Choices made here (technical, one line each)
- **Target = what the page already holds.** The client sends the id its page has (listing id, `card_id`, room
  pair id, conversation id, application id) with a `target_type`; the server resolves the person behind it and
  checks visibility with the rule of that place, reused from the module that owns it. No new ids are exposed.
- **One 404** (`not_found`) for unknown, not visible to the caller, and the caller's own (as 0010h's like).
- **Repeat = idempotent, first report wins.** One row per (reporter, `target_type`, `target_id`); a repeat
  answers 200 `{already_reported: true}` and changes nothing (its reason and note are dropped). A report of the
  same person from another place (a card, then a chat) is a new row: Slice 12 sees both places.
- **A chat report is about the chat's other side**, the person in the chat's header (`other_name`): the owner
  for the seeker, the seeker for the owner and for a flatmate, the other person in a direct chat. Flatmates in
  a group chat are not named one by one (the dialog's hint says to write it in the note; `0011d`).
- **People shown on a room's page** (the lister who lives there and flatmates who chose to be shown, 0010f)
  are covered by the room's own report: `FlatPersonOut` has no id of any kind by design (0010f), so no button
  per person. The note can name who.
- **Reasons**: one fixed list of six for every target; the dialog offers `unavailable` only where a listing is
  involved (the listing page; `0011d`: an application chat). The API accepts any reason with any target.
- **Rate limit**: 10 reports an hour and 30 a day per user (`count_or_raise`), every authenticated attempt
  counted (a 404 and a repeat too), so the endpoint cannot be used to probe for existence.
- **Signed-out visitor on a listing page**: the report control is a link to `/login?next=/listings/{id}`, as
  the apply section's visitor button is (`loginPath`); after login they press it again.

## Scope
**In:**
- Migration `api/alembic/versions/0021_reports.py` (revision `"0021"`, down `"0020"`; see Data and Risks for
  the renumber rule), model `api/app/models/report.py` (`Report`), imported and listed in `__all__` in
  `api/app/models/__init__.py`.
- `api/app/schemas/report.py` (new): `ReportTargetType`, `ReportReason`, `NOTE_MAX_LENGTH = 500`,
  `ReportIn`, `ReportOut` (API section). `_blank_to_none` moves from `schemas/application.py` to
  `schemas/_text.py` as public `blank_to_none` (shared text rules live there, as `lf_newlines` does);
  `ApplicationIn` imports it, unchanged in behaviour.
- `api/app/services/reports.py` (new): `REPORT_RATE_LIMIT_HOUR = 10`, `REPORT_RATE_WINDOW_S = 3600`,
  `REPORT_RATE_LIMIT_DAY = 30`, `REPORT_RATE_DAY_S = 86_400`, `NotFoundError`, `count_report(r, user)`
  (`rl:report:user:{id}`, `rl:report:user:day:{id}`), `report(db, r, me, body: ReportIn) -> bool` (True =
  stored now, False = already reported). The only writer of `reports`.
- One small public lookup per place, each in the module that owns that place's rule (Target rules below), so
  no rule is restated and no private name is imported across modules (as 0010h made `count_like` public):
  `search.public_listing_owner`, `market_people.card_user`, `people.room_person_user`,
  `chat.other_member`, `applications.applicant_user`.
- `api/app/routers/reports.py` (new, thin), registered in `create_app` (`api/app/main.py`).
- `api/tests/test_reports.py` (new), `api/tests/test_migrations.py` (AC10).
- Web, `web/src/features/reports/` (new): `api.ts` (`postReport`, the generated types), `useReport.ts`,
  `reasons.ts` (`LISTING_REASONS`, `PERSON_REASONS`, `reasonLabel`), `ReportDialog.tsx` (the one shared
  dialog), `ReportButton.tsx` (the button that opens it; what `0011d` reuses), `__tests__/ReportDialog.test.tsx`.
- `web/src/components/ChoiceGroup.tsx`: optional `stacked` prop (UI).
- Entry points: `web/src/features/listings/ListingPage.tsx`, `web/src/features/people/MarketPersonCard.tsx`
  (one change covers people browse and the likes page, which both render it).
- `web/src/locales/he.json`: the `report` keys (UI). `make client`.
- `web/e2e/reports.spec.ts` (new, AC17); `web/e2e/screens/listing.screens.ts` (one state, AC18).
- `specs/FOLLOWUPS.md`: the lines in Risks.

**Out:**
- The chat, inbox and room-people-page buttons: `0011d`. The deposit line in chat (`chat.thread.warning`,
  0005b) stays exactly as it is in every thread (PRODUCT.md "Trust (MVP)": "already shipped ... and left as it is").
- The admin list and any action on a report (hide, warn, close a report), a read endpoint: Slice 12.
- Auto-hide, emails, notifications of any kind, telling the reported user.
- Blocking or muting a user; a per-person report on a room's page or in a group chat (Risks).
- Reporting from search results, the map, "my applications", invites or flatmate pages: every one of them
  links to a listing page or a chat, where the button is.
- Moderating `about_me` contact details (FOLLOWUPS 0008a stays open).

**New dependencies:** none.

## Data
`reports` (migration `0021_reports`, revision `"0021"`, down `"0020"`; downgrade drops the table: **every
report is lost**):

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK, default `gen_random_uuid()` | |
| `reporter_id` | uuid NOT NULL, FK `users(id)` ON DELETE CASCADE | who reported |
| `target_type` | text NOT NULL | `ck_reports_target_type`: `'listing'`, `'person'`, `'room_person'`, `'chat'`, `'applicant'` = where the report was made |
| `target_id` | uuid NOT NULL | the id the reporter's page held (Target rules); no FK: it points into five tables, and a report outlives its target's row |
| `reported_user_id` | uuid NOT NULL, FK `users(id)` ON DELETE CASCADE | the person the report is about, resolved when it is made (a listing: its owner) |
| `reason` | text NOT NULL | `ck_reports_reason`: `'money_before_viewing'`, `'broker'`, `'misleading'`, `'unavailable'`, `'offensive'`, `'other'` |
| `note` | text NULL | `ck_reports_note_length`: `char_length(note) BETWEEN 1 AND 500`; NULL = no note |
| `created_at` | timestamptz NOT NULL, default `now()` | |

- `uq_reports_reporter_target UNIQUE (reporter_id, target_type, target_id)`: the repeat rule (and "by whom").
- `ck_reports_not_self CHECK (reporter_id <> reported_user_id)`: a backstop; the service already refuses it.
- `ix_reports_reported_user_id (reported_user_id)`: grouping by person, and the FK's cascade.
- Slice 12's reads: newest first (`ORDER BY created_at DESC`), by target (`GROUP BY target_type, target_id`),
  by person (`reported_user_id`), where (`target_type`), by whom (`reporter_id`). It adds the indexes its list
  needs (a few hundred rows at MVP volume).
- The model builds the two IN-list CHECK texts from `get_args(ReportTargetType)` / `get_args(ReportReason)`;
  the migration freezes the same texts (autogenerate sees no diff, AC10).

Backwards-compatible: a new table; the running app never reads it.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/reports` | `current_user`: any signed-in account, any role; the target must be visible to the caller under the rule of the place it was seen (Target rules) and not the caller's own | `ReportIn` | 201 `ReportOut {already_reported: false}`; 200 `ReportOut {already_reported: true}` (a repeat; nothing changed) | 401 `unauthenticated`; 404 `not_found` (unknown, not visible to the caller, or the caller's own: one case); 422 (body; never echoes it); 429 `rate_limited` with `Retry-After`; 503 |

**`ReportIn`** (`model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")`):
- `target_type: ReportTargetType` = `Literal["listing", "person", "room_person", "chat", "applicant"]`;
- `target_id: uuid.UUID`;
- `reason: ReportReason` = `Literal["money_before_viewing", "broker", "misleading", "unavailable",
  "offensive", "other"]`;
- `note: Annotated[Note | None, BeforeValidator(blank_to_none)] = None`, where `Note` is
  `ApplicationIn.message`'s shape with its own field name: `BeforeValidator(lf_newlines)`,
  `Field(min_length=1, max_length=NOTE_MAX_LENGTH)`, `AfterValidator(visible_characters_only(...,
  allow_newlines=True, field="note", require_alnum=True))`. Absent, null or blank = no note.

**`ReportOut`**: `{already_reported: bool}` only. **No response ever echoes the note** (the 422 handler already
never returns `input`, `main.py::_request_invalid`). Nothing logs the note or the target.

The body is at most ~2.2 KB (500 characters × 4 bytes + ids), far under any request-body cap `0011c` adds.

### Target rules
Each lookup returns the reported user's id or `None`; `None`, or an id equal to the caller's, is
`NotFoundError` (404). Each is one SELECT (the card: two). None writes.

| `target_type` | `target_id` (where the page has it) | Visible to the caller when (the place's own rule, reused) | Reported user | Lookup (new, public) |
| --- | --- | --- | --- | --- |
| `listing` | listing id (`GET /listings/{id}`, the listing page) | the listing is public: `search._public_listings()` (live, active area), the one visibility rule | `listings.owner_id` | `search.public_listing_owner(db, listing_id) -> UUID \| None` (loads the row through `_public_listings()`, returns its `owner_id`) |
| `person` | `card_id` (`PersonCardOut.card_id`: people browse, the likes page) | the caller shows a card (`market_people._viewer(...).people_visible`, the 0010m ticket) and the card's person is a `_candidate(viewer)` (visible card, not the caller, two-way gender fit, not already a match: a match is reported from its chat) | the card's user | `market_people.card_user(db, me, card_id) -> UUID \| None` (`_viewer`, then one SELECT of `User.id` joined to `SeekerProfile` where `User.card_id = :card_id AND *_candidate(viewer)`) |
| `room_person` | `room_pairs.id` (`PersonOut.id`, a room's people page) | `people.like_person`'s rule without its application clause: the pair is of a room listing the caller owns, that listing is public (`_public_listings()`, as `_own_room` applies it), and the pair's seeker is shown and fits (`*_fits()`, `_shown()`) | `room_pairs.seeker_id` | `people.room_person_user(db, owner, pair_id) -> UUID \| None` |
| `chat` | conversation id (`/chat/:id`) | the caller is a member: `get_thread`'s rule (`Conversation.id = :id AND _is_member(me)`, outer-joining `Application` and `_F` on `_flatmate_join(me)`), any application status, a closed direct chat too | the caller's other side: `CASE WHEN seeker_id = me THEN owner_id ELSE seeker_id END` (`_is_other`'s rule): the owner for the seeker, the seeker for the owner and for a flatmate, the other person in a direct chat | `chat.other_member(db, me, conversation_id) -> UUID \| None` |
| `applicant` | application id (`ApplicantOut.id`, the owner's inbox) | the inbox rule (`list_applicants`): the application is to a listing the caller owns (any listing state) and is not `withdrawn` | `applications.seeker_id` | `applications.applicant_user(db, owner, application_id) -> UUID \| None` |

### `services/reports.py::report(db, r, me, body)`
1. `count_report(r, me)` first: every authenticated attempt counts (a 404 and a repeat too). Raises
   `RateLimitedError`; nothing stored.
2. The target's lookup (table above). `None` or `me.id` → `NotFoundError`.
3. One `INSERT … ON CONFLICT ON CONSTRAINT uq_reports_reporter_target DO NOTHING RETURNING id`; one commit.
   A returned row → True (201); none → False (200, the first report stands, unchanged). Two identical requests
   at once resolve on the constraint: one 201, one 200, one row.
4. Rolls back and re-raises on any error (as the other services). Writes nothing else: no event, no email.

Router (`routers/reports.py`): `POST /reports`, `status_code=201`, `response_model=ReportOut`; on False it sets
`response.status_code = 200`. `RateLimitedError` → 429 `rate_limited` with `Retry-After` (as
`routers/market_people.py::_rate_limited`); `NotFoundError` → 404 `not_found`. `responses` documents 200, 401,
404, 429 and 503 (`_SESSION` from `routers/applications.py`, as `market_people.py` imports it). Thin.

## UI
No artboard: built from the kit's `Dialog` (0009d) with `ClosureDialog`'s anatomy (0014b), the brand's voice
and an outline flag icon (brand iconography: 1.5–2 px stroke, round caps, `currentColor`, decorative).

### `ReportButton` (`features/reports/ReportButton.tsx`)
Props: `target: { type: ReportTargetType; id: string }`, `title: string` (the dialog's title), `reasons:
readonly ReportReason[]`, `label?: string` (visible text, default `report.button`), `describedBy?: string` (the
card's heading id, as the card's other buttons). Renders the kit `Button` `variant="ghost" size="sm"` with the
flag icon, and the `ReportDialog` mounted anew (a new `key`) on each opening, so every opening starts empty.
(`0011d` adds the props only the chat needs.)

### `ReportDialog` (`features/reports/ReportDialog.tsx`): the one shared dialog
`Dialog` with `title`, `description = report.intro`, then:
- the reasons as a `ChoiceGroup` (`legend = report.reasonLegend`, `name = report-{target.id}`, `stacked`), in
  the order given (`reasons.ts`):
  - `LISTING_REASONS` = `money_before_viewing`, `broker`, `misleading`, `unavailable`, `offensive`, `other`;
  - `PERSON_REASONS` = the same without `unavailable`;
- the note: `Field` (`label = report.note`) with `Textarea rows={4} maxLength={500}`, and under it the counter
  `listings.fields.charsLeft` (`count` = 500 − length), a polite live region only within 50 of the limit (as
  `ApplySection`'s);
- actions (inline end): `common.cancel` (secondary) and `report.submit` (primary, `busy` while sending;
  `disabled` until a reason is chosen).

Submit sends `{target_type, target_id, reason, note}` with the note trimmed, `null` when blank
(`useReport` = `useMutation({ mutationFn: postReport })`; no cache changes). A same-tick guard sends one request
per click.

| State | What shows |
| --- | --- |
| Empty (opened) | Title, intro, six or five reasons with none chosen, an empty note with "נותרו 500 תווים", ביטול + שליחת הדיווח (disabled). The browser focuses the first radio. |
| Loading | The submit button `busy` (`aria-busy`, still focusable); the form stays. |
| Error | One `role="alert"` line under the note, the form kept with what was typed, the submit enabled again: `report.errors.failed` (any other failure), `common.offline` instead when `useOnline()` is false (0009f: no replay on reconnect), `report.errors.rateLimitedIn` with `retryAfterText` (429 with `Retry-After`) else `report.errors.rateLimited`; a 422 whose `loc` is `["body", "note"]` is the note `Field`'s error `report.errors.noteInvalid` (focus to the note). |
| Gone (404) | The form is replaced by `report.gone` (`role="alert"`) and `report.close` (primary), which takes focus. |
| Success (201) | The form is replaced by `report.sent` (`role="status"`) and `report.close`, which takes focus. |
| Already (200) | As success with `report.already`. |
| Signed out (401) | `clearSession(queryClient)` (as `useSendMessage.ts`): a `RequireUser` page goes to login; on the listing page the button becomes the visitor's login link and the dialog leaves with it. |

Esc, the backdrop and ביטול close it with nothing sent; closing while a request runs does not cancel it, and
nothing is shown after. Focus returns to the opening button (`Dialog`). Keyboard: arrows move between the
radios (native), Tab reaches the note and the buttons, focus stays inside the modal (`showModal()`).

### `ChoiceGroup` `stacked`
`stacked?: boolean` (default false, every caller unchanged): the options in one column (`flex flex-col gap-2`),
each the full width, the label's text at the inline start (`justify-start text-start`). The centered classes are
not combined with the start ones: `choiceSegment` (exported, also used by `ProfilePage.tsx`) keeps its exact
text; the shape classes are shared through a non-exported base.

### Entry points
- **Listing page** (`ListingPage.tsx`, success branch only): a row after the `<article>`
  (`data-testid="listing-report"`, `flex justify-start`), outside the action column (0010l: the room's action
  column holds the apply card alone), so on a phone it is the page's last item and on a desktop it sits under
  both columns. Signed in and not `is_mine`: `ReportButton` with `label = report.listingButton`, `title =
  report.title.listing`, `LISTING_REASONS`, target `{listing, l.id}`. Signed out (`useMe().data === null`): the
  kit `Button variant="ghost" size="sm"` with the same icon and label as a link to `loginPath(l.id)`. Own
  listing (`is_mine`): no row. While `useMe()` loads, and on the page's loading, error and not-found: no row. The phone's apply bar shows only while the action
  column is below the screen, so it never covers this row.
- **Market person card** (`MarketPersonCard.tsx`, so people browse and the likes page alike): the like button's
  block becomes a row (`flex flex-wrap items-center justify-between gap-2`): the like button at the inline
  start, `ReportButton` at the inline end with `describedBy = headingId` (as the like button), `title =
  report.title.person` with the card's name, `PERSON_REASONS`, target `{person, card.card_id}`. The like error
  stays under the row.

### i18n keys (`web/src/locales/he.json`, new `report` namespace)
| Key | Hebrew |
| --- | --- |
| `report.button` | `דיווח` |
| `report.listingButton` | `דיווח על המודעה` |
| `report.title.listing` | `דיווח על המודעה` |
| `report.title.person` | `דיווח על {{name}}` |
| `report.intro` | `הדיווח מגיע רק לצוות הומי. אף אחד אחר לא מקבל עליו הודעה.` |
| `report.reasonLegend` | `מה הבעיה?` |
| `report.reasons.moneyBeforeViewing` | `בקשה לכסף או לפיקדון לפני ביקור בדירה` |
| `report.reasons.broker` | `מתווכים שמציגים את עצמם כפרטיים` |
| `report.reasons.misleading` | `פרטים מזויפים או מטעים` |
| `report.reasons.unavailable` | `המודעה כבר לא רלוונטית` |
| `report.reasons.offensive` | `הטרדה או תוכן פוגעני` |
| `report.reasons.other` | `סיבה אחרת` |
| `report.note` | `פרטים נוספים (לא חובה)` |
| `report.submit` | `שליחת הדיווח` |
| `report.close` | `סגירה` |
| `report.sent` | `תודה, הדיווח התקבל.` |
| `report.already` | `כבר דיווחתם על זה. הדיווח הקודם אצלנו.` |
| `report.gone` | `זה כבר לא זמין כאן, ולכן אי אפשר לדווח עליו.` |
| `report.errors.failed` | `לא הצלחנו לשלוח את הדיווח. אפשר לנסות שוב.` |
| `report.errors.rateLimited` | `נשלחו הרבה דיווחים בזמן קצר. אפשר לנסות שוב מאוחר יותר.` |
| `report.errors.rateLimitedIn` | `נשלחו הרבה דיווחים בזמן קצר. אפשר לנסות שוב {{when}}.` |
| `report.errors.noteInvalid` | `בפרטים יש תווים שאי אפשר לשלוח, או שאין בהם אותיות. כדאי לכתוב אותם מחדש.` |

Reused: `common.cancel`, `common.offline`, `listings.fields.charsLeft_*`. `reasonLabel(t, reason)` is a literal
map (as `ClosureDialog`'s `closeReasonLabel`), so `make i18n-check` sees every key.

### RTL
Logical properties only. The dialog inherits `dir="rtl"`; the stacked radios read from the inline start; the
counter and alerts are start-aligned; the actions sit at the inline end (`Dialog`); the flag icon precedes the
label (inline start). A name in `report.title.person` is a text node inside the title (a Latin name keeps its
order through the bidi algorithm; no markup in the string).

## Acceptance criteria
API (`api/tests/test_reports.py` unless named):
- [ ] AC1 (listing, stored, nothing else) Given seeker `S` and owner `O`'s public apartment and public room,
  When `S` POSTs a `listing` report for each (`reason: "money_before_viewing"`, a note with `\r\n`), Then 201
  `{"already_reported": false}`, exactly that key, the body holds neither the note nor the target id; one row
  each with `reporter_id = S`, `target_type = 'listing'`, `target_id`, `reported_user_id = O`, the reason, the
  note with `\n`; a blank note (`"   "`) stores NULL; the outbox has no new message; `GET /listings/{id}`
  still answers 200 and the listing is still in `GET /listings` — `test_ac1_report_listing`
- [ ] AC2 (listing not visible) A paused, an expired, an inactive-area, an unknown listing and `O`'s own
  listing reported by `O` are each 404 `not_found` with the same body, and nothing is stored —
  `test_ac2_listing_not_visible_is_404`
- [ ] AC3 (person) Given `A` and `B` with visible cards (`make_card`) that fit each other, When `A` reports
  `B`'s `card_id`, Then 201 and `reported_user_id = B`. 404 and nothing stored for: `A` without a card
  (`people_visible` false), `B` hidden, a gender misfit (`person_fit` false), `A`'s own card, an unknown
  `card_id`, and `A`–`B` already a match (both likes set) — `test_ac3_report_person_card`
- [ ] AC4 (room person) Given owner `O`'s live room and seeker `P` shown and fitting (`make_pair`), When `O`
  reports the pair id, Then 201 and `reported_user_id = P`. 404 for: another owner's pair, the room paused,
  `P` hidden (`people_visible` false), `P` no longer fitting (gender), an unknown id —
  `test_ac4_report_room_person`
- [ ] AC5 (chat) An apartment chat: the seeker's report names the owner, the owner's names the seeker; a room
  chat with flatmate `F`: `F`'s report names the seeker; a direct chat: each names the other; a declined
  application's chat and a removed match's chat are still reportable (201). 404 for: a user not in the chat,
  `F` after leaving the flat, an unknown id — `test_ac5_report_chat_other_side`
- [ ] AC6 (applicant) Given `O`'s listing with submitted, shortlisted and declined applications, When `O`
  reports each application id, Then 201 naming its seeker; a withdrawn application, another owner's
  application, and the seeker reporting their own application id are 404 — `test_ac6_report_applicant`
- [ ] AC7 (repeat) `S` reports the same listing twice (second time another reason and note): 201 then 200
  `{"already_reported": true}`; one row, with the first reason and note. The same target by another user, and
  another target by `S`, are new rows (201). Two identical POSTs on two connections at once: exactly one row,
  one 201 and one 200 — `test_ac7_repeat_is_already_reported`
- [ ] AC8 (validation, auth) Signed out: 401. 422 and nothing stored for: an unknown `target_type`, an unknown
  `reason`, a malformed `target_id`, a 501-character note, a note with a bidi control (U+202E), a note of
  punctuation only (`"?!"`); no 422 body contains the note's text or an `input` key —
  `test_ac8_validation_and_auth`
- [ ] AC9 (rate limit) The 11th POST in an hour gets 429 `rate_limited` with a `Retry-After` header and stores
  nothing; earlier 404s and repeats counted toward it; after the hour window (counter deleted), the day limit
  of 30 applies the same way — `test_ac9_rate_limit`
- [ ] AC10 (migration) Upgrade from `"0020"` creates `reports` with the columns, FKs, `uq_reports_reporter_target`,
  `ix_reports_reported_user_id` and the four CHECKs (their texts equal the model's, as `_check_definition`); a
  row breaking each CHECK (target type, reason, empty note, 501-character note, reporter = reported) is refused;
  downgrade to `"0020"` drops it; `head` then `alembic check` shows no diff —
  `api/tests/test_migrations.py::test_ac10_reports_upgrade_downgrade`
- [ ] NF1 A report is at most three statements after the session lookup (`person`: viewer + candidate + INSERT;
  every other type: lookup + INSERT), counted with a `statements` recorder as in `test_chat.py` —
  `test_reports.py::test_nf1_statement_counts`

Web:
- [ ] AC11 (dialog, success) Given `ReportDialog` for `{listing, id}` with `LISTING_REASONS`, Then the title,
  the intro as the dialog's description, a radio group named `report.reasonLegend` with six radios in order,
  the note with `נותרו 500 תווים`, and the submit disabled; When a reason is chosen and "  hi  " typed, Then the
  submit is enabled and sends exactly `{target_type: "listing", target_id, reason, note: "hi"}` (a blank note
  sends `null`); a 201 shows `report.sent` and focuses `report.close`; a 200 shows `report.already`; סגירה
  closes and focus returns to the opener — `web/src/features/reports/__tests__/ReportDialog.test.tsx::ac11_send_and_success`
- [ ] AC12 (dialog, errors) A 500 shows `report.errors.failed` with the form and the typed note kept, and a
  second submit sends again; offline (`navigator.onLine` false and a rejected fetch) shows `common.offline`; a
  429 with `Retry-After: 900` shows `rateLimitedIn` with "בעוד 15 דקות", without the header `rateLimited`; a
  422 at `["body", "note"]` marks the note invalid with `report.errors.noteInvalid`; a 404 replaces the form with
  `report.gone` and focuses סגירה; a 401 clears the session (`['me']` is `null`) —
  `ReportDialog.test.tsx::ac12_errors`
- [ ] AC13 (dialog, keyboard and reasons) Esc and ביטול close with no request; with `PERSON_REASONS` there are
  five radios and no `report.reasons.unavailable`; a double click sends one request; `ReportButton` remounts the
  dialog empty on every opening — `ReportDialog.test.tsx::ac13_keyboard_and_reasons`
- [ ] AC14 (`ChoiceGroup` stacked) With `stacked`, the options sit in one `flex-col` and each label has
  `justify-start` and `text-start` but not `justify-center` / `text-center`; without it, every class is as
  before — `web/src/components/__tests__/ChoiceGroup.test.tsx::ac14_stacked`
- [ ] AC15 (listing page) Signed in, not the owner: `listing-report` follows the article (outside
  `listing-actions`) with a button `report.listingButton` that opens the dialog titled `report.title.listing`
  with six reasons and posts `target_type: "listing"`; `is_mine`: no row; signed out: a link
  `report.listingButton` to `/login?next=%2Flistings%2F{id}`; loading, error and not-found: no row. The existing
  `ac10_room_page_has_only_the_apply_card` and `ac1_layout_columns` pass unchanged —
  `web/src/features/listings/__tests__/ListingPage.test.tsx::ac15_report_entry`
- [ ] AC16 (person card) In people browse, each card has a `report.button` button described by the card's
  name, after the like button in the same row; it opens `דיווח על {name}` with five reasons and posts
  `{target_type: "person", target_id: card_id}`; the same on the likes page's cards —
  `web/src/features/people/__tests__/MarketPeoplePage.test.tsx::ac16_report_person`,
  `web/src/features/likes/__tests__/MyLikesPage.test.tsx::ac16_report_person`
- [ ] AC17 (e2e, CI only) An owner posts an apartment (`postListing`); a seeker opens its page, presses
  `report.listingButton`, `expectNoAxeViolations(page, 'report dialog')` with the dialog open, picks
  `report.reasons.moneyBeforeViewing`, types a note, sends, and sees `report.sent`; reopening and sending again
  shows `report.already`. A signed-out context sees the button as a link to login —
  `web/e2e/reports.spec.ts::ac17_report_listing`
- [ ] AC18 (screens) `make screens`: a state `report-dialog` in `listing.screens.ts` (its `State` gains
  `spec?: string`; shots go to `screens/${spec ?? '0009j'}/`): the signed-in seeker on the apartment opens the
  dialog, picks the first reason and types a note; a viewport-only shot (a modal) at both widths in
  `web/screens/0011b/`; every existing state still passes — `web/e2e/screens/listing.screens.ts`

## Tests to write
pytest on the test DB (`redis_clean` for the limiter): `test_reports.py` (AC1–AC9, NF1; users through `signup`
for the caller and the conftest `make_*` helpers for the rest: `make_listing`, `make_card`, `make_person_like`,
`make_pair`, `make_flatmate`, `make_application`, `make_direct_chat`), the migration test (AC10). Vitest:
`ReportDialog.test.tsx`, `ChoiceGroup.test.tsx`, `ListingPage.test.tsx`, `MarketPeoplePage.test.tsx`,
`MyLikesPage.test.tsx` (mocked API, as their files do). E2E: `reports.spec.ts` — **e2e runs only in CI, never
locally** (Speed rule 8; the coder does not run `make e2e`). `make screens` locally is fine (mocked API).

## Risks / open questions
No question blocks the coder. Notes for the verifier, the orchestrator and Slice 12:
- **Migration number (renumber rule).** `main` is at `0020`; `0014d` (building in parallel, its spec has no
  such rule) takes `0021_cbs_rent_ratios`. This spec writes `0021_reports` revising `"0020"`. Before its one push
  (Speed rule 7) the coder merges `origin/main` and runs `ls api/alembic/versions`; if a `0021_*` file other than
  its own is there (any spec's), it renames its file to the next free number `N` (`0022_reports.py`), sets
  `revision = "N"` and `down_revision` = main's head, updates the docstring's `Revision ID` / `Revises`, and in
  AC10's test replaces the head it starts from (`command.upgrade(cfg, "0020")`, the `downgrade` target) with
  main's head and `"0021"` with `"N"`; this spec's Data/AC10 text then reads with those numbers. If this spec
  merges first instead, the orchestrator tells `0014d`'s build session to do the same to its own file and
  AC13. Two `"0021"` revisions on one branch fail every migration test (Alembic: multiple heads), so CI catches
  a missed renumber.
- **`0011c` interplay.** A global request-body cap from `0011c` needs no change here (the body is ≤ ~2.2 KB).
  `0011c`'s write limits do not cover `/reports`, which has its own.
- **Who a chat report names, and people on a room's page** (decided here, the orchestrator may overrule): a chat
  report names the chat's other side (`other_name`); a flatmate in a group chat is not named one by one (the note
  can); people shown on a room's page are reported through the room's report (`FlatPersonOut` has no id by design,
  0010f). FOLLOWUPS line: "name a group-chat member or a person on a room's page individually (needs a
  per-member reference on `ThreadOut.members` / `FlatPersonOut`), if Slice 12's reports show the need".
- **First report wins**: a repeat with a new reason or note is dropped (the dialog says it is already in). If
  Slice 12 wants later details, it can switch the repeat to an append; the table needs no change for a
  "one row per report" model except dropping the unique constraint.
- **Deleted accounts take their reports** (both FKs cascade, as every other table). No account deletion exists
  yet; FOLLOWUPS line for the pre-launch privacy pass: keep reports about a deleted account (SET NULL) or not.
- **Slice 12 privacy question, not this spec's:** whether the admin may read a reported chat; the report keeps
  the conversation id so Slice 12 can decide either way.
- **Rate limit** 10/hour, 30/day, per account only (like 0010h's browse); a per-IP counter is the same
  FOLLOWUPS item as 0010h's.

## Blast radius
`graphify affected` on main's graph (built before Slice 14; hits confirmed with grep on `main` at 0020):
- `ListingPage` (graphify): `AppRoutes` / `App.tsx`; tests `ListingPage.test.tsx` (AC15 added; its other tests
  untouched: the row is outside the article and `listing-actions`), `ApplySection.test.tsx` and
  `ProfileNudge.test.tsx` render the page with `GET /me` mocked already (the row adds no request); the app tests
  (`Layout`, `queryClient`, `routes`, `usePageTitle`, …) only route through it. `listing.screens.ts` (AC18).
- `MarketPersonCard` (graphify): `MarketPeoplePage` and `MyLikesPage` (`PeopleSections`) and their tests (AC16;
  no existing test counts a card's buttons, grep).
- `ChoiceGroup` (graphify): `OtpForm` (Login/Signup), `LifestyleFields`, `DetailsStep`, `RoomFields`,
  `TypeStep`, `PreferencesStep`, `ProfilePage`, `ClosureDialog` (grep), `ListingWizard`; untouched: `stacked`
  defaults to false and `choiceSegment`'s exported text is unchanged (`ProfilePage.tsx:265` uses it). Their tests
  pass unchanged; `ChoiceGroup.test.tsx` gains AC14.
- `_blank_to_none` (graphify: none; grep: `schemas/application.py::ApplicationIn` only): moved to `_text.py` as
  `blank_to_none`, same behaviour; the apply tests in `test_applications.py` cover it unchanged.
- `create_app` (graphify): one more `include_router`; `export_openapi.py` → `make client` (new `ReportIn`,
  `ReportOut`); `test_openapi_export.py` unaffected (it checks `/health`, `/areas`).
- `app.models.__init__` (`Base.metadata`): one more model; `test_ac4_autogenerate_sees_no_diff…` and every
  migration test's `alembic check` need model and migration to agree (AC10).
- New public lookups only, no existing function changed: `search._public_listings` (graphify callers: search,
  the listing page, `apply`, `_own_room`, `liked_rooms`, `my_likes`), `market_people._viewer` / `_candidate`
  (`browse`, `like`, `my_people_likes`), `people._fits` / `_shown`, `chat._is_member` / `_flatmate_join` /
  `_is_other` (`list_statement`, `get_thread`) are **read, not changed**; each module gains one function.

## Digest (filled by orchestrator after verification)
Spec 0011b — Report a listing or a person   (verified 2026-11-14; part 1 of 2, 0011d adds chat + inbox)
What a user can do after this: a signed-in user reports an apartment or room from its page, or a person from their
card in שוק השותפים (browse and likes), with a reason and an optional note; the report is stored for Slice 12's
admin and nothing else happens (no hiding, no email, the reported user never learns). Signed-out visitors get a
login link, like apply.
Decisions I need from you: none. FYI (drafter's calls, verified against PRODUCT.md): a repeat report of the same
thing answers "already reported" and the first stands; limit 10 an hour, 30 a day per account; people shown on a
room's page are covered by the room's report (they have no id of their own).
KPIs this slice moves: trust (reports per 100 active users, once Slice 12 shows them).
Acceptance targets: NF1 a report is at most three statements after the session lookup.
Risks: migration number race with 0014d (`0021`): the orchestrator merges 0011b after 0014d and the coder renames
to `0022_reports` when a `0021_*` is on main; any not-visible or own target is one 404 (no existence oracle).
Reviewers: code, security, qa, ux   Estimated: 1 coder run (Opus/high), 1 review round
Links: `specs/0011b-report-button.md` · PRODUCT.md "Trust (MVP)" · `specs/0011d-report-chat-inbox.md`
