---
id: 0017d
title: "Each waitlist signup records where it came from and who sent it, and every new signup gets a personal link to bring friends"
status: verified         # draft | verified | in-progress | in-review | done
depends_on: [0017, 0017b]   # both merged (PR #116, PR #120)
reviewers: [code, security, qa, ux]   # security: new public input stored next to emails, a new per-person code; qa: endpoint + page; ux: new block on the success screen (verifier added)
estimate: 1 coder run   # coder Opus/high (data + migration, Speed rule 6)
---

## Goal
After this ships, Gilad can see in `make waitlist-stats` which channel (Instagram, TikTok, a Facebook group, a
friend's link) each signup came from. Every person who signs up gets a personal link with a WhatsApp button and
a copy button, and is told that three friends who join from it put them in the first wave. PRODUCT "Waitlist
(0017)".

## Decisions this spec builds on
- Gilad, 2026-11-21 (claude.ai doc "homie — Marketing Upgrade Plan", section "Growing the site", item 2,
  accepted with "start building"):
  - record the source of every signup, with one link per channel;
  - add a referral step after signing up, WhatsApp first;
  - the offer is "three friends who join put you in the first wave".
- The orchestrator chose these, inside that decision:
  - **First touch wins.** A duplicate signup never changes the stored source, campaign or referrer.
  - **Attribution never blocks a signup.** A malformed `source`, `campaign` or `ref` is dropped (stored as
    NULL), never a 400.
  - **A code is random and stored**, 8 characters, never derived from the email. One code per row: a person who
    joins as both seeker and lister has two codes, and joins through either count.
  - **A referral counts only if the code exists**, and only for a new row (a duplicate is not a join).
  - **Codes, never addresses, leave the database.** `waitlist-stats` lists codes with their join counts; it
    never shows an email, a local part or a phone (0017 AC18 rule).
  - **No referral counter on the page in this spec.** The success panel shows the link only; showing "N friends
    joined" needs a read endpoint keyed by the code and is left out (Out).

## Scope
**In:**
1. **Migration `waitlist/migrations/0002_attribution.sql`** (additive; rows from before it keep NULLs):
   ```sql
   ALTER TABLE signups ADD COLUMN source TEXT CHECK (source IS NULL OR (length(source) BETWEEN 1 AND 40));
   ALTER TABLE signups ADD COLUMN campaign TEXT CHECK (campaign IS NULL OR (length(campaign) BETWEEN 1 AND 60));
   ALTER TABLE signups ADD COLUMN ref_code TEXT CHECK (ref_code IS NULL OR length(ref_code) = 8);
   ALTER TABLE signups ADD COLUMN referred_by TEXT CHECK (referred_by IS NULL OR length(referred_by) = 8);
   CREATE UNIQUE INDEX signups_ref_code ON signups (ref_code) WHERE ref_code IS NOT NULL;
   CREATE INDEX signups_referred_by ON signups (referred_by) WHERE referred_by IS NOT NULL;
   ```
   D1 has no down-migration: the file's header comment names the manual rollback (drop the two indexes, then
   recreate the table without the four columns; before launch, `DROP TABLE signups` + `0001` is acceptable, as
   0001 says).
2. **`waitlist/public/validate.js`** gains `normaliseAttribution(body)` → `{source, campaign, ref}`:
   - `source` and `campaign`: trimmed, lower-cased; kept only if they match `^[a-z0-9][a-z0-9_-]*$` and are at
     most 40 / 60 characters; else `null`.
   - `ref`: kept only if it matches `^[a-hjkmnp-z2-9]{8}$` (the code alphabet below); else `null`.
   - `validateSignup` is unchanged: attribution keys are not field errors and never appear in `fields`.
