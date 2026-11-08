---
id: 0001b
title: A person signs up (as owner or seeker) or logs in from the web app with an email code, and the header shows who they are with a logout button
status: draft
depends_on: [0000b, 0001a]
reviewers: [code, qa, ux, security]   # ux: two new screens + header state; security: credentials handling in the client, no code leakage
estimate: 1 coder run
---

## Goal
After this ships, http://localhost:5173/signup lets a person pick owner or seeker, enter a display name and
email, receive a code and land back on `/` logged in; `/login` does the same for an existing account; the
header shows the display name and a logout button. Serves Dev Plan slice 1 (Auth + roles), part b of two,
on top of the API in `0001a`. The landing artboard (`design/screens-v1/Main.dc.html`) already has the three
entry points this slice implements: "כניסה" in the header and the two CTAs "יש לי דירה / חדר" (owner) and
"אני מחפש/ת" (seeker); the landing page itself is Slice 9, here they become header links.

## Scope
**In:**
- Routing: `react-router-dom` (new dependency) with routes `/` (the `AreasList` shell from `0000b`),
  `/login`, `/signup`. `web/src/app/App.tsx` wraps the tree in `BrowserRouter`; `web/src/app/routes.tsx`.
- `web/src/features/auth/`: `useMe.ts` (TanStack Query `['me']`, `GET /me`; a 401 resolves to `null`
  instead of throwing; `staleTime` 60 s), `useLogout.ts` (mutation → `POST /auth/logout`, then sets `['me']`
  to `null`), `OtpForm.tsx` (shared two-step form: step 1 collects fields and calls
  `POST /auth/otp/request`; step 2 collects the code and calls `POST /auth/otp/verify`), `RoleChoice.tsx`
  (two-option segmented control, `role="radiogroup"`), `LoginPage.tsx`, `SignupPage.tsx`,
  `AuthMenu.tsx` (header fragment).
- `web/src/api/client.ts`: the `openapi-fetch` client from `0000b` gets `credentials: 'include'` so the
  `rent_session` cookie travels with every request.
- `Makefile`: `make client` regenerates the schema (the four new endpoints appear in `schema.d.ts`).
  `make e2e` reads OTP codes from `.outbox/` (see AC7).
- `web/src/locales/he.json` keys in UI below.
- Tests in `web/src/features/auth/__tests__/`, e2e in `web/e2e/auth.spec.ts`.

**Out:**
- Landing page copy and layout (Slice 9). Role switching UI (comes with `PATCH /me`, later slice).
  Protected routes / redirects to `/login` (nothing to protect yet; Slice 2 adds the first). Phone fields.
  "Remember me" (sessions are 30 days fixed). Email change. Any API change.

**New dependencies** (pinned in `web/package.json`): `react-router-dom` 6.x. Nothing else.

## Data
None. Consumes `users`/`sessions` through the `0001a` endpoints.

## API
No new endpoints. Consumes from `0001a`: `POST /auth/otp/request` (public), `POST /auth/otp/verify` (public),
`GET /me` (session cookie), `POST /auth/logout` (public, idempotent). All calls send credentials.

## UI
No artboard exists for the login/signup screens; use `Main.dc.html` for tokens (background `#F7F5F2`, ink
`#1C1917`, accent `#0E7C6B`, radii 12–20px) and header anatomy, and `CreateListing.dc.html` for form-field
anatomy (label above field, hint below, primary button full width at the bottom on mobile). Single column,
`max-w-[480px]` centred, `px-4`. Logical properties only (`ps-`, `pe-`, `ms-`, `me-`, `text-start`).

**Header (`AuthMenu`, in the shell header on every route)**
- loading (`useMe` pending): a 96×20 `Skeleton` in place of the menu.
- logged out (`null`): link `header.login` → `/login`, primary link `header.signup` → `/signup`.
- logged in: `header.greeting` with `{{name}}` and button `header.logout`; while the logout mutation is
  pending the button is disabled with `aria-busy`.
- error (network failure on `/me`): render the logged-out state (never block the shell on auth).

**`/signup` (`SignupPage` → `OtpForm` with profile)**
- Step 1 — empty: `RoleChoice` (`auth.role.owner` / `auth.role.seeker`; preselected from `?role=owner|seeker`
  when present, otherwise none selected and the submit is disabled until chosen), `auth.name.label` input
  (2–40 chars, client validation message `auth.errors.nameLength`), `auth.email.label` input (`type=email`,
  `dir="ltr"`, `text-start`), submit `auth.sendCode`.
  loading: submit disabled + `aria-busy`. error: 429 → `auth.errors.tooMany` (role=alert), network/5xx →
  `common.error` + `common.retry`. success: step 2.
- Step 2 — empty: `auth.code.sentTo` with `{{email}}`, 6-digit input (`inputMode="numeric"`,
  `autoComplete="one-time-code"`, `dir="ltr"`), submit `auth.verify`, secondary `auth.resend` disabled for
  30 s with `auth.resendIn` `{{seconds}}` countdown, link `auth.changeEmail` back to step 1.
  loading: submit disabled + `aria-busy`. error: 401 → `auth.errors.invalidCode`; 429 → `auth.errors.tooMany`;
  other → `common.error`. success: `['me']` set from the response body, `navigate('/')`.

