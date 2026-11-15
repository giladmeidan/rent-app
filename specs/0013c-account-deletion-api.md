---
id: 0013c
title: "A person deletes their own account: their data goes, the people they talked to keep the thread, and an account homie acted against cannot sign up again"
status: in-review
depends_on: []
reviewers: [code, security, qa]   # security: PII deletion, the keyed email hash, the auth flow; qa: every place a deleted account could still appear
estimate: 1 coder run   # a long one, at the limit: three race tests (AC13-AC15) and the key's wiring in 4 places; coder Opus/high (data, migration, PII; Speed rule 6); the web half is 0013f
---

## Goal
After this ships, a signed-in person can delete their own account with `DELETE /me`. PRODUCT.md "Launch
(Slice 13)", Gilad 2026-11-15:
- their personal data goes: email, name, photo, profile, likes, sessions and listing photos;
- the other people in their chats keep the thread, their messages stay under "משתמש/ת שנמחק/ה", and
  sending closes;
- reports about the account are kept;
- an account the admin acted against cannot sign up again with the same email, and only a keyed hash of
  that email is kept;
- an account with reports but no admin action can sign up again.

This is the API and migration half. `0013f` is the web half: the profile's delete button, the
placeholders, the terms and privacy pages and their Hebrew text.

## Decisions this spec builds on
- PRODUCT.md "Launch (Slice 13)" (Gilad, 2026-11-15): self-serve deletion, the thread rule, the reports
  rule, the re-signup rule, and the terms and privacy text drafted by the orchestrator (0013f).
- **The account row stays as a scrubbed tombstone; it is not deleted.** Every user FK is `ON DELETE
  CASCADE` today (14 FKs in 11 tables, below). Deleting the row would cascade through
  `listings → applications → conversations → messages` and erase the other side's threads, and through
  `reports` erase the evidence. Keeping the row with `deleted_at` set and the PII columns NULL keeps every
  FK valid. So no FK changes and nothing needs a backfill, and the admin's views of reports and chats keep
  resolving their users. The cascades stay as they are, for a row nobody deletes; the admin role has no
  DELETE grant (0012b).
