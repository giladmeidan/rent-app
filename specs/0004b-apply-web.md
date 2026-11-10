---
id: 0004b
title: A seeker applies from the listing page with a short message, follows their applications and withdraws one on "my applications"; a visitor is asked to log in and comes back to the listing; everyone sees the applicant count
status: in-review
depends_on: [0004a]
reviewers: [code, qa, ux, security]   # ux: a new screen and a changed one; security: the login return path (`?next=`, open-redirect rule from FOLLOWUPS 0001b) and a user-to-user message form; qa: states and error mapping
estimate: 1 coder run
---

## Goal
After this ships, the public listing page `/listings/:id` shows "12 מועמדים הגישו מועמדות" (the exact count,
PRODUCT.md "Applicant count") and an apply section: a visitor sees "log in to apply" with links that bring them
back to this listing after login or signup; an owner sees no apply control; a seeker clicks "הגש/י מועמדות"
(`design/screens-v1/Listing.dc.html`), writes a message and sends it, then sees "sent" and their status; and
`/me/applications` lists the seeker's applications with status and a withdraw button. Serves Dev Plan slice 4
(Apply + inbox), part b of four (split in `0004a` Goal). API: `0004a`.

## Scope
**In:**
- `web/src/features/listings/api.ts`: `export type ListingDetail = components['schemas']['ListingDetail']`;
  `fetchPublicListing` returns `ListingDetail`. `usePublicListing.ts`: `refetchOnWindowFocus: false` (each fetch
  is a counted view, `0004a`; one line).
