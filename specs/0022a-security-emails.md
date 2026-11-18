---
id: 0022a
title: "An account owner is told by email when the password is set or changed and when the account is deleted, and a dead mail server can no longer stall the tour-mail job"
status: verified
depends_on: []
reviewers: [code, security, qa]   # security: auth paths, PII after deletion, mail abuse; qa: API behaviour and the changed job
estimate: 1 coder run             # coder Opus/high (auth and account deletion, Speed rule 6)
---

## Goal
After this ships, someone who knows only an account's password can no longer change the password or delete the
account without the mailbox owner hearing about it. Serves PRODUCT.md "Login" ("a security email ... is its own
spec **before going public**", FOLLOWUPS 0016a, Gilad 2026-11-16 option 1).

The same spec closes the 0018c review finding that must be fixed before `0013a` goes live: a dead SMTP host can
stall `send_pending` past arq's 300 s job timeout (FOLLOWUPS 0018c, two `send_pending` lines).

## Which paths send mail
Checked against the code: `UserPassword` is written only in `services/auth.py` and removed only by
`services/accounts.py`. `delete_account` has one caller, `DELETE /me`.

| Path | Mail? | Why |
| --- | --- | --- |
| `PUT /me/password`, first password on the account | **password mail** | an attacker with a fresh session could add one |
| `PUT /me/password`, replacing a password | **password mail** | the case FOLLOWUPS 0016a names |
| "Forgot password" | **password mail** | there is no reset endpoint: PRODUCT.md "Login" makes it a code login, then `PUT /me/password` |
| Sign-up with `profile.password` (`verify_otp`) | no | a new account with nothing to protect; the mailbox proved itself with a code in this same request |
| Rehash at password login (`password_login`) | no | the password did not change |
| `DELETE /me` that deleted the account | **deletion mail** | the case FOLLOWUPS 0016a names |
| `DELETE /me` on a tombstone (a racing second call), or the early 204 when the session is already gone | no | the first call mails; one deletion, one mail |
| Admin dashboard | no | it cannot delete accounts: `can_delete = False`, and its actions are suspend, unsuspend and hide. A suspended account's deletion on request (privacy s6) has no code path today |
| `services/retention.py` | no | it never deletes or scrubs a `users` row |
| Google sign-in or account link | no | not a password or deletion event; out of scope |

## Scope
**In:**

*A. Security emails*
1. `api/app/i18n/he.py`: the four strings under "Strings". API mail text lives here, not in `he.json`.
2. `api/app/config.py`: a `DEV_CONTACT_EMAIL = "contact@example.com"` constant beside the other `DEV_*` values, and
   `contact_email: str = DEV_CONTACT_EMAIL` (env `CONTACT_EMAIL`).
   - No API-side contact setting exists today (`VITE_CONTACT_EMAIL` is web build-time only).
   - When `WEB_ORIGIN` is https, `_email_and_production_rules` refuses `"@" not in contact_email or contact_email ==
     DEV_CONTACT_EMAIL` ("CONTACT_EMAIL must be set when WEB_ORIGIN is https"), so a blank value is refused too. Add
     the check **before** the `email_block_key` check, which is documented as last.
3. `infra/docker-compose.yml`, `api` service: `CONTACT_EMAIL: ${CONTACT_EMAIL:-contact@example.com}`.
4. `.env.example`: the existing commented `CONTACT_EMAIL` block says only `make deploy-waitlist` reads it. Reword:
   the API's security emails read it too, with the placeholder as the dev default, and an https `WEB_ORIGIN` refuses it.
5. New `api/app/services/security_mail.py`, three functions:
   - `send_password_changed(sender, to)` and `send_account_deleted(sender, to)` build the mail from `he.py`,
     `web_origin` and `contact_email`, and call `sender.send`. They catch every exception, log its **type only**, and
     never raise.
   - `password_mail_due(r, user_id) -> bool`: the cap under "Abuse".
6. `api/app/services/accounts.py`: `delete_account` returns a frozen dataclass `DeletedAccount(email: str,
   changes: list[tours.TourChange])`, or `None` when the row was already a tombstone. `email` is
   `field(repr=False)`, so a stray repr cannot log it. It is `locked.email`, read under the row lock in step 1, so a
   racing second call gets `None` and only the winner mails. The `assert locked.email is not None` at
   `accounts.py:147` sits inside a branch and moves up to cover this read. The address is held only in memory and is
   not written anywhere by this code.
7. `api/app/routers/auth.py`:
   - `DELETE /me` gains `background: BackgroundTasks` and the `get_email_sender` dependency. If `delete_account`
     returned a value: `tours.announce(r, deleted.changes)`, then
     `background.add_task(security_mail.send_account_deleted, sender, deleted.email)`.
   - `PUT /me/password` gains the same two parameters. It asserts `user.email is not None` (the pattern at
     `routers/auth.py:55`), copies it **before** `set_password`, and after
     `set_password` returns adds `send_password_changed` if `password_mail_due` allows it. A racing deletion raises
     `AccountDeletedError` inside `set_password`, so no mail is queued.
8. `web/src/locales/he.json`, existing keys only (no new key, so `web/src/features/legal/content.ts` is untouched):
   - `legal.privacy.s3.i2`: "(שליחת קודי הכניסה והודעות על סיורים)" becomes
     "(שליחת קודי הכניסה, הודעות על סיורים והודעות אבטחה על החשבון)". Keep the `[…]` placeholders.
   - `legal.privacy.s6.i2`: append "אחרי המחיקה נשלחת לאימייל הודעת אישור אחת. האימייל נשאר רק בנתונים להגבלת ניסיונות, עד יממה (סעיף 5)."
   - `legal.privacy.s5.i9`: replace with "כתובת IP ואימייל: בנתונים להגבלת ניסיונות, עד יממה. כתובת IP גם ביומני השרת, עד 30 יום."
   - The `rl:*` keys are **not** deleted at account deletion: that would let sign-up plus delete reset the OTP limits.

*B. Tour-mail stall (`api/app/services/tour_mail.py::send_pending`)*

9. On the first `EmailUnavailable` in a run, stop sending:
   - The failed recipient follows today's rule: `rpush` with `attempt + 1`, or dropped at `MAX_ATTEMPTS`.
   - Everything not yet tried goes back to the **head** of the queue, order kept: `rest` is first the current item's
     untried sides as `_item(tour_id, change, attempt, side)` (attempt unchanged), then the remaining raw items byte
     for byte, unparsed. `if rest: r.lpush(QUEUE_KEY, *reversed(rest))`: `LPUSH` reverses its arguments and fails when
     given none.
   - They count in a new `deferred` key of the returned counts. If that `lpush` raises `RedisError`, log the type,
     add them to `dropped` instead, and return normally.
   - The failed item goes to the tail and the rest to the head, so one undeliverable address cannot starve the queue.
10. At the end of `send_pending`, when `dropped` is non-zero: `log.warning("tour mail dropped: %d", n)`, the count
    only.

*C. Records*

11. In the same PR:
    - `specs/FOLLOWUPS.md`: delete the 0016a `DELETE /me`, `PUT /me/password` security-email line and the 0018c "dead
      SMTP host can stall one run" line; cut the 0018c "3 attempts run within ~20 s" line down to its not-before part;
      add a line for the OTP lock-out under "Other risks".
    - `specs/PRODUCT.md` "Login": record what shipped, which paths mail and the cap of 3 password mails per account
      per hour.

**Out:**
- A durable outbox or retries for security mail (see "Delivery").
- A not-before delay on tour-mail retries (the other half of the first 0018c line).
- A per-run time budget for an SMTP server that answers, but slowly.
- Requiring the current password for `PUT /me/password` or `DELETE /me` (FOLLOWUPS 0016a "option 3, later").
- A mail on Google link, suspension or new-device login.

**New dependencies:** none.

## Delivery: why not the tour-mail queue
The tour queue cannot carry these mails. Its items hold ids only, "no personal data in Redis", and the address is
read from the row when sending. After `DELETE /me` the row has `email = NULL`, so the deletion mail would have to put
the address in Redis, which is persisted. Two delivery paths for two mails is not worth it, so both use FastAPI
`BackgroundTasks`:
- The response goes out first; a slow or dead SMTP host never delays or fails the action. Sends run in the threadpool
  after the commit, and FastAPI attaches the tasks to the directly returned `Response`.
- `BodySizeLimit` is plain ASGI, so no `BaseHTTPMiddleware` interferes.
- **No DB statement after the commit in these two handlers.** FastAPI closes `get_session` only after the background
  task. Today the commit releases the connection (`expire_on_commit=False`); a later query would hold a pooled
  connection through the SMTP send.
- The cost: one attempt, and a process killed between response and send loses the mail. The module carries
  `# shortcut: one attempt, no outbox; add a durable queue if logs show lost security mail`.

## Abuse
`limits.WRITE` allows 200 `PUT /me/password` an hour and 1,000 a day per account. Unthrottled, one account could bury
the owner's inbox. The cap protects that inbox; it does not protect the provider's shared daily quota (see Risks).
- `password_mail_due` uses the existing limiter, and is `True` unless the limit is reached:
  ```python
  try:
      soft(lambda: count_or_raise(r, [(f"rl:security_mail:password:{user_id}", 3, 3600)]))
  except RateLimitedError:
      return False
  return True
  ```
  `soft` returns `None` both on success and when Redis is unavailable; both mean send, since a security notice
  outranks the cap. The key holds an id only.
- Result: at most 3 password mails per account per hour (72 a day at worst, to that account's own mailbox). Three
  rather than one, so the owner's own change cannot silence the warning about an intruder's change right after it. A
  failed send still uses one of the three, and two remain.
- The deletion mail needs no cap: an account is deleted once.

## Data
No table, column or migration. One short-lived Redis counter per account (above).

## API
No new endpoint, and status codes and bodies do not change.

| Method | Path | Auth rule | Change |
| --- | --- | --- | --- |
| PUT | `/me/password` | session younger than 15 min (unchanged) | after a successful commit, queues the password mail |
| DELETE | `/me` | session younger than 15 min (unchanged) | after the deletion commits, queues the deletion mail |

## UI
No screen changes. Three existing legal strings change (Scope 8), and RTL is unaffected.

## Strings (`api/app/i18n/he.py`)
Each URL and address sits alone on its line, as the OTP code does, so bidi cannot scramble it. No name, no time, no
IP, no code, no token, no link that signs anyone in. No run of six digits: `web/e2e/helpers.ts::latestCode` treats any
such mail as a login code.

```python
SECURITY_PASSWORD_SUBJECT = "הסיסמה בחשבון הומי שלך עודכנה"
SECURITY_PASSWORD_BODY = (
    "הסיסמה בחשבון הומי שלך נקבעה או שונתה, וכל המכשירים האחרים נותקו מהחשבון.\n\n"
    "אם עשית את זה, אין צורך לעשות דבר.\n\n"
    "לא עשית את זה? צריך להיכנס עכשיו עם קוד חד-פעמי לאימייל ולקבוע סיסמה חדשה. "
    "זה ינתק כל מכשיר אחר מהחשבון:\n{login_url}\n\n"
    "לעזרה:\n{contact}"
)
SECURITY_DELETED_SUBJECT = "חשבון הומי שלך נמחק"
SECURITY_DELETED_BODY = (
    "חשבון הומי שלך נמחק, וכל המכשירים נותקו ממנו. המחיקה סופית.\n\n"
    "לא ביקשת למחוק את החשבון? כדאי לכתוב לנו מיד:\n{contact}"
)
```
`login_url` is `f"{web_origin}/login"`. The recovery advice is true in the code: a code login is a fresh session, and
`set_password` from it revokes every other session, an intruder's included. One limit on that advice is under "Other
risks" (the OTP ceiling), which is why the mail also carries the contact address.

## Acceptance criteria
New API tests are in `api/tests/test_security_mail.py` unless named otherwise.

*Security emails*
- [ ] AC1 Given a fresh session, When `PUT /me/password` sets a first password and then replaces it, Then each returns
  204 and the owner gets one mail each with the password subject, the login URL and the contact address (compared
  with `get_settings().contact_email`, because the Makefile exports `CONTACT_EMAIL`) —
  `test_ac1_password_set_and_change_mail_owner`
- [ ] AC2 Given sign-up with `profile.password`, or a password login that rehashes, Then no security mail is sent —
  `test_ac2_signup_and_rehash_send_nothing`
- [ ] AC3 Given `DELETE /me` succeeds, Then one deletion mail goes to the pre-deletion address, and when `send` runs
  the row is already scrubbed (the test sender reads it on its own connection) —
  `test_ac3_deletion_mail_goes_after_the_commit`
- [ ] AC4 Given a sender that raises `EmailUnavailable` or `RuntimeError`, Then `PUT /me/password` and `DELETE /me`
  still return 204, the change is committed, and the log holds the exception type only —
  `test_ac4_mail_failure_changes_nothing`
- [ ] AC5 Given two racing `DELETE /me`, Then exactly one deletion mail is sent; and `delete_account` on a tombstone
  returns `None` — extend `test_account_deletion.py::test_ac13_concurrent_deletes_are_one_deletion` (it gains the
  `outbox` fixture); `test_ac5_tombstone_returns_none`
- [ ] AC6 Given `PUT /me/password` fails (403 `reauth_required`, 422, 429 or a racing deletion's 401), Then no mail
  is sent — `test_ac6_failed_change_sends_nothing`
- [ ] AC7 Given four password changes within the hour, Then all return 204, the first three each send a mail and the
  fourth sends nothing; and with `count_or_raise` in `security_mail` alone raising `RedisError` (`limits.check` also
  uses `eval`, so do not fail Redis as a whole), the mail still goes — `test_ac7_password_mail_cap`
- [ ] AC8 Both mails contain neither the new password nor any session token, no name, and no `\b\d{6}\b`; and nothing
  logged during either path contains the address — `test_ac8_no_secret_or_pii_in_mail_or_logs`
- [ ] AC9 Given an account that signed up through `/auth/otp/request`, After a deletion mail, no `users` row holds the
  address, no Redis key name outside `rl:*` holds it, and neither the `tour_mail` queue's values nor the
  `rl:security_mail:*` keys' values hold it — `test_ac9_no_address_left_behind`
- [ ] AC10 An https `WEB_ORIGIN` with the placeholder or an empty `contact_email` is refused, and a real one passes —
  `api/tests/test_config.py::test_ac10_contact_email_required_on_https`

*Tour mail*
- [ ] AC11 Given 5 queued single-recipient items (`booked` with `to="seeker"`) and a sender that always fails, When `send_pending` runs, Then `send` is called once,
  counts are `retried=1, deferred=4`, and the queue is items 2–5 in order, then item 1 with `attempt` 1 —
  `api/tests/test_tour_mail.py::test_ac11_dead_smtp_stops_the_run`
- [ ] AC12 Given a two-recipient item whose first send fails, Then the second side is re-queued with its attempt
  unchanged and counted `deferred` — `api/tests/test_tour_mail.py::test_ac12_untried_side_is_deferred`
- [ ] AC13 Given the re-queue `lpush` raises `RedisError`, Then `send_pending` returns, the items count as `dropped`,
  and only the exception type is logged — `api/tests/test_tour_mail.py::test_ac13_requeue_failure_counts_dropped`
- [ ] AC14 Given a run with `dropped > 0`, Then one WARNING holds the count and no address or id; a run with none logs
  no such warning — `api/tests/test_tour_mail.py::test_ac14_dropped_logs_warning`
- [ ] NF1 A malformed raw item among the deferred ones is re-queued unchanged and handled by the next run —
  `api/tests/test_tour_mail.py::test_nf1_deferred_raw_item_is_untouched`

## Tests to write
Unit and integration as named above. **Existing tests to change:**
- `api/tests/test_tour_mail.py`: `_counts` gains `deferred=0`. The `BothDown` half of
  `test_ac6_retry_per_recipient_then_drop` now expects `_counts(dropped=1, deferred=1)` and the seeker side at
  attempt 0.
- `api/tests/test_analytics.py:381`: `== []` becomes `is None`.
- `api/tests/test_account_deletion.py`: `delete_together`'s return annotation.
- `api/tests/test_config.py`: `_HTTPS_READY` and the explicit kwargs near line 197 gain `contact_email`.
- `api/tests/test_worker.py:246`: the exact dict gains `"deferred": 0`.

E2E: none added. e2e runs only in CI, never locally. `latestCode` already skips mail without a six-digit run.

## Blast radius
Graph built 2026-11-17 at `d8c2b54` (#131), so it lags `main` (`2e15d3c`, Slice 21). Results were cross-checked with grep.
- `accounts.delete_account` (return type): `routers/auth.py::delete_me` (Scope 7); `test_analytics.py:381` (`== []` → `is None`, in scope); `test_account_deletion.py:693-699` `delete_together` (annotation, in scope); `test_account_deletion.py:962` (expects a raise, untouched).
- `routers/auth.py::delete_me`, `set_my_password`: no code callers (HTTP routes; the graph shows none). Called over HTTP by `test_account_deletion.py`, `test_password.py`, `test_analytics.py:378`, `test_tour_mail.py:524`, `test_google.py:390,406`, `test_hardening.py:86`, and the UI flow in `web/e2e/account.spec.ts`. Status and body are unchanged; these only gain a mail. Tests without the `outbox` fixture write to the git-ignored `.outbox/`.
- `tour_mail.send_pending` (stops at first failure, new `deferred` count): `worker.py::_send_tour_mail` → `send_tour_mail_job` (logs the dict, untouched); `test_tour_mail.py::_send` and its tests (`_counts` and the `BothDown` half change, in scope); `test_worker.py:246` exact dict (in scope); the other tests importing `worker` do not read the counts.
- `config.Settings._email_and_production_rules` (new https rule): every `Settings()` on an https origin, all in `test_config.py` through `_HTTPS_READY` or the kwargs near line 197 (in scope). The API and worker refuse to start without the value (0013a sets it). `get_settings()` callers are unaffected: the field has a default. `AdminSettings` and `DatabaseSettings` are separate classes, untouched.
- `services/email.get_email_sender` (unchanged, two new route dependants): overridden by the `outbox` fixture (`conftest.py:374`), so `Depends` works as is.
- `i18n/he.py`, `he.json`: additions and three edited legal strings; `LegalPage.test.tsx` reads the values from `he.json`, so it follows.

## Risks / open questions
Verification: round 1 rejected with 12 findings, all applied; second round waived.

Defaults taken, so nothing blocks the build. Gilad can overrule any of them in the digest:
1. **No mail at sign-up with a password.** Options: (a) none, recommended, for the reason in the table; (b) mail
   there too, which adds noise to every password sign-up.
2. **Security mail is best effort.** Options: (a) one attempt after the response, recommended for launch; (b) a durable
   outbox, which needs a table that would hold an address after the account is gone, against the deletion promise.
3. **Password-mail cap. Q1 decided by Gilad, 2026-11-18: option (b), up to 3 per hour per account.** Options were:
   (a) 1 per hour, the quietest, but the owner's own change can silence the warning about an intruder's change in
   that hour; (b) up to 3 per hour per account; (c) mail every change, no gap, but up to 200 mails an hour from one
   account.

Other risks:
- **Privacy text:** Scope 8 changes three strings in the legal draft, and now says the email stays in rate-limit data for up to a day. They join the wording Gilad already has to
  approve (HANDOFF Next Steps), and the mail provider keeps its own delivery logs, covered by privacy s3.
- **A refused recipient looks like an outage** to `send_pending`: `EmailUnavailable` does not distinguish them. It
  costs that run's remaining sends one 10 s cycle, and the item is dropped after 3 attempts.
- **`CONTACT_EMAIL` in production:** 0013a already sets it; either PR can land first. Without it, the API refuses to
  start on an https origin.
- **Shared mail quota (existing):** a few accounts changing passwords could use up the provider's ~300 a day, which
  would stop login codes for everyone. The same quota is already reachable with no account: `/auth/otp/request` allows
  50 a day per network (`auth.py:67`). Not solved here.
- **OTP lock-out after a takeover (existing):** `set_password` revokes the owner's sessions (`auth.py:432-440`), and an
  attacker can then spend the address's 20-a-day code ceiling from a few networks (`auth.py:7-9`, `:165`), so the owner
  may get no code for up to 24 h. The mail's contact line is the fallback. No code here; FOLLOWUPS line in Scope 11.
- The `EMAIL_BACKEND=file` outbox stores the mail in dev and e2e only; FOLLOWUPS 0018c already tracks that outbox.
