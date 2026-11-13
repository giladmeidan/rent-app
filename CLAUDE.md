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
   `depends_on`. Each worktree has its own `WEB_PORT` in its `.env` (default 5173), so web specs build in parallel too.
3. **Parallel.** Specs with no `depends_on` between them build at the same time, each in its own worktree
   (`../rent-app-NNNN`) with its own `.env` (`COMPOSE_PROJECT_NAME=rent-app-NNNN` and its own `DB_PORT`,
   `REDIS_PORT`, `API_PORT`). A web half starts from the API half's branch as soon as that PR is open and
   rebases after it merges. The next slice is specced and verified while the current one builds. When two PRs
   touch the same file, the second to merge rebases.
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
    make e2e        # playwright smoke suite against the compose stack (CI only, rule 8)
    make merge PR=N # merge a PR whose ci passed and whose head contains main (rule 8)
    make i18n-check # fail on hardcoded strings or missing keys

## Layout
    specs/            one file per slice (+ PRODUCT.md with the standing decisions)
    api/app/          routers/ models/ schemas/ services/ matching/ i18n/
    api/tests/        unit + integration (Postgres via compose)
    web/src/          app/ features/<domain>/ components/ locales/ api/ (generated)
    web/e2e/          playwright
    infra/            docker-compose.yml, Dockerfiles
    .github/workflows/ci.yml

## Knowledge graph (graphify) (Gilad, 2026-11-13)
The code of `main` is mapped as a graph in the main checkout: `rent-app/graphify-out/graph.json`
(gitignored; api, web, infra and CI code, plus the headings and links of `specs/`, `research/`
and `HANDOFF.md`; design artboards are not in it). It is the first place to look, before grep or
reading files.

- **Where it lives.** Only the main checkout has it. `.claude/settings.json` sets `GRAPHIFY_OUT` to
  it, so every `graphify` command below finds it from the main checkout and from any worktree, with
  no flags. It shows `main`, not your branch: for lines your branch changed, read the file.
- **Before a task, ask the graph.** Before the first grep or file read on a codebase question:
  `graphify query "<question>"` (raise `--budget` if it says TRUNCATED), `graphify explain "<symbol>"`
  for one function or module, `graphify path "<A>" "<B>"` for how two pieces connect. Then read only
  the files and lines it points to. Grep is for exact strings the graph cannot hold (an i18n key,
  an error code, a config value). A session also reads `graphify-out/reflections/LESSONS.md` once,
  if it exists: the places earlier queries found useful, and the dead ends.
- **Reminders.** `.claude/settings.json` has graphify hooks on Grep, Read, Glob and Bash. When an agent
  searches or reads code, the hook adds a short note naming the graph and what it already has for
  that target. The note is advisory; it never blocks a tool call.
- **Before changing shared code, check the blast radius.** `graphify affected "<symbol>"` lists what
  depends on a function, schema or component; every hit is a caller or test the change must reach.
  Because the graph is `main`, it is exactly the "before" picture of a PR. The spec-verifier writes
  it into the spec, the coder works from it, and `reviewer-code` checks the diff against it (their
  agent files say how).
- **Subagents too.** Whoever spawns an agent that reads code (spec-verifier, coder, reviewers, Explore)
  puts the "ask the graph" and "blast radius" bullets into its prompt.
- **Record what the graph was worth.** After a query that led to the answer, or nowhere, or to a wrong
  answer: `graphify save-result --question "<q>" --answer "<one line>" --nodes <labels it cited>
  --outcome useful|dead_end|corrected` (`--correction "<right answer>"` with `corrected`). One line,
  only for queries that mattered. The git hooks fold these into `LESSONS.md` on every rebuild.
- **Keeping it current.** Git hooks in the main checkout (`post-commit`, `post-merge`, `post-checkout`,
  `post-rewrite`) rebuild it after each commit, `git pull` or branch switch. They skip worktrees on
  purpose. So after a PR merges, the orchestrator runs `git pull` in the main checkout and the graph
  follows. To rebuild by hand: `graphify update .` in the main checkout (no LLM, about 20 s).
  After a refactor that deletes code it refuses to shrink: add `--force`. Never run `graphify update`
  or `graphify label` inside a worktree: with `GRAPHIFY_OUT` set, it would overwrite `main`'s graph
  with the branch.
- **Community names, once per slice.** Rebuilds rename changed communities after their busiest node
  ("typing", "react"). After a slice's last merge, the orchestrator runs, in the main checkout,
  `GRAPHIFY_CLAUDE_CLI_MODEL=haiku graphify label . --backend=claude-cli` (Haiku via the `claude`
  CLI, a few cents). If that fails on sign-in, it names them itself: write
  `graphify-out/.graphify_labels.json` (`{"<id>": "<2-5 word name>"}`), then
  `graphify cluster-only . --no-label`.
- **Full report.** `graphify-out/GRAPH_REPORT.md` (hubs, communities, import cycles) is for
  architecture reviews only; `graphify-out/graph.html` is the picture for Gilad.

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
