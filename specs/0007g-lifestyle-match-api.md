---
id: 0007g
title: Room listings score the lifestyle questionnaire — a seeker with a room section sees "lifestyle" among a room's match reasons, and the owner's inbox scores it only on applications made to a room
status: in-progress
depends_on: [0007b]      # 0007b: applications.listing_type_at_apply (migration 0010) and public rooms; 0007a (via 0007b): the answers columns, `Lifestyle`, `LIFESTYLE_KEYS` (app.schemas.profile)
reviewers: [code, qa, security, perf]   # perf: a 7-key jsonb expression in the match sort over every filtered row; security: the apartment → room lifestyle probe through the owner's score; qa: the 10-row scoring table, numeric rounding
estimate: 1 coder run    # small; coder on Opus/high (numeric formula, the inbox probe). Split from the original 0007b at Gilad's word (verifier finding 1)
---

## Goal
After this ships, the match score (`0006b`) of a **room** listing includes the soft `lifestyle` criterion. The
criterion is the agreement between the flat's questionnaire answers and the seeker's answers (`0007a`), and it
counts only the questions both sides answered.

- `match.agrees` / `match.differs` can name `lifestyle`. They do so on search, on the listing page, and in the
  owner's inbox (`0006c`), because all three share `match_columns`.
- The owner's inbox scores lifestyle **only on applications made to a room** (`0007b`'s
  `applications.listing_type_at_apply`). An owner who turns an apartment into a room therefore cannot read an
  apartment applicant's answers off the score.
- Apartments, and seekers without a room section, score exactly as before.

`0007c` (`specs/0007c-room-inbox.md`) and `0007f` take the lifestyle criterion from this spec. Serves Dev Plan
slice 7, part g (`0007a`–`0007g`). PRODUCT.md rows: "Rooms" (the questionnaire) and "Matching". Artboards:
`Search.dc.html` / `SearchDesktop.dc.html` and `Listing.dc.html` (the agree/differ lines; copy in `0007f`).

## Scope
**In:**
- `api/app/matching/score.py`:
  - `CRITERIA = get_args(Criterion)` keeps its code unchanged. It now has 9 entries, with `lifestyle` last in the
    tie-break order. `WEIGHTS` stays the 8 base criteria (sum 100).
  - New constants: `LIFESTYLE_WEIGHT: Final = 20` and `BASE_SHARE: Final = Decimal("0.8")`. `BASE_SHARE` is
    `(100 − LIFESTYLE_WEIGHT) / 100`. `lifestyle` is never in `HARD`.
  - `match_columns` gains:
    - the `m_lifestyle` label (Data), `Numeric` and NULL-able;
    - the keyword `listing_type: QueryableAttribute[str] | ColumnElement[str] | None = None`, next to `price=` and
      `area_id=`. Its default is `listing.listing_type`. `m_lifestyle` is NULL unless this value is `'room'`.
  - The base sum loops over `WEIGHTS`, not `CRITERIA`. `raw` follows Data. The `f_*` columns and the 59 cap are
    unchanged.
  - `explain` skips every criterion whose `m_c` is None. It ranks by effective weight: `BASE_SHARE · W_c` for the
    8 base criteria and `LIFESTYLE_WEIGHT` for `lifestyle`.
  - Update the module docstring: lifestyle, the keyword, and why the owner's inbox passes the snapshot.
- `api/app/schemas/match.py`: `Criterion` gains `"lifestyle"` as its last value. Update the comment: soft, scored
  on rooms only, NULL (and so skipped) when no answer is shared.
- `api/app/services/applications.py`: `_applicants` passes `listing_type=Application.listing_type_at_apply` to
  `match_columns`, next to `price=` and `area_id=` (security, Data). The docstring's "Owner side, matching" gains:
  lifestyle is scored only when the seeker applied to a room. Nothing else in the inbox changes, and the inbox
  shape is unchanged.
