# Rent App — developer targets. See CLAUDE.md → Commands.
# Web targets (client, e2e, i18n-check) and the web parts of test/lint arrive with spec 0000b.

COMPOSE := docker compose -f infra/docker-compose.yml
UV      := uv --directory api

# Local defaults match infra/docker-compose.yml and .env.example; override via the environment.
export DATABASE_URL      ?= postgresql+psycopg://rent:rent@localhost:$(or $(DB_PORT),5432)/rent
export TEST_DATABASE_URL ?= postgresql+psycopg://rent:rent@localhost:$(or $(DB_PORT),5432)/rent_test
export REDIS_URL         ?= redis://localhost:$(or $(REDIS_PORT),6379)/0
export WEB_ORIGIN        ?= http://localhost:5173

.PHONY: dev down migrate seed test lint

## dev: start db+redis, wait for Postgres, migrate, seed, then start api (reload) and worker
dev:
	$(COMPOSE) up -d --wait db redis
	$(MAKE) migrate
	$(MAKE) seed
	$(COMPOSE) up -d --build api worker

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
