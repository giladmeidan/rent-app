---
id: 0016a
title: "A person can sign up with a password and log in with email and password; the emailed code stays as it is"
status: done
depends_on: []
reviewers: [code, security, ux, qa]   # security: password storage, login brute force, the admin role's grants; qa: two endpoints + three screens
estimate: 1 coder run   # full stack (API + web), at the upper end; coder Opus/high (auth, migration; Speed rule 6)
---

## Goal
After this ships, a person can add a password when they sign up (or later in their profile) and log in
with email and password. Logging in with an emailed code works exactly as today, and is also how a person
who forgot their password gets back in. PRODUCT.md "Login" (Gilad, 2026-11-16).

## Decisions this spec builds on (Gilad, 2026-11-16)
- Any email can have a password, not only Gmail. The mailbox is proven by the emailed code once, at
  sign-up; a password never creates an account on its own.
- Minimum 10 characters, no rules about which kinds of characters (NIST SP 800-63B); maximum 128.
- **Passwords are salted and hashed** (Gilad: "of course use salt"): argon2id via `argon2-cffi`'s
  `PasswordHasher`, which draws a fresh random 16-byte salt for every hash and stores it inside the encoded
  hash (`$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>`). The same password hashes differently for two people
  and twice for one person (AC2). The raw password is never stored, logged or echoed.
- Forgot password = log in with a code, then set a new password in the profile. No reset-link email.
- Google sign-in is `0016b`; its column (`users.google_sub`) is added here so the two specs do not fight
  over migration numbers.
- "Never readable by the admin role" (PRODUCT.md "Login"): the hashes live in their **own table**,
  `user_passwords`, on which `homie_admin` has no privilege (Data). Verifier, 2026-11-16: a column on `users`
  would need column-level grants (Postgres cannot revoke one column from a table-level `SELECT`), and SQLAdmin
  selects whole `User` rows (the user list and page, and `Report.reporter` / `reported_user` /
  `Listing.owner` through `selectinload`), so the dashboard would break and every later `users` column would be
  unreadable to it until the role is re-applied. A separate table needs one `REVOKE` and no admin change.

## Scope
**In:**
- Migration `0029_login_methods` (Data).
- `api/app/models/user_password.py` (new): `UserPassword` (`user_id`, `hash`), registered in
  `app/models/__init__.py`. **No relationship** from `User` to it (a comment says why: SQLAdmin's user page shows
  every mapper attribute and would load it as `homie_admin`).
- `api/app/models/user.py`: `google_sub: Mapped[str | None]` (unique, `uq_users_google_sub`) and the
  `DELETED_SCRUBBED_CHECK` constant with `google_sub IS NULL` in the deleted branch.
