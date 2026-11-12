---
id: 0009m
title: Login and signup, with the OTP steps and the role choice, are one centred card under the homie logo and the hello turtle, in the brand kit's colours, type and voice and CreateListing's field anatomy, on a phone and on a desktop, built from the 0009d kit and tokens, with every behaviour unchanged
status: in-progress
depends_on: [0009h]   # 0009h (which depends on 0009d): the kit (Button, Card, Field + TextInput, PageContainer, PageHeader, and the brand amendment's Logo and Mascot), the brand token scale, the restyled ChoiceGroup / ErrorState, the full-width shell and the page roots. 0009d's planner asks every screen spec to depend on 0009h, because 0009h rewrites every page root and colour class. The profile half of this screen pair is 0009r; the two share only he.json
reviewers: [code, qa, ux, security]   # security: OtpForm (the email-code flow) is rewritten onto the kit, and the new cross-links build a URL from the user-controlled `?next` (FOLLOWUPS line 19's rule). The review is short: the cross-link's `next` handling, and the OTP calls, state and handlers being unchanged. ux: a restyled screen with no artboard of its own, judged against CreateListing / Main; qa: OTP steps, errors, focus and redirects at 390 / 1440
estimate: 1 coder run   # coder Opus/high (~2.5 h): OtpForm holds the OTP flow, whose behaviour must not change (Speed rule 6, "the coder on auth"); 3 source files, 3 test files, the screenshot harness if 0009l / 0009k have not added it
---

## Goal
After this ships, `/login` and `/signup` are one centred column (`narrow`, 480 px) at every width.
- On top, centred: the brand kit's hello turtle (`Mascot pose="hello"`, the kit's welcome and sign-up pose) and
  the homie wordmark (`Logo`).
- Below them, a white bordered card holding:
  - the page `<h1>` with a one-line subtitle;
  - the OTP form, with CreateListing's fields, segmented role choice and the 52 px primary button (`ink`, as the
    brand kit draws primary buttons).
- Under the card, a line links login and signup to each other.
- The role choice is the shared `ChoiceGroup`, and `RoleChoice.tsx` is deleted (FOLLOWUPS line 31).
- These stay unchanged:
  - validation and the OTP rate-limit handling;
  - the 30 s resend cooldown and the focus moves;
  - the `?next` / `?role` handling (`features/auth/next.ts`).

