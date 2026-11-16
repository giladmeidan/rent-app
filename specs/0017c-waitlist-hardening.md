---
id: 0017c
title: "Gilad can back up the waitlist and spot junk signups; optionally, a signup counts only once its owner confirms the email"
status: draft            # not queued for build (Gilad, 2026-11-16: "no need to build"); Part C needs his decision first
depends_on: [0017, 0017b]   # both merged (PR #116, PR #120)
reviewers: [code, security, qa]   # security: PII export, email tokens; qa: endpoint + page (Part C)
estimate: 1 coder run   # A+B are small; with C it is one full run. The verifier may split C out as 0017d
---

## Goal
After this ships, Gilad can take a local backup of the waitlist with one command, and `waitlist-stats` shows
whether junk signups are coming in. **Part C (optional, held):** a signup counts, in the counter and in the
stats, only after the owner of the email clicks a confirmation link, so nobody can sign up someone else's address.
PRODUCT "Waitlist (0017)".

## Decisions this spec builds on
- Gilad, 2026-11-16 ("keep it manual", "write the 0017c spec, no need to build"): the waitlist stays a Pages
  project, deployed by hand. This spec is written and logged but **not queued**.
- **Part C is held. Gilad finds email confirmation "a bit excessive" but wants it kept in the spec.** It is
  built only if he says so before the build. If he drops it, Parts A and B ship alone, and Part C's sections are
  deleted at verification.
- Why Part C exists (orchestrator, 2026-11-16):
  - Today anyone can enter any email, which inflates the numbers.
  - The launch email would then reach people who never signed up, and they may mark it as spam, which hurts
    delivery for the real app.
  - Israel's anti-spam law expects consent from the address's owner, and a confirmation click is proof of it.
- The following are out of scope here, because they are not code:
  - 2FA on Gilad's Cloudflare and GitHub accounts (FOLLOWUPS);
  - the rate-limit rule, which waits for a domain (FOLLOWUPS);
  - moving to Workers, which Gilad declined.

## Scope
### Part A: backup
- `make waitlist-export`: `pnpm dlx wrangler@$(WRANGLER_VERSION) d1 export homie-waitlist --remote --output
  waitlist/.exports/waitlist-$(date -u +%Y%m%dT%H%M%SZ).sql`.
  - It creates `waitlist/.exports/` with mode `700` and sets the file to mode `600` (`chmod`), then prints only
    the path and the row count, never the file's contents.
  - `waitlist/.exports/` goes in `.gitignore`. A test asserts the pattern is there, so an export can never be
    committed.
- README: a "Backup" section. Run it weekly by hand and keep the files off shared drives. Restore with
  `wrangler d1 execute homie-waitlist --remote --file <export>` on an empty database, after `DROP TABLE signups`.
  Restore is a manual step that the README spells out and no make target runs.

### Part B: junk check
`waitlist/stats.sql` gains three summaries in the same one-`UNION ALL` query shape (0017 verifier note 9):
- `email_domain`: the domain part of `email` (`substr(email, instr(email, '@') + 1)`), with its count, **only for
  domains with 3 or more signups**, top 10. A domain is not an address, and the threshold hides one-person
  domains.
- `last_24h`: the count of signups whose `created_at` is in the last 24 hours, per side.
- `per_hour_48h`: signups per hour over the last 48 hours (`strftime('%Y-%m-%dT%H', created_at)`), only for
  hours with any signups.

No column or summary may contain a full email, a local part or a phone number (0017's AC18 rule extends to the
new rows).

### Part C: email confirmation (held, see Decisions)
- **Migration `waitlist/migrations/0002_confirmation.sql`:** `ALTER TABLE signups ADD COLUMN confirmed_at TEXT;
  ADD COLUMN confirm_hash TEXT; ADD COLUMN confirm_sent_at TEXT;`, plus a unique index on `confirm_hash`.
  - Rows that exist before the migration keep `confirmed_at = NULL`. What happens to them is open question Q2.
  - The migration is additive, and the page and Functions from 0017b keep working until the deploy.
