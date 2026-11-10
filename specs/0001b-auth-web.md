---
id: 0001b
title: A person signs up (as owner or seeker) or logs in from the web app with an email code, and the header shows who they are with a logout button
status: in-progress
depends_on: [0000b, 0001a]
reviewers: [code, qa, ux, security]   # ux: two new screens + header state; security: credentials handling in the client, no code leakage
estimate: 1 coder run
---

## Goal
After this ships, http://localhost:5173/signup lets a person pick owner or seeker, enter a display name and
email, receive a code and land back on `/` logged in; `/login` does the same for an existing account; the
header shows the display name and a logout button. Serves Dev Plan slice 1 (Auth + roles), part b of two,
on top of the API in `0001a`. The landing artboard (`design/screens-v1/Main.dc.html`) already has the three
entry points this slice serves: "כניסה" in the header and the two CTAs "יש לי דירה / חדר" (owner) and
"אני מחפש/ת" (seeker). Here the header gets כניסה / הרשמה links; `/signup?role=owner|seeker` exists for
Slice 9's landing CTAs, and nothing links to it in this slice.

## Scope
**In:**
- Routing: `react-router-dom` (new dependency). `web/src/app/App.tsx` wraps the tree in `BrowserRouter`;
  `web/src/app/routes.tsx` declares `/` (the `AreasList` from `0000b`), `/login`, `/signup` and a catch-all
  `*` → `<Navigate to="/" replace />`, all inside `web/src/app/Layout.tsx`, which renders the header
  (`app.title`, `app.tagline`, `AuthMenu`) above an `<Outlet />`. `0000b` AC8 smoke must still pass.
- `web/src/features/auth/`: `useMe.ts` (TanStack Query `['me']`, `GET /me`; a 401 resolves to `null`
  instead of throwing; `retry: false`; `staleTime` 60 s), `useLogout.ts` (mutation → `POST /auth/logout`,
  on success sets `['me']` to `null`), `OtpForm.tsx` (shared two-step form: step 1 collects fields and calls
  `POST /auth/otp/request`; step 2 collects the code and calls `POST /auth/otp/verify`), `RoleChoice.tsx`
  (`<fieldset>` + `<legend>` + two native `<input type="radio" name="role">` styled as the segmented buttons
  in `CreateListing.dc.html`; arrow keys and RTL come from the browser), `LoginPage.tsx`, `SignupPage.tsx`,
  `AuthMenu.tsx` (header fragment).
- `web/src/api/client.ts`: the `openapi-fetch` client from `0000b` gets `credentials: 'include'` so the
  `rent_session` cookie travels with every request. The API already answers with
  `Access-Control-Allow-Credentials: true` for the exact `WEB_ORIGIN` (`0001a` AC15 pins it).
- `web/src/locales/he.json` keys in UI below.
- Tests in `web/src/features/auth/__tests__/`, e2e in `web/e2e/auth.spec.ts`. No Makefile change:
  `make client` already regenerates the schema (the four new endpoints appear in `schema.d.ts`) and
  `make e2e` already runs every spec under `web/e2e/`.

**Out:**
- Landing page copy and layout (Slice 9). Role switching UI (comes with `PATCH /me`, later slice).
  Protected routes / redirects to `/login` (nothing to protect yet; Slice 2 adds the first). Phone fields.
  "Remember me" (sessions are 30 days fixed). Email change. Any API change.

**New dependencies** (pinned in `web/package.json`): `react-router-dom` 6.x. Tests use `fireEvent` from
`@testing-library/react` only (no `user-event`); native radio arrow-key behaviour is browser-provided and
is checked by the ux reviewer in a browser, not in jsdom.

## Data
None. Consumes `users`/`sessions` through the `0001a` endpoints.

## API
No new endpoints. Consumes from `0001a`: `POST /auth/otp/request` (public; 204 / 422 / 429 / 503),
`POST /auth/otp/verify` (public; 200 / 201 / 401 `invalid_code` / 422 `profile_required` or validation / no
429), `GET /me` (session cookie; 200 / 401), `POST /auth/logout` (public, idempotent; 204). All calls send
credentials.

## UI
No artboard exists for the login/signup screens; use `Main.dc.html` for tokens (background `#F7F5F2`, ink
`#1C1917`, accent `#0E7C6B`, radii 12–20px) and header anatomy, and `CreateListing.dc.html` for form-field
anatomy (label above field, hint below, primary button full width at the bottom on mobile) and the
segmented-button look of `RoleChoice`. Single column, `max-w-[480px]` centred, `px-4`. Logical properties
only (`ps-`, `pe-`, `ms-`, `me-`, `text-start`). Forms are `<form noValidate>`: all validation messages come
from `he.json`, never from browser-locale bubbles.

