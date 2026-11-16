---
id: 0018c
title: The lister and the seeker get an email when a tour is booked, rescheduled or cancelled (with an .ics file on booking and reschedule), and both get a reminder the day before; tours are purged 12 months after their time and the privacy policy says so
status: verified
depends_on: [0018a]   # tours table (incl. reminder_sent_at), the after-commit hook `tours.announce`, cleanup cancels. 0018d (calendar feed) imports this spec's services/ics.py (contract; Risks R1)
reviewers: [code, security, qa]   # security: PII in email (names, addresses, times) to the right person only, .ics text injection, a retention DELETE; qa: worker jobs, retries, idempotent reminders. No ux: no screen changes beyond privacy-policy copy. No perf: one indexed sweep every 15 min, a Redis list drained every 10 s
estimate: 1 coder run   # coder Opus/high (personal data leaves the system by email; a retention DELETE: Speed rule 6). No migration (0018a owns it). About 15 files (incl. compose), half tests
---

## Goal
After this ships, every tour change reaches the person who did not make it, by email, off the request path: the
lister hears that a shortlisted seeker booked, moved or cancelled a tour; the seeker hears that the lister
cancelled; a cancel the system makes (0018a's cleanup: listing paused — closing a listing is pausing it —,
un-shortlist, decline, withdraw, account deletion) reaches both. Expiry cancels nothing (contract) and the admin
app's `hide_listings` / `suspend` cancel silently, with no chat line and no announce (0018a R6), so they send no
email. The seeker also gets their own booking/reschedule confirmation, because the `.ics` in it
is their only way to put the tour in their calendar (0018d's feed is the lister's). Both sides get a reminder
about 24 hours before. Tours are deleted 12 months after their time. PRODUCT.md "Tours", "Retention",
`specs/TOURS-PLAN.md` "Shared contract".

## Decisions this spec builds on (do not reopen)
1. Gilad 2026-11-16 (PRODUCT.md "Tours"): each change is a chat line (0018a) **plus an email**, an `.ics` on
   booking and reschedule, and a reminder the day before; emails are built now and go live with the parked
   production email provider (`0013a`). Until then production keeps `EMAIL_BACKEND` as it is.
2. Contract (`TOURS-PLAN.md`): no migration here; `tours.reminder_sent_at` exists (0018a); the change hook is two
   functions in `api/app/services/tours.py` (0018a): `record(db, changes)` inside the transaction (chat lines) and
   `announce(r, changes)` after the commit (chat event). This spec adds its email enqueue to `announce` and nowhere
   else. `services/ics.py` is created here; 0018d imports it.
3. Only the listing owner is "the lister" (flatmates get nothing, PRODUCT.md "Tours").

