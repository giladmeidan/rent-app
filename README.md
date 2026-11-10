# Rent App

Hebrew-first two-sided rental marketplace (owners ↔ seekers, plus roommate flows).
Agent conventions live in `CLAUDE.md`; product decisions in `specs/PRODUCT.md`; one spec per slice in `specs/`.

## Prerequisites

- Docker (with Compose v2) — Postgres+PostGIS, Redis, the API and the worker run in containers.
- [uv](https://docs.astral.sh/uv/) — Python dependency manager; it installs Python 3.12 itself.
- GNU make.

## Quick start

```sh
cp .env.example .env     # optional: local overrides (see Configuration); the defaults already work
make dev                 # db + redis up, alembic upgrade head, seed, then api (reload) + worker
curl localhost:8000/health   # {"status":"ok","db":"ok","redis":"ok"}
curl localhost:8000/areas    # [{"id":"…","slug":"gush-dan","name_he":"גוש דן"}]
```

The API is published on `127.0.0.1:${API_PORT:-8000}`; the examples assume the default port.
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

## Make targets

| target | what it does |
| --- | --- |
| `make dev` | `docker compose up` for `db` and `redis`, waits for Postgres to be healthy, runs `migrate` and `seed`, then starts `api` (uvicorn `--reload` on `API_PORT`, default 8000) and `worker` (arq), and fails unless the api answers `/health` within 60 s (then see `docker compose -f infra/docker-compose.yml logs api`) |
| `make down` | `docker compose down -v` — stops the stack and removes volumes; empties `.outbox/` |
| `make migrate` | `alembic upgrade head` against `DATABASE_URL` |
| `make seed` | inserts the launch areas (idempotent) |
| `make test` | API pytest. Needs Postgres at `TEST_DATABASE_URL` and Redis at `REDIS_URL` (the compose `db`/`redis`; the test database is created on first run) |
| `make lint` | `ruff check`, `ruff format --check`, `mypy --strict` |

Web targets (`client`, `e2e`, `i18n-check`) and the web halves of `test`/`lint` arrive with spec `0000b`.

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
infra/          docker-compose.yml, Dockerfile.api
specs/          one spec per slice + PRODUCT.md
.github/        CI: ruff, mypy --strict, pytest against postgis + redis service containers
```

## Scripts

Run them through `make` (which supplies the environment) or with `uv` from the repo root:

- `make seed` — seed launch areas (`api/scripts/seed.py`; needs `DATABASE_URL`).
- `uv --directory api run python scripts/export_openapi.py > openapi.json` — dump the OpenAPI schema
  without a running server. Needs only the `.env.example` variables in the environment; nothing connects.