- `api/app/services/passwords.py` (new), the only module that imports `argon2`:
  - one module-level `PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)` (argon2id, 16-byte salt,
    32-byte hash; OWASP's argon2id setting, 19 MiB per hash; why not the library default: Risks);
  - one module-level `threading.BoundedSemaphore(4)` held around every hash and verify, so at most 4 run at
    once (≤ ~76 MiB) whatever the threadpool holds;
  - `hash_password(raw) -> str`; `verify_password(stored, raw) -> bool` (False on `VerifyMismatchError`; any
    other argon2 error raises); `needs_rehash(stored) -> bool`;
  - `DUMMY_HASH`: computed once at import by the same hasher from `secrets.token_urlsafe(16)`, so a dummy verify
    costs exactly what a real one does.
- `api/app/services/auth.py`:
  - `password_login(db, r, email, password, network) -> User`, raising `InvalidCredentialsError` (new),
    `AccountSuspendedError` or `RateLimitedError` (rules in API). One query: `select(User, UserPassword.hash)`
    outer-joined on `user_id`, by the normalised email.
  - `verify_otp`: when it **creates** an account (`created` is True after the `ON CONFLICT` insert) and
    `profile.password` is set, it adds the `UserPassword` row in the same transaction, before the commit. The hash
    is computed after the code is claimed and the suspended check, outside the `try`. A request that lost the
    insert race (becomes a login) and an existing account's login ignore `profile.password` (AC9).
  - `set_password(db, user, raw, keep_token) -> None`: hashes first (no lock held while hashing), then
    `accounts.lock_live_account(db, user.id)` (a racing `DELETE /me` wins cleanly: `AccountDeletedError` → 401,
    as every 0013c write), upserts the row (`INSERT … ON CONFLICT (user_id) DO UPDATE SET hash`), sets
    `revoked_at = now()` on every other live session of the user (`token_hash != _token_hash(keep_token)`), one
    commit.
  - `has_password(db, user_id) -> bool` (`EXISTS`).
  - Constants `PW_RATE_*` beside the OTP ones; a `_count_password(r, email, network)` shaped like
    `_count_request`, keys under `rl:pw:`.
- `api/app/schemas/auth.py`:
  - `Password = Annotated[str, StringConstraints(strip_whitespace=False, min_length=10, max_length=128)]`.
    `ProfileIn` has `str_strip_whitespace=True` model-wide; the field-level `strip_whitespace=False` overrides it
    (checked with this repo's Pydantic: `"  0123456789  "` stays as typed).
  - `ProfileIn.password: Password | None = None`; `PasswordIn {password: Password}`;
    `PasswordLoginIn {email: EmailStr, password: Annotated[str, StringConstraints(strip_whitespace=False,
    min_length=1, max_length=128)]}` (a short password at login is a 401, not a 422 that tells the rule);
  - `UserOut.has_password: bool` (required).
- `api/app/routers/auth.py`: the two endpoints in API; `user_out(db, user)` (was `user_out(user)`) fills
  `has_password` through `auth_service.has_password`; its three callers pass `db` (`verify_otp`, `me` gains a
  `DbDep`, `routers/photos.py::set_my_photo`).
- `api/app/services/accounts.py::delete_account`: steps 7–11's delete list gains
  `delete(UserPassword).where(UserPassword.user_id == me)`; step 12 also sets `google_sub=None`.
- `api/scripts/admin_role.py`: right after `GRANT SELECT ON ALL TABLES IN SCHEMA public TO {role}`,
  `REVOKE ALL ON user_passwords FROM {role}` (from a constant `_NO_ACCESS = ("user_passwords",)`). Still one
  transaction, still idempotent. **No change in `api/admin/`.** If 0013a's post-check is on `main` when this
  merges (or 0013a merges second), the post-check also raises when
  `has_table_privilege('homie_admin', 'public.user_passwords', 'SELECT')` is true (effective, inherited
  included); whichever PR merges second adds that line.
- `api/tests/conftest.py`: `user_passwords` joins the per-test `TRUNCATE` list (it references `users`, so
  `TRUNCATE … users` fails without it) and the docstring's table list.
- `api/tests/test_hardening.py`: `("POST", "/auth/password/login")` joins **`OWN`** with `# 0016a` (it has its
  own per-network limits, like `/auth/otp/request`; `EXEMPT` is for routes with no limit);
  `("PUT", "/me/password", "WRITE", {"password": "a-valid-password"})` joins `LIMITED` (the body must be valid:
  FastAPI's 422 comes before the handler's count). `PUT /me/password` calls `limits.check(r, user.id,
  limits.WRITE)` as its first statement.
- `api/pyproject.toml` + `api/uv.lock`: `argon2-cffi==25.1.0`.
- `.env.example`: nothing new.
- Web (API section's shapes, after `make client`):
  - `web/src/components/PasswordInput.tsx` (new): `TextInput` with `type` `password`/`text` and a text toggle
    button at the input's inline end (name "הצגת הסיסמה" / "הסתרת הסיסמה", `aria-controls` the input). Used by
    the three forms below.
  - `web/src/features/auth/signedIn.ts` (new): `OtpForm`'s success steps moved out unchanged
    (`clearSession(queryClient, { keepInviteToken: true })`, `clearDraftsExcept(user.id)`,
    `setQueryData(ME_KEY, user)`, `navigate(safeNext(next), { replace: true })`); `OtpForm` and `PasswordForm`
    both call it.
  - `web/src/features/auth/LoginPage.tsx`: the mode switch and `PasswordForm`; `web/src/features/auth/PasswordForm.tsx` (new).
  - `web/src/features/auth/OtpForm.tsx`: a new `initialEmail?: string` prop (the email state's first value), and
    the optional password field on sign-up only.
  - `web/src/features/profile/PasswordSection.tsx` (new) on `ProfilePage.tsx`, right above
    `DeleteAccountSection`, with that section's anatomy (`section` + `h2`, `border-t pt-8`) and its reauth pattern
    (`isReauthRequired` from `useDeleteAccount.ts`, `useLogout().mutateAsync()` then
    `navigate(loginWithNext({ pathname: '/me/profile', search: '' }), { replace: true })`);
    `web/src/features/profile/useSetPassword.ts` (new, the mutation; on 204 it sets `has_password: true` in the
    `ME_KEY` cache).
  - Every `UserOut` literal in web tests and screen fixtures gains `has_password` (Blast radius).
  - `web/src/locales/he.json`: keys in UI.
  - One e2e smoke test and the a11y check (Tests to write).

**Out:** Google sign-in (`0016b`); removing a password once set; a reset-link email; breached-password
checks; two-factor auth; switching the existing e2e logins from codes to passwords; passwords for the demo
seed users; remembering the last login mode.

**New dependencies:** `argon2-cffi` 25.1.0 (api): argon2id hashing with a random salt per hash; the standard
Python binding (hynek), typed, wheels for linux amd64/arm64 and macOS. No web dependency.

## Data
Migration `0029_login_methods` (down_revision `0028`, today's head):
- `user_passwords`: `user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE`, `hash text NOT NULL`,
  `CHECK (hash LIKE '$argon2id$%')` (`ck_user_passwords_argon2id`: a raw password can never be stored by
  mistake). One row per account with a password; no row = no password.
- `users.google_sub text NULL` + `UNIQUE (google_sub)` (`uq_users_google_sub`): Google's stable account id,
  written only by `0016b`.
- `ck_users_deleted_scrubbed` dropped and recreated with `AND google_sub IS NULL` in the deleted branch (the
  migration keeps its own literal, as `0026` does). Existing tombstones satisfy it (the column is new and NULL).
  A tombstone's password row is deleted by `delete_account` (a CHECK cannot see another table; AC10 tests it).
- In the same migration, after creating the table:
  `DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'homie_admin') THEN REVOKE ALL ON user_passwords
  FROM homie_admin; END IF; END $$`. The migration role's default privileges grant `SELECT` on every new table to
  `homie_admin`; this closes that window before `admin_role.py` is re-run. The table's owner (the migration role)
  may revoke on it, on MPG too.
- `downgrade`: drop `user_passwords` (**passwords are lost**: everyone logs in with a code, which still works),
  restore the old CHECK, drop the unique constraint and `google_sub`.
- Backwards-compatible: additive only; the running app never reads either new object.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/auth/password/login` | public | `PasswordLoginIn {email, password}` | 200 `UserOut` + `rent_session` cookie (the same `set_cookie` arguments as `/auth/otp/verify`) | 401 `invalid_credentials`; 403 `account_suspended`; 429 `rate_limited` + Retry-After; 422 malformed |
| PUT | `/me/password` | session (`current_user`) younger than `DELETE_REAUTH_S` (900 s, read with `session_created_at` as `DELETE /me`) | `PasswordIn {password}` | 204 | 401 `unauthenticated` (also a deletion racing it); 403 `reauth_required`; 422 length; 429 `rate_limited` (`limits.WRITE`) |
| POST | `/auth/otp/verify` | public (unchanged) | `profile.password` optional | unchanged | unchanged, plus 422 for a bad password length |
| GET | `/me` | session (unchanged) | – | `UserOut` + `has_password` | unchanged |

`password_login` rules, in this order:
1. Normalise the email (`normalise_email`), then count the attempt with `count_or_raise` (**before** any hash
   check, right or wrong; a refused attempt counts nothing and checks nothing), keyed like the OTP limits
   (`client_ip.client_network`; an IPv6 network's /48 also counted at `PREFIX48_FACTOR` times the per-network
   limits):
   - `rl:pw:email:{email}:net:{network}`: 10 per 15 minutes; `rl:pw:email:day:{email}:net:{network}`: 30 per day;
   - `rl:pw:email:all:day:{email}`: 100 per day (the one cross-network ceiling: it stops password logins for that
     email for a day; the emailed code still works, so it never locks a person out);
   - `rl:pw:ip:{network}`: 30 per 15 minutes; `rl:pw:ip:day:{network}`: 300 per day.
   Brute-force bound per email: ≤ 100 guesses a day.
2. Look the account up. No row, a deleted account (its email is NULL, so no row), or no password row: run
   `verify_password(DUMMY_HASH, password)` and raise `InvalidCredentialsError` (401 `invalid_credentials`). Every
   failure has the same body and does the same one verify (NF1).
3. Wrong password: 401 `invalid_credentials` (a suspended account too: no hint that it exists).
4. Right password on a suspended account: 403 `account_suspended`, no session, nothing written (as 0012a).
5. Right password: `last_login_at = now()`, and if `needs_rehash` the row's hash is replaced, in one commit;
   then `create_session`, and the router sets the cookie exactly as `/auth/otp/verify` does.

The endpoint is a sync `def` (FastAPI's threadpool); the semaphore in `passwords.py` and the per-network limits
bound the CPU and memory one client can make it use.

`PUT /me/password`: `limits.check` first, then the session-age check (as `delete_me`), then
`set_password(db, user, body.password, token)`. There is no "current password" field: the fresh sign-in is the
proof. It sets or changes the password and signs out every other device.

## UI
No artboard for these states: reuse the auth card (`LoginPage` / `SignupPage`) and the profile sections'
existing anatomy, brand tokens and voice (`design/brand/`).

- **Login page** (`/login`): inside the card, above the form, the UI kit's `Tabs` with `variant="pill"`
  (label "דרך הכניסה") and one `TabPanel` (as `ApplicantsPage`): "קוד למייל" (default, today's `OtpForm`) and
  "סיסמה" (`PasswordForm`). Switching unmounts the other form.
  `PasswordForm`: email (`TextInput`, `type="email"`, `name="email"`, `autoComplete="username"`, `dir="ltr"`),
  password (`PasswordInput`, `name="password"`, `autoComplete="current-password"`), submit "כניסה". Under the form:
  "שכחת סיסמה?" with a button "כניסה עם קוד" that switches to code mode and passes the typed email
  (`OtpForm initialEmail`). States:
  - loading: while `useMe` is pending, today's skeleton (no form);
  - pending: submit disabled with the existing busy pattern;
  - 401 → "המייל או הסיסמה לא נכונים" (`role="alert"`, linked with `aria-describedby` from the password field);
    the password field is cleared and focused, the email kept;
  - 403 → the existing `auth.errors.suspended`;
  - 429 → the existing `auth.errors.tooMany` / `tooManyIn` with the wait (`parseRetryAfter`);
  - network or 5xx → `common.error` (offline: `common.offline`);
  - success → `signedIn.ts` (the same `next` handling as `OtpForm`).
  - Empty fields: the submit stays enabled and an empty field gets the existing required-field pattern (no request).
- **Sign-up** (`/signup`, `OtpForm` with `withProfile`, step 1): one optional field right after the name,
  "סיסמה (לא חובה)", hint "לפחות 10 תווים. תמיד אפשר להיכנס גם עם קוד במייל." (`aria-describedby`),
  `PasswordInput` with `autoComplete="new-password"`. 1–9 characters: inline error "הסיסמה צריכה לפחות 10
  תווים" on "send code" and no request sent; 11+ is fine (the input's `maxLength={128}`). The value is kept in
  state and sent as `profile.password` at verify when non-empty, left out when empty. Login's "no account yet,
  tell us your name" step does **not** show it.
- **Profile** → section "סיסמה" (`PasswordSection`), right above "מחיקת החשבון":
  - empty (`has_password` false): "אין לך סיסמה. נכנסים עם קוד שנשלח למייל." + button "הגדרת סיסמה";
  - set (`has_password` true): "יש לך סיסמה." + button "שינוי סיסמה";
  - the button reveals one `PasswordInput` ("סיסמה חדשה", `autoComplete="new-password"`, hint as on sign-up) with
    "שמירה" and "ביטול"; 1–9 characters → the same inline error, no request;
  - pending: "שמירה" disabled/busy;
  - success (204): the field closes and a `role="status"` line "הסיסמה נשמרה. יצאת מכל שאר המכשירים.";
  - reauth (`isReauthRequired`: 403 `reauth_required` or 401): "כדי לשנות סיסמה צריך להיכנס שוב" with a button
    "כניסה מחדש" doing `DeleteAccountSection`'s `signInAgain` (logout, then `loginWithNext` back to `/me/profile`);
  - 429 → `auth.errors.tooManyIn`; other errors → `common.error` (offline: `common.offline`), `role="alert"`;
  - loading: the section renders only after `useMe` has data (the profile page's existing skeleton covers it).
- RTL: both password inputs and the login email stay `dir="ltr"` inside the RTL form (as the email field today);
  the toggle sits at the input's inline end; logical properties only (`ps-`/`pe-`, `end-`).
- i18n keys (Hebrew above, final copy per `design/brand/` voice): `auth.login.mode.label`, `auth.login.mode.code`,
  `auth.login.mode.password`, `auth.password.label`, `auth.password.submit`, `auth.password.invalid`,
  `auth.password.forgot`, `auth.password.forgotAction`, `auth.password.optionalLabel`, `auth.password.hint`,
  `auth.password.tooShort`, `auth.password.show`, `auth.password.hide`, `profile.password.title`,
  `profile.password.none`, `profile.password.has`, `profile.password.set`, `profile.password.change`,
  `profile.password.newLabel`, `profile.password.save`, `profile.password.saved`, `profile.password.reauth`,
  `profile.password.reauthAction`. Reused: `common.cancel`, `common.error`, `common.offline`,
  `auth.errors.suspended`, `auth.errors.tooMany`, `auth.errors.tooManyIn`, `auth.email.label`.
- Changed copy (orchestrator, from 0016b's verifier): `auth.login.subtitle` and `auth.signup.subtitle` say "בלי
  סיסמה", which is no longer true. New text: login "נכנסים עם קוד חד־פעמי לאימייל או עם סיסמה."; sign-up
  "נרשמים בחינם: שלושה פרטים וקוד חד־פעמי לאימייל. סיסמה אפשר להוסיף אם רוצים." (final per brand voice). The
  privacy text `legal.privacy.s1.i1` ("only for one-time-code login") is rewritten by 0016b, not here.

## Acceptance criteria
- [ ] AC1 Given a new email and a valid code, when `/auth/otp/verify` is called with `profile.password`, then
  the account is created with one `user_passwords` row whose hash starts `$argon2id$v=19$m=19456,t=2,p=1$`, never
  the raw password, and `GET /me` says `has_password: true`; without `profile.password`, no row and
  `has_password: false` — `api/tests/test_password.py::test_ac1_signup_with_password_stores_argon2id_hash`
- [ ] AC2 Salt: two accounts with the same password have different stored hashes, and hashing the same password
  twice gives two different strings that both verify — `test_password.py::test_ac2_each_hash_has_its_own_salt`
- [ ] AC3 Given an account with a password, when `/auth/password/login` gets the right email (any case, spaces
  around) and password, then 200 `UserOut` with `has_password: true`, a session cookie with
  `/auth/otp/verify`'s attributes that `GET /me` accepts, and `last_login_at` set —
  `test_password.py::test_ac3_password_login_sets_session`
- [ ] AC4 Wrong password, unknown email, deleted account, account with no password, a 1-character password: each
  401 `invalid_credentials` with the same body, and no new session row —
  `test_password.py::test_ac4_one_answer_for_every_failure`
- [ ] AC5 Suspended account: right password → 403 `account_suspended`, no session; wrong password → 401 —
  `test_password.py::test_ac5_suspended_account`
- [ ] AC6 Rate limits: the 11th attempt in 15 minutes for one (email, network) is 429 with Retry-After and does
  not call `verify_password`; a different network is not affected until the per-email day ceiling (101st that
  day: 429); the emailed code still logs in while password login is limited —
  `test_password.py::test_ac6_rate_limits`
- [ ] AC7 `PUT /me/password` from a session younger than 15 minutes sets the hash, returns 204, keeps the caller's
  session and revokes every other session of the user; the new password logs in and the old one does not; from an
  older session it is 403 `reauth_required` and nothing changes —
  `test_password.py::test_ac7_set_password_needs_fresh_session_and_signs_out_others`
- [ ] AC8 Length: 9 or 129 characters → 422 on sign-up and on `PUT /me/password` (the 422 body has no `input`);
  a password with leading and trailing spaces is stored as typed (login with the same spaces works, without them
  is 401) — `test_password.py::test_ac8_length_and_no_stripping`
- [ ] AC9 An existing account's code login with `profile.password` set does not create or change its password —
  `test_password.py::test_ac9_login_ignores_profile_password`
- [ ] AC10 `DELETE /me` removes the account's `user_passwords` row and leaves `google_sub` NULL; the CHECK rejects a
  deleted row that keeps `google_sub` —
  `api/tests/test_account_deletion.py::test_0016a_ac10_tombstone_clears_login_methods`
- [ ] AC11 As `homie_admin`: `SELECT hash FROM user_passwords` is `InsufficientPrivilege` (also after
  `apply_admin_role` runs twice: the statement joins `_check_role`'s list, so `test_nf2_role_has_only_its_grants`
  covers it), every `users` column including `google_sub` is readable, and `/admin/user/list`,
  `/admin/user/details/{id}` and `/admin/report/list` (with a report on that user) answer 200 for a user who has a
  password — `api/tests/test_admin.py::test_0016a_ac11_admin_cannot_read_passwords`
- [ ] AC12 Migration `0029` upgrades and downgrades on a database with a tombstone and a password row (the CHECK
  holds both ways; downgrade drops the table), and autogenerate sees no diff —
  `api/tests/test_migrations.py::test_0029_login_methods_up_and_down`
- [ ] AC13 Login page: the switch defaults to code; password mode logs in and goes to `next`; 401, 429 and
  suspended show their texts; "forgot" switches to code mode with the email kept —
  `web/src/features/auth/__tests__/PasswordForm.test.tsx`
- [ ] AC14 Sign-up: the optional password field is sent in `profile.password` when filled, left out when empty,
  1–9 characters block the request with the inline error, and login's profile step has no password field —
  `web/src/features/auth/__tests__/OtpForm.test.tsx`
- [ ] AC15 Profile: set/change by `has_password`; 204 shows the success text and `has_password` flips; 403
  `reauth_required` shows the reauth text and its button leads to `/login?next=%2Fme%2Fprofile` —
  `web/src/features/profile/__tests__/PasswordSection.test.tsx`
- [ ] AC16 a11y: the switch, the show/hide toggle (its name changes with the state) and the errors
  (`aria-describedby`, announced) pass axe on `/login` in both modes — `web/e2e/a11y.spec.ts` (CI only)
- [ ] NF1 Timing: a login for an unknown email, a deleted account and an account without a password each run
  exactly one `verify_password` (against `DUMMY_HASH`), counted by monkeypatching it —
  `test_password.py::test_nf1_every_failure_runs_one_verify`
- [ ] NF2 The raw password appears in no log line (caplog over sign-up, login, a wrong login, set and a 422) and no
  error body — `test_password.py::test_nf2_password_never_logged`
- [ ] NF3 `passwords.py`: hash/verify/needs_rehash round-trip; a hash made with other parameters `needs_rehash` and
  is replaced on the next right login — `test_password.py::test_nf3_rehash_on_login`

## Tests to write
Unit + integration: `api/tests/test_password.py` (AC1–AC9, NF1–NF3). AC10 in `test_account_deletion.py`, AC11 in
`test_admin.py` (plus `"SELECT hash FROM user_passwords"` in `_check_role`'s refused list), AC12 in
`test_migrations.py`; `test_hardening.py`'s registries (Scope). Web: vitest for AC13–AC15 (and `OtpForm`'s
existing tests keep passing after the `signedIn.ts` move).
E2E (smoke, CI only; never run e2e locally): `web/e2e/auth.spec.ts` — sign up with a password (one code), log out,
log in with the password on the password tab. Then count codes per shard with
`pnpm exec playwright test --list --shard=N/8` for N = 1…8: each shard must request at most 9 codes (the
`Makefile` comment by `E2E_SHARDS`: limit 10 per network per 15 min; auth's shard has 7 today). If one passes 9,
raise `E2E_SHARDS` and rewrite that comment's counts. `rl:pw:*` keys are cleared by the existing `RL_FLUSH`
(`rl:*`).

## Blast radius
From `graphify affected` (graph of an older `main`, confirmed by grep in `rent-app-orch`):
- `services/auth.py::verify_otp` → `routers/auth.py::verify_otp`; `test_auth.py::verify`,
  `test_code_survives_database_failure_at_login`, `test_otp_single_use_under_concurrency` (call it with
  `profile=None`: unchanged behaviour, untouched).
- `ProfileIn` → `services/auth.py`, `OtpVerifyIn`; `test_auth.py::test_display_name_keeps_joiners` (the name still
  strips; the new field opts out). Other "imports" hits are module-level (`schemas/auth.py`), untouched.
- `user_out` → `routers/auth.py::me`, `::verify_otp`, `routers/photos.py::set_my_photo`: all three pass `db` (Scope).
  `test_photos.py` imports from the router module only; untouched.
- `UserOut` (API) → the three above; `has_password` added to every response. (Web) generated
  `web/src/api/client.ts` → literals that must gain `has_password`: `features/auth/__tests__/harness.tsx`,
  `features/auth/__tests__/routes.test.tsx`, `features/listings/__tests__/fixtures.ts`,
  `features/listings/__tests__/wizard.tsx`, `features/reports/__tests__/ReportDialog.test.tsx`, and the screen
  fixtures `web/e2e/screens/fixtures-{seeker,profile,listings,chat,flatmates}.ts`, `people.screens.ts`,
  `market-people.screens.ts`, `search.screens.ts`, `applicants.screens.ts` (grep `listing_cap:` for any other
  literal; `tsc` in `make lint` finds the rest). Readers that only read fields (`useMe`, `useLogout`, `canApply`,
  `PersonPhoto`, `photoApi`, `useLikePerson`, `useSetApplicantStatus`, `ListingWizard`) are untouched.
- `delete_account` → `routers/auth.py::delete_me`; `test_account_deletion.py` (its `_snapshot` iterates
  `Base.metadata.tables`, so it covers the new table by itself; `test_nf1_failure_rolls_back_everything` stays
  green).
- `User` model / `DELETED_SCRUBBED_CHECK` → many `select(User)` callers (services, admin views, seeds): a new
  nullable column, no behaviour change. `admin/views.py::UserView` shows `google_sub` on the user page (readable,
  not secret). No relationship to `UserPassword`, so no admin query touches it.
- `apply_admin_role` → `main()`, `conftest.py::admin_role` fixture (→ `test_admin.py`, `test_admin_isolation.py`),
  `test_admin.py::test_nf2_role_has_only_its_grants`. The other `test_*.py` "imports_from" hits are `conftest.py`
  imports, not calls. **0013a** (verified, not built) rewrites this file (`--existing-role`, post-check): the second
  PR to merge merges `origin/main` and keeps both (Scope).
- `conftest.py` per-test `TRUNCATE` → every DB test (Scope).
- `test_hardening.py` registries → `test_ac1_every_write_route_has_a_limit` (fails until both routes are listed),
  `test_ac2_limited_routes_refuse_at_the_limit` (runs `PUT /me/password` from a fresh `signup` session).
- `OtpForm` → `LoginPage`, `SignupPage`; `LoginPage.test.tsx`, `OtpForm.test.tsx`, `SignupPage.test.tsx`,
  `ApplySection.test.tsx`, `JoinFlatPage.test.tsx` (they drive the code flow: must stay green; code mode is the
  default, so no change expected).
- `LoginPage` → `routes.tsx`; `auth/__tests__/routes.test.tsx`, `ApplySection.test.tsx`, `JoinFlatPage.test.tsx`
  and the app-shell tests that render all routes (no change expected: the code form is still the default panel).
- `ProfilePage` / `DeleteAccountSection` → `ProfilePage.test.tsx`, `PersonPhoto.test.tsx` (the new section needs
  `useMe` data their harness already provides with `has_password` added); `DeleteAccountSection` itself untouched.
- `create_session` → reused unchanged by `password_login`.
- **0016b** (draft, `depends_on: [0016a]`) relies on `users.google_sub` + `uq_users_google_sub` and the login
  page's `Tabs` switch; both are as it expects.

## Risks / open questions
- **Argon2 memory (checked, verifier 2026-11-16).** 0013a sizes the API machine at 1 shared CPU, 1 GB, one uvicorn
  process; FastAPI's threadpool runs up to 40 sync handlers at once. `argon2-cffi`'s default (RFC 9106 low-memory:
  64 MiB, t=3, p=4) would let 40 concurrent logins ask for ~2.5 GB, and p=4 gains nothing on one CPU. Hence
  OWASP's argon2id setting (19 MiB, t=2, p=1) and a semaphore of 4 (≤ ~76 MiB), Scope. No machine change, no
  cost. `needs_rehash` upgrades stored hashes on login if the parameters are raised later.
- **The admin role (checked).** SQLAdmin reads whole `User` rows (list, details with every mapper attribute,
  `selectinload` of `Report.reporter`/`reported_user`/`Listing.owner`), so a hash column on `users` would break
  the dashboard under a column grant; the separate table needs no admin change (Decisions).
- **MPG's Reader role (deploy time, not this build).** Production makes `homie_admin` with `fly mpg users create`
  (Reader, 0013a). If Reader inherits a read-everything group (e.g. `pg_read_all_data`), the `REVOKE` cannot remove
  it; 0013a's post-check with this spec's line then refuses `make admin-role-prod` loudly. If that happens, the
  orchestrator takes it to Gilad (options then: another MPG role type, or a role made by `fly-user`).
- Password managers: handled by `name`/`autocomplete` (`username`, `current-password`, `new-password`) in UI.
- No open product question.

## Digest (filled by orchestrator after verification)
Merged 2026-11-16 as PR #114 (`67c6457`), ci green on head `095efc0`, merged by the orchestrator (Slice 16 delegated).
- Shipped: optional password at sign-up and in the profile, `POST /auth/password/login`, `PUT /me/password` (fresh
  sign-in, signs out other devices), argon2id with a random salt per hash (t=2, 19 MiB, p=1, at most 4 at once) in
  the `user_passwords` table the admin role cannot read; `users.google_sub` for 0016b. Migration `0029_login_methods`.
- Review (code, security, ux, qa): blockers 0 · majors 1 (fixed: a rehash on login could undo a just-changed
  password) · minors 16 (7 fixed, rest in FOLLOWUPS) · nits 9.
- Gilad 2026-11-16: a password login counts as a fresh sign-in for deleting the account and changing the password;
  a security email spec comes before going public (FOLLOWUPS 0016a).
