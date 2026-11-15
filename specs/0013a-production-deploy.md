---
id: 0013a
title: "homie can be deployed to production: Fly.io in Frankfurt with managed Postgres, a private Redis and admin, and the web on Cloudflare Pages, from `make deploy-*` and one runbook"
status: verified
depends_on: []   # 0013b (real client IPs) builds in parallel; it must be deployed before homie goes public (Risks)
reviewers: [code, security]   # security: admin, Redis and DB exposure, secrets, web security headers; no ux/qa (no screen, no endpoint)
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

Serves PRODUCT.md "Launch (Slice 13)" and FOLLOWUPS 0012b (the admin's production deploy).

## Decisions this spec builds on
- PRODUCT.md "Launch (Slice 13)" (Gilad, 2026-11-15):
  - Hosting is Fly.io in Frankfurt with **Fly Managed Postgres** (MPG), with the API, worker, Redis and the
    private admin as Fly machines.
  - The web is a static build on **Cloudflare Pages**.
  - Web and API share **one registrable domain**, which Gilad buys. About $50 a month in all, approved.
  - Login is email OTP only, with no SMS.
  - Digest email and Protomaps are not before launch; the map stays on public OSM tiles.
- PRODUCT.md "Admin (Slice 12)": the admin is a separate Fly app with **no public IP**, reached with
  `fly proxy`; its own Postgres role reads everything and writes only its columns (0012b NF2).
- PRODUCT.md "Pricing": paid services need Gilad's explicit decision. The ~$50/month above is that decision.
  Nothing else paid is added here: Cloudflare Pages, DNS and the email provider's free tier cost nothing.
- 0014a / 0014d: `RENT_REFERENCE` and `CBS_RENT` stay `off` in production until nadlan.gov.il's terms and
  the CBS licence are read (FOLLOWUPS 0014a, 0014d).
- What already exists and is reused unchanged:
  - `Settings._email_and_production_rules` (`api/app/config.py`) already refuses dev defaults when
    `WEB_ORIGIN` is https: the dev `SECRET_KEY`, `COOKIE_SECURE=false`, an implicit `EMAIL_BACKEND` /
    `GEOCODER` / `PHOTO_BACKEND`, a non-R2 photo store, and a dev `NOMINATIM_USER_AGENT`.
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

Cost at these sizes: MPG Basic ~$38, plus machines ~$15–20 (Fly's October 2026 prices), plus a $0.15 volume.
That is **about $55 a month**, in line with what Gilad approved. Each app runs **one** machine (`--ha=false`).
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
   - **`[http_service]`** for `processes = ["app"]` only:
     - `internal_port = 8000`, `force_https = true`, `auto_stop_machines = "off"`,
       `min_machines_running = 1`;
     - `[http_service.concurrency]` with `type = "connections"`, `soft_limit = 400`, `hard_limit = 500`.
       Each open tab holds one SSE stream (`/me/events`, 0005c), so Fly's default hard limit of 25
       connections would queue the 26th tab. The stream is async, so the limit is connections, not threads;
     - one `[[http_service.checks]]`: `GET /health`, interval 15 s, timeout 5 s, grace period 30 s.
   - **`[deploy] release_command = "sh scripts/release.sh"`**: migrations and the area seed run once per
     deploy, in a release machine, before any new machine starts; a failure aborts the deploy.
   - **`[[vm]]`** per process group, sized as in the table.
   - **`[env]`** (non-secret, fixed): `EMAIL_BACKEND = "smtp"`, `COOKIE_SECURE = "true"`,
     `GEOCODER = "nominatim"`, `PHOTO_BACKEND = "r2"`, `RENT_REFERENCE = "off"`, `CBS_RENT = "off"`,
     `TRUST_PROXY = "fly"`.
     - `TRUST_PROXY` is defined by spec **0013b**. Until 0013b merges, `Settings` ignores it: pydantic-settings
       reads only declared fields.
   - **Fly secrets.** Every value that is secret *or names the domain* is a Fly secret, set once in the
     runbook and kept across deploys, so `api.toml` holds no domain. The secrets are `DATABASE_URL`,
     `REDIS_URL`, `SECRET_KEY`, `SMTP_URL`, `EMAIL_FROM`, `WEB_ORIGIN`, `PHOTO_PUBLIC_BASE_URL`,
     `NOMINATIM_USER_AGENT`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and
     `EMAIL_BLOCK_KEY`.
     - `EMAIL_BLOCK_KEY` is defined by spec **0013c** (`email_block_key`, at least 32 characters, no default,
       required). It is set here for **api and worker**, which are one Fly app and so share one secret:
       `$(openssl rand -hex 32)`, and **never rotated** (it keys the deleted-account email block hash). Until
       0013c merges, `Settings` ignores it.
     - `VITE_CONTACT_EMAIL` is a web build-time variable defined by spec **0013f**, not a Fly secret: see
       `deploy-web` (item 7) and runbook §8.
2. `api/scripts/release.sh`: `set -eu`, `alembic upgrade head`, then `exec python scripts/seed.py`. It runs
   from the image's `WORKDIR /app`.
3. `infra/Dockerfile.redis`, from a pinned `redis:7.4-alpine` tag (exact patch version).
   - Its `CMD` is a `sh -c` that refuses to start without `REDIS_PASSWORD`, then `exec redis-server`:
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
   - A `[checks]` TCP check on 8001. Not HTTP: the admin's `TrustedHostMiddleware` answers 400 to a checker's
     Host header.
   - `[env]`: `ADMIN_HTTPS_ONLY = "true"`, `ADMIN_ALLOWED_HOSTS = "localhost,127.0.0.1"` (`fly proxy`
     forwards the browser's `localhost:8001` Host unchanged).
   - Fly secrets: `ADMIN_DATABASE_URL`, `ADMIN_PASSWORD`, `ADMIN_SECRET_KEY`.
   - `infra/Dockerfile.admin`'s `CMD` binds `--host ::` instead of `0.0.0.0`. `fly proxy` reaches the
     machine on its IPv6 6PN address, and Linux's dual-stack `::` still accepts IPv4. Compose overrides the
     command, so dev is unchanged.
5. `api/scripts/admin_role.py --existing-role`.
   - On MPG, users and their passwords are made with `fly mpg users create` (role **Reader**: SELECT only).
     The `fly-user` that runs migrations is a "Schema Admin", which cannot do superuser-only actions. So
     production does not rely on `CREATE ROLE`.
   - With the flag, `apply_admin_role(database_url, password=None, existing_role=True)`:
     - requires that `homie_admin` exists, else exits with "homie_admin does not exist: create it with
       `fly mpg users create` (Reader)";
     - skips `CREATE/ALTER ROLE`, the group-membership `REVOKE`s and the two database-level statements
       (`REVOKE ALL ON DATABASE`, `GRANT CONNECT`);
     - runs every schema, table, sequence, default-privilege and column statement as today, in the same
       single transaction.
   - **In both modes**, a post-check runs inside the transaction before commit. It raises (rolling back) if
     the role holds *effective* privileges beyond the intended set, inherited through group membership
     included (which `fly-user` cannot revoke):
     - any table-level INSERT, UPDATE, DELETE or TRUNCATE (`has_table_privilege`) other than INSERT on the
       tables in a new constant `_INSERT_GRANTS = ("admin_actions",)`;
     - any column-level UPDATE (`has_column_privilege` over `pg_attribute`) outside `_COLUMN_GRANTS`.

     The error names the table or column. The `GRANT INSERT ON admin_actions` statement is generated from
     `_INSERT_GRANTS`, so the grants and the check read one list. Sibling **0013e** adds `admin_logins` to
     both lists; whichever PR merges second folds its grant into the constants.
   - `main()` reads `--existing-role` from `sys.argv`; `ADMIN_DB_PASSWORD` is then not needed.
   - Dev, the tests and `make admin` keep the normal mode.
6. `api/app/config.py`: a field `fly_app_name: str | None = None`. Fly sets `FLY_APP_NAME` on every machine,
   so this turns on the production checks there. The rules apply only when `fly_app_name` is **non-empty**
   (an empty value counts as unset). When it is, `_email_and_production_rules` also refuses:
   - `WEB_ORIGIN` not https ("WEB_ORIGIN must be https on Fly"); this keeps every existing https rule in
     force on Fly;
   - `EMAIL_BACKEND` other than `smtp` (on Fly a `file` outbox would swallow every login code);
   - `GEOCODER` other than `nominatim` (fake points on real listings).

   Messages name the rule, never a value. Without `FLY_APP_NAME` nothing changes. The existing https test
   profile (`file` / `fake`, `test_config.py::_HTTPS_READY`) still validates.
7. `Makefile`:
   - **Parse-time rule:** the `DOMAIN` check and every `deploy-guard` check (`fly` on `PATH`, `git fetch`,
     `git status`) run **inside recipes only**. No top-level `$(error …)` and no `$(shell git …)` or
     `$(shell fly …)`. `WRANGLER_VERSION` is a plain `:=` literal. `test_dotenv.py` copies the real `Makefile`
     and `infra/dotenv.awk` to a temp dir and `include`s it, so any parse-time code would break its tests.
   - **`deploy-guard`** (a prerequisite of every `deploy-*` target and of `admin-role-prod`) fails with a
     clear line unless:
     - `fly` is on `PATH`;
     - `git fetch -q origin main` succeeds and `HEAD` equals `origin/main`;
     - `git status --porcelain` is empty, so untracked files under `api/` cannot reach an image. The main
       checkout holds untracked seed and promo work, so deploys run from `../rent-app-orch` or any clean
       checkout of `main`.
   - **Targets:**
     - `deploy-api`: `fly deploy . --config infra/fly/api.toml --dockerfile infra/Dockerfile.api --remote-only --ha=false`;
     - `deploy-redis` and `deploy-admin`: the same with their own config and Dockerfile;
     - `admin-role-prod`: `fly ssh console --config infra/fly/api.toml --process-group app -C "/opt/venv/bin/python /app/scripts/admin_role.py --existing-role"`.
       It uses the API machine, which has `DATABASE_URL` and `scripts/`, so no local database tunnel is needed;
     - `deploy-web`: needs `DOMAIN` (`make deploy-web DOMAIN=example.co.il`, or `DOMAIN=` in the checkout's
       `.env`). It runs `make client`, then `VITE_API_URL=https://api.$(DOMAIN) VITE_CONTACT_EMAIL=$(CONTACT_EMAIL) pnpm build`
       (`CONTACT_EMAIL` is the public contact address for the terms and privacy pages: a make variable like
       `DOMAIN`, from the command line or `.env`; the target prints its usage line without it. Defined by 0013f,
       which falls back to `contact@example.com` in a build without it), then
       `make build-check`, then
       `pnpm dlx wrangler@$(WRANGLER_VERSION) pages deploy dist --project-name homie --branch main`.
       `WRANGLER_VERSION` is an exact version pinned in the Makefile;
     - `check-images` (CI and local): builds the three production images (`Dockerfile.api`, `.admin`,
       `.redis`) for the host architecture, then checks the Redis image (AC6) in a throwaway container, and
       removes it on exit even after a failure.
   - **Why `--remote-only`:** the Mac is arm64 and Fly machines are amd64; Fly's remote builder builds the
     right architecture without local Docker buildx.
   - Each target has a `##` comment and joins `.PHONY`.
8. `.github/workflows/ci.yml`: one step, "Check production images (`make check-images`)", after the Smoke suite (e2e) step; it does not need the stack.
9. `web/public/_headers` (copied into `dist/` by Vite):
   - `/*`:
     - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
       img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; worker-src 'self'
       blob:; child-src blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';
       frame-ancestors 'none'; upgrade-insecure-requests`
       - `script-src 'self'` is the XSS guard;
       - the scheme-only `https:` sources cover the API, `media.<domain>` and OSM tiles without writing the
         domain into the build;
       - MapLibre needs `blob:` workers and `data:`/`blob:` images;
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
11. `.dockerignore`: add `**/.media`, `web/dist`, `web/test-results` (smaller upload to Fly's remote builder).
12. `.env.example`: a "Production only" comment block naming `FLY_APP_NAME` (set by Fly, never locally),
    `DOMAIN` (deploy-web only), `VITE_CONTACT_EMAIL` (deploy-web, 0013f), `REDIS_PASSWORD` (the Redis app's
    Fly secret) and the API's Fly secret names, with no values. That is hard rule 8 for the new names.
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
    2. **Postgres.** Create the MPG cluster in `fra` on Basic with PostGIS enabled, and enable the `postgis`
       extension on the app database (`fly mpg databases extensions enable`, per Fly's MPG extension docs). Migration `0001`'s
       `CREATE EXTENSION IF NOT EXISTS postgis` is then a no-op. Check `SHOW max_connections`. Copy MPG's
       **direct** connection string and change its scheme to `postgresql+psycopg://` for `DATABASE_URL`.
    3. **Redis.** `fly apps create`, `fly volumes create redis_data` (1 GB, `fra`), the `REDIS_PASSWORD`
       secret, `make deploy-redis`. `fly ips list -a homie-redis` must be empty; release anything it lists.
    4. **Photos.** R2 bucket for production, custom domain `media.<domain>`, `r2.dev` access off. An API token
       scoped to that bucket with Object Read & Write supplies the four `R2_*` secrets.
    5. **Email.** Any provider with SMTP and domain authentication. Its free tier should allow ≥ 300 emails a
       day, since every login is one. Add its SPF and DKIM records and `_dmarc` (`v=DMARC1; p=none`; tighten
       to `quarantine` after a clean week). Set `SMTP_URL` and `EMAIL_FROM=noreply@<domain>`.
    6. **API.**
       - Set the secrets listed in Scope 1: `SECRET_KEY` and `EMAIL_BLOCK_KEY` from `$(openssl rand -hex 32)`
         (`EMAIL_BLOCK_KEY` is never rotated: keep it in Gilad's password manager);
         `WEB_ORIGIN=https://<domain>`; `PHOTO_PUBLIC_BASE_URL=https://media.<domain>`;
         `NOMINATIM_USER_AGENT="homie/1.0 (+https://<domain>)"`; `REDIS_URL` pointing at
         `homie-redis.internal:6379` with the password.
       - Run `make deploy-api`, `fly certs add api.<domain>`, then add a CNAME from `api` to
         `homie-api.fly.dev`, **DNS-only**.
       - `curl https://api.<domain>/health` must answer `{"status":"ok",…}`.
       - `fly scale count app=1 worker=1` (exactly one worker: arq crons).
    7. **Admin.**
       - `fly mpg users create` makes `homie_admin` (Reader), then run `make admin-role-prod`.
       - Set `ADMIN_DATABASE_URL` (direct host, `homie_admin`), `ADMIN_PASSWORD` (16+, kept in Gilad's
         password manager) and `ADMIN_SECRET_KEY` (`openssl rand -hex 32`); `make deploy-admin`.
       - `fly ips list -a homie-admin` must be empty.
       - `fly proxy 8001:8001 -a homie-admin`, then open http://localhost:8001/admin in Chrome. Chrome keeps
         the `Secure` cookie on `localhost`. If a browser drops it, set `ADMIN_HTTPS_ONLY=false`: the path is
         loopback plus Fly's WireGuard, already encrypted.
       - Re-run `make admin-role-prod` after any migration that changes the admin's columns.
    8. **Web.**
       - Create the Pages project once (`wrangler pages project create homie --production-branch main`),
         then `make deploy-web DOMAIN=<domain> CONTACT_EMAIL=<contact address>`. The build env carries
         `VITE_API_URL` and `VITE_CONTACT_EMAIL` (defined by 0013f); a build without the latter shows
         `contact@example.com` on the terms and privacy pages.
       - Attach `<domain>` as the Pages custom domain.
       - Optionally add a `www` → apex redirect rule: CORS allows only the apex.
    9. **Smoke test (before telling anyone):**
       - **Fly-Client-IP check** (0013b's Risks cite it as "runbook §9, Fly-Client-IP check"): send 4
         `POST https://api.<domain>/auth/otp/request` calls for an address Gilad owns, each with a different
         forged header `-H 'Fly-Client-IP: 203.0.113.N'` (N = 1..4). The 4th must answer **429**: 0013b's
         per-(email, network) limit is 3 per 15 minutes and counts the real address only if Fly overwrites
         the client's header. If the 4th answers 204, **stop and keep homie private**; bring it to the
         orchestrator. Run it after the first deploy of 0013b's code (`TRUST_PROXY=fly`). Wait 15 minutes
         before the sign-up step, or use another address;
       - the landing loads;
       - sign up with a real address: the code arrives, not in spam;
       - post a listing with a photo: it shows from `media.<domain>`, and its map pin appears after the
         worker's geocode sweep;
       - open a chat in a second browser: a message arrives live over SSE;
       - the map draws its tiles;
       - the PWA installs;
       - DevTools shows no `Refused to …` CSP line on the landing, search, map, listing, chat and profile
         pages. A violation's rollback is to edit `_headers` and run `make deploy-web`.
    10. **Restore drill (before launch, then quarterly).** Restore the latest MPG backup into a *new* cluster
        (Fly dashboard → Backups), connect, compare row counts of `users`, `listings` and `messages` with
        production, then delete the restored cluster. Write the date and the time it took at the bottom of
        `DEPLOY.md`.
    11. **Day-2.**
        - Deploy = the four targets from a clean `main` (`make deploy-web` needs `DOMAIN` and `CONTACT_EMAIL`); `fly releases` and `fly deploy --image` roll back.
        - A release whose migration changes the admin's grants (for example 0013e's `admin_logins`) deploys
          in order: `make deploy-api` (migrates), then `make admin-role-prod`, then `make deploy-admin`.
        - Logs: `fly logs -a homie-api`.
        - **Redis memory alert.** Redis refuses writes at 200 MB (`noeviction`), which would stop logins. In
          Fly's managed Grafana (free), add an alert on `homie-redis`'s machine memory that emails Gilad at
          70% of the 256 MB VM; the coder confirms the metric name in Grafana and writes it here. No code.
          Once, check `redis-cli INFO memory` over `fly ssh console -a homie-redis` for the idle baseline
          and write it next to the alert. If it fires: look at `INFO memory`, then raise the VM and
          `--maxmemory` together.
        - If Redis's volume is lost: create a new one and `make deploy-redis`. Redis holds no durable state:
          OTP codes, rate-limit counters, one minute of views and the arq queue; the geocode sweep re-finds
          its work.

**Out:**
- **Owned by sibling specs:**
  - real client IPs, the OTP lockout per (email, network) and per-IP read limits: **0013b**;
  - the admin session hardening (sessions in Postgres, a login lock that survives restarts, same-origin
    proof on writes): **0013e**;
  - account deletion, terms of use and the privacy policy: **0013c**;
  - the cleanup sweep: **0013d** (tests) and **0013g** (review minors).
- **Left out of Slice 13 by Gilad:** SMS, the digest email, Protomaps (PRODUCT.md "Launch (Slice 13)").
- **Error tracking** (Sentry or similar): not here. It is a new third-party processor of request data, so the
  privacy policy (0013c) would have to name it; see Decision 1.
- **CI auto-deploy.**
  - The `ci` job runs on the Mac only for labelled PRs.
  - A deploy job would put Fly and Cloudflare tokens into repository secrets.
  - At launch Gilad decides when production changes.
  - Manual `make deploy-*` from a clean `main` is the default; revisit after launch.
- A staging environment (cost), a second API machine (cost, see the Digest), uptime monitoring (with
  Decision 1), R2 photo backups (R2 is durable; photos are re-uploadable), and turning off `/docs`. The
  OpenAPI schema is not secret: the web bundle carries the same routes.

**New dependencies (tools, not packages):**
- `flyctl` (Gilad installs it with Homebrew; `deploy-guard` checks it is there);
- `wrangler`, run on demand by `pnpm dlx` at a pinned exact version, so it is not added to
  `web/package.json` or the lockfile. Pages' own Git builds cannot run `make client` (Python) to produce the
  git-ignored `schema.d.ts`, so the web is built locally and uploaded directly;
- the `redis:7.4-alpine` base image (pinned).

No Python or npm package is added.

## Data
None. No migration; the deploy runs the existing `0001`–`0024`.

## API
No endpoint added or changed. `GET /health` (public, existing) becomes Fly's health check for the `app`
process group.

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
    - `release_command = "sh scripts/release.sh"`;
  - `redis.toml` and `admin.toml`:
    - have **neither** `http_service` **nor** `services`;
    - `redis.toml` mounts `/data`;
    - `admin.toml`'s env sets `ADMIN_HTTPS_ONLY = "true"` and `ADMIN_ALLOWED_HOSTS = "localhost,127.0.0.1"`;
  - no `[env]` in any of them holds a secret name (Scope 1's secret list, `REDIS_PASSWORD`, `ADMIN_PASSWORD`,
    `ADMIN_SECRET_KEY`, `ADMIN_DATABASE_URL`).

  — `api/tests/test_deploy.py::test_ac1_fly_configs`
- [ ] AC2 Given `api.toml`'s `[env]` plus `FLY_APP_NAME` and obviously fake values for each Fly secret (an
  https `WEB_ORIGIN`, an `smtp://` URL, a 32+ `SECRET_KEY`, a non-dev user agent, an https photo base URL,
  the four `R2_*`, `EMAIL_BLOCK_KEY` of 32+ characters), When `Settings()` reads them from the environment, Then it validates with
  `rent_reference == "off"`, `cbs_rent == "off"`, `email_backend == "smtp"`, `geocoder == "nominatim"` and
  `photo_backend == "r2"`. The fake secrets live in **one module constant** in `test_deploy.py`. `EMAIL_BLOCK_KEY` is ignored until
  0013c merges; the second of 0013a / 0013c to merge extends the constant and AC9's list if the other has not.
  The toml is a valid production profile, and it stays one when someone edits it —
  `test_deploy.py::test_ac2_api_env_is_a_production_profile`
- [ ] AC3 Given `FLY_APP_NAME` set:
  - When `WEB_ORIGIN` is `http://…`, `EMAIL_BACKEND=file` or `GEOCODER=fake`, Then `Settings()` raises a
    `ValidationError` naming that rule, and no input value appears in it.
  - Without `FLY_APP_NAME`, `_HTTPS_READY` (`file` / `fake`) still validates, and plain http dev defaults
    still work.

  — `api/tests/test_config.py::test_ac3_on_fly_refuses_dev_settings`
- [ ] AC4 Given the migrated test database:
  - When `sh scripts/release.sh` runs (subprocess, `DATABASE_URL` = the test URL), Then it exits 0, alembic
    is at head and `areas` holds `gush-dan`.
  - A second run exits 0 again (idempotent).
  - With an unreachable `DATABASE_URL` (`localhost:1`) it exits non-zero within 30 s.
  - The test runs with `cwd` = `api/` and the venv's `bin` on `PATH`, as `uv run pytest` sets it.

  — `test_deploy.py::test_ac4_release_script_migrates_and_seeds`
- [ ] AC5 Given `homie_admin` exists (the `admin_role` fixture):
  - When `apply_admin_role(TEST_DATABASE_URL, None, existing_role=True)` runs twice, Then the role has
    exactly 0012b's rights. The `test_admin.py::_check_role` assertions are reused, imported or repeated,
    and its password is unchanged, so it can still log in.
  - When the role is first made a member of a probe group holding `UPDATE ON users`, Then the
    existing-role call raises naming `users` and commits nothing, so the membership is still there.
  - With the same membership, the normal mode revokes it, as today, and succeeds. Its post-check passes.
  - The probe membership and group are removed in `finally`.
  - When the role does not exist, existing-role mode exits with the `fly mpg users create` message.
    Checked with a role name that does not exist: `ROLE` patched in the test.

  — `test_deploy.py::test_ac5_admin_role_existing_role`
- [ ] AC6 Given `make check-images`, Then:
  - all three production images build;
  - a container from the Redis image started **without** `REDIS_PASSWORD` exits non-zero;
  - one started with it answers `NOAUTH` to an unauthenticated `PING`, and with the password returns
    `noeviction` for `CONFIG GET maxmemory-policy` and `yes` for `CONFIG GET appendonly`.

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
    - **`PATH` is built, never inherited:** every case uses a temp `bin` dir of symlinks to `git`, `make`,
      `sh`, `awk` and `env` only (`shutil.which`). On the Mac runner Homebrew's real `flyctl` sits next to
      them, so the inherited `PATH` would find it. The fake `fly` dir is prepended for the cases that need it.
  - **Refusals:** each case prints its reason and exits non-zero, and the marker file stays empty:
    - an untracked file in the tree;
    - a local commit not on `origin/main`;
    - a `PATH` without `fly`: the test first asserts `shutil.which("fly", path=PATH) is None and
      shutil.which("flyctl", path=PATH) is None`;
    - `make deploy-web` without `DOMAIN` (prints its usage line).
  - **Clean case:** with a clean tree at `origin/main`, `make deploy-api` calls the fake `fly` once with
    `deploy . --config infra/fly/api.toml` and `--remote-only --ha=false`. It asserts only arguments confirmed
    with `--help` (Risks); `--dockerfile`'s value is not asserted until confirmed.

  — `test_deploy.py::test_ac8_deploy_guard` (needs `git` and `make`, both in CI; no network: `origin` is a
  local path)
- [ ] AC9 Given `infra/DEPLOY.md`, Then:
  - every secret name in Scope 1 (`EMAIL_BLOCK_KEY` included), `VITE_CONTACT_EMAIL`, `REDIS_PASSWORD`, `ADMIN_DATABASE_URL`, `ADMIN_PASSWORD` and
    `ADMIN_SECRET_KEY` appears in it;
  - for every `NAME=value` in it whose `NAME` is one of those, the value contains `<` (a placeholder like
    `<domain>`) or starts with `$(` (generated, e.g. `$(openssl rand -hex 32)`), so no literal secret
    value is written.

  — `test_deploy.py::test_ac9_runbook_names_every_secret_and_no_value`
- [ ] NF1 No public address for Redis and the admin: AC1 in CI, plus runbook §3 and §7 (`fly ips list` empty)
  at deploy time.
- [ ] NF2 Least privilege survives MPG: the post-check (AC5) refuses a `homie_admin` that inherits table writes.
- [ ] NF3 Nothing secret is committed or uploaded: AC1, AC9. The existing `.dockerignore` keeps `.env` out of
  the remote builder's context.

## Tests to write
Unit:
- `test_config.py::test_ac3_*`;
- `test_deploy.py::test_ac1_*`, `test_ac2_*`, `test_ac9_*` (tomllib and text; no network).

Integration (test Postgres):
- `test_deploy.py::test_ac4_*`, `test_ac5_*`.

Process (`git`, `make`, temp dirs; no Postgres):
- `test_deploy.py::test_ac8_*`.

Web unit:
- `build-check.test.ts` `ac7_*`, using its existing good-template fixture plus a `_headers` file.

CI:
- the "Check production images" step (AC6), placed after the e2e step.

E2E: none. The deploy target cannot run in CI; runbook §9 is the production smoke test.

## Blast radius
From `graphify affected` on `main` (2026-11-15). Infra lines are traced by hand from the Makefile, compose
and `ci.yml`.
- `Settings` / `_email_and_production_rules` (`affected`: `get_settings()` and through it `create_app`,
  `get_redis`, auth routes, `health`, `services/*` getters, `worker.py`; `test_config.py`'s 11 tests):
  - the new field and rules act only when `FLY_APP_NAME` is set, which no test, compose service or CI step
    sets;
  - `test_config.py`'s existing https tests stay green unchanged (AC3 checks `_HTTPS_READY`).
  - The worker builds the same `Settings`, so on Fly it gets the same checks; it needs the same secrets,
    which it has as the same Fly app.
- `apply_admin_role` (`affected`: `main()`; `conftest.py::admin_role` fixture → `test_admin.py`,
  `test_admin_isolation.py`; `test_admin.py::test_nf2_role_has_only_its_grants`):
  - the signature gains `existing_role: bool = False` and `password: str | None`. Normal mode is unchanged
    apart from the post-check, which the 0012b grants satisfy, so the fixture and `test_nf2` pass unchanged;
  - `make admin` calls `main()` without the flag.
  - **0013e** also edits `admin_role.py`: it adds the `admin_logins` grants. It also edits `test_admin.py`.
    This spec adds its tests to the new `test_deploy.py` only. The shared lines are `_INSERT_GRANTS` and
    `_COLUMN_GRANTS`; the second PR to merge merges `origin/main` and keeps both grants.
- `api/scripts/seed.py` (`affected` via `seed_areas`: `test_seed.py`): unchanged. `release.sh` calls it
  exactly as `make seed` does.
- `infra/Dockerfile.admin` `CMD` (no node): used only by a production run and CI's new `check-images`;
  compose's `admin` service overrides `command`.
- `.dockerignore` (no node): compose builds (`make dev`, CI) send a smaller context; nothing they COPY is
  excluded (`api/` and `web/` sources stay).
- `Makefile` (`affected`: `api/tests/test_dotenv.py`): new targets only; existing targets untouched. The test
  copies the real `Makefile` and `infra/dotenv.awk` and `include`s it, so no new parse-time code (Scope 7).
- `.env.example` (`affected`: `api/tests/test_openapi_export.py::test_ac6_openapi_export_without_server`): it
  reads every `KEY=value` line, commented ones too, and builds `Settings` from them. Scope 12's block has no
  such line.
- `ci.yml` (no node): one more step, after the e2e step (it does not need the stack); it needs Docker, which
  the job already uses for compose. Added minutes: see Risks.
- `web/scripts/build-check.mjs` (`affected`: `make build-check`, CI's Build check step, its own test file):
  - new checks on `_headers` / `404.html`;
  - the existing fixture in `build-check.test.ts` gains a `_headers` file so "the good template passes"
    stays green.
- `web/public/_headers` (new): Vite copies it to `dist/`. Nothing reads it locally; `vite preview` ignores it.
- **Overlap with siblings, by design:** see Risks (shared files).

## Risks / open questions
- **Do not open homie to the public before 0013b is deployed.** Until then the API sees Fly's proxy address
  as every client, so the existing per-IP OTP limit (10 per IP per 15 minutes) is shared by everyone. That is
  launch order, not a build dependency; the orchestrator holds the announcement until 0013b is live.
- **MPG specifics cannot be tested in CI.** That covers the Reader role's exact grants, whether `fly-user`
  may `GRANT USAGE ON SCHEMA public`, and the direct host's connection limit. The existing-role mode skips
  what a Schema Admin is documented not to do, and the post-check fails loudly in one rolled-back
  transaction. If a statement is still refused on the first run, the runbook says to stop and bring the
  error to the orchestrator; no partial state is left.
- **Fly command details are confirmed at build and deploy time with `--help`** (the versions go at the top of
  `DEPLOY.md`), and AC8 asserts only what is confirmed:
  - (a) whether `fly deploy . --config infra/fly/api.toml --dockerfile infra/Dockerfile.api` resolves
    `--dockerfile` against the cwd or the config's directory;
  - (b) `fly ssh console --process-group`, and whether `-C` gets the image's env (PATH and secrets); the
    absolute paths in `admin-role-prod` avoid relying on PATH;
  - (c) `fly mpg users create`'s role flag and value for Reader, and whether it prints the password or the
    connection string;
  - (d) how PostGIS is enabled on MPG: a create-time option or a per-database command (the name of
    `fly mpg databases extensions enable`).
- **Shared files with siblings** (the second PR to merge merges `origin/main`, Speed rule 3):
  - **0013b:** `api/app/config.py` (`trust_proxy`), `.env.example` (`TRUST_PROXY`), `test_config.py`;
  - **0013c:** `config.py` (`email_block_key`), `.env.example` (`EMAIL_BLOCK_KEY`), `test_config.py`, and
    `EMAIL_BLOCK_KEY` in this spec's secrets, AC2 and AC9;
  - **0013e:** `api/scripts/admin_role.py` (`_INSERT_GRANTS`, `_COLUMN_GRANTS`), `api/tests/test_admin.py`, and
    `.github/workflows/ci.yml` only if it adds a step; it leaves `ADMIN_HTTPS_ONLY`, `ADMIN_ALLOWED_HOSTS` and
    the admin deploy to this spec;
  - **0013g:** `api/app/worker.py` logging under this spec's `worker` process group; nothing to do here;
  - **0013d:** shares only the root `Makefile`, where it may change `E2E_SHARDS`.
- **CI minutes added by `check-images`:** an **estimate** of about 4 minutes on the Mac (three image builds:
  api ~2, admin ~1.5 with shared layers cached, redis ~0.5; the admin image is not built in CI today). The
  step runs after e2e, so it cannot make e2e time out, and the job's `timeout-minutes: 25` still holds. The
  coder measures the real minutes on the PR's run and reports them in the PR body; if the total nears 25, the
  coder raises it to the orchestrator.
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
- **A single Redis volume** lives on one Fly host. Losing it costs live OTP codes and counters only (§11).
- **OSM tiles in production** are Gilad's call (Protomaps not before launch). The `Referrer-Policy` above
  keeps the Referer OSM's policy asks for. Heavy use can still be blocked by OSM, and the fix is the
  Protomaps spec.

## Verifier notes
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

## Digest (filled by orchestrator after verification)
Spec 0013a — Production deploy (Fly + managed Postgres, Cloudflare Pages)   (verified 2026-11-15; part 1 of Slice 13)

**What you can do after this:** follow one runbook (`infra/DEPLOY.md`), then run four `make deploy-*`
commands from a clean `main`. homie is then live:
- the API and worker on Fly in Frankfurt, on managed Postgres;
- Redis and the admin with no public address (the admin via `fly proxy`);
- the web on Cloudflare Pages, on your domain.

**Decisions I need from you (reply with numbers):**
1. Error alerts at launch. Today a server error lands only in `fly logs`, which nobody watches.
   - (a) Nothing at launch.
   - (b) Sentry's free tier (5,000 errors a month) for the API and worker, with no personal data sent, as a
     small follow-up spec. The privacy policy (0013c) would then name Sentry.
   - **Recommend (b).**

**FYI:**
- Cost at the configured sizes is about $55 a month: managed Postgres $38 plus four small machines.
- One API machine means each deploy causes a ~30-second gap; a second machine is ~$7 a month more.
- Pick an email provider whose free tier sends ≥ 300 emails a day (every login is one).
- **homie must not go public before 0013b (real client IPs) is deployed.** Until then the per-IP login-code
  limit is shared by everyone.

**KPIs this slice moves:** launch itself (time to first real user).

**Acceptance targets:**
- NF1 Redis and the admin have no public address (checked in CI from the configs, and at deploy with
  `fly ips list`).
- NF2 the admin's database user still cannot write beyond its columns on managed Postgres (a check refuses
  it otherwise).
- NF3 no secret is committed or sent to the image builder.

**Risks:**
- Managed-Postgres details (roles, grants) can't be tested before the first deploy. Mitigation: one
  rolled-back transaction and a loud error, no partial state.
- The web's security policy (CSP) could block something. Mitigation: checked on every page type in the smoke
  test before anyone is told; rollback in a minute.

**Reviewers:** code, security   **Estimated:** 1 coder run (Opus/high), 1 review round

**Links:** `specs/0013a-production-deploy.md` · PRODUCT.md "Launch (Slice 13)" · FOLLOWUPS 0012b (admin deploy)

## Verifier findings (independent, 2026-11-15)
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
