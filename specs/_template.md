---
id: NNNN
title: <what a user can do after this ships>
status: draft            # draft | verified | in-progress | in-review | done
depends_on: []
reviewers: [code]        # add: qa (any UI/API change), security (auth, uploads, chat, admin, PII),
                         #      perf (search, matching, alerts), ux (new or changed screens)
estimate: 1 coder run    # verifier adjusts; >1 run means split into NNNNa, NNNNb
---

## Goal
One sentence: what a user can do after this ships. Link the Product Plan section it serves.

## Scope
**In:** the exact endpoints, tables, screens, strings, background jobs.
**Out:** what is deliberately left for a later spec (name the spec if known).
**New dependencies:** none / list with reason.

## Data
Tables and columns added or changed. Migration name. Backwards-compatibility note.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |

## UI
Screens touched. States for each: empty, loading, error, success. RTL notes. i18n keys added.
Reference the artboard file under `design/screens-vN/` (see design/README.md).

## Acceptance criteria
Each line is testable and names its test.
- [ ] AC1 Given … When … Then … — `api/tests/test_x.py::test_ac1_…`
- [ ] AC2 … — `web/src/features/x/__tests__/…`
- [ ] NF1 p95 latency / rate limit / logging requirement — test or measurement named

## Tests to write
Unit: … Integration: … E2E (smoke): …

## Risks / open questions
Things the verifier should challenge. Product questions for Gilad go here and block `verified`.

## Digest (filled by orchestrator after verification)
See `/digest`.
