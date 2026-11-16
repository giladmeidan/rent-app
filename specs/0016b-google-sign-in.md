---
id: 0016b
title: "A person can sign up and log in with their Google account"
status: in-progress
depends_on: [0016a]   # 0016a adds `users.google_sub` (migration 0029), the scrub CHECK and the login page's mode switch
reviewers: [code, security, ux, qa]   # security: ID-token verification, account linking, the fake verifier's guard; qa: new endpoint + screens
estimate: 1 coder run   # full stack; coder Opus/high (auth; Speed rule 6)
---

## Goal
After this ships, the login and sign-up pages have a "Continue with Google" button. A Google account whose
email matches an existing homie account logs into it; a new one signs up after choosing a role and name.
Email code and password login stay as they are. PRODUCT.md "Login" (Gilad, 2026-11-16).

## Decisions this spec builds on (Gilad, 2026-11-16)
- **Automatic linking:** Google vouches for the email (`email_verified: true`), so a Google sign-in whose
  email matches an existing account logs into that account and stores its `google_sub`. No code is asked.
- Sign-in flow: **Google Identity Services (GIS)**. The web shows Google's own button, Google gives the page
  a signed ID token (a JWT, the `credential`), and the API verifies it. No redirect callback, no client
  secret, no refresh tokens: homie reads the ID token once and keeps nothing from Google but `sub`.
- Scopes: `openid email profile` only, so the Google app needs no Google verification review. Free.
- Gilad creates the OAuth client (steps under Setup). Until then the button is hidden (no
  `VITE_GOOGLE_CLIENT_ID`), production runs `GOOGLE_VERIFIER=off`, and dev, tests and e2e use the fake
  verifier.