- **Signup** (`POST /api/signup`, after Turnstile):
  - On a new row: store `sha256(token)` in `confirm_hash`, where `token` is 32 random bytes from
    `crypto.getRandomValues`, base64url. Then send one email, set `confirm_sent_at`, and return
    `200 {"ok": true}` as now.
  - On a duplicate (side, email) that is not yet confirmed: send again only if `confirm_sent_at` is more than
    24 hours ago, with a new token, which replaces the old hash. Otherwise send nothing. The response is the
    same in every case, so it still never reveals whether an email is on the list.
- **Email:** Hebrew, RTL, plain text + a minimal HTML part.
  - Subject: "אישור הרשמה לרשימת ההמתנה של הומי".
  - Body: one line, then a link to `https://<site>/confirm.html#t=<token>`. The token sits in the fragment, so
    it never reaches server logs or `Referer` headers. A footer line follows: "לא נרשמתם? אפשר להתעלם מהמייל
    הזה."
  - The sender is open question Q1. If sending fails, the row is still stored, the response is still 200, and
    the failure is logged without the address. The person can sign up again after 24 hours to get a new email.
- **`POST /api/confirm` `{token}`:** hash it and look it up. A match on an unconfirmed row sets `confirmed_at` and
  clears `confirm_hash`, and returns `200 {"ok": true}`. Anything else returns `400 {"error": "token"}`. The same
  origin and host guards and the same 4 KB limit apply as for signup.
  - Tokens expire after 7 days: a lookup with `confirm_sent_at` older than that is a 400.
  - The confirm step is a POST from a page, not a GET link, because mail scanners follow GET links and would
    confirm on the owner's behalf.
- **`public/confirm.html` + `confirm.js`:** reads `#t=` and POSTs it. Its states:
  - loading: "מאשרים…";
  - success, with the celebrate turtle: "ההרשמה אושרה. נעדכן ברגע שהומי עולה לאוויר.";
  - error: "הקישור לא תקין או שפג תוקפו. אפשר להירשם שוב מהעמוד הראשי.", with a link to `/`;
  - no token at all: the same error.
  The page follows the brand kit, the same CSP, `dir=rtl` and logical CSS only.
- **Join page success text** changes to "שלחנו מייל ל-{email}. נשאר רק ללחוץ על הקישור שבו." The rest of the
  success state stays.
- **Counter and stats:** `/api/count` counts `confirmed_at IS NOT NULL` only. Every `stats.sql` summary gains a
  `confirmed` / `unconfirmed` split.
- **Clean-up:** `make waitlist-purge-unconfirmed` deletes rows still unconfirmed 14 days after `created_at`, and
  prints the count first and asks y/N, like `waitlist-delete`. It is run by hand.
- **Privacy line:** append "נשלח מייל אחד לאישור, ולא נשמור כתובת שלא אושרה יותר משבועיים."

**Out:** a cron or scheduled export (Pages has no cron; by hand is enough for now), a disposable-email
blocklist, an email sent at launch (its own later spec), the rate-limit rule (FOLLOWUPS) and the custom domain.

**New dependencies:** none for A and B. Part C needs an email-sending service, which is open question Q1. A paid
service, or a new one with long-term weight, is Gilad's call (Speed rule 9).

