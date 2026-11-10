---
description: Build one verified spec end to end in this session: coder, one review round, fixes, digest. Usage: /build <spec id>
---
You are the spec session for spec $ARGUMENTS (`CLAUDE.md` → Speed rules). Work in this spec's worktree.

1. Confirm `specs/$ARGUMENTS-*.md` has `status: verified`. If not, stop and report.
2. Invoke the `coder` subagent with the spec path (model and effort per Speed rule 6). Wait for the PR and green CI.
3. Run `/review $ARGUMENTS` — one round.
4. If there are blockers or majors: invoke `coder` once with the merged review digest. Then check the fixes
   yourself against the findings (do not re-run reviewers) and wait for green CI on the head commit.
   A blocker that is still open: mark the spec `status: draft`, append it under "Verifier findings", report a spec defect.
5. Run `/digest $ARGUMENTS` in "merged" shape. Do not merge — Gilad merges.
6. Report back to the orchestrator: PR link, CI result on the head commit, and the digest. Nothing else.
