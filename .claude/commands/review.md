---
description: Run the reviewers listed in a spec's frontmatter against its branch, in parallel. Usage: /review <spec id>
---
You are the orchestrator. Review the branch for spec $ARGUMENTS (`git diff main...HEAD`; the PR opens after the review, Speed rule 7).

1. Read the spec's `reviewers:` list. Map: code → `reviewer-code`, qa → `reviewer-qa`, security → `reviewer-security`, perf → `reviewer-perf`, ux → `reviewer-ux`.
2. Invoke all of them in parallel on the PR branch, each with the model and effort that fit the job (`CLAUDE.md` → Speed rule 6). Each returns one digest.
3. Merge the digests into one message, blockers first across all reviewers, then majors, then a folded minors list, then a one-line nit count. Drop duplicates. If two reviewers disagree, say so explicitly.
4. Return the merged digest; it is posted as a PR comment once the PR is open (the only copy; no `REVIEW-*.md` file).