3. **`waitlist/lib/signup.js`** (`handleSignup`), after Turnstile, in place of the current insert:
   - `newRefCode()`: 8 characters from the 31-letter alphabet `abcdefghjkmnpqrstuvwxyz23456789` (no `i`, `l`,
     `o`, `0`, `1`), drawn with `crypto.getRandomValues` and rejection sampling (no modulo bias).
   - `referred_by`: the request's `ref` only when a row with that `ref_code` exists **and that row's email is
     not the signup's email** (one indexed read; Gilad 2026-11-21: a person never counts as their own referral,
     e.g. joining the other side through their own link); otherwise NULL.
   - One statement inserts the row or, on the `(side, email)` conflict, fills only a missing `ref_code`:
     `INSERT INTO signups (side, email, kind, city, neighbourhood, units, available, phone, consent, source,
     campaign, ref_code, referred_by) VALUES (…, 1, ?, ?, ?, ?) ON CONFLICT (side, email) DO UPDATE SET
     ref_code = COALESCE(signups.ref_code, excluded.ref_code) RETURNING ref_code`. No other column changes on
     a duplicate (first touch wins).
   - The statement is run with `.first('ref_code')`, not `.run()`: `RETURNING` rows come back only from a read
     (`.run()` discards them, in D1 and in `fake-d1.js`). The `referred_by` lookup and this statement sit inside
     the existing `try`, so a D1 failure in either is the same 500 + scrubbed log line.
   - If the statement fails on the `signups_ref_code` unique index (a code collision; the error message contains
     `UNIQUE constraint failed: signups.ref_code`, in D1 and in node:sqlite), draw a new code and run
     it again, at most 3 times; then 500 `{error: "server"}` with the scrubbed log line (NF2 of 0017). Any other
     error is not retried. Verified on node:sqlite 3.54: a new row whose code collides raises; a duplicate of a
     row that already has a code never raises (SQLite checks the `(side, email)` conflict target first and the
     `COALESCE` keeps the stored code); a duplicate of a pre-migration row (NULL code) whose new code collides
     raises, and is retried like a new row.
   - Success, new or duplicate: `200 {ok: true, ref: "<code>"}`. The honeypot path answers the same shape with
     a fresh random code that is not stored, so a bot cannot tell it was caught.
4. **`waitlist/public/app.js`**:
   - `submit` adds `source`, `campaign` and `ref` from `window.location.search` (`utm_source`, `utm_campaign`,
     `ref`) to the body; missing params are left out of the body.
   - On a 2xx, `submit` reads the body with `response.json().catch(() => null)`; `ref` is `data?.ref` when it is
     a string, else absent. A body that fails to parse still shows the success panel (as today).
   - `showSuccess(form, email, ref)` fills a new referral block in that panel's `.success` when `ref` matches
     the code pattern; otherwise the block stays hidden and the rest of the success panel shows as today.
   - The link is `${location.origin}/?ref=<code>&utm_source=referral` (no other params carried over).
   - **WhatsApp button**: an `<a>` to `https://wa.me/?text=` + `encodeURIComponent(TEXT.shareMessage + ' ' +
     link)`, `target="_blank"`, `rel="noopener"`.
   - **Copy button**: `navigator.clipboard.writeText(link)`; on success the button text is "הקישור הועתק" for
     2 s and a polite live region announces it; when the clipboard API is missing or throws, the read-only
     link field is selected instead and nothing else changes.
   - A read-only text field shows the link (`dir="ltr"`), so it can be copied by hand.
5. **`waitlist/public/index.html`**: the referral block inside both `.success` panels, hidden by default:
   - a title `<h3>`, a line of text, the read-only link field with a visible `<label>`, the WhatsApp link, the
     copy button, an `aria-live="polite"` status element and the privacy note (`.refer__privacy`, UI).
   - Classes follow the page's BEM style (`.refer`, `.refer__title`, `.refer__link`, `.refer__actions`); styles
     in `styles.css`, logical properties only.
6. **`waitlist/stats.sql`** gains, in the same one-statement `UNION ALL` shape (still no `;`, `$`, backtick or
   `"`). The column list grows by three at the end: `summary, side, kind, city, available, signups, units,
   source, campaign, code` (the five existing summaries select NULL for the new three). The final `ORDER BY`
   becomes `ORDER BY 1, 2, 3, 4, 5, 6 DESC, 8, 9, 10` (checked on node:sqlite; the existing summaries' order is unchanged: their columns 1–5
   are already unique per row).
   - `by_source`: per side, source and campaign, the count in `signups`; `side` filled, `source` =
     `COALESCE(source, 'direct')`, `campaign` = `COALESCE(campaign, '-')`.
   - `referrals`: one row, `signups` = the number of rows with a `referred_by`.
   - `top_referrers`: `code` and `signups` only, from a subquery in `FROM` (`SELECT referred_by AS code,
     COUNT(*) AS n FROM signups WHERE referred_by IS NOT NULL GROUP BY referred_by HAVING COUNT(*) >= 3
     ORDER BY n DESC, code LIMIT 20`); ties are in code order (a `LIMIT` cannot sit on one branch of a
     compound `SELECT` without the subquery, and the outer `ORDER BY` decides the printed order).
