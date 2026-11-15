---
id: 0013h
title: "homie keeps each kind of personal data only for a stated period, and a daily job deletes it after that"
status: draft
depends_on: []
reviewers: [code, security]   # security: PII deletion, cascades that could erase another person's thread
estimate: 1 coder run   # coder Opus/high (data deletion; Speed rule 6)
---

## Goal
After this ships, every kind of personal data homie stores has a retention period, a daily worker job
enforces it, and the privacy policy lists the same periods instead of "בלי הגבלת זמן". Serves the privacy
review of 2026-11-15 and PRODUCT.md "Retention" (Gilad, 2026-11-15).

## Decisions this spec builds on (Gilad, 2026-11-15)

| Data | Retention |
| --- | --- |
| Listing after account deletion | 12 months after the last message in its conversations |
| Listing personal attributes | Removed at account deletion |
| House number | Removed at account deletion (none is collected: `listings.street` is the street name only, so nothing to do) |
| Price history | 24 months per price change |
| Final rent | 24 months from recording |
| Conversations | While at least one participant has an active account, and deleted after 3 years with no message (inactivity rule) |
| Declined / withdrawn applications without a chat | 12 months after the decision |
| Reports and admin actions | 3 years after resolution |
| Free-text report notes | 12 months after resolution |
| Unresolved reports | Until resolution |
| Blocked-email HMAC | 5 years from blocking |
| Server logs | 30 days |

## Scope
**In:**
1. `services/accounts.py::delete_account`: the step that pauses the listings also sets `lifestyle = '{}'`,
   `flatmate_ages = '{}'`, `flatmates_count = NULL` and `floor` / `total_floors = NULL`. Kept for the
   stats and the open threads: city, area, street, rooms, size, price, listing type, the flat facts.
2. `services/retention.py`: one function per rule below, each a single set-based `DELETE` or `UPDATE`
   with its period as a module constant, returning the row count. `purge_expired(db)` runs them all in one
   transaction and returns `{rule: count}`.
   - **R1 listing of a deleted owner:** `DELETE listings` where the owner has `deleted_at` set and
     `greatest(owner.deleted_at, max(conversations.last_message_at))` is older than 12 months. The FK
     cascade removes its price changes, photos rows, applications, conversations and messages.
   - **R2 price history:** `DELETE listing_price_changes` older than 24 months, except each listing's
     newest row (the current price stays recorded).
   - **R3 final rent:** `UPDATE listings SET final_rent_ils = NULL, close_reason = NULL` where
     `closed_at` is older than 24 months.
   - **R4 conversations:** `DELETE conversations` where every participant (owner, seeker and, on a room
     chat, every `listing_flatmates` member) has `deleted_at` set, **or** whose newest activity
     (`coalesce(last_message_at, created_at)`) is older than 3 years. Messages cascade.
   - **R5 applications:** `DELETE applications` with status `declined` or `withdrawn`, no conversation,
     and `updated_at` older than 12 months.
   - **R6 report notes:** `UPDATE reports SET note = NULL` where `resolved_at` is older than 12 months.
   - **R7 reports:** `DELETE reports` where `resolved_at` is older than 3 years. Unresolved: never.
   - **R8 admin actions:** `DELETE admin_actions` older than 3 years, **except** a `suspend` or
     `hide_listing` whose target's email block (R9) is still live, and the actions on a user who is still
     suspended or a listing still hidden (they are the current state, not history).
   - **R9 blocked emails:** `DELETE blocked_emails` where `created_at` is older than 5 years.
3. `worker.py`: `cron(purge_expired_job, hour=3, minute=25, unique=True)`, logging the counts.
4. `web/src/locales/he.json`: `legal.privacy.s5.*` and `s6.*` list the periods above; `s1.i13` and `s5.i9`
   say 30 days for server logs; drop every "בלי הגבלת זמן". Also the review's wording fixes:
   `s6.i7` ("מזהה מקודד, לא כתובת גלויה" instead of "אי אפשר לשחזר"), `s7.p1` (legal right to see and
   correct; deletion "כשמתקיימים התנאים בחוק", plus the account deletion of section 6), `s8.p1` (anyone
   with a photo's link can open it), `s1.i9` (deletion does not remove copies others saved).
5. `specs/0013a-production-deploy.md` / `infra/DEPLOY.md`: one line that server logs are kept 30 days
   (Fly's log retention, or the log shipper's setting if one is added).

**Out:** aggregating old price history into per-area stats (nothing reads it yet: `rent_estimate.py`
uses only the reference and CBS tables); FOLLOWUPS 0013c option D.
**New dependencies:** none.

## Data
No new columns. Migration `0027_retention_indexes`: indexes the purge needs, only if `EXPLAIN` shows a
sequential scan on a large table: `listing_price_changes (created_at)`, `reports (resolved_at)`,
`blocked_emails (created_at)`. Working `downgrade`. The admin role's grants are unchanged (the job runs
as the app role).

