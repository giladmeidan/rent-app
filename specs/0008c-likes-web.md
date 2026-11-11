---
id: 0008c
title: A seeker opens their room profile to flats looking for a flatmate, likes rooms from the listing page, sees the rooms that liked them in "לייקים", likes back to open the chat; mutual matches are tagged in "my applications"
status: draft
depends_on: [0008a, 0007f]   # 0008a: PUT /me/profile people_visible/about_me, PUT/DELETE /listings/{id}/like, GET /me/likes, ListingDetail.like, MyApplicationOut.source; 0007f: the room listing page sections, RoomGate, ListingCard for rooms, cardTitle. 0007d (done): the profile's room section and roomSectionHref
reviewers: [code, qa, ux]   # ux: a new page, a new profile block and a new control on the listing page, no artboard; qa: the like states against apply / gate / login; no security: shows the caller's own data and public listings only
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
a mutual match carries the tag **"התאמה הדדית"** where the message would be.

This serves PRODUCT.md "People & likes" (Gilad, 2026-11-11). It is Dev Plan slice 8, part c. No artboard. The
room cards reuse `ListingCard` as search renders rooms (`0007f`), and the profile fields follow
`0006d` / `0007d`'s form.

## Scope
**In:**
- `web/src/features/profile/`:
  - `validate.ts`: `ProfileForm` gains `people_visible: boolean` (default `false`) and `about_me: string`
    (default `''`). `fromProfile` maps `about_me ?? ''`. `validate` checks `about_me` after `cleanText`
    (`features/listings/validate.ts`), and errors when it is over 300 characters (`profile.errors.aboutMeTooLong`).
    `toProfileIn` sends the two fields as follows:
    - with the room switch on: `people_visible`, and `about_me` = the cleaned text, or `null` when empty;
    - with it off: `people_visible: false` and `about_me: null`. The API refuses both without a gender.
  - `ProfilePage.tsx`: inside the room section (only while `form.room` is on), after `LifestyleFields`:
    - a `Switch` labelled `profile.room.peopleVisible`, with the hint `profile.room.peopleVisibleHint`: "בעלי
      חדרים יראו את השם, הגיל, האזורים, תאריך הכניסה, התשובות לשאלון ו'קצת עליי' — לא את התקציב.";
    - a `textarea` labelled `profile.room.aboutMe` (`maxLength` 300, `rows` 4, a live counter
      "{{count}}/300", and `aria-describedby` for the hint and the error, as the birth-year field does).
- `web/src/features/likes/` (new):
  - `api.ts` re-exports the types and holds:
    - `MY_LIKES_KEY = ['me', 'likes']` and `useMyLikes()` (`enabled` only for a seeker, as `ChatNavLink`
      gates on the user);
    - `useLikeRoom(listingId)` / `useUnlikeRoom(listingId)`. Each invalidates `MY_LIKES_KEY` and the
      listing's detail key. A mutual like also invalidates `MY_APPLICATIONS_KEY` and the chat list key.
  - `LikeRoomButton.tsx` (`{ listingId, like: LikeStateOut }`): the toggle, with `aria-pressed`. The label is
    "אהבתי את החדר" (pressed: "אהבת את החדר ✓", accessible name "ביטול לייק"). When `like.liked_me` is true
    and `liked_by_me` is false, a teal line `likes.likedYouLine` sits above it.
    - A mutual result replaces the control with `likes.mutual` "זו התאמה הדדית! הצ'אט נפתח" and a link to
      `/chat/{application_id}`.
    - Errors are inline (`role="alert"`):
      - `room_section_required`: `likes.errors.roomSection`, with a link to
        `roomSectionHref(location.pathname)` (`features/profile/links.ts`);
      - `seeker_profile_required`: the same text and link without `section=room`;
      - `already_applied`: `likes.errors.alreadyApplied` and a refetch of the listing (the page then shows the
        application);
      - `rate_limited`: `likes.errors.rateLimited`;
      - otherwise `common.error`.
  - `MyLikesPage.tsx` (`/me/likes`): two `section`s with `h2`, `likes.likedMe` ("אהבו אותך") first, then
    `likes.mine` ("חדרים שאהבתי"). Each item is a `ListingCard` (`features/listings/ListingCard.tsx`) linking
    to `/listings/{id}`. Its `children` slot holds the item's control:
    - "אהבו אותך" items: `LikeRoomButton` with `{liked_by_me: false, liked_me: true}`;
    - "חדרים שאהבתי" items: `LikeRoomButton` with `{liked_by_me: true, liked_me: false}`, whose unlike moves
      the item out after the refetch.

    Each section has its own empty text. The page has the loading `Skeleton` and `ErrorState`.
  - `LikesNavLink.tsx`: the header link "לייקים" to `/me/likes`, with a count badge of `liked_me.length` when
    above 0. It is styled and placed like `ChatNavLink`'s badge.