7. **`waitlist/test/fake-d1.js`**: `migratedDatabase()` applies every file in `waitlist/migrations/` in name
   order (today it reads only `0001`), so the tests run the real schema.
8. **`waitlist/README.md`**: a "Sources and referrals" section: the links to use per channel
   (`/?utm_source=instagram`, `/?utm_source=tiktok`, `/?utm_source=facebook&utm_campaign=<group-slug>`), what
   the stats rows mean, and that `make waitlist-migrate` must run before `make deploy-waitlist` (the new page
   sends fields the old schema has no columns for; the Function, not the page, writes them, so the order
   matters for the Function only).
9. **`specs/0017c-waitlist-hardening.md`**: its frontmatter comment's "may split C out as 0017d" becomes
   "0017e" (this spec took the id). One line, docs only.

**Out:**
- A referral counter on the page or any endpoint that reads by code (later, with a rate limit).
- Emailing the first wave, exporting who qualifies with their addresses (the launch-email spec; `0017c` holds
  the export).
- Per-reel links: Instagram and TikTok allow one bio link, so tracking is per channel.
- Changes to the counter, Turnstile, the origin guards or the CSP (none needed: `wa.me` is a navigation, not a
  fetch, and the clipboard API needs no CSP source).

**New dependencies:** none.

## Data
`signups` gains `source`, `campaign`, `ref_code`, `referred_by` (all nullable TEXT) and two partial indexes, in
`waitlist/migrations/0002_attribution.sql`. Backwards compatible: the deployed Function from 0017b keeps
working on the migrated table (it names its columns), so migrating first is safe. Rows from before the
migration have no code; such a person signing up again gets one (the `COALESCE` above).

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/signup` | public; origin, size, type, honeypot and Turnstile guards unchanged (0017, 0017b) | 0017's body plus optional `source`, `campaign`, `ref` (strings) | `200 {ok: true, ref: "<8 chars>"}` for a new signup, a duplicate and a caught bot alike | unchanged: 400 `invalid`, 403 `origin`/`challenge`, 413, 415, 500/503 `server` |

`GET /api/count` is unchanged.

## UI
The waitlist page's two success panels (`waitlist/public/index.html`, `.success`); no app artboard covers the
waitlist page, so the existing success panel's look (card, Fredoka title, turtle) is the reference.
- **Success with a code:** the current title, line and "other side" button, then the referral block:
  - title: "רוצים להיכנס בגל הראשון?"
  - line: "שלושה חברים שנרשמים מהקישור שלכם, ואתם בגל הראשון."
  - privacy note under the buttons (`.refer__privacy`, small text like `.privacy`): "נשמור מי נרשם מהקישור
    שלכם, רק כדי לצרף אתכם לגל הראשון." (Gilad 2026-11-21: the forms' privacy line stays as it is; the
    referral block gets its own line)
  - link field label: "הקישור שלכם"
  - WhatsApp button: "שליחה בוואטסאפ"
  - copy button: "העתקת הקישור" → "הקישור הועתק" (2 s)
  - WhatsApp message (`TEXT.shareMessage`): "מצאתי את הומי: דירות ושותפים ישר מאנשים פרטיים, בלי מתווכים
    ובחינם. נרשמים לרשימת ההמתנה כאן:"
- **Success without a code** (an answer without `ref`, e.g. an old Function still deployed): exactly today's
  panel.
- RTL: the link field is `dir="ltr"` inside the RTL card; buttons sit in a row that wraps under 360 px. Logical
  properties only. Gender-neutral plural in every line (brand voice).
- Strings live in `app.js`'s `TEXT` and in `index.html`, as for the rest of this page (hard rule 4 covers
  `web/`; the waitlist page is outside it, as in 0017).

## Acceptance criteria
- [ ] AC1 Given a valid new signup with `source: "Instagram"`, `campaign: "bio"`, then 200 `{ok: true, ref}`,
  `ref` matches `^[a-hjkmnp-z2-9]{8}$`, and the row stores `source = "instagram"`, `campaign = "bio"`,
  `ref_code = ref`, `referred_by = NULL` — `waitlist/test/signup.test.js::ac1d_stores_source_and_code`
- [ ] AC2 Given `source` values `"a b"`, `"<x>"`, 41 characters, a number, and `ref` values `"ABCDEFGH"`,
  `"abcdefg"`, `"abcdefgl"` (`l` is not in the alphabet), then 200, a row, and those columns NULL; `fields` is
  never sent for them — `…::ac2d_bad_attribution_is_dropped` (table-driven)
- [ ] AC3 Given A signed up (code `A`), when B signs up with `ref: A`, then B's `referred_by = A`. When C signs
  up with a well-formed code no row has, `referred_by` is NULL. When A joins the other side with the same email
  and `ref: A` (A's own code), that new row's `referred_by` is NULL — `…::ac3d_referral_only_for_existing_code`
- [ ] AC4 Given A signed up with `source: "tiktok"`, when the same side and email sign up again with
  `source: "instagram"` and `ref: <B's code>`, then 200 with A's original code, and A's row is unchanged
  (source still `tiktok`, `referred_by` still NULL); the row count is unchanged —
  `…::ac4d_duplicate_returns_same_code_first_touch_wins`
