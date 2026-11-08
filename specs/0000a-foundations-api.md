---
id: 0000a
title: A developer can run `make dev` and get Postgres+PostGIS, Redis, the API and the worker up, with `GET /areas` returning the seeded Gush Dan area, and CI runs the api job on every PR
status: in-progress
depends_on: []
reviewers: [code, qa, security]   # security: config/secrets handling, CORS, compose defaults, CI secrets — everything later slices inherit
estimate: 1 coder run
---

## Goal
After this ships, a developer clones the repo, runs `make dev`, and within 90 s `GET http://localhost:8000/health`
returns 200 and `GET /areas` returns the seeded Gush Dan area; `make test`, `make lint`, `make migrate` exist and do
what `CLAUDE.md` → Commands says for the API; CI runs ruff, mypy --strict and pytest on every PR.
Serves Dev Plan slice 0 (Foundations), part a of two. Part b (`0000b`) adds the web shell, i18n-check, e2e and the
web/e2e CI jobs. No product behaviour beyond the areas config table.

## Scope
**In:**
- Repo layout as `CLAUDE.md` → Layout for the API side: `api/`, `infra/`, `.github/workflows/ci.yml`, `Makefile`, `.env.example`, `README.md`. The `web/` tree is created in `0000b`.
- `infra/docker-compose.yml` with services `db` (postgis/postgis:16-3.4), `redis` (redis:7-alpine), `api` (uvicorn --reload, port 8000), `worker` (arq). `infra/Dockerfile.api`. The `web` service and `infra/Dockerfile.web` are added in `0000b`.
- Makefile targets: `dev` (compose up db+redis, wait for Postgres, `migrate`, seed, then api+worker), `test` (api: pytest), `lint` (api: ruff + mypy --strict), `migrate` (alembic upgrade head), `down` (compose down -v). `client`, `e2e`, `i18n-check` are added in `0000b`; `test` and `lint` are extended to the web there.
- API skeleton: `api/app/main.py` (FastAPI app factory, CORS allowing `WEB_ORIGIN` from env, default `http://localhost:5173`), `api/app/config.py` (pydantic-settings, all vars from env), `api/app/db.py` (synchronous SQLAlchemy 2.0 engine, `postgresql+psycopg://`, session dependency), `api/app/models/__init__.py` + `models/area.py`, `api/app/schemas/area.py`, `api/app/services/areas.py`, `api/app/routers/health.py`, `api/app/routers/areas.py`, `api/app/worker.py` (arq `WorkerSettings` with one no-op `ping` task), empty packages `matching/`, `i18n/`.
- Alembic wired (`api/alembic.ini`, `api/alembic/env.py` using the app's metadata) with migration `0001_areas` (see Data). `api/scripts/seed.py` inserts the Gush Dan area if missing (idempotent).
- `api/scripts/export_openapi.py`: writes the app's OpenAPI schema to stdout **without a running server** (imports the app factory, dumps `app.openapi()`). Consumed by `make client` in `0000b`. Must run with only the variables in `.env.example` set.
- `.github/workflows/ci.yml` with one job `api`: uv sync, ruff, mypy --strict, pytest against **two** service containers — postgis (postgis/postgis:16-3.4) and redis (redis:7-alpine). The `web` and `e2e` jobs are added in `0000b`. Branch protection making CI required is a GitHub setting Gilad flips after merge (noted in the PR body).
- `README.md` (English, developer-facing): prerequisites (Docker, uv), `make dev`, how to run each target that exists so far.
- `.env.example` listing every variable read by `config.py` with dummy values (at least `DATABASE_URL`, `TEST_DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN`).

**Out:**
- Everything web: Vite/React shell, `he.json`, generated client, i18n-check, PWA manifest, Playwright e2e, CI web/e2e jobs (`0000b`).
- Any auth, users, sessions (Slice 1). Listings (Slice 2). Map rendering, MapLibre, Nominatim, GeoJSON endpoint (Slice 3). Deployment to Fly.io/Railway, R2, Pages (Slice 12). Sentry (Slice 10). SMS/email adapters (Slice 1). Precise Gush Dan polygon (Slice 3 refines it from municipal boundaries; here a bounding box). Async SQLAlchemy (not needed; revisit if a later spec requires it).

**New dependencies** (all pinned in `api/pyproject.toml`):
- Tooling: `uv` (Python deps + venv). Python 3.12.
- api runtime: fastapi, uvicorn[standard], sqlalchemy>=2.0, alembic, psycopg[binary], geoalchemy2, pydantic>=2, pydantic-settings, redis, arq.
- api dev: pytest, pytest-asyncio, httpx, ruff, mypy, types-redis.
- mypy: `--strict` for `app/`; per-module `ignore_missing_imports` overrides allowed only for third-party packages without stubs (geoalchemy2, arq), each with a one-line comment in `pyproject.toml`.

## Data
New table `areas` (migration `0001_areas`, downgrade drops the table and the PostGIS index; the
`postgis` extension is created in `0001` with `IF NOT EXISTS` and left in place on downgrade):

| column | type | notes |
| --- | --- | --- |
| id | uuid PK, default gen_random_uuid() | |
| slug | text UNIQUE NOT NULL | `gush-dan` |
| name_he | text NOT NULL | Hebrew display name, stored data (not an i18n key) |
| geom | geometry(MultiPolygon, 4326) NOT NULL | GiST index `ix_areas_geom` |
| is_active | boolean NOT NULL default true | inactive areas are hidden everywhere |
| created_at | timestamptz NOT NULL default now() | |

Seed (`api/scripts/seed.py`, also run by `make dev` after migrate): one row `gush-dan` / `גוש דן` with the
bounding box lon 34.74–34.95, lat 31.95–32.17 as a single-ring MultiPolygon (WKT via `ST_GeomFromText`, SRID 4326;
no shapely). Idempotent on `slug`.
Backwards compatibility: first migration, nothing running yet.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /health | public (no auth exists yet; unauthenticated by design, no PII) | – | `{"status":"ok","db":"ok","redis":"ok"}` 200 | 503 `{"status":"degraded","db":"error"|"ok","redis":"error"|"ok"}` when a dependency ping (`SELECT 1` / redis `PING`) fails |
| GET | /areas | public | – | `[{"id":uuid,"slug":str,"name_he":str}]` only `is_active=true`, ordered by `name_he`; **no `geom`** in the response | – |

Both routers are thin; `services/areas.py::list_active_areas(session)` holds the query. API schemas in
`schemas/area.py` (`AreaOut`), never the ORM model. Response model excludes geometry (Slice 3 adds a
GeoJSON endpoint when the map needs it).

## UI
None in this part. The web shell that consumes `/areas` is `0000b`.

## Acceptance criteria
- [ ] AC1 Given the compose stack is up, When `GET /health`, Then 200 with db and redis `ok` — `api/tests/test_health.py::test_ac1_health_ok_when_dependencies_up`
- [ ] AC2 Given redis is unreachable, When `GET /health`, Then 503 with `redis: "error"` and `db: "ok"` — `api/tests/test_health.py::test_ac2_health_degraded_when_redis_down` (monkeypatch the redis ping)
- [ ] AC3 Given one active and one inactive area, When `GET /areas`, Then only the active one is returned and the body has no `geom` key — `api/tests/test_areas.py::test_ac3_lists_only_active_areas_without_geom`
- [ ] AC4 Given an empty DB, When `alembic upgrade head` then `downgrade base` then `upgrade head`, Then all succeed and `areas` exists at the end — `api/tests/test_migrations.py::test_ac4_migration_roundtrip`
- [ ] AC5 Given `seed.py` is run twice, Then exactly one `gush-dan` row exists — `api/tests/test_seed.py::test_ac5_seed_is_idempotent`
- [ ] AC6 Given only the variables in `.env.example`, When `python api/scripts/export_openapi.py` runs with no server, Then it exits 0 and the output parses as JSON containing paths `/health` and `/areas` — `api/tests/test_openapi_export.py::test_ac6_openapi_export_without_server`
- [ ] NF1 CI `api` job wall time ≤ 5 min on GitHub-hosted runners — measured on the PR's first green run, number in the PR body
- [ ] NF2 `make dev` from clean clone (images cached) to `/health` 200 ≤ 90 s — measured once, number in the PR body
- [ ] NF3 `make lint` is clean under `ruff` and `mypy --strict` — CI job

## Tests to write
Unit: AC2 (health with patched redis), AC6 (subprocess run of the export script).
Integration (pytest against Postgres via `TEST_DATABASE_URL`; locally the compose `db`, in CI the service container): AC1, AC3, AC5.
AC4 runs against a **dedicated database** (`TEST_DATABASE_URL` with a `_mig` suffix, created/dropped by its fixture) so its
`downgrade base` never removes tables under AC1/AC3/AC5. The session fixture for the other tests runs `alembic upgrade head` once.
E2E: none in this part (`0000b`).

## Risks / open questions
- Scope is infra + api + CI only, by design: 2 endpoints, 1 table, 0 screens. Web is `0000b`.
- `mypy --strict` against geoalchemy2/arq may need per-module overrides; allowed only as stated under New dependencies, never a blanket `ignore_missing_imports`.
- Bounding box for Gush Dan is deliberately coarse; Slice 3 replaces it. No product decision needed.
- No open product questions: PRODUCT.md already fixes stack, language, launch area.

Verifier notes (2026-11-08): split from `0000`; added redis service to the CI api job (AC1 needs it), added
`export_openapi.py` + AC6 so `0000b` can generate the client without a running server, isolated AC4 on its own
database, named the `.env.example` minimum set, pinned sync SQLAlchemy.

## Digest (filled by orchestrator after verification)

    Spec 0000a — Foundations: infra + API   (verified, part 1 of 2)
    What a user can do after this: a developer runs `make dev` and gets Postgres+PostGIS, Redis, API and worker up; GET /areas returns the seeded Gush Dan area.
    Decisions I need from you (reply with numbers):
      1. Approve build of 0000a now (recommend: yes — no product decisions inside, only scaffolding).
      2. Tooling: uv for Python, pnpm for web (recommend: accept; engineering choice, not product).
    KPIs this slice moves: none directly; it is the base every later slice builds on.
    Acceptance targets: NF1 CI api job ≤ 5 min · NF2 `make dev` → /health 200 ≤ 90 s · NF3 ruff + mypy --strict clean.
    Risks: mypy strict vs geoalchemy2/arq typing — mitigation: per-module overrides only, named in spec.
           Gush Dan stored as a coarse bounding box — mitigation: Slice 3 replaces it with municipal boundaries.
    Reviewers: code, qa, security   Estimated: 1 coder run, ~1–2 review rounds
    Links: specs/0000a-foundations-api.md · PRODUCT.md "Stack", "Launch area" · no Design artboard
