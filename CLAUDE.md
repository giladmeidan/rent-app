# Rent App — agent conventions

homie / הומי: Hebrew-first, RTL rental marketplace for Gush Dan — apartments (owners ↔ seekers) and the
roommate market שוק השותפים (rooms, people browse, flatmates, direct chat).
Product Plan and Dev Plan live in the Claude project "rent app"; the short versions
you need are in `specs/PRODUCT.md` (decisions) and this file (process).

## You, in this repo
The main Claude Code session is the **orchestrator**: it talks to Gilad, writes specs,
and delegates. It never writes application code itself. Delegation chain:

    orchestrator → spec-verifier → coder → reviewers (chosen per spec) → merge (`make merge PR=N`)

Gilad merges, or delegates merging to the orchestrator for a slice (he has for every slice since 7).

## Speed rules (Gilad, 2026-11-10)
1. **One session per spec.** The orchestrator session only keeps the queue: it starts a separate Claude Code
   session for each spec, in that spec's worktree, running `/build NNNN`. That session runs coder → reviewers →
   fixes → digest and reports back only the PR link, the CI result and the digest. The orchestrator never reads
   diffs or agent transcripts into its own context.
2. **Queue.** The orchestrator moves to the next `verified` spec on its own; it does not wait for a new session
   or a go-ahead between specs. Gilad approves spec digests in batches. A spec is **ready to build** when it is
   `verified` and every spec in its `depends_on` is merged or open as a PR. The orchestrator starts a build
   session for **every** ready spec at once, not one at a time (Gilad, 2026-11-10); the only serialisation is
   `depends_on`, and **at most 3 build sessions work at once** (Gilad, 2026-11-12). Each worktree has its own
   `WEB_PORT` in its `.env`, so web specs build in parallel too. The desktop app refuses to start a session from
   an automated turn, so the orchestrator pre-starts a slice's build sessions in a turn Gilad wrote, each waiting
   for a "go" sent later with `SendMessage`.
3. **Parallel.** Specs with no `depends_on` between them build at the same time, each in its own worktree
   (`../rent-app-NNNN`) with its own `.env` (`COMPOSE_PROJECT_NAME=rent-app-NNNN` and its own `DB_PORT`,
   `REDIS_PORT`, `API_PORT`). A web half starts from the API half's branch as soon as that PR is open and
   merges `origin/main` after it lands (force push is denied, so never rebase a pushed branch). The next slice
   is specced and verified while the current one builds. When two PRs touch the same file, the second to merge
   merges `origin/main`.
4. **One review round.** Reviewers are chosen by risk, not by habit: an infra/skeleton spec gets `code` only. A cosmetic UI/UX spec whose behaviour is unchanged gets `ux` only and a Sonnet coder (Gilad, 2026-11-12).
   Blockers and majors are fixed; minors go straight to `specs/FOLLOWUPS.md` unless the fix is one line; nits
   are dropped. After the fixes the spec session checks them itself; reviewers are not re-run.
5. **No duplicate documents.** The PR body and the review digest live on the GitHub PR only (no `PR-NNNN.md`
   or `REVIEW-*.md` in the repo, no per-finding reply list). The repo keeps one thing: the spec's `## Digest`.
6. **Model per task.** Whoever spawns an agent picks its model and effort for the job: Opus/high for the
   spec-verifier, the coder on auth, money, data or migrations, and the security reviewer; Sonnet/medium for
   ux, qa and perf reviews of small specs, review fixes that are mechanical, and docs. When in doubt, the
   stronger one.
7. **One push per spec (Gilad, 2026-11-10).** Agents commit locally and run `make lint` / `make test` there; the
   review round runs on the local branch. No local `make e2e`: e2e runs only in CI (rule 8). Each worktree sets
   its own `WEB_PORT` (`WEB_ORIGIN` follows it; delete any old `WEB_ORIGIN=` line from a worktree `.env` when
   setting `WEB_PORT`); check `lsof -nP -iTCP:$WEB_PORT -sTCP:LISTEN` is empty before `make dev`. The spec is
   pushed **once**, when it is finished (build + review fixes), with the PR opened and the `ready-to-merge`
   label added at that push so CI runs once. A further push is allowed only to fix a CI failure.
