---
id: 0008c
title: A seeker opens their room profile to flats looking for a flatmate, likes rooms from the listing page, sees the rooms that liked them in "לייקים", likes back to open the chat; mutual matches are tagged in "my applications"
status: in-progress
depends_on: [0008a, 0007f]   # 0008a: PUT /me/profile people_visible/about_me, PUT/DELETE /listings/{id}/like, GET /me/likes, ListingDetail.like, MyApplicationOut.source (and the type-only fixture edits); 0007f: the room listing page sections, RoomGate, ListingCard for rooms, cardTitle, useApply's room_fit cache write. 0007d (done): the profile's room section and roomSectionHref
reviewers: [code, qa, ux]   # ux: a new page, a new profile block and a new control on the listing page, no artboard; qa: the like states against apply / gate / login, the no-refetch cache rule; no security: shows the caller's own data and public listings only
estimate: 1 coder run   # coder Sonnet/medium; Opus if the run overflows
---

## Goal
After this ships, a seeker's `/me/profile` room section has two more fields:
- a switch, **"להציג אותי לדירות שמחפשות שותף/ה"** (people browse opt-in, off by default);
- **"קצת עליי"**, an optional text of up to 300 characters.

On a room's listing page, a signed-in seeker gets a **"אהבתי את החדר"** toggle. When the room's lister already
liked them, a line says so: "בעל/ת החדר אהב/ה את הפרופיל שלך — אהבו בחזרה כדי לפתוח צ'אט". Liking back
shows "זו התאמה הדדית!" with a link to the chat.

A header link **"לייקים"** opens `/me/likes`. It carries a count badge when rooms liked the seeker. The page
has two lists, "אהבו אותך" and "חדרים שאהבתי", each a room card with its like control. In "my applications",
a mutual match carries the tag **"התאמה הדדית"** in place of the message block.

This serves PRODUCT.md "People & likes" (Gilad, 2026-11-11). It is Dev Plan slice 8, part c. No artboard. The
room cards reuse `ListingCard` as search renders rooms (`0007f`), and the profile fields follow
`0006d` / `0007d`'s form.

## Scope
**In:**
- `web/src/features/profile/validate.ts`:
  - `ProfileForm` gains `people_visible: boolean` (default `false`) and `about_me: string` (default `''`).
    `formFromProfile` (`validate.ts:73`) maps `people_visible` and `about_me ?? ''`.
  - `FIELD_ORDER` gains `about_me` after `birth_year`. `FieldName` gains `about_me`, and `FieldError` gains
    `{ key: 'profile.errors.aboutMeTooLong' }`, so `serverFieldErrors` maps a 422 on `about_me` too (verifier
    finding 4).
  - `validate` checks `about_me` only while `form.room` is on, as `birth_year` is (verifier finding 5):
    1. it cleans with `cleanText(v, { multiline: true })` (`features/listings/validate.ts`) and measures
       with `visibleLength(v, { multiline: true })`;
    2. empty after cleaning is valid (it is sent as `null`);
    3. not empty but with no `\p{L}` / `\p{N}` gives `listings.errors.required`;
    4. over 300 gives `profile.errors.aboutMeTooLong`.
  - `toProfileIn` sends the two fields:
    - with the room switch on: `people_visible`, and `about_me` = the cleaned text or `null`;
    - with it off: `people_visible: false` and `about_me: null`. The API refuses both without a gender.
- `web/src/features/profile/ProfilePage.tsx`: inside the room section, only while `form.room` is on, after
  `LifestyleFields`:
  - a `Switch` labelled `profile.room.peopleVisible`, with the hint `profile.room.peopleVisibleHint`;
  - a `textarea name="about_me"`, labelled `profile.room.aboutMe` (`maxLength` 300, `rows` 4). Its counter
    reuses `listings.fields.charsLeft`, as `ApplySection.tsx:182` does. It has `aria-describedby` for the
    counter and the error, as the birth-year field does.
  - `focus(name)` (`ProfilePage.tsx:93-95`) selects `[name="${name}"]`, not `input[name=…]`, so the textarea
    receives focus on an error.
