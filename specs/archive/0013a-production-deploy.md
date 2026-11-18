---
id: 0013a
title: "homie can be deployed to production: Fly.io in Frankfurt with managed Postgres, a private Redis and admin, and the web on Cloudflare Pages, from `make deploy-*` and one runbook"
status: in-review
depends_on: []   # 0013b, 0013c, 0013e, 0013f, 0016, 0018, 0019 and 0021 are all merged; 0022a may land either side
reviewers: [code, security, qa]   # security: admin, Redis and DB exposure, secrets, web security headers; qa (Sonnet): gzip changes API responses; no ux (no screen)
estimate: 1 coder run   # coder Opus/high (production data, secrets; Speed rule 6)
---

## Goal
After this ships, Gilad can put homie on the internet. He follows one runbook (`infra/DEPLOY.md`) for the
one-time account, domain and secret steps, then runs `make deploy-redis`, `make deploy-api`,
`make deploy-admin` and `make deploy-web DOMAIN=<domain>` from a clean checkout of `main`. The runbook
ends with a smoke test and a restore drill. The result:
- the API and worker run on Fly.io in Frankfurt against Fly Managed Postgres (PostGIS);
- Redis and the admin dashboard run as Fly apps with no public address (the admin is reached with `fly proxy`);
- the web is a static build on Cloudflare Pages, on the same registrable domain as the API.

Serves PRODUCT.md "Launch (Slice 13)", "Launch area" (all of Israel, Slice 21) and FOLLOWUPS 0012b (the admin's
production deploy). Building this spec spends nothing and creates no account: no real deploy runs in the build.

## Decisions this spec builds on
- PRODUCT.md "Launch (Slice 13)" (Gilad, 2026-11-15):
  - Hosting is Fly.io in Frankfurt with **Fly Managed Postgres** (MPG), with the API, worker, Redis and the
    private admin as Fly machines.
  - The web is a static build on **Cloudflare Pages**.
  - Web and API share **one registrable domain**, which Gilad buys. Running cost is now about $76–81 a month with email, approved.
  - No SMS. Login is email OTP, password (0016a) and optional Google sign-in (0016b).
  - Digest email and Protomaps are not before launch; the map stays on public OSM tiles.
- PRODUCT.md "Admin (Slice 12)": the admin is a separate Fly app with **no public IP**, reached with
  `fly proxy`; its own Postgres role reads everything and writes only its columns (0012b NF2).
- PRODUCT.md "Pricing": paid services need Gilad's explicit decision. Paid hosting and Resend Pro are that decision
  (2026-11-18). Cloudflare Pages and DNS cost nothing.
- Q1 (decided 2026-11-18, PRODUCT.md "Launch area"): `RENT_REFERENCE` and `CBS_RENT` stay `off` and production never contacts
  nadlan.gov.il. Launch has settlements only; there is no rent import.
- PRODUCT.md "Launch area" / 0021a1: the area catalogue is data, loaded by hand with the import script after the
  first migration, never by the release step.
- PRODUCT.md "Observability" (0019a, 0019b): Sentry and PostHog are off without keys; the deploy works either way.
- What already exists and is reused unchanged:
  - `Settings._email_and_production_rules` (`api/app/config.py`) already refuses dev defaults when
    `WEB_ORIGIN` is https: the dev `SECRET_KEY` and `EMAIL_BLOCK_KEY`, `COOKIE_SECURE=false`, an implicit
    `EMAIL_BACKEND` / `GEOCODER` / `PHOTO_BACKEND`, a non-R2 photo store, a dev `NOMINATIM_USER_AGENT` and
    `GOOGLE_VERIFIER=fake`.
  - `infra/Dockerfile.api` and `infra/Dockerfile.admin` are already production images. Their `CMD` has no
    `--reload`; compose adds reload and the bind mounts only in its `command:` and `volumes:`. They run as
    uid 10001.
  - `.dockerignore` keeps every `.env` out of the build context.
  - The auth cookie (`routers/auth.py`) is host-only, `SameSite=Lax`, and `Secure` from `COOKIE_SECURE`. CORS
    allows exactly `WEB_ORIGIN`, with credentials.

## Production topology

| Piece | Where | Public? | Size (Fly preset) | Config |
| --- | --- | --- | --- | --- |
| API (`app` process group) | Fly app `homie-api`, `fra` | yes: `api.<domain>`, Fly TLS | shared, 1 CPU, 1 GB (photo decodes) | `infra/fly/api.toml` |
| Worker (`worker` process group) | same app, same image | no service | shared, 1 CPU, 512 MB | `infra/fly/api.toml` |
| Postgres + PostGIS | Fly Managed Postgres, Basic, `fra` | private (6PN) | MPG Basic (~$38/month) | runbook only |
| Redis | Fly app `homie-redis`, `fra`, 1 GB volume | **no** (6PN only, password) | shared, 1 CPU, 256 MB | `infra/fly/redis.toml`, `infra/Dockerfile.redis` |
| Admin dashboard | Fly app `homie-admin`, `fra` | **no** (`fly proxy` only) | shared, 1 CPU, 512 MB | `infra/fly/admin.toml` |
| Web (static) | Cloudflare Pages project `homie` | yes: `<domain>` (apex) | free | `web/public/_headers` |
| Photos | Cloudflare R2 bucket, custom domain `media.<domain>` | yes (unguessable keys, 0010d) | free tier | runbook only |
| DNS | Cloudflare (free plan); the registrar points its nameservers there | — | — | runbook only |
| Email | Resend Pro, EU region (Ireland, `eu-west-1`), over SMTP | — | $20/month | runbook only |