This serves Dev Plan slice 9 → **Slice 9b, the UI pass** (Gilad, 2026-11-12: "the app does not look good, layouts
do not fill the screen"). These screens have no artboard (Gilad, 2026-11-12: no new artboards):
- the anatomy (fields, the segmented choice, the primary button, what goes where) comes from
  `CreateListing.dc.html`;
- colour, type, shape, voice and the name come from the brand kit `design/brand/` (README.md, tokens.json), which
  wins over the artboards (`specs/0009-brand-amendment.md`, orchestrator, 2026-11-12).

The seeker profile, planned in the same session, is `0009r`.

## Scope
**In:**
- `web/src/features/auth/LoginPage.tsx`, `SignupPage.tsx`: the card layout under UI, and the cross-link line
  (new keys).
- `web/src/features/auth/OtpForm.tsx`:
  - the local class constants (`label`, `input`, `fieldError`, `primary`, `secondary`) are replaced by `Field` /
    `TextInput` / `Button` / `ChoiceGroup`;
  - `RoleChoice` is replaced by `ChoiceGroup`, and the reveal's focus moves to a `querySelector` (UI, "Role
    choice");
  - no state, effect, request or handler changes.
- `web/src/features/auth/RoleChoice.tsx`: deleted (FOLLOWUPS line 31).
- `web/src/locales/he.json`:
  - the six new `auth.*` keys under UI;
  - one reworded key, `auth.errors.invalidCode`, which takes the brand kit's own error example (UI, "Voice");
  - every other existing key keeps its wording (`0009b` owns it).
- Tests: the new cases under "Tests to write". Existing assertions stay as they are.
- `web/e2e/auth.spec.ts`: one new test, with no sign-up.
- Screenshots (AC7), in `0009l`'s harness:
  - the harness is `make screens`, `web/playwright.screens.config.ts`, `web/e2e/screens/*.screens.ts`, and PNGs in
    the gitignored `web/screens/<spec>/`;
  - this spec's files are `web/e2e/screens/auth.screens.ts` and `web/e2e/screens/fixtures-auth.ts`;
  - if the harness is not on the base, add it exactly as `0009l`'s Scope item 9 words it.
- `specs/FOLLOWUPS.md` at build time:
  - tick line 31;
  - tick line 21's `OtpForm` / `RoleChoice` part once AC6's hex grep is empty;
  - tick line 21's `AuthMenu.tsx:55` part only if `AuthMenu.tsx` is also clean on the branch, because it is
    `0009a`'s / `0009h`'s.

**Out:**
- `/me/profile`: `0009r`.
- `AuthMenu.tsx` and the header (`0009a`). The page widths and the hex swap (`0009h`).
- Work other specs own in `OtpForm` / `LoginPage` / `SignupPage`. The layout below leaves room for each:
  - the disabled-submit hint and its `aria-describedby` (FOLLOWUPS 24) and the "too many" wait from
    `Retry-After`: `0009f`;
  - the always-mounted resend status line (FOLLOWUPS 23): `0009t`;
  - `usePageTitle` on both pages: `0009c`;
  - the skeleton while `/me` is pending (FOLLOWUPS 25) and the drafts cleared on login: `0009g`;
  - the plural `auth.resendIn` call (`OtpForm.tsx:397`): `0009b`.
- Any copy change to existing keys, any API change.

**New dependencies:** none.

### Kit contract this spec relies on (0009d's draft API), and the fallback for each
The coder reads the merged or open `0009d` / `0009h` first. Where an API differs, adapt the call, not the kit.

| Need | Use | Fallback if the kit does not offer it |
| --- | --- | --- |
| Label / error wiring with the caller's control id | `Field` with `id` (the context id wins over the control's own), `label`, `error` (one `role="alert"`). Without an error there is no `aria-invalid` attribute at all; today's inputs render `"false"`, which no auth test asserts. The control's own `aria-describedby` is merged after the context's ids. | Keep today's local label / error markup, token-styled |
| The 52 px code box | `TextInput size="lg"` | — |
| `<h1>` and subtitle | `PageHeader` `title`, `subtitle` | A page-local `<h1>` + `<p>` styled as `PageHeader`'s |
| The wordmark | `Logo variant="wordmark" tone="dark"` (the brand amendment's kit addition), decorative here: the header's brand link already names the product | — |
| The turtle | `Mascot pose="hello"`, decorative, at least 96 px wide | — |
| The reveal's quiet box | `Card variant="muted" padding="md"` (`surface-subtle`, no border) | — |
| Primary button | `Button variant="primary"`, which the amended kit draws as `ink` with `on-ink` text | — |
| Inputs and segments | `TextInput` / `ChoiceGroup` with `border-strong` borders and `rounded-md`, as the amended kit draws them | — |
| Full-width submit | `Button`'s full-width prop, `fullWidth` or `block`, as merged | — |

The digest names every fallback used. A fallback is the existing local markup, token-styled. It is not a new
component.

## Data
None.

## API
None. The pages call the same endpoints as today, unchanged: `GET /me`, `POST /auth/otp/request` and
`POST /auth/otp/verify`.

## UI

### Desktop decision: centred, not a side panel
- The task is one short flow, with two steps and at most four fields. A side panel adds a second focal point
  next to the only action, and moves the eye across the screen.
- A panel would need its own pitch, copy and imagery.
  - The pitch is the landing's (`0009a`), one click before signup.
  - `0009a`'s Q2 requires every claim to stay true, and two pitches are two places to keep true.
- One layout serves every width:
  - the DOM is the same at 390 and 1440 px, so the screenshot states do not double in kind;
  - login's "no account yet" reveal grows the card downward, with no two columns to rebalance.
- No artboard has a split auth screen. The brand kit's welcome pattern (the hello turtle and the wordmark above
  the task) sits naturally above one centred card. It also matches `0009h`'s `narrow` (480 px) width for forms.

### Layout (both pages, every width)
- The page root: `PageContainer width="narrow" as="section" className="flex flex-col gap-4 lg:pt-10"`. The
  gutters are the container's: 16 px on a phone.
