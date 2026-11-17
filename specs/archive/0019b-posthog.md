---
id: 0019b
title: Gilad sees homie's funnel and retention in PostHog (cookieless, no personal data), and a deleted account leaves no trace there
status: in-review
depends_on: [0019a]   # reuses its `routePattern.ts`; branches from 0019a's PR branch once it is open
reviewers: [code, security, qa]
estimate: 1 coder run   # coder Opus/high (data leaving the app, deletion; Speed rule 6)
---

## Goal
PostHog (free tier, EU region) counts page views and a few UI events in the browser without any cookie or storage,
and the API records the business events of the funnel keyed by the user's UUID, with no personal data; a deleted
account's person and events are deleted from PostHog. Serves `PRODUCT.md` "Observability"; plan in
`specs/OBSERVABILITY-PLAN.md`.

## Scope
**In:**
- **Settings** (`api/app/config.py`): `posthog_key: str = ""` (the project's public ingestion key),
  `posthog_host: str = "https://eu.i.posthog.com"` (ingestion), and, for deletion only (worker):
  `posthog_api_host: str = "https://eu.posthog.com"` (the private REST API lives on the app host, not the
  ingestion host), `posthog_personal_api_key: SecretStr | None = None`, `posthog_project_id: str = ""`.
- **`api/app/analytics.py`** (new):
  - One module-level `posthog.Posthog` client created lazily on the first `track` from settings:
    `Posthog(settings.posthog_key, host=settings.posthog_host, disable_geoip=True, on_error=_log_failure,
    max_retries=3, timeout=5)` (`sync_mode` stays `False`: the SDK's own consumer thread sends, a request never
    waits; `enable_exception_autocapture` stays `False`: errors are Sentry's). `_log_failure` logs one WARNING with
    the exception type only (never the batch). `logging.getLogger("posthog").setLevel(logging.CRITICAL)` at
    import, so the SDK's own ERROR lines on an upload failure are not turned into Sentry events by `0019a`'s
    logging integration. No-op (and no client) when `posthog_key` is empty.
  - `track(user_id: uuid.UUID | None, event: Event, properties: Mapping[str, str | int | bool] | None = None)
    -> None`, `Event` a `Literal` of the event names below (an unknown name fails mypy). Calls
    `client.capture(event, distinct_id=str(user_id), properties=…)`; `user_id=None` sends a **personless** event
    (no `distinct_id`: the SDK generates one and creates no person). Properties are filtered against the event's
    allowlist below (anything else dropped before sending) and wrapped in `try/except Exception` → WARNING
    (`capture` is already `@no_throw`; this covers our own code): PostHog down never fails a request.
  - `shutdown()`: `client.shutdown()` (flush + stop the thread) and reset the module client to `None`, so the
    next app in the same process (pytest builds many) starts a fresh one. Called from a new `lifespan` on
    `FastAPI(...)` in `create_app()` (on exit) and from a new `on_shutdown` in `WorkerSettings`.
  - A test hook: `set_client(fake | None)` used by the pytest fixture (resets after each test).
- **Business events.** Every capture runs **after** the write's `db.commit()` returned, outside its `try` (a
  rolled-back write sends nothing). Exact places (blast radius below):

  | Event | Capture location | `distinct_id` | Properties (allowlist) |
  | --- | --- | --- | --- |
  | `signed_up` | `routers/auth.py::_signed_in`, after `create_session` (which commits), when `created` | the new user | `role` (`owner`/`seeker`), `method` (`code`/`google`) |
  | `logged_in` | same place, when not `created` | the user | `method` (`code`/`password`/`google`) |
  | `listing_published` | `services/listings.py::create_listing`, after the `try` | owner | `listing_type`, `area_id` |
  | `application_sent` | `services/applications.py::apply`, after the `try` | seeker | `listing_type` |
  | `application_shortlisted` | (a) `apply`, after the `try`, when the returned application is `shortlisted` (it answered the lister's room like, spec 0010l: `source = 'like'`); (b) `set_applicant_status`, after the `try`, only on the changed path to `shortlisted` (the same-status no-op returns inside the `try` with no commit and sends nothing) | **seeker** (`application.seeker_id`: the funnel is the seeker's) | `listing_type`, `source` (`apply`/`like`, the application's column) |
  | `tour_booked` | `services/tours.py::book`, after the `try` (reschedules are not bookings) | seeker | `listing_type` |
  | `account_deleted` | `services/accounts.py::delete_account`, after the `try`, before step 13 (the tombstone path returns `[]` inside the `try` and sends nothing) | **none** (personless, `user_id=None`): the person's events are deleted below, and a personless count keeps the number without a trace | none |

  `_signed_in` gains `method` and `created` parameters (its three callers in `routers/auth.py` pass them), so a
  sign-in sends exactly one of `signed_up` / `logged_in`. `logged_in` makes returning users visible (decision 2a:
  the browser is cookieless). `listing_type` comes from a column the function already reads where it can
  (`apply` returns the listing; `create_listing` has `data`); `book` adds `Listing.listing_type` to its locked
  SELECT and `set_applicant_status` adds it to the UPDATE's `RETURNING` or the `_applicants` row: no extra query.
  shortcut: a database failure between `verify_otp`'s commit and `create_session`'s loses one `signed_up` (the user
  then shows as `logged_in` on the next sign-in); fine for counts.
- **Deletion** (decision 3a): a worker cron `posthog_forget_job` (`hour=3, minute=55`, `unique=True`; the purge is
  03:25) registered in `WorkerSettings.cron_jobs`. When `posthog_personal_api_key` and `posthog_project_id` are both
  set, it selects `users.id` where `deleted_at >= now() - interval '7 days'` and, in batches of at most 1000,
  `POST {posthog_api_host}/api/projects/{posthog_project_id}/persons/bulk_delete/` with
  `Authorization: Bearer <personal key>` (scope `person:write`) and JSON body
  `{"distinct_ids": [<uuid str>…], "delete_events": true}` (`distinct_ids`, not `ids`: `ids` are PostHog's own
  person UUIDs). A sync `httpx.Client(timeout=30)` inside `asyncio.to_thread`, like `import_cbs_rent_job`.
  A non-2xx response raises (`raise_for_status`), so the job fails and `0019a`'s module-level arq integration
  reports it to Sentry, which emails Gilad; the job must not catch it. A 2xx whose body has a non-empty
  `deletion_errors` logs one WARNING with the count only (an id PostHog never saw is not a failure). Idempotent: a
  second delete of the same id is harmless, so the 7-day window is a week of daily retries with no new column. One
  or both settings unset → one INFO line and return, no request. PostHog deletes the events asynchronously (its
  weekly batch); the persons go within minutes.
  shortcut: an id that fails 7 days in a row is never retried; add a `posthog_forgotten_at` column if that happens.
- **Web** (`web/src/app/analytics.ts` new; `init` called from `web/src/app/main.tsx` next to `0019a`'s Sentry init;
  pageviews from `Layout.tsx`): `posthog-js` initialised only when `import.meta.env.VITE_POSTHOG_KEY` is set, with
  `api_host: import.meta.env.VITE_POSTHOG_HOST || "https://eu.i.posthog.com"` (posthog-js defaults to the US host),
  `cookieless_mode: "always"`, `persistence: "memory"`, `autocapture: false`, `capture_pageview: false`,
  `capture_pageleave: false`, `disable_session_recording: true`, `disable_surveys: true`,
  `advanced_disable_flags: true` (no `/flags` request at all; replaces `advanced_disable_feature_flags`, which still
  calls `/flags`), `disable_external_dependency_loading: true` (no remote script is ever loaded), and
  `before_send: scrubEvent`. There is no `ip` option in current posthog-js; the IP is dropped by the project
  setting in the runbook line below.
  - `scrubEvent` (exported, unit-tested): for every key in `properties`, `$set` and `$set_once` whose value is a
    URL or path (`$current_url`, `$pathname`, `$referrer`, `$initial_current_url`, `$initial_pathname`,
    `$initial_referrer`, `$session_entry_url`, `$session_entry_pathname`, `$session_entry_referrer`, and any other
    string value that parses as an `http(s)` URL): our origin → `origin + routePattern(pathname)`, a path →
    `routePattern(path)`, another origin → the bare origin; query and hash always dropped. `routePattern` is
    imported from `web/src/app/routePattern.ts` (built by `0019a` on `appRouteTree`); no second matcher.
  - `capture(name: UiEvent, props)` with a typed name list; a no-op before/without `init`.
  - `$pageview` captured from a `useEffect` on `location.pathname` in `Layout.tsx` (one per navigation, none on a
    re-render or a query-only change).
- **UI events** (each from the existing place it happens):
  - `search_run` — `SearchPage`'s `apply` (the filter form's submit; not `clear`, `sort` or a view switch):
    `type` (`apartment`/`room`), `filters` = the number of filter keys set in the new `parseFilters` result
    (sort, view and map position excluded), never their values.
  - `listing_viewed` — `ListingPage`, in the existing `seenId` effect (once per loaded id): `listing_type`.
  - `signup_started` — `OtpForm` step 1's request success when `withProfile` (`method: "code"`), and
    `GoogleButton`'s credential callback when `context === "signup"` (`method: "google"`).
- **Env**: `.env.example` lists `POSTHOG_KEY`, `POSTHOG_HOST`, `POSTHOG_API_HOST`, `POSTHOG_PERSONAL_API_KEY`,
  `POSTHOG_PROJECT_ID`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, empty with one comment each (empty = off);
  `infra/docker-compose.yml` passes the API ones to `api` and `worker`.
- **Privacy text** (`web/src/locales/he.json`, rendered by `privacyDoc` in `web/src/features/legal/content.ts`):
  - New `legal.privacy.s3.i9` right after `0019a`'s Sentry `i8`: "PostHog: כדי לדעת איך משתמשים באתר, נשלחת
    ל-PostHog סטטיסטיקת שימוש: אילו דפים נפתחו (רק תבנית הכתובת, בלי הפרטים שבה) ופעולות כמו הרשמה, פרסום מודעה,
    הגשת מועמדות או קביעת סיור, יחד עם מזהה אקראי של החשבון. לא נשלחים שם, אימייל, טלפון, הודעות או מה שחיפשתם.
    אין עוגיות ולא נשמר דבר בדפדפן. PostHog רואה את כתובת ה-IP אבל לא שומרת אותה. המידע נשמר באיחוד האירופי
    ונמחק כשמוחקים את החשבון."
  - `legal.privacy.s1.i15` today says there are no third-party tracking tools; with PostHog that is no longer
    true. New text: "אין באתר פרסומות ואין כלי מעקב של מפרסמים, ואנחנו לא מוכרים מידע. סטטיסטיקת שימוש בלי
    עוגיות נאספת דרך PostHog, כמו שמתואר בסעיף 3."
  - New `legal.privacy.s5.i14`: "סטטיסטיקת שימוש (PostHog): עד שנה, ונמחקת כשמוחקים את החשבון."
  - `PRODUCT.md` `Retention` row: append one sentence: PostHog usage events are kept 1 year (the free plan's
    retention), in the EU, and a deleted account's PostHog person and events are deleted by a daily job.
- **Runbook hand-off**: one line in `specs/0013a-production-deploy.md`'s Fly secrets list: `POSTHOG_KEY`,
  `POSTHOG_PERSONAL_API_KEY` (scope `person:write` only), `POSTHOG_PROJECT_ID` (api + worker), `VITE_POSTHOG_KEY`
  (web build); and in PostHog's project settings: turn on **Cookieless server hash mode** (Web analytics; without
  it cookieless events are dropped) and **Discard client IP data**.