- Tests:
  - New `api/tests/test_lifestyle_match.py` (AC1, AC2).
  - Additions to `api/tests/test_inbox.py` (AC3, AC4).
  - Amendment to `api/tests/test_matching.py`: `_values()` gains `"m_lifestyle": None` after its comprehension.
    Without it, `CRITERIA`'s new entry would make the 4 existing `test_ac11` cases score lifestyle; `all_ones`
    would give `[budget, lifestyle, move_in]`.
- Web, the type-only edits forced by the new `Criterion` value. `make client` makes every `Record<Criterion, …>`
  incomplete, and `tsc` fails:
  - `web/src/features/match/reasons.ts` (`0006f`, on `main`). Mandatory:
    - `SEEKER.lifestyle`: `agree: (_l, _p, t) => t('match.seeker.lifestyle.agree')` and
      `differ: (_l, _p, t) => t('match.seeker.lifestyle.differ')`.
    - `SEEKER_SHORT.lifestyle`: both kinds return `null`, so no chip is shown (`Short` allows `string | null`).
  - `OWNER` / `OWNER_SHORT` in the same file. These come from `0006g`, in review at `../rent-app-0006g`
    (`reasons.ts:225`, `:271`). **Whichever of `0006g` / `0007g` merges second** adds:
    - `OWNER.lifestyle`: `agree: (_p, _s, t) => t('match.owner.lifestyle.agree')` and
      `differ: (_p, _s, t) => t('match.owner.lifestyle.differ')`.
    - `OWNER_SHORT.lifestyle`: `agree: (_p, t) => t('match.owner.short.lifestyle.agree')` and
      `differ: (_p, t) => t('match.owner.short.lifestyle.differ')`. `OwnerShort` returns `string`, so these
      entries cannot be `null` stubs.

    This owner-voice copy belongs to this spec. It is final unless `0007c`'s web half replaces it.
  - `web/src/locales/he.json`: the keys in UI. `make i18n-check` needs every key that `t()` calls.

**Out:**
- What the owner sees of the answers themselves: `0007c`.
- The final seeker-voice `lifestyle` copy (agree/differ lines and chips, with counts): `0007f` replaces the stub.
- Per-question weights, a lifestyle filter or minimum, and age-based scoring.
- Rooms becoming public, the fit rule, the gate and the snapshot column: `0007b`.

**New dependencies:** none.

## Data
No schema change. Reads `listings.lifestyle` and `seeker_profiles.lifestyle` (`0007a`), and
`applications.listing_type_at_apply` (`0007b`).

**`lifestyle` criterion** (in `match_columns`). `L` is the listing, `P` the profile, and `T` the `listing_type=`
keyword (default `L.listing_type`).
- Per-key terms. For each key `k` in `LIFESTYLE_KEYS` (`app.schemas.profile`), unrolled in Python so the SQL has
  no subquery and no SubPlan:
  - `a_k = (L.lifestyle ->> k)::numeric`
  - `b_k = (P.lifestyle ->> k)::numeric`
  - `t_k = 1 - abs(a_k - b_k) / 2`

  `t_k` is NULL unless both sides answered `k`. Otherwise it is 1, 0.5 or 0.
- `m_lifestyle = CASE WHEN T = 'room' THEN Σ coalesce(t_k, 0) / nullif(Σ CASE WHEN t_k IS NULL THEN 0 ELSE 1 END,
  0) END`. This is the mean over shared keys. It is NULL when no key is shared or when `T` is not a room.
- `B = Σ_{c in WEIGHTS} W_c · m_c`, `0006b`'s unrounded numeric base sum.
- `raw = round(coalesce(0.8 · B + 20 · m_lifestyle, B))`. There is **one** `round`, and B is never rounded first
  (AC1 row 10).
- `0.8` is bound as **numeric** (`literal(BASE_SHARE, Numeric)`), never as a Python float. A float bind makes the
  sum `double precision`, which `round` rounds half to even (`0006b` finding 1).
- `m_score` is unchanged: `least(raw, 59)` when any `f_c` holds, cast to `int`. When `m_lifestyle` is NULL, the
  score is exactly `0006b`'s.
- Apartments carry `lifestyle = '{}'` (`ck_listings_room_fields`), and so does a profile without a room section.
  So the `T = 'room'` test only matters for the owner's snapshot.
