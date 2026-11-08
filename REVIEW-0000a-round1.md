# Review round 1 — PR [0000a]

Merged digest: code (0 blockers, 2 majors, 5 minors, 6 nits) · qa (0 / 3 / 4 / 5) · security (1 / 3 / 6 / 3)
→ **REQUEST CHANGES**. All six ACs pass when exercised; NF2 measured 18–19 s by both coder and QA. Findings are infrastructure hardening and robustness, not AC failures. Duplicates across reviewers merged; the reviewers do not disagree on anything.

## Blockers
- B1 (security) `infra/docker-compose.yml:10-11, 22-23, 40` — Postgres (superuser `rent:rent`) and Redis (no auth) are published on all interfaces, so anyone on the developer's LAN gets superuser on the dev DB and write access to the arq queue. Breaks CLAUDE.md rule 8 and the "compose defaults later slices inherit" brief. Repro: `printf 'PING\r\nQUIT\r\n' | nc <lan-ip> 6380` → `+PONG`; `psql postgresql://rent:rent@<lan-ip>:5434/rent -c "select rolsuper from pg_roles where rolname=current_user"` → `t`. Fix: bind every published port to loopback: `"127.0.0.1:${DB_PORT:-5432}:5432"`, `"127.0.0.1:${REDIS_PORT:-6380}:6379"`, `"127.0.0.1:8000:8000"`. CI service ports are fine.

## Majors
- M1 (code + qa) `infra/docker-compose.yml:30,49` — no `restart:` policy on `worker` and `api`; a Redis restart kills the arq worker for good (observed live: worker `Exited (1)` after a reviewer's `compose stop redis`, never came back). Fix: `restart: unless-stopped` on both. Re-verify "compose ps → worker Up" after `compose restart redis`.
- M2 (code) `api/alembic/env.py:26-28` — `include_object` excludes only `spatial_ref_sys`; the postgis image also installs `postgis_topology` and `tiger` tables on `search_path`. `alembic check` against the dev DB reports 36 `remove_table` ops, so the next slice's autogenerate would emit drops. Fix: `SET search_path TO public` on the migration connection, or skip reflected tables not in `target_metadata.tables`. Add a test running `alembic check`/`compare_metadata` against a DB with those extensions.
- M3 (code + qa) `api/app/db.py:15` — DB ping has no connect timeout while Redis is capped at 1 s; `/health` (and `/areas`) hang ~75 s when Postgres is unreachable (blackholed host). Fix: `connect_args={"connect_timeout": 2}` or a short-timeout engine for the ping; target 503 `db:"error"` within 2 s.
- M4 (security + code + qa) `README.md:15`, `.env.example:1`, `api/app/config.py:11` — docs say "copy to `.env` for local overrides" but nothing reads `.env` (`env_file=None`, no Makefile include, compose project dir is `infra/`). Verified: a root `.env` with `WEB_ORIGIN=http://localhost:3000` had no effect. Fix: load it (Makefile `-include .env` + `export`, compose `--env-file .env`) or remove the claim; pick one and document it in README.
- M5 (security + code + qa) `infra/Dockerfile.api:15` — no `.dockerignore`; build context bakes the host's `api/.venv` (~170 MB) and caches into the image, invalidates the `COPY` layer on every run (so `make dev` recreates api/worker each time), and would bake a future `api/.env` into image layers. Fix: root `.dockerignore` with `**/.env`, `**/.venv`, `**/.*_cache`, `**/__pycache__`, `.git`, `web/node_modules`.
- M6 (security) `infra/Dockerfile.api` — containers run as root with the source tree bind-mounted. Fix: `RUN useradd -r -u 10001 app` + `USER app`; venv at `/opt/venv` stays readable.

## Minors (folded)
- `.github/workflows/ci.yml` — add `permissions: { contents: read }`; pin `actions/checkout` and `astral-sh/setup-uv` to commit SHAs. (security)
- `infra/Dockerfile.api:1` — pin base image by digest before Slice 12. (security)
- `api/app/config.py` — validate `WEB_ORIGIN` (reject `*`, require scheme://host[:port]); use `SecretStr` for DSNs so repr/logs never print the password. (security)
- `api/app/services/health.py` — reuse a module-level Redis client/pool instead of a new connection per `/health` call. (security)
- `api/tests/test_health.py` — add real-failure tests: `ping_redis("redis://localhost:1/0") is False`, and monkeypatched `ping_db` → 503 `{"db":"error","redis":"ok"}`; `test_migrations.py` should assert `ix_areas_geom` exists and is GiST. (code)
- `README.md` Scripts section — `python api/scripts/seed.py` fails under system Python; use `uv --directory api run …` with env vars or point at `make seed`. (qa)
- `api/scripts/seed.py` — requires `REDIS_URL` though it never uses Redis (Settings makes it required). (qa; also code nit on `make migrate`)
- `GET /areas` with DB down returns `text/plain` 500, not JSON; the generated client in 0000b will choke. Return a JSON 503 or document. (qa)
- NF1 unproven until the repo has a remote and the CI job runs once; merge must wait for the first green run (CLAUDE.md rule 3). (code)

## Nits
14 across reviewers: router computes health status (move to a `services.health.check()`), `Mapped[Any]` for geometry, CORS methods/headers wider than needed, `/docs` public (fine in dev), HEAD → 405, trailing-slash 307 to absolute URL, redundant `REDIS_URL` in README example, `cancel-in-progress` also cancels `main` runs, duplicated `sys.path` bootstrap, two identical images built, CORS rejects `127.0.0.1:5173` (note for 0000b's Vite config).

## What is good (all three agree)
Clean layering (thin routers, `AreaOut` separate from ORM, query in services); tests named per AC and asserting behaviour; AC4 isolated on its own DB; AC6 a real subprocess under a minimal env; `/health` leaks nothing; every dependency pinned and `pip-audit` clean; CORS exact-origin behaviour verified correct.

## Suggested e2e tests (qa, not committed)
fresh-stack `make dev` → `/health` 200 within 90 s and `/areas` exact body · health degraded-and-recovers on redis stop/start · worker survives redis restart and answers a `ping` job · health 503 bounded <2 s with DB blackholed · CORS allowed vs disallowed preflight · routing edges (404 JSON, 405 with Allow, 307 trailing slash) · OpenAPI export equals live `/openapi.json`.