**Out:** identify in the browser, session replay, autocapture, feature flags, surveys, heatmaps, a reverse proxy,
dashboards (Gilad builds them in PostHog), `chat_opened` (see risks), the admin app, the waitlist site, Sentry
(`0019a`).

**New dependencies:** `posthog==7.82.2` (api; pulls `requests`, `backoff`, `distro`; ships `py.typed`, else a
mypy override), `posthog-js@1.444.4` (web, exact pin). Both are the latest releases from 2026-11-02.
Built (coder, 2026-11-17): `posthog-js` depends on `core-js`, whose install script pnpm 12 refuses by default;
`web/pnpm-workspace.yaml` denies it (`allowBuilds: core-js: false`, from `pnpm approve-builds '!core-js'`; the
script only prints a banner), `infra/Dockerfile.web` copies that file before `pnpm install`, and the Makefile's
install stamp depends on it. `set_applicant_status` reads `application.listing_type_at_apply` (already in the
UPDATE's `RETURNING Application`; a listing's type is fixed at create), so no column was added there.

## Data
No tables, no migration. `posthog_forget_job` reads `users.id`, `users.deleted_at`. The tombstone row (`0013c`
step 12: `id` kept, `deleted_at = now()`) is never deleted (`0013h` Data rule 4; `services/retention.py` deletes
listings, conversations and other rows, never `users`; no `delete(User)` exists in `api/app`), so the 7-day window
always finds it.

