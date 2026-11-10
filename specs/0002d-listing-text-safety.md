---
id: 0002d
title: Public listing text (city, street, description) and display names can no longer carry invisible filler, private-use or non-characters, lone surrogates or combining-mark stacks, and a city or street must contain a letter or digit
status: verified
depends_on: []           # 0002a, 0002b, 0003a are merged
reviewers: [code, security, qa]   # security: input sanitisation on now-public text; qa: tightens validation on 3 endpoints + validate.ts (Sonnet/medium)
estimate: 1 coder run
---

## Goal
After this ships, nobody can publish a listing whose city, street or description looks blank, hides
characters, or renders as a "Zalgo" smear, and a display name gets the same character rule. Listings are
public since `0003a`, so this closes FOLLOWUPS `0002a` · `api/app/schemas/_text.py` ("visible_characters_only
lets Hangul filler U+3164, braille blank U+2800, non-characters … through"). PRODUCT.md row "Trust (MVP)".

## Scope
**In:**
- `api/app/schemas/_text.py::visible_characters_only(value, *, allow_newlines=False, field="", require_alnum=False)`
  — one shared rule, still used by `schemas/auth.py` (`display_name`) and `schemas/listing.py`
  (`City`, `Street`, `Description`). It rejects, in addition to today's `Cc`, `Cf`, `Zl`, `Zp` (ZWNJ/ZWJ and,
  with `allow_newlines`, `\n` still allowed):
  1. category `Co` (private use: U+E000–U+F8FF, planes 15–16) and `Cs` (lone surrogates);
  2. the 66 Unicode **non-characters**, matched explicitly: U+FDD0–U+FDEF and every code point whose low 16
     bits are `FFFE` or `FFFF` (U+FFFE, U+FFFF, U+1FFFE … U+10FFFF). Category `Cn` is **not** rejected
     wholesale: Python 3.12's `unicodedata` is Unicode 15.0, so a newer emoji (e.g. U+1FAE9, Unicode 16) is
     `Cn` there and must stay accepted;
  3. blank letters: U+115F, U+1160, U+3164 (Hangul fillers), U+FFA0 (halfwidth Hangul filler), U+2800
     (braille blank) — a module-level `frozenset`;
  4. a run of **more than 4** consecutive combining marks (categories `Mn`, `Mc`, `Me`). Only a
     character that is neither a mark nor ZWJ/ZWNJ ends a run: ZWJ/ZWNJ inside a run do **not** reset the
     count. Pointed modern Hebrew is at most 3 marks per letter (dagesh + shin/sin dot + vowel), 4 with
     meteg, so it stays valid; only biblical cantillation goes beyond (out of scope);
  5. with `require_alnum=True`, a value with no character in a letter (`L*`) or number (`N*`) category.
  Error messages (`ValueError`, so the 422 item `type` stays `value_error` and `loc` names the field):
  rules 1–3 reuse today's text "`{field}` contains control or invisible characters"; rule 4
  "`{field}` has too many combining marks in a row"; rule 5 "`{field}` must contain a letter or digit".
- `api/app/schemas/listing.py`: `City` and `Street` pass `require_alnum=True` (a small wrapper like
  `_visible_multiline`, e.g. `_visible_alnum`, each with `field="city"` / `field="street"`);
  `Description` keeps `allow_newlines=True` and no `require_alnum`. `ListingIn` and `ListingPatch` both use
  these annotated types already, so both get the rule. `display_name` (auth) gets rules 1–4, not rule 5.
- `web/src/features/listings/validate.ts`: `INVISIBLE` grows to the same strip set as rules 1–3
  (`\p{Co}`, `\p{Cs}`, the non-character ranges, the five blank letters), so `cleanText` keeps removing them
  silently before publish, exactly as it does today for bidi marks; a city or street with no letter or digit
  after `cleanText` gets the existing `listings.errors.required` error (no new i18n key). The combining-run
  rule is API-only: such a body falls through to the wizard's existing publish-error handling.
- `specs/FOLLOWUPS.md`: tick the `0002a` · `_text.py` entry with "done in 0002d".

