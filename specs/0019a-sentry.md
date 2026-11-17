---
id: 0019a
title: Gilad gets an email when the API, the worker or a browser hits an unhandled error, with no personal data sent
status: in-review
depends_on: []
reviewers: [code, security, qa]
estimate: 1 coder run   # coder Opus/high (data leaving the app; plan)
---

## Goal
Every unhandled error in the API, a worker job or the web app reaches Sentry (free tier, EU region) and emails
Gilad, with no personal data in the payload. Serves `PRODUCT.md` "Observability"; plan in
`specs/OBSERVABILITY-PLAN.md`. Closes FOLLOWUPS 0013h (no alert when `purge_expired_job` fails).

## Scope
**In:**
- **Settings** (`api/app/config.py`): `sentry_dsn: SecretStr | None = None`, `sentry_environment: str = "development"`,
  `sentry_release: str | None = None`, `sentry_traces_sample_rate: float = 0.0` (0–1, validated).
- **`api/app/observability.py`** (new): `init_sentry(settings, *, worker: bool) -> None` and the scrubber
  `scrub_event(event, hint) -> event | None` used as `before_send` and `before_send_transaction` (so a later
  non-zero trace rate is scrubbed too). No-op when `sentry_dsn` is unset; a second call in the same process is a
  no-op (`sentry_sdk.get_client().is_active()`). `sentry_sdk.init` with (names checked against sentry-sdk 2.75.0):
  `send_default_pii=False`, `include_local_variables=False` (frames would carry emails, passwords, codes),
  `max_request_body_size="never"`, `traces_sample_rate=settings.sentry_traces_sample_rate`,
  `environment`, `release`, and integrations:
  - `StarletteIntegration(transaction_style="url", failed_request_status_codes=set())` **and**
    `FastApiIntegration(…same two arguments…)` (Sentry's docs: configure both). `transaction_style="url"` names the
    transaction by the route template (`/tour-feed/{token}.ics`). `failed_request_status_codes=set()` because the
    SDK's default (500–599) would report every `HTTPException(503)` we raise on purpose (`email_unavailable`,
    `google_unavailable` in `routers/auth.py`, `photo_storage_unavailable` in `routers/photos.py`); a 4xx is never
    reported either way. An unhandled exception (a 500) is still captured by the SDK's ASGI middleware.
  - `ArqIntegration()` when `worker=True`.
  - The logging integration keeps its default (ERROR records become events, INFO+ become breadcrumbs), so the
    scrubber covers log messages too. `sentry_sdk.integrations.logging.ignore_logger("app.main")` and
    `ignore_logger("app.services.health")`: the handled DB/Redis 503 handlers (`_database_unavailable`,
    `_redis_unavailable`) and the `/health` pings log at ERROR, which would otherwise be one event per request or
    per health ping during an outage (and burn the 5k/month quota). The other app ERROR lines (SMTP send, outbox
    write, R2 put/delete, tour mail item) stay events: they log only an exception type.
