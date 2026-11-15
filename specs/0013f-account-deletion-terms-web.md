---
id: 0013f
title: "A person deletes their account from the profile, chats show who left, and every page links to the terms of use and the privacy policy"
status: in-review
depends_on: [0013c]
reviewers: [code, security, ux, qa]   # security: the reauth flow, signup_blocked, and the legal text's claims read against the code; ux: the delete section and dialog, the footer, the legal pages; qa: the flows and every placeholder
estimate: 1 coder run   # coder Sonnet/high (UI and copy; the data and auth rules are 0013c's)
---

## Goal
After this ships:
- a signed-in person can delete their account from the profile, after a confirm dialog and, when
  needed, a fresh sign-in;
- the people they talked to see "משתמש/ת שנמחק/ה" in place of their name, and a closed chat wherever the
  deleted account was the owner, the applicant or the other person (a room chat goes on without a
  deleted flatmate, 0013c);
- every page but chat links to the terms of use and the privacy policy: a footer (with a contact address)
  everywhere except the landing, and on the landing two small links under its closing band;
- the step that creates an account shows the consent line.

PRODUCT.md "Launch (Slice 13)", Gilad 2026-11-15. The API is `0013c`'s.

## Decisions this spec builds on
- PRODUCT.md "Launch (Slice 13)": self-serve deletion in the profile; messages stay under
  "משתמש/ת שנמחק/ה" (Gilad's text, verbatim); the terms and privacy text drafted by the orchestrator and
  approved by Gilad (the section "Legal text" below; **a draft, not legal advice**; a lawyer's read before
  launch is advised).
- `0013c`'s API:
  - `DELETE /me`: 204; 403 `reauth_required` when the session is older than 15 minutes;
  - `POST /auth/otp/verify`: 403 `signup_blocked`;
  - `null` names in the chat schemas (`MemberOut.name`, `MessageOut.sender_name`,
    `ConversationOut.other_name`, `ThreadOut.other_name`) and `MyFlatOut.owner_name`.
- PRODUCT.md "Slice 9 copy + UX" said "no footer until Slice 12", and its "Landing v2" (0009z, merged #83)
  keeps the landing with "still no footer". So the footer is allowed now on every page **except `/`**
  (orchestrator default; Digest decision 4 offers the footer on `/` too). The landing gets the two legal
  links as a small line under its closing band, which adds no footer. The footer's anatomy is
  `design/screens-v1/Main.dc.html` lines 121–125: three centred links, small, muted. Its third link reads
  "יצירת קשר", not the artboard's "צור קשר", which addresses one gender (`design/brand/README.md`
  voice).
- **Consent is a line, not a checkbox** (orchestrator default, part of the legal text Gilad approves): "בהרשמה
  מאשרים את תנאי השימוש ואת מדיניות הפרטיות", directly above the button that creates the account:
  `auth.verify`, on the verify step that sends the profile (Scope "Sign-in"). A required checkbox is the
  stronger form; switch to it if the lawyer asks (one component, no API change).
- **The contact address** is `import.meta.env.VITE_CONTACT_EMAIL || 'contact@example.com'`, as
  `MAP_STYLE_URL` reads its env (`web/src/components/map/config.ts`). It goes in `web/src/vite-env.d.ts`
  and `.env.example`. Production sets the real address in the web build (0013a's deploy checklist), on
  the domain Gilad buys.

- **Gilad 2026-11-15: access logs kept and disclosed.** The server's access log (every request's IP and
  path) stays on; privacy §1 i13 and §5 i9 disclose it, retention `[משך שמירת היומנים]` (security review
  M3, option b over `--no-access-log`).

## Scope
**In:**
- **Profile** (`web/src/features/profile/ProfilePage.tsx`): a "מחיקת החשבון" section **after** the profile
  form (outside the `<form>` and its sticky save bar). It holds a short explanation, a link "מה נשמר ומה
  נמחק" to `/privacy#deletion`, and a `danger` `Button` that opens a `Dialog` (`web/src/components/Dialog.tsx`).
  The dialog's states:
  - **confirm**: title, body, then "מחיקה סופית" (`danger`) and "ביטול" (`common.cancel`, focused first);
  - **pending**: the button disabled and labelled "מוחקים…";
  - **reauth** (403 `reauth_required`): the body explains, the action is "התחברות מחדש", which runs the
    existing `useLogout` and then navigates to `loginWithNext({ pathname: '/me/profile', search: '' })`;
  - **failed** (any other error or network): an error line, and the button is usable again. The line is
    `common.offline` when offline (`useOnline`, as `OtpForm` does; PRODUCT.md "Slice 9 copy + UX",
    offline), else `profile.delete.failed`.

  A new `web/src/features/profile/useDeleteAccount.ts` holds the `DELETE /me` mutation. On 204 it
  navigates to `/account-deleted` with `replace` **first**, then runs `clearAllDrafts()`, `clearSeen()`
  and `clearSession(queryClient)`, as `useLogout` does. The order matters: `RequireUser` on
  `/me/profile` must not bounce to the login page in between.
- **Account deleted page:** `web/src/features/profile/AccountDeletedPage.tsx` at public `/account-deleted`,
  `PageContainer width="narrow"`. It shows a heading, one paragraph, and a link-button "לדף הבית" to `/`.
- **Chat placeholders:**
  - `ChatThreadPage.tsx` and `ConversationsPane.tsx` show `t('account.deletedName')` wherever a `null`
    name arrives: the thread header and the page title, the members line (`memberWithRole`), each
    message's sender, the chat list row (with the `Avatar` fallback), and the report dialog's
    `report.title.person` / `report.groupHint`;
  - closed text: when `!thread.can_send` and `thread.other_name === null`, the closed line is
    `chat.thread.closedDeleted`. Otherwise today's `closed` / `closedDirect` choice is unchanged.
- **My flats:** `web/src/features/flatmates/MyFlatsPage.tsx` shows `flatmates.mine.owner` with
  `t('account.deletedName')` when `owner_name` is `null`.
- **Sign-in:** `web/src/features/auth/OtpForm.tsx`. An account is created only by the verify that sends
  `profile`:
  - `hasDetail` learns `'signup_blocked'`;
  - a 403 with it is a new result `{ kind: 'signupBlocked' }`, and `Step2Error` gains it. Like
    `suspended`, it clears the used code (`setCode('')`) and shows in the verify step's alert, as
    `auth.errors.signupBlocked` with the contact address;
  - the consent line (`auth.signup.consent`, through react-i18next's `Trans` with two router `Link`s) sits
    directly above `auth.verify` whenever that verify sends the profile (`step === 'verify' &&
    askProfile`):
    - **sign-up page:** the verify step, under the code field and its alert. The request step
      (`auth.sendCode`) has no line: sending a code creates nothing;
    - **login page:** the verify step after a `profile_required` answer (`profileNeeded`), under the
      `auth.noAccountYet` card. The plain login steps have no line;
  - its two links open in a new tab (`target="_blank" rel="noopener noreferrer"`, with `common.newTab` as
    text for screen readers only). The email and code live only in the form's state, so following a link
    in the same tab would lose them.
- **Footer:**
  - `web/src/app/Layout.tsx` renders a new `web/src/app/SiteFooter.tsx` (`<footer data-site-footer>`)
    after `<main>`, on every route **except**:
    - `/`, the landing (PRODUCT.md "Landing v2": still no footer);
    - under `/chat`, where the panes fill the viewport (`ChatLayout.tsx`, `ChatThreadPage.tsx`'s `100dvh`
      heights);
  - links: "תנאי שימוש" → `/terms`, "מדיניות פרטיות" → `/privacy`, "יצירת קשר" → `mailto:` the contact
    address;
  - below `lg`, with the tab bar showing, nothing in the footer sits under the bar.
    `web/src/app/index.css`'s `--bottom-nav-h` clearance applies to the page's last element: the footer
    where there is one, `main` on `/` and `/chat` (WCAG 2.4.11, as today).
- **Landing:** `web/src/features/landing/LandingPage.tsx` adds one centred line after `<ClosingBand />`,
  inside its `PageContainer`. It holds two small muted links, `footer.terms` → `/terms` and
  `footer.privacy` → `/privacy` (`text-body-sm text-ink-muted`, `min-h-tap` targets). It has no `footer`,
  no `nav` landmark and no contact link. `ClosingBand.tsx` is untouched, so the ink band and its two CTAs
  stay as they are.
- **Legal pages:**
  - `web/src/features/legal/LegalPage.tsx`, one component for `/terms` and `/privacy`. Each renders an
    `h1`, the "עודכן לאחרונה" line, then one `h2` per section (each with an `id`; the privacy deletion
    section is `id="deletion"`), with paragraphs and lists;
  - `PageContainer width="narrow"`, `usePageTitle`. Text from `he.json` only, one key per heading,
    paragraph or list item. Static keys, so `make i18n-check` checks them;
  - the `{{email}}` placeholders interpolate the contact address. The `[…]` placeholders (operator's
    name, email provider, date) stay in the text until Gilad fills them; the coder keeps them verbatim.
- **Routes:**
  - `web/src/app/routes.tsx` gains `terms`, `privacy` and `account-deleted` (public, inside `Layout`);
  - `web/src/app/__tests__/pageWidths.test.ts` `PAGES` gains `LegalPage` and `AccountDeletedPage` (narrow).
- **i18n:** `web/src/locales/he.json`, all keys under UI and "Legal text".
- **Existing tests that change:**
  - `web/src/app/__tests__/Layout.test.tsx`: line 314's navigation list on `/search` gains `he.footer.label`
    after `he.nav.label`;
  - `web/src/features/landing/__tests__/LandingPage.test.tsx::ac8_closing_no_footer`: its last block (AC8).

  `ApplySection.test.tsx` and `JoinFlatPage.test.tsx` stay unchanged (Blast radius).
- **E2E:** `web/e2e/account.spec.ts` (new; CI only, Speed rule 8).

**Out:**
- the API (`0013c`);
- new `make screens` states for the new pages and the dialog (`0013d` owns the screenshot suite; ux reviews
  from ad-hoc screenshots);
- a stored record of consent (`terms_accepted_at`) and terms versioning;
- an English version of the legal text;
- a cookie banner. The site sets one strictly necessary cookie and no trackers, so none is needed; the
  lawyer can confirm.

**New dependencies:** none (`react-i18next`'s `Trans` is already installed).

## Data
None.

## API
None new; consumes `0013c`. After `make client`, `tsc` lists every consumer of the newly nullable names.

## UI
Artboards: footer anatomy from `design/screens-v1/Main.dc.html` (121–125). Brand: `design/brand/`
(tokens, voice). No artboard exists for the delete section, the dialog or the legal pages. They use the
house components (`PageHeader`, `Dialog`, `Button` `danger` / `secondary`, `PageContainer` narrow), with
the brand's `font-display` headings, like the profile's sections (`sectionHeading`).

| Screen | States |
| --- | --- |
| Profile · delete section | always shown to the signed-in person; the button opens the dialog |
| Delete dialog | confirm (cancel focused first) · pending (button disabled, "מוחקים…", announced via the button text) · reauth · failed (error line in `role="alert"`: `common.offline` when offline, else `profile.delete.failed`) |
| `/account-deleted` | static, nothing fetched (no empty, loading or error state); reachable signed out; a reload shows the same page |
| Chat thread / list | a deleted member's name is the placeholder everywhere; closed line `closedDeleted`; the composer hidden as for any closed chat |
| My flats | owner placeholder |
| Sign-in | `signupBlocked` in the verify step's existing alert, the code field cleared · the consent line above `auth.verify` on the verify step that sends the profile, its links opening a new tab |
| Footer | every route but `/` and `/chat*`; three links, centred, wrapping on 390 px; logical properties only |
| Landing (`/`) | no footer; one centred line of two small links under the closing band |
| `/terms`, `/privacy` | static, nothing fetched (no empty, loading or error state); long text readable at 390 px; headings in order (h1 → h2); in-page anchor `#deletion` |

**RTL:**
- the footer and the delete section use logical properties only; the legal lists use `ps-`;
- an email address inside Hebrew text (`{{email}}`, the footer's `mailto:`) renders as one LTR run.
  If ux sees the punctuation next to it flip, wrap it in `<bdi>`;
- `nadlan.gov.il`, `Fly.io`, `Cloudflare`, `OpenStreetMap` and `Nominatim` stay in Latin script.

**i18n keys added** (`he.json`):
- `account.deletedName`: "משתמש/ת שנמחק/ה"
- `chat.thread.closedDeleted`: "החשבון של הצד השני נמחק. השיחה נשארת לקריאה, ואי אפשר לשלוח בה הודעות חדשות."
- `auth.errors.signupBlocked`: "אי אפשר להירשם עם האימייל הזה. לשאלות: {{email}}"
- `auth.signup.consent`: "בהרשמה מאשרים את <terms>תנאי השימוש</terms> ואת <privacy>מדיניות הפרטיות</privacy>."
- `common.newTab`: "(נפתח בלשונית חדשה)" (screen readers only)
- `profile.delete.title`: "מחיקת החשבון"
- `profile.delete.body`: "המחיקה מיידית וסופית: נמחקים האימייל, השם, הפרופיל, התמונה והלייקים, והמודעות יורדות מהאתר. הודעות שכבר שלחתם נשארות בשיחות של האנשים האחרים, בלי השם שלכם."
- `profile.delete.privacyLink`: "מה נשמר ומה נמחק"
- `profile.delete.open`: "מחיקת החשבון"
- `profile.delete.confirmTitle`: "למחוק את החשבון?"
- `profile.delete.confirmBody`: "אי אפשר לבטל את המחיקה, והפרטים לא יחזרו."
- `profile.delete.confirm`: "מחיקה סופית"
- `profile.delete.pending`: "מוחקים…"
- `profile.delete.reauth`: "כדי למחוק את החשבון צריך להתחבר שוב עם קוד חדש מהאימייל. אחרי הכניסה חוזרים לכאן."
- `profile.delete.reauthAction`: "התחברות מחדש"
- `profile.delete.failed`: "לא הצלחנו למחוק את החשבון. אפשר לנסות שוב."
- `accountDeleted.title`: "החשבון נמחק"
- `accountDeleted.body`: "מחקנו את הפרטים שלכם. הודעות ששלחתם נשארות אצל מי שקיבלו אותן, בלי השם שלכם."
- `accountDeleted.home`: "לדף הבית"
- `footer.label`: "קישורים" (the footer `nav`'s accessible name)
- `footer.terms`: "תנאי שימוש" · `footer.privacy`: "מדיניות פרטיות" · `footer.contact`: "יצירת קשר"
- `legal.updated`: "עודכן לאחרונה: {{date}}"
- `legal.terms.*`, `legal.privacy.*`: the text below, one key per heading, paragraph or list item. Sections
  may be numbered in key names (`s1.title`, `s1.p1`, `s1.items.0` …): the coder's choice, all static.

## Acceptance criteria
- [ ] AC1 Given a signed-in person on `/me/profile`, When they open the delete dialog and confirm, Then
  `DELETE /me` is sent once, and on 204:
  - drafts, "seen" and the session cache are cleared (`['me']` is `null`);
  - the app lands on `/account-deleted` (replace);
  - the back button does not return to the profile.

  — `web/src/features/profile/__tests__/ProfilePage.test.tsx::ac1_delete_account`
- [ ] AC2 Given the API answers 403 `reauth_required`, When they confirm, Then the dialog shows
  `profile.delete.reauth` and "התחברות מחדש". That button logs out and navigates to
  `/login?next=%2Fme%2Fprofile` — `ProfilePage.test.tsx::ac2_reauth_required`
- [ ] AC3 Given any other failure, Then:
  - the dialog shows `profile.delete.failed` in an alert and stays open;
  - offline (`navigator.onLine` false, the request failing), the alert is `common.offline` instead;
  - "ביטול" closes it, with no request and focus back on the opener;
  - while pending the confirm button is disabled.

  — `ProfilePage.test.tsx::ac3_delete_failure_and_cancel`
- [ ] AC4 Given a thread whose `other_name`, one member's `name` and two messages' `sender_name` are
  `null` and `can_send` false, When it renders, Then every one shows "משתמש/ת שנמחק/ה" (header, page
  title, members line, senders), the closed line is `closedDeleted`, and there is no composer. A chat list
  row with `other_name` null shows the placeholder —
  `web/src/features/chat/__tests__/ChatThreadPage.test.tsx::ac4_deleted_member`,
  `ChatListPage.test.tsx::ac4_deleted_member_row`
- [ ] AC5 Given `GET /me/flats` with `owner_name` null, Then the flat shows the owner placeholder —
  `web/src/features/flatmates/__tests__/MyFlatsPage.test.tsx::ac5_owner_deleted` (existing file)
- [ ] AC6 Given verify answers 403 `{"detail":"signup_blocked"}`, on the sign-up page and on the login
  page, Then:
  - the verify step's alert shows `auth.errors.signupBlocked` with the contact address;
  - the code field is empty (the code was used up), as after `suspended`;
  - a 403 `account_suspended` still shows `suspended`.

  — `web/src/features/auth/__tests__/OtpForm.test.tsx::ac6_signup_blocked`
- [ ] AC7 Given the sign-up page's verify step, or the login page's verify step after a `profile_required`
  answer, Then the consent line shows directly above `auth.verify`. Its links go to `/terms` and `/privacy`
  with `target="_blank"` and `rel="noopener noreferrer"`. The sign-up request step and the plain login
  steps show no line — `OtpForm.test.tsx::ac7_consent_line`
- [ ] AC8 Given `/search`, `/listings/:id`, `/me/profile` and `/terms`, Then:
  - a `footer` holds a `nav` named `footer.label` with three links: `/terms`, `/privacy`, and `mailto:`
    the contact address;
  - on `/search` the navigations are `side.label`, `nav.label`, `footer.label`, in that order;
  - on `/`, `/chat` and `/chat/:id` there is no footer.

  — `web/src/app/__tests__/Layout.test.tsx::ac8_site_footer` and line 314's updated list. The landing's
  `LandingPage.test.tsx::ac8_closing_no_footer` keeps "no `footer`" and the band's two CTAs. Its last
  block changes: after the band, exactly two links, `/terms` and `/privacy`, and no `mailto:` link.
- [ ] AC9 `/terms` and `/privacy` render:
  - their `h1`, the updated line and every section heading as an `h2` in order;
  - the privacy page has `#deletion`;
  - every `{{email}}` is the contact address, with no raw `{{` left;
  - the page title is set;
  - `/account-deleted` renders its heading and home link signed out.

  — `web/src/features/legal/__tests__/LegalPage.test.tsx::ac9_legal_pages`,
  `web/src/features/profile/__tests__/AccountDeletedPage.test.tsx::ac9_account_deleted_page`
- [ ] AC10 The new pages are in `pageWidths.test.ts` (narrow), and `make i18n-check` and `make lint` pass —
  existing tests / targets
- [ ] AC11 E2E (CI only), on the compose stack:
  - sign up as a new person;
  - delete the account from `/me/profile` (a fresh session, so no reauth);
  - land on `/account-deleted`;
  - `GET /me` is 401;
  - signing in again with the same email reaches the profile step (the account is gone);
  - the footer's links open `/terms` and `/privacy` with no axe violations (`expectNoAxeViolations`).

  — `web/e2e/account.spec.ts::ac11_delete_account_and_legal_pages`
- [ ] NF1 Below `lg` with the tab bar showing, the footer's links are not covered by the bar, and the last
  focusable link scrolls clear of it — `Layout.test.tsx::nf1_footer_clears_tab_bar` (the clearance rule's
  selector) and ux review at 390 px
- [ ] NF2 No hardcoded Hebrew or English in the new `.tsx`; logical properties only — `make i18n-check`,
  `make lint`

## Tests to write
Unit/component (vitest): AC1–AC10, NF1. E2E (CI only, Speed rule 8): AC11. No local `make e2e`.

## Blast radius
From `graphify affected` on `main` (84b6fef), checked with grep:
- `web/src/api/schema.d.ts` (regenerated by `make client` after 0013c): nullable `other_name` / `name` /
  `sender_name` / `owner_name`. Consumers:
  - `ChatThreadPage.tsx`: lines ~69, 95–96, 215, 222, 232, 314, 330, 447;
  - `ConversationsPane.tsx`: ~67, 75;
  - `MyFlatsPage.tsx`: ~99.

  `JoinFlatPage.tsx` reads the invite preview's `owner_name`, which stays `string`.
- `web/src/app/Layout.tsx` (every route):
  - `Layout.test.tsx`: line 314 asserts `/search`'s whole navigation list, `[side.label, nav.label]`; the
    footer's `nav` makes it `[side.label, nav.label, footer.label]`. Line 250 counts the banner's
    navigations only and is unchanged;
  - `RouteFocus` / `SkipLink` (unchanged), and `index.css`'s `--bottom-nav-h` rule for `main`;
  - the other `AppRoutes` tests that count links or navigations (`SideSwitch.test.tsx`,
    `MarketMinePage.test.tsx`, the rest of `Layout.test.tsx`) scope them to the banner, a nav or a card,
    so the footer does not reach them.
- `web/src/features/landing/LandingPage.tsx` (the new line after `ClosingBand`) →
  `LandingPage.test.tsx::ac8_closing_no_footer`: `/` has no footer, so its `footer` check stays; its loop
  that finds no "תנאי שימוש" link changes (AC8). The band's own link count (2) is unchanged.
- `web/src/features/auth/OtpForm.tsx` `hasDetail` / result kinds / the consent line (`graphify affected
  "OtpForm"`):
  - `LoginPage`, `SignupPage`, `OtpForm.test.tsx`, `SignupPage.test.tsx`, `LoginPage.test.tsx`;
  - `ApplySection.test.tsx` and `JoinFlatPage.test.tsx` render `LoginPage` in their own routes, outside
    `Layout`, and stop at its request step (its heading and the URL). That step gets no consent line and
    no footer, so both stay unchanged.
- `web/src/features/auth/useLogout.ts::clearSession` (reused, unchanged).
- `web/src/app/routes.tsx` → `routes.test.tsx`, `pageWidths.test.ts`.

## Risks / open questions
- **The legal text is a draft** written from what the app does; it is not legal advice. Gilad approves it
  at the digest. A lawyer should read it before launch, especially:
  - the operator's identity;
  - the Privacy Protection Law notice items (section 11, as amended by amendment 13);
  - the consent form (line vs checkbox);
  - the age limit;
  - jurisdiction.

  The `[…]` placeholders block launch, not this build.
- **`0016a` (landing polish, another chat's spec) is changing the landing now**, likely its closing band
  and its tests. This spec touches the landing in two places only: one line after `<ClosingBand />` in
  `LandingPage.tsx`, and the last block of `LandingPage.test.tsx::ac8_closing_no_footer`. Whoever merges
  second merges `origin/main` and reconciles both. If Gilad picks the footer on `/` (Digest decision 4),
  the landing line goes and the shell's footer covers `/`.
- **A suspended account** cannot sign in, so it cannot delete itself; the privacy text sends it to
  `{{email}}`. No tool deletes an account for someone else (0013c leaves admin deletion out), so the text
  promises a way to ask, not a time frame.
- **Production values:** `VITE_CONTACT_EMAIL` (and 0013c's `EMAIL_BLOCK_KEY`) belong in 0013a's deploy
  checklist. A build without it shows `contact@example.com`.
- **Build notes (coder, 2026-11-15), deviations from the text above:**
  - `useDeleteAccount` clears storage (drafts, seen, invite token) in `onSuccess`, then navigates, but
    clears the query cache (`['me']`, `clearSession`) when its host page unmounts, or at once if the page is
    already gone. React Router commits a navigation inside `startTransition`, while the query cache's store
    updates are synchronous: clearing `['me']` first rendered `RequireUser` on `/me/profile` with no person and
    bounced to the login page (reproduced in `ac1_delete_account`).
  - The delete section is its own file, `DeleteAccountSection.tsx` (`ProfilePage.tsx` is 740 lines); the
    landing's two links are `landing/LegalLinks.tsx` (one line in `LandingPage.tsx`, so 0016a's merge
    stays small); the legal text is rendered from `legal/content.ts`, one literal `t('legal.…')` per
    paragraph, so `make i18n-check` checks every key.
  - `ProfilePage.test.tsx::0009r layout::ac1_sections_index_and_field_order` lists the page's `h2`s; the
    delete section adds one (the Blast radius missed it). Updated.
  - On the legal pages `{{email}}` renders in a `<bdi>`, so copying it copies no invisible characters; the
    sign-up-blocked alert uses first-strong isolates (as `OtpForm` does for the code step's email). The footer
    shows "יצירת קשר", never the address.
  - `VITE_CONTACT_EMAIL` also passes through `infra/docker-compose.yml`'s web service (without it the
    `.env.example` line would not reach the container).
  - `/privacy#deletion` scrolls to its section: the router does not scroll to a hash, so `LegalPage` does.
  - `legal.date` ("[תאריך]") is its own key, so Gilad fills one place for both pages' "עודכן לאחרונה".
  - Legal text per the orchestrator's exceptions: Privacy §3's providers bullet and its last bullet name no
    paid provider. Placeholders left in `he.json`: see the coder's report.
  - Not verified: a 390 px / `lg` visual pass of the footer, the delete section and the legal pages (no
    stack was started; the Mac was loaded by other stacks). NF1 is checked by a stylesheet test only.
- The reauth trip loses nothing: the profile form's unsaved edits are lost on logout, as on any logout,
  and the dialog says a sign-in follows.

## Legal text (draft for Gilad's approval)
**Not legal advice.** A draft written by the orchestrator from what the app does on `main` (84b6fef),
plus 0013c. Gender-neutral (plural) as the brand voice asks. `{{email}}` = the contact address. `[…]` =
for Gilad to fill. The coder copies it into `he.json` verbatim.

### תנאי שימוש (`/terms`)
**עודכן לאחרונה: [תאריך]**

ברוכים הבאים להומי. השימוש באתר כפוף לתנאים האלה ולמדיניות הפרטיות, ומי שנרשמים לאתר או משתמשים בו מסכימים להם. מפעיל השירות: [שם המפעיל ומספר מזהה]. התנאים כתובים בלשון רבים ומתייחסים לכל המגדרים.

**1. מה זה הומי**
הומי מחברת בין מי שמשכירים דירה או חדר לבין מי שמחפשים, בגוש דן. השימוש חינם. הומי היא לא מתווכת, לא צד להסכם השכירות, ולא בודקת את הדירות, את המודעות או את המשתמשים.

**2. מי יכולים להשתמש**
- בני ובנות 18 ומעלה. [לאישור]
- חשבון אחד לכל אדם, עם כתובת אימייל שלכם.
- מתווכים לא מפרסמים בהומי בשלב הזה.

**3. פרסום מודעות**
- מפרסמים רק דירה או חדר שיש לכם זכות להשכיר, עם פרטים, מחיר ותמונות אמיתיים.
- אפשר להחזיק עד 3 מודעות פעילות בחשבון. מודעה פעילה 90 יום, ואפשר לחדש אותה.
- בחדר בדירת שותפים אפשר לציין אם הוא מיועד לנשים או לגברים. בדירה שלמה אין העדפה לפי מגדר.
- אסור לפרסם תוכן פוגעני, מטעה, מפלה או לא חוקי, וגם לא מודעה שהיא בעצם פרסומת.

**4. פניות וצ'אט**
- שיחה נפתחת רק כשבעלי המודעה בוחרים במועמדות או כשמגישים מועמדות בתגובה להזמנה שלהם, או אחרי לייק הדדי בשוק השותפים.
- מדברים בכבוד. אסור להטריד, לאיים או לשלוח ספאם.
- לעולם לא מעבירים כסף (פיקדון, דמי רצינות או מקדמה) לפני שראיתם את הדירה ונפגשתם.

**5. דיווחים ובקרה**
אפשר לדווח על מודעה, על אדם או על שיחה. הומי רשאית, לפי שיקול דעתה ובלי חובה לנמק, להסיר מודעה, להשעות חשבון או למנוע הרשמה מחדש. כשמדווחים על שיחה, הומי יכולה לקרוא את ההודעות שבה, וכל קריאה כזו נרשמת אצלנו.

**6. הערכת שכר דירה**
ההערכה שהומי מציגה היא טווח שמחושב מנתונים רשמיים (nadlan.gov.il והלשכה המרכזית לסטטיסטיקה). היא לא שמאות ולא ייעוץ, ואין להסתמך עליה כמחיר מחייב.

**7. אחריות**
השירות ניתן כמו שהוא. ככל שהחוק מאפשר, הומי לא אחראית לתוכן שמשתמשים מפרסמים, לנכונות המודעות, להסכמים בין משתמשים או לנזק שנגרם מהם, ולא מתחייבת שהאתר יהיה זמין תמיד או בלי תקלות.

**8. התוכן שלכם**
התוכן שאתם מעלים נשאר שלכם. כשאתם מעלים אותו, אתם נותנים להומי רשות להציג אותו באתר, לעבד אותו (למשל להקטין תמונות) ולהשתמש בו להפעלת השירות, עד שהוא נמחק. השם, הלוגו והעיצוב של הומי שייכים להומי.

**9. סיום השימוש**
אפשר למחוק את החשבון בעמוד הפרופיל. התנאים למחיקה, ומה נשמר אחריה, מפורטים במדיניות הפרטיות, בסעיף "מחיקת החשבון". הומי רשאית להשעות או לסגור חשבון שמפר את התנאים.

**10. שינויים בתנאים**
אם נשנה את התנאים, נעדכן את התאריך למעלה. על שינוי מהותי נודיע באתר, והמשך השימוש אחריו הוא הסכמה לו.

**11. דין וסמכות שיפוט**
על התנאים חל הדין הישראלי. סמכות השיפוט הבלעדית נתונה לבתי המשפט בתל אביב-יפו. [לאישור]

**12. יצירת קשר**
לכל שאלה: {{email}}

### מדיניות פרטיות (`/privacy`)
**עודכן לאחרונה: [תאריך]**

כאן מוסבר איזה מידע הומי אוספת, למה, מי רואים אותו וכמה זמן הוא נשמר. המדיניות נכתבה לפי חוק הגנת הפרטיות, התשמ״א-1981. מפעיל השירות ובעל מאגר המידע: [שם המפעיל ומספר מזהה]. לכל שאלה: {{email}}.

**1. איזה מידע נאסף ולמה**
- חשבון: אימייל, שם לתצוגה, והאם מפרסמים דירה או מחפשים. האימייל משמש רק לכניסה עם קוד חד-פעמי ולפניות שלנו בנוגע לחשבון, ולא מוצג למשתמשים אחרים. השם מוצג רק במקומות שמפורטים בסעיף הזה.
- פרופיל, בשני חלקים: "מה מחפשים" (תקציב, אזורים, תאריך כניסה, משך חוזה, מי גרים איתכם, חיות מחמד, עישון, חניה, ואם מעדיפים שותפים ממגדר מסוים) ו"פרטים אישיים" (מגדר, שנת לידה, תשובות לשאלון אורח החיים, "קצת עליי"). הפרטים משמשים לחישוב ציון ההתאמה ולסינון. את התקציב עצמו משתמשים אחרים לא רואים, רק אם הוא מתאים למחיר.
- הכרטיס בשוק השותפים: מתג אחד, "להציג את הכרטיס שלי בשוק השותפים", כבוי עד שמדליקים אותו. כשהוא דולק, הכרטיס (שם, תמונה, גיל, מגדר, אזורים, תאריך כניסה, תשובות לשאלון ו"קצת עליי") מוצג לכל מי שהכרטיס שלהם גלוי בשוק השותפים, ולמי שמפרסמים חדר, בדף האנשים של החדר, עם ציון ההתאמה לחדר. בשוק השותפים הכרטיס לא מוצג למי שהמגדר שלהם לא מתאים להעדפה שלכם לגבי שותפים.
- עמוד של חדר: אם פרסמתם חדר וסימנתם "גרים בדירה", או הצטרפתם לדירה כשותפים ובחרתם להופיע, השם, התמונה, הגיל, המגדר, התשובות לשאלון ו"קצת עליי" מוצגים בעמוד החדר למחפשים מחוברים שהחדר מתאים להם.
- תמונה אישית: מוצגת רק במקומות שבהם השם שלכם כבר מוצג.
- מודעות: כתובת, מחיר, פרטי הדירה, תיאור ותמונות. מה שמפרסמים במודעה גלוי לכולם, ועל המפה מוצג מיקום משוער בלבד. לפני השמירה אנחנו מסירים מהתמונות מידע נלווה, כמו מיקום GPS ופרטי המצלמה. בחדר בדירת שותפים, הגילים של השותפים והתשובות שלהם לשאלון מוצגים רק למחפשים מחוברים.
- היסטוריית מחירים: אנחנו שומרים כל מחיר שהיה למודעה. אם עניתם מה קרה עם הדירה ומה היה שכר הדירה הסופי, גם זה נשמר. המידע הזה לא מוצג למשתמשים אחרים, ומשמש רק לסטטיסטיקה פנימית של שכר דירה.
- מועמדויות: מועמדות שולחת לבעלי המודעה את השם, התמונה, ההודעה שצירפתם, ציון ההתאמה והסיבות שלו, ומהחלק "מה מחפשים": מי גרים איתכם, תאריך כניסה, משך חוזה, חיות מחמד, עישון וחניה. התקציב והאזורים לא נשלחים. במועמדות לחדר נשלחים גם המגדר, הגיל (לא שנת הלידה) והתשובות לשאלון.
- צ'אט: ההודעות מגיעות לכל מי שבשיחה, וכולם רואים את השמות של כל המשתתפים. בשיחה על מועמדות: בעלי המודעה ומי שהגישו אותה, ובחדר גם השותפים שהצטרפו לדירה, שרואים את ההודעות מהרגע שהצטרפו. בשיחה ישירה בשוק השותפים: שני האנשים שבה.
- לייקים והזמנות: לייק שעשיתם לאדם בשוק השותפים מוצג למי שקיבלו אותו, ולייק הדדי פותח שיחה ישירה. הזמנה לחדר שנשלחת מדף האנשים של החדר מוצגת למי שהוזמנו.
- דירת שותפים: מי שמקבלים קישור הזמנה לדירה שלכם רואים בו את השם שלכם, וגם אחרי שהצטרפו. אתם רואים את השמות שלהם.
- דיווחים: סיבת הדיווח, והערה אם הוספתם. זהות המדווחים לא נחשפת למי שדווחו עליהם.
- מידע טכני: עוגייה אחת להתחברות, שנשמרת עד 30 יום ונדרשת לשימוש באתר; כתובת IP: לזמן קצר, כדי להגביל ניסיונות חוזרים ולמנוע שימוש לרעה, וגם ביומני השרת, יחד עם הדף שביקשתם, עד [משך שמירת היומנים]; וספירת צפיות במודעות, שנשמרת כמספר בלבד (כדי לא לספור פעמיים את אותה צפייה, נשמר לשעה אחת מזהה מקודד שלה).
- בדפדפן שלכם, לא אצלנו: הצד של האתר שבחרתם, מודעות שכבר ראיתם, טיוטות של הודעות וקישור הזמנה לדירת שותפים. חלקם נמחקים כשיוצאים מהחשבון.
- אין באתר פרסומות ואין כלי מעקב של צד שלישי, ואנחנו לא מוכרים מידע.

**2. האם חובה למסור את המידע**
אין חובה לפי חוק למסור לנו מידע. בלי אימייל, שם, והבחירה אם מפרסמים או מחפשים, אי אפשר לפתוח חשבון. כל שאר הפרטים הם רשות, אבל בלעדיהם חלק מהאתר לא זמין:
- כדי להגיש מועמדות לדירה או לחדר, צריך למלא בפרופיל את החלק "מה מחפשים".
- כדי להגיש מועמדות לחדר שמיועד לנשים או לגברים בלבד, וכדי לראות את האנשים בעמוד של חדר כזה, צריך לציין בפרופיל מגדר.
- כדי לראות אנשים בשוק השותפים ולעשות להם לייק, צריך להציג את הכרטיס שלכם, ולשם כך למלא את שני החלקים של הפרופיל.

מי שלא ממלאים פרטים מקבלים גם התאמות פחות מדויקות.

**3. מי רואים את המידע**
- משתמשים אחרים, כמו שמתואר בסעיף 1.
- ספקים שמפעילים את השירות בשבילנו, רק לשם כך: [ספק השרתים ומסד הנתונים] (השרתים ומסד הנתונים, [מיקום השרתים]), [ספק אחסון התמונות והאתר] (אחסון התמונות והאתר), ו-[ספק האימייל] (שליחת קודי הכניסה).
- OpenStreetMap: כתובת המודעה, בלי שום פרט עליכם, נשלחת לשירות Nominatim כדי למקם אותה על המפה. אריחי המפה נטענים בדפדפן שלכם משרתי OpenStreetMap, שרואים את כתובת ה-IP שלכם.
- רשויות, כשהחוק מחייב אותנו.
- חלק מהספקים פועלים מחוץ לישראל: [מדינות].

**4. בקרה ובטיחות**
הומי בודקת דיווחים, ויכולה להסיר מודעה או להשעות חשבון. כשמדווחים על שיחה, הומי יכולה לקרוא את ההודעות שבה, וכל קריאה כזו נרשמת אצלנו. שיחות שלא דווחו לא נקראות.

**5. כמה זמן המידע נשמר**
- החשבון והפרופיל: עד שמוחקים את החשבון.
- תמונה אישית ותמונות של מודעות: עד שמסירים אותן או מוחקים את החשבון.
- מודעה: פעילה 90 יום מהפרסום או מהחידוש, ואפשר להשהות אותה לפני כן. אחר כך היא נשארת ב"המודעות שלי" עד שמוחקים את החשבון: אין מחיקה של מודעה בודדת. אחרי מחיקת החשבון נשארת ממנה רשומה, כמו שמתואר בסעיף 6.
- היסטוריית המחירים של מודעה: בלי הגבלת זמן, וגם אחרי מחיקת החשבון. התשובה מה קרה עם הדירה ומה היה שכר הדירה הסופי נמחקת כשמחדשים את המודעה או מפעילים אותה מחדש, ואחרת נשמרת עם המודעה, גם אחרי מחיקת החשבון.
- הודעות ושיחות: בלי הגבלת זמן. אין מחיקה של הודעה או של שיחה, וגם אחרי מחיקת החשבון ההודעות נשארות אצל האנשים האחרים בשיחה (סעיף 6).
- מועמדויות שהגשתם, גם כאלה שביטלתם או שנדחו: עד שמוחקים את החשבון. אז נמחקות אלה שלא הגיעו לצ'אט, והאחרות נשמרות (סעיף 6).
- לייקים, התאמות והזמנות: עד שמבטלים אותם או מוחקים את החשבון. הסתרת הכרטיס לא מוחקת לייקים שכבר נשמרו.
- קוד כניסה: 10 דקות. התחברות: עד 30 יום.
- כתובת IP: נתונים להגבלת ניסיונות עד יממה, וביומני השרת עד [משך שמירת היומנים].
- דיווחים ופעולות בקרה: בלי הגבלת זמן, גם אחרי מחיקת החשבון.
- הטביעה המקודדת של אימייל חסום (סעיף 6): בלי הגבלת זמן.

**6. מחיקת החשבון** (`id="deletion"`)
אפשר למחוק את החשבון בעמוד הפרופיל. המחיקה דורשת כניסה מ-15 הדקות האחרונות: אם עבר יותר זמן, האתר מבקש להיכנס שוב עם קוד חדש מהאימייל. חשבון מושעה לא יכול להיכנס, ולכן גם לא למחוק את עצמו; אפשר לבקש את המחיקה ב-{{email}}. המחיקה מיידית וסופית:
- נמחקים: האימייל, השם, התמונה האישית, הפרופיל, הלייקים, ההתאמות וההזמנות, התמונות של המודעות, ומועמדויות שהגשתם ושלא הגיעו לצ'אט.
- יוצאים מכל דירת שותפים שהצטרפתם אליה, וכל המכשירים מתנתקים מהחשבון. שותפים שהצטרפו לדירה שלכם נשארים בה ובצ'אטים שלה.
- המודעות יורדות מהאתר. נשארת מהן רשומה בלי תמונות, בלי תיאור ובלי השם שלכם (כתובת, מחיר ופרטי הדירה), בשביל השיחות של מי שפנו אליהן ובשביל סטטיסטיקה של שכר דירה.
- מועמדויות שהגשתם ושהגיעו לצ'אט נשמרות במצב "בוטלה", בלי ההודעה שצירפתם, כי השיחה תלויה בהן. בעלי המודעה כבר לא רואים אותן ברשימת המועמדים.
- הודעות ששלחתם נשארות בשיחות של האנשים האחרים, תחת "משתמש/ת שנמחק/ה". שיחה שהייתם בה בעלי המודעה, מגישי המועמדות או צד בשיחה ישירה נשארת לקריאה, ואי אפשר לשלוח בה יותר. בצ'אט של חדר שהייתם בו שותפים בדירה, שאר המשתתפים ממשיכים לכתוב.
- דיווחים על החשבון ודיווחים שהגשתם נשמרים.
- אם הומי השעתה את החשבון או הסירה ממנו מודעה, גם אם ביטלה את זה אחר כך, נשמרת טביעה מקודדת של האימייל (לא האימייל עצמו, ואי אפשר לשחזר ממנה את הכתובת), כדי למנוע הרשמה מחדש עם אותו אימייל.

**7. הזכויות שלכם**
לפי חוק הגנת הפרטיות אפשר לעיין במידע שלכם, ולבקש לתקן אותו או למחוק אותו. את רוב הפרטים אפשר לראות ולשנות בעמוד הפרופיל ובמודעות שלכם. לכל בקשה אחרת: {{email}}. אפשר גם לפנות לרשות להגנת הפרטיות.

**8. אבטחה**
החיבור לאתר מוצפן (HTTPS). קודי כניסה ומזהי התחברות נשמרים אצלנו רק בצורה מגובבת, ולתמונות יש כתובות אקראיות שאי אפשר לנחש. שום מערכת לא חסינה לגמרי. אם יקרה אירוע אבטחה חמור, נודיע עליו כמו שהחוק דורש.

**9. שינויים במדיניות**
אם נשנה את המדיניות, נעדכן את התאריך למעלה. על שינוי מהותי נודיע באתר.

**10. יצירת קשר**
{{email}}

## Verifier notes
One round (2026-11-15, against `main` 84b6fef), run by the orchestrator's fork against
`.claude/agents/spec-verifier.md` (a fork does not spawn agents). All 11 checks pass after these fixes,
applied above:
1. navigate before clearing the session, so `RequireUser` cannot bounce to login;
2. the static pages' states stated (check 6);
3. an RTL note: logical properties, and email addresses as LTR runs (check 5).

## Verifier findings (independent, 2026-11-15)
Against `main` 84b6fef. Checks 1–4 and 10 pass; the items below fail checks 5–8 and 11, and the legal text
is inaccurate in places. Each item: the check, what's wrong, the fix.
1. **Check 7 (PRODUCT.md).** The footer on `/` contradicts "Landing v2 (0009z, Gilad 2026-11-14, merged #83): …
   still no footer". The spec cites only Slice 9's "no footer until Slice 12". Fix: add a Digest decision
   for Gilad (recommend: the footer on every page including `/`, because sign-up starts there and the legal
   links must be reachable from it) and write his answer into PRODUCT.md before the build. The other option
   is to leave `/` out and put the three links in the closing band.
2. **Check 5 / AC7 (consent placement and the blocked code).** The login page's profile step has no
   send-code button. It is the verify step: the `profileNeeded` card, then `auth.verify`. On the sign-up
   page `askProfile` is true on both steps. Fix: name the placements: the sign-up request step above
   `auth.sendCode`; the login profile step under the `profileNeeded` card, above `auth.verify`. Say whether
   the sign-up verify step shows the line (recommend: no). Rewrite AC7 to match. Also,
   `signupBlocked` clears the consumed code as `suspended` does (`setCode('')`); add that to AC6.
3. **Legal accuracy: who sees the profile (privacy §1).** "השם מוצג לאנשים שאתם בקשר איתם" and "בשוק
   השותפים חלקם מוצגים … למפרסמי חדרים, אם בחרתם להופיע להם, ולמי שאתם פונים אליו" are wrong:
   - the one switch "show my card in שוק השותפים" shows the card (name, photo, age, gender, areas,
     move-in, answers, about me) to every other person in the market whose own card is visible, and to
     room listers (`services/market_people.py` docstring; PRODUCT.md "People & likes", 0010m);
   - a lister who says they live there shows their full card on the room page, to seekers;
   - a flatmate who chose to be shown appears on the room page;
   - in a room's chats, the flat's flatmates see the messages from the moment they joined;
   - an application sends the looking-part details to the owner (on a room: also gender, age and answers).

   Fix: rewrite those two bullets and the "פניות, הודעות ולייקים" bullet to name these audiences.
4. **Legal accuracy: §11 notice, the consequence of not giving data (privacy §2).** It says the other
   details are optional and only make matches less accurate. In fact applying to any listing needs the
   "what I am looking for" part (`services/applications.py` `ProfileRequiredError`; PRODUCT.md "Matching":
   "a seeker must have a profile to apply"). Browsing and liking people also needs your own visible card
   (0010m). Fix: say both.
5. **Legal accuracy: retention (privacy §5).** "עד שמוחקים אותה" is wrong: no route deletes a listing
   (`routers/listings.py`). A listing stays until the account is deleted, then as the unlinked record in §6.
   Several kinds of data have no retention line: messages and chats, applications, likes, price history
   and closure answers, and the blocked-email hash (kept indefinitely). Fix: drop "אותה או" and add one
   line for each.
6. **Legal accuracy: deletion vs 0013c (privacy §6, terms §9):**
   - (a) "ואי אפשר לשלוח בהן יותר" is wrong for a flatmate who deletes: the room chat stays open for the
     others (0013c Risks);
   - (b) applications that reached a chat are kept, withdrawn, with their message (0013c step 6), and
     the text doesn't say so;
   - (c) the text doesn't say that deletion leaves every joined flat and signs out every device;
   - (d) "בכל רגע" leaves out two conditions: deletion needs a sign-in from the last 15 minutes, and a
     suspended account cannot sign in, so it asks through `{{email}}`.

   Fix: amend those bullets.
7. **Voice (`design/brand/README.md`, never one gender).** "מי שדווח עליו לא יודע מי דיווח" (§1) and
   "ולמי שאתם פונים אליו" (§1) use the masculine singular. Fix: "מי שדווחו עליהם לא יודעים מי דיווח",
   "ולמי שאתם פונים אליהם".
8. **Check 6 / PRODUCT.md "Slice 9 copy + UX" (offline).** The dialog's failed state shows
   `profile.delete.failed` for a network error. Offline should show "אין חיבור לאינטרנט". Fix: offline →
   `common.offline`, as `OtpForm` does (`online ? … : t('common.offline')`); add it to AC3.
9. **Check 11 (blast radius).** Two gaps:
   - `Layout.test.tsx:314` asserts that `/search` has exactly the navigations
     `[side.label, nav.label]`, and the footer's `nav` breaks it;
   - `graphify affected "OtpForm"` also lists `ApplySection.test.tsx` and `JoinFlatPage.test.tsx` (both
     render the login form), and neither is named.

   Fix: list each with its change (314 gains `footer.label`) or the reason it is untouched.
10. **Check 8 (reviewers).** The spec changes the auth form (`signup_blocked`, the reauth logout → login),
    the chat display, and carries the privacy policy's PII claims. The rule says security for auth, chat
    and PII. Fix: `reviewers: [code, security, ux, qa]`, with security reading the reauth flow and the
    legal text against the code.

Applied by the orchestrator (2026-11-15):
1. Default: no footer on `/` (PRODUCT.md "Landing v2"); the landing gets two small links (`/terms`, `/privacy`) in one line after `<ClosingBand />` in `LandingPage.tsx`, with `ClosingBand.tsx` untouched. Scope, UI, AC8 (`/` joins the no-footer routes; `ac8_closing_no_footer`'s last block) and Blast radius follow. Digest decision 4 offers the footer on `/`, which needs a PRODUCT.md line. Risks note that 0016a is changing the landing now.
2. The consent line sits directly above `auth.verify` on the verify step that sends the profile: the sign-up verify step, and the login verify step under the `profileNeeded` card; none on the sign-up request step (`auth.sendCode`) or the plain login steps. Its links open a new tab (`common.newTab`) so the form keeps its email and code. AC7 rewritten. `signupBlocked` clears the code like `suspended` (Scope, AC6). Confirmed in `OtpForm.tsx`: the account is created by verify with `profile`.
3. Privacy §1 rewritten: the card's one switch and its two audiences (people in the market with a visible card; room listers' people page), the room page (a lister who lives there, shown flatmates, to signed-in seekers the room fits), what an application sends (`ApplicantOut`, `ApplicantProfileOut`, `ApplicantRoomOut`), chat audiences (flatmates from `joined_at`), likes and invites, the flat invite link. Confirmed in `market_people.py`, `people.py`, `schemas/search.py::FlatPersonOut`, `services/chat.py`.
4. Privacy §2: applying needs the "what I am looking for" part (`ProfileRequiredError`), a gendered room needs a gender, and the market's people and likes need your own visible card, which needs both parts (`schemas/profile.py`, 0010m).
5. Privacy §5: "אותה או" dropped (`routers/listings.py` has no delete route; pausing exists); lines added for photos, price history and the closure answer (cleared by a resume or renewal, `models/listing.py`), messages and chats, applications, likes and invites, and the blocked-email hash.
6. Privacy §6 and terms §9: the 15-minute sign-in and the suspended account's way to ask (`{{email}}`; Risks: no admin deletion tool); every joined flat left and every device signed out; applications with a chat kept as withdrawn with their message; owner, applicant and direct chats close while a room chat goes on without a deleted flatmate. Checked against 0013c's steps 5–12 and Risks.
7. "מי שדווח עליו לא יודע מי דיווח" → "זהות המדווחים לא נחשפת למי שדווחו עליהם"; the "פונים אליו" bullet is gone with finding 3. A full read for other masculine-singular forms also changed "לאף משתמש אחר", "לאף אחד", "מזהה הצופה", "זה לזה" (terms §4) and `accountDeleted.body`'s "מי שקיבל". "בעל מאגר המידע" stays: it is the statute's term for the operator.
8. The dialog's failed line is `common.offline` when offline (Scope, UI table, AC3).
9. Blast radius names `Layout.test.tsx:314` (gains `footer.label`; line 250 counts the banner only), `ApplySection.test.tsx` and `JoinFlatPage.test.tsx` (untouched: `LoginPage` outside `Layout`, request step only); Scope lists the tests that change. AC5's `MyFlatsPage.test.tsx` already exists.
10. `reviewers: [code, security, ux, qa]`, security reading the reauth flow, `signup_blocked` and the legal text against the code; the Digest follows.

## Digest (filled by orchestrator after verification)
Spec 0013f — Delete-account UI, deleted-member placeholders, footer, terms and privacy pages   (verified 2026-11-15; part 2 of 2, depends on 0013c)
What a user can do after this:
- delete the account from the profile (a confirm dialog, then a fresh sign-in if the session is old)
  and land on "החשבון נמחק";
- chats and "my flats" show "משתמש/ת שנמחק/ה" for a deleted account;
- every page but the landing and chat has a footer (תנאי שימוש · מדיניות פרטיות · יצירת קשר); the
  landing has the first two as small links under its closing band;
- the step that creates an account shows a consent line.
Decisions I need from you:
1. approve the drafted Hebrew terms of use and privacy policy (in the spec, "Legal text"), and fill the
   [placeholders]: the operator's name and ID, the email provider, the contact address, the date. Not
   legal advice; a lawyer's read before launch is advised;
2. age 18+ and Tel Aviv-Yafo courts in the terms (recommend: keep);
3. consent as a line above the button that creates the account, not a checkbox (recommend: the line now,
   a checkbox if the lawyer asks);
4. the footer on the landing `/`:
   - (a) no footer on `/`, which keeps your Landing v2 "still no footer"; the landing gets the two legal
     links under its closing band (default);
   - (b) the footer on every page, `/` included (the verifier's recommendation: sign-up starts there).
     This needs a PRODUCT.md line replacing "still no footer".
KPIs this slice moves: sign-up completion (consent line), trust.
Acceptance targets: NF1 the footer never sits under the mobile tab bar; NF2 no hardcoded copy, logical CSS only.
Risks:
- 0016a (landing polish, another chat) is changing the landing now: the second to merge reconciles
  `LandingPage.tsx` and its closing-band test;
- a suspended account cannot delete itself; the privacy text sends it to the contact address, and no
  admin tool deletes an account yet;
- production must set `VITE_CONTACT_EMAIL` (0013a's checklist).
Reviewers: code, security, ux, qa   Estimated: 1 coder run (Sonnet/high), 1 review round
Links: `specs/0013f-account-deletion-terms-web.md` · PRODUCT.md "Launch (Slice 13)" · `design/screens-v1/Main.dc.html` (footer)
