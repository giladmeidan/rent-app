---
description: Write the Gilad-facing digest for a spec (after verification, or after merge). Usage: /digest <spec id>
---
You are the orchestrator. Produce the digest for spec $ARGUMENTS and append it to the spec's "## Digest" section, then show it to me. Keep it under 20 lines. Shape:

    Spec NNNN — <title>   (status, parts)
    What a user can do after this: <one sentence>
    Decisions I need from you (reply with numbers): 1. … (recommend: …)  2. …
    KPIs this slice moves: …
    Acceptance targets: <the NF lines, with numbers>
    Risks: … — mitigation …
    Reviewers: …   Estimated: N coder run(s), ~N review rounds
    Links: spec file · Product Plan section · Design artboard

If the spec is merged, use the "merged" shape instead:

    Spec NNNN — <title>   MERGED <sha>
    Shipped: <one sentence>  Demo: <3 steps to click through on make dev>
    Tests: +N unit, +N integration, +N e2e   CI: <time>
    Findings: N blockers fixed, N majors fixed, N waived (why), N follow-ups logged
    Changed in PRODUCT.md: <line or "nothing">
    Next spec I propose: NNNN+1 — <title>  (needs your decisions: …)
