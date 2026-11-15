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
export EMAIL_BLOCK_KEY   ?= dev-only-email-block-key-0123456789abcdef
# The admin dashboard (spec 0012b): its host port and its Postgres role's password. The test
# fixture uses the same password: the role is cluster-wide, shared by `rent` and `rent_test`.
export ADMIN_PORT        ?= 8001
export ADMIN_DB_PASSWORD ?= dev-only-admin-db-password

.PHONY: dev dev-api admin down migrate seed rent-import rent-backtest cbs-rent-import cbs-rent-history test test-api test-web lint lint-api lint-web client i18n-check e2e merge build-web screens build-check icons preview-web audit-web

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
## `.outbox` (the email outbox) and `.media` (the file photo store, spec 0010d) are created 0777 first:
## the api (uid 10001) writes both, and Docker would create a missing bind-mount source as root:root 755.
dev:
	mkdir -p .outbox .media && chmod 0777 .outbox .media
	$(COMPOSE) up -d --wait db redis
	$(MAKE) migrate
	$(MAKE) seed
	$(COMPOSE) up -d --build -V api worker web
	$(call wait_for,$(API_HEALTH),60,api)
	$(call wait_for,$(WEB_URL),60,web)

## dev-api: `dev` without the web: db+redis, migrate, seed, then api (reload) and worker, waiting on
## /health only. For an API spec built while another session needs no web port (WEB_PORT is per worktree).
dev-api:
	mkdir -p .outbox .media && chmod 0777 .outbox .media
	$(COMPOSE) up -d --wait db redis
	$(MAKE) migrate
	$(MAKE) seed
	$(COMPOSE) up -d --build api worker
	$(call wait_for,$(API_HEALTH),60,api)