## API
No new endpoint. Existing endpoints' responses unchanged.

## UI
No visible change except `/privacy` (`s1.i15` reworded, `s3.i9`, `s5.i14`). No banner (decision 2a). No new layout,
so no RTL work beyond the existing list.

## Acceptance criteria
- [ ] AC1 Given no `POSTHOG_KEY`, When any tracked action runs, Then no client is created and nothing is sent —
  `api/tests/test_analytics.py::test_ac1_off_without_key`
- [ ] AC2 Given a key and a fake client, When a user signs up with a code and with Google, logs in by code,
  password and Google, publishes a listing, applies, is shortlisted by the owner, answers a room like by applying,
  and books a tour, Then exactly the events in the table are captured once each with the `distinct_id` the table
  names, and properties are only the allowlisted ones —
  `test_analytics.py::test_ac2_funnel_events`
- [ ] AC3 No captured event contains an email, display name, message text, phone, price or query string
  (asserted over every event of AC2's run) — `test_analytics.py::test_ac3_no_personal_data`
- [ ] AC4 Given the write fails and rolls back (apply to own listing, listing cap reached) or is a no-op (a second
  shortlist of the same application), Then no event is captured — `test_analytics.py::test_ac4_no_event_on_rollback`
- [ ] AC5 Given the fake client raises on `capture`, Then the request still succeeds with its normal response —
  `test_analytics.py::test_ac5_posthog_failure_never_fails_request`
- [ ] AC6 `account_deleted` is captured once, personless; a second `DELETE /me` on the tombstone captures nothing —
  `test_analytics.py::test_ac6_account_deleted_once`
- [ ] AC7 Given deletion settings and an `httpx.MockTransport` (patched into `httpx.Client` as in
  `test_cbs_rent.py`), When `posthog_forget_job` runs, Then it posts the ids of users deleted in the last 7 days
  (none older, none live) as `distinct_ids` with `delete_events: true` and the Bearer key, in batches of ≤1000; a 5xx
  raises; unset settings → no request — `api/tests/test_analytics.py::test_ac7_forget_deleted_users`
- [ ] AC8 Given no `VITE_POSTHOG_KEY`, Then `posthog.init` is never called and `capture` is a no-op —
  `web/src/app/__tests__/analytics.test.ts::ac8_off_without_key`
- [ ] AC9 `init` is called with the EU host default, `cookieless_mode: "always"`, `persistence: "memory"`,
  autocapture, pageview, pageleave, replay, surveys, flags and external loading off, and `before_send` set —
  `analytics.test.ts::ac9_privacy_config`
- [ ] AC10 `scrubEvent` turns `$current_url` `https://<origin>/listings/abc?budget=5000#x` into
  `https://<origin>/listings/:id`, `$pathname` and `$set_once.$initial_current_url` likewise, a foreign
  `$referrer` into its bare origin, and no property keeps a query string or hash —
  `analytics.test.ts::ac10_urls_scrubbed`
- [ ] AC11 Navigating between three routes captures three `$pageview`s, one per navigation; a re-render or a
  query-only change captures none — `web/src/app/__tests__/Layout.test.tsx::ac11_one_pageview_per_navigation`
- [ ] AC12 `search_run` carries only `type` and the filter count —
  `web/src/features/search/__tests__/SearchPage.test.tsx::ac12_search_run_event`
- [ ] AC13 `/privacy` shows the PostHog item, the reworded `s1.i15` and the retention line —
  `web/src/features/legal/__tests__/LegalPage.test.tsx::ac13_privacy_names_posthog`
- [ ] NF1 `make lint`, `make test`, `make i18n-check` green; CI e2e unchanged (no key in CI, so by AC8 nothing
  reaches `posthog.com`).

## Tests to write
Unit: `track` allowlist, `scrubEvent`. Integration: pytest with a fake client injected by a fixture
(`analytics.set_client`, reset after each test), the real services through `TestClient`. AC7 with
`httpx.MockTransport` (what the repo uses; no `respx`), the autouse `no_network` guard stays on. The Python SDK
sends with `requests`, which that guard does not cover: tests never build a real client (AC1 asserts it). Web:
vitest with `posthog-js` mocked (`vi.mock`). E2E: none (inert in CI; no local e2e).

## Blast radius
`graphify affected` on `main`, 2026-11-17:
- `services/auth.py::verify_otp` / `::google_login` — routers `verify_otp`, `google_login`; `test_auth.py`
  (`verify`, `test_code_survives_database_failure_at_login`, `test_otp_single_use_under_concurrency`),
  `test_google.py` (`sign_in`, `test_ac9_race`). Unchanged: the capture is in the router.
- `create_session` — `_signed_in` and test helpers that call it directly (`test_market_people.py::_login`,
  `_person`, `test_admin.py`, `test_ip_limits.py`, `test_moderation.py`). `create_session` itself is unchanged;
  those helpers send nothing (no key).
- `routers/auth.py::_signed_in` — its three callers `verify_otp`, `password_login`, `google_login` pass the new
  `method`/`created`; no other caller.
- `services/listings.py::create_listing` — router `create_listing`; `test_listings.py::create`,
  `test_ac9_concurrent_creates_respect_cap`. No-op without a key; untouched.
- `services/applications.py::apply` — router `apply`; `test_applications.py` (`apply`, `call`,
  `test_ac4_one_application_per_seeker_and_listing`), `test_flatmates.py` (`test_ac8_join_racing_apply_is_never_both`,
  `answer`, `test_ac8_join_racing_like_is_never_both`). No-op without a key; untouched.
- `services/applications.py::set_applicant_status` — router `set_applicant_status` only. Adding `listing_type` to a
  returned row must not change `list_applicants`' response shape.
- `services/tours.py::book` — router `book`; `test_tours.py` (`run`, `race`). The extra SELECT column is
  internal; untouched.
- `services/accounts.py::delete_account` — `delete_me`; `test_account_deletion.py::test_nf1_failure_rolls_back_everything`
  (a failure before the commit must still capture nothing: AC4's rule).
- `WorkerSettings` (`api/app/worker.py`) — no code caller (arq loads it by name); new cron + `on_shutdown`.
  `test_worker.py` if it lists `cron_jobs`. `0019a`'s module-level Sentry init stays first.
- `create_app` (`api/app/main.py`) — the new `lifespan` runs in every `TestClient(create_app())` `with` block
  (`conftest.py::client` and the files 0019a lists); `shutdown()` with no client is a no-op.
- `Layout` (`web/src/app/Layout.tsx`) — `routes.tsx`/`App.tsx` and the tests rendering it:
  `app/__tests__/{KitPreview,Layout,queryClient,SideSwitch,usePageTitle}.test.tsx`, `chat/__tests__/harness.tsx`,
  `auth/__tests__/routes.test.tsx`, `search/__tests__/routes.test.tsx`, `LandingPage`, `LegalPage`,
  `MarketMinePage`, `AccountDeletedPage` tests. No key in vitest → `capture` is a no-op; they pass unchanged.
- `SearchPage` — `routes.tsx`; `SearchPage`, `LocateButton`, `SearchMap`, `SideMap`, `match/logout` tests. Unchanged.
- `ListingPage` — `routes.tsx`; `ListingPage`, `ApplySection`, `ProfileNudge` tests. Unchanged.
- `OtpForm` / `GoogleButton` (signup_started; `SignupPage` itself is not changed) — `LoginPage`, `SignupPage`;
  `OtpForm`, `GoogleButton`, `PasswordForm`, `LoginPage`, `SignupPage`, `ApplySection`, `JoinFlatPage` tests. The
  login context sends nothing; unchanged.
- `privacyDoc` (`web/src/features/legal/content.ts`) — `LegalPage.tsx`, `routes.tsx`; `LegalPage.test.tsx` (item
  counts include `s3.i9`, `s5.i14`).

## Risks / open questions
- Checked against PostHog's docs on 2026-11-17: `cookieless_mode: "always"` needs the project's "Cookieless server
  hash mode" (else events are dropped); `persistence: "memory"`, `before_send`, `advanced_disable_flags`,
  `disable_external_dependency_loading` exist; no `ip` option. Python `Posthog(…, disable_geoip, on_error,
  sync_mode, timeout, max_retries)`, `capture(event, distinct_id=…, properties=…)` is `@no_throw`, `shutdown()`
  flushes. Bulk delete: `POST /api/projects/:id/persons/bulk_delete/`, ≤1000 ids, `person:write`, 202. Docs differ
  on whether `distinct_ids`/`delete_events` go in the body or the query string: the coder tries the JSON body
  against a real PostHog test project once if Gilad has one, else the runbook's first production run checks the
  202 and `persons_queued_for_deletion`.
- Funnel joins: the browser is anonymous and the API is keyed by user, so "page view → signed_up" is not one
  funnel; the API funnel starts at `signed_up`. Accepted by decision 2a.
- `chat_opened` (in the plan) is not a separate event: an application chat opens in the same transaction as the
  shortlist, so `application_shortlisted` counts it; direct chats (mutual person likes) are not counted in v1.
  Gilad may want a `message_sent` or `direct_chat_opened` later.
- Built on `0019a`'s branch (same `he.json` section, `.env.example`, `main.tsx`, `worker.py`); merge `origin/main`
  after `0019a` lands.

## Verifier findings (2026-11-17, one round, applied in place)
1. Capture points pinned: auth events in `_signed_in` after `create_session`'s commit (one event per sign-in);
   the rest after each service's `try`; set_applicant_status only on the changed path.
2. Room-like path: `apply` writes `shortlisted` (`source = 'like'`) when it answers an invite; it now also sends
   `application_shortlisted`. Shortlist keyed by the seeker, `source` property added.
3. `account_deleted` is personless: keyed by the UUID it would be erased by the forget job itself.
4. Bulk delete uses `distinct_ids` (not `ids`), the app host `eu.posthog.com` (new `posthog_api_host`), Bearer
   personal key, ≤1000 per call; `deletion_errors` logged, non-2xx raises into 0019a's arq reporting.
5. posthog-js: `advanced_disable_flags` replaces `advanced_disable_feature_flags`; `disable_external_dependency_loading`
   added; `ip` dropped (no such option; "Discard client IP data" in the runbook); EU host default (the SDK
   defaults to US). `$set`/`$set_once` scrubbed too.
6. Matcher is `0019a`'s `web/src/app/routePattern.ts`; privacy item is `s3.i9` (`i7` calendar, `i8` Sentry).
7. `legal.privacy.s1.i15` ("no third-party trackers") contradicted PostHog: reworded. `s5` line is `i14`; Hebrew
   given. PostHog free-plan retention is 1 year.
8. SDK's `posthog` logger silenced so its upload errors are not Sentry events; `lifespan`/`on_shutdown` are new
   (neither exists today); the client resets after `shutdown()`.
9. Versions pinned: `posthog==7.82.2`, `posthog-js@1.444.4` (2026-11-02). Tests use `httpx.MockTransport`.
10. `signup_started` lives in `OtpForm`/`GoogleButton` (SignupPage has no submit of its own); `search_run` in
    SearchPage's `apply`.

## Digest (filled by orchestrator after verification)
Spec 0019b — PostHog analytics, cookieless, deleted accounts forgotten   PR open (merge sha on merge)
Shipped: with keys set, PostHog (EU) gets route-pattern page views and 3 UI events from the browser (no cookie or storage), 7 funnel events from the API keyed by user UUID, and a 03:55 job deletes accounts removed in the last 7 days. With no keys, nothing is sent.
Demo: set `VITE_POSTHOG_KEY`/`POSTHOG_KEY` → `make dev` → sign up, publish, apply → events appear in PostHog with `/listings/:id`-style URLs only.
Tests: +10 api, +11 web, +0 e2e (inert in CI).   CI: see PR.
Findings: 2 blockers fixed (a page `title` carrying a chat partner's name; `$prev_pageview_pathname` carrying raw ids), 3 majors fixed (the SDK constructor reset the `posthog` logger so upload errors would reach Sentry; utm/gclid/`ph_keyword` from the query string; a vacuous AC1 test), 6 minors fixed (one is the device-data clause added to `s3.i9`), 0 waived, 0 follow-ups.
Changed in PRODUCT.md: the Retention row gains PostHog (1 year, EU, deleted with the account).
Not verified: the bulk-delete JSON body against a real PostHog project; the runbook says to check the first production run's 202. To set in PostHog: Cookieless server hash mode on, Discard client IP data on.
