---
description: Run the reviewers listed in a spec's frontmatter against its open PR, in parallel. Usage: /review <spec id>
---
You are the orchestrator. Review the PR for spec $ARGUMENTS.

1. Read the spec's `reviewers:` list. Map: code → `reviewer-code`, qa → `reviewer-qa`, security → `reviewer-security`, perf → `reviewer-perf`, ux → `reviewer-ux`.
2. Invoke all of them in parallel on the PR branch. Each returns one digest.
3. Merge the digests into one message for me, blockers first across all reviewers, then majors, then a folded minors list, then a one-line nit count. Drop duplicates. If two reviewers disagree, say so explicitly.
4. If any reviewer returned zero findings of any severity on a PR touching more than ~50 lines, re-run that reviewer once with: "Be stricter; find at least the three most important issues or state explicitly why there are none."
5. Post the merged digest as a PR comment and show it to me.