- **The scrubber** (one function, unit-tested on its own on hand-built events):
  - `request`: replaced by `{"method": …, "url": event["transaction"]}` (the route template); `headers`,
    `cookies`, `data`, `query_string`, `env` are gone.
  - `user`: deleted (no id, no IP).
  - `breadcrumbs`: each keeps only `type`, `category`, `level`, `timestamp`, `message`; `data` is dropped (httpx
    breadcrumbs carry the Nominatim URL with the street and city, see `worker.py`'s httpx comment).
  - `extra`: dropped. `contexts`: keep `runtime`, `os`, `trace` only.
  - Exceptions (`exception.values[]`, chained causes included) whose `module` starts with `sqlalchemy`, `psycopg`
    or `pydantic`: `value` replaced by `""` (type and stack kept). Their `str()` carries bound parameters, `DETAIL:
    Key (phone)=(…)` lines and `input_value=…` (names, phones, emails); the house rule is "type only", as in
    `_database_unavailable` and `tour_mail.py`'s comment.
  - Then **every string left anywhere in the event** (recursive walk; `transaction`, `message`, `logentry.message`
    and `logentry.params`, exception values, breadcrumb messages, frame fields): email-shaped substrings → `[email]`,
    and `redact_path()` from `app.services.tour_feed` (the function `RedactFeedToken` and the 503 handlers already
    use; it rewrites `/tour-feed/<anything>` to `/tour-feed/[redacted]`). Do not write a second token pattern.
- **API**: `create_app()` calls `init_sentry(settings, worker=False)` (before building the app, so the
  integrations are patched first).
- **Worker**: `init_sentry(get_settings(), worker=True)` runs at **module level in `api/app/worker.py`**, before
  `class WorkerSettings`, not in `on_startup`: `ArqIntegration` wraps the job and cron coroutines inside a patched
  `arq.worker.create_worker`, which arq calls before `on_startup`; an init in `on_startup` would capture nothing
  (sentry-sdk `integrations/arq.py`; Sentry's arq docs init at module level). `app.worker` does not import
  `app.main`, so the worker's init is the first one. A cron job that raises becomes one Sentry event, so a failing
  `purge_expired_job` emails Gilad. `on_startup` is unchanged.
- **Web**:
  - `web/src/app/routePattern.ts` (new, exported for `0019b`): `routePattern(pathname): string` returns the matched
    route pattern (`/listings/:id`, `/me/listings/:id/edit`, `/chat/:id`, `/` for the index) using react-router's
    `createRoutesFromChildren` + `matchRoutes` on the app's own route tree. To make the tree reusable,
    `web/src/app/routes.tsx` moves the `<Route>` children of `AppRoutes` into an exported `appRouteTree` element;
    `AppRoutes` renders `<Routes>{appRouteTree}</Routes>` and behaves exactly as today. The catch-all `*` route
    gives `/*` for an unknown path; no query or hash ever.
  - `web/src/app/sentry.tsx` (new): `initSentry()`, `beforeSend`, `beforeBreadcrumb`, `AppErrorBoundary`.
    `initSentry()` calls `Sentry.init` only when `import.meta.env.VITE_SENTRY_DSN` is set, with
    `sendDefaultPii: false`, `tracesSampleRate: 0`, no replay integration, `release` = `VITE_SENTRY_RELEASE`,
    `environment` = `VITE_SENTRY_ENVIRONMENT`. `beforeSend`: `request` becomes `{ url: routePattern(…) }` only
    (the default `httpContextIntegration` adds the full URL and `Referer` / `User-Agent` headers: drop the
    headers), `user` deleted, email-shaped strings in exception values, `message` and breadcrumb messages →
    `[email]`. `beforeBreadcrumb`: drop `console` breadcrumbs; for `fetch` and `xhr` keep `data.url` as the path
    without query or hash; for `navigation` the same for `data.from` / `data.to` (search filters and the flatmates
    invite token live in the query).
  - `web/src/app/main.tsx` calls `initSentry()` before `createRoot`, and renders `<AppErrorBoundary><App /></AppErrorBoundary>`
    inside `StrictMode`. `AppErrorBoundary` is `Sentry.ErrorBoundary` with fallback
    `<ErrorState page onRetry={() => window.location.reload()} />` (the existing `web/src/components/ErrorState.tsx`:
    `common.error` "משהו השתבש" + `common.retry` "נסו שוב"; offline it says `common.offline`). No new UI keys.
- **Source maps**: `web/vite.config.ts` adds `sentryVitePlugin` from `@sentry/vite-plugin` only when
  `SENTRY_AUTH_TOKEN` is set at build time, with `org: SENTRY_ORG`, `project: SENTRY_PROJECT`, `authToken`,
  `telemetry: false`, `release: { name: VITE_SENTRY_RELEASE }`,
  `sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] }`, and `build.sourcemap: 'hidden'`, so no `.map`
  is served (the PWA precache globs `**/*.{js,css,html}` never include maps). Unset (dev, CI, e2e): no plugin, no
  maps, the build is what it is today. The token lives in Gilad's local env only, never in CI, `.env.example`
  (empty only) or the bundle. `web/scripts/build-check.mjs` adds one check: any `*.map` file under `dist/` is a
  problem (`<path>: source map must not be served`); its header comment lists the new check.
- **Env**: `.env.example` lists `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`,
  `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_RELEASE`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
  `SENTRY_PROJECT`, all empty or commented out, one comment each. `infra/docker-compose.yml` passes
  `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE` through to `api` and `worker`
  (`${SENTRY_DSN:-}`, empty by default).
- **Privacy text** (`web/src/locales/he.json`): new item `legal.privacy.s3.i8` (`i7` is the calendar feed, spec
  0018d), rendered by `privacyDoc` in `web/src/features/legal/content.ts` right after `i7`. Text:
  "Sentry: כשמשהו נכשל באתר או בשרת, נשלח ל-Sentry דוח תקלה טכני: סוג התקלה, איפה בקוד היא קרתה, תבנית הכתובת של הדף (בלי הפרטים שבה), והגרסאות של הדפדפן ומערכת ההפעלה. לא נשלחים שם, אימייל, טלפון או הודעות. הדוחות נשמרים באיחוד האירופי עד 30 יום."
- **PRODUCT.md** `Retention` row: append one sentence: Sentry error reports are kept 30 days (the free plan's
  retention), in the EU (plan ground rule 4).
- **Runbook hand-off**: `specs/0013a-production-deploy.md` gets one line under its Fly secrets list naming the
  production values (`SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, `SENTRY_RELEASE`=git sha, on api and worker;
  `VITE_SENTRY_*`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` in the local env for `make deploy-web`;
  DSNs from the EU-region (`de.sentry.io`) project). 0013a is `verified` and not built; the line is an addition its
  coder follows, not a change to its ACs.
- FOLLOWUPS 0013h `purge_expired_job` line ticked.

**Out:** performance tracing (off by decision; the setting exists), session replay, the admin app, the waitlist
site, uptime monitoring (so a Postgres/Redis outage emails no one, accepted), Slack alerts (Sentry's default email
alert to the account owner is the alert), PostHog (`0019b`).

**New dependencies (exact pins):** `sentry-sdk[fastapi]==2.75.0` (api; the arq integration ships inside it, arq
0.28 ≥ its 0.23 minimum), `@sentry/react@11.13.0` (web; peer react 17–19 and react-router 6–8, we have 18.3.1 /
7.18.5), `@sentry/vite-plugin@11.13.0` (web dev; needs Node ≥ 20.19 or ≥ 22.12).

## Data
No tables, no migration.

## API
No new endpoint. Behaviour of existing endpoints unchanged.

## UI
- Root error fallback: the existing `ErrorState` (`page`), RTL as it is today (logical properties). States: only
  the error state is new; empty / loading / success are the app as today. Keys reused: `common.error`,
  `common.retry`, `common.offline`.
- `/privacy`: one new list item, `legal.privacy.s3.i8`.

## Acceptance criteria
- [ ] AC1 Given no `SENTRY_DSN`, When `create_app()` runs and `app.worker` is imported, Then `sentry_sdk` is not
  initialised (`sentry_sdk.get_client().is_active()` is false) — `api/tests/test_observability.py::test_ac1_off_without_dsn`
- [ ] AC2 Given a DSN and a capturing transport (no network), When a route raises an unhandled error on a request
  carrying a session cookie, an `Authorization` header, a JSON body with an email and a query string, Then exactly
  one event is captured; its `request` is only `method` and the route template; it has no `user`, cookie, header,
  body, query, `extra` or local variables; and no string in it contains the email — `test_observability.py::test_ac2_unhandled_error_is_scrubbed`
- [ ] AC3 Given a DSN, When a request ends in a 4xx (`HTTPException`, `RequestValidationError`), an
  `HTTPException(503)`, or a handled 503 (database / Redis down, whose handler logs at ERROR), Then no event is
  captured — `test_observability.py::test_ac3_answered_errors_are_not_sent`
- [ ] AC4 Given an error raised under `/tour-feed/{token}.ics`, Then neither the transaction name nor any string in
  the event contains the token — `test_observability.py::test_ac4_feed_token_never_sent`
- [ ] AC5 Given an `log.error("… %s", email)` record, an exception whose message contains an email, and an
  unhandled SQLAlchemy `IntegrityError` whose parameters hold a name and a phone, Then the first two carry
  `[email]` instead and the third has an empty `value` and contains neither the name nor the phone —
  `test_observability.py::test_ac5_personal_data_redacted_in_messages`
- [ ] AC6 Given a DSN and `init_sentry(worker=True)` before arq's `create_worker`, When a cron job raises, Then one
  scrubbed event is captured naming the job — `test_observability.py::test_ac6_failing_worker_job_is_reported`
- [ ] AC7 Given no `VITE_SENTRY_DSN`, Then `Sentry.init` is never called — `web/src/app/__tests__/sentry.test.tsx::ac7_off_without_dsn`
- [ ] AC8 `routePattern` maps `/listings/abc`, `/me/listings/abc/edit`, `/chat/abc`, `/` and `/nope` to their
  patterns (`/*` for the last); `beforeSend` turns `/listings/abc?budget=5000#x` into `/listings/:id`, drops
  `user` and `request.headers`, redacts emails; `beforeBreadcrumb` drops console breadcrumbs and strips query/hash
  from fetch, xhr and navigation ones (`/flatmates/join?token=…` → `/flatmates/join`) — `sentry.test.tsx::ac8_events_and_breadcrumbs_scrubbed`
- [ ] AC9 A render error inside `AppErrorBoundary` shows `common.error` and the `common.retry` button, which calls
  `window.location.reload` — `web/src/app/__tests__/sentry.test.tsx::ac9_error_boundary_fallback`
- [ ] AC10 `build-check` reports a problem and exits 1 when `dist/` contains a `.map` file; a dist without one
  passes that check — `web/scripts/__tests__/build-check.test.ts::ac10_no_source_maps_served` (the file's existing
  fixture-dist pattern)
- [ ] AC11 `/privacy` shows the Sentry item — `web/src/features/legal/__tests__/LegalPage.test.tsx::ac11_privacy_names_sentry`
- [ ] NF1 `make lint`, `make test`, `make i18n-check` green; CI build + build-check and e2e unchanged (no DSN or
  `SENTRY_AUTH_TOKEN` in CI). e2e runs only in CI.

## Tests to write
Unit: the scrubber on hand-built events (API and web), `routePattern`. Integration: FastAPI `TestClient` with
`sentry_sdk.init` on a capturing transport (no network), each API AC above; close the client after each test
(`sentry_sdk.get_client().close()` / a fixture) so the rest of the suite runs with Sentry off. E2E: none (inert in
CI).

## Blast radius
`graphify affected` on `main`, 2026-11-17:
- `create_app` — `api/tests/conftest.py::client`, `test_areas.py`, `test_auth.py`, `test_chat_events.py`,
  `test_db_errors.py` (both 503-log tests), `test_hardening.py`, `test_photos.py`, `test_tour_feed.py`,
  `api/scripts/export_openapi.py`. All run with no DSN, so `init_sentry` is a no-op; untouched. `ignore_logger`
  affects only Sentry, so the 503-log assertions in `test_db_errors.py` still see the records.
- `WorkerSettings` / `on_startup` (`api/app/worker.py`) — no code caller (arq loads it by name); tests importing
  `app.worker` get the module-level init as a no-op. `on_startup` unchanged.
- `RedactFeedToken` / `redact_path` (`api/app/services/tour_feed.py`) — reused, not changed (`create_app`, the two
  503 handlers, `test_tour_feed.py::test_ac12_access_log_redacts_feed_token`).
- `Settings` (`api/app/config.py`) — `get_settings`, `api/tests/test_config.py` (defaults, `repr` hides DSNs:
  `sentry_dsn` is a `SecretStr`, so `test_dsns_never_appear_in_repr` holds; add it there if that test lists fields).
- `AppRoutes` (`web/src/app/routes.tsx`) — `App.tsx` and the tests that render it: `app/__tests__/{KitPreview,Layout,
  queryClient,SideSwitch,usePageTitle}.test.tsx`, `features/auth/__tests__/routes.test.tsx`,
  `features/search/__tests__/routes.test.tsx`, `LandingPage.test.tsx`, `LegalPage.test.tsx`,
  `MarketMinePage.test.tsx`, `AccountDeletedPage.test.tsx`. Extracting `appRouteTree` keeps `AppRoutes`' output
  identical; these must pass unchanged.
- `App` / `main.tsx` — only `main.tsx` imports `App`; wrapping it in `AppErrorBoundary` changes nothing else.
- `privacyDoc` (`web/src/features/legal/content.ts`) — `LegalPage.tsx`; `LegalPage.test.tsx` (its section/item
  count checks must include `i8`).
- `web/vite.config.ts`, `web/scripts/build-check.mjs` — `make build-web` / `make build-check` and
  `web/scripts/__tests__/build-check.test.ts`; with no token the plugin is absent and the existing checks are
  unchanged.

## Risks / open questions
- A Postgres or Redis outage emails no one (handled 503s and health pings are ignored); accepted, uptime monitoring
  is in the plan's "Later". An SMTP, R2 or Google outage does email (their services log at ERROR).
- Exception text from our own code is kept (emails redacted); only SQLAlchemy / psycopg / pydantic messages are
  blanked. A phone or name in some other exception message would still go out; none is known today.
- `0019b` builds on this branch and reuses `routePattern`; keep it an exported function in its own file.
- Found in the build (coder, 2026-11-17), no decision needed: `@sentry/react` 11 has no `sendDefaultPii` (removed;
  its replacement `dataCollection` defaults to collecting user info, cookies, headers, bodies and query params), so
  `initSentry` sets `dataCollection` with all of those off instead; `beforeSend` scrubs either way. sentry-sdk 2.75.0
  deprecates `send_default_pii`, so `init_sentry` passes `data_collection` with everything off instead (review).
- Before tracing is ever turned on (`SENTRY_TRACES_SAMPLE_RATE` > 0): the scrubber redacts emails and feed tokens in
  spans but keeps span `data`, where an httpx span holds the Nominatim query (street and city); review span
  scrubbing then.
- `@sentry/react` / `@sentry/vite-plugin` 11.13.0 were published 2026-11-16 16:28 UTC; pnpm 12's default
  `minimumReleaseAge` (1 day) refuses them until 2026-11-17 16:28 UTC. Not worked around in the repo (no
  `minimumReleaseAgeExclude`, as 0000b chose); CI's `pnpm install --frozen-lockfile` passes once the day is over.

## Verifier findings (2026-11-17, applied in place)
1. Worker init moved from `on_startup` to module level: arq's integration wraps jobs in `create_worker`, which runs
   before `on_startup` (sentry-sdk 2.75.0 `integrations/arq.py`, Sentry arq docs).
2. `failed_request_status_codes=set()`: the default (500–599) would report the three `HTTPException(503)`s.
3. The handled 503 handlers and `/health` pings log at ERROR, so the logging integration would send them:
   `ignore_logger("app.main")`, `ignore_logger("app.services.health")`.
4. SQLAlchemy / psycopg / pydantic exception text carries parameters (names, phones) that an email regex misses:
   blanked; AC5 extended. Breadcrumb `data` dropped (httpx URLs hold addresses); `extra` dropped.
5. Feed-token redaction is `redact_path()` in `app/services/tour_feed.py` (output `/tour-feed/[redacted]`), not in
   `main.py`; applied to every string, `transaction` included.
6. Routes are JSX `<Routes>`, not a route config: `appRouteTree` + `createRoutesFromChildren`/`matchRoutes` in a
   new `routePattern.ts`. Browser `request.headers` (Referer) dropped.
7. Fallback reuses `ErrorState` with `common.error`/`common.retry`; no `common.errorBoundary`/`common.reload` keys.
8. `legal.privacy.s3.i7` already exists (calendar feed): new item is `i8`, Hebrew text given; PRODUCT.md Retention line.
9. AC10 path is `web/scripts/__tests__/build-check.test.ts`; web test file is `.tsx` (it renders JSX).
10. Versions pinned; option names confirmed: sentry-sdk 2.75.0 (`include_local_variables`, `max_request_body_size`,
    `send_default_pii`, `before_send_transaction`, `transaction_style`, `failed_request_status_codes`,
    `ArqIntegration`), `@sentry/react` 11.13.0 (`ErrorBoundary`, `beforeBreadcrumb`), `@sentry/vite-plugin` 11.13.0
    (`sourcemaps.filesToDeleteAfterUpload`; Sentry's current docs import the same plugin from
    `@sentry/bundler-plugins/vite`, which `@sentry/vite-plugin` wraps). `telemetry: false` added.
11. `qa` added to reviewers (UI fallback + API behaviour, checklist rule 8).

## Digest (filled by orchestrator after verification)
See `/digest`.