- `web/src/features/auth/AuthMenu.tsx`: for a seeker, `LikesNavLink` goes between "המועמדויות שלי" and "הפרופיל
  שלי".
- `web/src/app/routes.tsx`: `me/likes` → `MyLikesPage`, inside the `RequireSeeker` group.
- `web/src/features/listings/ListingPage.tsx`: when `listing.like !== null` (`0008a`: a seeker, a room, no
  open application), `LikeRoomButton` renders right before `ApplySection`. When `room_fit === false`,
  `0007f`'s `RoomGate` already explains, and the button is not rendered. When `like` is null nothing changes.
- `web/src/features/applications/MyApplicationsPage.tsx`: when `source === 'like'`, the message paragraph
  (`data-testid="application-message"`) is replaced by the tag "התאמה הדדית"
  (`data-testid="application-mutual"`).
- `web/src/locales/he.json`: the `likes.*`, `header.likes`, `profile.room.peopleVisible`, `…peopleVisibleHint`,
  `…aboutMe`, `…aboutMeHint`, `…aboutMeCount`, `profile.errors.aboutMeTooLong` and `applications.mutual` keys.
- Fixtures: the profile fixture gains `people_visible: false` and `about_me: null`. The listing-detail fixture
  gains `like: null`. The application fixture gains `source: 'apply'`. There is a new
  `likes/__tests__/fixtures.ts`.

**Out:**
- A like control on search result cards and map pins. Liking is from the listing page and `/me/likes` only,
  so search stays untouched. FOLLOWUPS: "heart on room cards in /search".
- Hiding a received like (`0008a` Out).
- The lister's side (`0008b`) and flatmates (`0008e`).

**New dependencies:** none.

## Data
None (web only).

## API
Consumes `0008a`: `GET`/`PUT /me/profile` (`people_visible`, `about_me`), `PUT`/`DELETE /listings/{id}/like`,
`GET /me/likes`, `GET /listings/{id}` (`like`), and `GET /me/applications` (`source`, nullable `message`).
Run `make client`.

## UI
- **Profile**: the two new fields appear only with the room switch on. Switching the room section off hides
  them, and the save sends `false` / `null`. The counter turns amber past 280 characters. An over-long text
  shows the error under the field on save, with focus moved to it, as the existing errors do.
- **Listing page** (room, signed-in seeker, no open application):
  - the idle toggle;
  - the "liked you" line plus the toggle;
  - pressed;
  - the mutual banner;
  - inline errors.

  The button is disabled while its request runs. An anonymous visitor sees no control: `ApplySection`'s
  login prompt is the call to action.
- **`/me/likes`**: loading (`Skeleton`), error (`ErrorState` with retry), each section empty
  (`likes.likedMeEmpty` "עוד אין חדרים שאהבו אותך. כדאי להפעיל 'להציג אותי' בפרופיל.", with a link to
  `/me/profile?section=room`; `likes.mineEmpty` "עוד לא אהבת חדרים."), or success. A mutual result inside the
  list shows the banner in place of that card's control.
- **Header**: "לייקים", with the badge `aria-label` from `likes.badgeLabel` ("{{count}} חדרים אהבו אותך").

RTL: logical properties only. The textarea uses `text-start`. The cards stack in one column on mobile.

## Acceptance criteria
- [ ] AC1 Given a saved profile with the room section, When the seeker turns on "להציג אותי…", types "שלום,
  אני סטודנטית" and saves, Then the PUT body has `people_visible: true` and `about_me: "שלום, אני סטודנטית"`.
  When the room section is switched off and the profile saved, Then the body has `people_visible: false` and
  `about_me: null`. A text of 301 characters shows `profile.errors.aboutMeTooLong` and sends nothing. —
  `web/src/features/profile/__tests__/ProfilePage.test.tsx::ac1_people_fields`, plus
  `validate.test.ts::ac1_about_me`