- [ ] AC5 Given a row inserted without a code (as before the migration), when that side and email sign up
  again, then a code is stored and returned, and no other column changes — `…::ac5d_old_row_gets_a_code`
- [ ] AC6 The response bodies for a new signup, a duplicate and a filled honeypot have the same keys and value
  types; the honeypot's code is not in the table — `…::ac6d_no_enumeration_by_shape`
- [ ] AC7 Given the code generator returns a code already stored, then the handler retries with a new one and
  stores it; given it collides 3 times, then 500 `server`, no row, and the log line holds no email or phone
  (`newRefCode` injectable for the test) — `…::ac7d_code_collision_retries`
- [ ] AC8 `newRefCode()` over 10,000 draws: every code matches the pattern, and each of the 31 letters appears
  at every position (no letter missing) — `…::ac8d_code_alphabet`
- [ ] AC9 `stats.sql` on a seeded database shows `by_source` per side/source/campaign with `direct` and `-` for
  NULLs, `referrals` with the right total, and `top_referrers` listing only codes with 3+ joins; no output
  cell contains `@`, a seeded email's local part or a seeded phone — `waitlist/test/stats.test.js::ac9d_sources_and_referrals`
- [ ] AC10 The migrations apply in order on an empty database and on a database holding 0001-era rows, which
  keep their data with the new columns NULL — `waitlist/test/stats.test.js::ac10d_migration_additive`
- [ ] AC11 Page: opened at `/?utm_source=instagram&utm_campaign=bio&ref=abcdefgh`, a seeker submit sends those
  three values; opened at `/`, the body has none of the three keys —
  `web/e2e/waitlist/waitlist.waitlist.ts::ac11d_sends_attribution`
- [ ] AC12 Page: a stubbed 200 `{ok: true, ref: "k7m2pq9x"}` shows the referral block with the link
  `<origin>/?ref=k7m2pq9x&utm_source=referral`, a WhatsApp link whose `text` decodes to the share message plus
  that link, and the copy button; clicking copy writes the link to the clipboard (Playwright clipboard
  permission) and shows "הקישור הועתק"; the block's privacy note reads exactly "נשמור מי נרשם מהקישור שלכם,
  רק כדי לצרף אתכם לגל הראשון."; the forms' privacy line is unchanged; a stubbed `{ok: true}` shows today's
  success panel with the block hidden — `…::ac12d_referral_block`
- [ ] AC13 Page: with `navigator.clipboard` removed, clicking copy selects the link field's text and throws
  nothing — `…::ac13d_copy_fallback`
- [ ] NF1 axe stays clean in the success state with the referral block at 375 and 1280; the block's buttons are
  keyboard reachable in order (field, WhatsApp, copy) — `…::ac16_axe_and_reduced_motion` (extended)
- [ ] NF2 0017's and 0017b's tests still pass; the shared success-path assertions accept the new `ref` key —
  `make test-waitlist`
- [ ] NF3 No new request leaves the page: the foreign-request guard stays as in 0017b (the WhatsApp link is
  never followed in tests) — `…::ac17_no_third_party_requests`