- `web/src/features/likes/` (new):
  - `api.ts` re-exports the types. It holds `MY_LIKES_KEY = ['me', 'likes']` and `useMyLikes()` (no `enabled`
    gate: `LikesNavLink` renders only in `AuthMenu`'s seeker branch, and the page sits under `RequireSeeker`),
    and `useLikeRoom(listingId)` / `useUnlikeRoom(listingId)`. **A like never refetches the listing**
    (verifier finding 2), because each `GET /listings/{id}` counts a view (`usePublicListing.ts:6-7`,
    `useApply.ts:30-36`). Instead:
    - PUT and DELETE write `like` into `['listing', id]` with `setQueryData`: the PUT sets `liked_by_me:
      true`, the DELETE `false`, and `liked_me` is kept;
    - both invalidate `MY_LIKES_KEY`;
    - a mutual result also invalidates `MY_APPLICATIONS_KEY` and `CONVERSATIONS_KEY`
      (`chat/useConversations.ts:9`), and sets the cached `like` to `null`;
    - errors (verifier finding 6), each inline with `role="alert"`:
      - `room_section_required` or `seeker_profile_required`: `likes.errors.roomSection`, with the link
        `likes.toProfile` to `roomSectionHref(location.pathname)` (`features/profile/links.ts`). A like needs
        the room section either way, and the profile page creates the profile there;
      - `room_gender_mismatch`: sets the cached `room_fit: false`, as `useApply` does on `0007f`. The button
        then hides and `RoomGate` explains, so there is no alert;
      - `already_applied`: sets the cached `like: null` and invalidates `MY_APPLICATIONS_KEY`. `ApplySection`
        then shows the application (`ApplySection.tsx:296-307`). On `/me/likes` it invalidates `MY_LIKES_KEY`
        instead;
      - 404: `likes.errors.gone`, and it invalidates `MY_LIKES_KEY`;
      - 401: `clearSession` and navigate to `loginPath(listingId)`, as `useApply` does;
      - `rate_limited`: `likes.errors.rateLimited`;
      - otherwise: `common.error`.
  - `LikeRoomButton.tsx` (`{ listingId, like: LikeStateOut, onMutual(applicationId) }`): the toggle, with
    `aria-pressed`. Its label is `likes.like` "אהבתי את החדר" (pressed: `likes.liked` "אהבת את החדר ✓",
    accessible name `likes.unlikeLabel` "ביטול לייק"). When `like.liked_me` is true and `liked_by_me` is false,
    the teal line `likes.likedYouLine` sits above it. It is disabled while its request runs. On a result with
    `application_id` it calls `onMutual` (verifier finding 1).
  - `MutualBanner.tsx` (`{ applicationId }`): a `role="status"` region with `likes.mutual` and the link
    `likes.toChat` to `/chat/{applicationId}`.
  - `MyLikesPage.tsx` (`/me/likes`): the `h1` `likes.title`, then two `section`s with `h2`:
    `likes.likedMe` ("אהבו אותך") first, then `likes.mine` ("חדרים שאהבתי").
    - Each item is a `ListingCard` (`features/listings/ListingCard.tsx`) with `to=/listings/{id}` and
      `today={todayInIsrael()}`. Its `children` hold the control inside a `relative` wrapper, which sits above
      the card's stretched link (`after:absolute after:inset-0`, verifier finding 3).
    - "אהבו אותך" items get `LikeRoomButton` with `{liked_by_me: false, liked_me: true}`. "חדרים שאהבתי"
      items get it with `{liked_by_me: true, liked_me: false}`, and an unlike moves the item out after the
      `MY_LIKES_KEY` refetch.
    - The page keeps the last mutual `applicationId` in state and renders `MutualBanner` above the lists, so
      the banner survives the refetch that removes the card.
    - Each section has its own empty text. The page has the loading `Skeleton` and `ErrorState`.
  - `LikesNavLink.tsx`: the header link `header.likes` "לייקים" to `/me/likes`. When `liked_me.length > 0` it
    shows a badge built **as `ChatNavLink`'s** (`ChatNavLink.tsx:24-34`: an `aria-hidden` number plus `sr-only`
    text from `likes.badgeLabel` / `likes.badgeLabelOne`).