## API
None.

## UI
Only the privacy page text (`/privacy`, `legal.privacy.*`). No new keys unless a paragraph is added;
`make i18n-check` passes.

## Acceptance criteria
- [ ] AC1 Given an account with a room listing that has flatmates' ages and lifestyle, When it is deleted,
  Then the listing row keeps city, street, price and rooms, and `lifestyle`, `flatmate_ages`,
  `flatmates_count`, `floor`, `total_floors` are empty — `api/tests/test_account_delete.py::test_ac1_listing_attributes_cleared`
- [ ] AC2 R1: a deleted owner's listing whose last message is 12 months + 1 day old is gone with its
  conversations; one at 11 months stays; one with no conversations goes 12 months after the deletion —
  `api/tests/test_retention.py::test_r1_deleted_owner_listing`
- [ ] AC3 R2: price changes older than 24 months go, the newest row of each listing stays even if older —
  `test_retention.py::test_r2_price_history`
- [ ] AC4 R3: final rent and close reason are cleared 24 months after `closed_at` —
  `test_retention.py::test_r3_final_rent`
- [ ] AC5 R4: a conversation goes when every participant, room flatmates included, is deleted, or when
  its last message (or, with none, its creation) is 3 years + 1 day old; one with an active participant
  and a message 3 years − 1 day old stays — `test_retention.py::test_r4_conversations`
- [ ] AC6 R5: a declined/withdrawn application without a conversation goes after 12 months; one with a
  conversation, or submitted/shortlisted, stays — `test_retention.py::test_r5_applications`
- [ ] AC7 R6/R7: a note is cleared 12 months after resolution, the report goes after 3 years, an
  unresolved report of any age stays — `test_retention.py::test_r6_r7_reports`
- [ ] AC8 R8: admin actions older than 3 years go, except those behind a live email block, a current
  suspension or a hidden listing — `test_retention.py::test_r8_admin_actions`
- [ ] AC9 R9: a blocked email older than 5 years goes, and that address can sign up again —
  `test_retention.py::test_r9_blocked_emails`
- [ ] AC10 Nothing else an active person can see disappears: a conversation where one side is active
  and that had a message within 3 years stays, except under R1 —
  `test_retention.py::test_ac10_active_threads_kept`
- [ ] AC11 `purge_expired` is idempotent (a second run deletes 0) and the cron is registered —
  `test_retention.py::test_ac11_idempotent`, `api/tests/test_worker.py`
- [ ] AC12 The privacy text has no "בלי הגבלת זמן" and states each period — `make i18n-check` +
  `web/src/features/legal/__tests__` (existing privacy-page test updated)

## Tests to write
Unit/integration (pytest, real Postgres): one test per rule with rows just inside and just outside the
period (freeze `now()` by inserting timestamps relative to it). Web: the privacy-page snapshot/text test.
E2E: none (CI only anyway; no new screen).

## Risks / open questions
1. **R1 wins over the conversations rule (Gilad, 2026-11-15).** Deleting a deleted owner's listing
   cascades its conversations, so 12 months after the last message the active seeker loses that
   read-only thread. Accepted: the thread is closed and idle for a year. The privacy text says so.
2. **Inactivity rule (Gilad, 2026-11-15):** a conversation with no message for 3 years is deleted (R4),
   even with active participants. The privacy text says so.
3. Photos of a deleted listing are already deleted at account deletion (0013c); R1 only removes rows.
4. The deleted user's tombstone row (`users`, `deleted_at` set) is never deleted: it holds no PII and
   keeps FKs valid. The verifier should confirm no PII column survives on it.
5. A lawyer may ask for different periods; they are module constants, so changing one is a one-line PR
   plus the policy text.

## Digest (filled by orchestrator after verification)