## Data
- A + B: no change.
- C: migration `0002_confirmation.sql` as above. It is additive, and D1 has no down migration (0017). Rollback:
  drop the three columns with a manual `ALTER TABLE … DROP COLUMN`, written in the README.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/signup` | as 0017b | as 0017b | `200 {"ok": true}` (C: also sends or re-sends the confirmation email) | as 0017b |
| POST | `/api/confirm` (C) | Public, anonymous. Same origin and host guards and 4 KB limit as signup. The token is the only credential | `{token: string}` (43 characters, base64url) | `200 {"ok": true}` | `400 {"error": "token"}` (unknown, used or expired) · `403 {"error": "origin"}` · `413` · `415` · `500 {"error": "server"}` |
| GET | `/api/count` | as 0017 | — | C: counts confirmed rows only | as 0017 |

## UI
- A + B: no UI.
- C: `confirm.html` (new) and the join success text (changed), as described in Part C. The states are listed
  there. RTL and logical CSS only, and the strings are written in the HTML as in 0017 (hard rule 4 covers `web/`
  only).

## Acceptance criteria
- [ ] AC1 `make waitlist-export`'s command line, built by the Makefile, targets `waitlist/.exports/` with a UTC
  timestamp; `.gitignore` holds `waitlist/.exports/` — `waitlist/test/export.test.js::ac1c_export_target_and_ignore`
- [ ] AC2 Given fixture rows, `stats.sql` returns `email_domain` only for domains with 3 or more signups (top 10),
  `last_24h` per side and `per_hour_48h`, and no cell holds an `@`, a local part or a phone —
  `waitlist/test/stats.test.js::ac2c_junk_summaries`
- [ ] AC3 (C) A new signup stores a hash, never the token, and calls the mail stub once with a link whose
  fragment hashes to the stored value — `waitlist/test/confirm.test.js::ac3c_signup_sends_once`
- [ ] AC4 (C) A duplicate unconfirmed signup within 24 h sends nothing; after 24 h it sends a new token and the
  old one stops working; a confirmed duplicate never sends; every response is identical —
  `…::ac4c_resend_rules`
- [ ] AC5 (C) `POST /api/confirm` with the right token confirms once; a second use, a wrong token, a token older
  than 7 days, or a bad origin is refused as in the table — `…::ac5c_confirm`
- [ ] AC6 (C) A mail stub that throws still gives a 200 and a stored row, and the log line holds no address —
  `…::ac6c_mail_failure_keeps_row`
- [ ] AC7 (C) `/api/count` and `stats.sql` count confirmed rows only, with the confirmed/unconfirmed split —
  `…::ac7c_counts_confirmed_only`
- [ ] AC8 (C) Page: `confirm.html` shows success on a stubbed 200, the error state on a 400 and when no token is
  given, sends the token from the fragment only, and is axe-clean at 375 and 1280 px —
  `web/e2e/waitlist/waitlist.waitlist.ts::ac8c_confirm_page`
- [ ] AC9 (C) `waitlist-purge-unconfirmed` deletes only rows unconfirmed and older than 14 days, after a y/N
  prompt — `waitlist/test/delete.test.js::ac9c_purge_unconfirmed`

## Tests to write
- Unit (`node --test`): `export.test.js` (new), `stats.test.js` (extended), `confirm.test.js` (new, Part C, with
  `globalThis.fetch` stubbed for the mail API as 0017b stubs siteverify) and `delete.test.js` (extended).
- Page: `waitlist.waitlist.ts` (extended, Part C).

## Risks / open questions
- **Q0 (Gilad, blocks `verified`): build Part C at all?** He finds it "a bit excessive". Options:
  - (a) build it;
  - (b) drop it, ship A + B only, and rely on Turnstile while cleaning junk by hand with `waitlist-stats` +
    `waitlist-delete`;
  - (c) postpone it to the launch email: send one "do you still want updates?" email then, and keep only those
    who click.

  Recommendation: (c). It keeps today's signup flow, needs the email sender only once at launch, and still
  ends with a list of confirmed owners before any marketing email goes out.
- **Q1 (Gilad, Part C only): email sender.** Options:
  - (a) Cloudflare Email Sending, if available on the account (the wrangler token shows an `email_sending`
    scope). Pages Functions cannot use the Email Workers binding, so the coder confirms there is an HTTP API
    first;
  - (b) the provider 0013a picks for the app's sign-in codes, so homie has one sender and one domain to verify;
  - (c) another free-tier HTTP mail API.

  Sending from a `pages.dev` address is not possible. Any option needs a sending domain, which is the same
  domain blocker as the rate-limit rule.
- **Q2 (Gilad, Part C only): rows from before Part C.** Options: (a) send each one confirmation email once, at
  deploy; (b) count them as confirmed; (c) leave them unconfirmed until they sign up again. Recommendation: (a).
- An export file holds every email and phone in plain text. Mode `600` and the ignore rule limit the damage, and
  the README says where not to keep the files.

## Digest (filled by orchestrator after verification)
