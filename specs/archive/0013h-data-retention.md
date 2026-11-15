---
id: 0013h
title: "homie keeps each kind of personal data only for a stated period, and a daily job deletes it after that"
status: done
depends_on: []
reviewers: [code, security, qa]   # security: PII deletion, cascades that could erase another person's thread or the admin's evidence; qa: every rule's edges (UI text change too, checklist 8)
estimate: 1 coder run   # a long one: 9 rules + their tests, one small migration; coder Opus/high (data deletion, migration; Speed rule 6)
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

**Readings of these lines this spec sets (verifier, 2026-11-15; digest FYI, Gilad may overrule):**
- "Unresolved reports: until resolution" keeps the report's **evidence** too: R1, R4 and R5 skip a
  listing, conversation or application that an unresolved report points at (directly, or through one of
  the listing's chats or applications). Otherwise the nightly job could delete the reported chat before the
  admin reads it (`admin/actions.py::read_chat` returns None for a missing conversation).
- "An account the admin acted against … cannot sign up again" (PRODUCT.md "Launch (Slice 13)") is computed
  at deletion time from `admin_actions` (0013c step 2), and `blocked_emails` has no user id. So R8 keeps
  every `suspend` / `hide_listing` row whose target account is **not deleted**, of any age: it is the only
  record of the future block. Once the account is deleted the block lives in `blocked_emails` (R9, 5 years)
  and the action rows age out after 3 years like the rest.

## Scope
**In:**
1. `services/accounts.py::delete_account`: step 3 (the listings UPDATE) also sets `lifestyle = '{}'`,
   `flatmate_ages = '{}'`, `flatmates_count = NULL`, `floor = NULL` and `total_floors = NULL`. Every
   listing CHECK passes (`ck_listings_flatmate_ages`: an empty array fits a NULL count;
   `ck_listings_room_fields` holds on an apartment). Kept for the stats and the open threads: city, area,
   street, rooms, size, price, listing type, the flat facts. The module docstring and step 3's comment say so.
2. **Migration and model:** `api/alembic/versions/0028_retention.py` and `api/app/models/listing.py`:
   `listings.floor` **DROP NOT NULL** (it is NOT NULL since 0003, so scope 1 needs it). See Data.
3. `services/retention.py` (new): one function per rule below, each a single set-based `DELETE` or `UPDATE`
   with its period as a module constant, returning the row count. `purge_expired(db)` runs them **in this
   order** in one transaction, commits, and returns `{rule: count}`: R1, R4, R5, R2, R3, R6, R7, R8, R10, R9
   (R4 before R5: an application whose chat R4 deletes is R5's the same night, so a second run deletes 0).
   "Older than N" is `< now() - interval 'N'` in SQL, never a Python clock.
   An **unresolved report** below is a `reports` row with `resolved_at IS NULL`; its `target_id` is a
   listing id (`target_type = 'listing'`), a conversation id (`'chat'`) or an application id
   (`'applicant'`), per `services/reports.py::_LOOKUPS`.
   - **R1 listing of a deleted owner:** `DELETE listings l` where `l.owner_id` is a user with `deleted_at`
     set, and `greatest(owner.deleted_at, (SELECT max(c.last_message_at) FROM conversations c JOIN
     applications a ON a.id = c.application_id WHERE a.listing_id = l.id))` is older than 12 months
     (conversations have no listing id; Postgres `greatest` ignores the NULL of a listing with no chats, so
     that one goes 12 months after the deletion). **Skipped** while an unresolved report targets the
     listing, one of its applications or one of its conversations. The FK cascade removes its
     `listing_price_changes`, `listing_photos` (already empty since 0013c), `room_pairs` (already empty),
     `listing_flatmates` (the remaining flatmates lose that flat from `/me/flats`), `applications`, and
     through them `conversations`, `messages` and `conversation_reads`.
   - **R2 price history:** `DELETE listing_price_changes` older than 24 months, except each listing's
     newest row (the current price stays recorded). `ix_listing_price_changes_listing_id (listing_id,
     created_at)` serves it.
   - **R3 final rent:** `UPDATE listings SET final_rent_ils = NULL` where `final_rent_ils IS NOT NULL` and
     `closed_at` is older than 24 months. `close_reason` and `closed_at` stay: `ck_listings_closed_at`
     requires them together, they are not personal, and clearing them would make a closed listing look
     never-closed to its owner.
   - **R4 conversations:** `DELETE conversations c` where either
     (a) both `c.owner_id` and `c.seeker_id` have `deleted_at` set, and, for a room chat (`c.application_id`
     set and that application's `listing_type_at_apply = 'room'`), no `listing_flatmates` row of the
     application's listing belongs to a user with `deleted_at IS NULL` (0013c step 9 already removes a
     deleted flatmate's rows; a direct chat has no flatmates), **or**
     (b) `coalesce(c.last_message_at, c.created_at)` is older than 3 years.
     **Skipped** while an unresolved `chat` report targets `c.id`. `messages` and `conversation_reads`
     cascade; the application, if any, stays (R5 may take it).
   - **R5 applications:** `DELETE applications` with status `declined` or `withdrawn`, no conversation
     (`NOT EXISTS conversations WHERE application_id = applications.id`), and `updated_at` older than 12
     months (`updated_at` is set by every status change, `services/applications.py`, and by 0013c step 6,
     so for these two statuses it is the decision time). **Skipped** while an unresolved `applicant`
     report targets it. Nothing references an application without a conversation, so nothing cascades.
   - **R6 report notes:** `UPDATE reports SET note = NULL` where `note IS NOT NULL` and `resolved_at` is
     older than 12 months.
   - **R7 reports:** `DELETE reports` where `resolved_at` is older than 3 years. Unresolved: never. No FK
     points at `reports`.
   - **R8 admin actions:** `DELETE admin_actions` whose `created_at` is older than 3 years, **except** a
     `suspend` (`target_type = 'user'`) whose target user has `deleted_at IS NULL`, and a `hide_listing`
     (`target_type = 'listing'`) whose listing still exists and its owner has `deleted_at IS NULL` (the
     re-signup block's source and the current state; see "Readings"). `read_chat`, `resolve_reports`,
     `set_listing_cap`, `unsuspend`, `unhide_listing` rows simply age out. No FK points at `admin_actions`.
   - **R9 blocked emails:** `DELETE blocked_emails` where `created_at` is older than 5 years.
   - **R10 login sessions (orchestrator, 2026-11-15, after review):** `DELETE sessions` where `expires_at`
     or `revoked_at` is older than 30 days. Nothing references a session.
4. `worker.py`: `purge_expired_job`, run off the event loop with `asyncio.to_thread` and its own session
   (the `_sweep` / `_flush_views` pattern), registered as `cron(purge_expired_job, hour=3, minute=25,
   unique=True)` in `WorkerSettings.cron_jobs`, logging the counts only (`log.info("retention purge: %s",
   counts)`), never an id or a value.
5. `web/src/locales/he.json`: `legal.privacy.s5.*` and `s6.*` list the periods above, including the
   readings (an unresolved report keeps what it points at; R1's and R4's thread deletions, Risks 1–2);
   `s5.i9` replaces the placeholder "[משך שמירת היומנים]" with 30 days and `s1.i13` says 30 days for server
   logs; drop every "בלי הגבלת זמן" (today in `s5.i4`, `s5.i5`, `s5.i10`, `s5.i11`). Also the review's
   wording fixes: `s6.i7` ("מזהה מקודד, לא כתובת גלויה" instead of "אי אפשר לשחזר"), `s7.p1` (legal right to
   see and correct; deletion "כשמתקיימים התנאים בחוק", plus the account deletion of section 6), `s8.p1`
   (anyone with a photo's link can open it), `s1.i9` (deletion does not remove copies others saved). A new
   key, if a paragraph is added, also goes into `web/src/features/legal/content.ts` (its keys are literals).
   Terms (Gilad, 2026-11-15: "update the terms and policy page"): `legal.terms.s9.p1` adds that how long
   each kind of data is kept is in the privacy policy, section 5 ("כמה זמן המידע נשמר").
6. Tests: `api/tests/test_retention.py` (new), `api/tests/test_account_deletion.py` (one new test),
   `api/tests/test_worker.py` (one new test), `api/tests/test_migrations.py` (one new test),
   `web/src/features/legal/__tests__/LegalPage.test.tsx` (one new test).

**Out:** aggregating old price history into per-area stats (nothing reads it yet: `rent_estimate.py`
uses only the reference and CBS tables); FOLLOWUPS 0013c option D; new indexes (at launch every table the
purge scans is small; `reports` and `blocked_emails` scans are cheap; a later spec adds one if the job's
logged duration grows); the server-log line in `specs/0013a-production-deploy.md` / `infra/DEPLOY.md`
(0013a is verified and not built, and `infra/DEPLOY.md` does not exist yet: the **orchestrator** adds "server
logs are kept 30 days (Fly's log retention, or the log shipper's setting)" to 0013a's runbook as a docs
commit; not this coder's).
**New dependencies:** none.

## Data
Migration `api/alembic/versions/0028_retention.py` (revision `0028`, `down_revision` `0027`: 0015b merged
first as `0027_shelter_needed`, so this one was re-pointed):
- **upgrade:** `ALTER TABLE listings ALTER COLUMN floor DROP NOT NULL`. `ck_listings_floor` (`BETWEEN`) and
  `ck_listings_total_floors` (`total_floors IS NULL OR …`) pass on NULL, unchanged.
- **downgrade:** `UPDATE listings SET floor = 0 WHERE floor IS NULL` (only deleted owners' listings, never
  shown to anyone), then `SET NOT NULL`.
- Model: `floor: Mapped[int | None]`, comment "NULL only on a deleted owner's listing (0013h)". The response
  schemas stay `floor: int` (`schemas/listing.py::ListingOut`, `schemas/search.py::ListingPublic`): no
  response ever serializes a deleted owner's listing (public reads are live listings only, a paused one
  never is; `GET /me/listings` is the owner's, and a deleted owner has no session; its `room_pairs` are
  gone at deletion, so `GET /me/likes` cannot reach it). The input schemas are unchanged.
- **Backwards-compatible with the running app:** the column only becomes nullable, and no NULL exists until
  the new `delete_account` (same PR) writes one.
- No other column, table or index. The admin role's grants are unchanged (the job runs as the app role).

## API
None.

## UI
Only the privacy page text (`/privacy`, `legal.privacy.*`). No new layout, so no RTL change and no new
state. No new keys unless a paragraph is added (then `content.ts` too); `make i18n-check` passes. The text
is drafted by the coder from this spec; Gilad approves it in the digest (PRODUCT.md "Launch (Slice 13)":
"Gilad approves it").

## Acceptance criteria
- [ ] AC1 Given an account with a room listing that has flatmates' ages, lifestyle, floor and total floors,
  When it is deleted, Then the listing row keeps city, street, price and rooms, and `lifestyle = '{}'`,
  `flatmate_ages = '{}'`, `flatmates_count`, `floor`, `total_floors` are NULL —
  `api/tests/test_account_deletion.py::test_ac1_listing_attributes_cleared`
- [ ] AC2 R1: a deleted owner's listing whose last message is 12 months + 1 day old is gone with its
  applications, conversations, messages and price changes; one at 11 months stays; one with no
  conversations goes 12 months + 1 day after the deletion and stays at 11 months; a live owner's listing
  with an old chat stays — `api/tests/test_retention.py::test_r1_deleted_owner_listing`
- [ ] AC3 R2: price changes older than 24 months go, the newest row of each listing stays even if older —
  `test_retention.py::test_r2_price_history`
- [ ] AC4 R3: `final_rent_ils` is cleared 24 months + 1 day after `closed_at` (close reason and `closed_at`
  stay); at 23 months it stays — `test_retention.py::test_r3_final_rent`
- [ ] AC5 R4: a conversation goes when owner and seeker are deleted and its room has no live flatmate, or
  when its last message (or, with none, its creation) is 3 years + 1 day old; one with a live flatmate, or
  with an active participant and a message 3 years − 1 day old, stays — `test_retention.py::test_r4_conversations`
- [ ] AC6 R5: a declined/withdrawn application without a conversation goes 12 months + 1 day after
  `updated_at`; one with a conversation, one at 11 months, or a submitted/shortlisted one, stays —
  `test_retention.py::test_r5_applications`
- [ ] AC7 R6/R7: a note is cleared 12 months after resolution, the report goes after 3 years, an
  unresolved report of any age stays with its note — `test_retention.py::test_r6_r7_reports`
- [ ] AC8 R8: admin actions older than 3 years go (`read_chat`, `unsuspend`, a `suspend` on a deleted
  account), except a `suspend` on a live account and a `hide_listing` on a live owner's listing; a 2-year-old
  action stays; and a live account whose only `suspend` is 4 years old, deleted after the purge, still gets
  its `blocked_emails` row — `test_retention.py::test_r8_admin_actions`
- [ ] AC9 R9: a blocked email older than 5 years goes, and that address can sign up again (`verify_otp`
  succeeds); one at 4 years still refuses — `test_retention.py::test_r9_blocked_emails`
- [ ] AC10 Nothing else an active person can see disappears: a conversation where one side is active
  and that had a message within 3 years stays, with its messages and application, except under R1 —
  `test_retention.py::test_ac10_active_threads_kept`
- [ ] AC11 `purge_expired` is idempotent (a second run returns 0 for every rule, including an application
  orphaned by R4 in the first run) — `test_retention.py::test_ac11_idempotent`; the cron is registered at
  03:25, unique — `api/tests/test_worker.py::test_ac11_purge_cron_registered`
- [ ] AC12 The privacy text has no "בלי הגבלת זמן" and no "[" placeholder, and states each period —
  `make i18n-check` + `web/src/features/legal/__tests__/LegalPage.test.tsx` `ac12_privacy_states_retention_periods`
- [ ] AC13 An unresolved report keeps its evidence: a listing (R1), a chat (R4, both rules) and an
  application (R5) that an unresolved report targets, directly or through the listing's chat or
  application, stay past their period; after the report is resolved the next run deletes them —
  `test_retention.py::test_ac13_unresolved_report_keeps_target`
- [ ] AC14 Migration 0028 upgrades and downgrades (a NULL floor becomes 0 on downgrade) and autogenerate sees
  no diff — `api/tests/test_migrations.py::test_0028_floor_nullable_roundtrip` (the existing
  `test_ac4_autogenerate_sees_no_diff_with_postgis_extensions` stays green)
- [ ] AC15 R10: a session expired or revoked 30 days + 1 day ago goes; one expired 29 days ago and a live one
  stay; `s5.i8` says so — `test_retention.py::test_r10_sessions` (and in `test_ac11_idempotent`)

## Tests to write
Unit/integration (pytest, real Postgres): one test per rule with rows just inside and just outside the
period (insert timestamps relative to the database's `now()`, e.g. `now() - interval '12 months 1 day'`).
Web: the privacy-page text test. E2E: none (CI only anyway; no new screen).

## Blast radius
`graphify affected` on `main`'s graph (`GRAPHIFY_OUT=../rent-app/graphify-out`), 2026-11-15:
- `delete_account` (`services/accounts.py`): `routers/auth.py::delete_me` (calls it; unchanged, the
  signature stays), `tests/test_account_deletion.py` (in Scope: AC1 added; its existing listing asserts
  check status, description and invite hash only, so they stay green), specs `archive/0013c` and FOLLOWUPS
  `0008f` (docs, untouched).
- `WorkerSettings.cron_jobs` (`worker.py`): `tests/test_worker.py` (in Scope: one new test; the existing
  ones select their job by coroutine, so a new entry does not break them); graphify also lists archived
  specs 0000a, 0013g, 0014a, 0014d (docs, untouched).
- `Listing.floor` (model, by grep; graphify has no column nodes): read by `schemas/listing.py::ListingOut`
  and `schemas/search.py::ListingPublic` (untouched, reason in Data); `ListingIn` / `ListingPatch` and the
  `total_floors >= floor` validator are input-only (untouched); `api/admin/` does not show it; no service reads it.
- `legal.privacy.*` (`web/src/features/legal/content.ts::privacyDoc`, `LegalPage.test.tsx`): keys kept, so
  `content.ts` is untouched unless a key is added (Scope 5).

## Risks / open questions
1. **R1 wins over the conversations rule (Gilad, 2026-11-15).** Deleting a deleted owner's listing
   cascades its conversations, so 12 months after the last message the active seeker loses that
   read-only thread, and its remaining flatmates lose the flat. Accepted: the thread is closed and idle for
   a year. The privacy text says so.
2. **Inactivity rule (Gilad, 2026-11-15):** a conversation with no message for 3 years is deleted (R4),
   even with active participants. The privacy text says so. Its application may stay `shortlisted` with no
   chat; the chat screen already answers 404 for a missing conversation, and a re-shortlist from
   `submitted` opens a new one (`set_applicant_status`'s insert on conflict). Accepted, no code change.
3. Photos of a deleted listing are already deleted at account deletion (0013c); R1 only removes rows.
4. The deleted user's tombstone row (`users`, `deleted_at` set) is never deleted. **Verified:** it holds no
   PII. After 0013c it keeps only `id`, `role`, `account_type`, `created_at`, `listing_cap`, `suspended_at`,
   `card_id` (random, never shown) and `deleted_at`; `email`, `display_name`, `photo_key`, `last_login_at`
   are NULL (`ck_users_deleted_scrubbed` enforces the first three). Personal data tied to it elsewhere is
   bounded by this spec: listings (R1, attributes at deletion), messages (R1/R4), reports' notes (R6/R7).
5. A lawyer may ask for different periods; they are module constants, so changing one is a one-line PR
   plus the policy text.
6. `purge_expired` takes row locks for one transaction at 03:25. A message sent into a conversation R4 is
   deleting either commits first (the DELETE re-checks `last_message_at` and skips it) or finds the row
   gone and fails as a send to an unknown chat. Accepted at this volume.
7. **AC12's "no '[' placeholder" (coder, 2026-11-15):** read as the retention lines this spec owns
   (`s1.i13`, `s5.*`, `s6.*`), which the test checks. The operator placeholders elsewhere on the page
   (`intro`'s operator name, `s3.i2`'s providers and `s3.i5`'s countries) are launch details outside this
   spec and stay until the operator is known. Orchestrator: confirm, or name the spec that fills them.
   **Confirmed (orchestrator, 2026-11-15):** AC12 covers the retention lines only; the operator, provider,
   country and date placeholders are Gilad's legal items for launch (HANDOFF Next Steps 2).

## Verifier findings (2026-11-15)
1. `listings.floor` is NOT NULL (migration 0003), so Scope 1's `floor = NULL` would fail: added migration
   0027 (DROP NOT NULL, data-safe downgrade) and AC14; response schemas unchanged with the reason.
2. R3 cleared `close_reason` without `closed_at`, violating `ck_listings_closed_at`: R3 now clears only
   `final_rent_ils` (the product line), filtered on `IS NOT NULL` for idempotency.
3. R1's `max(conversations.last_message_at)` had no join path (conversations have no listing id): now
   through `applications.listing_id`; `greatest` NULL behaviour stated.
4. R1, R4 and R5 could delete what an unresolved report points at (a reported chat before the admin reads
   it): each skips it now (reading of "Unresolved reports: until resolution"), AC13 added. Digest FYI.
5. R8's "whose target's email block (R9) is still live" cannot be computed (`blocked_emails` has no user
   id) and, for a live account, no block row exists yet, so a 3-year-old `suspend` would silently lift the
   future re-signup block: R8 now keeps `suspend` / `hide_listing` on a not-deleted account; AC8 extended.
   Digest FYI.
6. R4's flatmates: a deleted flatmate's `listing_flatmates` rows are already gone (0013c step 9), and room
   chats reach flatmates through `applications.listing_id`: rule rewritten as "no live flatmate".
7. Idempotency (AC11): fixed the rule order (R4 before R5) and added `IS NOT NULL` filters to R3/R6.
8. `updated_at` confirmed as the decision time for declined/withdrawn (`services/applications.py` sets it on
   every status change; 0013c step 6 too). No change.
9. AC1 named a non-existent file (`test_account_delete.py`): now `test_account_deletion.py`. AC11/AC12 named
   no function: named.
10. Scope 5 edited another open spec (0013a, verified, unbuilt) and a file that does not exist
    (`infra/DEPLOY.md`): moved to Out, the orchestrator adds the line to 0013a as a docs commit.
11. Migration "only if EXPLAIN shows a seq scan" left the coder to guess: no indexes (Out, with the reason).
12. `s5.i9` holds a "[משך שמירת היומנים]" placeholder and four keys say "בלי הגבלת זמן": named in Scope 5 and AC12.
13. Reviewers: `qa` added (UI text change, checklist 8; a deletion job's edges). Estimate stays 1 coder run (long).
14. Risk 4 (tombstone PII): confirmed none; written into the risk.

## Digest (filled by orchestrator after verification)
