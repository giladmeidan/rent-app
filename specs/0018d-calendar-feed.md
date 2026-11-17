---
id: 0018d
title: A lister turns on a private calendar link and subscribes to it from Google Calendar (or Apple / any calendar app); their booked tours show up there, and they can replace or turn off the link at any time
status: in-review
depends_on: [0018a, 0018b, 0018c]   # 0018a: the `tours` and `tour_feeds` tables (its migration; this spec adds none). 0018b: the `/tours` page whose `PageHeader` `actions` slot this spec fills (0018b depends on 0018e if 0018a's web half is split, so the web half here follows it). 0018c: creates `api/app/services/ics.py`, which this spec extends (TOURS-PLAN "Shared contract"). Branch from the last open dependency's branch while its PR is open; merge origin/main after it lands (Speed rule 3)
reviewers: [code, security, qa]   # security: an unauthenticated endpoint keyed by a bearer token in the URL, PII (seeker's name, listing address) leaving homie for a third-party calendar, token hashing and revocation, log redaction. qa: 4 endpoints + one dialog with 6 states. No ux: one header button + dialog on 0018b's page, built from the flatmate-invite block's pattern (0009qb); no perf: one PK/unique lookup + one bounded query (≤ 500 rows)
estimate: 1 coder run   # coder Opus/high (security: token handling, Speed rule 6); no migration; about 15 files, half tests
---

## Goal
After this ships a lister opens `/tours`, presses "קישור ליומן", and adds the link to Google Calendar (one click)
or any calendar app (`webcal://`); every booked tour of their listings appears there and stays current as tours
are booked, moved or cancelled. The link is shown once, can be replaced (the old one stops working) or turned off,
and dies with the account. PRODUCT.md "Tours" (Gilad 2026-11-16: Google Calendar in v1 is a private, revocable
iCal feed URL, no Google permission); `specs/TOURS-PLAN.md` "Shared contract".

## Decisions this spec builds on (do not reopen)
1. Google Calendar in v1 = a **subscribed iCal feed** (RFC 5545 over HTTPS), read-only; no Google OAuth, no write
   into the lister's calendar (two-way sync is a later slice, TOURS-PLAN "Later").