**`/login` (`LoginPage` → `OtpForm` without profile)**
- Step 1: email only, submit `auth.sendCode`. States as above.
- Step 2: code input as above. On 422 `profile_required` (no account for this email) the form reveals
  `RoleChoice` and the name input inline under the code with the hint `auth.noAccountYet`, and resubmits
  the same code with `profile` — no second email. Other states as above.

**RTL**: `dir="rtl"` inherited from `<html>`; email and code inputs are `dir="ltr"` with `text-start` so the
caret and digits read naturally; the segmented control's first option (owner) sits at the inline start.

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

## Acceptance criteria
- [ ] AC1 Given `/me` returns 200 with `display_name` "נועה", When the shell renders, Then the header shows `header.greeting` with נועה and a `header.logout` button and no `header.login` link — `web/src/features/auth/__tests__/AuthMenu.test.tsx::ac1_shows_name_and_logout_when_logged_in`
- [ ] AC2 Given `/me` returns 401, Then the header shows `header.login` and `header.signup` links; Given it fails with a network error, Then the same — `web/src/features/auth/__tests__/AuthMenu.test.tsx::ac2_logged_out_on_401_and_on_error`
- [ ] AC3 Given `/signup?role=seeker`, When the user enters a name and email and submits, Then `POST /auth/otp/request` is called with that email, step 2 shows `auth.code.sentTo` with the email, and seeker is preselected; When a code is submitted, Then `POST /auth/otp/verify` is called with `profile: {display_name, role: "seeker"}` and on 201 the app navigates to `/` — `web/src/features/auth/__tests__/SignupPage.test.tsx::ac3_signup_sends_profile_and_navigates`
- [ ] AC4 Given `/signup` without `?role`, Then the submit is disabled until a role is chosen; Given a 1-char name, Then `auth.errors.nameLength` is shown and no request is made — `web/src/features/auth/__tests__/SignupPage.test.tsx::ac4_requires_role_and_valid_name`
- [ ] AC5 Given `/login`, When verify returns 401, Then `auth.errors.invalidCode` is shown in an element with `role="alert"` and the code input keeps focus; When it returns 429, Then `auth.errors.tooMany` — `web/src/features/auth/__tests__/LoginPage.test.tsx::ac5_shows_invalid_code_and_rate_limit_errors`
- [ ] AC6 Given `/login`, When verify returns 422 `profile_required`, Then the role choice and name input appear with `auth.noAccountYet`, and submitting them calls verify again with the same code plus `profile` — `web/src/features/auth/__tests__/LoginPage.test.tsx::ac6_profile_required_reveals_profile_fields`
- [ ] AC7 Given `make dev` is up with the file email backend, When Playwright opens `/signup`, picks owner, enters a name and a unique email, reads the 6-digit code from the newest JSON file in `.outbox/`, submits it, Then the URL is `/` and the header shows the name; clicking `header.logout` shows `header.login` again — `web/e2e/auth.spec.ts::ac7_signup_via_outbox_and_logout`
- [ ] AC8 Given step 2 is shown, Then `auth.resend` is disabled and `auth.resendIn` counts down (fake timers); after 30 s it is enabled and clicking it calls `POST /auth/otp/request` again — `web/src/features/auth/__tests__/OtpForm.test.tsx::ac8_resend_cooldown`
- [ ] NF1 `make i18n-check`, `eslint`, `prettier --check`, `tsc --noEmit` clean on the real tree — CI `web` job
- [ ] NF2 Every input has a visible `<label>` bound by `htmlFor`; errors use `role="alert"`; the segmented control is keyboard-operable (arrow keys) — checked by the ux reviewer and by `@testing-library` queries by label in AC3–AC6

## Tests to write
Unit (vitest + testing-library, mocked `fetch` sequences, `MemoryRouter`): AC1–AC6, AC8.
Integration: none.
E2E (Playwright, `make e2e`): AC7; it reads `.outbox/*.json` from the repo root (mounted into the api
container by `0001a`) and picks the file whose `to` equals the email it typed.

## Risks / open questions
- Cookie across `localhost:5173` → `localhost:8000`: same-site (same host, different port), so a
  `SameSite=Lax` cookie is sent on `fetch` with `credentials: 'include'`. If a developer opens the app on
  `127.0.0.1:5173` instead, CORS (exact `WEB_ORIGIN`) rejects the request; README already says `localhost`.
- The API container binds the published port on `127.0.0.1` only; browsers resolving `localhost` to `::1`
  first fall back to IPv4. If AC7 is flaky on that, set `VITE_API_URL=http://127.0.0.1:8000` in e2e only
  (then `WEB_ORIGIN` must stay `http://localhost:5173` — it is the page origin, not the API's).
- No product questions: copy is placeholder (Slice 9), role options and signup fields are PRODUCT.md
  decisions of 2026-11-09.

## Digest (filled by orchestrator after verification)
See `/digest`.
