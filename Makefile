# Rent App — developer targets. See CLAUDE.md → Commands.
# `test` and `lint` run the api half then the web half; `*-api` / `*-web` run one half (CI uses those).
# Web targets need Node 22 and pnpm (web/.nvmrc; pnpm version in web/package.json → packageManager).

# Optional repo-root `.env` (gitignored; start from `.env.example`), parsed by infra/dotenv.awk:
# `KEY=value` lines, value optionally in single or double quotes (stripped, as compose does), no
# spaces, `$` or `#` in values; any other non-comment line is ignored with a warning. Each key is
# loaded with `?=` and exported, so precedence is
#   `make VAR=…` > shell environment (`VAR=… make dev`) > `.env` > the defaults below.
# Exported values reach every recipe: uv/pytest/alembic and compose interpolation
# (`DB_PORT`, `REDIS_PORT`, `API_PORT`, `WEB_PORT`, `WEB_ORIGIN` in infra/docker-compose.yml; `API_PORT` also
# sets the web's `VITE_API_URL`).
ifneq (,$(wildcard .env))
$(foreach kv,$(shell awk -f infra/dotenv.awk .env),$(if $(filter !%,$(kv)),$(warning .env line $(kv:!%=%) ignored: not KEY=value (see .env.example)),$(eval export $(kv))))
endif

COMPOSE := docker compose $(if $(wildcard .env),--env-file .env) -f infra/docker-compose.yml
UV      := uv --directory api
PNPM    := pnpm --dir web

# Local defaults match infra/docker-compose.yml and .env.example.
export DATABASE_URL      ?= postgresql+psycopg://rent:rent@localhost:$(or $(DB_PORT),5432)/rent
export TEST_DATABASE_URL ?= postgresql+psycopg://rent:rent@localhost:$(or $(DB_PORT),5432)/rent_test
export REDIS_URL         ?= redis://localhost:$(or $(REDIS_PORT),6379)/0
export WEB_PORT          ?= 5173
export WEB_ORIGIN        ?= http://localhost:$(WEB_PORT)
export API_PORT          ?= 8000
export SECRET_KEY        ?= dev-only-secret-change-me-0123456789abcdef

.PHONY: dev dev-api down migrate seed test test-api test-web lint lint-api lint-web client i18n-check e2e screens build-web

# The api publishes on IPv4 loopback only, and its CORS allows exactly the localhost web origin.
API_HEALTH := http://127.0.0.1:$(API_PORT)/health
WEB_URL    := http://localhost:$(WEB_PORT)

# $(call wait_for,url,seconds,service): poll url until it answers 2xx; fail after `seconds`.
define wait_for
@echo "waiting for $(1) ..."
@for _ in $$(seq $(2)); do \
  curl -fs -m 2 -o /dev/null $(1) && echo "$(3) is up" && exit 0; \
  sleep 1; \
done; \
echo "$(3) not up after $(2) s; see: $(COMPOSE) logs $(3)" >&2; exit 1
endef

## dev: start db+redis, wait for Postgres, migrate, seed, start api (reload), worker and web (vite),
## then wait for /health (a settings error leaves the uvicorn reloader running but serving nothing)
## and for the web. -V gives web a fresh node_modules volume, so a changed lockfile is picked up.
## `.outbox` is created 0777 first: the api (uid 10001) writes it, and Docker would create a missing
## bind-mount source as root:root 755.
dev:
	mkdir -p .outbox && chmod 0777 .outbox
	$(COMPOSE) up -d --wait db redis
	$(MAKE) migrate
	$(MAKE) seed
	$(COMPOSE) up -d --build -V api worker web
	$(call wait_for,$(API_HEALTH),60,api)
	$(call wait_for,$(WEB_URL),60,web)

## dev-api: `dev` without the web: db+redis, migrate, seed, then api (reload) and worker, waiting on
## /health only. For an API spec built while another session needs no web port (WEB_PORT is per worktree).
dev-api:
	mkdir -p .outbox && chmod 0777 .outbox
	$(COMPOSE) up -d --wait db redis
	$(MAKE) migrate
	$(MAKE) seed
	$(COMPOSE) up -d --build api worker
	$(call wait_for,$(API_HEALTH),60,api)

