# Slice 19 — Error tracking (Sentry) and product analytics (PostHog) (plan)

Status: done 2026-11-17 (0019a PR #128, 0019b PR #130). Decided 2026-11-17 (Gilad accepted every recommendation: 1a, 2a, 3a, 4a, 5 off). Decisions are in `PRODUCT.md` "Observability"; this file is the slice breakdown and
moves to `specs/archive/` when the slice is done.

## Why
- **Sentry:** today a server error lands only in logs nobody reads (0013a Decision 1 recommended Sentry's free tier;
  FOLLOWUPS 0013h asks for an alert when the nightly purge fails). A browser error is invisible.
- **PostHog:** we have no numbers on the funnel the slices were built for: visit → sign-up → listing published /
  application sent → shortlist → chat → tour booked, and who comes back.

## Ground rules (both tools)
1. **Off unless configured.** Empty DSN / key = the SDK is never initialised. Local dev, vitest, pytest and CI e2e
   send nothing. Building costs nothing; only production sets the keys (0013a's runbook gets the lines).
2. **EU data region** (Sentry `de.sentry.io`, PostHog `eu.posthog.com`, both Frankfurt), free tiers only
   (Sentry 5k errors/month; PostHog 1M events/month). No card on file.
3. **No personal data leaves.** Never email, name, phone, message text, profile answers, cookies, `Authorization`,
   request bodies or query strings. URLs are sent as the **route pattern** (`/listings/:id`), never the real URL:
   search filters (budget, areas) live in query strings, and `/tour-feed/{token}.ics` and the flatmates invite carry
   secrets (0018d already redacts the feed token from access logs; Sentry must do the same).
4. **Privacy policy names both processors** (`web/src/features/legal/content.ts`), what each receives and where it
   is stored, plus a `Retention` line in `PRODUCT.md`.
5. **No new UI** unless Decision 2 picks (b).

## What gets built
**Sentry (API, worker, web)**
- API: `sentry-sdk[fastapi]` initialised in `create_app()` (`api/app/main.py`); `send_default_pii=False`;
  a `before_send` that drops headers/cookies/body/query and rewrites URLs to the route template.
  4xx and the handled 503s (`_database_unavailable`, `_redis_unavailable`) are not errors.
- Worker: the same init in `on_startup` (`api/app/worker.py`) with the SDK's arq integration, so a failing cron job
  (`purge_expired_job`, `send_tour_mail_job`, imports) is an alert. Closes FOLLOWUPS 0013h.
- Web: `@sentry/react` in `web/src/app/main.tsx` with an error boundary; release = git sha; source maps uploaded by
  `make deploy-web` (`@sentry/vite-plugin`, `SENTRY_AUTH_TOKEN` in the local env only, never in CI or the bundle)
  and not served publicly.
- Alerts: Sentry's default "new issue" email to Gilad. No Slack, no paging.
- Out: the admin app (Gilad is its only user), the waitlist site (no-analytics promise in `waitlist/README.md`),
  performance tracing (Decision 4).

**PostHog (web + API)**
- Web: `posthog-js`, autocapture **off**, session replay **off**, `$pageview` on route change with the route pattern,
  plus a short list of UI events (search run, listing opened, sign-up started). No identify in the browser.
- API: `posthog` (Python) captures the **business events where they happen**, so they are counted even with an
  ad blocker: `signed_up`, `listing_published`, `application_sent`, `application_shortlisted`, `chat_opened`,
  `tour_booked`, `account_deleted`. `distinct_id` = the user's UUID; properties are non-personal only
  (listing type, area id, role, login method). Captures go out from the SDK's background thread, never blocking
  a request; a PostHog outage never fails one.
- A daily worker job deletes from PostHog every account deleted in the last 7 days (Decision 3; idempotent, no new column).

**New dependencies:** `sentry-sdk`, `posthog` (api); `@sentry/react`, `@sentry/vite-plugin` (dev), `posthog-js` (web).
**CSP:** `connect-src` already allows `https:` (0013a `_headers`); nothing to change.

## Specs (Slice 19, full-stack each)
| Spec | What | depends_on |
| --- | --- | --- |
| `0019a-sentry` | API + worker + web init, scrubbing, source maps in `make deploy-web`, env vars, privacy text, 0013h alert | — |
| `0019b-posthog` | Web pageviews + UI events, API business events, deletion job, env vars, privacy text | 0019a |

`0019b` starts from `0019a`'s branch once its PR is open (shared route-pattern matcher, same privacy section,
`.env.example`, `main.tsx`) and merges `origin/main` after `0019a` lands.
Reviewers: `code` + `security` on both (rule 3 is the risk), `qa` on `0019b`. Coder Opus/high (data leaving the app).
Each spec ends with a test that proves rule 3: a captured event / error payload contains no email, no query string
and no token (a fake transport in pytest, a mocked `capture` in vitest).

## Decisions (Gilad 2026-11-17: all recommendations accepted)
1. **Go-ahead for both free tiers, EU region**, as new processors named in the privacy policy.
   - (a) Both. (b) Sentry only for now. (c) Neither until 0013a deploys.
   - **Recommend (a)**, built now: inert until production sets the keys.
2. **How PostHog counts visitors in the browser.**
   - (a) Cookieless (`cookieless_mode: "always"`): no cookie or localStorage, no banner; unique visitors per day
     only. Returning-user numbers come from the API's events (signed-in users).
   - (b) Persistent anonymous id in localStorage: real anonymous retention, but needs a consent banner (new UI,
     i18n, a lawyer's look; 0013f decided "no trackers, so no banner").
   - **Recommend (a).** Revisit if anonymous retention turns out to matter.
3. **Deleted accounts in PostHog.**
   - (a) Delete the person's events via PostHog's API when the account is deleted (one call from the worker;
     needs a PostHog personal API key as a secret).
   - (b) Keep them: the UUID no longer maps to anyone once our row is gone (the lawyer confirms).
   - **Recommend (a)**: matches how deletion works everywhere else (0013c/0013h).
4. **Sentry performance tracing.**
   - (a) Errors only at launch. (b) 5% of requests traced (slow-endpoint data, uses the free span quota).
   - **Recommend (a).** Turn on later by one env var (`SENTRY_TRACES_SAMPLE_RATE`).
5. **Session replay:** off (chat and profiles are personal). Confirm. **Recommend off.**

## Later (not this slice)
A PostHog reverse proxy on our own domain (ad blockers), feature flags / A/B tests, dashboards beyond PostHog's
defaults, uptime monitoring, Sentry for the admin app.
