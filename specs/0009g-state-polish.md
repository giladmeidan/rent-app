---
id: 0009g
title: Nothing a person typed or saw is lost silently — an expired session goes to login and back with the apply and chat drafts kept, a retry shows it is working, a 404 is "not found" at once, and a card that leaves the view says why
status: done
depends_on: [0009t]   # 0009t: the focus rules this spec relies on (focusMainIfLost, the ErrorState retry rescue, the closed-chat note's focus target, MyLikesPage's section h2 after a successful unlike); via 0009t, 0009c: components/Loading.tsx, ErrorState's `page` prop, usePageTitle, RouteFocus and the axe e2e helper. All three touch ApplySection, ChatThreadPage, MyLikesPage and ErrorState, so they build in order (web specs never build at once locally, Speed rule 2)
reviewers: [code, qa, ux, security]   # security: the app-wide 401 handler (session clearing, the invite token) and private text kept in sessionStorage; ux: new states and copy; qa: session expiry and draft flows
estimate: 1 coder run   # coder Opus/high: session handling (Speed rule 6)
---

## Goal
After this ships:
- a session that expires on any signed-in page sends the person to `/login?next=…` and back, as `/me`
  already does, instead of a dead "משהו השתבש";
- the apply message and an unsent chat message survive that trip (and an apply that first needs the profile)
  in this tab's `sessionStorage`, for the same account only;
- `ErrorState`'s retry button shows that it is working and keeps focus;
- a 404 on an owner's applicants shows "not found" at once;
- an applicant card that leaves the current filter, and a liked room that vanishes from `/me/likes`, leave a
  line that says why;
- `/login` and `/signup` no longer flash an editable form while the session check runs, and a missing
  listing links back to search.

This is Dev Plan slice 9 ("polish"), the state half of `0009c` / `0009t`. It closes these `specs/FOLLOWUPS.md` lines
(numbers as of `8c3c480`): 16, 25, 46, 48, 79, 83, 85, 109, 119, 173, 182. No artboard covers these states.
The screens keep their layout; the screen specs (`0009i`–`0009s`) restyle them.

## Scope
**In:**

1. **Session end and retries** (FOLLOWUPS 48, 85, 173)
   - New `web/src/app/queryClient.ts` exports `createQueryClient(overrides?: { retryDelay?: number })`.
     `App.tsx` uses it in place of its inline `new QueryClient(...)`. The client has:
     - `queryCache: new QueryCache({ onError })`. When a **query** fails with `hasStatus(error, 401)`
       (`features/applications/api.ts`):
       - return at once if `client.getQueryData(ME_KEY) === null`: the session is already cleared. A burst
         of 401s (the header and the page together) then clears once, and `['search']`, `['search-map']`
         and `['listing']` are reset once. Every `GET /listings/{id}` counts a view (0004a);
       - otherwise call `clearSession(client, { keepInviteToken: query.meta?.keepInviteTokenOn401 === true
         })` (`features/auth/useLogout.ts`).

       Build note: the build subscribes to the query cache and acts on the final `updated`/`error` action instead of
       `QueryCache`'s `onError`, because `onError` runs after the dispatch that queues the page's re-render, so the
       page re-creates the per-user queries `clearSession` just removed (AC1 fails; confirmed by the code and
       security reviewers).

       `RequireOwner` / `RequireSeeker` / `RequireUser` then send the person to
       `/login?next=<this page>` (`loginWithNext`, unchanged). On public pages (the listing page's apply
       section) the logged-out state shows, as today. `useMe`'s own 401 is `null`, not an error, so it never
       triggers this. Mutations keep their own 401 handling (unchanged). The only 401s the API sends are
       "no or expired session":
       - `app/auth.py:23` `current_user` (`unauthenticated`);
       - `routers/events.py:69`;
       - `POST /auth/otp/verify` `invalid_code`. That one is a mutation, and `verifyCode` returns a result
         instead of throwing, so this handler never sees it.
     - `defaultOptions.queries.retry: (failureCount, error) => failureCount < 1 && !(error instanceof
       ApiError && error.status >= 400 && error.status < 500)`. Only network errors and 5xx get the one retry
       they get today, and a 404 or 409 page state shows about a second sooner. `useMe` keeps its
       `retry: false`. `retryDelay` comes from `overrides` (tests pass 0); the default is TanStack's.
   - `features/flatmates/api.ts:149` `useInvitePreview` gains `meta: { keepInviteTokenOn401: true }`. Its 401
     is the join page's trip through login, which 0008e A1 is built for (`JoinFlatPage.tsx:140-142`), and the
     stashed token must survive it.
   - The per-hook 401 effects (`useMyApplications`, `useProfile` and similar) stay. They are harmless, and
     removing them is not this spec's job.
   - `ApplicantsPage.tsx`, on a **404** from `GET /listings/{id}/applications`:
     - `MY_LISTINGS_KEY` is invalidated once per listing id (a ref keyed on `id`);
     - when no applicants are cached (`applicants.data === undefined`), the page renders the not-found
       branch: `BackToMine`, the `<h1>` `applicants.notFound`, and `usePageTitle(t('applicants.notFound'))`
       (`0009c`), as for an id missing from my listings;
     - when cards are cached, they stay, as `PeoplePage.tsx:117` keeps its cards, and the my-listings refetch
       flips the page to not-found if the listing is gone.
     A 401 is the global handler's.