- Optional, for the perf reviewer: computing the denominator as `(L.lifestyle ? k AND P.lifestyle ? k)` halves
  the extractions. The result is the same.

**Explanation** (`explain`):
- Criteria with `m_c` None are dropped first. They are in neither `agrees` nor `differs`.
- The effective weight `w_c` is `BASE_SHARE · W_c` for the 8 base criteria and `LIFESTYLE_WEIGHT` for
  `lifestyle`.
- `differs`: the first criterion with `m_c < 1`, sorted by (not failing, −w·(1−m), `CRITERIA` index).
- `agrees`: the first 3 criteria with `m_c ≥ 0.5`, not failing and not `differs`, sorted by (−w·m, `CRITERIA`
  index).
- The 0.8 factor applies to all 8 base criteria alike, so it does not change their order. A NULL lifestyle
  therefore gives exactly `0006b`'s explanation.
- With lifestyle at 1, `lifestyle` (20) ties `budget` (25 · 0.8 = 20) and sorts after it by index.

**Owner's inbox (security, the B1 pattern of `0006c`).** `_applicants` passes `Application.listing_type_at_apply`
as `T`. Without it, an owner could switch an apartment to a room, set one flat answer, and read an apartment
applicant's answer off the score or `differs`, one answer per edit. That breaks PRODUCT.md "Rooms": "never on
apartment applications".
- An apartment applicant's owner-side match never contains lifestyle.
- A room applicant's owner-side match does, live. The owner sees those answers anyway (`0007c`).
- The seeker's own views always use the live type.

This deviates from the contract's "NULL when the listing is not a room", deliberately. For the owner, "the
listing" means the listing as applied to. `0007c` relies on this keyword and does not touch `score.py`.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /listings | public; `optional_user` (as `0006b`) | as `0007b` | 200 `ListingSearchOut`; on rooms, `match` may name `lifestyle` (score per Data) | as `0007b` |
| GET | /listings/{id} | public; `optional_user` | — | 200 `ListingDetail`; `match` as above | as `0007b` |
| GET | /listings/{listing_id}/applications | as `0004c` (owner, own listing) | as `0006c` | 200 `list[ApplicantOut]`; `match` may name `lifestyle` only when the application was made to a room | as `0006c` |
| PATCH | /listings/{listing_id}/applications/{application_id} | as `0004c` | as `0004c` | 200 `ApplicantOut`, as the list | as `0006c` |

No shape changes. The only OpenAPI change is the `Criterion` enum gaining `lifestyle`.

## UI
No new screen. The stubs in Scope make `lifestyle` render with generic copy:
- the listing page's match card (`SEEKER`) shows the lines below;
- search cards show no chip for it (`SEEKER_SHORT` returns `null`);
- the inbox card shows the owner lines and chips once `0006g` is on `main`.

`0007f` replaces the seeker copy. `0007c`'s web half may replace the owner copy.

| key | he |
| --- | --- |
| `match.seeker.lifestyle.agree` | אורח החיים שלך דומה לזה שבדירה |
| `match.seeker.lifestyle.differ` | אורח החיים שלך שונה מזה שבדירה |
| `match.owner.lifestyle.agree` | אורח החיים דומה לזה שבדירה |
| `match.owner.lifestyle.differ` | אורח החיים שונה מזה שבדירה |
| `match.owner.short.lifestyle.agree` | אורח חיים דומה |
| `match.owner.short.lifestyle.differ` | אורח חיים שונה |

The four owner keys are the plural, impersonal owner voice of `0006g`'s `match.owner.area.*`. They are added
together with the `OWNER` entries, by whichever of the two specs merges second.

## Acceptance criteria
**Fixtures for `test_lifestyle_match.py`.**
- Import helpers only from `test_matching.py`: `TODAY` (UTC), `_day`, `_l0`, `_seeker`, `_search`, `_match`,
  `TOP3`, `_area` and `_values`.
- Redefine the pytest fixtures `owner` (a uuid from `make_owner`) and `north` (`_area(db_engine, "north",
  active=True)`) locally. Importing them would be F811.