2. One feed per account (a lister's tours across all their listings), not per listing.
3. The token follows the flatmate-invite link's pattern (`services/flatmates.py`, spec 0008d): `secrets.token_urlsafe(32)`
   (43 characters); only its sha256 reaches Postgres, in 0018a's `tour_feeds` row; creating again rotates; off =
   the row deleted. The raw token is returned once and never again.
4. A calendar app cannot send a header or cookie, so the token **must** travel in the URL path. That is the one
   place in homie a secret sits in a URL; everything below (log redaction, no cookie read, no-store on the token
   response, shape check before the DB) exists because of it.

## Scope
**In (API):**
- `api/app/services/ics.py` (**0018c's file**; orchestrator 2026-11-16 after 0018c's build: 0018c ships the public
  `escape_text`, `fold`, `fmt_utc`, `tour_uid`, `vevent(..., status, organizer)` and `vcalendar(events, *, name,
  method, refresh)`; this spec **imports** them and changes none of them, so 0018c's `test_ics.py` /
  `test_tour_mail.py` pass unchanged):
  - The feed body is `ics.vcalendar([ics.vevent(..., status="CONFIRMED", organizer=None) for each tour], name=name,
    method="PUBLISH", refresh=dt.timedelta(hours=1))`; `feed_calendar(...)` may be a thin wrapper over that call in
    `ics.py` or `tour_feed.py`, nothing more. UID = `ics.tour_uid(tour.id)` (already used by `tour_mail.py`). No
    `tour_calendar`, no private `_vevent`, no edit to `tour_mail.py`. That call already gives this spec's header order
    (`X-WR-CALNAME`, `REFRESH-INTERVAL`), CRLF and folding; no events → a valid empty `VCALENDAR` with no `DTSTAMP`
    (0018c's `test_ics` covers it), which is also the dead-token body.
- `api/app/services/tour_feed.py` (new):
  - `TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{43}")` (`fullmatch`); `_hash(token) = auth._token_hash(token)`
    (0018a's `token_hash` is `text`, sha256 hex like the other token hashes).
  - `FEED_PAST = dt.timedelta(days=30)`, `FEED_MAX_EVENTS = 500` (comment: Google re-reads the whole feed; past
    month is enough context and keeps old names out of third-party calendars; the cap bounds a response).
  - `feed_active(db, user) -> bool` (row exists); `create_feed(db, user) -> str` (rotate: one `INSERT INTO tour_feeds
    (user_id, token_hash) … ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now()`,
    commit, return the raw token; two concurrent POSTs: the last commit wins, the other token is dead);
    `disable_feed(db, user) -> None` (`DELETE FROM tour_feeds WHERE user_id = :me`, idempotent).
  - `feed_for_token(db, token, now) -> str | None`: `None` when `TOKEN_RE` does not match (no query); else one select
    `tour_feeds ⨝ users ON users.id = tour_feeds.user_id WHERE token_hash = _hash(token) AND users.deleted_at IS NULL
    AND users.suspended_at IS NULL` → `None` if no row; else the calendar text from one query: `tours` ⨝ `listings`
    (`listings.owner_id = owner`) ⨝ `users` seeker (`seeker.deleted_at IS NULL`: a tombstone has no name, and a
    deleted seeker leaves the feed) `WHERE tours.status = 'booked' AND tours.starts_at >= now - FEED_PAST ORDER BY
    tours.starts_at, tours.id LIMIT FEED_MAX_EVENTS`. Any listing status: an expired listing's booked tours stay
    booked and stay in the feed (TOURS-PLAN contract: expiry does not cancel); pause / close / delete / admin hide
    already cancel them (0018a). Cancelled tours are **left out**, not sent as `STATUS:CANCELLED`: a subscribed
    calendar replaces the whole feed on each refresh, so a missing UID is removed.
  - Each event: `uid = ics.tour_uid(tour.id)`, `sequence = int(tour.updated_at.timestamp())` (0018c's rule),
    `starts_at/ends_at` = the tour's, `summary = he.TOUR_ICS_SUMMARY.format(street=…, city=…)` and
    `location = he.TOUR_WHERE.format(…)` (0018c's strings, reused), `description = he.TOUR_FEED_DESCRIPTION.format(
    name=seeker display name, url=…)`, `url = f"{settings.web_origin}/tours"`, `stamp = now`. Nothing else about the
    seeker: no email, no application message, no profile field, no photo.
  - `redact_path(path: str) -> str`: `re.sub(r"/tour-feed/[^\s\"]*", "/tour-feed/[redacted]", path)` (also strips
    whatever follows up to whitespace or a quote, a query string included). `RedactFeedToken(logging.Filter)`: applies `redact_path` to
    `record.msg` and to every `str` in `record.args` (uvicorn passes the path with query as `args[2]`); returns True.
- `api/app/i18n/he.py`: `TOUR_FEED_NAME = "סיורים בהומי"`, `TOUR_FEED_DESCRIPTION = "סיור עם {name}\nלפרטים ולצ'אט: {url}"`.
- `api/app/schemas/tour_feed.py` (new): `TourFeedOut {active: bool}`, `TourFeedTokenOut {token: str}` (docstring:
  shown once, as `InviteOut`).
- `api/app/routers/tour_feed.py` (new), registered in `api/app/main.py` next to the other routers (see API).
- `api/app/main.py`:
  - `create_app`: `logging.getLogger("uvicorn.access").addFilter(RedactFeedToken())` unless a `RedactFeedToken` is
    already in that logger's `filters` (`create_app` runs per test and once more at import).
  - `_database_unavailable` and `_redis_unavailable` log `redact_path(request.url.path)` instead of
    `request.url.path` (a 503 on the feed would otherwise write the token to `app.main`'s log).
  - Production check (R4, done by the verifier): the API runs `uvicorn` with its default access log
    (`infra/Dockerfile.api` CMD), output goes to `fly logs` (≤ 30 days, 0013a); no other code logs request paths
    (`grep request.url` in `api/app`: only the two handlers above); Fly's proxy does not write request paths into the
    app's logs. The filter plus the two handlers cover every path into our logs.
- `api/app/services/accounts.py::delete_account`: `delete(TourFeed).where(TourFeed.user_id == me)` in the step
  7.–11. tuple (TOURS-PLAN contract: a tombstone never fires the FK cascade).
- `api/tests/test_hardening.py`: `LIMITED` gains `("POST", "/me/tour-feed", "WRITE", None)` and
  `("DELETE", "/me/tour-feed", "WRITE", None)`; `assert len(limited) == …` goes up by 2 from whatever `main` has when
  this merges (19 on today's `main`, plus 0018a's); the second to merge updates the count (Risks R3).
- `api/tests/test_tour_feed.py` (new), `api/tests/test_ics.py` (0018c's; AC13 added), `api/tests/test_account_deletion.py`
  (one test, AC9), `api/tests/test_db_errors.py` (one test, AC12).
- `make client`.

**In (web):**
- `web/src/features/tours/feedApi.ts` (new): `getTourFeed()`, `createTourFeed()`, `disableTourFeed()` over the
  generated client (non-2xx → `ApiError`, as `features/flatmates/api.ts`), and `feedUrls(token): { https: string;
  webcal: string; google: string }`:
  - `https = new URL(\`/tour-feed/${token}.ics\`, import.meta.env.VITE_API_URL).toString()`;
  - `webcal = https.replace(/^https?:/, 'webcal:')`;
  - `google = 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(webcal)`.
- `web/src/features/tours/CalendarFeedButton.tsx` (new): a `Button` (`tours.feed.title`) for 0018b's `PageHeader`
  `actions` slot that opens a `Dialog` (`components/Dialog`, title `tours.feed.title`) holding the states below,
  modelled on `FlatmatesPage.tsx`'s invite block (create / once-warning / copy with the clipboard fallback / rotate
  and disable behind `useConfirm`; the confirm stacks on the native `<dialog>` top layer). The token lives in this
  component's state: it survives closing and reopening the dialog on the same visit, and is gone after a reload or
  navigation.
- `web/src/features/tours/ToursPage.tsx` (0018b's page): `actions={<CalendarFeedButton />}` on its `PageHeader`.
- `web/src/locales/he.json`: `tours.feed.*` keys (UI) and `legal.privacy.s3.i7`; `web/src/features/legal/content.ts`
  lists `legal.privacy.s3.i7` right after `i6` (so 0016b's `i3` → `i6` order test is unchanged).
- `web/src/features/tours/__tests__/CalendarFeedButton.test.tsx` (new); `web/src/features/legal/__tests__/LegalPage.test.tsx`
  (one test, AC18).

**Out:**
- Two-way Google sync, writing events into the lister's own calendar, reading busy times (later slice).
- A feed for **seekers** (their booked tours): the email `.ics` (0018c) covers them.
- A per-listing feed; choosing what the feed shows; time-zone `VTIMEZONE` blocks (all times are UTC `Z`, which every
  client converts; `X-WR-TIMEZONE` names the display zone).
- `HEAD` support on the feed route, `ETag` / `If-None-Match` (calendar clients re-read on their own schedule; the
  response is small).
- e2e: none (Google cannot reach a CI stack; API + vitest cover it). `make screens` states for the dialog: 0018b owns
  the tours page's screens.

**New dependencies:** none (stdlib `secrets`, `hashlib`, `re`, `logging`, `dataclasses`).

## Data
No migration here. Uses **0018a's** `tour_feeds` table as 0018a defines it: `user_id` uuid PK FK `users.id` ON
DELETE CASCADE, `token_hash` text NOT NULL UNIQUE, `created_at` timestamptz NOT NULL `now()`. The UNIQUE index
serves the feed lookup; the PK serves `GET`/`POST`/`DELETE /me/tour-feed`. The admin role cannot read the table
(0018a, `_NO_ACCESS`); `scripts/admin_role.py` unchanged here.
- `delete_account` deletes the row (above); suspension leaves it (lifting a suspension brings the same link back).
- Feed query indexes: `ix_listings_owner_id` (owner → listings) and 0018a's `uq_tours_listing_slot (listing_id,
  starts_at) WHERE status = 'booked'` (listing → booked tours by start).

## API
Auth helpers as `routers/flatmates.py` (`UserDep`, `_SESSION` → 401 `unauthenticated`, `limits.RATE_LIMITED`).

| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/me/tour-feed` | Signed in, any role (`current_user`) | — | 200 `TourFeedOut {active}` | 401 `unauthenticated`; 503 DB down |
| POST | `/me/tour-feed` | Signed in, any role; `limits.check(r, me.id, limits.WRITE)` first | no body | 201 `TourFeedTokenOut {token}`, `Cache-Control: no-store`. Creates or **rotates** (the old token stops working at once) | 401; 429 `rate_limited` + `Retry-After`; 503 |
| DELETE | `/me/tour-feed` | Signed in, any role; `limits.WRITE` first | — | 204 (also when already off) | 401; 429; 503 |
| GET | `/tour-feed/{token}.ics` | **Public, no session**: the handler takes no `UserDep` / `optional_user` and reads no cookie; `dependencies=[Depends(limits.read_limit)]` (per network, soft on a Redis failure) | — | 200, `Content-Type: text/calendar; charset=utf-8`, `Cache-Control: private, max-age=300`, `Content-Disposition: inline; filename="homie-tours.ics"`, body = `ics.feed_calendar(…, name=he.TOUR_FEED_NAME)`; an account with no tours gets a valid empty calendar | 404 `{"detail":"not_found"}` for a malformed token only; a well-formed unknown, rotated or disabled token, or a suspended or deleted owner, gets **200 with the empty calendar**, byte-identical to an active feed with no tours (no `DTSTAMP`), so a subscribed calendar wipes its old copy (Gilad 2026-11-16, Q2); 429 `rate_limited`; 503 |

Any role: a room can be posted by any account (PRODUCT.md "Account roles"); a seeker with no listings gets an empty
feed, harmless. `include_in_schema=False` is **not** used: the feed route stays in OpenAPI (so `make client` and
hardening tests see it) with `responses={200: {"content": {"text/calendar": {}}}, 404: …, **limits.RATE_LIMITED}`.
Error order of the feed: 429 (dependency) → 404 shape → lookup (a miss is the empty calendar, never an error). A path without the `.ics` suffix does not match
the route (the framework's own 404); that tells a caller nothing about any token. The token response and the feed
never set a cookie. CORS: none needed (calendar servers fetch server-to-server; the web never fetches the feed).

## UI
No artboard (PRODUCT.md "Brand": no new artboards); components from the kit (`Button`, `Dialog`, `TextInput`,
`Skeleton`, `ErrorState`, `useConfirm` from `components/Dialog`), anatomy of the flatmate invite block (0009qb).
The URL field and the links are `dir="ltr"`; the rest of the dialog is RTL; logical properties only. The header
button sits in 0018b's `actions` slot (inline end of the header row, which in RTL is the left).

States inside the dialog (`useQuery(['tour-feed'])` on `getTourFeed`, fetched when the dialog first opens):
- **loading**: `Skeleton` lines.
- **error**: `ErrorState` with retry (`common.error`, `common.retry`).
- **off** (`active: false`): `tours.feed.hint`, button `tours.feed.create`.
- **just created / rotated** (token in component state only, never in storage or the query cache): read-only
  `TextInput` (`tours.feed.linkLabel`) with the `https` URL; `tours.feed.copy` (clipboard; on failure select the
  text, as the invite block) with a polite live region `tours.feed.copied`; link button `tours.feed.addGoogle`
  (`href = google`, `target="_blank"`, `rel="noopener noreferrer"`); link `tours.feed.addOther` (`href = webcal`);
  `tours.feed.onceWarning`; `tours.feed.delay`.
- **active** (`active: true`, no token in memory, e.g. after a reload): `tours.feed.active`, `tours.feed.delay`,
  buttons `tours.feed.rotate` (confirm `tours.feed.rotateConfirm` / `tours.feed.rotateBody`) and `tours.feed.disable`
  (confirm `tours.feed.disableConfirm` / `tours.feed.disableBody`). Rotate → just-created state with the new URL;
  disable → off. Both update the `['tour-feed']` cache to the new `{active}` (never the token).
- **mutation error**: buttons disabled while pending (same-tick guard as the invite block); 429 →
  `tours.feed.rateLimitedIn` with `retryAfterText` (`components/retryAfter.ts`), or `tours.feed.rateLimited` without
  a header; offline / other → `common.error`; shown inside the dialog, the state underneath unchanged.

**i18n keys** (impersonal voice, no gendered forms):
- `tours.feed.title`: "קישור ליומן"
- `tours.feed.hint`: "הסיורים שנקבעו יופיעו ביומן Google, ביומן של אפל או בכל יומן אחר. רק מי שיש לו את הקישור יכול לראות אותם."
- `tours.feed.create`: "יצירת קישור ליומן"
- `tours.feed.linkLabel`: "הקישור ליומן"
- `tours.feed.copy`: "העתקה" · `tours.feed.copied`: "הקישור הועתק"
- `tours.feed.addGoogle`: "הוספה ליומן Google" · `tours.feed.addOther`: "הוספה ליומן אחר"
- `tours.feed.onceWarning`: "הקישור מוצג רק עכשיו. כדאי להוסיף אותו ליומן כבר עכשיו ולא לשתף אותו."
- `tours.feed.delay`: "יומן Google מתעדכן מדי כמה שעות, כך ששינויים יכולים להגיע אליו באיחור."
- `tours.feed.active`: "הקישור ליומן פעיל"
- `tours.feed.rotate`: "קישור חדש" · `tours.feed.rotateConfirm`: "ליצור קישור חדש?" · `tours.feed.rotateBody`: "הקישור הקודם יפסיק לעבוד, וצריך יהיה להוסיף את החדש ליומן. כדאי למחוק את היומן הקודם מהאפליקציה."
- `tours.feed.disable`: "כיבוי הקישור" · `tours.feed.disableConfirm`: "לכבות את הקישור ליומן?" · `tours.feed.disableBody`: "היומן יפסיק לקבל סיורים חדשים. סיורים שכבר מופיעים בו יכולים להישאר שם עד שמוחקים את היומן מהאפליקציה. אפשר ליצור קישור חדש בכל זמן."
- `tours.feed.rateLimited`: "יותר מדי פעולות בזמן קצר. אפשר לנסות שוב מאוחר יותר." · `tours.feed.rateLimitedIn`: "יותר מדי פעולות בזמן קצר. אפשר לנסות שוב {{when}}."
- `legal.privacy.s3.i7`: "יומן חיצוני: מי שמפרסם מודעה ובוחר לחבר את הסיורים ליומן (למשל Google Calendar), שולח לשירות היומן שבחר את מועד הסיור, הרחוב והעיר של המודעה ואת השם של מי שמגיע לסיור."

## Acceptance criteria
API (`api/tests/test_tour_feed.py` unless named; tours inserted with SQL helpers over 0018a's tables):
- [ ] AC1 Given a signed-in account When `POST /me/tour-feed` Then 201 `{token}` of 43 URL-safe characters,
  `Cache-Control: no-store`, and `tour_feeds.token_hash` = sha256 of the token; the raw token appears in no column of
  `tour_feeds` or `users` — `test_ac1_create_returns_token_once_stores_hash`
- [ ] AC2 Given a lister with booked tours on two of their listings, a cancelled tour, a booked tour 31 days ago, a
  booked tour 29 days ago, a booked tour on an expired listing, a past booked tour of a deleted seeker and another
  lister's booked tour When `GET /tour-feed/{token}.ics` with no cookie Then 200 `text/calendar; charset=utf-8`,
  `Cache-Control: private, max-age=300`, and exactly the lister's booked tours from 29 days ago on (the expired
  listing's included, the deleted seeker's not), ordered by start, one `VEVENT` each; the response sets no cookie —
  `test_ac2_feed_lists_own_booked_tours_in_window`
- [ ] AC3 Each `VEVENT` has `UID` = `ics.tour_uid(tour.id)` (the same string as 0018c's email `.ics` for that tour),
  `DTSTART`/`DTEND` in UTC `Z`, `SUMMARY` and `LOCATION` with the listing's street and city, `DESCRIPTION` with the
  seeker's display name and `{WEB_ORIGIN}/tours`, `URL` = that link, no `ORGANIZER`; the seeker's email and the
  application message appear nowhere in the body — `test_ac3_event_content_reveals_only_name_and_address`
- [ ] AC4 Given a token When `POST /me/tour-feed` again Then the old token's feed is the empty calendar (AC6 body) and the new one's carries the tours —
  `test_ac4_rotate_kills_old_token`
- [ ] AC5 `DELETE /me/tour-feed` → 204, the `tour_feeds` row is gone and the feed is the empty calendar (AC6 body); a second `DELETE` → 204;
  `GET /me/tour-feed` → `{active:false}` — `test_ac5_disable_is_idempotent`
- [ ] AC6 A malformed token (42 characters; a `.` inside) returns 404 and runs no SQL (statement counter on the
  engine, as `test_hardening.py`'s); an unknown well-formed token and a disabled token each return 200 with a body
  byte-identical to an active feed with no tours — `test_ac6_dead_tokens_get_identical_empty_calendar`
- [ ] AC7 Given a lister with a feed When an admin sets `suspended_at` Then the feed is the empty calendar (AC6 body); cleared
  again → 200 with the same token — `test_ac7_suspended_owner_feed_empty`
- [ ] AC8 `GET /me/tour-feed` returns `{active}` only (no token, no hash) before and after create; the three
  `/me/tour-feed` routes return 401 `unauthenticated` without a session; a session cookie sent to the feed route
  changes nothing (same body as without it) — `test_ac8_status_and_auth`
- [ ] AC9 Given an account with a feed When `DELETE /me` Then its `tour_feeds` row is gone and the old feed URL returns the empty calendar (AC6 body)
  — `api/tests/test_account_deletion.py::test_0018d_ac9_deletion_removes_tour_feed`
- [ ] AC10 POST and DELETE `/me/tour-feed` are in `LIMITED` with `WRITE` (the registry and AC2 parametrisation pass);
  the feed counts against `limits.READ` per network: with `READ` monkeypatched to 2 per minute the third request is
  429 `rate_limited` with `Retry-After`; with Redis down the feed still answers 200 —
  `test_hardening.py::test_ac1_every_write_route_has_a_limit` (updated), `test_ac10_feed_read_limit`
- [ ] AC11 A feed with 501 booked tours in the window returns 500 `VEVENT`s, the earliest 500 —
  `test_ac11_feed_capped`
- [ ] AC12 A `uvicorn.access` log record whose path is `/tour-feed/<token>.ics?x=1` is emitted with
  `/tour-feed/[redacted]` and without the token; other paths are unchanged; `create_app()` twice leaves one filter on
  the logger — `test_ac12_access_log_redacts_feed_token`; with the DB unreachable (as
  `test_areas.py::test_areas_returns_json_503_when_db_unreachable`) `GET /tour-feed/<token>.ics` → 503 and the
  `app.main` log line has `[redacted]`, not the token — `api/tests/test_db_errors.py::test_0018d_ac12_503_log_redacts_feed_token`
- [ ] AC13 `ics.feed_calendar`: every line ≤ 75 octets, a fold never splits a UTF-8 character (a 60-letter Hebrew
  display name round-trips after unfolding), lines end in CRLF, a `;` `,` `\` or newline in a name or street cannot
  start a new property, `X-WR-CALNAME` and `REFRESH-INTERVAL` present, no events → a valid `VCALENDAR` with no
  `VEVENT`; 0018c's `test_ics.py` passes unchanged —
  `api/tests/test_ics.py::test_0018d_ac13_feed_calendar`

Web (`web/src/features/tours/__tests__/CalendarFeedButton.test.tsx`):
- [ ] AC14 header button opens the dialog; off → click create → the field shows `{VITE_API_URL}/tour-feed/{token}.ics`,
  the Google link's `href` is `https://calendar.google.com/calendar/render?cid=` + the encoded `webcal://` URL, the
  other link's `href` is the `webcal://` URL, the once-warning shows; copy writes the URL to the (mocked) clipboard
  and announces "הקישור הועתק"; closing and reopening the dialog still shows the URL — `ac14_create_shows_link_once`
- [ ] AC15 active → rotate asks to confirm; cancel sends nothing; confirm shows the new URL. Disable confirms then
  shows the off state — `ac15_rotate_and_disable_confirm`
- [ ] AC16 loading skeleton; GET error shows retry; a 429 on create shows the retry time from `Retry-After`; the
  button is disabled while the request is pending (a double click sends one POST) — `ac16_states_and_errors`
- [ ] AC17 After a remount (reload) the token is not shown again (active state, no URL in the DOM) and is in neither
  `localStorage`, `sessionStorage` nor the query cache — `ac17_token_not_persisted`
- [ ] AC18 `make i18n-check` passes; `legal.privacy.s3.i7` renders on `/privacy`, right after `s3.i6` —
  `web/src/features/legal/__tests__/LegalPage.test.tsx::ac18_privacy_names_calendar_feed`

## Tests to write
Unit: `test_ics.py` (AC13), the log filter (AC12). Integration: `test_tour_feed.py` (AC1–AC8, AC10–AC12),
`test_account_deletion.py` (AC9), `test_db_errors.py` (AC12), `test_hardening.py` registry. Vitest:
`CalendarFeedButton.test.tsx` (AC14–AC17), `LegalPage.test.tsx` (AC18). E2E: none (Out; CI is the only e2e gate
anyway, never run locally). Manual, once on a deployed stack (not an AC; the build session notes it in the digest):
subscribe from Google Calendar with the "הוספה ליומן Google" button and see a booked tour appear — local dev cannot
be reached by Google.

## Blast radius
`graphify affected` (verifier, 2026-11-16, `main`'s graph) plus grep:
- `services/accounts.py::delete_account` → `routers/auth.py:270` (`delete_me`), `tests/test_account_deletion.py:947`
  (`test_nf1_failure_rolls_back_everything`, calls it directly). One `delete` added to an existing tuple, no new
  return value or lock: both untouched. 0018a changes the same function (its tour-cancel step); the second to merge
  merges `origin/main`.
- `main.py::create_app` → `scripts/export_openapi.py::main`, `tests/conftest.py::client`, `test_areas.py`,
  `test_auth.py::test_ac9_role_read_only_for_apartments`, `test_chat_events.py::open_stream`,
  `test_db_errors.py::test_503_handler_logs_error_type_not_statement`, `test_hardening.py::test_ac1_…`,
  `test_photos.py::test_ac11_media_mount_file_backend_only`. All build the app: the filter must be idempotent (AC12);
  otherwise untouched.
- `main.py::_database_unavailable` / `_redis_unavailable` (logging change) → `test_db_errors.py::test_503_handler_logs_error_type_not_statement`
  (asserts `QueryCanceled (sqlstate 57014)` and no SQL: still true, `/boom` is unchanged by `redact_path`),
  `test_areas.py` 503 test. Untouched.
- `limits.py` buckets: **not changed** (uses `WRITE` and `read_limit` as they are). `limits.check` callers (20
  routers) and `read_limit` (`routers/search.py`) untouched. Registry: `tests/test_hardening.py::LIMITED` and
  `test_ac1_every_write_route_has_a_limit`'s count (+2, Risks R3); `test_ac2_limited_routes_refuse_at_the_limit` runs
  the two new rows for free.
- `services/auth.py::_token_hash` (callers: sessions, `flatmates.create_invite`/`preview`/`join`,
  `auth.optional_user`, `routers/events.py::_user_id_for`): **used** here unchanged (text hex column, 0018a).
- `services/ics.py` (0018c): imported only, not changed; the build session runs `graphify affected "vcalendar"` once
  0018c is on `main` to confirm.
- `web/src/features/tours/ToursPage.tsx` (0018b): one `actions` prop; 0018b's `ToursPage.test.tsx` mocks nothing for
  the button, so its tests need the `['tour-feed']` query idle until the dialog opens (fetched on open, above).
- `web/src/features/legal/content.ts` (`privacyDoc` s3), `he.json` `legal.privacy.s3`: one item after `i6`;
  `LegalPage.test.tsx::ac14_privacy_names_google_sign_in` (`i6` right after `i3`) unchanged.

## Risks / open questions
- **Q1 (Gilad) — what the feed reveals.** Google stores whatever the feed carries, outside homie's control, and keeps
  it after a rotate or disable (see Q2). Default (built unless Gilad says otherwise): listing street + city, time,
  the seeker's **display name**, a link to `/tours`; nothing else. Alternative: no name ("סיור: רחוב הרצל, רמת גן"),
  the lister opens homie to see who. The name helps the lister at the door; it is also personal data of the seeker
  sent to a third party at the lister's choice, disclosed by `legal.privacy.s3.i7` (Gilad approves that text with the
  other legal drafts, HANDOFF Next Steps 3).
- **Q2 (Gilad, security trade-off) — what a dead link returns.** Google keeps a subscription's last good copy when the
  URL starts failing, so after a rotate or disable the old events (with seeker names) can stay in the lister's
  Google calendar until they remove it (the `disableBody` / `rotateBody` copy says so). Default (built unless Gilad
  says otherwise): **decided 2026-11-16 (Gilad): the alternative.** Was: 404. Built: a **well-formed** unknown, rotated or
  disabled token, or a suspended / deleted owner, gets 200 with the empty calendar (byte-identical to an active feed
  with no tours: no `DTSTAMP`), so Google's next refresh wipes the old copy; malformed stays 404. No new oracle (an
  attacker cannot tell an empty real feed from a dead token); cost: any random 43-character token gets a 200, and
  AC4–AC7 change from "404" to "the empty calendar".
- **R2 — token in the URL.** Unavoidable for calendar subscriptions. Leaks to: Google's servers (by design; Google
  keeps the URL with the subscription), the lister's browser history (the Google button carries it in `cid`; the
  `webcal:` link), uvicorn access logs and 503 logs (redacted, AC12). It never sits in a homie page URL, so no
  `Referer` carries it; the Google link is `noreferrer` anyway. Mitigations: 256-bit token (enumeration infeasible at
  any rate), hash at rest, rotate/disable in one click, per-network read limit, no cookie read (a feed URL can never
  act as a session), one identical empty-calendar 200 for every dead or unknown well-formed token, `Cache-Control: private` (no shared cache keeps it).
- **R3 — `test_hardening.py` count.** 0018a, 0018b and this spec all add routes; each spec says "+N from main"; the
  second to merge updates the number when it merges `origin/main` (Speed rule 3).
- **R4 — production logs.** Checked by the verifier (Scope, `main.py`): uvicorn's default access log is the only
  path logger besides the two 503 handlers; both are redacted.
- **R5 — Google fetch IPs vs the read limit.** Google fetches subscriptions from a pool of its own addresses; at
  launch scale `READ` (300/min, 3,000/h per network) is far above that. If Google starts seeing 429s (many listers),
  give the feed its own `IpBucket`. Not built now.
- **R6 — refresh delay.** Google refreshes subscribed calendars every few hours (not under our control;
  `REFRESH-INTERVAL` is a hint Google ignores, Apple honours). A cancellation can show in Google for hours; the
  copy `tours.feed.delay` says so, and 0018c's emails are the timely channel.
- **R7 — the Google `cid` link format** (`calendar/render?cid=<encoded webcal URL>`) is undocumented but long-
  standing; the build session checks it once by hand on the deployed stack. Fallback if it breaks: the copy button +
  "add by URL" in Google Calendar's settings.

## Verifier findings (2026-11-16, one round; all applied in this file)
1. Contract: the token is 0018a's `tour_feeds` row (`text` hex hash via `_token_hash`, per 0018a's verified migration);
   `delete_account` deletes it; the `ck_users_deleted_scrubbed` change and `users.tour_feed_hash` are gone; AC1/AC5/AC9
   rewritten.
2. Contract: `services/ics.py` is 0018c's (`tour_calendar`, one event); this spec extends it with `feed_calendar` over
   a shared `_vevent` instead of creating its own writer; `depends_on` gains 0018c; old R1/R8 removed.
3. UID: TOURS-PLAN says `{tour_id}@homie`, 0018c's draft builds `tour-{tour.id}@homie`. This spec adds `ics.tour_uid`
   holding whatever 0018c merges, so the feed and the email always agree. **Orchestrator:** make TOURS-PLAN and 0018c
   say the same string (not a coder question).
4. 0018b leaves a `PageHeader` `actions` slot for "a button + its dialog", not a card slot: the UI is now
   `CalendarFeedButton` + `Dialog`; test file renamed.
5. Threat model: the two 503 handlers in `main.py` log `request.url.path` and would have written the token to the
   log on a DB/Redis outage; now redacted (AC12, `test_db_errors.py`). Query strings are redacted too.
6. Threat model: Google keeps old events after a dead link; copy in `rotateBody` / `disableBody` now says so, and the
   empty-calendar alternative is Q2 for Gilad.
7. Contract: expiry does not cancel tours, so an expired listing's booked tours stay in the feed (old text said
   cleanup cancels them); a deleted seeker's past tour (tombstone, no name) is left out; both in AC2.
8. AC6 dropped "no `.ics` suffix": that path does not reach the route (framework 404), and it reveals nothing.
9. AC18 named (`LegalPage.test.tsx::ac18_privacy_names_calendar_feed`); `i7` after `i6` keeps 0016b's order test.

## Digest (filled by orchestrator after verification)
See `/digest`.

## Orchestrator correction (2026-11-16, after 0018c review)
Verifier findings 2–3 above are superseded: 0018c shipped `tour_uid` and public `vevent`/`vcalendar`, so this
spec imports them (Scope) and edits neither `ics.py`'s existing functions nor `tour_mail.py`.
