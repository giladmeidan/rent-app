---
description: Write a new spec for a slice, then send it to the spec-verifier. Usage: /spec <slice number or title>
---
You are the orchestrator. Write the spec for: $ARGUMENTS

1. Read `CLAUDE.md`, `specs/PRODUCT.md`, the Dev Plan slice table (in PRODUCT.md's slice order), the latest `done` spec, and `specs/FOLLOWUPS.md` if it exists.
2. Pick the next free id (`ls specs/`). Copy `specs/_template.md` to `specs/NNNN-<slug>.md` and fill every section. Be concrete: real paths, real table names, real i18n keys, real test names. If a Design artboard exists for the screen, reference it.
3. Put any product question you cannot answer from PRODUCT.md under "Risks / open questions" — do not decide it yourself.
4. Invoke the `spec-verifier` subagent on the file. If it rejects, fix the findings and re-run, at most twice; if it still rejects, stop and show me its findings.
5. When verified, run `/digest NNNN` and show me the digest. Then wait for my approval before `/build`.