- In it:
  1. the brand head: `<div data-testid="auth-brand" className="flex flex-col items-center gap-3">`, holding:
     - `Mascot pose="hello"`, 96 px wide below `lg` and 112 px from `lg` (`w-24 lg:w-28`, through the kit's size
       prop or `className`, as merged). It stands on `surface`, never on `accent`, and is not flipped. It is the
       screen's only turtle;
     - `Logo variant="wordmark" tone="dark"`, at the kit's default size, with its clear space;
     - both are decorative (`aria-hidden` / empty `alt`, as the kit renders a decorative image), so the `<h1>` is
       the page's first named content;
  2. a `Card padding="lg"` (the kit's default `rounded-lg` and `border`, no shadow) with
     `data-testid="auth-card"` and `className="flex flex-col gap-6"`, holding:
     - a `PageHeader` with `title` `auth.login.title` / `auth.signup.title` (the kit's `font-display` `h1`) and
       `subtitle` `auth.login.subtitle` / `auth.signup.subtitle`;
     - `OtpForm`, unchanged in props;
  3. below the card, `<p className="text-center text-body text-ink-muted">`:
     - login: `auth.login.noAccount`, a space, and a `Link` `auth.login.toSignup` to `/signup`;
     - signup: `auth.signup.haveAccount` and a `Link` `auth.signup.toLogin` to `/login`;
     - when the page's `next` (`safeNext(params.get('next'))`, already computed today) is not `'/'`, the link
       appends `?next=${encodeURIComponent(next)}`. Only `safeNext`'s output is ever used. `?role` is not
       carried;
     - the link is `inline-flex min-h-11 items-center px-1 font-medium text-accent underline underline-offset-4
       hover:text-accent-strong`, plus `focusRing`. It is a link, so its label keeps the "ל־" form ("להרשמה");
       the brand's action-noun rule is for buttons;
     - accent text sits only on `surface`, as the brand kit requires.
- 390 px: the turtle and the wordmark, then the card at the container's full width (358 px), then the link line.
- ≥ 1024 px: the same column, 480 px wide, centred, 40 px further from the header.
- The screen has no accent-filled element: the primary button is `ink`, and accent appears only as the link text,
  the selected segment and the focus ring.

### Anatomy (artboard / brand kit → implementation)
The artboard column gives structure only. Colour, type and shape come from the brand kit.

| Element | Source | Implementation |
| --- | --- | --- |
| Turtle + wordmark | brand kit: `homie-turtle-hello.svg` ("welcome and sign-up screens"), `homie-wordmark-he.svg` (black on `surface`) | `Mascot pose="hello"`, `Logo variant="wordmark" tone="dark"` |
| Card | brand kit: cards `radius-lg` (16 px) on `surface`, separated by `border`, no shadow | `Card padding="lg"` |
| `<h1>` + line | CreateListing's `<h1>` and its muted line; brand kit: Fredoka 600 `h1`, Rubik for the rest | `PageHeader` (`font-display` `h1`; the subtitle in `ink-muted`) |
| Role choice | CreateListing's segments: 44 px, equal widths; brand kit: `border-strong`, `radius-md`, accent for the selected state | `ChoiceGroup` as the amended kit draws it (no check mark: a single-select segment stays as the artboard draws it) |
| Fields | CreateListing: label above, 48 px box, focus ring, 6 px gaps; brand kit: `border-strong`, `radius-md`, accent focus ring | `Field` + `TextInput` |
| Field gaps | CreateListing's 22 px, on the brand's spacing scale | the form's `gap-6` (24 px) |
| Primary | CreateListing's footer primary: 52 px; brand kit: `ink` with `on-ink`, `radius-md` | `Button variant="primary" size="lg"`, full width, `type="submit"` |
| Small actions | CreateListing's text button "שמירה כטיוטה" | `Button variant="ghost" size="sm"` |

### `OtpForm` step 1 ("request")
The same elements as today, in the same order and under the same conditions. The form is `flex flex-col
gap-6`:
1. signup only: a `ChoiceGroup` with:
   - `legend` `auth.role.label` and `name="role"`;
   - the options owner, then seeker (`auth.role.owner`, `auth.role.seeker`);
   - `value={role}` and `onChange={setRole}`;
2. signup only: `Field id={`${id}-name`} label={t('auth.name.label')}`, with `error` `auth.errors.nameLength`
   when `nameError`. Inside it, `TextInput` with `ref={nameRef}`, `type="text"`, `autoComplete="nickname"`,
   `value` and today's `onChange`;
3. `Field id={`${id}-email`} label={t('auth.email.label')}`, with `error` `auth.errors.invalidEmail` when
   `emailError`. Inside it, `TextInput` with `ref={emailRef}`, `type="email"`, `dir="ltr"`,
   `autoComplete="email"`, `value` and today's `onChange`;
4. the request errors:
   - `step1Error === 'tooMany'`: `<p role="alert" className="text-sm font-semibold text-danger">` with the
     too-many text (today's `auth.errors.tooMany`, or `0009f`'s wait text if that is on the branch);
   - `'failed'`: `ErrorState onRetry={sendRequest}`;
5. the submit: `Button` primary `lg`, full width, `type="submit"`, with `disabled` and `aria-busy` exactly as
   today, and the text `auth.sendCode`.
   - `0009f`'s disabled-submit hint sits directly under this button, inside the form.
   - Nothing else goes between the button and the form's end.

### `OtpForm` step 2 ("verify")
In this order:
1. `<p className="text-body text-ink-muted">` with `auth.code.sentTo`, the email in first-strong isolates as today;
2. `Field id={`${id}-code`} label={t('auth.code.label')}`. Inside it, `TextInput size="lg"` with:
   - `ref={codeRef}`, `type="text"`, `inputMode="numeric"`, `autoComplete="one-time-code"`, `dir="ltr"`,
     `maxLength={6}`;
   - the same `onPaste` and `onChange` as today;
   - `size="lg"` replaces today's `tracking-[0.3em]`, which is dropped.

   The errors:
   - `invalidCode`: `auth.errors.invalidCode` is the `Field`'s `error`. The input is `aria-invalid="true"` and
     described by it, as today.
   - `tooMany` / `failed`: the message (the too-many text / `common.error`) is **not** the `Field`'s error.
     - It is a `<p id={`${id}-code-error`} role="alert" className="text-sm font-semibold text-danger">` right
       after the `Field`.
     - The `TextInput` gets `aria-describedby={`${id}-code-error`}`, which the kit merges after the context's
       ids.
     - So the input is described by the message but not marked invalid, as today.
3. while `profileNeeded`: a `Card variant="muted" padding="md" className="flex flex-col gap-6"` (`surface-subtle`),
   holding:
   - `<p className="text-body">` with `auth.noAccountYet`;
   - the role `ChoiceGroup`, as in step 1;
   - the name `Field`, as in step 1;
4. the submit: `Button` primary `lg`, full width, `type="submit"`, with `disabled` / `aria-busy` as today and the
   text `auth.verify`. `0009f`'s hint sits directly under it;
5. `<div className="flex flex-wrap items-center justify-between gap-2">`, holding:
   - at the inline start, "שליחה חוזרת" (`auth.resend` / `auth.resendIn`, disabled while cooling, as today) as
     `Button variant="ghost" size="sm"`;
   - at the inline end, "החלפת אימייל" (`auth.changeEmail`) as `Button variant="ghost" size="sm"`.

   `0009t`'s sr-only status line goes anywhere inside the form.

### Role choice (FOLLOWUPS line 31)
- `RoleChoice` and its `firstRadioRef` prop go.
- The reveal's effect `if (profileNeeded) firstRadioRef.current?.focus()` becomes
  `formRef.current?.querySelector<HTMLInputElement>('input[name="role"]')?.focus()`.
  - `formRef` is a new ref on the step-2 `<form>`.
  - The first `role` radio in the DOM is the owner's.
- Pending states keep the native `disabled` attribute, not the kit's `busy`. The tests assert `toBeDisabled()`,
  and the same-tick guards stay as they are.

### States (unchanged in behaviour, restyled)
| Page | States |
| --- | --- |
| `/login` step 1 | empty; invalid email (field error); too many (alert); network failure (`ErrorState`); pending (button disabled + busy) |
| `/login` step 2 | code sent (cooldown counting); invalid code; resend too many; network failure; the "no account yet" reveal (role + name; verify disabled until a role is chosen); pending |
| `/signup` step 1 | empty or `?role=` preselected; name error; invalid email; too many; network failure; pending |
| `/signup` step 2 | as login's step 2, without the reveal |

- Loading: today the form shows while `/me` is pending. `0009g` renders a skeleton there instead, and it goes
  inside the card in place of `OtpForm`.
- Success navigates away (`next`), as today. There is no list, so there is no empty state.

### i18n keys added (`web/src/locales/he.json`)
| Key | Hebrew |
| --- | --- |
| `auth.login.subtitle` | "בלי סיסמה: קוד חד־פעמי מגיע לאימייל, ואיתו נכנסים." |
| `auth.signup.subtitle` | "נרשמים בחינם, בלי סיסמה: שלושה פרטים וקוד חד־פעמי לאימייל." |
| `auth.login.noAccount` | "עוד אין חשבון?" |
| `auth.login.toSignup` | "להרשמה" |
| `auth.signup.haveAccount` | "כבר רשומים?" |
| `auth.signup.toLogin` | "לכניסה" |

Reworded (orchestrator's brand amendment, 2026-11-12):

| Key | Today | After |
| --- | --- | --- |
| `auth.errors.invalidCode` | "הקוד שגוי או שפג תוקפו" | "הקוד לא נכון. אפשר לנסות שוב." |

None is count-dependent. The claims are true today:
- the service is free (PRODUCT.md "Pricing");
- login is an emailed code with no password (PRODUCT.md "OTP").

See Risks for when the email part stops being true.

### Voice (brand kit, `specs/0009-brand-amendment.md`)
- The new copy addresses no one in a single gender and has no slash forms. It uses the plural ("נרשמים",
  "רשומים") or a noun ("עוד אין חשבון?").
- An error says what happened, then what to do, in one sentence. `auth.errors.invalidCode` takes the brand kit's
  own example.
- The other existing auth strings that break the voice are `0009b`'s sweep, under the same amendment:
  - the slash form "אני מחפש/ת" (`auth.role.seeker`);
  - the single-gender address "איך לקרוא לך?" (`auth.name.label`);
  - the other `auth.errors.*`.
- No casual word and no turtle joke on these screens.

### RTL
- Logical classes only (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`, `text-start`).
- The resend button is at the inline start, and "change email" at the inline end.
- The email and code inputs keep `dir="ltr"`. The cross-link line is centred.

### Arbitrary values
None. No `[…]` class value and no hex literal in the in-scope files.

## Acceptance criteria
- [ ] AC1 Given `/login`:
  - `[data-testid="auth-brand"]` comes before the card. It holds the hello `Mascot` and the `Logo` wordmark, both
    hidden from the accessibility tree, and the page has exactly one `Mascot`;
  - `[data-testid="auth-card"]` holds the `<h1>` `auth.login.title`, the subtitle `auth.login.subtitle` and the
    email field;
  - after the card come the text `auth.login.noAccount` and a link `auth.login.toSignup` with `href="/signup"`;
  - with `?next=%2Fme%2Flikes` the link is `/signup?next=%2Fme%2Flikes`, and with `?next=%2F%2Fevil.example` it
    is `/signup`.

  Given `/signup`, the same holds with `auth.signup.*`: the link `auth.signup.toLogin` goes to `/login`, with the
  same `next` cases. — `web/src/features/auth/__tests__/LoginPage.test.tsx::ac1_login_card_and_cross_link`,
  `web/src/features/auth/__tests__/SignupPage.test.tsx::ac1_signup_card_and_cross_link`
- [ ] AC2 On `/signup`:
  - the group named `auth.role.label` holds two radios, `auth.role.owner` then `auth.role.seeker` in DOM order,
    both with `name="role"`;
  - `?role=seeker` checks the seeker radio;
  - no source file imports `RoleChoice`, and `web/src/features/auth/RoleChoice.tsx` does not exist.

  On `/login`, the "no account yet" reveal still focuses the owner radio: `LoginPage.test.tsx::ac6_…` stays green
  and unedited. — `SignupPage.test.tsx::ac2_role_is_choice_group`
- [ ] AC3 Step 2's error semantics are unchanged:
  - a verify answering 401: the code input has `aria-invalid="true"`, and is described by the `role="alert"`
    text `auth.errors.invalidCode`;
  - a resend answering 429: the alert shows the too-many text, and the code input is not `aria-invalid="true"`
    but is described by that alert;
  - a verify that throws (network): the alert `common.error`, with the same semantics as the 429.

  Throughout, the submit buttons carry the `disabled` attribute while not ready or pending. —
  `web/src/features/auth/__tests__/OtpForm.test.tsx::ac3_step2_error_semantics`
- [ ] AC4 Every existing test in `web/src/features/auth/__tests__/` passes with its assertions unedited by this
  spec. — `make test`. The digest says that no assertion was edited, or lists each edit and why it does not
  change what the assertion means.
- [ ] AC5 E2E, the auth layout, with no sign-up.
  - `POST {API}/auth/otp/request` is answered by `page.route`:
    - with 204 and the CORS headers `access-control-allow-origin: http://localhost:5173` and
      `access-control-allow-credentials: true`;
    - and an `OPTIONS` preflight with 204.
  - At 1440×900 on `/login`:
    - `[data-testid="auth-card"]` is at most 480 px wide;
    - it is centred: its left gap and its right gap to `document.documentElement.clientWidth` differ by ≤ 2 px;
    - the `auth.login.toSignup` link is below it.
  - Filling an email and sending reaches step 2: the code input is focused, and the `auth.verify` button is
    visible.
  - At 390×844 on `/signup`:
    - `document.documentElement.scrollWidth <= clientWidth`;
    - the card is 358 ± 1 px wide;
    - the `auth.sendCode` button is ≥ 52 px tall.

  — `web/e2e/auth.spec.ts::ac5_auth_layout_desktop_and_mobile`
- [ ] AC6 Tokens and kit, over `LoginPage.tsx`, `SignupPage.tsx` and `OtpForm.tsx`:
  - `grep -nE '#[0-9A-Fa-f]{3,8}\b'` prints nothing;
  - `grep -noE '[a-z0-9]-\[[^]]*\]'` (class tokens only) prints only attribute variants (`aria-[…]`, `has-[…]`,
    `data-[…]`), or nothing;
  - no file defines a button, input box, card or chip style of its own.

  The digest quotes both outputs.
- [ ] AC7 Visual check. Screenshots at 390×844 and 1440×900 of every state below, captured on the final local
  head and handed to the ux reviewer. The reviewer compares them with:
  - `CreateListing.dc.html` for the anatomy (fields, segments, the primary button);
  - the brand kit (`design/brand/README.md`, `tokens.json`) for colour, type, shape and voice: the `ink` primary,
    the `border-strong` inputs, no card shadow, one turtle, Fredoka only on the `<h1>`.

  The states:
  - a1 login, step 1;
  - a2 login, invalid email;
  - a3 login, "too many";
  - a4 login, step 2 with the cooldown counting;
  - a5 login, invalid code;
  - a6 login, the "no account yet" reveal with no role chosen;
  - a7 signup with `?role=owner`;
  - a8 signup, name error;
  - a9 signup, network failure (`ErrorState`);
  - a10 signup, step 2 after a resend answered 429.

  Capture:
  - `web/e2e/screens/auth.screens.ts` in `0009l`'s harness;
  - `page.screenshot({ fullPage: true, path: `screens/0009m/${state}-${project}.png` })`;
  - `page.route(`${API}/**`)` answers every API request (and its `OPTIONS` preflight) from
    `web/e2e/screens/fixtures-auth.ts`: an anonymous `/me` (401), and the OTP request / verify replies per state
    (204, 422, 429, a network abort; 401, 422 `profile_required`);
  - an unmatched request fails the run, so no sign-up and no OTP are spent.

  — `web/e2e/screens/auth.screens.ts`, the PNGs listed in the digest
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green on the final
  head (Speed rule 7). Check that port 5173 is free first. The e2e result and the screenshot folder go in the
  digest.

## Tests to write
- Component (vitest, `mockApi` / `vi.stubGlobal('fetch', …)` as today):
  - `LoginPage.test.tsx::ac1_login_card_and_cross_link`;
  - `SignupPage.test.tsx::ac1_signup_card_and_cross_link` and `::ac2_role_is_choice_group`;
  - `OtpForm.test.tsx::ac3_step2_error_semantics`.

  New Hebrew test strings come from `he.json` lookups, as the existing tests do.
- E2E: `auth.spec.ts::ac5_auth_layout_desktop_and_mobile` (a new test, with no sign-up and the OTP request
  routed). If `0009c`'s `web/e2e/a11y.ts` is on the branch, it also calls `expectNoAxeViolations` at step 1 and
  step 2.
- Screens: `web/e2e/screens/auth.screens.ts` (AC7). It is not part of `make e2e`.

## Risks / open questions
- **Merge order and shared lines.** All of these are web specs, so they build one at a time locally (Speed rule 2),
  and the second to merge rebases.
  - `0009f`: the hint under each submit, with the button's `aria-describedby`, and the too-many text with the
    wait. The layout leaves the slot directly under each submit.
  - `0009t`: the sr-only resend status line, anywhere in the form.
  - `0009b`: `auth.resendIn` becomes a plural call (`OtpForm.tsx:397`).
  - `0009c`: `usePageTitle` on both pages.
  - `0009g`: the skeleton inside the card, and `clearDraftsExcept` in `OtpForm`'s verify `onSuccess`.
  - `0009h`: the hex swap in `OtpForm` / `RoleChoice`. If `0009h` lands first, `RoleChoice`'s swapped classes go
    with the file.
- **Copy that ages.** `auth.login.subtitle` and `auth.signup.subtitle` promise a code "לאימייל".
  - PRODUCT.md "OTP" switches SMS on at launch readiness (Slice 12), and the subtitles then become false.
    "בלי סיסמה" stays true.
  - The build adds a FOLLOWUPS line for Slice 12: revisit the two subtitles when SMS is switched on.
- **New UI and copy, for Gilad's digest line** (orchestrator): the login ↔ signup cross-links, the turtle and
  wordmark above the card, and the subtitles' "בחינם · בלי סיסמה" claims. These are not a pure restyle.
  - The earlier draft's accent pill ("חינם · בלי סיסמה", Main's tint pill) is dropped under the brand
    amendment. The turtle and the wordmark carry the brand now, and its two claims moved into the subtitles.
    `auth.eyebrow` is not added.
  - Why the links: `0009a` drops "הרשמה" from the header, so a visitor on the wrong page gets one tap to the other.
  - Login already signs up an unknown email, so nothing depends on the links. Dropping them is a two-key change.
- **Spec decisions** (the verifier and reviewers challenge these; not for Gilad):
  - centred auth, not a side panel (the reasons are under UI);
  - the 6-digit code drops its letter-spacing for the kit's large input, rather than adding a kit variant.
- No open product questions.
- **Verifier round 1:** 17 findings, all applied; a second round is waived (one verifier round, Gilad).
  - Finding 1 split the draft: auth stays here, and the profile is `0009r`.
  - These apply here: 5 (`0009l`'s screenshot harness), 6 (no check mark on single-select segments), 8 (the
    class-token grep), 9 (the owners of FOLLOWUPS 23 / 24 and `resendIn`), 10 (security), 15 (`fullWidth`),
    16 (the FOLLOWUPS ticks) and 17 (copy that ages; the digest line).
  - The profile-only findings 2–4, 7 and 11–14 are applied in `0009r`.
- **Brand amendment** (orchestrator, 2026-11-12, `specs/0009-brand-amendment.md`). Applied as a spec edit, with
  no new verifier round (orchestrator's instruction):
  - the brand token names;
  - `Logo` + one `Mascot pose="hello"`;
  - the `ink` primary and `border-strong` inputs;
  - the error pattern on `auth.errors.invalidCode`;
  - slash-free, gender-neutral new copy.

  It depends on `0009d` adding `Logo` / `Mascot` and the amended tokens. If their merged props differ, adapt the
  call, not the kit.

## Digest (filled by orchestrator after verification)
See `/digest`.
