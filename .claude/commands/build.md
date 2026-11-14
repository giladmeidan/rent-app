---
description: Build one verified spec end to end in this session: coder, one review round, fixes, digest. Usage: /build <spec id>
---
You are the spec session for spec $ARGUMENTS (`CLAUDE.md` → Speed rules). Work in this spec's worktree.

1. Confirm `specs/$ARGUMENTS-*.md` has `status: verified`. If not, stop and report.
2. Invoke the `coder` subagent with the spec path (model and effort per Speed rule 6). It builds and commits locally.
3. Run `/review $ARGUMENTS` on the local branch — one round.
4. If there are blockers or majors: invoke `coder` once with the merged review digest, then check the fixes
   yourself (do not re-run reviewers). A blocker that is still open: mark the spec `status: draft`, append it
   under "Verifier findings", report a spec defect.
5. The coder pushes once, opens the PR with the `ready-to-merge` label; wait for the `ci` check on the head.
6. Run `/digest $ARGUMENTS` in "merged" shape. Do not merge: the orchestrator (or Gilad) merges with `make merge PR=N`.
7. `make down` in this worktree (Speed rule 10).
8. Report back to the orchestrator: PR link, CI result on the head commit, and the digest. Nothing else.
