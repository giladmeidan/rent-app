# Rent App

Hebrew-first two-sided rental marketplace (owners ↔ seekers, plus roommate flows).
Agent conventions live in `CLAUDE.md`; product decisions in `specs/PRODUCT.md`; one spec per slice in `specs/`.

## Prerequisites

- Docker (with Compose v2) — Postgres+PostGIS, Redis, the API and the worker run in containers.
- [uv](https://docs.astral.sh/uv/) — Python dependency manager; it installs Python 3.12 itself.
- GNU make.

## Quick start

```sh
cp .env.example .env     # optional: local overrides; the defaults already match the compose stack
make dev                 # db + redis up, alembic upgrade head, seed, then api (reload) + worker
curl localhost:8000/health   # {"status":"ok","db":"ok","redis":"ok"}
curl localhost:8000/areas    # [{"id":"…","slug":"gush-dan","name_he":"גוש דן"}]
```

Interactive API docs: http://localhost:8000/docs. Stop everything (and drop the data volume) with `make down`.

## Make targets

| target | what it does |
| --- | --- |
| `make dev` | `docker compose up` for `db` and `redis`, waits for Postgres to be healthy, runs `migrate` and `seed`, then starts `api` (uvicorn `--reload` on :8000) and `worker` (arq) |
| `make down` | `docker compose down -v` — stops the stack and removes volumes |
| `make migrate` | `alembic upgrade head` against `DATABASE_URL` |
| `make seed` | inserts the launch areas (idempotent) |
| `make test` | API pytest. Needs Postgres at `TEST_DATABASE_URL` and Redis at `REDIS_URL` (the compose `db`/`redis`; the test database is created on first run) |
| `make lint` | `ruff check`, `ruff format --check`, `mypy --strict` |

Web targets (`client`, `e2e`, `i18n-check`) and the web halves of `test`/`lint` arrive with spec `0000b`.

## Configuration

Every variable the API reads is listed in `.env.example` with a working local default. Secrets only ever come
from the environment. Compose host ports can be moved if something already listens locally, e.g.
`REDIS_PORT=6380 REDIS_URL=redis://localhost:6380/0 make dev`.

## Layout

```
api/            FastAPI app (app/), Alembic migrations (alembic/), scripts/, tests/
infra/          docker-compose.yml, Dockerfile.api
specs/          one spec per slice + PRODUCT.md
.github/        CI: ruff, mypy --strict, pytest against postgis + redis service containers
```

## Scripts

- `python api/scripts/seed.py` — seed launch areas (what `make seed` runs).
- `python api/scripts/export_openapi.py > openapi.json` — dump the OpenAPI schema without a running server.
