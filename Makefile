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

# Cloudflare's CLI, run through `pnpm dlx` at this pinned release (spec 0017): the newest 4.x that was at
# least two weeks old when pinned. One definition only (0013a reuses it).
WRANGLER_VERSION := 4.156.1
# The public contact address written into the waitlist page at deploy (`make deploy-waitlist
# CONTACT_EMAIL=…`, or `.env`). build.mjs reads it from the environment; no recipe line expands it.
export CONTACT_EMAIL
# The Turnstile widget's public site key written into the waitlist page at deploy (spec 0017b; `make
# deploy-waitlist TURNSTILE_SITE_KEY=…`, or `.env`). build.mjs reads it from the environment; no recipe line
# expands it. The widget's secret key is a Pages secret (`make waitlist-secret`), never here.
export TURNSTILE_SITE_KEY

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

.PHONY: dev dev-api admin down migrate seed import-areas rent-import rent-backtest cbs-rent-import cbs-rent-history test test-api test-web test-waitlist waitlist-migrate waitlist-secret deploy-waitlist waitlist-stats waitlist-delete lint lint-api lint-web client i18n-check e2e merge build-web screens build-check icons preview-web audit-web deploy-guard deploy-redis deploy-api deploy-admin deploy-web admin-role-prod admin-role-verify-prod import-areas-prod check-images

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

## seed: import the areas from the committed settlement CSV and the rent fixtures (idempotent, no network)
seed:
	$(UV) run python scripts/seed.py

## import-areas: import every settlement (api/data/settlements.csv; spec 0021a1), no network. Only with
## RENT_REFERENCE=nadlan, never in production (0013a), also the big cities' neighbourhoods from
## nadlan.gov.il. By hand, once per environment after `make migrate`, never scheduled
import-areas:
	$(UV) run python scripts/import_areas.py

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

## test: api pytest (needs Postgres at TEST_DATABASE_URL and Redis at REDIS_URL), then web vitest, then
## the waitlist's unit and page tests
test: test-api test-web test-waitlist

test-api:
	$(UV) run pytest -q

test-web: web/node_modules/.modules.yaml
	$(PNPM) exec vitest run

## test-waitlist: the waitlist (spec 0017): node --test over waitlist/test (Node 22: node:sqlite), then
## the Playwright page test against waitlist/public on a static python server (port 4179; no stack, no
## API, not `make e2e`). It installs Chromium itself: in CI `make test` runs before the e2e step
test-waitlist: web/node_modules/.modules.yaml
	node --test 'waitlist/test/*.test.js'
	$(PNPM) exec playwright install --with-deps chromium
	$(PNPM) exec playwright test -c playwright.waitlist.config.ts

## waitlist-migrate: apply waitlist/migrations to the remote D1 database homie-waitlist (spec 0017)
waitlist-migrate:
	cd waitlist && pnpm dlx wrangler@$(WRANGLER_VERSION) d1 migrations apply homie-waitlist --remote

## waitlist-secret: set the Pages secret TURNSTILE_SECRET (the Turnstile widget's secret key) on the project
## homie-waitlist (spec 0017b). Wrangler prompts for the value, so it is never on a command line. A changed
## secret reaches new deployments only: run it before `make deploy-waitlist`, or deploy again after
waitlist-secret:
	cd waitlist && pnpm dlx wrangler@$(WRANGLER_VERSION) pages secret put TURNSTILE_SECRET --project-name homie-waitlist

## deploy-waitlist: build waitlist/.dist with the public contact address, the origin and the Turnstile site
## key written in, then deploy it to the Pages project homie-waitlist (spec 0017, 0017b; waitlist/README.md
## has the one-time setup)
deploy-waitlist:
	@test -n "$$CONTACT_EMAIL" && test -n "$$TURNSTILE_SITE_KEY" || { echo "usage: make deploy-waitlist CONTACT_EMAIL=<public contact address> TURNSTILE_SITE_KEY=<Turnstile site key>" >&2; exit 1; }
	cd waitlist && node build.mjs && pnpm dlx wrangler@$(WRANGLER_VERSION) pages deploy --project-name homie-waitlist --branch main

## waitlist-stats: signups by side, city and type from the remote D1 (waitlist/stats.sql; never an
## address or a phone number)
waitlist-stats:
	cd waitlist && pnpm dlx wrangler@$(WRANGLER_VERSION) d1 execute homie-waitlist --remote --command "$$(cat stats.sql)"

## waitlist-delete: delete one address from the remote waitlist on request (spec 0017, Setup step 7). It
## asks for the address on stdin (never on the command line), counts its rows, deletes them by the hex of
## the address (no SQL or shell ever sees the text) and counts again
waitlist-delete:
	cd waitlist && WRANGLER_VERSION=$(WRANGLER_VERSION) node delete.mjs

