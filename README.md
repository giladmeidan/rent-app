# Rent App

homie / הומי: a Hebrew-first, RTL rental marketplace for Gush Dan — apartments (owners ↔ seekers) and the
roommate market שוק השותפים (rooms, people browse, flatmates).
Agent conventions live in `CLAUDE.md`; product decisions in `specs/PRODUCT.md`; open specs in `specs/`, finished ones in `specs/archive/`.

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
curl localhost:8000/areas    # [{"id":"…","slug":"s-967","name_he":"…","kind":"settlement",…}, …]
open http://localhost:5173   # the landing page
```

The API is published on `127.0.0.1:${API_PORT:-8000}`; the examples assume the default port.
The web is published on `127.0.0.1:${WEB_PORT:-5173}`; open it as `http://localhost:$WEB_PORT`, the only origin the API's CORS
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

## Trying the API

Interactive docs with every endpoint, its auth rule and its schemas: http://localhost:8000/docs. A session
is the `rent_session` cookie set by `POST /auth/otp/verify`; the code comes from `.outbox/` (above).

## Make targets

Each target is documented by the `##` comment above it in the `Makefile`. The everyday ones: `dev`, `dev-api`,
`down`, `migrate`, `seed`, `test`, `lint`, `client` (regenerate `web/src/api/schema.d.ts` after an API change),
`i18n-check`, `build-web`, `build-check`, `screens` (screenshot check, mocked API), `merge PR=N` (CLAUDE.md
rule 8). `e2e` runs only in CI. The web targets run `pnpm install --frozen-lockfile` themselves when needed.

The pre-launch waitlist page (`join.<domain>`, its own Cloudflare Pages project and D1) lives in `waitlist/`; its runbook is [`waitlist/README.md`](waitlist/README.md).

## Configuration

Every variable is listed in `.env.example` with a working local default. Secrets only ever come from the
environment. Compose publishes Postgres, Redis and the API on `127.0.0.1` only.
`GEOCODER` picks the worker's geocoder: `fake` (default; deterministic points, no network) or `nominatim` (needs a real `NOMINATIM_USER_AGENT`, no email, when `WEB_ORIGIN` is https).

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
specs/          PRODUCT.md, FOLLOWUPS.md, open specs; archive/ = done specs and finished plans
.github/        CI: one job on GitHub's ubuntu-latest (repo variable CI_ON_GITHUB=on), only on PRs labelled `ready-to-merge` (CLAUDE.md rule 8): client, i18n-check,
                lint, pytest, vitest, build, build-check, e2e (compose + playwright); Markdown/specs/design-only changes run no CI
```

## Scripts

Run them through `make` (which supplies the environment) or with `uv` from the repo root:

- `make seed` — seed the areas from `api/data/settlements.csv` and the rent fixtures, no network (`api/scripts/seed.py`; needs `DATABASE_URL`).
- `make import-areas` — import every settlement and the big cities' neighbourhoods from nadlan.gov.il, by hand (spec 0021a1).
- `uv --directory api run python scripts/export_openapi.py > openapi.json` — dump the OpenAPI schema
  without a running server. Needs only the `.env.example` variables in the environment; nothing connects.