## Tests to write
Unit: extend `waitlist/test/signup.test.js` (AC1–AC8, fetch stubbed as in 0017b) and `waitlist/test/stats.test.js`
(AC9–AC10) on node:sqlite via `fake-d1.js`, which now applies all migrations. Page: extend
`web/e2e/waitlist/waitlist.waitlist.ts` (AC11–AC13, NF1, NF3). All run in `make test-waitlist`; nothing runs
`make e2e` locally (Speed rule 7).

**Existing tests that change (NF2):**
- `waitlist/test/signup.test.js`: the exact `assert.deepEqual(json, { ok: true })` in `ac1_seeker_signup_stored`
  (l. 96), `ac3_duplicate_is_silent_and_sides_independent` (l. 148), `ac5_honeypot_drops_silently` (l. 213) and
  `ac1b_turnstile_ok_stores` (l. 481) become `{ok: true, ref: <a string matching the code pattern>}`.
- `waitlist/test/signup.test.js::ac8_db_failure_logged_without_pii`: its failing fake has only `bind().run()`;
  it gains `bind().first()` throwing the same error, so the test still proves the scrub (not a `TypeError`).
- `waitlist/test/stats.test.js::ac18_stats_query`: the exact column list (l. 47) gains `source, campaign, code`;
  its `blank` row and the exact summary set (l. 56) gain the three new columns and three new summaries.
- `web/e2e/waitlist/waitlist.waitlist.ts`: no change needed. `ac12_success_and_other_side`'s exact body
  assertion opens `/`, so no attribution key is added; its stub answers `{ok: true}`, which is the "without a
  code" panel. `ac6b_token_sent` uses `objectContaining`. `ac16_axe_and_reduced_motion` is extended (NF1).

## Decisions from Gilad (2026-11-21, answers to the verifier's findings)
1. **Privacy line:** keep the forms' line as it is and add a line inside the referral block (UI, AC12).
2. **Duplicate path:** accepted. A repeat signup gets back its stored code so nobody loses their link; the
   resulting "this email owns this link" signal is documented below and costs a Turnstile solve per guess,
   and a wrong guess signs that address up.
3. **Self-referral:** blocked. `referred_by` stays NULL when the referrer row has the same email (Scope 3, AC3).

## Risks / open questions
- **Gaming the offer.** One person can sign up fake addresses through their own link. Turnstile slows it, and
  the stats list shows the codes with 3+ joins, so Gilad can eyeball them before inviting anyone. Who actually
  gets the first-wave invite is decided when the launch email is specced, not here. Not blocking.
- **"First wave" is a promise on the page.** It matches PRODUCT's phased beta (people with a place invited two
  weeks before seekers). The orchestrator reads "first wave" as "the first group invited from your side".
  Gilad can change the line before deploy; the wording is one string. Not blocking.
- **Privacy:** `referred_by` links two signups. No email leaves the database, and deleting a person
  (`make waitlist-delete`) removes their row; rows they referred keep the dangling code, which no longer points
  at anyone. The page's consent line is unchanged; the privacy text in the app (0013f) does not cover the
  waitlist. The verifier checks whether the page needs a line on this; if so it is a question for Gilad.
  **Verifier (2026-11-21): yes; answered by Gilad 2026-11-21 (Decisions 1).** The privacy line
  under both forms says "שומרים רק את מה שמילאתם כאן, כדי לעדכן על ההשקה ולדעת כמה מחכים בכל עיר". After this
  spec that is no longer true: `source`, `campaign` and `referred_by` are not filled in by the person, and the
  referral count is a new purpose (who gets into the first wave).
- **Accepted by Gilad 2026-11-21 (Decisions 2): the duplicate path confirms "this email owns
  this link".** A referral link is shared in WhatsApp groups, so its code is semi-public. Anyone who has a link
  can submit a guessed email on that side: the answer is the same code exactly when that email is already on the
  list and owns the link. A wrong guess signs that address up (as any submit already does) and returns another
  code. AC6 (same shape) holds, but the value is an oracle for someone who already holds a code. Cost per guess:
  a Turnstile solve, and the zone rate limit once the domain exists.