## Decisions this spec takes (orchestrator defaults; relayed to Gilad in the digest, not blocking)
- **D1 Who gets what.**

  | Change (0018a's `TourChangeKind`, plus `reminder`) | Lister | Seeker |
  | --- | --- | --- |
  | `booked` (by seeker) | email + `.ics` (PUBLISH) | confirmation + `.ics` (PUBLISH) |
  | `rescheduled` (by seeker) | email + `.ics` (PUBLISH, higher SEQUENCE) | confirmation + `.ics` |
  | `cancelled_by_seeker` | email + `.ics` (CANCEL) | — |
  | `cancelled_by_lister` | — | email + `.ics` (CANCEL) |
  | `cancelled_by_system` | email + `.ics` (CANCEL) | email + `.ics` (CANCEL) |
  | `reminder` | email | email |

  System cancels go to both: the change does not record which event caused it, the seeker always needs to know,
  and a lister who paused a listing may not know that pausing cancels its tours. A seeker who withdrew gets the
  system cancel too (harmless: it confirms the tour is off).
- **D2 Reminder window.** A booked tour gets one reminder when it starts within the next 24 hours, unless it was
  booked or last rescheduled less than 24 hours before its start (`updated_at > starts_at - 24h`): those people
  just got the booking email. The sweep runs every 15 minutes, so a reminder lands 23¾–24 h before.
- **D3 Retention R11.** A tour row (booked or cancelled) is deleted **12 months after `starts_at`**, as R5's
  12 months for a decided application; an unresolved report on its listing, application or conversation keeps it
  (as R1/R4/R5). PRODUCT.md "Retention" gains R11 when the orchestrator verifies this spec.
- **D4 No unsubscribe.** Tour emails are transactional (a booking the person made or that concerns their own
  listing), like the login code: no unsubscribe link and no `List-Unsubscribe` header. An opt-out is a later
  spec if asked for.

## Scope
**In:**
- `api/app/services/email.py`:
  - `Attachment` (a frozen dataclass: `filename: str`, `content_type: str` e.g. `"text/calendar; method=PUBLISH;
    charset=utf-8"`, `content: str`).
  - `EmailSender.send(self, to, subject, body, attachments: Sequence[Attachment] = ()) -> None` (the protocol and
    both senders; the OTP call in `services/auth.py:222` is unchanged).
  - `SmtpEmailSender`: each attachment via `message.add_attachment(a.content, subtype="calendar",
    filename=a.filename, params={"method": …})` (split `content_type` once; the main type is always `text`).
  - `FileEmailSender`: the outbox JSON gains `"attachments": [{"filename", "content_type", "content"}]` **only when
    there are any**, so an OTP file is byte-identical to today's (e2e and `conftest.py` read it).
- `api/app/services/ics.py` (new, stdlib only, pure functions; the shape 0018d's draft asks for, so 0018d only
  imports it — contract, Risks R1). Rules under ICS:
  - `escape_text(value: str) -> str`, `fold(line: str) -> str`, `fmt_utc(t: dt.datetime) -> str`,
    `tour_uid(tour_id: uuid.UUID) -> str` (`f"{tour_id}@homie"`, the contract's one UID rule);
  - `vevent(*, uid, start, end, summary, location, description, url, stamp, sequence: int | None = None,
    status: Literal["CONFIRMED", "CANCELLED"] = "CONFIRMED", organizer: str | None = None) -> list[str]`
    (unfolded property lines `BEGIN:VEVENT` … `END:VEVENT`, `TRANSP:OPAQUE`; `SEQUENCE` / `ORGANIZER` only when given);
  - `vcalendar(events: Iterable[list[str]], *, name: str | None = None, method: str = "PUBLISH",
    refresh: dt.timedelta | None = None) -> str` (header, optional `X-WR-CALNAME`, `X-WR-TIMEZONE:Asia/Jerusalem`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT1H` + `X-PUBLISHED-TTL:PT1H` when `refresh` is set — the feed's options,
    tested here by one assert so 0018d needs no edit to the module).
- `api/app/services/tour_mail.py` (new): the queue, the renderer and the two worker entry points:
  - `QUEUE_KEY = "tour_mail"`, `MAX_ATTEMPTS = 3`, `REMINDER_LEAD = "24 hours"`.
  - `enqueue(r: RedisClient, changes: Sequence[tours.TourChange]) -> None`: nothing for an empty list, else one
    `redis_client.soft(lambda: r.rpush(QUEUE_KEY, *items))` with one `json.dumps({"tour_id": str(c.tour_id),
    "change": c.change, "attempt": 0})` per change. A Redis failure is logged by `soft` and swallowed: the change
    is already committed and the chat line (0018a) is the durable record (Risks R3). `TourChange` is imported
    under `TYPE_CHECKING` only: `tours.py` imports `tour_mail`, so a runtime import back would be circular.
  - `send_pending(db, r, sender) -> dict[str, int]`: `LPOP QUEUE_KEY 100`, then per item the rules under
    Delivery; returns `{"sent": n, "skipped": n, "retried": n, "dropped": n}`.
  - `queue_reminders(db, r) -> int`: the claim under Reminders; pushes one `{"change": "reminder"}` item per claimed
    tour; returns the count.
- `api/app/services/tours.py` (0018a's file): `announce(r, changes)` gains `tour_mail.enqueue(r, changes)` after
  its `chat_events.publish` loop. One line plus the import; `record` and every other line of 0018a stay. Every
  router that announces (book, reschedule, cancel, `update_listing`'s pause, `set_applicant_status`, `withdraw`,
  `delete_me`) gets the email for free; a rolled-back change is never announced. `announce` still never raises.
- `api/app/worker.py`: `send_tour_mail_job` (every 10 s: `second={5, 15, 25, 35, 45, 55}`, `unique=True`) and
  `tour_reminders_job` (`minute={0, 15, 30, 45}`, `unique=True`), each `asyncio.to_thread` over a `_…()` that opens a
  session like `_purge` (`send_pending(db, get_redis(), get_email_sender())`; `get_email_sender()` is a plain
  function, callable outside FastAPI); each logs its counts only (`tour mail: {…}` only when a count is non-zero,
  as the geocode sweep; `tour reminders: n` only when n > 0).
- `infra/docker-compose.yml`, the `worker` service (it sends email for the first time): `WEB_ORIGIN` (the api's
  line: the chat link must use the worktree's `WEB_PORT`), `EMAIL_BACKEND: file`, `EMAIL_OUTBOX_DIR: /outbox` and
  the volume `../.outbox:/outbox`, as the api has. Without them the worker writes to `/app/.outbox` (= `api/.outbox`
  on the host) with the 5173 link. Production: api and worker are one Fly app sharing secrets (0013a), nothing to add.
- `api/app/i18n/he.py`: the email strings under Email text.
- `api/app/services/retention.py`: `TOUR = "12 months"  # R11, after the tour's time`, `purge_tours(db)` and
  `("r11_tours", purge_tours)` appended to `_RULES` (after `r5`; tours cascade from listings and applications, so
  R1/R4/R5 may already have removed some: harmless). The module docstring lists R11.
- `api/tests/conftest.py::Outbox`: `send` takes `attachments=()` and appends them to a new `self.attachments:
  list[tuple[str, Sequence[Attachment]]]` (`(to, attachments)`); `messages` stays a list of 3-tuples, so every
  `outbox.messages[-1][2]` reader is unchanged.
- `api/tests/test_auth.py:407` (a local fake sender): gains the `attachments=()` parameter.
- `web/e2e/helpers.ts::latestCode`: skips a message whose body has no 6-digit code
  (`if (!/\b\d{6}\b/.test(message.body)) continue;`), so a tour email that lands after a login code never hides
  it; `OutboxMessage` gains `attachments?: …`. (A tour body cannot contain `\b\d{6}\b`: dates are `DD.MM.YYYY`,
  times `HH:MM`, a UUID's all-digit run is never exactly 6 long between word boundaries.)
- Privacy text, `web/src/locales/he.json` + `web/src/features/legal/content.ts`: under Privacy text.
- `web/src/features/legal/__tests__/LegalPage.test.tsx::ac12_privacy_states_retention_periods`: adds
  `[s5.i13, ['12 חודשים']]`.
- Tests: `api/tests/test_ics.py`, `api/tests/test_tour_mail.py` (new); `api/tests/test_email.py`,
  `api/tests/test_worker.py`, `api/tests/test_retention.py` (additions); names under Acceptance criteria.

**Out:**
- Any UI besides the privacy text: no "add to calendar" button in the app (the seeker's confirmation email carries
  the `.ics`; 0018d is the lister's feed).
- An opt-out, email preferences, HTML email, localisation beyond Hebrew.
- Emails to flatmates; SMS; push notifications.
- A durable outbox table (Risks R3); an email per chat message (the daily digest is its own pre-launch spec).
- Switching production to a real email provider (`0013a`, parked).
- E2E: none new. The API tests drive the hook, both jobs and the senders with the real DB and Redis; an e2e would
  only re-read the same outbox file and add to the per-shard OTP budget's machine load.

**New dependencies:** none (`json`, `email`, `dataclasses`, `datetime` are stdlib; times are formatted by
Postgres, as `api/admin/actions.py:210` does, so the image needs no `tzdata`).

## Data
No table, column or index change, **no migration**: Alembic head stays 0018a's. Reads `tours`, `listings`
(`owner_id`, `street`, `city`), `users` (`email`, `display_name`, `deleted_at`, `suspended_at`). The chat link is
`/chat/{tour.application_id}`: an application chat's id is its application's id (`ck_conversations_application_id`),
so no join on `conversations`. Writes only `tours.reminder_sent_at` (Reminders) and deletes `tours` rows (R11; their
tour lines go by `fk_messages_tour_id ON DELETE CASCADE`). Redis: one list, `tour_mail`, items
`{"tour_id": str, "change": TourChangeKind | "reminder", "attempt": int, "to"?: "lister"|"seeker"}`
(no personal data in Redis: ids and a change name only). Not cleared by e2e's `rl:*` reset; nothing else uses the key.

Checked against `specs/0018a-tour-slots.md` (Risks R2, resolved):
- A reschedule **updates the same `tours` row** (`starts_at`, `ends_at`, `updated_at`, `reminder_sent_at = NULL`;
  0018a rule 5, AC7), so the `.ics` UID stays stable and the reminder re-arms for the new time.
- `updated_at` moves on book (insert), reschedule and `cancel_upcoming` (contract); it is the `.ics` SEQUENCE source.
  0018a's rule 6 (`cancel`) does not spell out `updated_at = now()` — Verifier findings F1.
- `ix_tours_booked_starts_at (starts_at) WHERE status = 'booked'` serves the reminder claim.
- Tour lines cascade with their tour (`fk_messages_tour_id ON DELETE CASCADE`), so R11 removes them (Risks R4).

## Delivery (`send_pending`)
For each popped item (malformed JSON or an unknown `change` → `dropped`, logged by type only):
1. Load in one statement: the tour (`status`, `application_id`, `starts_at`, `ends_at`, `updated_at`), the listing
   (`street`, `city`, `owner_id`), both users' `email`, `display_name`, `suspended_at`, and the local time strings
   `to_char(timezone('Asia/Jerusalem', starts_at), 'DD.MM.YYYY')`, `… 'HH24:MI'` (start and end) and
   `extract(isodow from timezone('Asia/Jerusalem', starts_at))` (weekday index into `he.WEEKDAYS`). No row (tour
   gone) → `skipped`.
2. **State check** (the item must still describe the row): `booked`/`rescheduled`/`reminder` need `status =
   'booked'` (and, for `reminder`, `starts_at > now()`); each `cancelled_by_*` needs `status = 'cancelled'`.
   Otherwise `skipped` (a later item tells the newer story).
3. Recipients by the item's `change` and D1 (an item with `"to"` is a retry for that side only). Skip a recipient
   whose `email IS NULL` (deleted) or `suspended_at IS NOT NULL` → counted in `skipped`. A `display_name` that is
   NULL (the other side deleted the account after the change) renders as `he.TOUR_DELETED_NAME`.
4. Render (Email text) and `sender.send(to, subject, body, attachments)`. `EmailUnavailable` → re-push
   `{…, "to": side, "attempt": attempt + 1}` to the queue's tail if `attempt + 1 < MAX_ATTEMPTS` (`retried`), else
   `dropped`. Any other exception on an item → `db.rollback()`, that item `dropped`, its type logged
   (`log.error("tour mail item failed: %s", type(exc).__name__)`, never `log.exception`: a SQLAlchemy message carries
   bound parameters such as an address), and the loop goes on (no item is lost to a bug in another, none loops).
5. Never log an address, a name, a time or an id: counts and exception types only.

Item order is not guaranteed across retries; the state check keeps a stale item from sending the wrong story.

## Reminders (`queue_reminders`)
One statement, then the pushes:
```sql
UPDATE tours SET reminder_sent_at = now()
WHERE status = 'booked' AND reminder_sent_at IS NULL
  AND starts_at > now() AND starts_at <= now() + CAST(:lead AS interval)
  AND updated_at <= starts_at - CAST(:lead AS interval)
RETURNING id
```
Then `rpush` one `{"tour_id", "change": "reminder", "attempt": 0}` per id (plain `r.rpush`, not `soft`: the worker
runs on Redis). Claim-then-push is idempotent: a second run claims nothing (AC9). A Redis error after the claim
loses that sweep's reminders (logged); the row is not re-armed (better no reminder than two).

## ICS (`services/ics.py`)
- Lines joined by CRLF, ending with CRLF; every content line folded at 75 **octets** (UTF-8) with CRLF + one space,
  never inside a multi-byte character (Hebrew is 2 bytes a letter).
- `escape_text`: TEXT values (`SUMMARY`, `LOCATION`, `DESCRIPTION`) escape `\` → `\\`, `;` → `\;`, `,` → `\,`,
  `\r\n` / `\n` → `\n`, and drop other control characters, so user text (a display name, a street) can never start
  a new property.
- `vcalendar`: `BEGIN:VCALENDAR`, `VERSION:2.0`, `PRODID:-//homie//tours//HE`, `CALSCALE:GREGORIAN`,
  `METHOD:{method}`, the optional lines above, the events, `END:VCALENDAR`; every line folded.
- `vevent`: `UID:{uid}`, `DTSTAMP:{fmt_utc(stamp)}`, `SEQUENCE:{sequence}` when given, `DTSTART`/`DTEND` via
  `fmt_utc` (`YYYYMMDDTHHMMSSZ`, aware datetimes only: no `VTIMEZONE` needed; calendars show local time),
  `SUMMARY`, `LOCATION`, `DESCRIPTION`, `URL`, `ORGANIZER;CN=homie:mailto:{organizer}` when given (RFC 5546 wants it
  for CANCEL), `STATUS:{status}`, `TRANSP:OPAQUE`.
- The email caller: `vcalendar([vevent(uid=tour_uid(tour.id), start, end, summary=he.TOUR_ICS_SUMMARY…,
  location=he.TOUR_WHERE…, description=url, url=url, stamp=now, sequence=int(tour.updated_at.timestamp()),
  status="CONFIRMED"|"CANCELLED", organizer=settings.email_from)], method="PUBLISH"|"CANCEL")` with
  `url = f"{settings.web_origin}/chat/{tour.application_id}"`. SEQUENCE is epoch seconds of `updated_at` (the
  contract's source; fits RFC 5545's 32-bit INTEGER until 2038).
- Attachment: `tour.ics`, `text/calendar; method=PUBLISH|CANCEL; charset=utf-8`.

## Email text (`api/app/i18n/he.py`)
Voice: impersonal, no gendered forms (PRODUCT.md "Slice 9 copy + UX"); placeholders only, final wording Slice-9
style is the coder's within these lines. **No user text in a subject** (a header): names go in the body only.
- `WEEKDAYS = ("יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת", "יום ראשון")` (ISO 1–7).
- `TOUR_WHEN = "{weekday}, {date}, {start}–{end}"`; `TOUR_WHERE = "רחוב {street}, {city}"`;
  `TOUR_ICS_SUMMARY = "סיור: רחוב {street}, {city}"`; `TOUR_FOOTER = "לצ'אט: {url}\nההודעה נשלחה כי נקבע סיור בהומי."`.
- `TOUR_BOOKED_SUBJECT = "נקבע סיור"`, `TOUR_BOOKED_LISTER_BODY = "נקבע סיור עם {name}.\n{when}\n{where}\n\n{footer}"`,
  `TOUR_BOOKED_SEEKER_BODY = "הסיור נקבע.\n{when}\n{where}\n\n{footer}"`.
- `TOUR_RESCHEDULED_SUBJECT = "מועד הסיור השתנה"` + `…_LISTER_BODY` / `…_SEEKER_BODY` (the new time).
- `TOUR_CANCELLED_SUBJECT = "הסיור בוטל"` + `TOUR_CANCELLED_BODY = "הסיור עם {name} בוטל.\n{when}\n{where}\n\n{footer}"`
  (a seeker or lister cancel); for a system cancel `TOUR_CANCELLED_SYSTEM_BODY`: "הסיור בוטל כי המודעה או המועמדות כבר
  לא פעילות.").
- `TOUR_REMINDER_SUBJECT = "תזכורת: סיור מחר"` + `TOUR_REMINDER_BODY` (when, where, with whom, footer).
- `TOUR_DELETED_NAME = "משתמש/ת שנמחק/ה"` (the web's `account.deletedName`).

What an email reveals: the other side's **display name** (already shown to both in the chat the shortlist opened),
the listing's **street and city** (public on the listing page; homie stores no house number), the time, and the
chat link (useless without a session). **Never** the other side's email address, the seeker's profile, budget or
score; `From` is `EMAIL_FROM`, no `Reply-To`.

## Privacy text (`web/src/locales/he.json`, `legal.privacy.*`; `content.ts` lists the new keys in order)
- `s1.i1`: "האימייל משמש רק לכניסה (…) ולפניות שלנו בנוגע לחשבון" → "… ולפניות שלנו בנוגע לחשבון ולסיורים שנקבעו".
- `s1.i16` (new, after `i9` in `content.ts`): "סיורים: מי שבעלי המודעה בחרו לרשימה הקצרה רואים את המועדים הפנויים
  לסיור וקובעים אחד. בעלי המודעה רואים את השם ואת המועד. על כל קביעה, שינוי או ביטול נשלח אימייל לצד השני, ושני
  הצדדים מקבלים תזכורת יום לפני. האימייל כולל את השם, את הרחוב והעיר של המודעה ואת המועד, ולא את כתובת האימייל של
  הצד השני." (0018a's slot visibility as written in the contract; 0018d adds its own line for the feed.)
- `s3.i2`: "(שליחת קודי הכניסה)" → "(שליחת קודי הכניסה והודעות על סיורים)".
- `s5.i13` (new, last in s5): "סיורים: נמחקים 12 חודשים אחרי מועד הסיור, יחד עם השורות עליהם בצ'אט, או קודם,
  יחד עם המודעה או המועמדות שלהם. דיווח פתוח משאיר אותם, כמו בסעיף על דיווחים."

## R11 (`purge_tours`)
```sql
DELETE FROM tours t
WHERE t.starts_at < now() - CAST(:period AS interval)
  AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.resolved_at IS NULL AND (
        (r.target_type = 'listing' AND r.target_id = t.listing_id)
     OR (r.target_type = 'applicant' AND r.target_id = t.application_id)
     OR (r.target_type = 'chat' AND r.target_id IN
          (SELECT c.id FROM conversations c WHERE c.application_id = t.application_id))))
```
Set-based, `_run(db, …, TOUR)`, compared in SQL as every rule.

## Acceptance criteria
- [ ] AC1 A seeker books a slot → after `send_pending`, the lister gets `TOUR_BOOKED_SUBJECT` with a `tour.ics`
  (`METHOD:PUBLISH`, `STATUS:CONFIRMED`, `UID:{id}@homie`, the UTC start/end) and the seeker gets the
  confirmation with the same UID; neither body contains the other's email address —
  `api/tests/test_tour_mail.py::test_ac1_booking_emails_both_with_ics`
- [ ] AC2 A reschedule → both get the rescheduled email; the `.ics` keeps the UID and its `SEQUENCE` is greater than
  the booking's; DTSTART is the new time (the test sends the booking mail, then backdates `updated_at` by one minute
  with SQL before rescheduling, so both changes never share an epoch second) — `test_tour_mail.py::test_ac2_reschedule_same_uid_higher_sequence`
- [ ] AC3 Seeker cancels → only the lister gets `TOUR_CANCELLED_SUBJECT` with `METHOD:CANCEL`/`STATUS:CANCELLED`;
  lister cancels → only the seeker; a system cancel (pause the listing; withdraw) → both, with
  `TOUR_CANCELLED_SYSTEM_BODY`; every CANCEL keeps the UID with a SEQUENCE ≥ the booking's —
  `test_tour_mail.py::test_ac3_cancel_recipients_by_cancelled_by`
- [ ] AC4 A deleted or suspended recipient gets nothing; the other side still does, and a deleted other side's name
  reads `TOUR_DELETED_NAME` —
  `test_tour_mail.py::test_ac4_skips_deleted_and_suspended`
- [ ] AC5 A stale item sends nothing: a `booked` item for a tour now cancelled, a `cancelled_by_*` item for a
  booked tour, an item for a deleted tour, a malformed item, an unknown `change`; an item whose load raises a
  non-email error is dropped and the next item is still sent — `test_tour_mail.py::test_ac5_stale_items_skipped`
- [ ] AC6 `EmailUnavailable` for one recipient re-queues only that side with `attempt + 1`; the third failure drops
  it; the other side is sent once — `test_tour_mail.py::test_ac6_retry_per_recipient_then_drop`
- [ ] AC7 `tours.announce` enqueues one item per change with 0018a's `change` kind, for booking, reschedule, both
  cancels and the system cancels (pause, un-shortlist, withdraw, `DELETE /me`), and the API call succeeds with Redis
  down (the item is lost, the tour and chat line are not) —
  `test_tour_mail.py::test_ac7_hook_enqueues_and_survives_redis_down`
- [ ] AC8 Reminders: a tour starting in 23 h booked 3 days ago is claimed and both sides get `TOUR_REMINDER_SUBJECT`;
  one starting in 25 h, one booked 10 h before its start, a cancelled one and a past one are not —
  `test_tour_mail.py::test_ac8_reminder_window`
- [ ] AC9 A second `queue_reminders` run claims nothing; a reschedule after a reminder (0018a sets
  `reminder_sent_at = NULL`) re-arms it for the new time — `test_tour_mail.py::test_ac9_reminder_idempotent_and_rearmed`
- [ ] AC10 The email shows the time in Asia/Jerusalem with the Hebrew weekday (a tour at 15:20Z in November reads
  `17:20`; one in July reads `18:20`), the listing's street and city, the other side's display name and the chat
  link `{WEB_ORIGIN}/chat/{conversation_id}` — `test_tour_mail.py::test_ac10_body_local_time_and_fields`
- [ ] AC11 `.ics` rules: CRLF endings, every line ≤ 75 octets and folds never split a UTF-8 character (a 40-letter
  Hebrew name), `;` `,` `\` and a newline in a name/street are escaped (no injected property line), DTSTART/DTEND end
  in `Z`, `tour_uid` is `{id}@homie`, CANCEL carries `ORGANIZER`, and `vcalendar(…, name=…, refresh=1 h)` adds
  `X-WR-CALNAME` and `REFRESH-INTERVAL` (the feed's options, 0018d) — `api/tests/test_ics.py::test_ac11_fold_escape_utc`
- [ ] AC12 `FileEmailSender` writes `attachments` only when given (an OTP file has exactly the old four keys);
  `SmtpEmailSender` sends a `text/calendar` part with `method=` and filename `tour.ics` —
  `api/tests/test_email.py::test_ac12_attachments_file_and_smtp`
- [ ] AC13 Both crons are registered (`send_tour_mail_job` every 10 s at `second={5,…,55}`, `tour_reminders_job` at
  `minute={0,15,30,45}`, both `unique`), and their log lines hold counts only (no email, name, street or id) —
  `api/tests/test_worker.py::test_ac13_tour_mail_crons_registered_and_log_counts`
- [ ] AC14 R11 deletes a tour 12 months + 1 day after its start, keeps one 11 months after, and keeps an old one
  whose listing, application or conversation has an unresolved report —
  `api/tests/test_retention.py::test_r11_tours`
- [ ] AC15 The privacy page shows `s1.i16` and `s5.i13` with "12 חודשים", and `s1.i1`/`s3.i2` mention tours —
  `web/src/features/legal/__tests__/LegalPage.test.tsx::ac12_privacy_states_retention_periods` (extended) and
  `make i18n-check`
- [ ] AC16 `latestCode` returns the login code when a tour email to the same address is newer —
  covered by the existing e2e that sign up (CI); the helper change is one line

## Tests to write
Unit: `test_ics.py` (fold, escape, UTC, PUBLISH/CANCEL). Integration (Postgres + Redis via compose):
`test_tour_mail.py` drives 0018a's real endpoints for book/reschedule/cancel/pause, then calls
`send_pending(db, r, outbox)` with conftest's `Outbox`, and `queue_reminders` with times set by SQL `UPDATE`s
(never a Python clock in the SQL); `test_email.py`, `test_worker.py`, `test_retention.py` additions. Vitest: the
extended privacy test. E2E: none new (Out).

## Blast radius
`graphify affected` (main's graph, 2026-11-16, verifier re-run):
- `EmailSender` (protocol): `services/auth.py::request_otp` (`:56` import, `:210`, the call `:222`),
  `routers/auth.py` (`:37`, `request_otp` `:105`), `get_email_sender` (`email.py:85`), `api/tests/conftest.py` (`:58`,
  `outbox()` `:346`); the other importers the graph lists (`routers/photos.py`, `app/main.py`, `app/auth.py`,
  `routers/events.py`, `services/flatmates.py`, `services/accounts.py`, `test_account_deletion.py`, `test_google.py`,
  `test_market_people.py`) import other names from `app.services` modules, not the protocol: untouched. Every
  implementer in the repo (grep `def send(self, to`): `FileEmailSender`, `SmtpEmailSender`, conftest `Outbox`
  (`:336`), `test_auth.py::test_ac17…`'s `FailingSender` (`:407`) — all four in Scope. The new parameter has a
  default, so the OTP call and its tests do not change.
- `FileEmailSender`: `get_email_sender` (`:91`), `routers/auth.py` (`:37`, `:101`), `conftest.py`, `test_auth.py`
  (`:26`); the outbox file of an OTP keeps exactly `{to, subject, body, sent_at}` (AC12), so `latestCode` and the
  e2e signups read it unchanged.
- `SmtpEmailSender`: `get_email_sender` (`:90`), `test_email.py` (`test_smtp_sender_parses_url` `:35`,
  `…_logs_in_with_url_credentials` `:59`, `…_raises_email_unavailable` `:77`, `test_smtp_url_scheme_validated` `:87`):
  unchanged, `set_content(body)` stays the first part.
- `get_email_sender`: `routers/auth.py::request_otp` (`:101`) and ~40 test modules that import it to override it
  (all via conftest's `outbox` fixture, `Outbox` unchanged for 3-arg callers); the worker becomes a new caller.
- `Outbox` (conftest): imported by ~35 test modules (`signup()` `:374`, `test_flat_profile.py` `Flat.__init__`
  `:129`, `test_account_deletion.py` ac7/ac8/ac14…); all read `outbox.messages` 3-tuples (`messages[-1][2]`,
  `messages[0]` unpacked in `test_auth.py:85`, `== []` at `:351`, `:654`) — kept as 3-tuples, attachments go to the
  new `outbox.attachments`.
- `purge_expired` / `_RULES` (`_RULES` itself has no graph node; grep): `worker.py::_purge` (`:76`) →
  `purge_expired_job` (`:82`); `test_retention.py` (`_purge` `:192`; r1–r10, ac10 `:518`, ac11 `:553` idempotent,
  ac13 `:610` unresolved report) must pass with R11 appended; `test_worker.py::test_ac11_purge_cron_registered`
  asserts every count is 0 and logs `retention purge: {counts}` (R11's key joins the dict: still passes);
  `test_cbs_rent.py:392`, `test_rent_reference.py:402` import from `app.worker` only.
- `WorkerSettings.cron_jobs` (graph: spec references only; grep): `test_worker.py` looks each job up by coroutine
  (ac5, ac8, nf3, ac11, ac12, ac13): two more jobs break none. `infra/docker-compose.yml` worker env: Scope.
- `latestCode` (`web/e2e/helpers.ts`): `signUp` (`:95`), `signUpOwner` (`:106`), `signUpApi` (`:124`) and through
  them `account`, `auth`, `flatmates`, `listings`, `applications`, `market`, `reports`, `inbox`, `likes`,
  `people-market`, `people`, `search` `.spec.ts`: the added skip only ignores a message without a 6-digit code, so
  every OTP read is unchanged.
- `tours.announce` (0018a, not on `main` yet: no graph node): per 0018a its callers are `routers/tours.py` (book,
  reschedule, cancel), `routers/listings.py::update_listing`, `routers/applications.py` (status, withdraw) and
  `routers/auth.py::delete_me`; none changes — the enqueue sits inside `announce`. `tours.TourChange` /
  `TourChangeKind` are read, not changed. The build session re-runs `graphify affected "announce"` once 0018a is on
  `main`.
- Legal: `web/src/features/legal/content.ts` (`privacyDoc`), `LegalPage.test.tsx` (ac12 at `:98`; its
  `Object.values(s5)` no-`[` loop covers `s5.i13`; the s3 order test is unchanged; 0018d adds `s3.i7` after `i6`,
  no clash with `s3.i2`'s edit).

## Risks / open questions
- **R1 Shared `.ics` code with 0018d (resolved by the contract).** This spec creates `api/app/services/ics.py` with
  the exact function set 0018d's draft names (`escape_text`, `fold`, `fmt_utc`, `tour_uid`, `vevent`, `vcalendar`)
  plus `vevent`'s `status` and `organizer` keywords (defaults keep the feed's output). 0018d's verifier sets its
  `depends_on` to `[0018a, 0018b, 0018c]` and drops `ics.py` from its Scope (Verifier findings F2).
- **R2 Requirements on 0018a (resolved):** see Data; one gap, F1.
- **R3 Lost emails.** The queue is a Redis list: a Redis outage at enqueue loses that email (the chat line stays);
  a worker crash between `LPOP` and send loses up to 100 items. `shortcut: a Redis list, not a durable outbox
  table; upgrade to a tours_outbox table if production logs show lost tour mail`. Acceptable for v1 (the existing
  pattern: listing views live in Redis until flushed).
- **R4 R11 vs the chat line (resolved).** 0018a's `fk_messages_tour_id` is `ON DELETE CASCADE`: R11 deletes a
  12-month-old tour's lines with it (contract: "or cascade"); `last_message_at` does not move back (harmless). The
  privacy line `s5.i13` says so.
- **R5 Email bombing — Gilad (with 0018a R12).** Decided 2026-11-16 (Gilad): 0018a's bucket is lowered to `TOUR = Bucket("tour", 10, 20)`. Was: `TOUR = Bucket("tour", 20, 60)` (20 an hour, 60 a
  day per account), above this spec's ≤ 10/h bar. Worst case one shortlisted seeker looping book → cancel: 30 pairs
  a day = 60 emails to one lister + 30 confirmations to themselves (~90 a day, a third of a 300/day free tier).
  Options: (a) keep 20/60 (default, the coder changes nothing); (b) lower `TOUR` to 10/20 in 0018a; (c) a per-lister
  daily mail cap here. Recommendation (b), a one-line change in 0018a.
- **R6 Production.** There is no production deploy yet (`0013a` verified, unbuilt); once deployed, `EMAIL_BACKEND`
  stays `file` until an email provider is approved (parked, "everything that costs money"), and tour mail lands in
  the container's outbox like the login codes. The provider's free tier must cover login codes plus ~4 emails a tour.
- **R7 `.ics` behaviour differs by client** (Gmail shows PUBLISH as an "add to calendar" card; some clients
  ignore CANCEL without a matching ORGANIZER). Not a test target; manual check by Gilad after the provider is live.
- Defaults D1–D4 and R11's 12 months are the orchestrator's; Gilad may overturn any in the digest without blocking
  the build.

## Verifier findings (2026-11-16, one round; fixed in the spec unless marked open)
Fixed here: the hook is 0018a's `announce(r, changes)` (was "one change hook" with `get_redis()` and an in-transaction
caveat); queue items carry 0018a's `TourChangeKind` (D1 table, state check, AC3/AC5/AC7); UID is the contract's
`{tour_id}@homie` via `tour_uid` (was `tour-{id}@homie`); `ics.py` takes 0018d's function set so one module serves
both; the chat link uses `application_id` (no `conversations` join); Goal's system-cancel list matches 0018a
(no expiry, no listing delete exists, admin cancels are silent); the compose worker gets `WEB_ORIGIN`, the email
backend env and the `.outbox` volume (it had none); a NULL display name renders `TOUR_DELETED_NAME`; a non-email
exception drops only its item and never logs a traceback (SQL params hold addresses); AC2 backdates `updated_at` so
SEQUENCE cannot tie within one second; the privacy line `s5.i13` names the chat lines R11 removes; Blast radius
re-run with every hit.

Open, for the orchestrator (no coder guess needed; the spec states the default):
- **F1 (0018a).** 0018a rule 6 (`cancel`) does not say `updated_at = now()`, which the contract requires (the
  CANCEL `.ics` SEQUENCE must exceed the PUBLISH's). Add it to 0018a's rule 6 when 0018a/0018e are next edited;
  0018c's AC3 asserts CANCEL's SEQUENCE ≥ the booking's either way.
- **F2 (0018d).** 0018d still lists `depends_on: [0018a, 0018b]` and owns `ics.py` in its Scope; the contract says
  0018c creates it. 0018d's verifier aligns it (import only).
- **F3 (contract wording).** `TOURS-PLAN.md` R11 says a tour is kept while an unresolved report covers "its
  conversation"; this spec also keeps it for a report on its listing or application (as R1/R4/R5 do). A superset,
  safe; the orchestrator updates the contract line.

Gilad questions (digest): D1–D4 defaults; R11's 12 months (PRODUCT.md "Retention" gains R11 after his yes); R5's
rate (recommend `TOUR` 10/h, 20/day in 0018a).

## Digest (filled by orchestrator after verification)
See `/digest`.
