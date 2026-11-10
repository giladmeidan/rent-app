# Rent App

Hebrew-first two-sided rental marketplace (owners ↔ seekers, plus roommate flows).
Agent conventions live in `CLAUDE.md`; product decisions in `specs/PRODUCT.md`; one spec per slice in `specs/`.

## Prerequisites

- Docker (with Compose v2) — Postgres+PostGIS, Redis, the API, the worker and the web dev server run in containers.
- [uv](https://docs.astral.sh/uv/) — Python dependency manager; it installs Python 3.12 itself.
- Node 22 (`web/.nvmrc`) and [pnpm](https://pnpm.io/) (version pinned in `web/package.json` → `packageManager`;
  `corepack enable` provides it) — for the web targets (`client`, `i18n-check`, `e2e`, the web halves of `test`/`lint`).
- GNU make.

## Quick start

```sh
cp .env.example .env     # optional: local overrides (see Configuration); the defaults already work
make dev                 # db + redis up, alembic upgrade head, seed, then api (reload) + worker + web (vite)
curl localhost:8000/health   # {"status":"ok","db":"ok","redis":"ok"}
curl localhost:8000/areas    # [{"id":"…","slug":"gush-dan","name_he":"גוש דן"}]
open http://localhost:5173   # the Hebrew RTL shell listing the launch areas
```

The API is published on `127.0.0.1:${API_PORT:-8000}`; the examples assume the default port.
The web is published on `127.0.0.1:5173`; open it as `http://localhost:5173`, the only origin the API's CORS
allows (`WEB_ORIGIN`). The browser calls the API at `http://localhost:${API_PORT}` (`VITE_API_URL`, set by compose).
Interactive API docs: http://localhost:8000/docs. Stop everything (and drop the data volume) with `make down`.

## Logging in locally

`make dev` runs the API with `EMAIL_BACKEND=file`: no email is sent, each message is written as a JSON
file (`to`, `subject`, `body`, `sent_at`) into `.outbox/` at the repo root. After
`POST /auth/otp/request`, the 6-digit code is on its own line in the `body` of the newest file:

```sh
curl -X POST localhost:8000/auth/otp/request -H 'Content-Type: application/json' -d '{"email":"me@example.com"}'
ls -t .outbox/*.json | head -1 | xargs cat
```

`make down` empties `.outbox/`. If an earlier `docker compose up` (without `make dev`) left a root-owned
`.outbox/`, `make dev` fails at `chmod`: remove it once with `sudo rm -rf .outbox`. Real delivery: `EMAIL_BACKEND=smtp` plus `SMTP_URL` (see `.env.example`).

## Posting a listing locally

An owner session is needed: sign up with `"role":"owner"` (verify with the code from `.outbox/`, saving the
cookie), take an `area_id` from `GET /areas`, then post; `GET /me/listings` lists your own listings and
`PATCH /listings/{id}` with `{"status":"paused"}` pauses one (at most 3 are live at once):

```sh
curl -c cookies.txt -X POST localhost:8000/auth/otp/verify -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","code":"123456","profile":{"display_name":"נועה","role":"owner"}}'
AREA=$(curl -s localhost:8000/areas | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["id"])')
curl -b cookies.txt -X POST localhost:8000/listings -H 'Content-Type: application/json' -d '{"listing_type":"apartment",
  "area_id":"'"$AREA"'","city":"גבעתיים","street":"כצנלסון","rooms":3.5,"floor":3,"size_sqm":95,"price_ils":7200,
  "available_from":"2026-12-01","elevator":true,"furnished":"partial","pets_allowed":true}'
curl -s 'localhost:8000/listings?price_max=8000'  # public search, no cookie; GET /listings/{id} opens one
```

## Make targets

| target | what it does |
| --- | --- |
| `make dev` | `docker compose up` for `db` and `redis`, waits for Postgres to be healthy, runs `migrate` and `seed`, then starts `api` (uvicorn `--reload` on `API_PORT`, default 8000), `worker` (arq) and `web` (Vite on 5173, source bind-mounted), and fails unless the api answers `/health` and the web answers within 60 s each (then see `docker compose -f infra/docker-compose.yml logs api` / `web`) |
| `make down` | `docker compose down -v` — stops the stack and removes volumes; empties `.outbox/` |
| `make migrate` | `alembic upgrade head` against `DATABASE_URL` |
| `make seed` | inserts the launch areas (idempotent) |
| `make test` | `test-api` then `test-web`. `test-api`: pytest; needs Postgres at `TEST_DATABASE_URL` and Redis at `REDIS_URL` (the compose `db`/`redis`; the test database is created on first run). `test-web`: vitest |
| `make lint` | `lint-api` then `lint-web`. `lint-api`: `ruff check`, `ruff format --check`, `mypy --strict`. `lint-web`: `eslint`, `prettier --check`, `tsc --noEmit` (runs `make client` first if `web/src/api/schema.d.ts` is missing) |
| `make client` | exports the OpenAPI schema with `api/scripts/export_openapi.py` (no server) and generates `web/src/api/schema.d.ts` (git-ignored) with `openapi-typescript`. Re-run after changing the API |
| `make i18n-check` | fails, printing `file:line`, on hardcoded Hebrew or English (≥ 2 Latin words) in `web/src/**/*.tsx` and on `t('key')` keys missing from `web/src/locales/he.json`. Test files and `locales/` are skipped; the English check also skips JSX attributes other than `title`/`placeholder`/`aria-label`/`alt` (Hebrew fails in any attribute); put `// i18n-ignore-next-line` above a line that is a false positive |
| `make e2e` | Playwright smoke suite against the running stack (`make dev` first): installs Chromium, waits up to 90 s for `/health` and the web, then runs `web/e2e/` |
| `make build-web` | production build of the web (`tsc --noEmit`, `vite build` with the PWA manifest and service worker) into `web/dist` |

The web targets install `web/node_modules` with `pnpm install --frozen-lockfile` when pnpm's `web/node_modules/.modules.yaml` is missing or older
than `web/package.json` / `web/pnpm-lock.yaml`.

## Configuration

Every variable is listed in `.env.example` with a working local default. Secrets only ever come from the
environment. Compose publishes Postgres, Redis and the API on `127.0.0.1` only.

Every `make` target loads an optional repo-root `.env` (gitignored) and exports its values to the commands
it runs, including compose interpolation (`DB_PORT`, `REDIS_PORT`, `API_PORT`, `WEB_ORIGIN`). Precedence, highest first:

1. `make` command-line variables: `make dev DB_PORT=5434`
2. the shell environment: `DB_PORT=5434 make dev`
3. `.env`
4. the Makefile defaults (which match `.env.example`)

`DATABASE_URL`, `TEST_DATABASE_URL` and `REDIS_URL` default to `localhost` on `DB_PORT` / `REDIS_PORT`, so
moving a port takes one variable, e.g. a `.env` with `DB_PORT=5434` and `REDIS_PORT=6380` when 5432/6379 are taken.
`.env.example` lists the URLs commented out, so an unedited copy keeps deriving them; a URL you
uncomment (or set in the shell) wins over the port-derived default, so keep it in sync with the ports.
Values may be quoted (`WEB_ORIGIN="http://localhost:3000"`, quotes stripped as compose does); `make`
warns about any line it cannot parse. `.env` is read by `make` only: the API
itself reads plain environment variables, and a bare `docker compose -f infra/docker-compose.yml …` needs
`--env-file .env` to see it. Inside the containers `DATABASE_URL` / `REDIS_URL` always point at the compose
services `db` / `redis`.

## Layout

```
api/            FastAPI app (app/), Alembic migrations (alembic/), scripts/, tests/
web/            Vite + React + TS app: src/{app,features,components,locales,api}, e2e/, scripts/
infra/          docker-compose.yml, Dockerfile.api, Dockerfile.web
specs/          one spec per slice + PRODUCT.md
.github/        CI: api (ruff, mypy --strict, pytest) and web (client, i18n-check, eslint, prettier, tsc, vitest, build) on every PR push;
                e2e (compose + playwright) only on PRs labelled `ready-to-merge` and on pushes to main; Markdown/specs/design-only changes run no CI
```

## Scripts

Run them through `make` (which supplies the environment) or with `uv` from the repo root:

- `make seed` — seed launch areas (`api/scripts/seed.py`; needs `DATABASE_URL`).
- `uv --directory api run python scripts/export_openapi.py > openapi.json` — dump the OpenAPI schema
  without a running server. Needs only the `.env.example` variables in the environment; nothing connects.
