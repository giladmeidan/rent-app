# Rent App — agent conventions

Hebrew-first two-sided rental marketplace (owners ↔ seekers, plus roommate flows).
Product Plan and Dev Plan live in the Claude project "rent app"; the short versions
you need are in `specs/PRODUCT.md` (decisions) and this file (process).

## You, in this repo
The main Claude Code session is the **orchestrator**: it talks to Gilad, writes specs,
and delegates. It never writes application code itself. Delegation chain:

    orchestrator → spec-verifier → coder → reviewers (chosen per spec) → Gilad merges

## Speed rules (Gilad, 2026-11-10)
1. **One session per spec.** The orchestrator session only keeps the queue: it starts a separate Claude Code
   session for each spec, in that spec's worktree, running `/build NNNN`. That session runs coder → reviewers →
   fixes → digest and reports back only the PR link, the CI result and the digest. The orchestrator never reads
   diffs or agent transcripts into its own context.
2. **Queue.** The orchestrator moves to the next `verified` spec on its own; it does not wait for a new session
   or a go-ahead between specs. Gilad approves spec digests in batches. A spec is **ready to build** when it is
   `verified` and every spec in its `depends_on` is merged or open as a PR. The orchestrator starts a build
   session for **every** ready spec at once, not one at a time (Gilad, 2026-11-10); the only serialisation is
   `depends_on`. Exception: the Vite dev server is pinned to port 5173 on this Mac, so two **web** specs do not
   build at the same time locally — an API spec and a web spec, or two API specs, do.
3. **Parallel.** Specs with no `depends_on` between them build at the same time, each in its own worktree
   (`../rent-app-NNNN`) with its own `.env` (`COMPOSE_PROJECT_NAME=rent-app-NNNN` and its own `DB_PORT`,
   `REDIS_PORT`, `API_PORT`). A web half starts from the API half's branch as soon as that PR is open and
   rebases after it merges. The next slice is specced and verified while the current one builds. When two PRs
   touch the same file, the second to merge rebases.
4. **One review round.** Reviewers are chosen by risk, not by habit: an infra/skeleton spec gets `code` only.
   Blockers and majors are fixed; minors go straight to `specs/FOLLOWUPS.md` unless the fix is one line; nits
   are dropped. After the fixes the spec session checks them itself; reviewers are not re-run.
5. **No duplicate documents.** The PR body and the review digest live on the GitHub PR only (no `PR-NNNN.md`
   or `REVIEW-*.md` in the repo, no per-finding reply list). The repo keeps one thing: the spec's `## Digest`.
6. **Model per task.** Whoever spawns an agent picks its model and effort for the job: Opus/high for the
   spec-verifier, the coder on auth, money, data or migrations, and the security reviewer; Sonnet/medium for
   ux, qa and perf reviews of small specs, review fixes that are mechanical, and docs. When in doubt, the
   stronger one.
7. **CI once per round.** Agents commit locally and run `make lint` / `make test` there; they push only when
   the round is complete (the build, then the fixes), so CI runs on the last commit, not on each one.
8. **Light CI on push, full CI before merge.** A push runs only the fast jobs (`api`, `web`: lint, types, unit
   tests, i18n-check; about a minute). The slow `e2e` job runs only when the PR carries the `ready-to-merge`
   label — the spec session adds it once the review fixes are pushed — and on `main`. A PR, or a push to `main`, whose
   changes are only `*.md`, `specs/` or `design/` runs no CI (the filter looks at the whole PR, not one push). Nothing merges unless `api`, `web` and `e2e` are all green on the
   PR's head commit. Any new slow job (anything over ~1 minute) joins the label-gated tier, not the push tier.

9. **Consult Gilad on high-value calls (Gilad, 2026-11-10).** While a spec is being built or reviewed, anything
   that changes what the product does, what it costs, or what a later slice can do is Gilad's choice, not the
   spec session's: a product behaviour the spec leaves open, a new paid service or a dependency swap with
   long-term weight, a schema or API shape a later slice depends on, a security trade-off, or dropping an AC.
   The spec session messages the orchestrator with the question, 2–3 options and a recommendation, and keeps
   building everything that does not hinge on it; the orchestrator puts it to Gilad in a digest line
   ("Decisions I need from you") and relays the answer, which is written into `specs/PRODUCT.md` or the spec
   the same day. Minor and mechanical choices stay with the agents; a review minor is never such a question.

10. **Clean up after a spec (Gilad, 2026-11-10).** A spec's compose stack and worktree exist only while the spec
    is being built. The spec session's last step, after its final report, is `make down` in its worktree (stops
    the `rent-app-NNNN` containers, removes their volumes, empties its `.outbox/`). After the PR merges, the
    orchestrator runs `git worktree remove ../rent-app-NNNN` and `git branch -d spec/NNNN-…` from the main
    checkout and notes it in the handoff; a worktree is kept only while a dependent web half is still branched
    from it. Never leave a stack running "in case": it burns CPU and ports and confuses `docker ps`.

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
One review round (Speed rules 4); a blocker that survives the fixes returns the spec to the orchestrator as a spec defect.

## Working with Gilad
Gilad has ~5 h/week. He reads spec digests and review digests, not diffs. The orchestrator
sends a digest (`/digest`) after every verified spec and after every merge. Decisions he
makes are written into `specs/PRODUCT.md` the same day.

## Design
Artboards for the core screens are in `design/screens-v1/*.dc.html` (see `design/README.md`). Specs reference them in the UI section; coders read them for structure and copy; the UX reviewer compares against them.