2. **`ErrorState` busy retry** (FOLLOWUPS 16), `web/src/components/ErrorState.tsx`
   - `onRetry: () => unknown`. When it returns a promise, the button gets `aria-disabled="true"` and
     `aria-busy="true"` until the promise settles, and a click while pending does nothing. It is **not**
     `disabled`: disabling the focused button drops focus to `<body>` in browsers, which would break
     `0009t`'s retry focus rule. This is the kit's `Button busy` contract (`0009d`), so use `Button busy`
     when `0009h`'s kit-based `ErrorState` has merged first.
   - The query call sites pass `() => query.refetch()` in place of `() => void query.refetch()`. Find them
     with `grep -rn "<ErrorState" web/src`, which also catches the multi-line ones at `ProfilePage.tsx:471,
     514`. `ResultsList.tsx:89` returns `fetchNextPage()`.
   - The non-query sites keep their void handlers and get no busy state: `OtpForm.tsx:313`,
     `ApplySection.tsx:200`, `JoinFlatPage.tsx:266`, `PreviewStep.tsx:53`. `features/areas/AreasList.tsx` is
     `0009a`'s, so leave it.
   - Accepted behaviour: the app keeps `networkMode: 'always'` (0009f), so while the device is offline a refetch
     fails at once and the button leaves its busy state. The offline text is `0009f`'s (`useOnline`).