8. **CI runs once per merge attempt, on the Mac (Gilad, 2026-11-13).** The `ci` workflow is one job — lint,
   types, i18n-check, pytest, vitest, build + build-check, e2e — on the self-hosted Mac runner (`rent-app-mac`,
   no Actions minutes; the account has 2,000 a month). It runs only while the PR carries the `ready-to-merge`
   label (rule 7's push; a later push to the PR runs it again) or by hand (Actions → ci → Run workflow). Plain
   pushes, pushes to `main`, and PRs that change only `*.md`, `specs/` or `design/` run nothing. e2e runs a
   shard's failed tests once more; a pass on that retry is a "Flaky e2e" warning on the run: log it in
   `specs/FOLLOWUPS.md`, never ignore it. **Merge only with `make merge PR=N`**: it refuses unless the `ci`
   check passed on the PR's head and the head contains `origin/main`, so the PR's run tested exactly what lands
   on `main` (no re-run after the merge). A PR behind `main`: merge `origin/main` into its branch and push; CI
   runs again. Mac away: `gh variable set CI_ON_GITHUB --body on` (GitHub-hosted, ~16 paid minutes a run);
   `gh variable delete CI_ON_GITHUB` when it is back.

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
    orchestrator, in `../rent-app-orch` (a worktree detached on `origin/main` for docs commits), sets the spec
    `status: done`, moves it to `specs/archive/` and pushes `HEAD:main`; then runs `git worktree remove
    ../rent-app-NNNN` and deletes the local and remote `spec/NNNN-…` branch; a worktree is kept only while a
    dependent web half is still branched from it. Never leave a stack running "in case": it burns CPU and ports and confuses `docker ps`.

11. **The orchestrator always keeps watch (Gilad, 2026-11-14).** While any build session it started is working, or
    any spec PR is open, the orchestrator watches it without being asked, and acts on each change at once:
    - **Sessions:** their turn-end notes are the main signal. A session waiting on a question gets an answer, or the
      question goes to Gilad; a session that stops short of its report gets one line asking where it stands.
    - **PRs:** one background watcher for all open spec PRs (a shell `until` loop over `gh pr view`, polling every
      5 minutes or more), which ends on a finished `ci` run, a merge conflict, or a PR head missing `origin/main`. Then
      the orchestrator acts and starts the watcher again: green → `make merge PR=N` when merging is delegated, else tell
      Gilad; red → read only the failing step's summary, then send the spec session or Gilad one line with the cause
      (a loaded Mac is not a code bug, rule 8); behind `main` → the spec session merges `origin/main` and pushes.
    - **Not excessively:** no polling under 5 minutes, no "are you done?" messages, no reading diffs or transcripts
      (rule 1), and no second watcher for the same thing.

Subagents are defined in `.claude/agents/`. Slash commands in `.claude/commands/`:
`/spec <slice-title>`, `/build <spec-id>`, `/review <spec-id>`, `/digest <spec-id>`.

## Hard rules (every agent)
1. One spec at a time. A spec is `specs/NNNN-slug.md` (done specs live in `specs/archive/`); its frontmatter
   `status` is the source of truth.
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
    make e2e        # playwright smoke suite against the compose stack (CI only, rule 8)
    make merge PR=N # merge a PR whose ci passed and whose head contains main (rule 8)
    make i18n-check # fail on hardcoded strings or missing keys

## Layout
    specs/            PRODUCT.md (decisions), FOLLOWUPS.md (open minors), _template.md, open specs
    specs/archive/    done specs (each with its ## Digest) and finished planning docs
    api/app/          routers/ models/ schemas/ services/ matching/ i18n/
    api/tests/        unit + integration (Postgres via compose)
    web/src/          app/ features/<domain>/ components/ locales/ api/ (generated)
    web/e2e/          playwright
    infra/            docker-compose.yml, Dockerfiles
    .github/workflows/ci.yml

## Knowledge graph (graphify) (Gilad, 2026-11-13)
`main`'s code is mapped in `rent-app/graphify-out/graph.json` (main checkout only, gitignored);
`.claude/settings.json` points `GRAPHIFY_OUT` at it from every worktree, and its hooks add advisory notes on
Grep/Read/Glob/Bash. It shows `main`, not your branch.
- **Blast radius (required).** Before changing shared code, `graphify affected "<symbol>"`: every hit is a caller
  or test the change must reach. The spec-verifier writes it into the spec's `## Blast radius`, the coder works
  from it, `reviewer-code` checks the diff against it. Put this bullet in the prompt of every agent that reads code.
- **Lookups (optional).** `graphify query "<question>"`, `explain "<symbol>"`, `path "<A>" "<B>"` before grepping
  a codebase question; grep for exact strings (i18n keys, error codes). After a query that mattered:
  `graphify save-result --question … --answer … --nodes … --outcome useful|dead_end|corrected`.
- **Upkeep.** Git hooks in the main checkout rebuild it on commit, pull and checkout (`git pull` there after a
  merge); by hand `graphify update .` (`--force` after big deletions). Never run `graphify update` or `label`
  in a worktree: it would overwrite `main`'s graph. After a slice's last merge, in the main checkout:
  `GRAPHIFY_CLAUDE_CLI_MODEL=haiku graphify label . --backend=claude-cli`.

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
`design/brand/` (tokens, logos, mascot, icons, voice) wins for colour, type, shape and voice; artboards in
`design/screens-v1/` and `design/screens-v2/` give layout and anatomy only (see `design/README.md`). Specs
reference them in the UI section; the UX reviewer compares against them.