- **D1 `RETURNING` on `ON CONFLICT DO UPDATE`:** supported by SQLite 3.35+ and D1 (the coder confirms against
  Cloudflare's docs and notes it in the PR); node:sqlite in Node 22 supports it, so the unit tests run it.
- **Deploy order:** `make waitlist-migrate` then `make deploy-waitlist`; the new Function on the old schema
  would 500 on every signup. README step (Scope 8); the orchestrator repeats it in the digest.

## Blast radius
From grep (graphify's graph has no `waitlist/` nodes; no graphify binary in the verifier's checkout).
- `handleSignup` (`waitlist/lib/signup.js`): called by `waitlist/functions/api/signup.js` (untouched: it only
  passes `request, env`); tested by `waitlist/test/signup.test.js` (ac1–ac6, ac8, ac1b–ac5b; in Scope via
  "Existing tests that change").
- `validate.js` (`validateSignup` unchanged; `normaliseAttribution` new): imported by `lib/signup.js` (Scope 3),
  `public/app.js` (Scope 4), `waitlist/delete.mjs` (`normaliseEmail` only; untouched) and
  `test/signup.test.js` (`ac9_single_validation_source`; untouched, `validateSignup` keeps its shape).
- `showSuccess` / `submit` (`waitlist/public/app.js`): internal to `app.js`; `showSuccess`'s one caller is
  `submit`. Exercised by every e2e test that submits (ac10–ac17, ac6b–ac9b in
  `web/e2e/waitlist/waitlist.waitlist.ts`); all stub `{ok: true}` and open `/`, so they keep passing unchanged.
- `index.html` `.success` panels: read by `app.js` (`showSuccess`, `joinOtherSide`) and the e2e success
  assertions (`ac12_success_and_other_side`, `ac16_axe_and_reduced_motion`); the new block is hidden by default.
- `migratedDatabase` / `MIGRATION` (`waitlist/test/fake-d1.js`): used by `fakeD1` (`signup.test.js`),
  `stats.test.js` and `delete.test.js`. `MIGRATION` has no importer outside `fake-d1.js`; it may become a list.
  `delete.test.js` inserts by column name and keeps passing on the migrated schema.
- `signups` table (new columns): written by `lib/signup.js`; read by `stats.sql`, `delete.mjs` (deletes by
  `hex(email)`: untouched, a deleted referrer leaves a dangling `referred_by`, see Risks) and the tests'
  direct `INSERT`s (by column name; untouched).
- `stats.sql`: read by the `Makefile`'s `waitlist-stats` (`--command "$$(cat stats.sql)"`; untouched, the
  no-`;`/`$`/backtick/`"` rule kept) and `test/stats.test.js::ac18_stats_query` (in Scope, see above).
- `specs/0017c-waitlist-hardening.md`: its frontmatter comment (Scope 9). Its Part B also extends `stats.sql`
  in the same shape and Part C makes every summary count confirmed rows; 0017c is draft and not queued, so
  whoever re-verifies it rebases those parts on this spec's ten-column `stats.sql`. Its Part A export
  (`d1 export`) takes the whole table and needs no change.

## Digest (filled by orchestrator after verification)
```
Spec 0017d — Waitlist signups record their source and referrer; every signup gets a personal invite link   (verified, 1 part)
What a user can do after this: after joining the waitlist, share a personal link by WhatsApp or copy; Gilad sees signups per channel and per referrer in make waitlist-stats.
Decisions I need from you: none (answered 2026-11-21: keep the forms' privacy line + a line in the referral block; accept the duplicate-path signal; block self-referral).
KPIs this slice moves: signups per week by source; share of signups that came by referral (target above 20%).
Acceptance targets: axe clean at 375 and 1280 with the referral block (NF1); 0017/0017b tests still green (NF2); no new third-party request from the page (NF3); code alphabet 31 letters, 8 chars, retry on collision up to 3.
Risks: fake signups through one's own link — Turnstile + the 3+ list is eyeballed before any invite; deploy order — make waitlist-migrate before make deploy-waitlist (README).
Reviewers: code, security, qa, ux   Estimated: 1 coder run, 1 review round
Links: specs/0017d-waitlist-sources-referrals.md · PRODUCT "Waitlist (0017)" · claude.ai doc "homie — Marketing Upgrade Plan" (Growing the site, item 2) · no artboard (waitlist page's own success panel)
```

## Verifier findings (2026-11-21)
Verdict: **not verified** (checklist 9: two open questions the coder would have to guess; both are Gilad's under
Speed rule 9). Every other line of the checklist passes after the corrections listed below. Once Gilad answers
1 and 2 and the answers are written into Scope/UI/ACs, a re-verification only needs to check those edits.

