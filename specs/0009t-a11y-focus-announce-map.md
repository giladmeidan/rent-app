---
id: 0009t
title: After an action removes the control a person used, focus lands on what replaced it — apply, withdraw, unlike, remove, leave, a filter change, a closing chat, a resend or a successful retry; saved, joined and resend lines are announced; and the search map is one labelled landmark with its loading, empty and error states in view
status: done
depends_on: [0009c]   # 0009c: components/Loading.tsx, ErrorState's `page` prop, RouteFocus and #main (the focus fallback), the accent focus-ring rule and the axe e2e helper, whose map-landmark exemption this spec removes
reviewers: [code, qa, ux]   # ux: focus targets, announcements, map states; qa: keyboard and screen-reader flows at 390 px, the map e2e. No security: chat only mounts its log earlier and focuses the closed note (message bodies stay text nodes), and OtpForm gains a status line and a focus call (request and verify untouched). No perf: no query change
estimate: 1 coder run   # coder Opus/high: many small focus targets whose timing is easy to get wrong (Speed rule 6). Verifier: upper end (~3.5 h); if a split is ever needed, Scope 3 + AC5 + AC6 (the map) is the seam
---

## Goal
After this ships:
- when an action removes the control a person used, focus lands on what replaced it, not on `<body>`. This
  covers:
  - an apply (201, the swapping 409s, 404);
  - a withdraw (200, 409, 404);
  - an unlike;
  - a flatmate removal, and leaving a flat;
  - a final join error;
  - a filter Apply or Clear;
  - "show the list" on a failed map;
  - a chat closing under the composer;
  - an OTP resend;
  - a successful retry;
- "השינויים נשמרו", "הפרופיל נשמר", "הצטרפת לדירה", a code resend and the end of the resend cooldown are
  announced, and a new chat's first pushed message is read out;
- the search map is one labelled landmark. Its empty and error states sit above the 60vh map at 390 px, the
  empty text is announced, and a pill shows while results update.

This is Dev Plan slice 9 ("polish"), split off `0009c` by its verifier. It closes these `specs/FOLLOWUPS.md`
lines (numbers as of `8c3c480`): 23, 52, 55, 73, 74, 75, 76, 123, 149, 184; the build ticks them as done.
There are no artboard changes. The only new visible piece is the map pill, in the existing tokens.

## Scope
**In:**

