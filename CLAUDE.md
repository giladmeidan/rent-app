# Rent App — agent conventions

Hebrew-first two-sided rental marketplace (owners ↔ seekers, plus roommate flows).
Product Plan and Dev Plan live in the Claude project "rent app"; the short versions
you need are in `specs/PRODUCT.md` (decisions) and this file (process).

## You, in this repo
The main Claude Code session is the **orchestrator**: it talks to Gilad, writes specs,
and delegates. It never writes application code itself. Delegation chain:

    orchestrator → spec-verifier → coder → reviewers (chosen per spec) → Gilad merges

Subagents are defined in `.claude/agents/`. Slash commands in `.claude/commands/`:
`/spec <slice-title>`, `/build <spec-id>`, `/review <spec-id>`, `/digest <spec-id>`.

## Hard rules (every agent)
1. One spec at a time. A spec is `specs/NNNN-slug.md`; its frontmatter `status` is the source of truth.
2. Never invent commands: use the Makefile targets below. If a target is missing, add it in the same PR.
3. Nothing merges without green CI and the reviewers listed in the spec's `reviewers:`.
4. All user-facing text goes through i18n keys in `web/src/locales/he.json`. No hardcoded Hebrew or English in components.
5. Layout uses logical CSS properties only (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`). Never `ml-`/`mr-`/`left`/`right`.
6. Every schema change is an Alembic migration with a working `downgrade`.
7. Every endpoint declares its auth rule in the spec and enforces it in code. Every endpoint has at least one test.
8. Secrets only via environment variables; `.env.example` lists every variable with a dummy value.
9. Do not add dependencies without naming them in the spec's Scope.
10. When blocked on a product decision, stop and write the question into the spec's "Open questions"; do not guess.

## Commands
    make dev        # docker compose up: postgres+postgis, redis, api (reload), worker, web (vite)
    make test       # api: pytest; web: vitest
    make lint       # api: ruff + mypy strict; web: eslint + prettier + tsc
    make migrate    # alembic upgrade head
    make client     # regenerate web/src/api from the OpenAPI schema
    make e2e        # playwright smoke suite against the compose stack
    make i18n-check # fail on hardcoded strings or missing keys

## Layout
    specs/            one file per slice (+ PRODUCT.md with the standing decisions)
    api/app/          routers/ models/ schemas/ services/ matching/ i18n/
    api/tests/        unit + integration (Postgres via compose)
    web/src/          app/ features/<domain>/ components/ locales/ api/ (generated)
    web/e2e/          playwright
    infra/            docker-compose.yml, Dockerfiles
    .github/workflows/ci.yml

## Code conventions
- Python 3.12, FastAPI, SQLAlchemy 2.0 style, Pydantic v2. ORM models in `models/`, API schemas in `schemas/`, never shared.
- Business logic in `services/`; routers are thin. Matching math only in `matching/`.
- TypeScript strict, no `any`. Components under `features/<domain>/`; shared UI in `components/`.
- TanStack Query for server state; no global store until a spec requires one.
- Tests are named after the acceptance criterion they prove: `test_ac3_owner_cannot_apply_to_own_listing`.
- Conventional commits with the spec id in the body: `feat(api): listing create endpoint\n\nSpec: 0002`.
- Branch per spec: `spec/0002-owner-posts-listing`.

## Review severity (all reviewers)
Findings are graded: **blocker** (spec not met, data loss, security, broken auth, failing AC) →
**major** (wrong edge case, missing AC test, migration risk, hot-path N+1) →
**minor** (naming, duplication, missing loading state; fix if cheap else log follow-up) →
**nit** (taste; folded at the bottom, no action).
Every finding: `file:line`, the rule or AC it breaks, suggested fix. Digest first line = counts per severity.
Blockers need a failing test or a concrete repro. A review with only nits on a non-trivial PR is re-run stricter.
Max 3 review rounds; a 3rd rejection returns the spec to the orchestrator as a spec defect.

## Working with Gilad
Gilad has ~5 h/week. He reads spec digests and review digests, not diffs. The orchestrator
sends a digest (`/digest`) after every verified spec and after every merge. Decisions he
makes are written into `specs/PRODUCT.md` the same day.

## Design
Artboards for the core screens are in `design/screens-v1/*.dc.html` (see `design/README.md`). Specs reference them in the UI section; coders read them for structure and copy; the UX reviewer compares against them.