## down: stop the stack, remove its volumes and empty the email outbox
down:
	$(COMPOSE) down -v --remove-orphans
	rm -f .outbox/*.json

## migrate: alembic upgrade head against DATABASE_URL
migrate:
	$(UV) run alembic upgrade head

## seed: insert the launch areas (idempotent)
seed:
	$(UV) run python scripts/seed.py

## test: api pytest (needs Postgres at TEST_DATABASE_URL and Redis at REDIS_URL), then web vitest
test: test-api test-web

test-api:
	$(UV) run pytest -q

test-web: web/node_modules/.modules.yaml
	$(PNPM) exec vitest run

## lint: api ruff (lint + format) and mypy --strict, then web eslint, prettier --check, tsc --noEmit
lint: lint-api lint-web

lint-api:
	$(UV) run ruff check .
	$(UV) run ruff format --check .
	$(UV) run mypy --strict app scripts tests alembic

lint-web: web/node_modules/.modules.yaml web/src/api/schema.d.ts
	$(PNPM) exec eslint .
	$(PNPM) exec prettier --check .
	$(PNPM) exec tsc --noEmit

## client: export the OpenAPI schema (no server needed) into web/src/api/schema.d.ts (git-ignored)
client: SHELL := /bin/bash
client: .SHELLFLAGS := -o pipefail -c
client: web/node_modules/.modules.yaml
	$(UV) run python scripts/export_openapi.py | $(PNPM) exec openapi-typescript -o src/api/schema.d.ts

# Generated on first use by lint-web; run `make client` again after changing the API.
web/src/api/schema.d.ts:
	$(MAKE) client

## i18n-check: fail on hardcoded Hebrew/English in web/src/**/*.tsx, and on t() keys missing from he.json or plural misuse in .tsx and .ts (P4)
i18n-check: web/node_modules/.modules.yaml
	$(PNPM) exec node scripts/i18n-check.mjs

## e2e: playwright smoke suite against the running compose stack (`make dev` first); waits up to
## 90 s each for the api /health and the web, then runs the suite in E2E_SHARDS shards, clearing the
## stack's Redis rate-limit keys (`rl:*`) before each so the OTP limit of 10 per IP per 15 min is not
## hit (dev / CI compose stack only). Every shard runs; the target fails if any shard failed.
# shortcut: 3 shards (E2E_SHARDS) fit ~25 sign-ups per 15 min; add a shard or an env override when the suite outgrows it
E2E_SHARDS ?= 3
e2e: web/node_modules/.modules.yaml
	$(PNPM) exec playwright install --with-deps chromium
	$(call wait_for,$(API_HEALTH),90,api)
	$(call wait_for,$(WEB_URL),90,web)
	@status=0; for i in $$(seq $(E2E_SHARDS)); do \
	  $(COMPOSE) exec -T redis redis-cli EVAL "for _,k in ipairs(redis.call('KEYS',ARGV[1])) do redis.call('DEL',k) end return 0" 0 'rl:*'; \
	  $(PNPM) exec playwright test --shard=$$i/$(E2E_SHARDS) || status=1; \
	done; exit $$status

## screens: the visual check - screenshot scripts (web/e2e/screens/*.screens.ts, every API call mocked)
## against the running compose stack's web (`make dev` first), into web/screens/<spec>/ (git-ignored)
screens: web/node_modules/.modules.yaml
	$(PNPM) exec playwright install chromium
	$(call wait_for,$(WEB_URL),90,web)
	$(PNPM) exec playwright test --config playwright.screens.config.ts

## build-web: production build (tsc --noEmit, vite build with the PWA manifest and service worker) into web/dist
build-web: web/node_modules/.modules.yaml web/src/api/schema.d.ts
	$(PNPM) build

# pnpm install whenever the manifest or lockfile is newer than the last install. The stamp is pnpm's
# own .modules.yaml, not the directory: compose's anonymous volume leaves an empty web/node_modules.
web/node_modules/.modules.yaml: web/package.json web/pnpm-lock.yaml
	$(PNPM) install --frozen-lockfile
	@touch $@