- [ ] AC2 Given `GET /listings/R` with `like: {liked_by_me: false, liked_me: true}`, Then the page shows the
  "liked you" line and "אהבתי את החדר" before the apply section. When it is clicked and the PUT answers
  `{liked: true, application_id: "X"}`, Then "זו התאמה הדדית! הצ'אט נפתח" links to `/chat/X`. —
  `web/src/features/listings/__tests__/ListingPage.test.tsx::ac2_like_back_mutual`
- [ ] AC3 Given `like: {false, false}`, When liked (the PUT answers `{liked: true, application_id: null}`), Then
  after the refetch the button is `aria-pressed="true"`. A click sends the DELETE. Given `like: null`
  (anonymous, an apartment, an open application), no control renders. — `ListingPage.test.tsx::ac3_like_toggle_and_absent`
- [ ] AC4 Given the PUT answering 409 `room_section_required`, Then the alert links to
  `/me/profile?section=room&next=%2Flistings%2FR`. `seeker_profile_required` links without `section=room`.
  `already_applied` refetches the listing. 429 shows the rate-limit text. —
  `ListingPage.test.tsx::ac4_like_errors`
- [ ] AC5 Given `GET /me/likes` answering one `liked_me` and two `mine` rooms, Then `/me/likes` shows "אהבו
  אותך" with one card and "חדרים שאהבתי" with two, each linking to its listing. Liking back the first one
  calls `PUT /listings/{id}/like`. Unliking a `mine` room calls DELETE and refetches. Empty lists show their
  texts. A 500 shows `ErrorState`. — `web/src/features/likes/__tests__/MyLikesPage.test.tsx::ac5_lists_and_states`
- [ ] AC6 Given a seeker with `liked_me` of length 2, Then the header shows "לייקים" with a badge "2". With 0,
  no badge. An owner's header has no "לייקים" and makes no `/me/likes` request. — `web/src/features/auth/__tests__/AuthMenu.test.tsx::ac6_likes_link`
- [ ] AC7 Given an application with `source: 'like'` and `message: null`, Then "my applications" shows the
  "התאמה הדדית" tag and no message paragraph. An `apply` one still shows its message. —
  `web/src/features/applications/__tests__/MyApplicationsPage.test.tsx::ac7_mutual_tag`
- [ ] AC8 An owner opening `/me/likes` is sent away by `RequireSeeker`, as the other seeker routes are. —
  `routes.test.tsx` (one added case)
- [ ] AC9 E2E. A seeker signs up, fills the profile with the room section, turns on "להציג אותי", and saves.
  An owner posts a room and likes the seeker **through the API** (`GET .../people` then `PUT .../like`). The
  seeker sees "לייקים 1" in the header, opens `/me/likes`, sees the room under "אהבו אותך", and likes back.
  Then the mutual banner links to the chat, and "my applications" shows the room with "התאמה הדדית". —
  `web/e2e/likes.spec.ts::ac9_seeker_likes_back_and_chats`
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green (Speed
  rule 7). The e2e result goes in the digest.

## Tests to write
Component: the cases above, using `vi.stubGlobal('fetch', ...)` as the existing page tests do. Unit:
`validate.test.ts` for `about_me`.
E2E: `web/e2e/likes.spec.ts`. `helpers.ts` gains `likePerson(page, listingId, personId)` (owner, through the
API) and `putProfile` options for the room section and `people_visible`. If `0008b` already added helpers, they
are reused.

## Risks / open questions
- `0008b` and `0008c` both edit `helpers.ts`, the listing fixtures and `he.json`. They build one after the other
  (web port 5173, Speed rule 2), so the second rebases.
- The header grows by one link for seekers. On narrow phones it wraps, as the existing links already do. The UX
  reviewer checks 360 px.
- The listing page's like control sits next to the apply section. Both are calls to action, and the copy keeps
  them apart: a like is light ("אהבתי"), applying is the full step with a message. If the UX review finds them
  confusing, a one-line hint "לייק הדדי פותח צ'אט בלי הודעת מועמדות" is the fallback, in the same build.

## Digest (filled by orchestrator after verification)
See `/digest`.