**Header (`Layout` → `AuthMenu`, on every route)**
- RTL: brand (`app.title`) at the inline start, `AuthMenu` at the inline end; tap targets ≥ 44 px as in
  `Main.dc.html`.
- loading (`useMe` pending): a 96×20 `Skeleton` in place of the menu.
- logged out (`null`): link `header.login` → `/login`, primary link `header.signup` → `/signup`.
- logged in: `header.greeting` with `{{name}}` and button `header.logout`; while the logout mutation is
  pending the button is disabled with `aria-busy`. Logout error: the button re-enables, the state stays
  logged in, no message (the person simply tries again).
- error (network failure on `/me`): render the logged-out state (never block the shell on auth).

**`/signup` (`SignupPage` → `OtpForm` with profile)**. `<h1>` = `auth.signup.title`. A logged-in person
(`useMe` resolves to a user) is sent to `/` with `<Navigate replace />`.
- Step 1 — empty: `RoleChoice` (legend `auth.role.label`, radios `auth.role.owner` / `auth.role.seeker`;
  preselected from `?role=owner|seeker` when present, otherwise none selected and the submit is disabled
  until chosen), `auth.name.label` input (validated as `[...name.trim()].length` between 2 and 40 code
  points, matching Postgres `char_length`; message `auth.errors.nameLength`; the trimmed value is sent),
  `auth.email.label` input (`type="email"`, `dir="ltr"`, `text-start`; client format check
  `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, message `auth.errors.invalidEmail`), submit `auth.sendCode`.
  loading: submit disabled + `aria-busy`. error (all `role="alert"`): client validation →
  `auth.errors.nameLength` / `auth.errors.invalidEmail`; 422 → `auth.errors.invalidEmail`; 429 →
  `auth.errors.tooMany`; 503 / network / 5xx → `common.error` + `common.retry` (retry resubmits step 1).
  success: step 2, focus moves to the code input.
- Step 2 — empty: `auth.code.sentTo` with `{{email}}`, code input labelled `auth.code.label`
  (`inputMode="numeric"`, `autoComplete="one-time-code"`, `dir="ltr"`, `maxLength=6`; submit disabled until
  it holds exactly 6 digits), submit `auth.verify`, secondary `auth.resend` disabled for 30 s showing
  `auth.resendIn` `{{seconds}}` (a successful resend restarts the 30 s), link `auth.changeEmail` back to
  step 1 with the fields kept.
  loading: submit disabled + `aria-busy`. error (`role="alert"`, focus stays in the code input): 401 →
  `auth.errors.invalidCode`; 422 whose `detail` is not `'profile_required'` and any other failure →
  `common.error`; a resend answering 429 → `auth.errors.tooMany`. success: **200 or 201** → `['me']` set
  from the response body, `navigate('/')`. (200 happens when the email already has an account: the person
  lands logged in with their stored name and role; the profile they typed is ignored and no message is shown.)

**`/login` (`LoginPage` → `OtpForm` without profile)**. `<h1>` = `auth.login.title`. Same logged-in redirect.
- Step 1: email only (same validation and states as above), submit `auth.sendCode`.
- Step 2: as above. Additionally, on a 422 whose body is exactly `{"detail":"profile_required"}` (typed
  guard on the generated 422 union, no `any`) the form reveals `RoleChoice` and the name input inline under
  the code with the hint `auth.noAccountYet`, focuses the first radio, and the next submit sends the same
  code plus `profile` — no second email.

**RTL**: `dir="rtl"` inherited from `<html>`; email and code inputs are `dir="ltr"` with `text-start` so the
caret and digits read naturally; the radio group's first option (owner) sits at the inline start and arrow
keys follow the browser's RTL handling.

**i18n keys added to `he.json`** (placeholder copy; Slice 9 owns final wording):

| key | value |
| --- | --- |
| `header.login` | `כניסה` |
| `header.signup` | `הרשמה` |
| `header.logout` | `התנתקות` |
| `header.greeting` | `שלום, {{name}}` |
| `auth.login.title` | `כניסה` |
| `auth.signup.title` | `הרשמה` |
| `auth.role.label` | `מה מתאים לך?` |
| `auth.role.owner` | `יש לי דירה / חדר` |
| `auth.role.seeker` | `אני מחפש/ת` |
| `auth.name.label` | `איך לקרוא לך?` |
| `auth.email.label` | `אימייל` |
| `auth.sendCode` | `שלחו לי קוד` |
| `auth.code.sentTo` | `שלחנו קוד בן 6 ספרות אל {{email}}` |
| `auth.code.label` | `הקוד מהאימייל` |
| `auth.verify` | `כניסה` |
| `auth.resend` | `שליחה חוזרת` |
| `auth.resendIn` | `שליחה חוזרת בעוד {{seconds}} שניות` |
| `auth.changeEmail` | `החלפת אימייל` |
| `auth.noAccountYet` | `עוד אין חשבון עם האימייל הזה. עוד שני פרטים ונסיים:` |
| `auth.errors.invalidCode` | `הקוד שגוי או שפג תוקפו` |
| `auth.errors.tooMany` | `יותר מדי ניסיונות. נסו שוב בעוד כמה דקות` |
| `auth.errors.nameLength` | `השם צריך להיות באורך 2 עד 40 תווים` |
| `auth.errors.invalidEmail` | `כתובת האימייל לא תקינה` |

## Acceptance criteria
- [ ] AC1 Given `/me` is pending, Then the header shows the skeleton; Given it returns 200 with `display_name` "נועה", Then the header shows `header.greeting` with נועה and a `header.logout` button and no `header.login` link; When logout is clicked, Then the button is disabled with `aria-busy` while pending and the header shows `header.login` after 204 — `web/src/features/auth/__tests__/AuthMenu.test.tsx::ac1_skeleton_then_name_then_logout`
- [ ] AC2 Given `/me` returns 401, Then the header shows `header.login` and `header.signup` links; Given it fails with a network error, Then the same, within 100 ms (no retries) — `web/src/features/auth/__tests__/AuthMenu.test.tsx::ac2_logged_out_on_401_and_on_error`
- [ ] AC3 Given `/signup?role=seeker`, When the user enters `"  נועה "` and an email and submits, Then the submit is disabled with `aria-busy` while pending, `POST /auth/otp/request` is called with that email, step 2 shows `auth.code.sentTo` with the email and the code input has focus, and seeker is preselected; When a code is submitted, Then `POST /auth/otp/verify` is called with `profile: {display_name: "נועה", role: "seeker"}` and on 201 the app navigates to `/`; the same with a 200 response also navigates to `/` — `web/src/features/auth/__tests__/SignupPage.test.tsx::ac3_signup_sends_profile_and_navigates_on_200_or_201`
- [ ] AC4 Given `/signup` without `?role`, Then the submit is disabled until a role is chosen; Given a 1-char name, Then `auth.errors.nameLength` is shown and no request is made; Given `a@b`, Then `auth.errors.invalidEmail` and no request; Given the API answers 422 to the request, Then `auth.errors.invalidEmail` — `web/src/features/auth/__tests__/SignupPage.test.tsx::ac4_client_and_server_validation`
- [ ] AC5 Given `/login`, When the request fails with a network error, Then `common.error` and `common.retry` are shown and retry resubmits; When verify returns 401, Then `auth.errors.invalidCode` is shown in an element with `role="alert"` and the code input keeps focus — `web/src/features/auth/__tests__/LoginPage.test.tsx::ac5_network_error_retry_and_invalid_code`
- [ ] AC6 Given `/login`, When verify returns 422 `{"detail":"profile_required"}`, Then the role radios and name input appear with `auth.noAccountYet` and the first radio has focus, and submitting them calls verify again with the same code plus `profile`; When verify returns a 422 with a list `detail`, Then `common.error` instead — `web/src/features/auth/__tests__/LoginPage.test.tsx::ac6_profile_required_reveals_profile_fields`
- [ ] AC7 Given `make dev` is up with the file email backend, When Playwright opens `/signup`, picks owner, enters a name and a unique `…@example.com` email, reads the code from `../.outbox/*.json` (relative to Playwright's cwd `web/`) choosing the file whose `to` equals that email with the newest `sent_at`, extracting `/\b\d{6}\b/` from `body`, submits it, Then the URL is `/` and the header shows the name; clicking `header.logout` shows `header.login` again — `web/e2e/auth.spec.ts::ac7_signup_via_outbox_and_logout`
- [ ] AC8 Given step 2 is shown, Then `auth.resend` is disabled and `auth.resendIn` counts down (fake timers); after 30 s it is enabled, clicking it calls `POST /auth/otp/request` again and restarts the countdown; a resend answering 429 shows `auth.errors.tooMany` — `web/src/features/auth/__tests__/OtpForm.test.tsx::ac8_resend_cooldown_and_rate_limit`
- [ ] AC9 Given `/me` returns 200, When the person opens `/login` or `/signup`, Then they are redirected to `/`; Given an unknown path, Then `/` — `web/src/features/auth/__tests__/routes.test.tsx::ac9_redirects`
- [ ] NF1 `make i18n-check`, `eslint`, `prettier --check`, `tsc --noEmit` clean on the real tree — CI `web` job
- [ ] NF2 Every input has a visible `<label>` bound by `htmlFor` (the radios via `<legend>` + per-radio labels); errors use `role="alert"`; radios are reachable by `getByRole('radio', {name})` — enforced by the label-based queries in AC3–AC6 and checked by the ux reviewer in a browser (arrow keys, RTL order)
- [ ] NF3 The email and code live in component state only (never `localStorage`, `sessionStorage` or the URL) and there is no `console.*` call under `features/auth/` — `grep` in the CI `web` job is not needed; checked by the security reviewer

## Tests to write
Unit (vitest + testing-library `fireEvent`, mocked `fetch` sequences, `MemoryRouter`, test `QueryClient`s with
`retry: false`): AC1–AC6, AC8, AC9.
Integration: none.
E2E (Playwright, `make e2e`): AC7, reading `../.outbox/` as described there.

## Risks / open questions
- Cookie across `localhost:5173` → `localhost:8000`: same-site (same host, different port), so a
  `SameSite=Lax` cookie is sent on `fetch` with `credentials: 'include'`. If `localhost` resolution is ever
  flaky in e2e, switch page, API and `WEB_ORIGIN` to `127.0.0.1` **together** (Playwright `baseURL`,
  `VITE_API_URL=http://127.0.0.1:8000`, `WEB_ORIGIN=http://127.0.0.1:5173`); moving only one side makes them
  different sites and breaks both the cookie and CORS.
- A person who signs up with an email that already has an account silently logs into it (API returns 200).
  That is the intended behaviour, not a bug; `0001a` never overwrites a profile.
- No product questions: copy is placeholder (Slice 9), role options and signup fields are PRODUCT.md
  decisions of 2026-11-09.

Changes after verifier round 1 (2026-11-09): CORS credentials confirmed present in `0000a` code and pinned
by `0001a` AC15; 429 removed from verify (kept for request and resend); 200-on-signup path specified and
tested; `noValidate` forms with `auth.errors.invalidEmail` and a typed `profile_required` guard; the e2e
IPv4 fallback corrected; outbox file selection unified; loading, network-error and logout-pending states
covered by ACs; `retry: false`; `Layout`, catch-all and logged-in redirects (AC9); native radios in a
fieldset; `fireEvent` only; trimming, cooldown reset and change-email behaviour stated; NF3 secrecy added.

Verifier notes (2026-11-09): round 1 rejected with 14 findings, all applied above (finding 1 was wrong: `allow_credentials=True` already exists in 0000a; 0001a AC15 pins it); Gilad waived the second verifier round, so the orchestrator set `verified`.

## Digest (filled by orchestrator after verification)

    Spec 0001b — Auth web: signup / login / header   (verified, part 2 of 2, depends on 0000b and 0001a)
    What a user can do after this: open /signup, pick "יש לי דירה / חדר" or "אני מחפש/ת", enter a name and email, type the emailed code and land on / logged in; /login for returning users; header shows the name with התנתקות.
    Decisions I need from you (reply with numbers):
      1. Approve build of 0001b after 0000b and 0001a are merged (recommend: yes).
      2. Signing up with an email that already has an account silently logs into it, profile ignored (recommend: accept; no account enumeration, no duplicate accounts).
      3. Placeholder Hebrew copy for 23 new keys (recommend: accept; Slice 9 owns final wording).
    KPIs this slice moves: signup completion rate (first funnel we can measure).
    Acceptance targets: NF1 eslint, prettier, tsc, i18n-check clean · NF2 every input labelled, errors role=alert, native radios · NF3 code/email never in storage or URL, no console.* in features/auth.
    Risks: cookie only works when page and API share the localhost site — mitigation: README says localhost; e2e fallback switches all three settings together.
           No artboard for login/signup — mitigation: tokens from Main.dc.html, field anatomy from CreateListing.dc.html; ux reviewer compares.
    Reviewers: code, qa, ux, security   Estimated: 1 coder run, 1 review round
    Links: specs/0001b-auth-web.md · PRODUCT.md "Account roles", "Signup data", "Language" · design/screens-v1/Main.dc.html (header, CTAs), CreateListing.dc.html (form anatomy)
