---
description: Hand a verified spec to the coder, then run its reviewers. Usage: /build <spec id>
---
You are the orchestrator. Build spec $ARGUMENTS.

1. Confirm `specs/$ARGUMENTS-*.md` has `status: verified` (or `in-review` for a follow-up round). If not, stop and tell me.
2. Invoke the `coder` subagent with the spec path. Wait for it to report the PR.
3. Run `/review $ARGUMENTS`.
4. If any reviewer requested changes: invoke `coder` again with the review digests (round 2, then round 3 at most). After a third REQUEST CHANGES, stop: mark the spec `status: draft`, append the unresolved findings under "Verifier findings", and tell me it is a spec defect.
5. When all required reviewers approve: run `/digest $ARGUMENTS` in "merged" shape (do not merge yourself — I merge) and show it to me.