## deploy-guard: refuse a production deploy unless `fly` is on PATH and this is a clean checkout of
## origin/main (spec 0013a), so no local commit or untracked file reaches an image. Ignored files are
## `.dockerignore`'s job. Everything runs in the recipe: test_dotenv.py includes this file
deploy-guard:
	@command -v fly >/dev/null 2>&1 || { echo "deploy: fly is not on PATH (infra/DEPLOY.md, section 1)" >&2; exit 1; }
	@git fetch -q origin main || { echo "deploy: git fetch origin main failed" >&2; exit 1; }
	@test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/main)" || { echo "deploy: HEAD is not origin/main; deploy from a clean checkout of main" >&2; exit 1; }
	@test -z "$$(git status --porcelain)" || { echo "deploy: the working tree is not clean; deploy from a clean checkout of main" >&2; exit 1; }

## deploy-redis: build on Fly's remote builder (the right architecture from any computer) and deploy
## the private Redis app (infra/DEPLOY.md, section 3)
deploy-redis: deploy-guard
	fly deploy . --config infra/fly/redis.toml --dockerfile infra/Dockerfile.redis --remote-only --ha=false

## deploy-api: deploy the API and the worker; the release step migrates first (infra/DEPLOY.md, section 6)
deploy-api: deploy-guard
	fly deploy . --config infra/fly/api.toml --dockerfile infra/Dockerfile.api --remote-only --ha=false --env SENTRY_RELEASE=$$(git rev-parse HEAD)

## deploy-admin: deploy the private admin dashboard (infra/DEPLOY.md, section 7)
deploy-admin: deploy-guard
	fly deploy . --config infra/fly/admin.toml --dockerfile infra/Dockerfile.admin --remote-only --ha=false

## deploy-web: build the web for https://api.$(DOMAIN), check the build and upload it to the Pages
## project homie (`make deploy-web DOMAIN=<domain> CONTACT_EMAIL=<address>`, or both in `.env`)
deploy-web: deploy-guard
	@test -n "$(DOMAIN)" && test -n "$$CONTACT_EMAIL" && test "$$CONTACT_EMAIL" != contact@example.com || { echo "usage: make deploy-web DOMAIN=<domain> CONTACT_EMAIL=<public contact address>" >&2; exit 1; }
	$(MAKE) client
	VITE_API_URL=https://api.$(DOMAIN) VITE_CONTACT_EMAIL="$$CONTACT_EMAIL" VITE_SENTRY_ENVIRONMENT=production VITE_SENTRY_RELEASE=$$(git rev-parse HEAD) $(MAKE) build-web
	$(MAKE) build-check
	cd web && pnpm dlx wrangler@$(WRANGLER_VERSION) pages deploy dist --project-name homie --branch main

## admin-role-prod: apply homie_admin's grants on production from the API machine, which has
## DATABASE_URL (infra/DEPLOY.md, section 7)
admin-role-prod: deploy-guard
	fly ssh console --config infra/fly/api.toml --process-group app -C "/opt/venv/bin/python /app/scripts/admin_role.py --existing-role"

## admin-role-verify-prod: prove the admin's real session has only its rights; changes nothing
admin-role-verify-prod:
	fly ssh console --config infra/fly/admin.toml -C "/opt/venv/bin/python /app/scripts/admin_role.py --verify"

## import-areas-prod: `import-areas` on a worker machine: settlements only, no outside request; by
## hand, never by a deploy (infra/DEPLOY.md, section 6)
import-areas-prod:
	fly ssh console --config infra/fly/api.toml --process-group worker -C "/opt/venv/bin/python /app/scripts/import_areas.py"

## check-images: build the three production images and check them in throwaway containers (spec 0013a)
check-images:
	sh infra/check-images.sh

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
# shortcut: 8 shards (E2E_SHARDS) against OTP_RATE_LIMIT_IP = 10 codes per 15 min; the largest shard
# requests 8 codes (2/8: auth, flatmates; 0016a's password login adds one), then 7 (7/8: market,
# people-market, people), 2 spare (4 shards put 12 on
# shard 4: 429s, spec 0013d; 6 left 9). 6/8 is empty today (map.spec fills 5/8), which Playwright allows.
# Recount with `playwright test --list --shard=N/8` when a spec adds sign-ups; add a shard when one passes 8
E2E_SHARDS ?= 8
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
web/node_modules/.modules.yaml: web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml
	$(PNPM) install --frozen-lockfile
	@touch $@