- `R0` = `_l0(db_engine, owner, gush_dan, listing_type="room", flatmates_count=2, lifestyle={…})`, with
  gender preference `'any'`.
- The seeker is `_seeker(client, outbox, db_engine, gush_dan, gender="woman", lifestyle={…})`: `P0` with a
  woman / any room section.

**Fixtures for `test_inbox.py`.**
- Use its own fixtures and helpers: `owner` (a `TestClient`), `_l0`, `_p0_body`, `_applicants`, `_set_status`,
  `_ok`, `_by_id`, `_user_id`, `_match`, `TOP3`.
- `R` = `_l0(db_engine, _user_id(owner), gush_dan, listing_type="room", flatmates_count=2)`.
- The flat's answers come from the owner's `PATCH /listings/{id}`. A room section comes from the seeker's
  `PUT /me/profile` with `_p0_body(gush_dan, gender="woman", lifestyle=…)`.
- Applications go through `POST /listings/{id}/applications`, so `0007b` writes the snapshot.

**ACs.**
- [ ] AC1 Each row below has a listing (`R0` unless stated) and the seeker described above. Answers are written
  as `listing / seeker`. When the seeker calls `GET /listings/{id}`, Then `match` equals the row exactly, and the
  same listing's item in `GET /listings` carries the same `match`.

  | # | setup | score | differs | agrees |
  | --- | --- | --- | --- | --- |
  | 1 | `{cleanliness 3, night 1, kosher 2}` / `{cleanliness 3, night 3, shabbat 1}`: shared terms 1, 0 → m 0.5 | 90 | `lifestyle` | `TOP3` |
  | 2 | `{guests 2, social 3}` / the same | 100 | null | `[budget, lifestyle, move_in]` |
  | 3 | `{kosher 3}` / `{night 1}`: no shared key → m NULL, unchanged | 100 | null | `TOP3` |
  | 4 | `{cleanliness 3, guests 1, night 2}` / `{cleanliness 3, guests 1, night 3}`: m 2.5/3 → 80 + 16.67 = 96.67 | 97 | `lifestyle` | `TOP3` |
  | 5 | price 7600, answers as row 2: B 75 → 60 + 20 = 80, capped | 59 | `budget` | `[lifestyle, move_in, area]` |
  | 6 | price 7600, area `north`, `{night 1}` / `{night 3}`: B 55 → 44 + 0, below the cap | 44 | `budget` | `[move_in, household, contract]` |
  | 7 | `accepted_households ["family"]`, answers as row 2: B 90 → 72 + 20 (raises the score, Risks Q1) | 92 | `household` | `[budget, lifestyle, move_in]` |
  | 8 | an `L0` **apartment**; seeker answers `{night 1}` | 100 | null | `TOP3` |
  | 9 | answers `{night 1}`; seeker `P0` **without** a room section | 100 | null | `TOP3` |
  | 10 | `available_from` `TODAY` + 37 and `P.parking_needed` 2 (B 92.5); `{cleanliness 3, guests 1, night 1}` / `{cleanliness 3, guests 2, night 2}` (m 2/3): 74 + 13.33 = 87.33 | **87** (88 if B were rounded first) | `lifestyle` | `[budget, area, move_in]` |

  Test: `api/tests/test_lifestyle_match.py::test_ac1_lifestyle_score_and_explanation` (parametrized,
  `LIFESTYLE_ROWS`).