## admin: the admin dashboard (spec 0012b) on http://127.0.0.1:$(ADMIN_PORT)/admin: db, migrate, the
## `homie_admin` role (scripts/admin_role.py), then the `admin` service. Needs ADMIN_PASSWORD (16+
## characters) and ADMIN_SECRET_KEY (32+) in `.env` or the shell; without them it never comes up.
admin:
	$(COMPOSE) up -d --wait db
	$(MAKE) migrate
	$(UV) run python scripts/admin_role.py
	$(COMPOSE) --profile admin up -d --build admin
	$(call wait_for,http://127.0.0.1:$(ADMIN_PORT)/admin/login,60,admin)

## down: stop the stack (the `admin` profile included: a service in an inactive profile is not an
## orphan), remove its volumes, empty the email outbox and the dev photo store
down:
	$(COMPOSE) --profile admin down -v --remove-orphans
	rm -f .outbox/*.json
	rm -f .media/*.webp .media/.*.tmp

## migrate: alembic upgrade head against DATABASE_URL
migrate:
	$(UV) run alembic upgrade head

## seed: insert the launch areas (idempotent)
seed:
	$(UV) run python scripts/seed.py

## rent-import: import the official rent figures once (spec 0014a); RENT_REFERENCE=off (the default)
## makes no request and prints {'skipped': 1}
rent-import:
	$(UV) run python scripts/import_rent_reference.py

## rent-backtest: backtest the rent estimate on the imported figures: the baseline (spec 0014c), one
## line per (window, level) and the suggested WINDOW_QUARTERS and HALF_WIDTH; then the small-flat
## ratio (spec 0014d), one line per (window, level) and the suggested RATIO_WINDOW_QUARTERS and
## RATIO_HALF_WIDTH
rent-backtest:
	$(UV) run python scripts/rent_backtest.py

## cbs-rent-import: import the latest CBS small-flat rent table once (spec 0014d); CBS_RENT=off (the
## default) makes no request and prints {'skipped': 1}
cbs-rent-import:
	$(UV) run python scripts/import_cbs_rent.py

## cbs-rent-history: import the five xlsx CBS bulletins 7/2025-7/2026, oldest first (spec 0014d);
## CBS_RENT=off (the default) makes no request and prints {'skipped': 1}
cbs-rent-history:
	$(UV) run python scripts/import_cbs_rent.py --history

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
	$(UV) run mypy --strict app admin scripts tests alembic

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
## A shard's failed tests run once more, after the keys are cleared again (so the retry's sign-ups fit);
## a shard that passes only then prints a "Flaky e2e" warning (an annotation in CI) and does not fail.
## Each shard keeps its own web/test-results/shard-N (and shard-N-retry) with the failed tests' traces.
# shortcut: 6 shards (E2E_SHARDS); the largest shard requests 9 codes (6/6: people-market, people, photos,
# reports, search), 1 under the limit (4 shards put 12 on shard 4: 429s, spec 0013d). Recount with
# `playwright test --list --shard=N/6` when a spec adds sign-ups; add a shard when one passes 10
E2E_SHARDS ?= 6
RL_FLUSH = $(COMPOSE) exec -T redis redis-cli EVAL "for _,k in ipairs(redis.call('KEYS',ARGV[1])) do redis.call('DEL',k) end return 0" 0 'rl:*'
e2e: web/node_modules/.modules.yaml
	$(PNPM) exec playwright install --with-deps chromium
	$(call wait_for,$(API_HEALTH),90,api)
	$(call wait_for,$(WEB_URL),90,web)
	@status=0; for i in $$(seq $(E2E_SHARDS)); do \
	  out=test-results/shard-$$i; \
	  $(RL_FLUSH); \
	  if ! $(PNPM) exec playwright test --shard=$$i/$(E2E_SHARDS) --output=$$out; then \
	    echo "e2e shard $$i failed; running its failed tests once more"; \
	    $(RL_FLUSH); \
	    if $(PNPM) exec playwright test --last-failed --last-failed-file=$$out/.last-run.json --output=$$out-retry; then \
	      echo "::warning title=Flaky e2e::shard $$i passed only on the retry of its failed tests; see the ✘ lines above and the traces in web/$$out"; \
	    else status=1; fi; \
	  fi; \
	done; exit $$status

## merge: merge PR N (`make merge PR=N`) only when its head contains origin/main and the `ci` check
## passed on that head; a merge commit pinned to that head. A PR behind main was tested against an
## older main: merge origin/main into its branch and push, which runs CI again (the label stays).
merge:
	@test -n "$(PR)" || { echo "usage: make merge PR=<number>" >&2; exit 1; }
	@head=$$(gh pr view $(PR) --json headRefOid --jq .headRefOid) && \
	git fetch -q origin main "pull/$(PR)/head" && \
	{ git merge-base --is-ancestor origin/main $$head || { echo "PR $(PR) is behind main: merge origin/main into its branch and push; CI runs again" >&2; exit 1; }; } && \
	ci=$$(gh pr checks $(PR) --json name,bucket --jq '[.[] | select(.name == "ci") | .bucket] | first // "missing"') && \
	{ [ "$$ci" = pass ] || { echo "PR $(PR): the ci check on its head is '$$ci', not pass" >&2; gh pr checks $(PR) >&2; exit 1; }; } && \
	gh pr merge $(PR) --merge --match-head-commit $$head

## screens: the 9b visual check. One screenshot per UI state at 390x844 and 1440x900 into web/screens/<spec>/
## (git-ignored). Needs only the vite server (`make dev`); the scripts answer every API request. WEB_PORT
## (from .env) picks the vite port.
screens: web/node_modules/.modules.yaml
	$(PNPM) exec playwright test -c playwright.screens.config.ts

## build-web: production build (tsc --noEmit, vite build with the PWA manifest and service worker) into web/dist
build-web: web/node_modules/.modules.yaml web/src/api/schema.d.ts
	$(PNPM) build

## build-check: check web/dist against itself (manifest, icons, head tags, service-worker policy). Run
## `make build-web` first; it does not depend on it, so CI builds once (spec 0009e)
build-check:
	cd web && node scripts/build-check.mjs dist

## icons: render web/icons/*.svg into web/public/icons/*.png and web/public/favicon.svg with Playwright's
## Chromium. The outputs are committed; CI never regenerates them
icons: web/node_modules/.modules.yaml
	$(PNPM) exec playwright install chromium
	$(PNPM) exec node scripts/make-icons.mjs

## preview-web: serve web/dist (the built app and its service worker) on port 4173, not the pinned 5173
preview-web: web/node_modules/.modules.yaml
	@test -d web/dist || { echo "run make build-web first" >&2; exit 1; }
	$(PNPM) exec vite preview --port 4173 --strictPort

## audit-web: pnpm audit of the web's production dependencies (the build-time plugins are dev-only)
audit-web: web/node_modules/.modules.yaml
	$(PNPM) audit --prod

# pnpm install whenever the manifest or lockfile is newer than the last install. The stamp is pnpm's
# own .modules.yaml, not the directory: compose's anonymous volume leaves an empty web/node_modules.
web/node_modules/.modules.yaml: web/package.json web/pnpm-lock.yaml
	$(PNPM) install --frozen-lockfile
	@touch $@
