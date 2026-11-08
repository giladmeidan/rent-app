# Follow-ups
Minor findings deferred by the coder. Format: `- [ ] NNNN · file:line · what · why deferred`

- [ ] 0000a · .github/workflows/ci.yml:48-49 · pin `actions/checkout` and `astral-sh/setup-uv` to full commit SHAs (tag in a comment) · no GitHub remote yet; the tag→SHA mapping should be resolved and checked against GitHub when the repo is pushed, ideally with Dependabot for actions so pins stay current
- [ ] 0000a · infra/Dockerfile.api:1 · pin the `ghcr.io/astral-sh/uv` base image by digest · security reviewer scoped it "before Slice 12"; a digest pin without an update bot goes stale, so do it with the deploy work
- [ ] 0000a · api/app/services/health.py:23 · reuse one module-level Redis client/pool for `/health` instead of a connection per call · changes client lifecycle (create at startup, close on shutdown) for no gain at dev load; revisit when Redis use grows (Slice 1 sessions/queue)
- [ ] 0000a · api/app/db.py:26 · a pooled connection to a *hung* (not blackholed) Postgres still blocks `/areas` indefinitely (`docker compose pause db` → request times out client-side at 15 s); `/health` is bounded at ~2 s via the unpooled ping engine and fresh connects via `connect_timeout` · needs an app-wide query/request timeout design (server `statement_timeout` cannot fire on a frozen server), beyond the round-1 finding
