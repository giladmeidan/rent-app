# 0000 — Foundations (SPLIT, not a buildable slice)

Split by the spec-verifier on 2026-11-08 because infra + api + web + three CI jobs exceeds one coder run.
This file has no frontmatter on purpose so no command picks it up as a slice. It may be deleted.

- `specs/0000a-foundations-api.md` — infra (compose db/redis/api/worker), API skeleton, `areas` table + seed, OpenAPI export, CI `api` job.
- `specs/0000b-foundations-web.md` — web shell (Vite/React/Tailwind, RTL, i18n), generated client, i18n-check, PWA manifest, Playwright smoke, CI `web` + `e2e` jobs. `depends_on: [0000a]`.