- `web/src/features/auth/AuthMenu.tsx`: for a seeker, `LikesNavLink` goes between "המועמדויות שלי" and "הפרופיל
  שלי".
- `web/src/app/routes.tsx`: `me/likes` → `MyLikesPage`, inside the `RequireSeeker` group.
- `web/src/features/listings/ListingPage.tsx`: holds `mutualId` in state.
  - When `mutualId` is set, `MutualBanner` renders right before `ApplySection`.
  - Else, when `listing.like !== null` (`0008a`: a seeker, a room, no open application) and `room_fit !==
    false`, `LikeRoomButton` renders there.
  - When `room_fit === false`, `0007f`'s `RoomGate` explains, and no button renders.
- `web/src/features/applications/MyApplicationsPage.tsx`: when `source === 'like'`, the whole "your message"
  block (`MyApplicationsPage.tsx:70-79`, the label and `data-testid="application-message"`) is replaced by the
  tag `applications.mutual` "התאמה הדדית" (`data-testid="application-mutual"`).
- `web/src/locales/he.json`. Singular keys are separate, as `applications.count.one` is.

  | Key | Hebrew |
  | --- | --- |
  | `header.likes` | "לייקים" |
  | `likes.title` | "לייקים" |
  | `likes.like` | "אהבתי את החדר" |
  | `likes.liked` | "אהבת את החדר ✓" |
  | `likes.unlikeLabel` | "ביטול לייק" |
  | `likes.likedYouLine` | "בעל/ת החדר אהב/ה את הפרופיל שלך — אהבו בחזרה כדי לפתוח צ'אט" |
  | `likes.mutual` | "זו התאמה הדדית! הצ'אט נפתח" |
  | `likes.toChat` | "לצ'אט" |
  | `likes.likedMe` | "אהבו אותך" |
  | `likes.mine` | "חדרים שאהבתי" |
  | `likes.likedMeEmpty` | "עוד אין חדרים שאהבו אותך. כדאי להפעיל 'להציג אותי' בפרופיל." |
  | `likes.mineEmpty` | "עוד לא אהבת חדרים." |
  | `likes.toProfile` | "לפרופיל" |
  | `likes.badgeLabel` | "{{count}} חדרים אהבו אותך" |
  | `likes.badgeLabelOne` | "חדר אחד אהב אותך" |
  | `likes.errors.roomSection` | "כדי לאהוב חדר צריך למלא בפרופיל את החלק של חיפוש חדר" |
  | `likes.errors.alreadyApplied` | "כבר הגשת מועמדות לחדר הזה" |
  | `likes.errors.gone` | "החדר כבר לא זמין" |
  | `likes.errors.rateLimited` | "יותר מדי לייקים בזמן קצר. נסו שוב מאוחר יותר." |
  | `profile.room.peopleVisible` | "להציג אותי לדירות שמחפשות שותף/ה" |
  | `profile.room.peopleVisibleHint` | "בעלי חדרים יראו את השם, המגדר, הגיל, האזורים, תאריך הכניסה, התשובות לשאלון, 'קצת עליי' וציון התאמה — את התקציב רק כ'מתאים / לא מתאים', לא את הסכום." |
  | `profile.room.aboutMe` | "קצת עליי (לא חובה)" |
  | `profile.errors.aboutMeTooLong` | "עד 300 תווים" |
  | `applications.mutual` | "התאמה הדדית" |
- Fixtures: a new `likes/__tests__/fixtures.ts`. The type-only additions to the existing fixtures (`source`,
  `people_visible`, `about_me`, and `like: null` on `features/search/__tests__/fixtures.ts::listingDetail`)
  land with `0008a`, which regenerates the client.

**Out:**
- A like control on search result cards and map pins. Liking is from the listing page and `/me/likes` only,
  so search stays untouched. FOLLOWUPS: "heart on room cards in /search".