**Out:** text already stored (dev data only, no production yet: no data migration, read paths unchanged);
a per-owner total-rows cap and `GET /me` `listing_cap` (FOLLOWUPS `0002a` / `0002b`, later specs); the
auth web (`OtpForm`, signup) mirroring the new display-name rule (a 422 there already shows the generic
form error); profanity or spam filtering (Slice 10).
**New dependencies:** none.

## Data
No table, column or migration change.

## API
No endpoint is added or changed in shape. The rule tightens validation on:

| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | /listings | owner (unchanged) | `ListingIn` | 201 `ListingOut` | 422 `value_error` at `body.city` / `body.street` / `body.description` for the new rules |
| PATCH | /listings/{id} | owner of the listing (unchanged) | `ListingPatch` | 200 `ListingOut` | same 422s |
| POST | /auth/otp/verify (signup: `OtpVerifyIn.profile.display_name`) | public (unchanged) | unchanged | unchanged | 422 `value_error` at `body.profile.display_name` for rules 1–4 |

The 422 handler still never echoes `input` (0002a fix), so a rejected surrogate is not logged or returned.

## UI
No screen changes, no new i18n keys. The listing wizard (`/listings/new`) silently drops the newly stripped
characters, as it already does for bidi marks; a city or street made only of punctuation shows the existing
"required" field error. Artboard: `design/screens-v1/CreateListing.dc.html` (unchanged).

## Acceptance criteria
All non-ASCII test inputs are written as `\uXXXX` / `\UXXXXXXXX` escapes in the tests (and here), never
as literal invisible characters.
- [ ] AC1 Given a private-use char (`\ue000`, `\uf8ff`, `\U000f0000`), a non-character (`\ufdd0`, `\ufffe`,
  `\uffff`, `\U0001ffff`, `\U0010ffff`) or a lone surrogate (`\ud800`) anywhere in the value,
  `visible_characters_only` raises — `api/tests/test_text.py::test_ac1_rejects_private_use_noncharacters_and_surrogates`
  (parametrised; the `Cs` rule is defence in depth for direct callers, see Risks)
- [ ] AC2 Given any of `\u115f`, `\u1160`, `\u3164`, `\uffa0`, `\u2800`, alone or between letters, it raises —
  `api/tests/test_text.py::test_ac2_rejects_blank_letters`
- [ ] AC3 Raise: `"a" + "\u0301" * 5`; `"a" + "\u0301" * 3 + "\u200c" + "\u0301" * 3` (a joiner does not end
  the run). Pass: `"a" + "\u0301" * 4`; `"ש\u05bc\u05c1\u05b8\u05bd"` (shin + dagesh + shin dot +
  qamats + meteg = 4 marks); `"e\u0301"` (decomposed é); `"ש\u05c1\u05b8לו\u05b9ם"`
  (pointed shalom) — `api/tests/test_text.py::test_ac3_combining_runs_capped_at_four`
- [ ] AC4 With `require_alnum=True`, `"..."`, `"-"`, `"\U0001f642"` raise and `"תל אביב"`,
  `"12"`, `"רמת-גן"` pass; without it, `"\U0001f642"` passes —
  `api/tests/test_text.py::test_ac4_require_alnum`
- [ ] AC5 Unchanged behaviour: a ZWJ emoji sequence (`"\U0001f468\u200d\U0001f469\u200d\U0001f467"`), ZWNJ,
  a `\n` with `allow_newlines`, and a Unicode-16 emoji (`\U0001fae9`, `Cn` in Python 3.12) pass; a bidi
  override (`\u202e`) and NUL still raise — `api/tests/test_text.py::test_ac5_existing_rules_unchanged`
- [ ] AC6 `POST /listings` returns 422 with `detail[0]["type"] == "value_error"` and
  `detail[0]["loc"] == ["body", "<field>"]` for: description containing `\u3164`, city `"..."`, street
  containing `\ue000`, description with `"a" + "\u0301" * 5`; and `PATCH /listings/{id}` with city `"\u3164"`
  returns 422 with `loc == ["body", "city"]` and leaves the row unchanged — new parametrised
  `api/tests/test_listings.py::test_ac6_text_rules_are_value_error_at_field` plus
  `api/tests/test_listings.py::test_ac6_patch_rejects_blank_letter_city`