3. **Drafts** (FOLLOWUPS 79, 109, 119)
   - New `web/src/app/drafts.ts`. The store is `sessionStorage`, one entry per draft:
     - key: `rent-app:draft:{kind}:{id}`, where `kind` is `'apply'` (id: the listing's) or `'chat'` (id:
       the conversation's);
     - value: JSON `{ "userId": string, "text": string }`;
     - exports:
       - `readDraft(kind, id, userId): string` returns `''` when there is no draft, it is malformed, or
         another user wrote it;
       - `writeDraft(kind, id, userId, text)`: an empty or all-whitespace `text` removes the entry;
       - `clearDraft(kind, id)`, `clearAllDrafts()`, `clearDraftsExcept(userId)`;
     - every storage call is in `try/catch`. Private modes may throw, and then drafts silently do nothing.
       With `userId` undefined, nothing is read or written.
   - Who clears drafts:
     - `useLogout`'s `onSuccess` calls `clearAllDrafts()`. Only an explicit logout does this.
     - `clearSession` does **not**. It also runs on a 401, which is exactly when a draft must survive.
     - `OtpForm`'s verify success calls `clearDraftsExcept(result.user.id)`, so a different person logging
       in on this tab never inherits another person's text.
   - `web/src/test-setup.ts`: add `window.sessionStorage.clear()` to the `afterEach`. Otherwise drafts typed in
     one test leak into the next.
   - `ApplySection.tsx` `ApplyForm`:
     - It receives `listingId` and `userId` props. `ApplySection` has both: `listing.id` and `me.data.id`,
       which is set wherever the form renders.
     - On mount it calls `readDraft('apply', listingId, userId)`. A non-empty draft opens the form with that
       text, **without moving focus**: the `open` effect at `ApplySection.tsx:68-70` focuses the textarea
       only when the person opens the form (a ref skips the initial mount). Otherwise every visit with a
       draft would jump to the textarea, open the mobile keyboard and fight `0009c`'s `RouteFocus`.
     - Every change calls `writeDraft`.
     - These clear the draft: Cancel; a 201 (in `useApply`'s `onSuccess`); a 404 "unavailable"; and the
       final 409s `already_applied` and `room_gender_mismatch` (in `useApply`'s `onError`).
     - These keep it: `seeker_profile_required` and `seeker_gender_required` (the person comes back through
       `?next`), a 401 (login and back), a reload, and closing the form with the apply toggle instead of
       Cancel. The next mount then opens it with the text.
   - Chat:
     - `ChatThreadPage` calls `useMe()`, which `RequireUser` guarantees, and passes `userId` to `Thread` and
       `Composer`.
     - `Composer.tsx`: the textarea's initial value is `readDraft('chat', conversationId, userId)`. An effect
       on `text` writes the draft. The viewing chip (`Composer.tsx:69-77`) sets the text without `onChange`,
       so "on change" alone would miss it.
     - `useSendMessage`'s hook-level `onSuccess` clears the draft. Composer's `mutate` callback would not
       fire if the composer unmounted mid-send, and a send can land while the chat closes.
     - The `Removed` and not-found branches of `ChatThreadPage` clear that conversation's draft.
     - `Thread`, during render whenever `can_send` is false, reads `readDraft('chat', id, userId)`; a draft
       read once at mount would still be empty after the 409. If it is non-empty and a local `discarded`
       flag is false:
       - under the closed note, show `chat.thread.unsent` and the text, read-only: a `<p>` with
         `dir="auto"`, `whitespace-pre-wrap` and `break-words`, text node only;
       - also show a button `chat.thread.discardDraft`. It clears the draft, sets `discarded`, and moves
         focus to the closed `role="status"` note, which `0009t` makes focusable; the button that had focus
         is gone;
       - `discarded` resets when `can_send` turns true again, and `Composer` then restores the text.

4. **Cards that leave the view** (FOLLOWUPS 83, 182)
   - `ApplicantsPage.tsx`:
     - The always-mounted `<p role="status">` moves from the section's last child (`ApplicantsPage.tsx:302`)
       to one fixed slot, right after the `gone` alert and before `{body}`, rendered unconditionally so it
       never remounts and loses its announcement.
     - When the outcome is `changed` and the updated card no longer matches the filter
       (`!matches(filter, updated)`), its text is `applicants.movedOut` (`{{name}}`, `{{status}}`, filled as
       `statusChanged` is). It drops `sr-only` and shows as a muted line (`text-body-sm text-ink-muted`).
     - In every other case it keeps today's `sr-only` `statusChanged` text.
     - A filter change clears it. A sort change does not.
     - One region carries both texts, so nothing is announced twice.
   - `features/likes/LikeRoomButton.tsx` gains an optional prop `onGone?: (reason: 'gone' |
     'alreadyApplied') => void`:
     - it is called from the `mutate(…, { onError })` callbacks in `onClick`: a 404 (like or unlike) gives
       `'gone'`, a 409 `already_applied` gives `'alreadyApplied'`;
     - when `onGone` is passed, the button does **not** render its own `problem === 'gone'` alert
       (`LikeRoomButton.tsx:98-102`). Otherwise two identical alerts would show until the refetch.
   - `MyLikesPage.tsx` passes `onGone` and keeps `{ reason, tick }` in page state; the tick makes the same
     reason twice focus again. It renders the alert as `PeoplePage.tsx:55-73` does:
     - the region is always mounted, with `tabIndex={-1}`, under the `<h1>`;
     - when set, it takes focus and `scrollIntoView({ block: 'center' })`;
     - `'gone'` shows `likes.errors.gone`;
     - `'alreadyApplied'` shows `likes.errors.alreadyApplied` with a link to `/me/applications`
       (`applications.viewMine`);
     - setting it clears `mutualId`, and a mutual clears it.

     Focus precedence with `0009t` Scope 1: after a **failed** like or unlike (404 / 409), this line takes
     focus; the section `<h2>` takes it only after a **successful** unlike. The listing page passes no
     `onGone` and behaves as today.

5. **Small states** (FOLLOWUPS 25, 46)
   - `LoginPage.tsx` and `SignupPage.tsx`: while `me.isPending`, render the page's `<h1>` and `<Loading><Skeleton
     /></Loading>` (`components/Loading.tsx`, from `0009c`), not the form.
   - `ListingPage.tsx` not-found branch (404/422): under the `<h1>`, a link `listing.toSearch` → `/search`,
     with `min-h-[44px]` and the focus ring, styled as `MyApplicationsPage`'s empty-state link.

6. **`web/src/locales/he.json`** (new keys only; `0009b` owns the wording of existing keys):

   | Key | Hebrew |
   | --- | --- |
   | `applicants.movedOut` | "{{name}}: {{status}}. כדי לראות את הכרטיס, בוחרים בסינון הכול." |
   | `chat.thread.unsent` | "ההודעה שלא נשלחה:" |
   | `chat.thread.discardDraft` | "מחיקת ההודעה" |
   | `listing.toSearch` | "חיפוש דירות וחדרים" |

   None is count-dependent. `applicants.movedOut` takes `applicants.status.*`, as `statusChanged` does, so
   `0009b`'s gender fix to those chips flows through.

**Out:**
- Offline text in `ErrorState` (FOLLOWUPS 17): `0009f` (`useOnline`).
- `MyListingsPage`'s cached list on a failed refetch (FOLLOWUPS 84): `0009k`.
- The verifier split off the "show more" clamp and same-name chat senders; the orchestrator (2026-11-12)
  placed them without a new spec:
  - the applicant message clamp (FOLLOWUPS 72) → `0009l`, which restyles the inbox card;
  - the chat member line's "show all" (193) → `0009q`;
  - same-name sender runs (194) need `MessageOut.sender_key`, an API field. They stay in FOLLOWUPS as "not
    small".
  `common.showMore` / `common.showLess` and `ClampedText` are therefore not in this spec.
- The wording of existing keys (`0009b`); the accessibility baseline (`0009c`) and focus after actions, announcements and the map (`0009t`); desktop
  layouts and colour tokens (`0009d` / `0009h`); the landing and the header (`0009a`).
- A count in the 409 `already_applied` body (FOLLOWUPS 78), `ConversationOut.status` for a withdrawn seeker
  (FOLLOWUPS 111), and leave guards on the listing wizard (FOLLOWUPS 35, a product call).
- Drafts for the listing wizard and the profile form. They are long forms that a session rarely outlives
  mid-edit, and the edit wizard already guards unsaved changes on reload (PRODUCT.md "Listing edit").
- Removing the now-redundant per-hook 401 effects.

**New dependencies:** none.

## Data
None. No table or migration. `sessionStorage` holds drafts in the browser tab only.

## API
None. Web only: no endpoint changes.

## UI
No new screen. States added to existing ones:
- **any signed-in page, 401 on a query**: redirect to `/login?next=<path+query>`. After login, the page loads
  again. `/flatmates/join` keeps its stashed token through it.
- **`ErrorState`**: retrying (`aria-disabled`, `aria-busy`, still focused) and done.
- **`/listings/:id`**: the apply form reopens with the saved text, not focused. The not-found state gains a
  link to search.
- **`/chat/:id`**: the composer text is restored. A closed chat shows the unsent text and a discard button,
  which moves focus to the closed note.
- **`/me/listings/:id/applicants`**: a first-load 404 is not-found, and cached cards stay on a background
  404. A card leaving the filter leaves a visible line.
- **`/me/likes`**: a focused page-level line when a card vanishes after a failed like or unlike.
- **`/login`, `/signup`**: a busy skeleton while `/me` is pending.

RTL: logical classes only. The unsent text keeps `dir="auto"`. Touch targets ≥ 44 px.

## Acceptance criteria
- [ ] AC1 With `createQueryClient({ retryDelay: 0 })` and `AppRoutes`:
  - given an owner on `/me/listings/L/applicants` and `GET /listings/L/applications` answering 401: `['me']`
    is `null`, no `['me', …]` query is cached, and the router is at
    `/login?next=%2Fme%2Flistings%2FL%2Fapplicants`;
  - given a seeker on `/me/likes` whose `GET /me/likes` answers 401: the same, with `next=%2Fme%2Flikes`;
  - given `/flatmates/join` with a stashed invite token and the preview answering 401: the router is at
    `/login?next=%2Fflatmates%2Fjoin` and `readInviteToken()` still returns the token;
  - given a seeker on `/listings/L` where two queries answer 401 in one render: `GET /listings/L` is
    requested at most once after the session clears.

  — `web/src/app/__tests__/queryClient.test.tsx::ac1_query_401_ends_session`
- [ ] AC2 With `createQueryClient({ retryDelay: 0 })`, a query answering 404 calls its `queryFn` once, one
  answering 500 calls it twice, and one throwing `TypeError` (network) twice. — `queryClient.test.tsx::ac2_no_retry_on_4xx`
- [ ] AC3 Given L in my listings:
  - `GET /listings/L/applications` answering 404 on first load shows `applicants.notFound` as the `<h1>` with
    the back link, and `GET /me/listings` is requested again;
  - with cards shown, a background refetch answering 404 keeps the cards and requests `GET /me/listings`
    once; when that answer no longer has L, the page shows not-found.

  — `web/src/features/applicants/__tests__/ApplicantsPage.test.tsx::ac3_applicants_404_not_found`
- [ ] AC4 `ErrorState` with an `onRetry` returning an unresolved promise. After a click, the button:
  - has `aria-disabled="true"` and `aria-busy="true"`;
  - is still `document.activeElement`;
  - ignores a second click (`onRetry` called once);
  - is plain again once the promise resolves.

  With a void `onRetry`, the button never turns busy. — `web/src/components/__tests__/ErrorState.test.tsx::ac4_busy_retry_keeps_focus`
- [ ] AC5 Drafts store:
  - `writeDraft('apply','L','U','שלום')`, then `readDraft('apply','L','U')` is `'שלום'`;
  - `readDraft('apply','L','V')` is `''`;
  - `writeDraft(…, '  ')` removes the entry;
  - `clearDraftsExcept('U')` removes V's entries and keeps U's;
  - a `sessionStorage` whose `setItem` throws makes `writeDraft` a no-op and `readDraft` return `''`.

  — `web/src/app/__tests__/drafts.test.ts::ac5_drafts_store`
- [ ] AC6 Apply draft:
  - a seeker opens the form and types, the POST answers 401, and the session clears. Rendered again as the
    same seeker, the form is open with the typed text, and the textarea is **not** `document.activeElement`;
  - the same after a 409 `seeker_profile_required` (the profile gate shows), followed by a profile in the
    cache;
  - Cancel, a 201, a 409 `already_applied` and a 409 `room_gender_mismatch` each leave `readDraft` returning
    `''`;
  - a different user id sees an empty, closed form.

  — `web/src/features/applications/__tests__/ApplySection.test.tsx::ac6_apply_draft_survives_401_and_profile_gate`
- [ ] AC7 Chat draft:
  - text typed in the composer is there after the thread remounts (a 401, then back);
  - a thread mounted with `can_send: true`: type, send, the send answers 409 `chat_closed`, and the refetch
    answers `can_send: false`. The closed note is followed by `chat.thread.unsent` and the text. "מחיקת
    ההודעה" removes it and the stored draft, and focus is on the closed note;
  - with `can_send` true again, the composer holds the text (when it was not discarded);
  - a 201 clears the draft;
  - the `Removed` state clears it;
  - `useLogout` success leaves no `rent-app:draft:` entry.

  — `web/src/features/chat/__tests__/ChatThreadPage.test.tsx::ac7_chat_draft`, `web/src/features/listings/__tests__/logout.test.tsx::ac7_logout_clears_drafts`
- [ ] AC8 Login clears other people's drafts: given a stored draft of user V, a verify that logs in user U
  leaves no V draft and keeps U's. — `web/src/features/auth/__tests__/OtpForm.test.tsx::ac8_login_clears_other_users_drafts`
- [ ] AC9 Under the filter "new", shortlisting applicant A (PATCH 200 `shortlisted`):
  - the card leaves the list;
  - the `role="status"` line, before the list in DOM order and visible, reads `applicants.movedOut` filled
    with A's name and `applicants.status.shortlisted` (the expected text is built from `he.json`);
  - a sort change keeps it, and choosing the filter "all" clears it;
  - under "all", the same action keeps the line `sr-only` with `statusChanged`.

  — `ApplicantsPage.test.tsx::ac9_card_leaving_filter_is_explained`
- [ ] AC10 On `/me/likes`:
  - an unlike answering 404 shows `likes.errors.gone` once, under the `<h1>`, focused, after the refetch
    drops the card;
  - a like answering 409 `already_applied` shows `likes.errors.alreadyApplied` with a link to
    `/me/applications`, focused;
  - a successful unlike focuses the section `<h2>` (`0009t`), not this line;
  - on the listing page `onGone` is not passed and today's behaviour holds (the existing tests pass).

  — `web/src/features/likes/__tests__/MyLikesPage.test.tsx::ac10_vanished_card_is_explained`
- [ ] AC11 While `/me` is pending, `/login` and `/signup` show their `<h1>` and a busy skeleton, and no email
  field. The listing page's not-found state has a link "חיפוש דירות וחדרים" to `/search`. —
  `web/src/features/auth/__tests__/LoginPage.test.tsx::ac11_skeleton_while_me_pending`,
  `SignupPage.test.tsx::ac11_skeleton_while_me_pending`, `web/src/features/listings/__tests__/ListingPage.test.tsx::ac11_not_found_links_to_search`
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green on the
  final head (Speed rule 7), with `0009c`'s axe checks still passing. The e2e result goes in the digest.

## Tests to write
- Unit:
  - `queryClient.test.tsx` (AC1–AC2): renders `AppRoutes` with `createQueryClient({ retryDelay: 0 })` and a
    stubbed `fetch`;
  - `drafts.test.ts` (AC5);
  - `ErrorState.test.tsx` (AC4);
  - the page cases named above, in the existing test files.

  Hebrew test strings use `\uXXXX` escapes, as the listings fixtures do.
- E2E: none new. Each draft flow needs a second login, which spends OTP budget (`Makefile` `e2e`, 3 shards ≈
  25 sign-ups). The unit tests cover it, and the existing suite must stay green (NF1).

## Risks / open questions
- **App-wide 401.** Every query 401 now ends the session. Today the API answers 401 only for no or expired
  sessions (Scope 1), so nothing logs a person out wrongly. A future endpoint must keep that meaning, or opt
  out with `meta`. Security should confirm. The invite token is kept on the join preview (`meta`), and
  mutations are unchanged.
- **Drafts in `sessionStorage`.** A draft is private text left in the tab until it is sent, cancelled or
  discarded, the person logs out, or the tab closes. It is bound to the user id and removed when anyone else
  logs in on the tab. Nothing reaches another tab or device.
- **Overlaps.** Coordinated in the shared planning notes:
  - `0009f` changes `ErrorState`'s message line (offline). This spec changes the button (busy), and
    `0009c` adds `page`.
  - `0009q` restyles `LikeRoomButton` and `MyLikesPage`.
  - `0009l` restyles the inbox.
  - `0009s` restructures the chat routes.
  - `0009m` restyles `LoginPage`, `SignupPage` and `OtpForm`.
  Each is behaviour, not layout; the second PR to merge rebases.
- Split history:
  - the author pre-split this file from `0009c`;
  - verifier round 1 split off Scope 6–7 (show-more and `sender_key`), which the orchestrator gave to
    `0009l` / `0009q` and FOLLOWUPS;
  - `0009c`'s own verifier split off `0009t`, which this spec now depends on.
- Verifier round 1: 23 findings, all applied (3 and 4 by removing the duplicates; 15, 16, 20 and 21 went
  with the split-off part, which no longer exists as a spec; their substance is passed to `0009l` / `0009q`
  in the shared notes). Second round waived.
- Brand amendment (2026-11-12): token names and the new copy follow `specs/0009-brand-amendment.md`. This
  was applied as a spec edit, without re-running the verifier:
  - `applicants.movedOut` now says what happened, then what to do;
  - `listing.toSearch` is an action-noun link;
  - no slash forms.
- No open product questions.

## Digest (filled by orchestrator after verification)
See `/digest`.