- Hiding a received like (`0008a` Out).
- The lister's side (`0008b`) and flatmates (`0008e` / `0008f`).

**New dependencies:** none.

## Data
None (web only).

## API
Consumes `0008a`: `GET`/`PUT /me/profile` (`people_visible`, `about_me`), `PUT`/`DELETE /listings/{id}/like`,
`GET /me/likes`, `GET /listings/{id}` (`like`), and `GET /me/applications` (`source`, nullable `message`).
Run `make client`.

## UI
- **Profile**: the two new fields appear only with the room switch on. Switching the room section off hides
  them, and the save sends `false` / `null`. An over-long or letterless text shows its error under the field
  on save, with focus moved to the textarea.
- **Listing page** (room, signed-in seeker, no open application), in these states:
  - the idle toggle;
  - the "liked you" line plus the toggle;
  - pressed;
  - the mutual banner, which replaces the control and survives the refetch;
  - inline errors.

  An anonymous visitor sees no control: `ApplySection`'s login prompt is the call to action.
- **`/me/likes`**: loading (`Skeleton`), error (`ErrorState` with retry), each section empty
  (`likes.likedMeEmpty` with the link `likes.toProfile` to `/me/profile?section=room`, and `likes.mineEmpty`),
  success, and the mutual banner above the lists.
- **Header**: "לייקים" with the badge, as `ChatNavLink`'s.

RTL: logical properties only. The textarea has `text-start` and `dir="auto"`. The cards stack in one column on
mobile.

## Acceptance criteria
- [ ] AC1 Given a saved profile with the room section, When the seeker turns on "להציג אותי…", types "שלום,
  אני סטודנטית" and saves, Then the PUT body has `people_visible: true` and `about_me: "שלום, אני סטודנטית"`.
  A two-line text keeps its newline. When the room section is switched off and the profile saved, Then the body
  has `people_visible: false` and `about_me: null`. A server 422 on `about_me` shows under the textarea and
  focuses it. The validation rules are tested in `validate.test.ts::ac1_about_me`: 301 characters gives
  `aboutMeTooLong`; "!!!" gives `required`; spaces only give `null`. — `web/src/features/profile/__tests__/ProfilePage.test.tsx::ac1_people_fields`
- [ ] AC2 Given `GET /listings/R` with `like: {liked_by_me: false, liked_me: true}`, Then the page shows the
  "liked you" line and "אהבתי את החדר" before the apply section. When it is clicked and the PUT answers
  `{liked: true, application_id: "X"}`, Then the mutual banner links to `/chat/X`. It is still shown after the
  caches settle, and no second `GET /listings/R` was made. — `web/src/features/listings/__tests__/ListingPage.test.tsx::ac2_like_back_mutual`
- [ ] AC3 Given `like: {false, false}`, When liked (the PUT answers `{liked: true, application_id: null}`), Then
  after the response the button is `aria-pressed="true"`, with no listing refetch. A click sends the DELETE
  and the button returns to `false`. Given `like: null` (anonymous, an apartment, an open application), or
  `room_fit: false`, no control renders. — `ListingPage.test.tsx::ac3_like_toggle_and_absent`
- [ ] AC4 Given the PUT answering:
  - 409 `room_section_required` or `seeker_profile_required`: the alert links to
    `/me/profile?section=room&next=%2Flistings%2FR`;
  - 409 `room_gender_mismatch`: the button disappears and `RoomGate`'s text shows;
  - `already_applied`: the control disappears and `MY_APPLICATIONS_KEY` refetches;
  - 404: the "no longer available" text;
  - 429: the rate-limit text;
  - 401: navigation to the login path.

  — `ListingPage.test.tsx::ac4_like_errors`
- [ ] AC5 Given `GET /me/likes` answering one `liked_me` and two `mine` rooms, Then `/me/likes` shows "אהבו
  אותך" with one card and "חדרים שאהבתי" with two, each linking to its listing. Liking back the first one
  (clicking the button, not the card link) calls `PUT /listings/{id}/like`. A mutual answer shows the banner
  above the lists, which remains after the refetch removes the card. Unliking a `mine` room calls DELETE and
  refetches. Empty lists show their texts. A 500 shows `ErrorState`. — `web/src/features/likes/__tests__/MyLikesPage.test.tsx::ac5_lists_and_states`