- **Re-signup block** (orchestrator's reading of Gilad's "if there was an action against him, do not let
  him sign up again"; see Risks): an `admin_actions` row `suspend` on the user, or `hide_listing` on one of
  their listings, **even if later lifted** (`unsuspend`, `unhide_listing`). `set_listing_cap`,
  `resolve_reports` and `read_chat` are not actions against the account.
- **Confirmation: a recent sign-in.** `DELETE /me` needs the calling session to be younger than 15 minutes
  (`DELETE_REAUTH_S = 900`); otherwise 403 `reauth_required`, and the web (0013f) asks for a fresh sign-in
  with an emailed code. Deletion cannot be undone, so the same proof that opens the account (the mailbox)
  is asked again. A session left open on a shared computer, or a copied cookie, cannot delete the account.
  This reuses the login flow and adds no new code path for one-time codes. A typed confirm word was
  considered: it stops a slip, not a borrowed session. The web's confirm dialog handles the slip.
- **Defaults this spec sets (digest FYI, Gilad may overrule):**
  - reports **made by** the deleted account are kept (the reporter row is a tombstone with no PII; the
    report is still evidence about its target);
  - the deleted account's **listings stay as paused rows**, without photos, description or invite link.
    The seekers who applied keep the listing in their threads and lists, and its price history keeps
    feeding the rent estimate (PRODUCT.md "Rent price estimate": captured because it cannot be
    recovered). Nobody can see or resume them.
- PRODUCT.md "Rooms" privacy-pass note ("revisit in the pre-launch privacy pass"): **kept as is**. A
  room's flatmate ages and questionnaire answers stay visible to signed-in seekers only. The privacy
  policy (0013f) says so. No behaviour change.
- FOLLOWUPS 0011b · `report.py` ("decide in the pre-launch privacy pass whether reports about a deleted
  account are kept"): decided "kept"; the tombstone keeps them with no schema change. The orchestrator
  ticks it after merge.

## Scope
**In:**
- **Migration and models:**
  - `0025_account_deletion` (Data);
  - `api/app/models/user.py`: `deleted_at`, nullable `email` / `display_name`, the CHECK and the
    partial index;
  - a new `api/app/models/blocked_email.py` (`BlockedEmail`), exported from `app/models/__init__.py`.
- **Deletion:** a new `api/app/services/accounts.py`:
  - `delete_account(db, store, user) -> None`, the order below;
  - `email_hmac(email) -> str`;
  - `email_blocked(db, email) -> bool`.
- **Endpoint:** `DELETE /me` in `api/app/routers/auth.py`, beside `GET /me` and `POST /auth/logout`. It
  clears the cookie with logout's exact attributes.
- **Sessions** (`api/app/services/auth.py`):
  - `session_created_at(db, token) -> datetime | None`, at the end of the file beside `resolve_session`. It
    is one SELECT by `token_hash` of a live session;
  - `resolve_session` adds `User.deleted_at.is_(None)` beside `suspended_at`, still one statement (API).
- **Sign-up block:** `services/auth.py::verify_otp` refuses a blocked email (the exact boundary is in
  API), with a new `SignupBlockedError`; `routers/auth.py` maps it to 403 `signup_blocked`.
- **Config** (`api/app/config.py`, and every place that starts the API or the worker):
  - `email_block_key: SecretStr`, required with no default in code (as `secret_key`), at least 32
    characters, by a field validator like `_secret_key_is_long_enough`;
  - `DEV_EMAIL_BLOCK_KEY = "dev-only-email-block-key-0123456789abcdef"` beside `DEV_SECRET_KEY`: the public
    dev value of the three files below;
  - `_email_and_production_rules` refuses it when `WEB_ORIGIN` is https ("EMAIL_BLOCK_KEY must not be the
    dev value when WEB_ORIGIN is https"), as the **last** check of the https block, so the existing tests
    that expect an earlier https error are unchanged. The trigger is the https origin, as for
    `DEV_SECRET_KEY`, not 0013a's non-empty `FLY_APP_NAME`: it needs nothing from 0013a, and on Fly 0013a
    requires an https `WEB_ORIGIN`, so it covers Fly too;
  - `infra/docker-compose.yml`: `EMAIL_BLOCK_KEY: ${EMAIL_BLOCK_KEY:-dev-only-email-block-key-0123456789abcdef}`
    in the `api` and the `worker` `environment:`. Compose passes no `env_file`, and the worker loads
    `Settings` at import;
  - `Makefile`: `export EMAIL_BLOCK_KEY ?= dev-only-email-block-key-0123456789abcdef` under `SECRET_KEY`.
    pytest, `make client` and CI's `make test` read it from there;
  - `.env.example`: `EMAIL_BLOCK_KEY=dev-only-email-block-key-0123456789abcdef`, uncommented, under
    `SECRET_KEY`, with a comment: at least 32 characters, never rotate it, this dev value is refused on
    https. Production sets its own as a Fly secret: 0013a's Scope 1 and runbook §6 already do, from
    `openssl rand -hex 32`, kept in Gilad's password manager.
- **Chat** (`api/app/services/chat.py`):
  - `_can_send()` also requires that neither `owner_id` nor `seeker_id` is a deleted account;
  - names of a deleted account come back NULL, because the column is NULL;
  - the dataclass `Member.name` becomes `str | None`: `get_thread` builds it from the owner's and the
    seeker's names;
  - `api/app/schemas/chat.py`: `MemberOut.name`, `MessageOut.sender_name`, `ConversationOut.other_name`
    and `ThreadOut.other_name` become `str | None`, each documented "null = a deleted account (0013c)";
  - `routers/chat.py` follows the types.
- **Photos:** `api/app/services/photos.py::_lock_own_listing` refuses a listing whose owner is a deleted
  account with `ListingNotFoundError` (API).
- **Flatmates:** `api/app/schemas/flatmates.py` `MyFlatOut.owner_name: str | None` (null = the owner
  deleted their account). The invite preview's `owner_name` stays `str`, since a deleted owner's invite
  hash is cleared.
- **Admin** (`api/admin/`, views and the chat transcript only; no auth code):
  - `views.py::_person` shows `deleted account (<id>)` for a deleted user;
  - `UserView`'s list gains `deleted_at`;
  - `actions.py`'s reported-chat transcript reads `coalesce(display_name, '(deleted account)')` in its
    three name selects.
- **Tests:**
  - `api/tests/test_account_deletion.py` (new);
  - `api/tests/test_admin.py` (one new test at the end);
  - `api/tests/test_migrations.py`;
  - `api/tests/test_config.py` (one new test; `_HTTPS_READY` and the one valid https `Settings` in
    `test_https_web_origin_refuses_dev_defaults` gain a non-dev `email_block_key`);
  - `api/tests/test_hardening.py` (`("DELETE", "/me")` joins `EXEMPT`);
  - `api/tests/conftest.py` (`db_engine`'s TRUNCATE gains `blocked_emails`);
  - `test_chat.py` / `test_direct_chat.py` / `test_flatmates.py` only where a typed name changes.
- `make client` regenerates `web/src/api/schema.d.ts` (git-ignored). The web's use of it is `0013f`'s.

**Out:**
- the web: profile button, dialog, placeholders, legal pages, footer (`0013f`);
- deletion by the admin, and a grace period or undo (deletion is immediate and final);
- a deleted account's open SSE stream on another device (see Risks);
- Gmail-style address aliases (dots, `+tag`) for the block: the HMAC is over `normalise_email` only;
- an email confirming the deletion;
- deleting a currently suspended account (it cannot sign in, so it cannot call `DELETE /me`).

**New dependencies:** none (`hmac` / `hashlib` from the standard library).

## Data
Migration `api/alembic/versions/0025_account_deletion.py` (`down_revision` 0024, `0012a`'s; see Risks for
the number):

| Table | Change | Rule |
| --- | --- | --- |
| `users` | `deleted_at timestamptz NULL` | NULL = a live account. Set once by `delete_account`; never cleared |
| `users` | `email` and `display_name` **DROP NOT NULL** | NULL only on a deleted account. `UNIQUE (email)` allows many NULLs, and `_find_user` never matches NULL, so a deleted account's email is free for a new sign-up unless blocked |
| `users` | `ck_users_deleted_scrubbed CHECK ((deleted_at IS NULL AND email IS NOT NULL AND display_name IS NOT NULL) OR (deleted_at IS NOT NULL AND email IS NULL AND display_name IS NULL AND photo_key IS NULL))` | A live account has both; a deleted one has neither name, email nor photo. `ck_users_display_name_length` passes on NULL, unchanged |
| `users` | index `ix_users_deleted ON users (id) WHERE deleted_at IS NOT NULL` | The chat's "no deleted party" check reads only deleted rows (0012a's `ix_users_suspended` pattern) |
| `blocked_emails` (new) | `email_hmac text PRIMARY KEY`, `created_at timestamptz NOT NULL DEFAULT now()` | `ck_blocked_emails_hmac CHECK (email_hmac ~ '^[0-9a-f]{64}$')`. No user id: the row cannot be tied back to the tombstone |

- **No FK changes.** Every row a deleted account is referenced by keeps a valid FK to the tombstone:
  conversations, messages, the kept applications, listings, reports and admin actions. Existing rows all
  satisfy the new CHECK (deleted_at NULL, email and name set), so there is no backfill.
- **Backwards-compatible with the running app:** the columns only become nullable, and no NULL exists
  until `DELETE /me` (shipped in the same PR) writes one. The old code never meets a NULL, and the new
  table is unread until then.
- **Downgrade, data-preserving:**
  1. Drop `ck_users_deleted_scrubbed` and `ix_users_deleted`. The CHECK goes first: it requires a deleted
     row to have NULL email and name, so it would refuse step 2.
  2. `UPDATE users SET email = id::text || '@deleted.invalid', display_name = 'deleted' WHERE deleted_at
     IS NOT NULL`. RFC 2606 `.invalid`: nobody can receive a code there, so these rows never sign in.
  3. Drop `deleted_at`.
  4. `SET NOT NULL` on `email` and `display_name`.
  5. Drop `blocked_emails`.
  Kept threads and reports survive a downgrade.
- The model matches the migration exactly (autogenerate sees no diff): `email: Mapped[str | None]`,
  `display_name: Mapped[str | None]`. `routers/auth.py::user_out` (always a live account) asserts both
  are not None.

**What `delete_account` does, one transaction, in this order** (`me` = the caller):

| # | Table | Statement | Why |
| --- | --- | --- | --- |
| 1 | `users` | `SELECT deleted_at, email, photo_key … WHERE id = :me FOR UPDATE`, read as columns, never as the identity-mapped `User` that `current_user` loaded (its attributes predate the lock; `_lock_photo_key`'s rule). **If `deleted_at` is already set, return at once:** nothing written, no object deleted | Serialises with listing create and resume, which lock the same row (0002a), with a login's `last_login_at` write, and with a second `DELETE /me` of the same account: that one waited here, finds the tombstone and writes nothing (the router still answers 204) |
| 2 | `admin_actions` → `blocked_emails` | If `EXISTS (action = 'suspend' AND target_type = 'user' AND target_id = :me) OR (action = 'hide_listing' AND target_type = 'listing' AND target_id IN (my listing ids))`: `INSERT (email_hmac(<step 1's email>)) ON CONFLICT DO NOTHING` | The re-signup rule. Listing rows are never deleted, so the ids still resolve |
| 3 | `listings` | `UPDATE … SET status = 'paused', description = NULL, flatmate_invite_hash = NULL, updated_at = now() WHERE owner_id = :me` | Off the public site (only `active` is public), the invite preview 404s, free text (which may hold phone numbers) is gone. The row stays for the threads and the price history. **Before the photo rows:** its row locks wait for a photo write that holds `_lock_own_listing`, so step 4 sees that write's committed row |
| 4 | `listing_photos` | Collect `key` of my listings' photos, plus step 1's `photo_key`; then `DELETE … WHERE listing_id IN (my listings)` | Objects deleted after commit (step 13). A photo write that reaches `_lock_own_listing` after step 3 is refused there (API) |
| 5 | `applications` (made by me) | `DELETE … WHERE seeker_id = :me AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.application_id = applications.id)` | Nobody's thread hangs on them |
| 6 | `applications` (made by me) | `UPDATE … SET status = 'withdrawn', updated_at = now() WHERE seeker_id = :me AND status <> 'withdrawn'` | The rest have a chat: a withdrawn application is invisible to its owner (0004c) and no transition starts from it; its chat stays |
| 7 | `room_pairs` | `DELETE … WHERE seeker_id = :me OR listing_id IN (my listings)` | My room likes and the browse history of my rooms |
| 8 | `person_pairs` | `DELETE … WHERE :me IN (user_low, user_high)` | My market likes and matches. The direct chat row stays |
| 9 | `listing_flatmates`, `conversation_reads` | `DELETE … WHERE user_id = :me` | I leave every flat I joined; my read markers go. Other people's memberships of **my** flats stay (they keep the room chats) |
| 10 | `seeker_profiles` | `DELETE … WHERE user_id = :me` | Profile, card, questionnaire, "about me" |
| 11 | `sessions` | `DELETE … WHERE user_id = :me` | Every device is signed out at once |
| 12 | `users` | `UPDATE … SET deleted_at = now(), email = NULL, display_name = NULL, photo_key = NULL, last_login_at = NULL WHERE id = :me` | The tombstone. `id`, `role`, `account_type`, `created_at`, `listing_cap`, `suspended_at` and `card_id` (random, never shown again) stay |
| 13 | — | commit; then delete every collected object name (`photos.object_names`) with `photos._discard`, as a listing-photo delete does (rename it public if the coder prefers) | A failed object delete logs a count only and leaves an unreferenced object (0010d's accepted risk) |

**Kept unchanged:**
- `messages` (mine stay in others' threads, under a NULL name);
- `conversations`;
- applications **received** on my listings (their chats close through `_can_send`);
- `reports`, made by me and about me;
- `admin_actions`;
- `listing_price_changes` and the closure answers on my listings.

Any failure before the commit rolls everything back and deletes no object.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| DELETE | `/me` | session cookie (`current_user`), **and** that session's `created_at` within `DELETE_REAUTH_S` (900 s) | none | 204, `Set-Cookie` clearing `rent_session` (logout's exact attributes). Also 204, with nothing written, for a second call that raced the first and found the tombstone (step 1) | 401 `unauthenticated`; 403 **`reauth_required`** (session older than 15 min, nothing written); 503 (database or Redis down, as every route) |
| any | every route that reads the session (`current_user`, `optional_user`, `GET /me/events`) | as today | — | — | a session row of a deleted account no longer resolves: 401 `unauthenticated` where a session is required, signed out where it is optional |
| POST | `/auth/otp/verify` | none | as today | as today | new 403 **`signup_blocked`**: the right code for an email with no live account whose `email_hmac` is in `blocked_emails`. The code is consumed, and no user, no session and no cookie are written |
| POST | `/auth/otp/request` | none | unchanged | unchanged: a blocked email still gets a code, so nobody learns an email is blocked without its mailbox | — |
| GET | `/me/conversations`, `/conversations/{id}` | member | — | `other_name`, `members[].name` and `messages[].sender_name`: **null** for a deleted account. `can_send` false when the owner or the seeker of the conversation is a deleted account | — |
| POST | `/conversations/{id}/messages` | member | — | — | 409 `chat_closed` when the owner or the seeker is a deleted account (the `INSERT … SELECT` snapshot, as today) |
| GET | `/me/flats` | session | — | `owner_name`: **null** when the flat's owner deleted their account | — |
| POST, DELETE, PUT | `/listings/{listing_id}/photos`, `/listings/{listing_id}/photos/{photo_id}`, `/listings/{listing_id}/photos/order` | owner, as today | as today | as today | 404 `not_found` also when the listing's owner is a deleted account (a write in flight when `DELETE /me` committed), as for an unknown or another owner's listing; nothing written, an upload's objects discarded |

- **`verify_otp` boundary** (shared with 0013b, which owns `request_otp` / `_count_request` and the
  lockout keys):
  1. after the HMAC compare matches and `user = _find_user(db, email)`;
  2. **before** the `user is None and profile is None` refund branch;
  3. `if user is None and accounts.email_blocked(db, email):` claim the code (`_SETTLE_CODE` `del`) and
     raise `SignupBlockedError`, outside the `try` whose `except` restores the code (0012a's suspended
     pattern).

  A blocked person learns at the first verify, on the login page or the sign-up page, before filling the
  sign-up form.
- **`email_hmac`:** `hmac.new(settings.email_block_key, normalise_email(email).encode(),
  sha256).hexdigest()`. It is keyed rather than a plain SHA-256: an email address is guessable, so anyone
  holding a dump of `blocked_emails` could hash candidate addresses and confirm who was banned. The key
  lives only in the API's environment, never in Postgres (the admin role reads every table but no env).
  It is a dedicated key, not `SECRET_KEY`: rotating `SECRET_KEY` (OTP codes, harmless to rotate) must
  never silently empty the block list. This key is never rotated, since the hashes cannot be re-keyed
  without the emails. That is why the settings refuse the public dev value on https: a production that
  started with it would have to keep it, and anyone could hash candidate addresses against the dump.
- **Sessions of a deleted account:** `resolve_session` requires `User.deleted_at IS NULL` beside
  `suspended_at`, still one statement, so `current_user`, `optional_user` and the event stream's
  `_user_id_for` refuse them. Step 11 deletes every session, but a login racing the deletion can add one
  after it: a `verify_otp` that read U's row (`_find_user`) just before the commit waits on step 1's lock at
  its `last_login_at` write, then updates the tombstone, and `create_session` inserts a row for it. That
  row now resolves to nobody (AC14).
- **Photo writes:** `_lock_own_listing`, right after its `FOR NO KEY UPDATE` on the listing and before the
  `removed` check, reads the owner's `deleted_at` in a **second statement** and raises
  `ListingNotFoundError` when it is set. `add_listing_photo` then discards both objects, as on any failure.
  It is a separate statement, not a `NOT EXISTS` inside the lock (0012a's `not_suspended`): under READ
  COMMITTED, a locking statement that waited re-checks only the locked listing row and keeps its starting
  snapshot for `users`, so it would miss the deletion it waited for. A new statement after the lock sees
  it. With step 3 taking the listing locks before step 4 reads the photos, an upload either commits before
  step 4 (its row and objects are deleted) or is refused here. `_lock_own_listing` still sends one
  `FOR NO KEY UPDATE` per call (`test_photos.py::test_ac4_limit_of_ten_under_concurrency` counts them).
- **`_can_send()`** gains `AND NOT EXISTS (SELECT 1 FROM users d WHERE d.id IN (conversations.owner_id,
  conversations.seeker_id) AND d.deleted_at IS NOT NULL)`. It is over an anonymous alias, as
  `not_suspended`, so it never correlates with a `users` the statement already joins, and it reads
  `ix_users_deleted`. The list, the thread and the send use it unchanged, with no new statement. A
  flatmate who deletes their account is not a party: they left the flat in step 9, and the room chat goes
  on without them, with their old messages under a NULL name.
- **Logging:** `delete_account` logs one `info` line, `account deleted` plus the object count. It never
  logs the email or the name.
- **Rate limit:** `DELETE /me` is in `test_hardening.py`'s `EXEMPT`, like logout. It succeeds at most once
  per account, and the 15-minute sign-in bounds it. No `limits.py` change.

## UI
None in this spec (`0013f`).

## Acceptance criteria
- [ ] AC1 Given a user U signed in on two devices with a fresh session, When `DELETE /me`, Then 204, the
  response clears `rent_session` with logout's attributes, U has no `sessions` row, and both devices' next
  `GET /me` is 401 `unauthenticated` —
  `api/tests/test_account_deletion.py::test_ac1_delete_signs_out_everywhere`
- [ ] AC2 Given U's session created 16 minutes ago (set `sessions.created_at` back), When `DELETE /me`, Then
  403 `reauth_required` and no row anywhere changed; with a session of 14 minutes it succeeds —
  `test_ac2_old_session_needs_fresh_sign_in`
- [ ] AC3 Given U with every footprint:
  - a profile and a person photo;
  - an apartment and a room listing, each with 2 photos and an invite link on the room;
  - an application made with no chat, and one made and shortlisted (chat with 1 message from U);
  - an application received on U's apartment, shortlisted with a chat;
  - a direct chat with P;
  - a flatmate spot in another owner's room, with a read marker;
  - a room like and a market like;
  - a report made by U and one about U;

  When U deletes the account, Then each table is as the "What `delete_account` does" table says:
  - deleted: the photo rows and all 10 photo objects (4 listing photos × 2 sizes, plus the person photo's
    2) are gone from the `FilePhotoStore` dir;
  - kept as specified: both listings `paused` with NULL description and invite hash, the no-chat
    application deleted, the chat application `withdrawn`;
  - also deleted: pairs, the membership, the read marker and the profile;
  - the U row has `deleted_at` set and NULL email, name, photo and last login;
  - messages and reports are untouched.

  — `test_ac3_footprint_after_deletion`
- [ ] AC4 Given AC3's state, When P, U's applicant and the other owner read their chats, Then:
  - every thread is still listed and readable;
  - U's messages are there with `sender_name` null and `mine` false;
  - U's `members[].name` and `other_name` are null;
  - `can_send` is false;
  - `POST /conversations/{id}/messages` is 409 `chat_closed`.

  In the other owner's room chat (U was a flatmate), the owner and the seeker still send, and U's old
  messages show with a null name. —
  `test_ac4_others_keep_threads_and_sending_closes`
- [ ] AC5 Given AC3's state, When a visitor and a signed-in seeker call:
  - `GET /listings` (apartments, market rooms, `bbox`);
  - `GET /listings/{id}` of both;
  - `GET /people`, `GET /me/likes`, `GET /me/people-likes`;
  - `GET /listings/{id}/people` and `GET /listings/{id}/applications` of the owner U applied to;
  - the other owner's room page (`GET /listings/{id}`, its flatmates);
  - `POST /flatmate-invites/preview` with U's old token;

  Then U appears nowhere (404 or absent), no response is a 500, and U's withdrawn application is absent
  from the owner's applicants — `test_ac5_deleted_account_is_gone_everywhere`
- [ ] AC6 Given a flatmate F of U's room, When F calls `GET /me/flats`, Then the flat is listed with
  `owner_name` null, and F can still read the room's application chat — `test_ac6_my_flats_owner_deleted`
- [ ] AC7 Given U with an `admin_actions` `suspend` row later followed by `unsuspend`, and separately V
  with only a `hide_listing` row on one of V's listings, When each deletes the account, Then:
  - `blocked_emails` holds exactly `email_hmac` of each;
  - a new sign-up with that email (any case, with surrounding spaces) answers 403 `signup_blocked` at the
    first verify, with and without `profile`;
  - the code is consumed, and no `users` row or session is created;
  - `POST /auth/otp/request` for that email is still 204.

  — `test_ac7_admin_action_blocks_re_signup`
- [ ] AC8 Given W with two reports about W, a `set_listing_cap` and a `read_chat` action, but no
  `suspend` / `hide_listing`, When W deletes the account, Then:
  - no `blocked_emails` row is written;
  - signing up again with W's email creates a new account with a new id;
  - the two reports still point to the old tombstone.

  — `test_ac8_reports_alone_do_not_block`
- [ ] AC9 The block hash is keyed:
  - `email_hmac(e)` ≠ `sha256(e)`;
  - it changes when `EMAIL_BLOCK_KEY` changes;
  - it does not change when `SECRET_KEY` changes;
  - the settings require `EMAIL_BLOCK_KEY`, refuse one under 32 characters, and refuse
    `DEV_EMAIL_BLOCK_KEY` when `WEB_ORIGIN` is https, with no input value in the error; plain http accepts
    the dev value.

  — `test_ac9_block_hash_is_keyed`, `api/tests/test_config.py::test_ac9_email_block_key_rules`
- [ ] AC10 Given a report about a deleted account and a reported chat with its messages, When the admin
  lists reports and opens the chat, Then the report shows `deleted account (<id>)`, the transcript shows
  `(deleted account)` for U's messages and member, and nothing errors —
  `api/tests/test_admin.py::test_deleted_account_in_reports_and_chat`
- [ ] AC11 Migration `0025` upgrades and downgrades cleanly. Given a tombstone as `delete_account` leaves
  it (`deleted_at` set; NULL email, name and photo) with messages and a report, When downgrading to 0024,
  Then the downgrade succeeds, the row has `<id>@deleted.invalid` / `deleted`, and its messages and report
  are kept; upgrading again works. Autogenerate sees no diff — `api/tests/test_migrations.py` (the existing
  round-trip and no-diff tests, plus `test_0025_downgrade_keeps_tombstones`)
- [ ] AC12 `("DELETE", "/me")` is in `EXEMPT`, and `test_hardening.py::test_ac1_every_write_route_has_a_limit`
  passes — `test_hardening.py`
- [ ] AC13 Given U with a `suspend` then `unsuspend` (so step 2 writes) and two fresh sessions, When both
  call `DELETE /me` at once (a barrier just before `delete_account`, as
  `test_photos.py::test_ac4_limit_of_ten_under_concurrency`'s `lock_together`), Then:
  - both answer 204 and neither is a 500;
  - there is one tombstone and one `blocked_emails` row;
  - calling `delete_account` again on the tombstone leaves `deleted_at` and every table unchanged and
    deletes no object.

  — `test_account_deletion.py::test_ac13_concurrent_deletes_are_one_deletion`
- [ ] AC14 Given a `verify_otp` login for U's email whose `_find_user` has read U's row and then waits
  (monkeypatched) until U's `DELETE /me` has committed, When the login completes and its cookie calls
  `GET /me`, `POST /listings` and `GET /me/events`, Then each answers 401 `unauthenticated`, none is a 500,
  and the tombstone still has NULL email, name and photo — `test_ac14_late_login_session_is_refused`
- [ ] AC15 Given a photo upload to U's listing that has put its two objects:
  - When it reaches `_lock_own_listing` while `DELETE /me` holds step 3's listing locks, and the deletion
    then commits, Then the upload answers 404 `not_found`, no `listing_photos` row is written and its two
    objects are deleted;
  - When it takes the listing lock first, Then the deletion waits for its commit and still deletes that
    photo row and its objects.

  Either way no object of U's listings is left in the `FilePhotoStore` dir —
  `test_ac15_upload_racing_deletion_leaves_no_photo`
- [ ] NF1 Deletion is atomic: with a failure injected after step 10 (monkeypatch), every row is as before
  and no photo object is deleted — `test_account_deletion.py::test_nf1_failure_rolls_back_everything`
- [ ] NF2 No email or display name of the deleted account appears in any log record emitted during
  `DELETE /me` (caplog) — `test_nf2_no_pii_in_logs`
- [ ] NF3 The chat reads keep their statement counts: `test_direct_chat.py::test_ac7_statement_counts_and_plan`
  and `test_flatmates.py::test_ac12_list_uses_indexes_for_every_role` pass unchanged (the `NOT EXISTS`
  adds no statement) — existing tests

## Tests to write
Unit: `email_hmac` (keyed, normalised; AC9); the key's settings rules (`test_config.py`, AC9).
Integration (Postgres via compose): `test_account_deletion.py` AC1–AC9, AC13–AC15, NF1, NF2;
`test_admin.py` AC10; `test_migrations.py` AC11; `test_hardening.py` AC12. AC13–AC15 are thread races
with a barrier or an event and a timeout, as `test_photos.py::test_ac4_limit_of_ten_under_concurrency`.
E2E: none here (0013f's `web/e2e/account.spec.ts` covers the whole flow, CI only).

## Blast radius
From `graphify affected` on `main` (84b6fef), checked with grep:
- `services/chat.py::_can_send` → `list_statement` (`list_conversations`, `GET /me/conversations`),
  `get_thread` (`GET /conversations/{id}`), `send_message` (`POST …/messages`). Statement-count tests
  `test_direct_chat.py::test_ac7_statement_counts_and_plan` and
  `test_flatmates.py::test_ac12_list_uses_indexes_for_every_role` must stay green (NF3).
- `schemas/chat.py` `MemberOut`, `MessageOut`, `ConversationOut`, `ThreadOut` → `routers/chat.py`
  (`_conversation_out`, `get_thread`, `send_message`, whose `sender_name=me.display_name` is now
  `str | None`) and `main.py`'s OpenAPI export (`test_openapi_export.py`). Web consumers
  (`ChatThreadPage.tsx`, `ConversationsPane.tsx`) are `0013f`'s; `tsc` flags them after `make client`.
- `schemas/flatmates.py::MyFlatOut` → `routers/flatmates.py::my_flats` → web `MyFlatsPage.tsx` (0013f).
- `services/auth.py::verify_otp` → `routers/auth.py::verify_otp`. Tests `test_auth.py::verify`,
  `test_otp_single_use_under_concurrency` and `test_code_survives_database_failure_at_login` stay green
  as long as the block sits after the claim and outside the restoring `try` (as 0012a's suspended check).
- `models/user.py::User` with nullable `email` / `display_name`: mypy reaches:
  - `routers/auth.py::user_out` (asserts);
  - `admin/views.py::_person` and `admin/actions.py`'s transcript (coalesce);
  - `services/auth.py`'s INSERT (unchanged).

  Every other `display_name` reader (`applications.py`, `people.py`, `market_people.py`,
  `flatmates.py`, `search.py`'s room page) never meets a deleted row, by the data rules in AC5. It
  selects columns into untyped rows, so mypy is quiet: AC5 is the guard.
- `services/chat.py::Member` (`graphify affected "Member"`): built by `services/chat.py::get_thread` from
  the header's `owner_name` / `seeker_name` and the flatmates' `display_name`; read by
  `routers/chat.py::get_thread` into `MemberOut.name`. The rows are untyped, so mypy would not have
  flagged the NULL. A flatmate's name is never NULL (a deleted flatmate left in step 9). Web: 0013f's
  `ChatThreadPage.tsx` already shows `t('account.deletedName')` for a null name on the members line
  (`memberWithRole`), the header and each sender.
- `services/auth.py::resolve_session` (`graphify affected`): `app/auth.py::optional_user` and through it
  `current_user`, so every signed-in route (the routers `applications`, `auth`, `chat`, `flatmates`,
  `listings`, `market_people`, `people`, `photos`, `profiles`, `rent_estimate`, `reports`; `search` via
  `optional_user`); `routers/events.py::_user_id_for` → `stream_user_id`, so the SSE connect and every
  reconnect. Tests: `test_auth.py`, `test_moderation.py` (suspended sessions), `test_chat_events.py`
  (imports it). They have no deleted row, so only AC1 and AC14 see the new condition.
- `services/photos.py::_lock_own_listing` (`graphify affected`): `add_listing_photo`,
  `delete_listing_photo`, `reorder_listing_photos` → `routers/photos.py` upload, delete (`:267`), reorder
  (`:295`). `test_photos.py::test_ac4_limit_of_ten_under_concurrency` counts `FOR NO KEY UPDATE` (still 2;
  the new read takes no lock), `test_moderation.py`'s removed-listing refusals keep their order.
  `api/scripts/seed_promo.py`: main checkout only, not on `main`.
- `config.py::Settings` (`graphify affected`): `get_settings()` → `create_app` (`main.py`), `worker.py`'s
  `WorkerSettings.redis_settings` at import, and every `get_settings()` reader (`routers/auth.py`,
  `services/auth.py::_code_hmac`, `photos.py`, `email.py`, `geocoding.py`, `chat_events.py`, ...), which
  read other fields and are unchanged. What a required key breaks is every place that builds `Settings`
  without it:
  - the compose `api` and `worker` and the `Makefile` (Scope);
  - the 12 `test_config.py` tests, which read it from the Makefile's export, except the https ones, which
    get it from `_HTTPS_READY` or explicitly;
  - `test_openapi_export.py::test_ac6_openapi_export_without_server`, which builds the environment from
    `.env.example` alone, so that file's `EMAIL_BLOCK_KEY=` line carries the dev value, uncommented;
  - `test_cbs_rent.py::_settings` and the other `get_settings()` copies in tests, which read the export.

  `DatabaseSettings` (Alembic, `scripts/seed.py`) and the admin's `AdminSettings` do not change. 0013a owns
  the Fly secret, `test_deploy.py`'s fake-secret constant and the runbook line that sets the key.
- `tests/conftest.py::db_engine` TRUNCATE list gains `blocked_emails`.
- `test_hardening.py` `EXEMPT` gains `("DELETE", "/me")`.

## Risks / open questions
- **Two rare races, accepted (orchestrator, 2026-11-15).** A `PUT /me/photo` racing the deletion trips
  `ck_users_deleted_scrubbed` and answers 500. A listing resume racing it can deadlock (the two take their locks in
  opposite order); Postgres aborts one of the two, which answers 500. In both cases no data is lost or left behind:
  the deletion either wins or is retried by the user. The coder adds a `shortcut:` comment at each site and does not
  re-order the locks in this spec.
- **The re-signup reading** (for the digest, not blocking): "an action against him" is read as any
  `suspend` or `hide_listing`, **even if later lifted**. The other reading, only an action still in force
  at deletion, would need one more condition. A currently suspended account cannot sign in, so it can
  never self-delete; the rule matters for lifted suspensions and removed listings.
- **Migration number:** `0013e`'s `0025_admin_logins` also wants 0025. The second to merge renumbers to
  0026, with `down_revision` = `main`'s head at merge (the 0012a / 0015a rule).
- **Shared files with siblings:**
  - `services/auth.py`: this spec adds `SignupBlockedError`, the block branch inside `verify_otp` and
    `session_created_at` at the end; 0013b owns `request_otp`, `_count_request` and the OTP keys;
  - `routers/auth.py`: the new route and one new `except`; 0013b changes `request_otp`'s IP;
  - `api/admin/`: only `views.py::_person`, `UserView.column_list` and `actions.py`'s transcript selects;
    0013e owns `admin/auth.py`, `admin/main.py`, any CSRF wiring and `test_admin.py`'s `admin_client`
    fixture, which AC10's one new test uses as 0013e leaves it;
  - `test_hardening.py`: this adds one `EXEMPT` entry; 0013b may add per-IP cases;
  - `config.py` / `.env.example` / `test_config.py`: this adds one key, `DEV_EMAIL_BLOCK_KEY` and the last
    https check; 0013a and 0013b add theirs (0013a's `FLY_APP_NAME` rules sit in the same validator);
  - `infra/docker-compose.yml` and the `Makefile`: one `EMAIL_BLOCK_KEY` line each in the `api` / `worker`
    environments and the exports; 0013a adds the deploy targets;
  - `services/photos.py::_lock_own_listing`: this adds the deleted-owner read after the lock; 0013g adds
    `expires_at` to the lock's select and `ListingExpiredError` after `ListingRemovedError`. The deleted
    owner's `ListingNotFoundError` comes before both.

  Whoever merges second merges `origin/main` (Speed rule 3).
- **A write racing the deletion:** a request that resolved its session just before the commit can still
  land after it. Three races are closed:
  - a second `DELETE /me` finds the tombstone at step 1 and writes nothing (AC13);
  - a login's session for the tombstone never resolves (AC14). The racing login itself answers with the
    names it read before the commit, to the mailbox owner who is deleting, and stamps the tombstone's
    `last_login_at` (not PII, not in the CHECK);
  - a photo write in flight is refused or deleted with the rest (AC15), since an upload takes seconds to
    encode and would otherwise leave two public objects on the paused listing for good.

  Listing create and resume still wait on step 1's row lock, then run against the tombstone. A listing
  created that way would be live under a deleted owner, until it expires or the admin hides it. This is
  accepted: the caller is deleting themselves, and the window is one short request.
  `shortcut: not checked in create; add deleted_at IS NULL to the 0002a cap lock if it is ever seen.`
- **An SSE stream** already open on another device is checked at connect only (0012a). It ends within
  `STREAM_MAX_S` + jitter, and its reconnect gets 401. What can reach it meanwhile is at most an
  application-status event (ids only), since every chat it is a party of is closed.
- **A flatmate who deletes their account** leaves the flat (step 9). The room chats they were in stay
  open for the owner, the seeker and the other flatmates, as after any departure, with the deleted
  flatmate's old messages under the placeholder. "Sending closes" applies to chats where the deleted
  account is the owner or the seeker (FYI for the digest).
- **No chat event** is published for the applications step 6 withdraws. An owner's open inbox drops them
  on its next fetch, like 0012a's suspended footprint ("Join, leave and remove publish no chat event",
  HANDOFF Known Issues).
- **Production key:** `EMAIL_BLOCK_KEY` must be set in production and is **never rotated**: the hashes
  cannot be re-keyed without the emails. 0013a's Scope 1 and runbook §6 already set it as a Fly secret for
  the api and the worker, from `openssl rand -hex 32`, kept in Gilad's password manager. Losing it voids
  every block. The settings refuse the dev value on https, so a deploy that copied it from `.env.example`
  fails to start instead of hashing with a public key.
- **Coder, 2026-11-15: a type-only web change, so this PR's `make lint` is green.** After `make client` the
  nullable names failed `tsc` in `ChatThreadPage.tsx` (the page title), `ConversationsPane.tsx` (the
  avatar's initial) and 34 chat test lines. This PR adds `?? undefined` / `?? ''` at the two source sites
  (a deleted account's chat shows no name until 0013f's placeholder replaces them) and narrows the chat
  test fixtures' return types (`fixtures.ts`, plus two helper signatures). No text, no i18n key, no
  behaviour for a live account. 0013f swaps both sites for `t('account.deletedName')`.
- **The kept listing rows** hold the property's address and price, no longer linked to anyone
  identifiable. The privacy text (0013f) says they are kept for the threads and anonymous statistics.

## Verifier notes
One round (2026-11-15, against `main` 84b6fef). The orchestrator's fork ran it against
`.claude/agents/spec-verifier.md` itself, because a fork does not spawn agents. All 11 checks pass after
these fixes, applied to the text above:
1. the listings step also sets `listings.updated_at`;
2. a backwards-compatibility line for the running app (check 3);
3. the flatmate-deletes case made explicit against PRODUCT.md's "sending closes" (check 7);
4. the missing chat event for step 6's withdrawals named;
5. the real route names (`GET /listings/{id}/applications`, `POST /flatmate-invites/preview`);
6. the FK count (14 in 11 tables) and the photo-object count (10) corrected.

## Digest (filled by orchestrator after verification)
Spec 0013c — Self-serve account deletion and the re-signup block (API)   (verified 2026-11-15; part 1 of 2, 0013f is the web and the legal text)
What a user can do after this: delete their own account, with a sign-in from the last 15 minutes:
- their email, name, photo, profile, likes and listing photos go, and their listings leave the site;
- the people they talked to keep every thread, with "משתמש/ת שנמחק/ה", and can no longer send there;
- reports stay;
- an account you suspended, or whose listing you removed, cannot sign up again with that email. Only a
  keyed hash of it is kept.
Decisions I need from you: none blocking. Defaults I set (reply with a number to change one):
1. "an action against him" = any suspension or listing removal, even one you later lifted (alt: only
   one still in force);
2. deleting needs a fresh emailed code when the session is over 15 minutes old (alt: the confirm dialog
   only);
3. reports the account made are kept, like reports about it (alt: delete them);
4. its listings stay as hidden rows, without photos or description, for the applicants' threads and the
   rent statistics (alt: delete the ones nobody applied to);
5. room privacy pass: flatmate ages and answers stay visible to signed-in seekers only, unchanged.
KPIs this slice moves: launch readiness (privacy, trust).
Acceptance targets: NF1 all-or-nothing deletion; NF2 no email or name in logs; NF3 chat statement counts unchanged.
Risks:
- the account row stays as a scrubbed tombstone: every thread and report stays valid with no FK rewrite;
- `EMAIL_BLOCK_KEY` must be set in production and never rotated (0013a's checklist);
- migration 0025 races 0013e's: the second to merge renumbers.
Reviewers: code, security, qa   Estimated: 1 long coder run (Opus/high), 1 review round
Links: `specs/0013c-account-deletion-api.md` · PRODUCT.md "Launch (Slice 13)" · `specs/0013f-account-deletion-terms-web.md`

## Verifier findings (independent, 2026-11-15)
Against `main` 84b6fef, fresh (the "Verifier notes" above are the author's self-check). Checks 1, 2, 4–9 pass;
3, 10 and 11 fail on the items below.

1. **Check 3 / AC11 — the downgrade cannot run with a tombstone.** Downgrade step 1 (`UPDATE users SET email =
   …@deleted.invalid, display_name = 'deleted' WHERE deleted_at IS NOT NULL`) runs while
   `ck_users_deleted_scrubbed` still exists, and that CHECK requires a deleted row to have NULL email and name,
   so the UPDATE fails exactly in AC11's case. **Fix:** order the downgrade as: drop `ck_users_deleted_scrubbed`
   and `ix_users_deleted`; then the UPDATE; then drop `deleted_at`; then `SET NOT NULL`; then drop
   `blocked_emails`.
2. **Checks 10 and 11 — the new required setting is not wired, and `Settings` is missing from Blast radius.**
   `infra/docker-compose.yml` gives the `api` and `worker` containers an explicit `environment:` (no
   `env_file`), and the `Makefile` exports `SECRET_KEY ?= …`; `.env.example` alone never reaches them. With
   `email_block_key` required and no default, the API, the worker (it loads `Settings` at import) and CI's
   pytest all fail to start. Also, "validated like `secret_key`" does not say whether the dev value is refused
   on an https `WEB_ORIGIN`. That refusal matters more here than for `SECRET_KEY`: this key can never be
   rotated, so a production deploy that ships the public dev value voids the keyed hash for good. **Fix:** add
   to Scope:
   - `DEV_EMAIL_BLOCK_KEY` in `config.py`;
   - `_email_and_production_rules` refuses it when `WEB_ORIGIN` is https, with a `test_config.py` test, and
     `_HTTPS_READY` gains `email_block_key`;
   - `infra/docker-compose.yml` `api` and `worker` get `EMAIL_BLOCK_KEY: ${EMAIL_BLOCK_KEY:-<dev value>}`;
   - the `Makefile` gets `export EMAIL_BLOCK_KEY ?= <dev value>`.

   Add a Blast radius line for `Settings` (`graphify affected`: `get_settings`, `create_app`, `worker.py` at
   import, the 11 `test_config.py` tests; 0013a owns the Fly secret).
3. **Focus: sessions and races — a tombstone can get a live session.** A `verify_otp` login for U's email that
   reads U's row (`_find_user`) just before the deletion commits blocks on step 1's row lock at
   `user.last_login_at = …; db.commit()`. Then it updates the tombstone (`last_login_at` is not in the CHECK)
   and `create_session` inserts a session for it. `resolve_session` has no `deleted_at` condition, so that
   session resolves: `GET /me` hits `user_out`'s assert (500), and the tombstone can post listings, likes and
   messages. The same gap lets any session row that outlives step 11 resolve. **Fix:**
   - `resolve_session` adds `User.deleted_at.is_(None)` beside `suspended_at`, still one statement;
   - add it to Scope and Blast radius (`graphify affected`: `current_user`, `optional_user`,
     `routers/events.py::_user_id_for` / `stream_user_id`; it also ends the SSE reconnect);
   - an AC that a session row inserted for a tombstone answers 401.
4. **Races — a second `DELETE /me` racing the first.** Two concurrent calls on U's sessions both pass the
   session check. The second waits on step 1's lock, then runs steps 2–12 against the tombstone: it re-stamps
   `deleted_at` ("set once"), and step 2's `email_hmac` of the locked row's NULL email raises (500). **Fix:**
   after step 1's `FOR UPDATE`, if `deleted_at` is already set, return without writing (204). Step 2 reads the
   email from the locked row. Add an AC or an NF test (call `delete_account` twice; the second call is a
   no-op).
5. **Photos — an upload in flight outlives the deletion.** `photos.add_listing_photo` puts both objects
   first, then `_lock_own_listing` waits on step 4's listing UPDATE. After the commit it finds the listing
   still owned by U and not removed, and inserts a `listing_photos` row. Its two public objects then stay on
   the deleted account's listing, and nothing ever deletes them. This contradicts the Goal ("listing photos
   go"). An upload takes seconds to encode, so the window is wider than "one request". **Fix:**
   `_lock_own_listing` also requires the owner not to be deleted (a `NOT EXISTS` on `users … deleted_at IS NOT
   NULL`, as 0012a's `not_suspended`), raising `ListingNotFoundError` so the objects are discarded. Add
   `services/photos.py::_lock_own_listing` to Scope and Blast radius (`add_listing_photo`,
   `delete_listing_photo`, `reorder_listing_photos`). Or, if Gilad prefers, state it in Risks as accepted, with
   the `shortcut:` line.
6. **Check 11 — a typed name the Blast radius misses.** `services/chat.py::Member.name: str` (the dataclass
   `get_thread` builds, `graphify affected "Member"` → both `get_thread`s) carries the NULL name into
   `MemberOut`. mypy does not see it (the rows are untyped). **Fix:** Scope's Chat bullet makes it
   `str | None`, beside the four schemas.

Not findings (checked): no other users reader leaks or 500s. Every other `display_name` reader fails to match
a tombstone by the data rules:
- people and market cards need a `seeker_profiles` row;
- room flatmates need a `listing_flatmates` row;
- likes and matches need `room_pairs` / `person_pairs` rows;
- `list_applicants` filters `withdrawn`;
- public listing reads need `active`;
- the invite preview needs a hash.

The chat list keeps every status, so the owner of U's withdrawn application keeps the thread. The FK count
(14 in 11 tables) is right, and no FK hangs a direct chat on `person_pairs`. The kept paused listing rows do
not contradict PRODUCT.md and are served to nobody but the admin; they keep a room's `lifestyle` /
`flatmate_ages` and the closure answer, which no longer point to a person. The 0013b and 0013e overlaps are
named with function boundaries.

Applied by the orchestrator (2026-11-15):
1. Downgrade reordered (CHECK and index dropped, then the UPDATE, then `deleted_at`, then `SET NOT NULL`, then `blocked_emails`); AC11 now states the tombstone it downgrades.
2. Config bullet: `DEV_EMAIL_BLOCK_KEY`, the https refusal as the block's last check (trigger: `WEB_ORIGIN` https, not 0013a's `FLY_APP_NAME`, which needs 0013a), compose `api` / `worker`, the Makefile export, `.env.example`; `_HTTPS_READY`; AC9 extended; `Settings` in Blast radius (with `test_openapi_export.py`, which reads `.env.example` alone); Risks note 0013a's runbook §6 sets the key and that it is never rotated.
3. `resolve_session` gains `deleted_at IS NULL` (Scope, API, a table row); its callers in Blast radius; AC14 races a real `verify_otp` against the deletion and refuses its session.
4. Step 1 reads `deleted_at, email, photo_key` as columns from the locked row and returns at once on a tombstone (204, nothing written); step 2 hashes step 1's email; AC13 runs two concurrent `DELETE /me`.
5. `_lock_own_listing` reads `deleted_at` in a second statement after the lock and raises `ListingNotFoundError` (404 `not_found`, as every photo route maps it). Not the suggested `NOT EXISTS`: under READ COMMITTED a waiting lock keeps its old snapshot for `users`. The listings UPDATE moved to step 3, before the photo step, so an upload holding the lock commits first and is deleted too. API row, Blast radius, Risks (shared with 0013g), AC15.
6. `Member.name: str | None` in Scope's Chat bullet; Blast radius names `get_thread` (both) and 0013f's `ChatThreadPage.tsx` members line, which already renders a null name as the placeholder.