Cost at these sizes: MPG Basic ~$38, plus machines ~$15–20 (Fly's October 2026 prices), plus a $0.15 volume, plus
MPG storage at $0.28/GB ($2.80 for the default 10 GB; runbook §2 sets `--volume-size` deliberately).
That is **about $56–61 a month on Fly**, plus Resend Pro at $20: **about $76–81 a month**. Each app runs **one** machine (`--ha=false`).
A second API machine (about $7 a month more) would remove the ~30-second gap each deploy causes; it is left
out for cost (see the Digest FYI).

**Why the API host is DNS-only (grey cloud) at Cloudflare, not proxied:**
- Fly issues the certificate for `api.<domain>` itself.
- The client IP stays Fly's `Fly-Client-IP`, which 0013b reads. Behind Cloudflare's proxy, every request
  would come from a Cloudflare address.

**Why DATABASE_URL uses MPG's direct host** (`direct.<cluster>.flympg.net`), not the PgBouncer one:
- SQLAlchemy already pools per process.
- `db.py` sends the `options=-c jit=off` startup parameter.
- MPG's PgBouncer runs in session mode, which pins one server connection per pooled client connection, so
  it adds nothing at three processes.

The runbook checks `SHOW max_connections` (≥ 50 needed: API 15 + worker 15 + admin 15 + release 1).

## Scope
**In:**
1. `infra/fly/api.toml`: app `homie-api`, `primary_region = "fra"`, built from `infra/Dockerfile.api` with
   the repo root as context.
   - **Processes:**
     - `app = "uvicorn app.main:app --host 0.0.0.0 --port 8000 --timeout-graceful-shutdown 5"` (the
       Dockerfile `CMD`, stated because process groups need their commands);
     - `worker = "arq app.worker.WorkerSettings"`.
   - **`kill_timeout = 10`** (top level): uvicorn's 5 s graceful shutdown equals Fly's default `kill_timeout` of 5 s, so
     the default could kill it mid-shutdown.
   - **`[http_service]`** for `processes = ["app"]` only:
     - `internal_port = 8000`, `force_https = true`, `auto_stop_machines = "off"`,
       `min_machines_running = 1`;
     - `[http_service.concurrency]` with `type = "connections"`, `soft_limit = 400`, `hard_limit = 500`.
       Each open tab holds one SSE stream (`/me/events`, 0005c), so Fly's default hard limit of 25
       connections would queue the 26th tab. The stream is async, so the limit is connections, not threads;
     - one `[[http_service.checks]]`: `GET /health`, interval 15 s, timeout 5 s, grace period 30 s.
   - **`[deploy] release_command = "/opt/venv/bin/alembic upgrade head"`**: migrations only, once per deploy, in
     a release machine, before any new machine starts; a failure aborts the deploy. It never runs
     `scripts/seed.py`: on an empty database that script stores the rent **test fixtures'** neighbourhoods
     (`api/tests/fixtures/`), which would then sit in production (FOLLOWUPS 0021a1). Migration `0031` inserts the 19
     launch-box settlements, so the app has areas until the import (runbook §6) adds the rest.
   - **`[[vm]]`** per process group, sized as in the table.
   - **`[env]`** (non-secret, fixed): `EMAIL_BACKEND = "smtp"`, `COOKIE_SECURE = "true"`,
     `GEOCODER = "nominatim"`, `PHOTO_BACKEND = "r2"`, `RENT_REFERENCE = "off"`, `CBS_RENT = "off"`,
     `TRUST_PROXY = "fly"`, `SENTRY_ENVIRONMENT = "production"`.
   - **Required Fly secrets.** Every value that is secret *or names the domain* is a Fly secret, set once in the
     runbook and kept across deploys, so `api.toml` holds no domain. Api and worker are one Fly app and share them:
     `DATABASE_URL`, `REDIS_URL`, `SECRET_KEY`, `SMTP_URL`, `EMAIL_FROM`, `WEB_ORIGIN`, `PHOTO_PUBLIC_BASE_URL`,
     `NOMINATIM_USER_AGENT`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
     `EMAIL_BLOCK_KEY` (`$(openssl rand -hex 32)`, **never rotated**: it keys the deleted-account email hashes) and
     `CONTACT_EMAIL`.
     - `CONTACT_EMAIL` is the API's own setting from spec **0022a** (the address in security emails), separate from
       the web build's `VITE_CONTACT_EMAIL`; both hold the same public address. 0022a refuses its placeholder on an
       https origin, so without it the API will not start once 0022a is in. Always set it: if 0022a has not merged,
       `Settings` simply ignores it, so the order of the two PRs does not matter.
     - The worker gets `WEB_ORIGIN` this way, so the https rules and Scope 6 now run there too (FOLLOWUPS 0003c).
   - **Optional Fly values** (each feature stays off without them):
     - Google sign-in (0016b): `GOOGLE_VERIFIER=google` and `GOOGLE_CLIENT_ID` (not secret, set with the secrets so
       turning it on needs no code change); the web build needs the same id as `VITE_GOOGLE_CLIENT_ID`.
     - Sentry (0019a): `SENTRY_DSN`, from an EU-region (`de.sentry.io`) project. `SENTRY_RELEASE` is not a secret:
       `make deploy-api` passes the git sha on every deploy (Scope 7), so it cannot go stale.
     - PostHog (0019b): `POSTHOG_KEY`, `POSTHOG_PERSONAL_API_KEY` (scope `person:write` only) and
       `POSTHOG_PROJECT_ID`. In the EU PostHog project turn on **Cookieless server hash mode** (without it cookieless
       events are dropped) and **Discard client IP data**. After the first account deletion, check that
       `posthog_forget_job` got a 202 and that `persons_queued_for_deletion` shows it in PostHog (that request body
       was never tried against a real project).
   - **The worker's crons need no further setting:** geocoding, view flush, purge (0013h), tour mail and reminders
     (0018c), PostHog forget. The two rent imports stay no-ops while their switches are `off`.
2. No release script: `api/scripts/release.sh` is **not** created (the `release_command` above is the whole step).
   `api/data/settlements.csv` already ships in the API image through `COPY api/ ./`; AC6 proves it stays there.
3. `infra/Dockerfile.redis`, from `redis:7.4-alpine` pinned to an exact patch version and its digest.
   - Its `CMD` is a `sh -c` that refuses to start without `REDIS_PASSWORD`, then
     `exec docker-entrypoint.sh redis-server …`. Going through the image's entrypoint is what drops root and fixes the
     ownership of `/data`; a bare `exec redis-server` inside `sh -c` runs as uid 0. The arguments:
     - `--bind "* -::*"` (IPv4 and the IPv6 6PN), `--requirepass "$REDIS_PASSWORD"`, `--appendonly yes`,
       `--dir /data`;
     - `--maxmemory 200mb --maxmemory-policy noeviction`. That is today's policy (the default) with a cap
       below the 256 MB VM, so a full Redis refuses writes instead of the machine being OOM-killed.
   - `infra/fly/redis.toml`: app `homie-redis`, `fra`.
     - `[mounts] source = "redis_data"`, `destination = "/data"`.
     - A `[checks]` TCP check on 6379.
     - **No `[http_service]` and no `[[services]]`**: reachable only as `homie-redis.internal:6379` on the
       org's private network.
     - `REDIS_PASSWORD` is a Fly secret: `openssl rand -hex 32`, hex so it is URL-safe inside `REDIS_URL`.
4. `infra/fly/admin.toml`: app `homie-admin`, `fra`, built from `infra/Dockerfile.admin`.
   - **No `[http_service]` and no `[[services]]`.**
   - **No `[checks]`.** Fly requires a checked port to be available on `0.0.0.0`, and the admin listens on IPv6 only
     (below), so a check could never pass. An HTTP check would also get 400 from `TrustedHostMiddleware`.
   - `[env]`: `ADMIN_HTTPS_ONLY = "true"`, `ADMIN_ALLOWED_HOSTS = "localhost,127.0.0.1"` (`fly proxy`
     forwards the browser's `localhost:8001` Host unchanged).
   - Fly secrets: `ADMIN_DATABASE_URL`, `ADMIN_PASSWORD`, `ADMIN_SECRET_KEY`.
   - `infra/Dockerfile.admin`'s `CMD` binds `--host ::` instead of `0.0.0.0`. `fly proxy` reaches the
     machine on its IPv6 6PN address. This bind is **IPv6-only**: asyncio sets `IPV6_V6ONLY`, so `127.0.0.1` is refused
     (AC6 therefore probes `[::1]`). Compose overrides the command, so dev is unchanged.
5. `api/scripts/admin_role.py --existing-role`, `--verify`, and the admin's connection. **The hash-table part is Q2's
   option A, decided by Gilad on 2026-11-18.**
   - **What MPG is believed to do** (Fly docs and staff replies plus one customer report, simulated locally on
     `postgis/postgis:16-3.4`, never seen on a real cluster; runbook §7 probes it first):
     - users are made with `fly mpg users create`; a Reader has read-only access to **all** data in the cluster;
     - Fly's system roles cannot be changed and `CREATEROLE` is refused, so production cannot rely on `CREATE ROLE`;
     - a user may carry a `role=` setting, so a session's `current_user` can be `reader` (or `schema_admin` for
       `fly-user`, which then owns the tables). In such a session the grants on `homie_admin` are not in force and
       `INSERT admin_logins` is denied, so the admin login could not work.
   - **`create_admin_app`** (`api/admin/main.py`) passes `connect_args={"options": "-c role=none"}` to `make_engine`
     (which already merges options), so the session runs as `homie_admin` itself. Dev and tests are unaffected.
   - With `--existing-role`, `apply_admin_role(database_url, password=None, existing_role=True)`:
     - requires that `homie_admin` exists, else exits with "homie_admin does not exist: create it with
       `fly mpg users create` (Reader)";
     - skips `CREATE/ALTER ROLE`, the group-membership `REVOKE`s, the two database-level statements
       (`REVOKE ALL ON DATABASE`, `GRANT CONNECT`) and both `ALTER DEFAULT PRIVILEGES` statements, which would run as a
       system role and may be refused (the runbook already re-runs the script after migrations);
     - runs every remaining schema, table, sequence and column statement as today, in the same single transaction;
     - runs `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on `user_passwords` and `tour_feeds`, with **no policy** and no
       `FORCE`. The app connects as the table owner and is unaffected; any other role sees zero rows. No migration:
       dev and CI keep plain grants.
   - **`_assert_rights(conn, role)`**, a post-check run inside the transaction before commit in **both** modes. It raises
     (rolling back), naming the table or column, if the role holds *effective* privileges outside the intended set,
     inherited ones included. It covers `public` relations of kinds `r, p, v, m, f`:
     - in `_NO_ACCESS` (`user_passwords`, `tour_feeds`: password and calendar-token hashes), any privilege checked with
       `has_table_privilege` **and** `has_any_column_privilege`. In existing-role mode only, an inherited SELECT that
       cannot be removed is tolerated when the table has row-level security on, has no policy, and the role lacks
       `BYPASSRLS` (`pg_roles.rolbypassrls`); a write privilege is never tolerated;
     - any table-level INSERT, UPDATE, DELETE or TRUNCATE other than INSERT on the tables in a new constant
       `_INSERT_GRANTS = ("admin_actions", "admin_logins")`;
     - any column-level UPDATE (`has_column_privilege` over `pg_attribute`) outside `_COLUMN_GRANTS`.
     - the same rules for **every role it belongs to** (`pg_has_role(role, oid, 'MEMBER')`, which follows indirect membership;
       `SET ROLE` reaches what inheritance does not, and `ADMIN OPTION` can grant itself `SET`). A superuser or `BYPASSRLS` role
       among them is refused, as are `CREATE` on schema `public` and `UPDATE` on a `public` sequence.
     - Existing-role mode sets `lock_timeout = '5s'`, so `ENABLE ROW LEVEL SECURITY` cannot queue logins behind it on a re-run.

     The two `GRANT INSERT` statements are generated from `_INSERT_GRANTS`, so the grants and the check read one list.
   - **`--verify`** connects with `ADMIN_DATABASE_URL` the way the admin does (`options=-c role=none`), requires
     `current_user = homie_admin`, runs `_assert_rights` for `current_user` with the existing-role rules, and changes
     nothing. It is what proves the real session, while the post-check above can only ask about the role by name.
   - `main()` reads the flags from `sys.argv`; `ADMIN_DB_PASSWORD` is then not needed.
   - Dev, the tests and `make admin` keep the normal mode.
6. `api/app/config.py`: a field `fly_app_name: str | None = None`. Fly sets `FLY_APP_NAME` on every machine,
   so this turns on the production checks there. The rules apply only when `fly_app_name` is **non-empty**
   (an empty value counts as unset). When it is, `_email_and_production_rules` also refuses:
   - `WEB_ORIGIN` not https ("WEB_ORIGIN must be https on Fly"); this keeps every existing https rule in
     force on Fly, the worker included;
   - `EMAIL_BACKEND` other than `smtp` (on Fly a `file` outbox would swallow every login code and hold tour
     details on disk, FOLLOWUPS 0018c);
   - `GEOCODER` other than `nominatim` (fake points on real listings);
   - `NOMINATIM_URL` not https (FOLLOWUPS 0003c);
   - `TRUST_PROXY` other than `fly` (every visitor would share one per-network limit; homie must not run so);
   - `RENT_REFERENCE` other than `off` (production must never contact nadlan.gov.il; its terms forbid it, and a Fly
     secret or the worker cron could otherwise turn it on).

   Messages name the rule, never a value. Without `FLY_APP_NAME` nothing changes. The existing https test
   profile (`file` / `fake`, `test_config.py::_HTTPS_READY`) still validates.
7. `Makefile`:
   - **Parse-time rule:** the `DOMAIN` check and every `deploy-guard` check (`fly` on `PATH`, `git fetch`,
     `git status`) run **inside recipes only**. No top-level `$(error …)` and no `$(shell git …)` or
     `$(shell fly …)`. `WRANGLER_VERSION` already exists (0017) and is reused; no second definition.
     `test_dotenv.py` copies the real `Makefile` and `infra/dotenv.awk` to a temp dir and `include`s it, so any
     parse-time code would break its tests.
   - **`deploy-guard`** (a prerequisite of `deploy-redis`, `deploy-api`, `deploy-admin`, `deploy-web` and
     `admin-role-prod`, **not** of the existing `deploy-waitlist`, which needs no `fly`) fails with a clear line unless:
     - `fly` is on `PATH`;
     - `git fetch -q origin main` succeeds and `HEAD` equals `origin/main`;
     - `git status --porcelain` is empty, so no modified or untracked (non-ignored) file can reach an image. Ignored
       files are not shown by it; `.dockerignore` handles those (Scope 11). The main checkout holds untracked seed and
       promo work and `../rent-app-orch` is routinely dirty, so deploys run from a **dedicated clean checkout of `main`**.
   - **Targets:**
     - `deploy-api`: `fly deploy . --config infra/fly/api.toml --dockerfile infra/Dockerfile.api --remote-only --ha=false --env SENTRY_RELEASE=$$(git rev-parse HEAD)`;
     - `deploy-redis` and `deploy-admin`: the same with their own config and Dockerfile, without `--env`;
     - `admin-role-prod`: `fly ssh console --config infra/fly/api.toml --process-group app -C "/opt/venv/bin/python /app/scripts/admin_role.py --existing-role"`.
       It uses the API machine, which has `DATABASE_URL` and `scripts/`, so no local database tunnel is needed;
     - `admin-role-verify-prod`: `fly ssh console --config infra/fly/admin.toml -C "/opt/venv/bin/python /app/scripts/admin_role.py --verify"`.
       It runs on the admin machine, which has `ADMIN_DATABASE_URL`, and changes nothing;
     - `import-areas-prod`: `fly ssh console --config infra/fly/api.toml --process-group worker -C "/opt/venv/bin/python /app/scripts/import_areas.py"`.
       `make import-areas` cannot be used on Fly: it runs through local `uv` against whatever `DATABASE_URL` the
       checkout has. Settlements only, no outside request (Q1). The target is run by hand (runbook §6), never by a deploy;
     - `deploy-web`: needs `DOMAIN` (`make deploy-web DOMAIN=example.co.il`, or `DOMAIN=` in the checkout's
       `.env`) and `CONTACT_EMAIL` (the public address on the terms and privacy pages; already exported by the
       Makefile for 0017). It prints its usage line when either is missing or `CONTACT_EMAIL` is
       `contact@example.com`. It runs `make client`, then
       `VITE_API_URL=https://api.$(DOMAIN) VITE_CONTACT_EMAIL="$$CONTACT_EMAIL" VITE_SENTRY_ENVIRONMENT=production VITE_SENTRY_RELEASE=$$(git rev-parse HEAD) $(MAKE) build-web`,
       then `make build-check`, then
       `cd web && pnpm dlx wrangler@$(WRANGLER_VERSION) pages deploy dist --project-name homie --branch main`.
       The optional `VITE_GOOGLE_CLIENT_ID`, `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY` and the build-only
       `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` come from the shell or the deploy checkout's git-ignored
       `.env` (the Makefile exports its keys);
     - `check-images` (CI and local): builds the three production images (`Dockerfile.api`, `.admin`,
       `.redis`) for the host architecture, then runs AC6's checks in throwaway containers, and removes them on
       exit even after a failure.
   - **Why `--remote-only`:** the Mac is arm64 and Fly machines are amd64; Fly's remote builder builds the
     right architecture without local Docker buildx.
   - Each target has a `##` comment and joins `.PHONY`.
8. `.github/workflows/ci.yml`: one step, "Check production images (`make check-images`)", after the Smoke suite (e2e) step; it does not need the stack.
9. `web/public/_headers` (copied into `dist/` by Vite):
   - `/*`:
     - `Content-Security-Policy: default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client;
       style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: blob: https:;
       font-src 'self' data:; connect-src 'self' https:; worker-src 'self' blob:; child-src blob:;
       frame-src https://accounts.google.com/gsi/; manifest-src 'self'; object-src 'none'; base-uri 'self';
       form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`
       - `script-src 'self'` is the XSS guard; the one extra source is Google's sign-in script
         (`GoogleButton.tsx` loads it, and its button is a frame under `/gsi/`);
       - the scheme-only `https:` sources cover the API, `media.<domain>`, OSM tiles, Sentry's ingest host and
         PostHog's (`eu.i.posthog.com`, with `disable_external_dependency_loading`, so it loads no script) without
         writing a domain into the build;
       - MapLibre's worker is a same-origin file (`setWorkerUrl`); `blob:` and `data:` remain for its images;
       - `font-src data:` covers a font Vite might inline below its 4 kB asset limit.
     - `Strict-Transport-Security: max-age=31536000; includeSubDomains`;
     - `X-Content-Type-Options: nosniff`;
     - `Referrer-Policy: strict-origin-when-cross-origin`. Not `no-referrer`: OSM's tile policy requires a
       Referer;
     - `X-Frame-Options: DENY`;
     - `Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=(), usb=()`.
       `LocateButton` uses geolocation.
   - `/assets/*`: `Cache-Control: public, max-age=31536000, immutable` (hashed names).
   - `/sw.js`, `/registerSW.js`, `/manifest.webmanifest`: `Cache-Control: no-cache`, so a deploy reaches
     every visitor (the 0009e autoUpdate worker). No `/index.html` rule: Pages serves `index.html` at `/` and
     as the SPA fallback, redirects `/index.html`, and already sends `max-age=0, must-revalidate` for HTML.
   - **No `_redirects`:** with no top-level `404.html` in the output, Pages serves `index.html` for unknown
     paths (its single-page-app default), and a `/* /index.html 200` rule is flagged by Pages as a loop.
10. `web/scripts/build-check.mjs` (+ tests): fails when `dist/_headers` is missing, any header line above
    differs, or `dist/404.html` exists. The service-worker precache already ignores `_headers`:
    `globPatterns` match js/css/html and the fonts only.
11. `.dockerignore`: add `**/.media`, `web/dist`, `web/test-results` (smaller upload to Fly's remote builder) and
    `api/tests`, which keeps test fixtures out of production images. Compose bind-mounts `api/`, and tests and seed run
    on the host, so dev and CI are unaffected.
    Also `waitlist/.dev.vars*`, `waitlist/.wrangler/` and `graphify-out/`: the whole root is uploaded to Fly's remote builder.
12. `.env.example`: a "Production only" comment block naming `FLY_APP_NAME` (set by Fly, never locally),
    `DOMAIN` (deploy-web only) and `REDIS_PASSWORD` (the Redis app's Fly secret), with no values. The API's
    settings are already listed there. That is hard rule 8 for the new names.
    - **One name per line, written so no `KEY=` pattern matches**, for example
      `#   FLY_APP_NAME: set by Fly, never locally`. `test_openapi_export.py::test_ac6_openapi_export_without_server`
      reads every `^(?:# )?KEY=(\S*)$` line of the file, commented ones and empty values included, last one
      wins, and builds `Settings` from them. A `# SECRET_KEY=` line would override the dev value with `""`, and
      an empty `FLY_APP_NAME` could switch the Fly rules on.
13. `infra/DEPLOY.md` (the runbook; README "Make targets" gets one line pointing at it). Every `fly`,
    `wrangler` and `openssl` call, in it **and in the Makefile targets**, is checked with `--help` in the
    versions the coder used. The `flyctl` and `wrangler` versions are written at the top of it. Secrets appear as **names only**. Sections:
    1. **Accounts (Gilad, once).** Fly org with billing, `brew install flyctl`, `fly auth login`. Cloudflare
       (exists for R2): `wrangler login` through `pnpm dlx`. Buy the domain; add it to Cloudflare (free
       plan); point the registrar's nameservers there.
       - Prerequisites on the deploy computer: Node `>=22.12 <23`, pnpm, uv, and a dedicated clean checkout of `main`.
       - Keep only homie's apps in this Fly organisation: they share one private network (accepted by Gilad, 2026-11-18).
       - `fly apps create` for `homie-api`, `homie-redis` and `homie-admin`. Fly app names are global: if one is taken,
         pick another and change `app` in its toml, the `*.internal` host in `REDIS_URL`, the `-a` values and the CNAME
         target below, through a PR.
    2. **Postgres.** `fly mpg create --enable-postgis-support --pg-major-version 16 --plan Basic --region fra`, with
       `--volume-size` chosen deliberately ($0.28/GB a month). Then, **before the first deploy**,
       `fly mpg databases extensions enable postgis --cluster <id> --database <db>`: a schema admin gets `permission
       denied to create extension`, while with this done migration `0001`'s `CREATE EXTENSION IF NOT EXISTS postgis` is a
       no-op. Check PostGIS is in schema `public` (`alembic/env.py` pins `search_path=public`). Check
       `SHOW max_connections`. Copy MPG's
       **direct** connection string and change its scheme to `postgresql+psycopg://` for `DATABASE_URL`.
    3. **Redis.** `fly volumes create redis_data` (1 GB, `fra`), the `REDIS_PASSWORD`
       secret, `make deploy-redis`. `fly ips list -a homie-redis` must be empty; release anything it lists.
    4. **Photos.** R2 bucket for production, custom domain `media.<domain>`, `r2.dev` access off. An API token
       scoped to that bucket with Object Read & Write supplies the four `R2_*` secrets. Add a **Cache Rule that bypasses
       the edge cache for `media.<domain>`**: objects are stored `immutable` for a year and Cloudflare keeps serving a
       cached object after it is deleted from R2, while homie tells users deletion is immediate. Browsers still cache.
       If R2 reads grow later, use a 2-hour Edge TTL (the Free-plan minimum) and adjust the privacy wording.
    5. **Email.** Resend Pro ($20 a month; decided 2026-11-18), EU region (Ireland, `eu-west-1`), over SMTP. Add `<domain>` in that
       region, copy Resend's SPF and DKIM records into Cloudflare, add `_dmarc` (`v=DMARC1; p=none`; tighten to `quarantine` after a
       clean week) and keep click tracking off (a tracking subdomain would need https: HSTS has `includeSubDomains`).
       `SMTP_URL=smtps://resend:<resend-api-key>@smtp.resend.com:465` (implicit TLS, which `parse_smtp_url` maps to `smtps://`) and
       `EMAIL_FROM=noreply@<domain>` go in through `fly secrets import`.
    6. **API.**
       - Set the secrets listed in Scope 1: `SECRET_KEY` and `EMAIL_BLOCK_KEY` from `$(openssl rand -hex 32)`
         (`EMAIL_BLOCK_KEY` is never rotated: keep it in Gilad's password manager);
         `WEB_ORIGIN=https://<domain>`; `PHOTO_PUBLIC_BASE_URL=https://media.<domain>`;
         `NOMINATIM_USER_AGENT="homie/1.0 (+https://<domain>)"`; `REDIS_URL` pointing at
         `homie-redis.internal:6379` with the password; `CONTACT_EMAIL=<contact address>`, the same public address
         as `make deploy-web` uses. Set it whether or not 0022a has merged yet.
       - Run `make deploy-api`, `fly certs add api.<domain>`, then add a CNAME from `api` to
         `homie-api.fly.dev`, **DNS-only**.
       - `curl https://api.<domain>/health` must answer `{"status":"ok",…}`.
       - `fly scale count app=1 worker=1` (exactly one worker: arq crons).
       - **Areas, once, after the first deploy.** Until then the app runs on migration `0031`'s 19 settlements.
         `make import-areas-prod` loads every settlement from the committed CSV and makes no outside request. Expect about
         1,188 settlements, `neighbourhoods: 0` and `files_failed: 0`. Production never contacts nadlan.gov.il (Q1), and
         `RENT_REFERENCE` and `CBS_RENT` stay `off`.
    7. **Admin.**
       - `fly mpg users create <id> -u homie_admin -r reader`. The documented output shows no password: get it with
         `fly mpg users rotate-password` or from the dashboard (the coder confirms which with `--help`).
       - **Probe first:** `fly mpg connect <id> -u homie_admin -c "select current_user, session_user"`, then run the
         privilege checks of Scope 5 against that `current_user`. If what it shows does not fit Scope 5, stop and bring it
         to the orchestrator.
         The probe also lists `rolname, rolsuper, rolbypassrls` for every role `pg_has_role(current_user, oid, 'MEMBER')`: stop if
         any row shows true. If the Reader has `BYPASSRLS` or superuser, or can otherwise reach the hash tables,
         `make admin-role-prod` refuses: stop, leave the admin undeployed and ask Fly for a narrower role (Gilad, 2026-11-18).
       - `make admin-role-prod` (grants, row-level security on the two hash tables, post-check).
       - Set `ADMIN_DATABASE_URL` (direct host, `homie_admin`), `ADMIN_PASSWORD` (16+, kept in Gilad's
         password manager) and `ADMIN_SECRET_KEY` (`openssl rand -hex 32`); `make deploy-admin`.
       - `make admin-role-verify-prod` must pass. If it fails, stop the admin machine.
       - `fly ips list -a homie-admin` must be empty.
       - `fly proxy 8001:8001 -a homie-admin`, then open http://localhost:8001/admin in Chrome. Chrome keeps
         the `Secure` cookie on `localhost`. If a browser drops it, set `ADMIN_HTTPS_ONLY=false`: the path is
         loopback plus Fly's WireGuard, already encrypted.
       - Re-run `make admin-role-prod` and `make admin-role-verify-prod` after any migration that adds a table or
         changes the admin's columns.
    8. **Web.**
       - Create the Pages project once (`wrangler pages project create homie --production-branch main`),
         then `make deploy-web DOMAIN=<domain> CONTACT_EMAIL=<contact address>`.
       - Attach `<domain>` as the Pages custom domain.
       - Optionally add a `www` → apex redirect rule: CORS allows only the apex.
       - **Google sign-in (optional).** In the Google OAuth client add `https://<domain>` as an authorised JavaScript
         origin and publish the consent screen. Set `GOOGLE_VERIFIER` and `GOOGLE_CLIENT_ID` on `homie-api`, put
         `VITE_GOOGLE_CLIENT_ID` in the deploy checkout's `.env`, and run `make deploy-api` and `make deploy-web`.
       - **Sentry / PostHog (optional).** Scope 1's names, then the same two deploys.
    9. **Smoke test (before telling anyone):**
       - **Fly-Client-IP check** (0013b's Risks cite it as "runbook §9, Fly-Client-IP check"): send 4
         `POST https://api.<domain>/auth/otp/request` calls for an address Gilad owns, each with a different
         forged header `-H 'Fly-Client-IP: 203.0.113.N'` (N = 1..4). The 4th must answer **429**: 0013b's
         per-(email, network) limit is 3 per 15 minutes and counts the real address only if Fly overwrites
         the client's header. If the 4th answers 204, **stop and keep homie private**; bring it to the
         orchestrator. Wait 15 minutes before the sign-up step, or use another address;
       - the landing loads;
       - sign up with a real address: the code arrives, not in spam;
       - post a listing with a photo: it shows from `media.<domain>`, and its map pin appears after the
         worker's geocode sweep;
       - open a chat in a second browser: a message arrives live over SSE. In DevTools `/me/events` shows protocol
         `h2`, `text/event-stream`, **no** `content-encoding`, and stays open past 2 minutes (FOLLOWUPS 0005c);
       - `curl --http2 -s -D- -o /dev/null -H 'Accept-Encoding: gzip' https://api.<domain>/areas` shows `HTTP/2 200`
         and `content-encoding: gzip`;
       - the city picker offers settlements across Israel;
       - log in with a password, and with Google if it is on;
       - book a tour between the two accounts: the email with its `.ics` arrives. Press "הוספה ליומן Google" and check
         the tour appears in Google Calendar (0018d R7; Google may take hours to fetch a new feed). `fly logs` must show
         `/tour-feed/[redacted]`, never the token;
       - delete a listing photo: its `media.<domain>` URL answers 404 from a fresh client (no browser cache);
       - delete a test account: it can no longer log in;
       - the map draws its tiles;
       - the PWA installs;
       - DevTools shows no `Refused to …` CSP line on the landing, search, map, listing, chat and profile
         pages. A violation's rollback is to edit `_headers` and run `make deploy-web`.
    10. **Restore drill (before launch, then quarterly).** `fly mpg backup list <id>`, then
        `fly mpg restore <id> --backup-id <backup>` into a *new* cluster, which is **billed until destroyed**. Connect and
        compare row counts of `users`, `listings` and `messages` with production (the restored counts may be lower: the
        backup is older). Check `alembic_version` and `postgis_version()`. Write down how `DATABASE_URL` and
        `ADMIN_DATABASE_URL` would be switched to it. Then destroy the restored cluster. Write the date and the time it
        took at the bottom of `DEPLOY.md`.
    11. **Day-2.**
        - Deploy = the four targets from a clean `main` (`make deploy-web` needs `DOMAIN` and `CONTACT_EMAIL`); `fly releases --image` and `fly deploy --image … --skip-release-command` roll back (the old image's `alembic upgrade head` would fail on a newer revision; the old code must tolerate the newer schema).
        - A release whose migration changes the admin's grants (for example 0013e's `admin_logins`) deploys
          in order: `make deploy-api` (migrates), then `make admin-role-prod`, then `make deploy-admin`.
        - Logs: `fly logs -a homie-api`. Confirm Fly's log retention here; its docs say 7 days, inside the 30 days the
          privacy policy promises.
        - `/health` answers 503 while Redis is down, and a failing check stops Fly routing to the machine. So
          `make deploy-redis` or a Redis blip takes the **whole API** offline, browsing included, until Redis is back.
          Deploy Redis at a quiet hour.
        - **Redis memory alert.** Redis refuses writes at 200 MB (`noeviction`), which would stop logins. In
          Fly's managed Grafana (free), add an alert on `homie-redis`'s machine memory that emails Gilad at
          70% of the 256 MB VM; the coder confirms the metric name in Grafana and writes it here. No code.
          Once, check `redis-cli INFO memory` over `fly ssh console -a homie-redis` for the idle baseline
          and write it next to the alert. If it fires: look at `INFO memory`, then raise the VM and
          `--maxmemory` together.
        - If Redis's volume is lost: create a new one and `make deploy-redis`. It costs live OTP codes, rate-limit
          counters, one minute of views, the arq queue and any **tour emails still queued** (`tour_mail`). Those emails
          are not re-sent; the tours themselves are in Postgres and the geocode sweep re-finds its work.
    12. **Waitlist on `join.<domain>`** (it is live on `homie-waitlist.pages.dev`; steps in `waitlist/README.md`).
        In this order: add `join.<domain>` to the Turnstile widget's hostnames; commit `ALLOWED_ORIGIN =
        "https://join.<domain>"` in `waitlist/wrangler.toml` through a PR; run `make deploy-waitlist`; add the custom
        domain on the Pages project; add the zone's one free rate-limit rule for `/api/signup`; send one test signup
        and remove it with `make waitlist-delete`. After this `homie-waitlist.pages.dev` refuses signups, so update any
        link that points there first.
14. `infra/Dockerfile.api` and `infra/Dockerfile.admin`: pin the `ghcr.io/astral-sh/uv` base image by digest, keeping
    the tag (`…:0.12.16-python3.12-trixie-slim@sha256:<multi-arch index digest>`), so amd64 on Fly and arm64 locally
    both resolve (FOLLOWUPS 0000a). `Dockerfile.admin`'s `CMD` change is in Scope 4.
15. `api/app/main.py`: compress API responses, so `GET /areas` (~183 KB, loaded by every full-map visitor) is not
    sent raw (FOLLOWUPS 0021d). `app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)` from
    `starlette.middleware.gzip`, as the **first** `add_middleware` call, so it is innermost and the 413 and CORS
    headers are unchanged.
    - Why in the app: Fly's configuration reference offers no response compression, and the API host is not behind
      Cloudflare's proxy (it is DNS-only, for `Fly-Client-IP`).
    - Why the stream is safe: the locked Starlette 1.10.0's middleware is pure ASGI and has `text/event-stream` in
      its default excluded types, so `/me/events` passes through unbuffered. AC10 proves it.
16. `api/app/services/areas.py` and `api/scripts/import_areas.py` (Q1): `import_areas(db, fetcher, csv_path)` accepts
    `fetcher=None`, which stores the settlements and makes no request. The script passes `None` unless
    `RENT_REFERENCE=nadlan`. `scripts/seed.py` keeps passing its fixture fetcher, so `make seed` is unchanged. The gate is not
    inside `import_areas`: seed runs with `RENT_REFERENCE=off` and must still load its fixtures.

**Out:**
- **Already merged, only deployed here:** real client IPs (0013b), account deletion (0013c), admin hardening
  (0013e), terms and privacy pages (0013f), retention (0013h), login (0016), tours (0018), Sentry and PostHog
  (0019), the national catalogue (0021).
- **Separate work:** the security emails and the tour-mail SMTP stall fix (0022a), the legal text.
- **Left out of Slice 13 by Gilad:** SMS, the digest email, Protomaps (PRODUCT.md "Launch (Slice 13)").
- **Any contact with nadlan.gov.il and any rent-data import** (Q1). `RENT_REFERENCE` and `CBS_RENT` stay `off`.
- **Per-process and per-IP stream caps** (FOLLOWUPS 0005c): at launch Fly's `hard_limit = 500` is the ceiling.
- **CI auto-deploy.** A deploy job would put Fly and Cloudflare tokens into repository secrets of a public repo, and
  at launch Gilad decides when production changes. Manual `make deploy-*` from a clean `main`; revisit after launch.
- A staging environment (cost), a second API machine (cost, see the Digest), uptime monitoring, R2 photo backups
  (R2 is durable; photos are re-uploadable), and turning off `/docs`. The OpenAPI schema is not secret: the web
  bundle carries the same routes.

**New dependencies (tools, not packages):**
- `flyctl` (Gilad installs it with Homebrew; `deploy-guard` checks it is there);
- `wrangler`, run on demand by `pnpm dlx` at the Makefile's pinned `WRANGLER_VERSION`, so it is not added to
  `web/package.json` or the lockfile. Pages' own Git builds cannot run `make client` (Python) to produce the
  git-ignored `schema.d.ts`, so the web is built locally and uploaded directly;
- the `redis:7.4-alpine` base image (pinned by version and digest).

No Python or npm package is added: `GZipMiddleware` ships with Starlette.

## Data
None. No migration; the deploy runs the existing `0001`–`0032`. The area rows come from `import_areas` (runbook §6).

## API
No endpoint added. `GET /health` (public, existing) becomes Fly's health check for the `app` process group.
Responses of 1 KB or more are gzip-compressed for clients that accept it; `/me/events` never is.

## UI
No screen. `web/public/_headers` changes only response headers on Pages; the CSP is checked in the smoke
test (runbook §9).

## Acceptance criteria
- [ ] AC1 Given the three Fly configs parsed with `tomllib`, Then:
  - every app has `primary_region = "fra"`;
  - `api.toml`:
    - processes `app` and `worker` with the commands in Scope 1;
    - `http_service` only on `app`, with `internal_port` 8000, `force_https` true, `auto_stop_machines`
      `"off"`, `min_machines_running` 1, concurrency `connections` 400 / 500, and a `GET /health` check;
    - `release_command = "/opt/venv/bin/alembic upgrade head"`, with no `seed` in it;
    - `kill_timeout = 10`;
  - `redis.toml` and `admin.toml`:
    - have **neither** `http_service` **nor** `services`;
    - `redis.toml` mounts `/data`;
    - `admin.toml` has no `checks`;
    - `admin.toml`'s env sets `ADMIN_HTTPS_ONLY = "true"` and `ADMIN_ALLOWED_HOSTS = "localhost,127.0.0.1"`;
  - no `[env]` in any of them holds a secret name (Scope 1's secret list, `REDIS_PASSWORD`, `ADMIN_PASSWORD`,
    `ADMIN_SECRET_KEY`, `ADMIN_DATABASE_URL`).

  — `api/tests/test_deploy.py::test_ac1_fly_configs`
- [ ] AC2 Given an environment first cleared of every `Settings` env name (the Makefile exports `.env` keys and
  `CONTACT_EMAIL`), then `api.toml`'s `[env]` plus `FLY_APP_NAME` and obviously fake values for each required Fly secret,
  with no `user:pass@` URLs, which GitGuardian would flag in this public repo (an
  https `WEB_ORIGIN`, an `smtp://` URL, a 32+ `SECRET_KEY`, a 32+ non-dev `EMAIL_BLOCK_KEY`, a non-dev user agent, an
  https photo base URL, the four `R2_*`, a non-placeholder `CONTACT_EMAIL`), When `Settings()` reads them from the
  environment, Then it validates with `rent_reference == "off"`, `cbs_rent == "off"`, `email_backend == "smtp"`,
  `geocoder == "nominatim"`, `photo_backend == "r2"`, `trust_proxy == "fly"`, `sentry_environment == "production"` and
  `google_verifier == "off"`. The fake secrets live in **one module constant** in `test_deploy.py`, so the test passes
  with or without 0022a merged. The toml is a valid production profile, and it stays one when someone edits it —
  `test_deploy.py::test_ac2_api_env_is_a_production_profile`
- [ ] AC3 Given `FLY_APP_NAME` set:
  - When `WEB_ORIGIN` is `http://…`, `EMAIL_BACKEND=file`, `GEOCODER=fake`, `NOMINATIM_URL` is `http://…`,
    `TRUST_PROXY=none` or `RENT_REFERENCE=nadlan`, Then `Settings()` raises a `ValidationError` naming that rule, and no input value appears in it.
  - Without `FLY_APP_NAME`, `_HTTPS_READY` (`file` / `fake`) still validates, and plain http dev defaults
    still work.

  — `api/tests/test_config.py::test_ac3_on_fly_refuses_dev_settings`
- [ ] AC4 Given the migrated test database and `api.toml`'s `release_command` run with `alembic` from the venv:
  - it exits 0, alembic is at head, and a second run exits 0 again;
  - with an unreachable `DATABASE_URL` (`localhost:1`) it exits non-zero within 30 s;
  - `api/scripts/release.sh` does not exist.
  - The test runs with `cwd` = `api/`, as `uv run pytest` sets it.

  — `test_deploy.py::test_ac4_release_command_only_migrates`
- [ ] AC5 Given `homie_admin` exists (the `admin_role` fixture):
  - When `apply_admin_role(TEST_DATABASE_URL, None, existing_role=True)` runs twice, Then the role has
    exactly 0012b's rights. The `test_admin.py::_check_role` assertions are reused, imported or repeated,
    and its password is unchanged, so it can still log in.
  - When the role is first made a member of a probe group holding `UPDATE ON users`, Then the
    existing-role call raises naming `users` and commits nothing, so the membership is still there.
  - With the same membership, the normal mode revokes it, as today, and succeeds. Its post-check passes.
  - When the role is instead a member of a probe group holding `SELECT ON user_passwords`, Then the existing-role
    call succeeds, both hash tables have row-level security on with no policy, and a session as `homie_admin` sees zero
    rows in them. With a probe policy on the table, or `BYPASSRLS` on the role, the call raises naming the table and
    commits nothing. In normal mode the same inherited SELECT is revoked or raises, never tolerated.
  - When the role has `ALTER ROLE … SET role = <probe group>`, Then a plain connection's `current_user` is the probe
    group, while with `-c role=none` it is `homie_admin` and `admin_role.py --verify` passes. Without `role=none`
    the check refuses.
  - Every role `homie_admin` belongs to is checked too. A membership reaching `UPDATE ON users` without inheritance (by
    `SET ROLE`, or by `ADMIN OPTION`, which can grant itself `SET`), a superuser group, a group with `BYPASSRLS`, `CREATE`
    on schema `public` and `UPDATE` on a sequence are each refused and commit nothing; `--verify` refuses them too. A
    plain reader group (`pg_read_all_data`, no `BYPASSRLS`) passes and sees zero hash rows.
  - The probe membership, role setting, policy, row-level security and group are removed in `finally`.
  - When the role does not exist, existing-role mode exits with the `fly mpg users create` message.
    Checked with a role name that does not exist: `ROLE` patched in the test.

  — `test_deploy.py::test_ac5_admin_role_existing_role`
- [ ] AC6 Given `make check-images`, Then:
  - all three production images build, and the API and admin Dockerfiles' `FROM` lines carry `@sha256:`;
  - in the API image `/app/data/settlements.csv` exists and `/app/admin` and `/app/tests` do not;
  - the admin image, started with dummy `ADMIN_*` values, answers `/admin/login` on `[::1]:8001` with `Host: localhost`;
  - a container from the Redis image started **without** `REDIS_PASSWORD` exits non-zero;
  - one started with it answers `NOAUTH` to an unauthenticated `PING`, and with the password returns
    `noeviction` for `CONFIG GET maxmemory-policy` and `yes` for `CONFIG GET appendonly`, and its PID 1 is not uid 0.

  — CI step "Check production images"
- [ ] AC7 Given `make build-web && make build-check`, Then `dist/_headers` carries every header in Scope 9
  for its path and `dist/404.html` does not exist. `build-check.mjs` reports a missing file, a changed or
  missing header, and a stray `404.html` as one problem line each —
  `web/scripts/__tests__/build-check.test.ts` (`ac7_headers_present`, `ac7_header_changed_fails`,
  `ac7_404_html_fails`)
- [ ] AC8 Given a throwaway git repo in `tmp_path`:
  - **Setup:**
    - the repo holds a copy of the `Makefile` and `infra/dotenv.awk`, committed on `main`;
    - a bare repo in `tmp_path` is its `origin`, and `main` is pushed there;
    - a fake `fly` script in its own temp dir appends its arguments to a marker file and exits 0.
    - **The whole environment is built, never inherited** (`test_dotenv.py` already strips `MAKE*`), and so is
      `PATH`: every case uses a temp `bin` dir of symlinks to `git`, `make`,
      `sh`, `awk` and `env` only (`shutil.which`). A developer's real `flyctl` often sits next to them, so the
      inherited `PATH` could find it. The fake `fly` dir is prepended for the cases that need it.
  - **Refusals:** each case prints its reason and exits non-zero, and the marker file stays empty:
    - an untracked file in the tree;
    - a local commit not on `origin/main`;
    - a `PATH` without `fly`: the test first asserts `shutil.which("fly", path=PATH) is None and
      shutil.which("flyctl", path=PATH) is None`;
    - `make deploy-web` without `DOMAIN`, and with `CONTACT_EMAIL=contact@example.com` (prints its usage line).
  - **Clean case:** with a clean tree at `origin/main`, `make deploy-api` calls the fake `fly` once with
    `deploy . --config infra/fly/api.toml`, `--remote-only --ha=false` and the current sha in `SENTRY_RELEASE`, and
    `make import-areas-prod` calls it with `--process-group worker` and `/app/scripts/import_areas.py`. It asserts
    only arguments confirmed with `--help` (Risks); `--dockerfile`'s value is not asserted until confirmed.

  — `test_deploy.py::test_ac8_deploy_guard` (needs `git` and `make`, both in CI; no network: `origin` is a
  local path)
- [ ] AC9 Given `infra/DEPLOY.md`, Then:
  - every name in Scope 1's required secrets (`CONTACT_EMAIL` included) and optional values, `REDIS_PASSWORD`,
    `ADMIN_DATABASE_URL`, `ADMIN_PASSWORD` and `ADMIN_SECRET_KEY` appears in it, as do `VITE_GOOGLE_CLIENT_ID` and
    `import-areas-prod`;
  - for every `NAME=value` in it whose `NAME` is one of those, `GOOGLE_VERIFIER` excepted, the value contains `<` (a
    placeholder like `<domain>`) or starts with `$(` (generated, e.g. `$(openssl rand -hex 32)`), so no literal
    secret value is written.

  — `test_deploy.py::test_ac9_runbook_names_every_secret_and_no_value`
- [ ] AC10 Given the app and a client sending `Accept-Encoding: gzip`:
  - `GET /areas` with more than 1 KB of areas answers `content-encoding: gzip`, a `vary` that contains
    `Accept-Encoding` (CORS appends `Origin`), and a body that decompresses to the same JSON, with its `cache-control`
    and CORS headers intact;
  - with `Accept-Encoding: identity` (the test client sends gzip by default) the same request is not compressed;
  - `GET /me/events`, driven through `test_chat_events.py`'s ASGI `Stream` (`Stream.__init__` gains an optional headers
    argument) with that header, has `text/event-stream`,
    no `content-encoding`, and delivers a published event while the stream is still open.

  — `api/tests/test_compression.py::test_ac10_areas_gzip`, `::test_ac10_small_response_not_compressed`, `::test_ac10_stream_not_compressed`
- [ ] AC11 Given `RENT_REFERENCE=off`, When `scripts/import_areas.py` runs, Then no fetcher is built, every settlement is
  stored, and it reports `neighbourhoods: 0` and `files_failed: 0`. With `nadlan` the fetcher is used, so `make seed`'s
  fixture import and the fetcher path keep working —
  `test_deploy.py::test_ac11_area_import_off_makes_no_request`
- [ ] NF1 No public address for Redis and the admin: AC1 in CI, plus runbook §3 and §7 (`fly ips list` empty)
  at deploy time.
- [ ] NF2 Least privilege survives MPG: the post-check (AC5) refuses a `homie_admin` that inherits table writes, and
  the hash tables stay unreadable to it through row-level security; `--verify` proves the real session at deploy time.
- [ ] NF3 Nothing secret is committed or uploaded: AC1, AC9. The existing `.dockerignore` keeps `.env` out of
  the remote builder's context.

## Tests to write
Unit:
- `test_config.py::test_ac3_*`;
- `test_deploy.py::test_ac1_*`, `test_ac2_*`, `test_ac9_*` (tomllib and text; no network).

Integration (test Postgres, Redis):
- `test_deploy.py::test_ac4_*`, `test_ac5_*`, `test_ac11_*`;
- `test_compression.py::test_ac10_*`.

Process (`git`, `make`, temp dirs; no Postgres):
- `test_deploy.py::test_ac8_*`.

Web unit:
- `build-check.test.ts` `ac7_*`, using its existing good-template fixture plus a `_headers` file.

CI:
- the "Check production images" step (AC6), placed after the e2e step.

E2E: none added, and none run locally (CI only). Runbook §9 is the production smoke test.

## Blast radius
From `graphify affected` on the graph of `main` (it may lag). Dockerfiles, the Makefile and `build-check.mjs` have no
usable graph nodes, so those lines are traced by hand.
- `create_app`: `export_openapi.py`; `conftest.py::client` and the API tests through it; `test_areas.py`,
  `test_auth.py`, `test_chat_events.py::open_stream`, `test_db_errors.py`, `test_hardening.py`,
  `test_observability.py`, `test_photos.py`, `test_tour_feed.py`. Gzip changes response bytes only; no test reads a raw
  response body or a response `Content-Length`. `Stream` gains optional headers for AC10.
- `Settings` / `get_settings`: `test_config.py`, `observability.py`, `analytics.py`, `client_ip.py`, `create_app`,
  `redis_client.py`, auth routes, `health`, `services/*`, `worker.py`. New rules act only with a non-empty
  `FLY_APP_NAME`.
- `_email_and_production_rules`: the graph lists spec references only; code reach is through `Settings`.
- `import_areas` (`graphify affected` finds no unique node; traced by grep): `scripts/import_areas.py`, `scripts/seed.py`,
  `test_areas.py`, `test_seed.py`. Seed and the tests pass a fetcher and are unchanged; only `None` skips the requests.
- `apply_admin_role`: `admin_role.py::main()`, `conftest.py::admin_role`,
  `test_admin.py::test_nf2_role_has_only_its_grants`, and the tests importing `conftest` (`admin_role` is a session
  fixture).
- `create_admin_app`: `admin/main.py::main`, `test_admin.py::admin_client`, `test_ac2_lock_survives_a_restart`,
  `test_nf4_settings_refuse_weak_secrets`.
- `make_engine`: signature unchanged. Callers: `create_admin_app`, `alembic/env.py`, `app/db.py`, `seed.py`,
  `test_admin.py`, `test_areas.py`, `test_db_errors.py`, `test_health.py`, `test_map_search.py`; `seed_demo.py` and
  `seed_promo.py` are untracked local files.
- `infra/Dockerfile.api` / `.admin`: compose, CI and `check-images` build them; compose overrides `command`.
- `Makefile`: `test_dotenv.py`, and the existing `deploy-waitlist` must stay outside the guard.
- `.dockerignore`: compose builds; `api/tests` is bind-mounted in dev.
- `.env.example`: `test_openapi_export.py::test_ac6_openapi_export_without_server` (it reads every `KEY=value` line,
  commented ones too; Scope 12's block has no such line).
- `build-check.mjs`: `make build-check`, CI, `web/scripts/__tests__/build-check.test.ts` (its fixture gains a `_headers`
  file, so "the good template passes" stays green).
- `api/scripts/seed.py`, `make seed`, compose and CI: unchanged. Only production stops running it.
- `ci.yml`: one more step after e2e, inside the 25-minute job.
- `web/public/_headers` (new): Vite copies it to `dist/`. `vite preview` ignores it.
- **0022a overlap:** `config.py`, `test_config.py` and `.env.example` may both change; the second PR to merge merges
  `origin/main`.

## Risks / open questions
- **Refreshed 2026-11-18 (from `origin/main` at `2e15d3c`, status back to `draft`).** Brought up to date with everything
  merged since the 2026-11-15 verification: migrations to `0032`; no seed in the release step, a Fly area-import
  target and runbook step; gzip with an SSE check (AC10); digest-pinned base images; `TRUST_PROXY` and `NOMINATIM_URL`
  rules on Fly; the admin post-check covers `_NO_ACCESS` and `admin_logins`; Google in the CSP; `SENTRY_RELEASE` per
  deploy; `CONTACT_EMAIL` for 0022a; tours, feed, HTTP/2 and waitlist steps in the runbook.
- **Verification 2026-11-18:** round 1 rejected with 20 findings, all applied; second round waived.
- **The admin plan rests on inference.** Scope 5 comes from Fly's docs and staff replies, one customer report and a local
  simulation, not a real MPG cluster. Runbook §7's probe is therefore the first step on the real cluster.
- **Cost:** about $76–81 a month: $56–61 on Fly with MPG storage, plus Resend Pro at $20.
- **A Redis outage takes the API offline.** `/health` answers 503 without Redis and Fly then stops routing to the machine,
  so browsing stops too. Accepted for launch (runbook §11); a shallower check is the upgrade.
- **Server log retention (Gilad, 2026-11-15, PRODUCT.md "Retention"):** server logs are kept 30 days, and the privacy policy says so (`0013h`). Runbook §11 confirms Fly's own log retention is at most 30 days (its docs say 7); a log shipper, if one is added later, is set to 30 days.
- **`TRUST_PROXY=fly` is now enforced** by `api.toml`, AC2 and the Fly rule in Scope 6. Do not go public until the
  runbook §9 Fly-Client-IP check has passed.
- **Compression and secrets (BREACH).** Compressed responses can leak a secret only if an attacker gets a victim's
  browser to send credentialed requests that reflect attacker text next to that secret. The session cookie is
  `SameSite=Lax`, CORS allows one origin, and the API puts no CSRF token in bodies, so this does not apply today. A
  future secret in a cross-site-readable response would need `no-transform` or an exclusion.
- **MPG specifics cannot be tested in CI.** That covers the Reader role's exact grants, whether `fly-user`
  may `GRANT USAGE ON SCHEMA public` and enable row-level security, and the direct host's connection limit. The
  post-check fails loudly in one rolled-back transaction. If a statement is still refused on the first run, the runbook
  says to stop and bring the error to the orchestrator; no partial state is left.
- **Fly command details are confirmed at build and deploy time with `--help`** (the versions go at the top of
  `DEPLOY.md`), and AC8 asserts only what is confirmed:
  - (a) whether `fly deploy . --config infra/fly/api.toml --dockerfile infra/Dockerfile.api` resolves
    `--dockerfile` against the cwd or the config's directory;
  - (b) `fly ssh console --process-group`, and whether `-C` gets the image's env (PATH and secrets); the
    absolute paths in `admin-role-prod` avoid relying on PATH;
  - (c) `fly mpg users create -u … -r reader`, and where the password comes from (`fly mpg users rotate-password` or
    the dashboard); this stays open until the build confirms it;
  - (d) the flags in runbook §2 and §10 (`fly mpg create`, `databases extensions enable`, `backup list`, `restore`).
- **CI minutes added by `check-images`:** about 4 minutes (three image builds), after e2e, on GitHub's runners, which
  are free for this public repo. The coder reports the real figure in the PR body; if the job nears its 25-minute
  timeout, the coder raises it to the orchestrator.
- **Digest pins go stale** without an update bot. They change only when someone bumps the image on purpose.
- **One API machine:** each deploy drops SSE streams and requests for ~10–30 s; the web's EventSource
  reconnects. Two machines cost ~$7 a month more (FYI in the Digest).
- **The CSP is enforced from the first deploy.** It cannot be checked in CI: Pages applies `_headers` only
  when serving. The smoke test (§9) checks it on every page type before anyone is told, and the rollback
  takes a minute.
- **`ADMIN_HTTPS_ONLY=true` over `fly proxy`** relies on Chrome keeping `Secure` cookies on
  `http://localhost`. If it does not, set it false (§7).
- **Redis memory alert is Fly's Grafana alert on VM memory, not `used_memory`.** It is the smallest thing
  that works and costs nothing, but it is a proxy: Redis's own `used_memory` against `maxmemory` is not
  exported without code. A worker cron that logs the ratio is the upgrade if the proxy proves noisy; it would
  touch `worker.py`, shared with 0013g. Until it fires, a full Redis shows as failed logins (§11).
- **A single Redis volume** lives on one Fly host. Losing it costs live OTP codes, counters and queued tour emails (§11).
- **OSM tiles in production** are Gilad's call (Protomaps not before launch). The `Referrer-Policy` above
  keeps the Referer OSM's policy asks for. Heavy use can still be blocked by OSM, and the fix is the
  Protomaps spec.
- **The area import never reads nadlan.gov.il in production** (Q1): with `RENT_REFERENCE=off` it builds no fetcher (AC11).
- **Shared Fly private network (Gilad, 2026-11-18):** accepted for launch, relying on the 16+ character admin password,
  the Redis password and the admin login lock. Rule: keep only homie's apps in this Fly organisation (runbook §1).
- **Resend's region covers sending only.** Its docs say account data stays in the US; the legal text's provider list
  (FOLLOWUPS, before going public) must say so.

### Open questions (both decided)
- **Q2 (Gilad, security): how is the admin kept away from password and calendar-token hashes, given that Fly's Reader
  role probably reads everything?** **Decided by Gilad on 2026-11-18: option A.**
  - **A (chosen):** in `--existing-role` mode, enable row-level security with no policy on `user_passwords`
    and `tour_feeds`. The app, as table owner, is unaffected; the admin sees zero rows. The check confirms the role lacks
    `BYPASSRLS`. Includes `-c role=none` and `--verify` (Scope 5). No migration.
  - **B:** build only the probe, leave the admin undeployed and ask Fly for a custom role. Safest, but launch has no
    moderation dashboard until Fly answers.
  - **C:** accept that the admin role can read the hashes. Not recommended: it contradicts the 0012b, 0016a and 0018a
    decisions.
  - **If Fly's Reader defeats A (Gilad, 2026-11-18):** if the Reader has `BYPASSRLS` or superuser, or can otherwise reach
    the hash tables, `make admin-role-prod` refuses. Stop, leave the admin undeployed and ask Fly for a narrower role.
- **Q1 (legal/product): may the area import read nadlan.gov.il?** **Decided 2026-11-18 (PRODUCT.md "Launch area"): no.**
  Its terms forbid commercial use without written approval and automated collection, so production never contacts it.
  `import_areas` reads neighbourhoods only through a fetcher, and `scripts/import_areas.py` builds one only with
  `RENT_REFERENCE=nadlan`, which production never sets (Scope 16, AC11). `make import-areas-prod` is settlements only, and
  launch has no big-city neighbourhoods and no official rent figures.

## Verifier notes
*Historical: rounds on the 2026-11-15 text. Some names here predate the 2026-11-18 refresh.*
Round 1, 2026-11-15. This was an inline pass against `.claude/agents/spec-verifier.md`, by the fork that
wrote the spec; forks cannot start agents.

| Check | Result |
| --- | --- |
| 1 testable ACs | **fixed.** AC8 was a hand check; it is now a temp-repo test with a fake `fly`. AC9's "value-looking" rule is now exact. AC5's normal-mode line was wrong (normal mode revokes the probe group, then passes). AC4's unreachable case no longer asserts what it cannot observe. |
| 2 one coder run | pass, at the upper end. Mostly config and the runbook. The only logic is the admin-role mode with its post-check, the Fly settings guard and the build-check lines. |
| 3 data | pass: none. |
| 4 auth | pass: no endpoint added. |
| 5, 6 strings and screens | pass: none. |
| 7 PRODUCT.md | pass. The cost (~$55) sits slightly above "about $50"; it is surfaced in the Digest, not hidden. |
| 8 reviewers | pass: `code, security`. No `qa`: no UI or API behaviour change. |
| 9 open product questions | pass. Decision 1 (error alerts) is out of this spec and blocks nothing here. |
| 10 dependencies | pass: `flyctl`, `wrangler` (via `pnpm dlx`, pinned), the `redis:7.4-alpine` image. |
| 11 blast radius | pass: `graphify affected` on `Settings`, `_email_and_production_rules`, `apply_admin_role`; `seed.py` added. |

Also changed: `font-src` gains `data:`, and `admin-role-prod` gains `--process-group app`. Runbook §2 names
the `fly mpg databases extensions enable` command, to be confirmed with `--help`.

## Digest (merged 2026-11-18, PR #138, merge 2176dc0)
homie can now be deployed from `main` with `make deploy-*` and `infra/DEPLOY.md`: API and worker, private Redis and admin on
Fly in Frankfurt, web on Cloudflare Pages. Nothing was deployed and no account was created. The admin is kept from the
password and calendar-token hash tables by row-level security, with a rights check over every role it belongs to. Production
refuses `RENT_REFERENCE` other than `off`, and the area import makes no nadlan.gov.il request while it is off. API responses
are gzipped, except the event stream. Reviews: code, security, qa. CI passed on `36dd475`. Not verified on real services: no
`fly` command was run, Managed Postgres role behaviour is simulated (runbook section 7 probes it first), and the CSP can only
be proven on the live site (section 9). Expected cost with Resend Pro: about $76–81 a month.

## Verifier findings (independent, 2026-11-15)
*Historical: applied to the 2026-11-15 text; the sibling and Mac-runner items no longer apply.*
Fresh pass against `.claude/agents/spec-verifier.md` on `origin/main` (84b6fef). Checks 2–10 pass apart from the
items below; no secret value appears in the spec (names only). Status returned to `draft`.

1. **Check 11 (blast radius) — `.env.example` → `test_openapi_export.py::test_ac6_openapi_export_without_server`
   is missing.** That test reads every `^(?:# )?KEY=(\S*)$` line of `.env.example` (commented ones included,
   empty values included, last one wins) and then builds `Settings` through `create_app()`. Scope 12's
   "Production only" block, written as `# DATABASE_URL=`, `# SECRET_KEY=`, `# WEB_ORIGIN=`, `# FLY_APP_NAME=`
   lines with no values, would override the dev values with `""` and fail the test (and an empty
   `FLY_APP_NAME` could switch the Fly rules on). **Fix:** in Scope 12, write the block so that regex cannot
   match it (for example `#   FLY_APP_NAME: set by Fly, never locally`, one name per line, no `=`); in Scope 6,
   say the Fly rules apply only when `fly_app_name` is non-empty; add this test to `## Blast radius`.
2. **Check 11 — `Makefile` → `test_dotenv.py` is missing.** It copies the real `Makefile` and `infra/dotenv.awk`
   into a temp dir and `include`s it, so any new parse-time code (a top-level `$(error …)` for `DOMAIN`, a
   `$(shell git …)` or `$(shell fly version)`) breaks its three tests. **Fix:** name it in `## Blast radius`
   and state in Scope 7 that the `DOMAIN` check and every `deploy-guard` check run inside recipes only, and
   `WRANGLER_VERSION` is a plain `:=` literal.
3. **Check 1 / ACs runnable without a Fly account — AC8's "a `PATH` without the fake `fly`" is not isolated.**
   CI runs on Gilad's Mac, where runbook §1 installs the real `flyctl` with Homebrew (`/opt/homebrew/bin`, which
   may also hold `git`/`make`). With an inherited `PATH`, the real `fly` is found, the guard passes, and the
   test either fails or calls the real binary with Gilad's login. **Fix:** in AC8, every case builds `PATH`
   from a temp bin dir of symlinks to `git`, `make`, `sh`, `awk` and `env` only (`shutil.which`), asserts
   `shutil.which("fly", path=PATH) is None and shutil.which("flyctl", path=PATH) is None` for the refusal case,
   and prepends the fake `fly` dir for the others; the inherited `PATH` is never used.
4. **Check 9/10 (sibling secret) — 0013c's required `EMAIL_BLOCK_KEY` is not in this deploy.** 0013c adds
   `email_block_key: SecretStr` (≥ 32, no default) and says "production sets its own in the host's secrets
   (0013a's deploy checklist)". Scope 1's secret list, runbook §6, AC2's fake values and AC9 omit it, so after
   both merge the API and worker refuse to start on Fly and AC2 fails on whichever PR merges second. **Fix:**
   add `EMAIL_BLOCK_KEY` (`$(openssl rand -hex 32)`, never rotated) to Scope 1, §6, AC2 and AC9 the way
   `TRUST_PROXY` is handled ("ignored until 0013c merges"), keep AC2's fake secrets in one module constant in
   `test_deploy.py`, and say the second of 0013a/0013c to merge extends it.
5. **Siblings in Risks.** Risks names only 0013b (launch order). **Fix:** one Risks bullet listing every
   overlap with the shared file and "the second to merge merges `origin/main`": 0013b (`config.py`,
   `.env.example`, `test_config.py`); 0013c (`config.py`, `.env.example`, `test_config.py`, `EMAIL_BLOCK_KEY`
   from item 4); 0013e (`admin_role.py` `_INSERT_GRANTS`/`_COLUMN_GRANTS`, `test_admin.py`; 0013e leaves
   `ADMIN_HTTPS_ONLY`/`ADMIN_ALLOWED_HOSTS` and the admin deploy to this spec); 0013g (`worker.py` logging under
   this spec's `worker` process; nothing to do here); 0013d (no shared file).
6. **Deploy plausibility — unverified flyctl details are not all marked "confirm with `--help`".** Scope 13's
   `--help` rule covers runbook commands only, and Risks lists only `fly ssh console -C`'s env and the MPG
   extension command. Unmarked, and AC8 hard-codes some of them: (a) whether `fly deploy . --config
   infra/fly/api.toml --dockerfile infra/Dockerfile.api` resolves `--dockerfile` against the cwd or the
   config's directory; (b) `fly ssh console --process-group`; (c) `fly mpg users create`'s role flag and value
   for Reader, and whether it prints the password/connection string; (d) how PostGIS is enabled on MPG (a
   create-time option or a per-database command). **Fix:** extend Scope 13's rule to every `fly`/`wrangler`
   call in the Makefile too, list (a)–(d) in Risks as "confirm with `--help`", write the flyctl and wrangler
   versions at the top of `DEPLOY.md`, and let AC8 assert only the confirmed arguments.
7. **CI cost of AC6 not stated.** `check-images` adds three image builds (the admin image is never built in
   CI today) inside `ci`'s `timeout-minutes: 25`, before e2e, which already times out when the Mac is loaded.
   **Fix:** put the step after the e2e step (it does not need the stack) and say in Risks how many minutes it
   adds and that the timeout still holds.
8. **Minor, Scope 9 — the `/index.html` cache rule is inert on Pages.** Pages serves `index.html` at `/`
   (redirecting `/index.html`) and as the SPA fallback for every other path, so that rule never matches what
   visitors load; Pages already sends `max-age=0, must-revalidate` for HTML by default. **Fix:** drop
   `/index.html` from the rule (keep `/sw.js`, `/registerSW.js`, `/manifest.webmanifest`) and note the default,
   or use `/` and say why; update AC7 to match.

Applied by the orchestrator (2026-11-15):
1. Scope 12 block rewritten with no `KEY=` pattern (one name per line, `#   NAME: note`); Scope 6 applies the Fly rules only for a non-empty `FLY_APP_NAME`; Blast radius names `test_openapi_export.py::test_ac6`. Confirmed: its regex is `^(?:# )?([A-Z_][A-Z0-9_]*)=(\S*)$`.
2. Scope 7 states the `DOMAIN` and `deploy-guard` checks run in recipes only and `WRANGLER_VERSION` is a plain `:=` literal; Blast radius names `test_dotenv.py`. Confirmed: it copies the real `Makefile` and `infra/dotenv.awk` and `include`s it.
3. AC8: every case builds `PATH` from a temp bin dir of symlinks (`git`, `make`, `sh`, `awk`, `env`); the no-fly case asserts `shutil.which` finds neither `fly` nor `flyctl`; the fake `fly` dir is prepended elsewhere.
4. `EMAIL_BLOCK_KEY` (0013c) added as a Fly secret for api and worker in Scope 1, runbook §6, AC2 (one module constant) and AC9; `VITE_CONTACT_EMAIL` (0013f) added to `deploy-web`'s build env, Scope 12 and runbook §8 and Day-2; both noted as defined by their siblings and ignored until they merge. Confirmed in 0013c and 0013f.
5. One Risks bullet lists the shared files with 0013b, 0013c, 0013e and 0013g and that 0013d shares only the root `Makefile` (`E2E_SHARDS`); the old Blast radius overlap bullet points to it. Confirmed by grep of those specs.
6. Scope 13's `--help` rule covers Makefile calls too, with versions at the top of `DEPLOY.md`; Risks lists (a)-(d) as "confirm with `--help`"; AC8 asserts only confirmed arguments.
7. `check-images` moved after the e2e step (Scope 8, Tests, Blast radius); Risks gives an estimate of ~4 added minutes, measured and reported by the coder in the PR body; the 25-minute timeout holds. Confirmed: `ci.yml` has `timeout-minutes: 25` and `make e2e` as the last test step.
8. Scope 9 drops `/index.html` from the no-cache rule and notes Pages' default for HTML; AC7 reads "every header in Scope 9" so it follows.
9. Runbook §9 gains the "Fly-Client-IP check" (4 forged-header OTP requests, the 4th must be 429, else stop and keep homie private), from the 0013b verifier.
10. Runbook §11 gains the Redis memory alert (Fly Grafana alert at 70% of the VM's memory, no code; the upgrade is a worker cron log line), named in Risks, from the 0013b verifier.