- [ ] AC2 `explain` unit cases, no database:
  - The 4 existing `test_matching.py::test_ac11_explain_rules` cases pass unchanged once `_values()` sets
    `m_lifestyle: None`.
  - New cases on `_values(…)`:
    - `m_lifestyle=1` → agrees `[budget, lifestyle, move_in]`, differs `None`.
    - `m_lifestyle=0.5` → differs `lifestyle`, agrees `TOP3`.
    - `m_lifestyle=0` with `m_household=0` → differs `lifestyle` (gap 20 beats household's 8), and `lifestyle`
      is not in agrees.
    - `m_lifestyle=0` with `f_pets` and `m_pets=0` → differs `pets` (a failing criterion comes first).

  Test: `test_lifestyle_match.py::test_ac2_lifestyle_explain_rules`.
- [ ] AC3 Given `R`, whose flat answers the owner sets with `PATCH` to `{cleanliness: 3, night: 1, kosher: 2}`,
  and a `signup` seeker S with `PUT /me/profile` `_p0_body(gush_dan, gender="woman", lifestyle={cleanliness: 3,
  night: 3, shabbat: 1})`.
  When S applies through the API,
  Then the owner's `GET /listings/{R}/applications` item for S has `match` = `{score: 90, agrees: TOP3, differs:
  "lifestyle"}`, which equals S's own `GET /listings/{R}` `match`, and the shortlist `PATCH` body carries the same
  `match`. The inbox gets the criterion through the shared `match_columns`.

  Test: `api/tests/test_inbox.py::test_ac3_room_applicant_match_includes_lifestyle`.
- [ ] AC4 (security: apartment → room) Given apartment `A` = `_l0(db_engine, _user_id(owner), gush_dan)` and S
  (as in AC3, with answers `{night: 1, guests: 2}`) applied to it through the API. The row's
  `listing_type_at_apply` is `'apartment'`, and the owner's `match` for S is `{100, TOP3, null}`: the baseline.
  When the owner PATCHes A to `{"listing_type": "room", "flatmates_count": 2, "lifestyle": {"night": 3}}`,
  Then:
  - The owner's list item for S, and a status `PATCH` body for S, both still carry the baseline `match`, with no
    `lifestyle` in `agrees` or `differs`.
  - S's own `GET /listings/{A}` `match` is `{80, TOP3, "lifestyle"}` (live: round(0.8 × 100 + 20 × 0)).
  - After each of 6 further owner PATCHes (`lifestyle` = `{night: v}`, then `{guests: v}`, for v = 1, 2, 3), the
    owner's list and status PATCH return the baseline every time.

  Test: `test_inbox.py::test_ac4_apartment_applicant_lifestyle_never_scored_for_owner`.
- [ ] NF1 `make lint` is clean: ruff, mypy --strict, and web eslint / prettier / `tsc` with the `reasons.ts`
  stubs. `make test` is green for api and web, including every existing `test_matching.py`, `test_inbox.py` and
  `reasons.test.ts` test. `make i18n-check` is green with the keys in UI. `make client` regenerates `schema.d.ts`
  with `Criterion` including `lifestyle`.
  CLAUDE.md Speed rule 7 (commit d917d05) has CI e2e switched off (`E2E_IN_CI=off`). This spec touches the web, so
  `make e2e` must be green locally on the final head and reported in the digest.

  Checked by: CI `api` and `web`, plus the local `make e2e`.
- [ ] NF2 Performance, measured by the perf reviewer.
  - Harness: `0007b`'s NF2 harness (5,000 public listings, 2,000 rooms), with every room given 4–7 answers and the
    seeker given all 7.
  - Calls: the same four as `0007b` NF2.
  - Target: p95 ≤ 80 ms each over 50 local requests. That is 2× `0006b`'s 39.5 ms baseline (FOLLOWUPS `0006b`).
    A miss is a perf finding, reported with the `EXPLAIN`.
  - `EXPLAIN (ANALYZE)` of the page shows no `SubPlan`: the lifestyle term is a plain per-row expression.
  - Report the delta against `0007b`'s NF2 numbers (about 28 `->>` extractions and casts per filtered row).
  - The numbers go in the digest.
- [ ] NF3 Privacy:
  - `match` still returns only a score and criterion codes, never an answer.
  - An apartment applicant's owner-side `match` never reflects lifestyle, whatever the listing later becomes.

  Checked by: AC4 and the security reviewer.

## Tests to write
- New `api/tests/test_lifestyle_match.py`: AC1 (integration, dates from UTC `TODAY`) and AC2 (unit).
- `api/tests/test_inbox.py`: AC3 and AC4.
- Amendment to `test_matching.py`: `_values()`.
- Existing tests checked:
  - 0006b's `test_matching.py` AC1–AC10 use apartments only, so nothing changes there.
  - `test_inbox.py` (0004c / 0006c): its applicants have no answers.
  - `0007a`'s `test_inbox.py::test_ac8_room_section_never_in_inbox`: its room has no answers, so `m_lifestyle` is
    NULL.
  - `0007c`'s inbox ACs (`specs/0007c-room-inbox.md`, AC3 and AC4) assume this spec's scores: 80 and differs
    `lifestyle` live, and the baseline on the owner side.
- Web: the `reasons.ts` entries are covered by `tsc`. `0007f` adds the copy tests.
- E2E: no new tests. `make e2e` runs locally (NF1).

## Risks / open questions
- **Q1 decided** (orchestrator, 2026-11-11; Gilad via a digest line): option (a), the contract formula
  `round(0.8·B + 20·m)`. When the answers agree fully, a room with a less than perfect base score gains a few
  points (AC1 row 7: 90 → 92). PRODUCT.md "Rooms" says the questionnaire "only lowers the score"; this decision
  reads that as "soft, never filters". Suggested digest line for Gilad: PRODUCT.md "Rooms" should read "it is a
  soft criterion (weight 20): it can raise or lower a room's score and never filters". The rejected options:
  (b) `least(B, …)` and (c) `B·(0.8 + 0.2·m)` would mean a room owner who answers the questionnaire can only lose
  rank.
- **The explanation shifts on rooms.** With full agreement, `lifestyle` (20) ties `budget` (25 · 0.8) and pushes
  `area` out of the top 3, giving `[budget, lifestyle, move_in]`. Accepted: the explanation follows the score's
  weights.
- **The two sides diverge after a type switch.** After apartment → room, the owner's score for apartment
  applicants leaves lifestyle out, while the seeker's own live view includes it (AC4). This is the same
  divergence as after a price or area edit (B1).
- **One bad stored value breaks scoring.** A non-numeric value under a known key makes `m_lifestyle`'s
  `::numeric` cast fail. It fails for every seeker whose results include that row. `ck_listings_lifestyle` only
  checks `jsonb_typeof`. Only the API writes rows today, so this is accepted. SQL and seed writers must use
  `0007a`'s keys and the values 1–3. The untracked `api/scripts/seed_demo.py` is one of those writers.
- **Overlaps.**
  - `0006f`'s `reasons.ts` is on `main`, so its stub is part of this diff.
  - `0006g` is in review (`spec/0006g-inbox-match-web`). Whichever of `0006g` and this spec merges second adds
    the `OWNER` / `OWNER_SHORT` entries and the four owner keys.
  - `0007f` replaces the seeker stub.
  - Before building, re-check `0006g`'s `OwnerLine` / `OwnerShort` signatures on `main`.

## Digest (filled by orchestrator after verification)

    Spec 0007g - Lifestyle in the match score (API)   (verified, Slice 7, depends on 0007b; split from 0007b at Gilad's word)
    What a user can do after this: a room's match score counts the questionnaire answers the seeker and the flat
             share (weight 20), and "lifestyle" can be a reason; the owner's inbox scores it only on applications
             made to a room, so switching an apartment to a room can't reveal applicants' answers.
    Decisions I need from you: 1. PRODUCT.md "Rooms" says the questionnaire "only lowers" a room's score; the
             formula can also raise a fully agreeing room by a couple of points (90 -> 92). Reword it to "soft,
             weight 20, can raise or lower, never filters"? (recommend: yes - a cap would mean owners who answer
             can only lose rank). The build uses the formula meanwhile.
    KPIs this slice moves: share of room applications with a lifestyle reason.
    Acceptance targets: NF1 lint/test clean + make e2e green locally - NF2 p95 <= 80 ms with the 7-key score in
             the match sort - NF3 no answer values in any response.
    Risks: a non-numeric stored answer would break scoring for every seeker seeing that row - mitigation: only the
             API writes answers (validated 1-3); seed scripts must use the same keys and values.
    Reviewers: code, qa, security, perf   Estimated: 1 coder run (small, Opus/high), 1 review round
    Links: specs/0007g-lifestyle-match-api.md - PRODUCT.md "Rooms", "Matching" - no artboard

## Verifier findings — one round, 7 findings, all applied
The verifier reviewed the original `0007b`. At Gilad's word that spec was split into `0007b` and this file
(finding 1). This record keeps the parts that apply here; `0007b` keeps the rest. The verdict was **would reject
as written** (findings 1–3; finding 2 is here).

**Ruling:** Q1 is decided as (a). It is recorded in Risks with the PRODUCT.md digest line.

**Checked against the code and found correct (no change needed):**
- AC1's 10 rows (the original AC7), recomputed from `score.py` with the `_l0` / `make_profile` defaults (B = 100):
  - Rows 1 and 3 give 90 and 100.
  - Row 2 gives 100, agrees `[budget, lifestyle, move_in]` (a 20 = 20 tie, broken by index).
  - Row 4 gives 96.67, which rounds to 97.
  - Row 5 gives 59, agrees `[lifestyle, move_in, area]`.
  - Row 6 gives 44 (B 55), differs `budget` (gap 20 beats 16).
  - Row 7 gives 92.
  - Rows 8 and 9 give 100.
  - Row 10 gives 87, with gaps 6.67 > 4 > 2 and agrees `[budget, area, move_in]`. Rounding B first would give 88.
- AC2's four cases and the 4 `test_ac11` cases, once `_values()` sets `m_lifestyle: None`.
- AC3 = 90 / `TOP3` / `lifestyle`. AC4's live view = 80 / `TOP3` / `lifestyle`.
- The contract: the `listing_type=` keyword's deviation from "NULL when the listing is not a room" is stated, with
  its security reason. `0007c` reads `match_columns(listing_type=…)` exactly as written here.

**Findings (this file's share):**
1. (major) Too big for one coder run, so it was split. This file carries the lifestyle criterion, the formula,
   the `explain` weights, the inbox keyword and its AC, the web stubs, and the score NF. It `depends_on: [0007b]`,
   because it needs `listing_type_at_apply` and public rooms. `0007c` and `0007f` now depend on this file for the
   criterion; the orchestrator routes their frontmatter. Applied: frontmatter, Goal, Scope, AC1–AC4 (the original
   AC7–AC10), NF1's `Criterion` bullet, NF2 with every room answered, NF3.
2. (major) The web `Criterion` stubs are mandatory and were incomplete:
   - `0006f` is merged (1308156), so the `SEEKER` / `SEEKER_SHORT` stub is now unconditional.
   - `0006g`'s `OWNER` / `OWNER_SHORT` need entries. `OwnerShort` returns `string`, so a `null` stub fails `tsc`.
   - No spec owned the owner-voice copy.

   Applied in Scope "Web" and UI: the owner entries and the four keys, added by whichever of 0006g / 0007g merges
   second. The copy is final unless `0007c`'s web half replaces it, and that line is for the orchestrator to route
   into `0007c`.
4. (minor) Write the rulings in. Applied: Q1 is decided, with the PRODUCT.md "Rooms" digest line.
6. (minor) Fixture imports. Importing pytest fixtures triggers F811, and R0's `owner` in `test_inbox.py` is a
   `TestClient`. Applied in the Fixtures paragraphs: helpers are imported, `owner` / `north` are redefined, and
   `R` = `_l0(db_engine, _user_id(owner), …)`.
7. (minor) NF2's 150 ms bound could not catch a regression. Applied: the bound is now p95 ≤ 80 ms (2× the 39.5 ms
   baseline), with the visitor control (shared with `0007b`). The `?` denominator note is in Data.
8. (minor) A bad stored value breaks the `::numeric` cast. Applied: a Risks line for this half (the
   `ListingPublic` half is in `0007b`).
10. (minor) Stale cross-references. Applied:
    - `0006f` is merged and `0006g` is in review.
    - `0007c` is `specs/0007c-room-inbox.md`.
    - NF1 runs `make e2e` locally per Speed rule 7 (d917d05).