- [ ] AC6 Given a seeker with `liked_me` of length 2, Then the header shows "לייקים" with the badge number 2
  and the sr-only "2 חדרים אהבו אותך". With 0, there is no badge. An owner's header has no "לייקים" and makes
  no `/me/likes` request. — `web/src/features/auth/__tests__/AuthMenu.test.tsx::ac6_likes_link`
- [ ] AC7 Given an application with `source: 'like'` and `message: null`, Then "my applications" shows the
  "התאמה הדדית" tag and no "your message" label or paragraph. An `apply` one is unchanged. —
  `web/src/features/applications/__tests__/MyApplicationsPage.test.tsx::ac7_mutual_tag`
- [ ] AC8 An owner opening `/me/likes` is sent away by `RequireSeeker`, as the other seeker routes are. —
  `web/src/features/auth/__tests__/routes.test.tsx` (one added case)
- [ ] AC9 E2E. A seeker signs up, fills the profile with the room section, turns on "להציג אותי", and saves.
  An owner posts a room and likes the seeker **through the API** (`GET .../people` then `PUT .../like`, helper
  `likePerson`). The seeker sees "לייקים" with a badge of 1, opens `/me/likes`, sees the room under "אהבו
  אותך", and likes back. Then the mutual banner links to the chat, and "my applications" shows the room with
  "התאמה הדדית". — `web/e2e/likes.spec.ts::ac9_seeker_likes_back_and_chats`
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green (Speed
  rule 7). The e2e result goes in the digest.

## Tests to write
Component: the cases above, using `vi.stubGlobal('fetch', ...)` as the existing page tests do. AC1 uses
`fireEvent.change` for long text. Unit: `validate.test.ts` for `about_me`.
E2E: `web/e2e/likes.spec.ts`. `helpers.ts` gains `likePerson(page, listingId, personId)` (owner, through the
API). `putProfile` already takes overrides (`0007f`), and so does `0008b`'s `likeRoom`; both are reused.

## Risks / open questions
- `0008b` and `0008c` both edit `helpers.ts` and `he.json`. They build one after the other (web port 5173,
  Speed rule 2), so the second rebases.
- The header grows by one link for seekers. On narrow phones it wraps, as the existing links already do. The UX
  reviewer checks 360 px.
- The listing page's like control sits next to the apply section, and the copy keeps them apart: a like is
  light ("אהבתי"), applying is the full step with a message. If the UX review finds them confusing, the
  fallback is a one-line hint under the button, "לייק הדדי פותח צ'אט בלי הודעת מועמדות" (key
  `likes.hint`), in the same build.

Spec-verifier round 1 rejected with 1 blocker, 5 majors and 6 minors. All are applied. The second round is
waived (one verifier round, Gilad).

## Digest (filled by orchestrator after verification)
    Spec 0008c - Likes web (seeker)   (verified, Slice 8; depends on 0008a, 0007f)
    What a user can do after this: a seeker turns on "להציג אותי לדירות שמחפשות שותף/ה" and writes "קצת עליי",
             likes rooms from the room page, sees "אהבו אותך" / "חדרים שאהבתי" under a new header link "לייקים",
             and likes back to open the chat.
    Decisions I need from you: none. Assumption you can overrule: no like button on search cards yet (listing
             page and /me/likes only; follow-up).
    KPIs this slice moves: seekers opted in to people browse; likes per active seeker.
    Acceptance targets: lint/test/i18n/build clean + make e2e green locally; a like never refetches the listing
             (views stay honest for the applications-per-view log).
    Risks: like vs apply on one page may confuse - mitigation: distinct copy, one-line hint fallback in the same build.
    Reviewers: code, qa, ux   Estimated: 1 coder run (Sonnet/medium)
    Links: specs/0008c-likes-web.md - PRODUCT.md "People & likes" - no artboard