- [ ] AC7 `POST /auth/otp/verify` with a valid code and `profile.display_name` `"ab\u3164"` or
  `"\ue000\ue000"` returns 422 with `type == "value_error"` and `loc == ["body", "profile", "display_name"]`
  (the code stays valid, as `test_ac11_invalid_name_keeps_code_valid` already pins);
  `"דנה"` still succeeds —
  `api/tests/test_auth.py::test_ac7_display_name_rejects_blank_letters_and_private_use`
- [ ] AC8 Web: `cleanText` removes `\u3164`, `\u2800`, `\ue000`, `\uffff` and a lone `\ud800`, keeps ZWJ,
  Hebrew niqqud and `\n` (multiline); `validate` gives `listings.errors.required` for city `"..."` —
  `web/src/features/listings/__tests__/validate.test.ts` `ac8_clean_text_strips_blank_and_private_use`,
  `ac8_city_without_letter_or_digit_is_required`
- [ ] NF1 `make lint` and `make test` clean; the 0002a, 0002b and 0003a tests pass unchanged, including
  `test_listings.py::test_ac4_validation_rejects_bad_input`, `test_listings.py::test_review_lone_surrogate_is_422_not_500`
  (a JSON `"\ud800"` is already a 422 `string_unicode` from pydantic-core, before this validator runs) and
  `test_auth.py::test_ac11_validation_rejects_bad_input`; `make i18n-check` unchanged

## Tests to write
Unit: `api/tests/test_text.py` (new, no DB; AC1–AC5), `validate.test.ts` additions (AC8).
Integration: `test_listings.py` (AC6), `test_auth.py` (AC7), against the spec's own compose stack.
E2E: none new; the existing `listings` e2e must stay green (it publishes plain Hebrew text).

## Risks / open questions
- **Over-rejection** is the real risk, not under-rejection: a legitimate owner pastes text with an
  unusual character and cannot publish. Mitigations: `Cn` is not rejected wholesale (AC5 pins a new emoji);
  the combining cap is 4, the most pointed modern Hebrew uses (AC3); the web strips rules 1–3 silently, so
  the wizard never shows a confusing error for them. Orchestrator assumption (not a Gilad call: no product
  behaviour a user would choose): Apple's logo `\uf8ff` is private use and is rejected.
- A lone surrogate from JSON already fails in pydantic-core (`string_unicode`, pinned by
  `test_review_lone_surrogate_is_422_not_500`); the `Cs` rule only covers direct callers of the helper.
- 0003b (search web) builds at the same time in `../rent-app-0003b`. Overlap is limited to
  `specs/FOLLOWUPS.md` (append-only, keep both sides); 0003b does not touch `validate.ts`. This spec needs
  no `make dev` (no Vite server): use `make dev-api` with its own ports and run vitest via `make test`.

## Verifier findings
One round (2026-11-10): 6 findings, all applied by the orchestrator — old AC7 dropped (already pinned by
`test_review_lone_surrogate_is_422_not_500`, now in NF1) and ACs renumbered; AC3 boundary cases rewritten
(4 marks pass, 5 raise, joiners do not reset); all invisible literals written as escapes; AC6/AC7 name new
tests that assert `type` and `loc`; ZWJ/ZWNJ run rule stated in Scope rule 4; `qa` added to reviewers.

## Digest (filled by orchestrator after verification)

    Spec 0002d - Listing text safety   (verified, API + one web helper, no depends_on)
    What a user can do after this: nobody can publish a listing (or pick a display name) that looks blank, hides
             characters (Hangul filler, braille blank, private-use, non-characters) or renders as a combining-mark
             smear; a city or street must contain a letter or digit. The wizard silently drops the new invisible set.
    Decisions I need from you: none. Assumption: Apple's logo character (private use) is rejected.
    KPIs: none directly; trust hygiene before listings go public in production.
    Acceptance targets: NF1 lint + tests clean, all 0002a/0002b/0003a tests unchanged, no new i18n keys.
    Risks: over-rejecting real text - mitigation: newer emoji stay valid (no blanket Cn), cap 4 marks fits pointed Hebrew.
    Reviewers: code, security, qa   Estimated: 1 coder run, 1 review round
    Links: specs/0002d-listing-text-safety.md, FOLLOWUPS 0002a _text.py entry