- `web/src/features/applications/` (new feature folder):
  - `api.ts`: types `MyApplicationOut`, `ApplicationStatus` (from the generated schema); `applyToListing(listingId,
    message)`, `fetchMyApplications()`, `withdrawApplication(id)`, each throwing `ApiError` (imported from
    `features/listings/api.ts`) on a non-2xx, as `features/listings/api.ts` does.
  - `useMyApplications.ts`: `MY_APPLICATIONS_KEY = ['me', 'applications']` (under `['me', …]`, so `useLogout`
    already removes it), `useMyApplications(enabled = true)`.
  - `useApply.ts` (mutation): `onSuccess(app)` → `setQueryData(MY_APPLICATIONS_KEY, old => old && [app,
    ...old.filter(a => a.id !== app.id)])` and `setQueryData(['listing', listingId], old => old && {...old,
    applicant_count: old.applicant_count + 1})` (a new and a reopened application both add one; no refetch, so no
    extra counted view).
  - `useWithdraw.ts` (mutation): `onSuccess(app)` → replace by id in `MY_APPLICATIONS_KEY`. No listing
    invalidation: `['listing', id]` has the default `staleTime` 0, so it is already stale and refetches on its next
    mount (verifier 5).
  - `ApplySection.tsx`: the section described in UI, rendered by `ListingPage` as the last child of the
    `<article>` (after the location section), with the listing. Uses `useMe()`; calls `useMyApplications(me is
    a seeker)` so a visitor or an owner never requests `GET /me/applications`.
  - `ApplicationStatusChip.tsx`: one pill per status (as `StatusBadge`'s anatomy).
  - `MyApplicationsPage.tsx`: `/me/applications`, see UI.
- `web/src/features/auth/useLogout.ts`: its `onSuccess` body moves into an exported
  `clearSession(queryClient)` (`setQueryData(ME_KEY, null)` + remove the `['me', …]` per-user queries), which
  `onSuccess` calls. On a **401** from any of the three seeker calls, the hook first calls `clearSession`, then:
  apply → navigate to `/login?next=…`; `GET /me/applications` in `ApplySection` → the visitor prompt (`/me` is now
  `null`); on `MyApplicationsPage` (list or withdraw) → `RequireSeeker` redirects to `/login`. Without it the
  cached seeker in `['me']` (`staleTime` 60 s) makes `LoginPage` bounce straight back to `next` (verifier 1).
- `web/src/features/auth/RequireSeeker.tsx` (new, copy of `RequireOwner`): logged out → `/login`, an owner →
  `/`, `/me` pending → `Skeleton`, `/me` error → `ErrorState`.
- `web/src/features/auth/next.ts` (new): `safeNext(raw: string | null): string` — returns `raw` when it starts
  with exactly one `/`, its second character is neither `/` nor `\`, and it contains no ASCII control
  character, space or backslash anywhere; otherwise `'/'`. (FOLLOWUPS `0001b` · `routes.tsx` standing rule.)
  `LoginPage` and `SignupPage` read `next` with `useSearchParams`, pass `next={safeNext(…)}` to `OtpForm`, and
  their logged-in `<Navigate>` goes to that value; `OtpForm` gains `next: string` (default `'/'`) and its
  success `navigate('/')` becomes `navigate(next)`. Nothing else in auth changes.
- `web/src/app/routes.tsx`: `<Route element={<RequireSeeker />}><Route path="me/applications"
  element={<MyApplicationsPage />} /></Route>`.
- `web/src/features/auth/AuthMenu.tsx`: a seeker gets a link `header.myApplications` → `/me/applications`, styled
  and placed exactly as the owner's `header.myListings` link (the greeting gets `max-sm:hidden` for a seeker too).
- `web/src/locales/he.json`: the keys in UI.
- Tests: `web/src/features/applications/__tests__/ApplySection.test.tsx`, `MyApplicationsPage.test.tsx`,
  `RequireSeeker.test.tsx`, `fixtures.ts` (`application(overrides)` → `MyApplicationOut`); `web/src/features/
  auth/__tests__/next.test.ts`; additions to `AuthMenu.test.tsx`, `LoginPage.test.tsx`, `SignupPage.test.tsx`; `web/src/features/search/
  __tests__/fixtures.ts` gains `listingDetail(overrides)` (= `publicListing` + `applicant_count: 0`), used by
  `ListingPage.test.tsx` (whose `ac7_public_listing_page` adds `'GET /me': [json({ detail: 'unauthenticated' },
  401)]`; assertions otherwise unchanged).
- E2E: `web/e2e/applications.spec.ts` (new); `web/e2e/helpers.ts`: `signUp(page, role, { start = '/signup',
  expectUrl = '/', name = '\u05d3\u05e0\u05d4' } = {})` (the body of `signUpOwner` with the role, the start URL, the URL
  expected after verify and the display name as parameters; `signUpOwner(page)` stays, as `signUp(page,
  'owner')`; `0004d` passes another `name` to tell the seeker from the owner) and
  `postListing(page, street)` (the `page.request` POST of `search.spec.ts`, returning the id).
- `Makefile` `e2e` target: before `playwright test`, clear the compose Redis rate-limit keys:
  `$(COMPOSE) exec -T redis redis-cli EVAL "for _,k in ipairs(redis.call('KEYS',ARGV[1])) do redis.call('DEL',k) end return 0" 0 'rl:*'`
  (the dev / CI compose stack only; CI runs `make e2e` too), so a local rerun within 15 min does not hit the OTP
  limit of 10 per IP. `0004d`'s e2e relies on the same line (verifier 4).
- `specs/FOLLOWUPS.md`: the `0001b` · `routes.tsx` return-path entry → `[x] … · done in 0004b: safeNext()`; the
  `0001b` · `web/e2e/auth.spec.ts` entry gains "· the `make e2e` `rl:*` clear (0004b) removes the OTP-budget
  blocker".

**Out:**
- The owner's inbox and the counts on "my listings": `0004d`.
- "קבע/י סיור" (schedule a viewing) and anything chat: Slice 5. The match card on the listing page: Slice 6.
- Editing a sent message (withdraw and re-apply instead, `0004a` Q2). A "no longer available" marker on an
  application whose listing was paused (`0004a` Out; its title link then shows `listing.notFound`).
- A sticky bottom action bar (the artboard's bottom buttons): the section sits in the page flow; Slice 9 polish.
- A return path from `RequireOwner` / `RequireSeeker` redirects (they keep redirecting to plain `/login`).
- Owner identity anywhere on the seeker's side (`0004a` Q3).

**New dependencies:** none.

## Data
None. Consumes `0004a`'s API.

## API
No endpoint is added or changed here. Consumed:
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /listings/{id} (`0004a`) | public | – | 200 `ListingDetail` (incl. `applicant_count`) | 404 · 422 · 503 |
| GET | /me (`0001a`) | session | – | 200 `UserOut` | 401 |
| POST | /listings/{id}/applications (`0004a`) | seeker session | `{"message": trimmed text}` | 201 `MyApplicationOut` | 401 · 403 `seeker_only` · 404 · 409 `already_applied` · 422 · 429 `rate_limited` · 503 |
| GET | /me/applications (`0004a`) | seeker session | – | 200 `list[MyApplicationOut]` | 401 · 403 · 503 |
| POST | /me/applications/{id}/withdraw (`0004a`) | seeker session, own application | – | 200 `MyApplicationOut` | 401 · 403 · 404 · 409 `not_withdrawable` · 503 |

## UI
Artboard: `design/screens-v1/Listing.dc.html` (the "הגש/י מועמדות" primary button). No artboard exists for the
apply form or "my applications"; they reuse the listing card and pill anatomy. Logical properties only; the
page inherits `dir="rtl"`; every interactive target ≥ 44 px.

**Listing page apply section (`ApplySection`, a `<section aria-labelledby>` with `<h2>` `applications.heading`)**:
- Count line, always (any viewer, any state below): `<p>` `applications.count.zero` when 0,
  `applications.count.one` when 1, `applications.count.many` (`{{count}}`) otherwise.
- loading (`/me` pending, or the seeker's `GET /me/applications` pending): one `Skeleton` (`aria-busy`, label
  `common.loading`) in place of the controls; the count line shows.
- visitor (`/me` null, or `/me` failed): `<p>` `applications.loginPrompt` and two links, `header.login` →
  `/login?next=<encodeURIComponent('/listings/' + id)>` and `header.signup` → `/signup?role=seeker&next=<same>`.
- owner: nothing but the count line.
- seeker, error loading their applications: an inline `ErrorState` with retry (refetches `GET /me/applications`);
  a 401 there → `clearSession`, so the section shows the visitor prompt.
- seeker, an application to this listing with status `submitted` / `shortlisted` / `declined` (applied state):
  `<p>` `applications.applied` (`{{date}}` = `formatDate(todayInIsrael(new Date(created_at)))`) with
  `ApplicationStatusChip`, `applications.declinedHint` under it when declined, and a link
  `applications.viewMine` → `/me/applications`. No apply button.
- seeker, no application or a `withdrawn` one (empty state): the primary button `applications.apply`
  (`aria-expanded`, `aria-controls` = the form's id). Clicking it reveals the form and focuses the textarea:
  `<label>` `applications.form.label`, a `<textarea>` (`maxLength={500}`, 5 rows, `aria-describedby` = hint +
  counter + error ids), hint `applications.form.hint`, counter `listings.fields.charsLeft` (`{{count}}` = 500 −
  length, `aria-live="polite"` only when ≤ 50 left), buttons `applications.form.submit` (primary) and
  `applications.form.cancel` (closes the form, clears it, returns focus to `applications.apply`).
- validation: a message that is empty after trim → `listings.errors.required` in a `role="alert"` under the
  textarea, `aria-invalid="true"`, focus on the textarea, no request.
- submitting: submit disabled + `aria-busy`, a same-tick guard (ref) so a double click sends one request.
- success: the form is replaced by the applied state, with `<p role="status">` `applications.sent` above it; the
  count line shows the new count with no refetch of the listing.
- errors (`msg` of a 422 is never rendered): 409 `already_applied` → refetch `GET /me/applications`, then the
  applied state; 429 → `applications.errors.rateLimited` (`role="alert"`), the text kept; 404 → the form
  removed and `applications.errors.unavailable` (`role="alert"`); 422 with any item at `loc` `["body",
  "message"]` → `listings.errors.invalid` on the textarea (as a client error, focus on it); 401 → `clearSession`, then navigate to
  `/login?next=…` (as the visitor link); 403 or any other 4xx, 5xx, network → `common.error` with
  `common.retry`, which re-sends the identical body.

**`/me/applications` (`MyApplicationsPage`)**, behind `RequireSeeker`; `max-w-[480px]` column as `MyListingsPage`:
- `<h1>` `applications.mine.title`.
- loading: three `Skeleton` rows in a `<ul aria-busy>` (as `MyListingsPage`).
- error: `ErrorState` with retry.
- empty: `EmptyState` `applications.mine.empty` and below it a link `applications.mine.search` → `/search`.
- success: a `<ul>` of cards, in API order. Each `<li><article>`: an `<h2>` (with an id) holding a link to
  `/listings/{listing.id}` whose text is `listings.card.title` (`rooms` via `formatRooms`, `street`, `city`);
  the price `formatIls(price_ils)` `listings.units.ils` `listings.units.perMonth`; `ApplicationStatusChip`;
  `applications.applied` with the date; `applications.declinedHint` when declined; the message under a small
  label `applications.yourMessage` (`whitespace-pre-line break-words`, plain text). For `submitted` /
  `shortlisted`: a button `applications.withdraw` (`aria-describedby` = the card's `<h2>` id), disabled +
  `aria-busy` while pending; on 200 the chip reads `applications.status.withdrawn` and the button is gone; on
  409 / 404 the list is refetched and `common.error` shows in the card (`role="alert"`); 401 → `clearSession`
  (`RequireSeeker` then redirects to `/login`); 403 or any other 4xx (incl. 422), 5xx, network → `common.error` in
  the card. A 401 on the list query → `clearSession` too. No confirmation (re-apply undoes it, `0004a` Q2).

**Header**: a seeker sees `header.myApplications` where an owner sees `header.myListings`.

**RTL**: the count line, prompt and applied text are `text-start`; the two form buttons and the two login links
sit in a `flex` row in inline order (primary first, at the inline start); the status chip follows the applied
date in inline order; the textarea is full width. No physical properties.

**a11y**: the section has a heading; the disclosure button exposes `aria-expanded`; errors are `role="alert"` and
referenced by `aria-describedby`; the sent line is `role="status"`; focus moves to the textarea on open, back to
the button on cancel, to the textarea on an error; the withdraw button's accessible description names the listing.

**i18n keys added to `he.json`** (placeholder copy; Slice 9 owns final wording; `listings.errors.required`,
`listings.errors.invalid`, `listings.fields.charsLeft`, `common.*`, `header.login`, `header.signup` are reused):
| key | value |
| --- | --- |
| `applications.heading` | `הגשת מועמדות` |
| `applications.count.zero` | `עוד אין מועמדים. אפשר להיות הראשונים` |
| `applications.count.one` | `מועמד/ת אחד/ת הגיש/ה מועמדות` |
| `applications.count.many` | `{{count}} מועמדים הגישו מועמדות` |
| `applications.apply` | `הגש/י מועמדות` |
| `applications.loginPrompt` | `כדי להגיש מועמדות צריך להתחבר` |
| `applications.form.label` | `הודעה לבעלי הדירה` |
| `applications.form.hint` | `כמה מילים עליך: מי יגור בדירה ומתי תרצו להיכנס` |
| `applications.form.submit` | `שליחת המועמדות` |
| `applications.form.cancel` | `ביטול` |
| `applications.sent` | `המועמדות נשלחה` |
| `applications.applied` | `הגשת מועמדות ב־{{date}}` |
| `applications.viewMine` | `למועמדויות שלי` |
| `applications.yourMessage` | `ההודעה שלך` |
| `applications.status.submitted` | `נשלחה` |
| `applications.status.shortlisted` | `ברשימה הקצרה` |
| `applications.status.declined` | `לא נבחרה` |
| `applications.status.withdrawn` | `בוטלה` |
| `applications.declinedHint` | `בעלי הדירה בחרו להתקדם עם מועמדים אחרים` |
| `applications.withdraw` | `ביטול המועמדות` |
| `applications.mine.title` | `המועמדויות שלי` |
| `applications.mine.empty` | `עוד לא הגשת מועמדות לאף דירה` |
| `applications.mine.search` | `לחיפוש דירות` |
| `applications.errors.rateLimited` | `הגשת הרבה מועמדויות בזמן קצר. אפשר לנסות שוב מאוחר יותר` |
| `applications.errors.unavailable` | `המודעה כבר לא מקבלת מועמדויות` |
| `header.myApplications` | `המועמדויות שלי` |

## Acceptance criteria
Unit tests use the existing harness (`mockApi`, `renderRoutes`, `testQueryClient()` with `retry: false`,
`deferred()`); fixtures `listingDetail()`, `application()`, `owner`, `seeker`. "No request" means the `mockApi`
call log has no such route. Non-ASCII test inputs are written as `\uXXXX` escapes in the tests (and here).
- [ ] AC1 Given `GET /listings/A` returns `applicant_count` 0, 1 and 12 (three renders), Then the section shows `applications.count.zero`, `applications.count.one`, and `applications.count.many` with `12`, for a visitor, an owner and a seeker alike — `web/src/features/applications/__tests__/ApplySection.test.tsx::ac1_applicant_count`
- [ ] AC2 Given `/me` is 401, and again Given `/me` fails with a network error, Then `applications.loginPrompt`, a link `header.login` with `href` `/login?next=%2Flistings%2FA` and a link `header.signup` with `href` `/signup?role=seeker&next=%2Flistings%2FA`, no `applications.apply` button, and no `GET /me/applications` request; Given `/me` is an owner, Then neither the prompt nor the button nor the form, and no `GET /me/applications` — `ApplySection.test.tsx::ac2_visitor_prompt_owner_hidden`
- [ ] AC3 Given a seeker with `GET /me/applications` → `[]`, When `applications.apply` is clicked, Then `aria-expanded="true"`, the textarea is focused and `listings.fields.charsLeft` reads 500; When submit is clicked with `"   "`, Then `listings.errors.required` (`role="alert"`, in the textarea's `aria-describedby`), `aria-invalid="true"`, focus on the textarea, no `POST`; When `"  Hi, we are a quiet couple  "` is typed and submit is double-clicked with the POST `deferred()`, Then exactly one `POST /listings/A/applications` with body exactly `{"message": "Hi, we are a quiet couple"}` and `credentials: 'include'`, submit disabled with `aria-busy`; on 201 Then `role="status"` `applications.sent`, `applications.applied` with `applications.status.submitted`, a link to `/me/applications`, the count line moves 0 → 1, and `GET /listings/A` was requested exactly once in the whole test; in a separate render (fresh `[]`), When the form is opened, `x` typed and cancel clicked, Then no textarea, `aria-expanded="false"` and focus on `applications.apply`, and When it is reopened, Then the textarea is empty — `ApplySection.test.tsx::ac3_seeker_applies`
- [ ] AC4 Given the form with a message, When the POST answers 409 `{"detail":"already_applied"}` (and the next `GET /me/applications` returns a submitted application to A), Then the applied state; 429 → `applications.errors.rateLimited` with the text kept; 404 → `applications.errors.unavailable` and no form; 422 `{"detail":[{"loc":["body","message"],"type":"value_error","msg":"message contains control or invisible characters"}]}` → `listings.errors.invalid` on the textarea with focus there, and the English `msg` is nowhere in the document; 401 → the location is `/login?next=%2Flistings%2FA` and the login form (`<h1>` `auth.login.title`) is rendered there, not a redirect back (the `['me']` cache was cleared); 403 → `common.error`; network error → `common.error` + `common.retry`, and retry sends a body identical to the first — `ApplySection.test.tsx::ac4_apply_errors`
- [ ] AC5 Given a seeker whose `GET /me/applications` contains an application to A with status `submitted`, then `shortlisted`, then `declined` (three renders), Then `applications.applied` with the matching `applications.status.*` chip, `applications.declinedHint` only for declined, a link `applications.viewMine`, and no `applications.apply`; Given status `withdrawn`, Then `applications.apply` is shown, and sending re-uses the AC3 flow (201 → applied state); Given `GET /me/applications` pending, Then a skeleton with `aria-busy` in the section and the count line visible; Given it fails, Then an `ErrorState` whose retry refetches it; Given it answers 401, Then `applications.loginPrompt` — `ApplySection.test.tsx::ac5_existing_application_states`
- [ ] AC6 Given `/me` resolves to a seeker, When `/me/applications` is opened, Then `<h1>` `applications.mine.title`; Given `/me` is 401, Then redirect to `/login`; Given an owner, Then redirect to `/`; Given `/me` pending, Then a skeleton and no redirect; Given `/me` fails, Then `ErrorState` — `web/src/features/applications/__tests__/RequireSeeker.test.tsx::ac6_seeker_only_route`
- [ ] AC7 Given `GET /me/applications` pending → skeleton list with `aria-busy`; failing → `ErrorState`, retry refetches; `[]` → `applications.mine.empty` and a link to `/search`; Given three applications (submitted, declined, withdrawn) with a two-line message `"line one\nline two"`, Then three cards in API order, each `<h2>` a link to `/listings/{listing.id}` with the `listings.card.title` text, the price `formatIls(...)`, the chip, the date, the message rendered on two lines, `applications.declinedHint` only on the declined card, and an `applications.withdraw` button only on the submitted card whose `aria-describedby` names an element containing that card's title — `web/src/features/applications/__tests__/MyApplicationsPage.test.tsx::ac7_my_applications_states`
- [ ] AC8 Given the submitted card, When `applications.withdraw` is clicked with the POST `deferred()`, Then exactly one `POST /me/applications/{id}/withdraw`, the button disabled with `aria-busy`; on 200 (status `withdrawn`) the chip reads `applications.status.withdrawn`, and the button is gone; Given 409 `not_withdrawable`, Then `GET /me/applications` is requested again and `common.error` shows in that card; Given 401 (rendered under `RequireSeeker`), Then the location is `/login`; Given 403, Then `common.error` in the card; Given a network error, Then `common.error` — `MyApplicationsPage.test.tsx::ac8_withdraw`
- [ ] AC9 Given a seeker, Then the header has a link `header.myApplications` to `/me/applications` and no `header.myListings`; Given an owner, Then `header.myListings` and no `header.myApplications`; Given a visitor, Then neither — `web/src/features/auth/__tests__/AuthMenu.test.tsx::ac9_my_applications_link`
- [ ] AC10 `safeNext` table: `'/listings/abc'`, `'/me/applications?x=1'` and `'/%2F%2Fevil.example'` (a double-encoded value stays a same-origin path) → unchanged; `null`, `''`, `'listings/abc'`, `'//evil.example'`, `'/\\evil.example'`, `'/\t/evil.example'`, `'/\n/evil.example'`, `'/ x'`, `'https://evil.example'`, `'javascript:alert(1)'`, `'/a\\b'` → `'/'` — `web/src/features/auth/__tests__/next.test.ts::ac10_safe_next`; and Given `/login?next=%2Flistings%2FA`, When the code is verified (200), Then the location is `/listings/A`; Given `/login?next=%2F%2Fevil.example`, Then `/`; Given a logged-in person opens `/login?next=%2Flistings%2FA`, Then they are redirected to `/listings/A` — `web/src/features/auth/__tests__/LoginPage.test.tsx::ac10_login_returns_to_next`; and Given `/signup?role=seeker&next=%2Flistings%2FA`, Then the seeker role is preselected and after verify (201) the location is `/listings/A`; Given `next=%2F%2Fevil.example`, Then `/` — `web/src/features/auth/__tests__/SignupPage.test.tsx::ac10_signup_returns_to_next`
- [ ] AC11 Given `make dev` is up, When Playwright signs up an owner (`signUp(page, 'owner')`) and posts a listing (`postListing`), clears cookies, opens the listing, Then inside `section = page.getByRole('region', { name: he.applications.heading })` (every section assertion below is scoped to it, since the logged-out header has its own `header.login` / `header.signup` links) it shows `applications.count.zero` and a `header.login` link; When it signs up a seeker with `signUp(page, 'seeker', { start: <the section's `header.signup` link href>, expectUrl: '/listings/<id>' })`, Then it lands back on the listing; When it clicks `applications.apply`, types `Hi, we are a quiet couple` and submits, Then `applications.sent`, `applications.status.submitted` and `applications.count.one` are visible; When it opens `header.myApplications`, Then one card with the listing's street and `applications.status.submitted`; When it clicks `applications.withdraw`, Then `applications.status.withdrawn`; and `GET /me/applications` via `page.request` returns one item with `status` `"withdrawn"` — `web/e2e/applications.spec.ts::ac11_seeker_applies_and_withdraws`
- [ ] NF1 `make lint`, `make test`, `make i18n-check` clean; existing web tests pass, with only the `ListingPage.test.tsx` fixture / `GET /me` mock change named in Scope; no file under `api/` changes — CI `web` job, code reviewer
- [ ] NF2 The message is rendered as text only (React children; no `dangerouslySetInnerHTML` anywhere in `features/applications/`), and the only user-controlled navigation target in this spec goes through `safeNext` — security reviewer (AC10 proves the rule)

## Tests to write
Unit (vitest + Testing Library, the auth harness): AC1–AC5 in `ApplySection.test.tsx` (rendered through
`ListingPage` at `/listings/A` with `renderRoutes`, so the real page wires the section), AC6 in
`RequireSeeker.test.tsx`, AC7–AC8 in `MyApplicationsPage.test.tsx`, AC9 in `AuthMenu.test.tsx`, AC10 in
`next.test.ts`, `LoginPage.test.tsx` and `SignupPage.test.tsx`. E2E (Playwright against `make dev`): AC11. This
adds one owner and one seeker signup to the e2e suite (6 in all); the `make e2e` `rl:*` clear (Scope) resets the
API's 10 OTP requests / IP / 15 min budget before every run, so local reruns do not hit it.

## Risks / open questions
**Decisions inherited from `0004a` (built on its recommendations):** Q2 (re-apply after withdraw only: the apply
button returns on a withdrawn application), Q3 (no owner identity on the seeker's side), Q4 (500 characters:
the textarea's `maxLength`), Q5 (a decline shows `לא נבחרה` with the soft hint). If Gilad picks Q5 (b) or (c),
only the `declined` rendering changes (copy, or the API masks it).

**Assumptions (orchestrator):** the apply section is in the page flow, not a sticky bar; signup from the prompt
preselects the seeker role (`?role=seeker`, already supported by `SignupPage`); withdrawing needs no
confirmation; the applicant count is shown to owners and visitors too (the page is public).

**Technical risks the verifier should challenge:**
- **`next` handling** is the first user-controlled navigation target in the app (FOLLOWUPS `0001b` security major
  1). `safeNext` rejects scheme-relative (`//`, `/\`), absolute and whitespace-smuggled (`/\t/`) targets; AC10
  pins the table. `navigate(next)` only ever receives its output.
- **Count drift:** the count is updated in the cache (+1) instead of refetched, so a count changed by others since
  the page loaded stays until the next visit. Accepted (it avoids counting an extra view).
- **`useMe` on a public page:** `ListingPage` now reads `/me` (already cached by the header, `staleTime` 60 s), so
  no extra request in practice; the visitor path must not wait on it — the count line renders regardless.
- Web-only spec: per Speed rule 2 it does not build at the same time as another web spec (Vite port 5173);
  `0004d` follows it. This branch starts from `0004a`'s branch and rebases after it merges.

## Verifier findings — one round, 8 findings, all applied
1. A 401 from any seeker call first runs `clearSession` (exported from `useLogout.ts`), so `LoginPage` does not bounce back to `next`; AC4 asserts the login form renders, AC5 adds the list-401 prompt, AC8 adds withdraw 401 → `/login` (Scope, UI, AC4, AC5, AC8).
2. Withdraw error mapping complete: 401 → `clearSession` + redirect, 403 / other 4xx / 5xx / network → `common.error` in the card (UI).
3. AC11 scopes every section assertion and the signup `href` to `getByRole('region', { name: he.applications.heading })` (AC11).
4. `make e2e` clears the compose Redis `rl:*` keys before `playwright test`, also serving `0004d`; FOLLOWUPS `0001b` e2e entry points at it (Scope, Tests to write).
5. `useWithdraw`'s listing invalidation dropped from Scope and AC8 (no-op with `staleTime` 0).
6. AC3's cancel case is its own render: open, type, cancel, focus back on the button, reopen empty (AC3).
7. `SignupPage.test.tsx::ac10_signup_returns_to_next` added (role preselected, `next` honoured, unsafe `next` → `/`) (Scope, AC10).
8. `safeNext` table pins `'/%2F%2Fevil.example'` → unchanged and `'/\n/evil.example'` → `'/'` (AC10).

## Digest (filled by orchestrator after verification)

    Spec 0004b - Apply web: apply on the listing page, my applications, login return path   (verified, part 2 of 4, web, depends on 0004a)
    What a user can do after this: everyone sees the exact applicant count on a listing; a visitor is asked to log in and
             lands back on the listing; a seeker writes a message and applies, sees their status, and follows or
             withdraws their applications on /me/applications.
    Decisions I need from you: none new; it follows 0004a's Q2 (apply button returns after a withdrawal), Q3 (no owner
             identity), Q4 (500 characters) and Q5 (a decline reads "not selected" with a soft hint) [all on the rec].
    Also in this spec: safeNext() closes the 0001b open-redirect follow-up; `make e2e` clears rate-limit keys first, so
             local e2e reruns no longer hit the OTP limit.
    Risks: the first user-controlled redirect in the app — mitigation: safeNext table in AC10, security reviewer.
    Reviewers: code, qa, ux, security   Estimated: 1 coder run, 1 review round
    Links: specs/0004b-apply-web.md · design/screens-v1/Listing.dc.html · FOLLOWUPS 0001b