1. **Privacy line (Gilad).** The page's privacy line (`index.html` l. 154 and l. 229, both forms) becomes untrue:
   it says only what was filled in is kept, and names two purposes, neither of which is the referral count.
   The spec gives no new line, so the coder would have to write one. Options:
   (a) change the line, e.g. "שומרים את מה שמילאתם כאן, מאיפה הגעתם ומי הזמין אתכם, כדי לעדכן על ההשקה,
   לדעת כמה מחכים בכל עיר ולצרף לגל הראשון את מי שהביאו חברים. לא מעבירים לאף אחד. …" (the rest unchanged);
   (b) keep the line and add a second short line in the referral block only;
   (c) leave the page as is.
   Verifier recommends (a): it is one string per form, and Israel's privacy law expects the stated purposes to
   match what is stored. Whichever he picks, the exact string goes into UI and an AC (the e2e can assert it).
2. **Code-to-email oracle on the duplicate path (Gilad, security trade-off).** See Risks. Options:
   (a) accept and document it: the link is shared with the sender's name anyway, every guess costs a Turnstile
   solve and signs the guessed address up; no code change;
   (b) a duplicate gets a fresh code that is not stored (as the honeypot): no oracle, but someone who signs up
   again to find their link gets a link that never counts, and AC4/AC5 change;
   (c) a duplicate gets no referral block (`{ok: true}` without `ref`): no oracle, but the shape differs from a
   new signup, which re-opens the enumeration 0017 closed; not recommended.
   Verifier recommends (a), written into Risks as accepted.
3. Non-blocking, for the same message to Gilad: a person can refer themself across sides (open their own
   lister link, join as a seeker with the same email) and count as one of their own three. One line fixes it
   (`referred_by` NULL when the referrer row has the same email). Falls under "Gaming the offer"; the
   orchestrator may decide it with 1 and 2 or leave it to the launch-email spec.

**Corrections the verifier applied (no product change):**
- Scope 3: the upsert runs with `.first('ref_code')` (`.run()` drops `RETURNING` rows in D1 and in
  `fake-d1.js`); the lookup and upsert sit inside the existing `try`; a collision is recognised by
  `UNIQUE constraint failed: signups.ref_code` and only that is retried. The SQL was run on node:sqlite 3.54:
  `ADD COLUMN … CHECK` works on a table with rows; a new row with a colliding code raises; a duplicate of a row
  with a code never raises and returns the stored code; a duplicate of a pre-migration row whose new code
  collides raises and is retried.
- Scope 4: the 2xx body is read with `.json().catch(() => null)`; an unparsable body shows today's panel.
- Scope 6: `stats.sql` had no columns for source, campaign or code in its fixed seven-column shape; it now names
  three new trailing columns, the `top_referrers` subquery with its `LIMIT`, and the final `ORDER BY` (checked on
  node:sqlite). "Newest first on ties" became code order: the output has no column to sort by age.
- Tests to write: listed the existing assertions that must change (`signup.test.js` l. 96, 148, 213, 481 and
  `ac8`'s fake; `stats.test.js` l. 47 and 56) and that the e2e `ac12` exact-body assertion needs no change.
- `## Blast radius` filled from grep.
- `reviewers:` gains `ux` (a new block with three controls on the success screen; checklist 8).
- Checked, no change: the alphabet `abcdefghjkmnpqrstuvwxyz23456789` has 31 letters and equals the regex
  `^[a-hjkmnp-z2-9]{8}$` (8 + 2 + 2 + 11 + 8); AC8's "every letter at every position" over 10,000 draws fails
  by chance with probability far below 1e-100; Scope 9's 0017c line exists as quoted; nothing contradicts PRODUCT
  "Waitlist (0017)".

## Verifier notes (2026-11-21, round 2)
Re-checked only Gilad's answers (section "Decisions from Gilad"): findings 1–3 are closed.
- 1: the forms' privacy line is unchanged; the referral block's note has its exact string in UI and AC12.
  Corrected: Scope 5's element list now names the note (`.refer__privacy`), so the HTML and the UI agree.
- 2: the duplicate-path signal is written into Risks as accepted; no AC changes (AC4–AC6 stand).
- 3: Scope 3's `referred_by` rule excludes a referrer row with the same email, and AC3 tests it. The lookup
  reads the referrer's `email` by `ref_code` (same indexed read) and compares it with the normalised email.