1. **Focus after an action removes its control** (FOLLOWUPS 55, 76, 149, 184 and `0009c`'s sweep)
   - New `web/src/components/focus.ts` exports `focusMainIfLost()`. It sits in `components/` so `ErrorState`
     does not import from `app/`. On the next animation frame, if `document.activeElement` is `null` or
     `<body>`, it focuses `#main` with `preventScroll: true`. It is the fallback whenever a target below is
     not in the DOM.
   - Each target gets `tabIndex={-1}` and `focus:outline-none` unless it is focusable already. Each is
     focused in an effect after the render that shows it.
   - **Apply** (`ApplySection.tsx`; FOLLOWUPS 76, 149):
     - `ApplySection` owns `submitted = useRef(false)`. `ApplyForm` gets `onSubmitted` and calls it in `send`
       (`:72`) before `apply.mutate`. A ref inside `ApplyForm` would not do, because every 409 swap unmounts
       `ApplyForm`.
     - `ApplySection` names the branch it renders (`'form' | 'applied' | 'misfit' | 'roomGate' |
       'profileGate' | …`). A `useEffect([branch])` runs when `submitted.current && branch !== 'form'`. It
       focuses the first `<p>` of whichever branch replaced the form, then clears the ref:
       - after a 201 it is the `role="status"` line `applications.sent` (`:326`);
       - after a 409 `room_gender_mismatch` it is the misfit `<p>`;
       - after a 409 `seeker_gender_required`, which refetches profile and listing (`useApply.ts:49-53`), it is
         `RoomGate`'s paragraph, or the misfit line when the refetch answers `room_fit: false`;
       - after a 409 `seeker_profile_required` it is `ProfileGate`'s paragraph;
       - after a 409 `already_applied` it is the `Applied` block's first `<p>` (`:228-238`).
         `applications.sent` renders only on `apply.isSuccess`, so it is not this line.

       A branch already shown on mount, with no submit in this tab, takes no focus.
     - The 404 alert (`applications.errors.unavailable`) lives inside `ApplyForm` (`:125-131`). `ApplyForm`
       focuses it in an effect on `unavailable`.
   - **Withdraw** (`MyApplicationsPage.tsx`):
     - a 200 focuses that card's title link (the `<Link>` in the `<h2>`);
     - a 409 `not_withdrawable` refetches, and the new status (for example `declined`) hides the button
       (`:89-112`). Focus moves to the card's alert `<p>` (`tabIndex={-1}`) once the refetch lands. `0009f`
       rewords that alert at `:114-118`;
     - a 404 drops the card, so call `focusMainIfLost()`.
   - **Unlike** (`MyLikesPage.tsx`; FOLLOWUPS 184): `LikeRoomButton` gains `onUnliked?: () => void`. It is
     passed in `unliking.mutate(undefined, { onSettled, onSuccess })` in `onClick`, the same mutate
     callbacks `0009g`'s `onGone` uses. `MyLikesPage` passes it and focuses the section `<h2>` `#likes-mine`.
     - A like from "liked me" that comes back non-mutual (the lister unliked meanwhile) moves the card to
       "mine". Focus `#likes-mine` then as well.
     - A **failed** like or unlike never focuses the `<h2>`. `0009g`'s page line takes focus then.
   - **Edit, not found** (`EditListingPage.tsx`; FOLLOWUPS 55): an effect on `notFound` (`listings.data !==
     undefined && listing === undefined`), as the `readOnly` effect at `:28-30` works, focuses the not-found
     `<h1>` (`:55`). That covers a save answering PATCH 404 (`ListingWizard.tsx:265-269` drops the listing
     from the cache) and a direct arrival. It runs after `0009c`'s `RouteFocus`, so it wins.
   - **Join** (`JoinFlatPage.tsx`): when a final 4xx removes the join button, the failure `<p>` (`:260-264`)
     takes focus. A final 4xx mapped to `'other'` (an unknown 409 detail) renders no `<p>`, so call
     `focusMainIfLost()`.
   - **Flatmates and flats**: after removing a flatmate, focus `FlatmatesPage`'s list `<h2>`
     (`listTitleId`). After leaving a flat, focus `MyFlatsPage`'s `<h1>`.
   - **Filters** (`SearchPage.tsx` / `FiltersForm.tsx`): after an Apply or Clear that **changed the URL**,
     focus the results count line, which is `ResultsList.tsx:110`, or `SearchMap.tsx:95` in map view.
     - The `key={searchParams.toString()}` remount destroys the button only when the URL changes. An Apply
       with unchanged filters keeps the button and its focus.
     - The mechanism: `SearchPage` sets a ref flag in `apply` / `clear` when the new query string differs. It
       passes a `countRef` to `ResultsList` / `SearchMap` and focuses it in an effect after the remount.
     - What the focused line shows meanwhile is accepted:
       - in list view it may be empty while the new query is pending, and the `aria-live` line reads the
         count when it lands;
       - in map view it shows the **previous** count, because `useMapSearch.ts:16` keeps `placeholderData`,
         until the answer replaces it.
     - `ResultsList`'s empty-state Clear does the same.
   - **Map "show the list"** (`SearchMap.tsx:101`, map unavailable): `ViewToggle` gets
     `listButtonRef?: Ref<HTMLButtonElement>`. `SearchPage` sets a flag in `onShowList` and focuses the list
     button (now `aria-pressed`) in the effect after the switch.
   - **Chat closing** (`ChatThreadPage.tsx`):
     - `Thread` records `composerHadFocus` on the composer form's `onFocus`. It clears the ref only on an
       `onBlur` whose `relatedTarget` is a non-null element outside the form. `Composer.tsx:117` disables
       the send button while pending, so after a click focus is already on `<body>` when `can_send` flips;
       a ref cleared on every blur would miss that.
     - An effect on `can_send` going true → false focuses the closed `role="status"` note
       (`tabIndex={-1}`) when the ref is set. `0009g`'s discard button also targets this note.
   - **OTP resend** (`OtpForm.tsx`): a 200 resend starts the cooldown, which disables the focused resend
     button for 30 s (`:393`). On a resend 200, focus the code input (`codeRef`), as entering step 2 does.
     The button stays `disabled`, because `OtpForm.test.tsx:39-53` pins `toBeDisabled()`.
   - **`ErrorState` retry rescue**, when it unmounts after a successful retry while its button was focused:
     - a `hadFocus` ref is set in the button's `onFocus` and cleared in `onBlur`;
     - a `useLayoutEffect` cleanup calls `focusMainIfLost()` when `hadFocus.current ||
       document.activeElement === button`. The ref keeps the rescue working when the browser drops focus
       without a `blur`;
     - an `ErrorState` that unmounts while focus is elsewhere does nothing. Typing in `ApplyForm` clears
       `serverErr`, and focus stays in the textarea;
     - in-form retries unmount the box at once, so focus reaches `#main` before the outcome:
       - `ApplyForm`'s retry (`ApplySection.tsx:200`) first focuses its textarea, then calls `send`;
       - the others (`ProfilePage.tsx:471`, `OtpForm.tsx:313`, `JoinFlatPage.tsx:266`) accept `#main`.

2. **Announced states** (FOLLOWUPS 23, 52, 123 and the sweep)
   - A `role="status"` line that appears after an action is either **always mounted and filled after mount**
     or **takes focus** (section 1), never both. Otherwise it would be read twice.
   - `MyListingsPage.tsx:179`, "השינויים נשמרו" (FOLLOWUPS 52):
     - read `location.state.saved` once into component state;
     - clear the history entry with `navigate(location.pathname + location.search, { replace: true, state:
       null })`, as `ChatListPage.tsx:121` does, so a reload or a Back does not show it again;
     - the `<p role="status">` is always mounted and **starts empty**. Its text is set one frame after mount
       (`useEffect` → `requestAnimationFrame` → `setState`), so it is not mounted in the same commit as its
       text;
     - a pause or resume clears it: `ListingRow` gets `onChanged`, called from its patch's `onSuccess`.
   - `ChatListPage.tsx:170-174`, `flatmates.join.done`: the same pattern, empty on mount and filled a frame
     later.
   - `ProfilePage.tsx:485-488`, "הפרופיל נשמר" (FOLLOWUPS 123): an in-page save.
     - Keep today's conditional mount (`saved &&`) and add `ref`, `tabIndex={-1}` and `focus:outline-none`.
     - Focus it in an effect on `saved`, but only when no `next` navigation follows (`safeNext(
       params.get('next')) === '/'`). Focusing also scrolls it into view at 390 px.
     - It is not also made always-mounted, because it would then be announced twice.
   - `ChatThreadPage.tsx:159`, `role="log"`: mounted whenever the thread is shown, with an empty `<ol>` and
     `chat.thread.empty` outside it. Today it mounts with the first message, so a first pushed message is
     never announced.
   - `OtpForm.tsx` (FOLLOWUPS 23): one sr-only `<p role="status">`, in the verify step's form from that
     form's first render:
     - `auth.codeResent` after a successful resend (focus also moves, see section 1);
     - `auth.resendReady` when the cooldown reaches 0;
     - empty otherwise.

     The visible countdown label stays non-live, so it is not read every second. The disabled submit's hint
     (FOLLOWUPS 24) is `0009f`'s.

3. **Map** (FOLLOWUPS 73, 74, 75), `features/search/SearchMap.tsx` and `components/map/MapCanvas.tsx`
   - **One landmark.** MapLibre 6.16 gives the canvas `tabindex = interactive ? '0' : '-1'`, `role="region"`
     and an `aria-label` (`maplibre-gl` `src/ui/map.ts:4189-4191`). After construction, `MapCanvas` rewrites
     the canvas:
     - interactive map: `role="application"` in place of `role="region"`, keeping `aria-label` `map.title`.
       The pan and zoom keys keep working in screen-reader focus mode, and `application` is not a landmark;
     - `interactive={false}` (the listing page's small map): remove `role` and `aria-label`, set
       `aria-hidden="true"`, and **keep `tabindex="-1"`**, so axe's `aria-hidden-focus` never trips. The
       region's label and the page's street text carry it.

     The wrapper `<div role="region" aria-label={label} aria-busy>` stays the only landmark. MapLibre gives
     custom markers no role (`marker.ts:989-992`), so the pin buttons are unchanged. Remove `0009c`'s
     map-landmark axe exemption, if one was added.
   - **States above the fold.**
     - `ErrorState` renders between the count line and the map, not under the 60vh map.
     - The empty state **is** the count line: the same always-mounted `<p aria-live="polite">`
       (`SearchMap.tsx:95`) holds `search.map.empty` when `total` is 0, and carries `EmptyState`'s box
       classes while it does.
     - `components/EmptyState.tsx` exports its class string (`emptyStateBox`), so the count line reuses it,
       and `0009h`'s restyle of `EmptyState` reaches it.
     - No separate `EmptyState` renders, at any width.
     - On `0009i`'s desktop split, the column renders nothing when `total` is 0 and keeps `ErrorState`, which
       sits beside the map and is already above the fold. Whichever of `0009i` and `0009t` merges second
       updates `0009i`'s `ac5_desktop_split` empty assertion to read the count line.
     - `/search` never has a second `aria-live` region, because `0009i`'s e2e selectors are strict.
   - **Visible loading.** `MapCanvas` gains `overlay?: ReactNode`, rendered inside its existing `relative`
     root only while its private `loaded` is true. `SearchMap` passes it while `search.isPending ||
     search.isPlaceholderData`:
     - a pill at the top centre: `pointer-events-none absolute top-3 inset-x-0 z-10 mx-auto w-fit
       rounded-full border border-border bg-surface px-3 py-1.5 text-label text-ink` (brand: no shadows; a `border`
       separates it from the tiles). MapLibre's control corners are
       `z-index: 2` and the selected marker `1`. `pointer-events-none` leaves the pins and the pan surface
       under it usable;
     - its text is `search.map.updating`, with `aria-hidden="true"` and `data-testid="map-updating"`. The pill
       is visual only: the count line's update is the announcement, and `aria-busy` is not spoken;
     - no animation.

     The fake canvas (`components/map/__tests__/fakeMapCanvas.tsx`) renders `props.overlay`.

4. **Existing assertions that flip.** Each is replaced, none deleted:
   - `SearchMap.test.tsx:241-246` (empty: a separate text and an empty count line) → the count line holds
     `search.map.empty`. The comment at `:227` ("ErrorState under the map") → above the map;
   - `ChatThreadPage.test.tsx:144-146` (an empty thread has no `log`) → an empty `log` exists;
   - `EditListingPage.test.tsx:294` (a sync `getByText(saved)` right after the navigation) → `findByText`,
     since the text lands a frame later.

5. **`web/src/locales/he.json`** (new keys only; `0009b` owns the existing wording):

   | Key | Hebrew |
   | --- | --- |
   | `auth.codeResent` | "שלחנו קוד חדש" |
   | `auth.resendReady` | "אפשר לשלוח קוד חדש" |
   | `search.map.updating` | "התוצאות מתעדכנות…" |

   None is count-dependent.

**Out:**
- The baseline (skip link, route focus, titles, headings, `Loading`, focus rings, touch targets, motion, the
  axe check): `0009c`.
- Error, session, draft and vanished-card states: `0009g`. `0009g`'s `MyLikesPage` line takes focus after a
  *failed* like or unlike; this spec's `<h2>` takes it only after a *successful* unlike.
- The disabled sign-in button's reason (FOLLOWUPS 24) and the offline text (17): `0009f`.
- Focus lost to a `disabled` pending button (submit, withdraw, remove, leave, join, like, send, save), and
  errors that keep the button: the `aria-disabled` follow-up named in `0009c`'s Out. The exceptions handled
  here are the chat composer and the OTP resend (Scope 1).
- Focusing the first new card after "load more" (a FOLLOWUPS suggestion in `0009c`).
- Shared files, changed here in behaviour only. The second to merge rebases.
  - `0009h`: `MapCanvas` class swaps, `EmptyState`, `ErrorState`.
  - `0009f`: `OtpForm`, `ErrorState`, `JoinFlatPage`, `MyApplicationsPage:114-118`, `ChatListPage`.
  - `0009i`: `/search`, `SearchMap`, `ViewToggle`.
  - `0009j`: the listing page, `ApplySection`.
  - `0009k`: `MyListingsPage`, `EditListingPage`.
  - `0009m`: `OtpForm`, `ProfilePage`.
  - `0009q`: `MyApplicationsPage`, `MyLikesPage`, `LikeRoomButton`, flatmates.
  - `0009s`: chat.

**New dependencies:** none.

## Data
None.

## API
None.

## UI
No new screen. The states added:
- **`/search` map view**:
  - loading: the pill "התוצאות מתעדכנות…" over the map, visual only;
  - empty: the count line as the empty box, above the map, announced;
  - error: `ErrorState` above the map, or in the desktop column;
  - success: unchanged.
- **`/search` after Apply / Clear**: focus on the count line.
- **`/listings/:id`**: apply success, the swapping 409s and the 404 move focus to their message. The small
  map is hidden from assistive tech.
- **`/login`, `/signup`**: after a resend, focus is on the code input and "שלחנו קוד חדש" is announced. The
  end of the cooldown is announced.
- **`/me/listings`**: "השינויים נשמרו" is announced once, and never again after a reload or Back.
- **`/me/profile`**: "הפרופיל נשמר" takes focus and is in view when no `next` follows.
- **`/chat`**: "joined" is announced.
- **`/chat/:id`**: focus moves to the closed note; a first pushed message is read.
- **`/me/applications`, `/me/likes`, `/me/flats`, `/me/listings/:id/flatmates`, `/me/listings/:id/edit`,
  `/flatmates/join`**: the focus targets in Scope 1.

RTL: the pill is centred (`inset-x-0 mx-auto`). Every class is logical. Touch targets are unchanged
(≥ 44 px).

## Acceptance criteria
- [ ] AC1 Focus after apply outcomes, each after a submit in this tab:
  - a 201 → "המועמדות נשלחה";
  - a 409 `room_gender_mismatch` → the misfit line;
  - a 409 `seeker_gender_required` → `RoomGate`'s paragraph;
  - the same, with the listing refetch answering `room_fit: false` → the misfit line;
  - a 409 `seeker_profile_required` → the profile gate's paragraph;
  - a 409 `already_applied` → the `Applied` block's first line;
  - a 404 → the unavailable alert.

  Negative cases, where focus does not move: a listing rendered with `room_fit: false` on mount, and
  `ProfileGate` already shown on mount. — `web/src/features/applications/__tests__/ApplySection.test.tsx::ac1_focus_after_submit_outcomes`
- [ ] AC2 More focus targets:
  - withdraw 200 → that card's title link;
  - withdraw 409 `not_withdrawable` with the refetch answering `declined` → the card's alert line;
  - a successful unlike on `/me/likes` → `#likes-mine`; a 404 on unlike does **not** focus it;
  - `/me/listings/X/edit` for an id not in my listings → the not-found `<h1>`;
  - a save answering PATCH 404 → the not-found `<h1>`;
  - a successful `ErrorState` retry with its button focused, rendered inside `<main id="main"
    tabIndex={-1}>` → `<main>`;
  - an `ErrorState` that unmounts while focus is in another field → focus stays there.

  — `MyApplicationsPage.test.tsx::ac2_focus_after_withdraw`, `MyLikesPage.test.tsx::ac2_focus_after_unlike`,
  `EditListingPage.test.tsx::ac2_not_found_takes_focus`, `web/src/components/__tests__/ErrorState.test.tsx::ac2_retry_success_keeps_focus_in_main`
- [ ] AC3 Focus targets on other pages:
  - removing a flatmate → the list `<h2>`;
  - leaving a flat → the `<h1>`;
  - a final join 4xx → the failure line;
  - filters Apply with a changed filter → the results count line; Apply with unchanged filters keeps focus
    on Apply; Clear → the count line;
  - map "show the list" → the pressed list button;
  - chat, (a) textarea focused and a refetch answering `can_send: false` → the closed note;
  - chat, (b) send clicked, POST 409 `chat_closed`, refetch answering `can_send: false` → the closed note;
  - chat, negative: focus on the back link when the chat closes → the note is not focused.

  — `FlatmatesPage.test.tsx::ac3_focus_after_remove`, `MyFlatsPage.test.tsx::ac3_focus_after_leave`,
  `JoinFlatPage.test.tsx::ac3_focus_after_final_error`, `SearchPage.test.tsx::ac3_focus_after_apply_and_clear`,
  `SearchMap.test.tsx::ac3_focus_after_show_list`, `ChatThreadPage.test.tsx::ac3_focus_when_chat_closes`
- [ ] AC4 Announcements:
  - `/me/listings` with `state.saved`: the `role="status"` line is empty on the first render and holds
    "השינויים נשמרו" after a frame. `navigate` was called with `state: null, replace: true`, and
    remounting at `/me/listings` with `state: null` shows an empty status line;
  - `/chat` after a join: the joined line, empty and then filled in the same way;
  - a profile save without `next` focuses "הפרופיל נשמר";
  - OTP: after a resend 200 the status reads "שלחנו קוד חדש" and the code input is
    `document.activeElement`; when the fake-timer cooldown ends, the status reads "אפשר לשלוח קוד חדש";
  - a group thread with no messages renders an empty `role="log"`.

  — `MyListingsPage.test.tsx::ac4_saved_announced_once`, `ChatListPage.test.tsx::ac4_joined_announced_once`,
  `ProfilePage.test.tsx::ac4_saved_takes_focus`, `OtpForm.test.tsx::ac4_resend_announced_and_focused`,
  `ChatThreadPage.test.tsx::ac4_log_mounted_when_empty`
- [ ] AC5 Map, with the fake canvas:
  - `total` 0 puts `search.map.empty` into the `aria-live` count line above the map. The line has the
    `emptyStateBox` classes, and no other element holds that text;
  - `/search` has exactly one `[aria-live="polite"]`;
  - an error renders `ErrorState` before the map region in DOM order;
  - while the map query is pending (placeholder data after a move), `map-updating` shows "התוצאות
    מתעדכנות…" through the `overlay` prop, and it is gone when the answer lands.

  — `web/src/features/search/__tests__/SearchMap.test.tsx::ac5_states_above_map_and_updating_pill`
- [ ] AC6 Map landmark, with real MapLibre and the tiles stubbed (`routeTiles`, moved to `helpers.ts` by
  `0009c`):
  - on `/search?view=map` there is exactly one `region` named "מפת התוצאות" (`exact: true`), and no
    `region` named "מפה" (`exact: true`);
  - the canvas has `role="application"` and `tabindex="0"` (`toHaveAttribute` waits for the library to load);
  - `map-updating` has count 0 once the region is `aria-busy="false"`. This is the only check of the real
    `loaded`-gated overlay;
  - on the listing page, the small map's canvas is `aria-hidden="true"` with `tabindex="-1"`;
  - `expectNoAxeViolations` passes on both pages with no map exemption.

  These steps go inside `web/e2e/map.spec.ts::ac8_visitor_finds_a_listing_on_the_map`, whose one
  `signUpOwner` already exists, so no sign-up is added. They must work at `0009i`'s 1280 px split. The test
  also grows with `0009c`'s axe calls and `0009i`'s steps, so add `test.slow()` if it nears 30 s (FOLLOWUPS
  156). — `map.spec.ts::ac8_visitor_finds_a_listing_on_the_map` (named step `ac6_one_map_landmark`)
- [ ] NF1 On the final head, `make lint`, `make test`, `make i18n-check`, `make build-web` and local
  `make e2e` are green (Speed rule 7), `0009c`'s axe checks still pass, and each shard has ≤ 8 sign-ups. The
  build ticks FOLLOWUPS 23, 52, 55, 73, 74, 75, 76, 123, 149, 184. The digest reports the e2e result.

## Tests to write
- Unit: the cases named in AC1–AC5, in the existing test files and harnesses, plus the replacements listed in
  Scope 4. Fake `requestAnimationFrame` and timers where the AC says so. Hebrew literals come from `he.json`
  or use `\uXXXX` escapes.
- E2E: no new test and no new sign-up. AC6's steps go inside `map.spec.ts::ac8`.

## Risks / open questions
- **`role="application"` on the canvas.** It is the right role for a pan-and-zoom widget that takes the arrow
  keys, and it is not a landmark. If the ux or qa review finds a screen reader trapped in it, the fallback is
  `role="img"` with the same label. That loses keyboard panning under the reader; the zoom buttons remain.
- **Focus timing.** Every target is focused in an effect after the render that shows it. The "submitted in
  this tab" ref (`ApplySection`) and the "composer had focus" ref (`Thread`) keep a page that merely shows a
  state (a reload, a push) from stealing focus. Each has a negative test (AC1, AC3).
- **A closed note that appears from a push while focus is elsewhere** is a status inserted already filled, so
  it may not be announced. This is accepted: the person is not in the composer, and the note is visible.
- **Overlap with `0009g`** on `ApplySection`, `ChatThreadPage`, `MyLikesPage` and `ErrorState`. `0009g`
  depends on this spec and builds after it.
- **Stale attributions in sibling specs** (for the orchestrator): several still credit focus, announcements
  or the map to `0009c`. They should say `0009t`:
  - `0009f:145, 390-391`;
  - `0009i:58, 62, 112, 202, 217, 219-225`;
  - `0009j:98, 336-341`;
  - `0009k:57, 194, 369`;
  - `0009m:68-69`, which also gives FOLLOWUPS 24 to `0009c` (it is `0009f`'s), and `164, 180, 187, 296, 527`;
  - `0009q:56, 140, 222, 247, 268, 341`;
  - `0009s:62, 168, 513`.

  `0009i` also needs the empty-state line from Scope 3.
- Verifier: this spec was split off `0009c` by `0009c`'s round 1 (findings 21–31 applied). Its own round 1
  had 25 findings, all applied (finding 22, which was optional, applied as `components/focus.ts`). The second
  round is waived. Finding 28 of `0009c`'s round (the OTP hint order) went to `0009f` with FOLLOWUPS 24, in
  the shared notes.
- Brand amendment (2026-11-12): token names, the pill's classes and the focus-ring rule follow
  `specs/0009-brand-amendment.md`. This was applied as a spec edit, without re-running the verifier. The new
  keys already follow the brand voice (no slash forms, impersonal).
- **Map pins and axe `target-size` (accepted by Gilad 2026-11-12): WCAG 2.5.8's "essential" exception.** Pins sit
  at their listings' true positions, so close listings overlap (reproduced at the build: 12 e2e listings in
  גבעתיים land within ~200x150 px at the Gush Dan zoom; the 73x44 px pin buttons cut neighbours to 23x12 and
  21x27 px). The page-wide `disableRules: ['target-size']` on the `/search?view=map` scans (`a11y.spec.ts`,
  `map.spec.ts::ac8`) is gone: `expectNoAxeViolations(page, …, { markerTargetSizeExempt: true })` scans the page
  without `.maplibregl-marker` with every rule, and the markers alone with every rule but `target-size`.
  Clustering overlapping pins (option (a)) is in `specs/FOLLOWUPS.md` for when real listing density is known.

## Digest (filled by orchestrator after verification)
See `/digest`.

    Spec 0009t — focus after actions, announcements, one map landmark   PR #49 (open, ready-to-merge; orchestrator merges)
    Shipped: when an action removes the button you used (apply, withdraw, unlike, remove, leave, filter Apply/Clear, chat closing, OTP resend, retry), focus lands on what replaced it; "saved", "joined" and "code resent" lines are read out; the search map is one labelled landmark with its empty, error and "updating" states above the map.
    Demo: make dev → /search?view=map, change a filter and press Apply (focus on the count line, the "התוצאות מתעדכנות…" pill over the map) → open a listing and apply (focus on "המועמדות נשלחה") → /login, resend the code (focus back on the code box).
    Tests: +19 unit (vitest, one per AC/negative case), +1 e2e step (ac6_one_map_landmark in map.spec ac8), 0 new sign-ups. Local: lint, test (api 476, web 421), i18n-check, build-web green; map + a11y e2e 6/6; full make e2e left to CI (Mac under load).
    Findings: 0 blockers, 0 majors, 6 minors (4 fixed, 2 logged to FOLLOWUPS), 9 nits dropped. Reviewers: code, qa (browser at 390/1280 px), ux — all approve.
    Decision taken: map pins exempt from axe target-size only (WCAG 2.5.8 "essential"), accepted by Gilad 2026-11-12; clustering pins logged as a follow-up.
    Changed in PRODUCT.md: nothing here (the pin decision is in PRODUCT.md on main, 48dc6cb).
    Closes FOLLOWUPS 23, 52, 55, 73, 74, 75, 76, 123, 149, 184. Unblocks: 0009g.
