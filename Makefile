# Rent App — developer targets. See CLAUDE.md → Commands.
# Web targets (client, e2e, i18n-check) and the web parts of test/lint arrive with spec 0000b.

# Optional repo-root `.env` (gitignored; start from `.env.example`), parsed by infra/dotenv.awk:
# `KEY=value` lines, value optionally in single or double quotes (stripped, as compose does), no
# spaces, `$` or `#` in values; any other non-comment line is ignored with a warning. Each key is
# loaded with `?=` and exported, so precedence is
#   `make VAR=…` > shell environment (`VAR=… make dev`) > `.env` > the defaults below.
# Exported values reach every recipe: uv/pytest/alembic and compose interpolation
# (`DB_PORT`, `REDIS_PORT`, `API_PORT`, `WEB_ORIGIN` in infra/docker-compose.yml).
ifneq (,$(wildcard .env))
$(foreach kv,$(shell awk -f infra/dotenv.awk .env),$(if $(filter !%,$(kv)),$(warning .env line $(kv:!%=%) ignored: not KEY=value (see .env.example)),$(eval export $(kv))))
endif

COMPOSE := docker compose $(if $(wildcard .env),--env-file .env) -f infra/docker-compose.yml
UV      := uv --directory api

# Local defaults match infra/docker-compose.yml and .env.example.
export DATABASE_URL      ?= postgresql+psycopg://rent:rent@localhost:$(or $(DB_PORT),5432)/rent
export TEST_DATABASE_URL ?= postgresql+psycopg://rent:rent@localhost:$(or $(DB_PORT),5432)/rent_test
export REDIS_URL         ?= redis://localhost:$(or $(REDIS_PORT),6379)/0
export WEB_ORIGIN        ?= http://localhost:5173
export API_PORT          ?= 8000

.PHONY: dev down migrate seed test lint

## dev: start db+redis, wait for Postgres, migrate, seed, start api (reload) and worker, then wait
## for /health: a settings error leaves the uvicorn reloader running but serving nothing
dev:
	$(COMPOSE) up -d --wait db redis
	$(MAKE) migrate
	$(MAKE) seed
	$(COMPOSE) up -d --build api worker
	@echo "waiting for http://127.0.0.1:$(API_PORT)/health ..."
	@for _ in $$(seq 60); do \
	  curl -fs -m 2 -o /dev/null http://127.0.0.1:$(API_PORT)/health && echo "api is up" && exit 0; \
	  sleep 1; \
	done; \
	echo "api not healthy after 60 s; see: $(COMPOSE) logs api" >&2; exit 1

## down: stop the stack and remove its volumes
down:
	$(COMPOSE) down -v --remove-orphans

## migrate: alembic upgrade head against DATABASE_URL
migrate:
	$(UV) run alembic upgrade head

## seed: insert the launch areas (idempotent)
seed:
	$(UV) run python scripts/seed.py

## test: api pytest (needs Postgres at TEST_DATABASE_URL and Redis at REDIS_URL)
test:
	$(UV) run pytest -q

## lint: api ruff (lint + format) and mypy --strict
lint:
	$(UV) run ruff check .
	$(UV) run ruff format --check .
	$(UV) run mypy --strict app scripts tests alembic