## Scope
**In:**
- `api/app/services/google.py` (new):
  - `GoogleIdentity(sub: str, email: str)` (a frozen dataclass); `InvalidGoogleToken`, `GoogleUnavailable`.
  - `verify_credential(credential: str) -> GoogleIdentity`, by `settings.google_verifier`:
    - `off` → `GoogleUnavailable` (the endpoint answers 503).
    - `fake` → accepts exactly `fake:<sub>:<email>`: `sub` matches `[A-Za-z0-9_-]{1,64}`, `email` passes
      pydantic's `EmailStr` (`TypeAdapter`); anything else → `InvalidGoogleToken`. Always "verified".
    - `google` → `_google_certs()` then `google.auth.jwt.decode(credential, certs=certs,
      audience=settings.google_client_id, clock_skew_in_seconds=10)` (checks the RS256 signature against the
      key named by the token's `kid`, `exp` and `iat` (both required), and `aud`), then `iss` in
      `{"accounts.google.com", "https://accounts.google.com"}`, `email_verified is True`, and `sub` / `email`
      non-empty strings. Any `ValueError` (google-auth's `MalformedError` / `InvalidValue` are subclasses) or
      `google.auth.exceptions.GoogleAuthError`, or a failed check → `InvalidGoogleToken` raised `from None`;
      the library's message is never logged or returned (it can quote token parts).
  - **Why not `google.oauth2.id_token.verify_oauth2_token`:** it re-fetches Google's certs on every call (its
    docs say to bolt on CacheControl) and its fetch passes no timeout (the `requests` transport's default is
    120 s), so a slow Google would hold a worker for two minutes. `jwt.decode` + the `iss` check is exactly
    what `verify_oauth2_token` does after its fetch.
  - `_google_certs() -> dict[str, str]`: `https://www.googleapis.com/oauth2/v1/certs` (`{kid: PEM cert}`)
    fetched with `httpx.get(url, timeout=5.0)` (httpx is already a dependency), kept in a module-level cache
    until the response's `Cache-Control: max-age` (fallback 3600 s if absent), behind a `threading.Lock` so
    one thread refetches while the others wait. A timeout, connection error, non-200 or malformed JSON →
    `GoogleUnavailable` (nothing cached). Comment: `shortcut: no refetch on an unknown kid; Google publishes a
    new key well before signing with it, so the max-age refresh is enough — upgrade if 401s show up after a
    rotation`. A `_reset_cache()` for tests.
- `api/app/services/auth.py`: `google_login(db, r, credential, profile, network) -> tuple[User, bool]`, the
  rules in API, raising `RateLimitedError`, `google.InvalidGoogleToken`, `google.GoogleUnavailable`,
  `ProfileRequiredError`, `AccountSuspendedError`, `SignupBlockedError` (existing) and a new
  `GoogleAccountConflictError`. Constants beside the OTP ones: `GOOGLE_RATE_LIMIT_IP = 30` (per
  `OTP_RATE_WINDOW_S`), `GOOGLE_RATE_LIMIT_IP_DAY = 300`. `verify_otp` is **not** changed.
- `api/app/routers/auth.py`: `POST /auth/google` (sync `def`), cookie set exactly as `/auth/otp/verify` does
  (extract the shared `set_cookie` call into one `_signed_in(user, token, created)` helper used by both, and by
  0016a's password login if it has its own copy). Module docstring names the new endpoint. `responses=` for
  401/403/409/422/429/503 as in API.
- `api/app/schemas/auth.py`: `GoogleProfileIn` = today's `ProfileIn` fields and validator (`display_name`,
  `role`), and after 0016a `class ProfileIn(GoogleProfileIn)` adds only `password` (the OpenAPI name
  `ProfileIn` and its shape stay as 0016a leaves them). `GoogleLoginIn {credential: str (min 1, max 4096),
  profile: GoogleProfileIn | None = None}`.
- `api/app/config.py`: `google_verifier: Literal["off", "fake", "google"] = "off"`, `google_client_id: str = ""`
  (stripped). Rules in `_email_and_production_rules`: always, `google` needs a non-empty `GOOGLE_CLIENT_ID`;
  in the https block (before the EMAIL_BLOCK_KEY check, which stays last), `fake` is refused
  ("GOOGLE_VERIFIER must not be fake when WEB_ORIGIN is https"). The default `off` needs no explicit setting,
  so `_HTTPS_READY` in `test_config.py` and 0013a's `api.toml` keep validating unchanged.
- `.env.example`: a "Google sign-in (spec 0016b)" block: `GOOGLE_VERIFIER=fake` (what compose uses; the code
  default `off` is what a deployment gets when it sets nothing; `google` = real tokens, needs the client id),
  `GOOGLE_CLIENT_ID=` and `VITE_GOOGLE_CLIENT_ID=` (both empty: the button stays hidden).
- `infra/docker-compose.yml`: api `GOOGLE_VERIFIER: ${GOOGLE_VERIFIER:-fake}`, `GOOGLE_CLIENT_ID:
  ${GOOGLE_CLIENT_ID:-}`; web `VITE_GOOGLE_CLIENT_ID: ${VITE_GOOGLE_CLIENT_ID:-}`. The worker needs neither.
- `.github/workflows/ci.yml` job `env`: `VITE_GOOGLE_CLIENT_ID: "e2e-stub.apps.googleusercontent.com"`, so the
  CI stack's web renders the button and e2e can press the stub (the API stays on `fake`). Comment: the GIS
  script is stubbed in every e2e test; this value never reaches Google.
- `web/vitest.config.ts`: `env` gains `VITE_GOOGLE_CLIENT_ID: ''`, so vitest is the same locally and in CI
  (no button unless a test sets it with `vi.stubEnv`).
- `web/src/vite-env.d.ts`: `readonly VITE_GOOGLE_CLIENT_ID?: string` with a one-line comment.
- `api/tests/test_hardening.py`: `("POST", "/auth/google")` joins **`OWN`** with `# 0016b` (it has a limit of
  its own; `EXEMPT` is for routes with none), or AC1 there fails.
- Web:
  - `web/src/features/auth/ProfileFields.tsx` (new, extracted from `OtpForm` with no behaviour change):
    `nameIsValid`, `askRoleFor(initialRole, next)` (OtpForm's `askRole` rule, spec 0010b: no role question on
    the market side, stored as seeker), the role `ChoiceGroup` + name `Field` as one `ProfileFields`
    component, and `ConsentLine` (the `auth.signup.consent` `Trans` with its two new-tab links, 0013f).
  - `web/src/features/auth/useCompleteSignIn.ts` (new): OtpForm's success block as a hook returning
    `(user: UserOut) => void`: `clearSession(queryClient, { keepInviteToken: true })`,
    `clearDraftsExcept(user.id)`, `setQueryData(ME_KEY, user)`, `navigate(safeNext(next), { replace: true })`.
    `OtpForm` (and 0016a's `PasswordForm`, if it copied the block) use it.
  - `web/src/features/auth/GoogleButton.tsx` (new), props `{ initialRole, next }`:
    - Renders nothing when `import.meta.env.VITE_GOOGLE_CLIENT_ID` is empty (read at render, so
      `vi.stubEnv` works).
    - `loadGis()`: one module-level promise; resolves at once if `window.google?.accounts?.id` exists, else
      appends `<script src="https://accounts.google.com/gsi/client" async>` once and settles on its
      `load` / `error`. Only `/login` and `/signup` render the component, so no other page loads the script.
    - Then `google.accounts.id.initialize({ client_id, callback, context: 'signin' | 'signup' })` and
      `renderButton(el, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with',
      locale: 'he', width })`, `width` = the container's width, at most 400 (GIS's maximum). No `prompt()`
      (One Tap is Out).
    - Typed by a small `declare global { interface Window { google?: … } }` covering only `initialize` and
      `renderButton` (no `any`, no new package).
    - `callback({ credential })` → `POST /auth/google { credential }`; the credential lives in component
      state only (never storage, the URL or a log).
  - `LoginPage.tsx`, `SignupPage.tsx`: inside the auth card, under the `PageHeader` and above 0016a's mode
    switch / the form: `<GoogleButton>`, then a divider "או" (shown only while the button is shown).
  - The "one more step" panel (in `GoogleButton.tsx`, or its own file beside it): see UI.
  - `web/src/locales/he.json`: keys in UI; `legal.privacy.s1.i1` (sentence about the email's use) and a new
    `legal.privacy.s3.i6`, rendered by `web/src/features/legal/content.ts` right after `s3.i3` (text in UI).
  - `web/e2e/helpers.ts`: `routeGis(context)`: fulfils `https://accounts.google.com/gsi/client` with a stub
    script and aborts every other `https://accounts.google.com/**` request. The stub defines
    `window.google.accounts.id.initialize(cfg)` (keeps `cfg.callback`) and `renderButton(el)` (appends a
    `<button type="button">Google (stub)</button>` that calls `cfg.callback({ credential:
    window.__GSI_CREDENTIAL__ })`). A test sets `__GSI_CREDENTIAL__` with `page.addInitScript`.
  - `web/e2e/fixtures.ts`: the auto fixture and `newTileContext` also call `routeGis` (as they do
    `routeTiles`), so no e2e test can reach Google once CI renders the button.
- **If `web/public/_headers` exists when this builds (0013a merged first):** its CSP gains Google's documented
  GIS sources: `script-src … https://accounts.google.com/gsi/client`, `style-src …
  https://accounts.google.com/gsi/style`, `frame-src https://accounts.google.com/gsi/` (new directive; today
  frames fall back to `child-src blob:`); `connect-src https:` already covers `/gsi/`. Update
  `web/scripts/build-check.mjs`'s expected line and its test. If 0013a has not merged, it carries the same
  line (see Risks).

**Out:** Apple / Facebook; unlinking Google from an account; a Google-only account setting a password is
already possible through 0016a's profile section and needs nothing here; Google One Tap / auto sign-in
prompts (the button only); using the Google photo; a GIS `nonce` (replay accepted, API section); the production
switch-on (Setup step 4, after 0013a).

**New dependencies:** `google-auth` (api, runtime, pinned; no `[requests]` extra: the key fetch is httpx):
Google's official library, used for `google.auth.jwt.decode` and its RSA verifier; ships `py.typed`.
`cryptography` (api, **dev** group, pinned at the lock's `50.0.2`; already installed through
`types-pyopenssl`, named because the tests import it): generates the test signing key. No web package: the
GIS script is loaded from Google at runtime.

## Data
No migration: `users.google_sub` (unique `uq_users_google_sub`, nullable) exists since 0016a's `0029`, and a
tombstone has it NULL (0016a's scrub CHECK and `delete_account` step 12). Stored from Google: `sub`, and for a
new account its email (as the account's email). The token, the Google name and the picture are not stored.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/auth/google` | public | `{credential, profile?}` | 200 `UserOut` (login) or 201 (account created) + `rent_session` cookie (same attributes as `/auth/otp/verify`) | 401 `invalid_google_token`; 403 `account_suspended`, `signup_blocked`; 409 `google_account_conflict`; 422 `profile_required` or malformed; 429 `rate_limited` + Retry-After; 503 `google_unavailable` (verifier `off`, or Google's keys unreachable) |

`google_login` rules, in order (nothing is written before step 7 except the link in step 4 and the insert in
step 5, both in the step-7 transaction):
0. Rate limit per network, counted **before** verifying, through `count_or_raise`: keys `rl:google:ip:{net}`
   (30 per 15 min) and `rl:google:ip:day:{net}` (300 per day), plus `rl:google:ip48:…` /
   `rl:google:ip48:day:…` at `PREFIX48_FACTOR` × those for an IPv6 /64 (`client_ip.network48`), as
   `_count_request` does.
1. Verify the credential (`services/google.py`); `InvalidGoogleToken` → 401, `GoogleUnavailable` → 503.
2. Email = the token's email through `normalise_email`.
3. `select(User).where(User.google_sub == sub)` → that account, even if its homie email differs from the
   Google email today (`sub` is the identity; the email can change at Google). Tombstones never match (NULL).
4. Else `_find_user(db, email)` (a live account; tombstones have NULL email):
   - suspended → step 6 (checked before any write);
   - `google_sub` NULL → link: `UPDATE users SET google_sub = :sub WHERE id = :id AND google_sub IS NULL
     RETURNING id`; 0 rows (a concurrent link won) → re-read the row: its `google_sub == sub` → continue as a
     login, else 409. An `IntegrityError` on `uq_users_google_sub` → rollback, 409;
   - `google_sub` is a **different** sub → 409 `google_account_conflict`, nothing written (the web says to use
     a code).
5. Else no account: `accounts.email_blocked(db, email)` → 403 `signup_blocked`; no `profile` → 422
   `profile_required`; else `insert(User).values(email, display_name, role, google_sub)
   .on_conflict_do_nothing().returning(User)` (**no conflict target**, so a conflict on `email` *or*
   `google_sub` is caught, as `verify_otp` does for `email`). `None` (a concurrent sign-in, Google or code,
   committed first) → run steps 3–4 once more against the winning row (a login, `created = False`); 201 only
   when this INSERT returned the row.
6. A suspended account (steps 3–4) → 403 `account_suspended`, nothing written (no linking, no session).
7. `last_login_at = now()`, commit (rollback on any exception); the router then calls `create_session`.

Replay: an ID token lives about an hour; one stolen from the page could log in until it expires. Accepted
(standard for GIS with backend verification; the token is only in page memory, never stored). The
security reviewer should confirm.

## UI
No artboard for these states: the auth card's existing anatomy, brand tokens and voice (`design/brand/`).

- **Button area** (`/login`, `/signup`, in the auth card under the header, above the form):
  - *empty* (no `VITE_GOOGLE_CLIENT_ID`): nothing, no divider — the page is exactly 0016a's.
  - *loading* (script loading): a placeholder of the button's height (44 px), no spinner, so the form does not
    jump; the divider is shown.
  - *script failed* (`error` event, blocked by an extension or CSP): the area and the divider collapse; no
    message; the rest of the page works.
  - *ready*: Google's own button (its branding rules forbid restyling), full width up to 400 px, centred.
  - *pending* (after the callback, while `POST /auth/google` runs): a polite `role="status"` line
    "מתחברים עם Google…"; a second callback while pending is ignored.
  - *errors* under the button, `role="alert"`: 401 → "לא הצלחנו להתחבר עם Google. אפשר לנסות שוב."; 409 →
    "החשבון הזה ב-Google לא מחובר לחשבון שלך בהומי. אפשר להיכנס עם קוד במייל."; 403 `account_suspended` →
    `auth.errors.suspended`; 403 `signup_blocked` → `auth.errors.signupBlocked` (with
    `CONTACT_EMAIL_INLINE`); 429 → `auth.errors.tooMany` / `tooManyIn` with the Retry-After wait (OtpForm's
    `tooManyText`); 503, any other status or a network error → `common.error` (`common.offline` when offline).
  - *success* (200/201): `useCompleteSignIn(next)` — the same `next` handling as the other forms (`safeNext`).
  - Divider: a row of two hairlines with "או" between them (`flex`, `gap`, logical properties only).
- **"One more step" panel** (a 422 `profile_required`, on `/login` or `/signup`): replaces the card's content
  below the header (button, divider and form) until it closes.
  - Title (`h2`) "עוד צעד אחד", then `ProfileFields`: the role question when `askRoleFor(initialRole, next)`
    (preset from `?role=` on `/signup`), and the name, pre-filled from the credential's `name` claim:
    the JWT's middle segment base64url-decoded as UTF-8 JSON in the browser, trimmed and cut to 40 code points,
    left empty if it is not a JWT (the `fake:` credential), has no `name`, or decoding throws. The API never
    reads it; it is only a pre-fill.
  - `ConsentLine` above the submit; submit "יצירת חשבון" → `POST /auth/google { credential, profile }` with the
    same credential (kept in state). Disabled while pending or with no role (`auth.hint.chooseRole` as in
    OtpForm); a bad name → `auth.errors.nameLength` on the field, no request.
  - A ghost button "ביטול" closes the panel and forgets the credential.
  - Errors as above, in the panel; a 401 (the credential expired meanwhile) closes the panel and shows the 401
    text under the button. Success as above (201).
  - Focus: on open, the first role radio (or the name when the role is not asked), as OtpForm's
    `profileNeeded`; on cancel, back to the card's first focusable element.
- RTL: GIS renders its own right-to-left text with `locale: 'he'`; the panel is the existing RTL form anatomy;
  logical properties only. Mobile (375 px): the button is the card's inner width.
- i18n keys (Hebrew above; final copy per `design/brand/` voice): `auth.google.or`, `auth.google.pending`,
  `auth.google.errors.invalid`, `auth.google.errors.conflict`, `auth.google.step.title`,
  `auth.google.step.submit`, `auth.google.step.cancel`. Reused: `auth.errors.suspended`,
  `auth.errors.signupBlocked`, `auth.errors.tooMany`, `auth.errors.tooManyIn`, `auth.errors.nameLength`,
  `auth.hint.chooseRole`, `auth.signup.consent`, `auth.role.*`, `auth.name.label`, `common.error`,
  `common.offline`.
- Privacy policy (draft text; Gilad approves it in the spec digest, as every legal text, PRODUCT "Launch"):
  - `legal.privacy.s1.i1`: its sentence on the email's use names every way in: the email is used to sign in
    (with a code, a password or Google) and for messages about the account, and is not shown to others.
  - `legal.privacy.s3.i6` (new): "Google: אם בוחרים להיכנס עם Google, Google מעבירה להומי את האימייל, השם ומזהה
    החשבון שלכם ב-Google. הומי שומרת רק את המזהה, כדי לזהות אתכם בכניסה הבאה (ובחשבון חדש גם את האימייל). השם
    משמש רק כדי למלא מראש את טופס ההרשמה בדפדפן שלכם, ולא נשמר."

## Setup (for Gilad, in the spec so the build session can hand it over)
1. Google Cloud Console → new project "homie" → APIs & Services → OAuth consent screen: External, app name
   "homie", support email, scopes `openid`, `email`, `profile` only; publish (no verification needed for these
   scopes).
2. Credentials → Create OAuth client ID → Web application → Authorized JavaScript origins:
   `http://localhost` and `http://localhost:5180` (the main checkout's `WEB_PORT`; add any other port you open it on),
   and later the production web origin. No redirect URIs.
3. Local real-Google check: in the main checkout's `.env`: `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` = the
   client id (not a secret), `GOOGLE_VERIFIER=google`; `make dev`, press the button on `/login`.
4. Production (after 0013a ships): `GOOGLE_VERIFIER=google` and `GOOGLE_CLIENT_ID` in the API's env, and
   `VITE_GOOGLE_CLIENT_ID` in the `make deploy-web` build env. Until then production stays `off` and the
   button hidden.

## Acceptance criteria
All API tests use `set_env(GOOGLE_VERIFIER="fake")` (conftest) and the `fake:<sub>:<email>` credential unless
they say otherwise.
- [ ] AC1 A valid credential for a new email with a profile creates the account with `google_sub` stored, 201,
  `UserOut`, a `rent_session` cookie with `/auth/otp/verify`'s attributes, and `last_login_at` set —
  `api/tests/test_google.py::test_ac1_new_account`
- [ ] AC2 A new email without a profile → 422 `profile_required`, no row; the same credential with a profile
  then → 201 — `test_google.py::test_ac2_profile_required_then_created`
- [ ] AC3 An existing (OTP-created) account found by email in another case (`Noa@Example.com` vs
  `noa@example.com`) with no `google_sub` is linked and logged in, 200; the next sign-in with the same `sub` and
  a different Google email still finds it — `test_google.py::test_ac3_links_existing_account`
- [ ] AC4 Found by `sub` while the Google email changed (even to another account's email) → logs into the `sub`'s
  account; neither account's email changes — `test_google.py::test_ac4_sub_wins_over_email`
- [ ] AC5 Email matches an account linked to a different sub → 409 `google_account_conflict`, its `google_sub`
  unchanged, no session row — `test_google.py::test_ac5_conflicting_sub`
- [ ] AC6 `google` backend (`set_env(GOOGLE_VERIFIER="google", GOOGLE_CLIENT_ID="test-client")`): an RSA key
  generated in the test (`cryptography`; never a committed key), its public key as PKCS#1 PEM served by a
  monkeypatched `_google_certs` / fetch under kid `k1`, tokens made with `google.auth.crypt.RSASigner` +
  `google.auth.jwt.encode`. A valid token → 200/201; each of `email_verified` false or missing, signed by
  another key, unknown kid, `aud` other, `iss` other, expired (`exp` in the past beyond the 10 s skew), no
  `iat`, a `fake:` string, garbage → 401 `invalid_google_token`, no row written —
  `test_google.py::test_ac6_rejects_bad_tokens` (parametrised)
- [ ] AC7 Suspended account (found by sub, and found by email with no sub) → 403 `account_suspended`, no session,
  `google_sub` not written; blocked email with no account → 403 `signup_blocked`, no row —
  `test_google.py::test_ac7_suspended_and_blocked`
- [ ] AC8 After `DELETE /me` of a Google-linked account, the same Google account (same sub and email) gets 422
  `profile_required` and then a **new** account (a new id; the tombstone untouched) — unless the email is
  blocked, then 403 `signup_blocked` — `test_google.py::test_ac8_deleted_account`
- [ ] AC9 Two concurrent first sign-ins with the same credential and profile (two threads behind a
  `threading.Barrier`, as `test_auth.py::test_otp_single_use_under_concurrency`) create one account: one 201,
  one 200, one row —
  `test_google.py::test_ac9_race`
- [ ] AC10 Config: `GOOGLE_VERIFIER=google` with an empty `GOOGLE_CLIENT_ID` fails (http and https); with an https
  `WEB_ORIGIN`, `fake` fails and `off` (default) or `google` + client id pass —
  `api/tests/test_config.py::test_ac10_google_verifier_guard`
- [ ] AC11 Rate limit: the 31st request in 15 minutes from one network → 429 with Retry-After, and
  `verify_credential` is not called (counted with a monkeypatched spy) — `test_google.py::test_ac11_rate_limit`
- [ ] AC12 Web: no button and no script tag without `VITE_GOOGLE_CLIENT_ID`; with it (`vi.stubEnv`) and a stubbed
  `window.google`, `initialize` gets the client id and `renderButton` is called; the callback posts the
  credential; 200 navigates to `next`; 422 opens the panel with the name pre-filled from a test JWT (a Hebrew
  name) and the role question per `askRoleFor`; the panel's submit posts `{credential, profile}`; cancel closes
  it; 401, 409, 403 (both), 429 (with the wait) and 503 each show their text; a script `error` collapses the
  area — `web/src/features/auth/__tests__/GoogleButton.test.tsx`
- [ ] AC13 e2e (CI only): with the GIS script stubbed, a new person signs up with Google from `/signup` (panel:
  role, name, submit) and lands signed in; after logout, `/login` with the same fake credential logs straight in
  — `web/e2e/auth.spec.ts::ac13_google_signup_then_login`
- [ ] AC14 The privacy policy shows `s3.i6` (Google, what it shares) and the updated `s1.i1` — the existing
  `web/src/features/legal/__tests__/LegalPage.test.tsx::ac9_legal_pages` (it checks every catalogue line is on the
  page) plus `ac14_privacy_names_google_sign_in` (the Google item is in section 3's list)
- [ ] AC15 Availability: `off` → 503 `google_unavailable`; the `google` backend with the key fetch raising
  `httpx.ConnectTimeout` (or a 500) → 503 and no row; two verifications within `max-age` fetch the keys once, and
  one after it fetches again — `test_google.py::test_ac15_keys_cached_and_fetch_failure_is_503`
- [ ] NF1 The credential never appears in a log line (`caplog` at DEBUG over 200, 401, 409, 422 and 503 answers) or
  a response body, including a 422 for a 4097-character credential —
  `test_google.py::test_nf1_credential_not_logged`
- [ ] NF2 a11y: `/login` and `/signup` with the stub button, and the open panel, pass axe —
  `web/e2e/a11y.spec.ts` (the existing `/login` / `/signup` checks, now with the stub; the panel added)

## Tests to write
Integration: `api/tests/test_google.py` (AC1–AC9, AC11, AC15, NF1; a fixture clears `services/google.py`'s key
cache), AC10 in `test_config.py`, the `OWN` entry in `test_hardening.py`. Web: vitest AC12, AC14. E2E (smoke,
CI only — never run locally): AC13, NF2; they send no emailed code, so the shard code budget (`E2E_SHARDS`
comment in the `Makefile`) is unchanged. Existing `OtpForm.test.tsx`, `LoginPage.test.tsx`,
`SignupPage.test.tsx` and the 0016a tests must pass unchanged after the extraction (vitest's empty
`VITE_GOOGLE_CLIENT_ID` keeps the button out of them).

## Blast radius
From `graphify affected` (graph of an older `main`; checked with grep in this worktree).
- `services/auth.py::verify_otp` — not changed (its ON CONFLICT pattern is copied). Callers
  `routers/auth.py::verify_otp`, `test_auth.py::verify`, `test_code_survives_database_failure_at_login`,
  `test_otp_single_use_under_concurrency`: untouched. The router's cookie code moves into `_signed_in`, so
  `test_auth.py`'s cookie-attribute tests must stay green.
- `create_session` — called, not changed. Callers (`routers/auth.py::verify_otp`, `test_market_people.py`,
  `test_admin.py`, `test_ip_limits.py`, `test_moderation.py`): untouched.
- `accounts.email_blocked` — called, not changed (callers `verify_otp`, `test_auth.py`): untouched.
- `ProfileIn` (as 0016a leaves it) — gains a base class `GoogleProfileIn`; fields, validator and OpenAPI name
  unchanged, so `OtpVerifyIn`, `verify_otp`, 0016a's tests and the generated `web/src/api/schema.d.ts` users
  (`OtpForm`) are unaffected beyond `make client`.
- `Settings` / `_email_and_production_rules` — two fields, two rules. `get_settings` and every `test_config.py`
  test (`test_web_origin_accepts_a_single_origin`, `test_https_web_origin_refuses_dev_defaults`,
  `test_ac9_email_block_key_rules`, `test_ac13_*`, …): untouched, because the default `off` passes both rules
  and `_HTTPS_READY` needs no new key. `test_openapi_export.py::test_ac6_openapi_export_without_server` runs with
  `.env.example`'s values (`fake`, empty id): valid. `client_network`: untouched. 0013a's AC2 (`api.toml`
  validates): unaffected (`off`).
- `test_hardening.py` `OWN` / `EXEMPT` registries — `/auth/google` added to `OWN` (in Scope).
- `LoginPage`, `SignupPage` — gain `GoogleButton` + divider. Importers/renderers: `routes.tsx`, `App.tsx`,
  `LoginPage.test.tsx`, `SignupPage.test.tsx`, `routes.test.tsx` (auth, search), `ApplySection.test.tsx`,
  `JoinFlatPage.test.tsx`, `LandingPage.test.tsx`, `LegalPage.test.tsx`, `MarketMinePage.test.tsx`,
  `AccountDeletedPage.test.tsx`, `Layout.test.tsx`, `KitPreview.test.tsx`, `queryClient.test.tsx`,
  `SideSwitch.test.tsx`, `usePageTitle.test.tsx`: untouched, since vitest's `VITE_GOOGLE_CLIENT_ID` is empty.
  `web/e2e/screens/auth.screens.ts` (`make screens`, local, no client id): unchanged screenshots.
- `OtpForm` — profile fields, consent line and success block extracted (`ProfileFields.tsx`,
  `useCompleteSignIn.ts`), behaviour unchanged. Callers `LoginPage`, `SignupPage`; tests `OtpForm.test.tsx`,
  `LoginPage.test.tsx`, `SignupPage.test.tsx` and 0016a's `PasswordForm.test.tsx` must pass unchanged.
- `privacyDoc` (`legal/content.ts`) — one item added; used by `LegalPage.tsx`, `routes.tsx`; tested by
  `LegalPage.test.tsx` (in Scope).
- `routeTiles` / the `test` auto fixture / `newTileContext` (`web/e2e/fixtures.ts`) — also route GIS. Every spec
  importing `test` from `./fixtures` (`a11y`, `account`, `applications`, `auth`, `flatmates`, `inbox`, `kit`,
  `landing`, `layout`, `likes`, `listings`, `market`, `people-market`, `people`, `photos`, `reports`, `map`,
  `search`) and the `newTileContext` users (`flatmates`, `inbox`, `likes`, `market`, `people-market`, `people`,
  `photos`, `reports`): no edit; they gain the GIS route. `map.spec.ts::asVisitor` routes tiles on the fixture
  page, whose context already has the GIS route. `web/e2e/auth.spec.ts::ac5_auth_layout_desktop_and_mobile`
  sees the stub button in CI: adjust it only if its layout assertions measure the card's content.
- `ImportMetaEnv` (`vite-env.d.ts`), `vitest.config.ts` `env`, compose `web`/`api` env, `ci.yml` job env — one
  key each (in Scope).

## Risks / open questions
- **CSP (0013a):** 0013a's `_headers` CSP (`script-src 'self'`, no `frame-src`) would block the GIS script,
  its style and its button frame. Whichever of 0013a / 0016b merges second adds the GIS sources (Scope, last
  bullet); the orchestrator should add the same line to 0013a's Scope 9 now if 0013a builds after 0016b.
- Key fetch: handled in Scope (`_google_certs`: httpx, 5 s timeout, cached for `max-age`, 503 on failure).
  During a Google outage a cache refresh holds one worker for at most 5 s per attempt; logins with Google fail
  (503) while code and password logins work.
- Each worktree's `WEB_PORT` is a different origin, so the real button works only on origins listed in Setup
  step 2; builds and CI use the fake verifier and the stub, and need no origins.
- Linking by `email_verified` trusts Google's past verification of a non-Gmail address (Google is authoritative
  only for `@gmail.com` and Workspace `hd` accounts). Accepted by Gilad's "automatic linking" decision (PRODUCT
  "Login"); the security reviewer should note it, not change it.
- The privacy text above is a draft for Gilad's approval in the digest; the `s3.i5` "[מדינות]" placeholder
  should include the US once Google is a provider.

## Verifier notes (2026-11-16, one round, applied)
1. `verify_oauth2_token` re-fetches certs every call and has no timeout (120 s default): replaced by httpx fetch +
   cache + `google.auth.jwt.decode` + `iss` check; dependency is `google-auth` without `[requests]`.
2. Verifier default `fake` was an open door on any non-https deployment: default is now `off` (503), `fake` only
   via compose / tests; `google` needs a client id everywhere. Production can launch before the OAuth client.
3. `/auth/google` belongs in `test_hardening.py`'s `OWN`, not `EXEMPT` (it has its own limit).
4. `GoogleIdentity.name` and the fake format's name dropped: the API never uses the token's name.
5. CI renders the button only with `VITE_GOOGLE_CLIENT_ID` in `ci.yml`'s env; e2e stubs GIS in the shared auto
   fixture so no test reaches Google; vitest pins the variable empty.
6. ON CONFLICT without a conflict target (email or `google_sub`), the conditional link UPDATE, and the re-run of
   steps 3–4 on conflict made explicit; AC8 now tests the cleared `google_sub` of a tombstone.
7. Panel concretised: `ProfileFields` / `ConsentLine` / `useCompleteSignIn` extracted from `OtpForm`, the 0010b
   market-side role rule kept, JWT-only name pre-fill, cancel, focus, expired-credential path.
8. Added AC15 (availability), NF2 (axe); AC6 test approach made concrete; reviewers + `qa`.

## Digest (filled by orchestrator after verification)
