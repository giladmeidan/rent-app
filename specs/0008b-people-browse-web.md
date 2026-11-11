---
id: 0008b
title: A room lister opens "מחפשים חדר" from "my listings", pages through the people who want a room there, likes them, and lands in the chat when a like turns mutual; mutual matches are tagged in the applicant inbox
status: draft
depends_on: [0008a, 0007c]   # 0008a: GET /listings/{id}/people, the lister like PUT/DELETE, MyListingOut.liked_me_count, ApplicantOut.source; 0007c: RoomDetails (the answers panel the person card reuses) and the room line on ApplicantCard
reviewers: [code, qa, ux]   # ux: a new screen with no artboard; qa: like / unlike / mutual / error states, paging; no security: shows only what 0008a returns (its review covers the fields); no perf: one paged query
estimate: 1 coder run   # coder Sonnet/medium is enough (no auth, money or data); Opus if the run overflows
---

## Goal
After this ships, an owner with a live room listing opens **"מחפשים חדר"** (people looking for a room) from that
listing's card in `/me/listings`. The link carries a badge, "N אהבו את החדר", when seekers liked the room. The
people page `/me/listings/:id/people` lists person cards, the ones who liked the room first and then by match.
A card has the name, gender and age, the areas and the move-in date, "קצת עליי", the match score with its
reasons, and the questionnaire answers next to the flat's behind "עוד פרטים". The owner likes or unlikes each
card. When a like turns mutual, the card says so and links to the chat that just opened. In the applicant inbox
(`0004d`), a mutual match carries the tag **"התאמה הדדית"** where the message would be.

This serves PRODUCT.md "People & likes" (Gilad, 2026-11-11). It is Dev Plan slice 8, part b. No artboard covers
people browse. The card follows `Inbox.dc.html`'s applicant card anatomy as `0006g` / `0007c` built it: name
line, chips, the score badge and a disclosure. It reuses those components, not new look-alikes.

## Scope
**In:**
- `web/src/app/routes.tsx`: `me/listings/:id/people` → `PeoplePage`, inside the existing `RequireOwner`
  group.
- `web/src/features/people/` (new):
  - `api.ts`: `PersonOut`, `PeoplePageOut` and `LikeOut` types re-exported from `api/schema.d.ts`.
    `peopleKey(listingId)`. `usePeople(listingId)` is a `useInfiniteQuery` over `?offset=`, with
    `getNextPageParam` = loaded count < `total` ? loaded count : undefined, as `features/search` pages.
    `useLikePerson(listingId)` / `useUnlikePerson(listingId)` are mutations that invalidate `peopleKey` and
    `['me', 'listings']`. On a mutual like they also invalidate the inbox key (`applicantsKey`) and the chat
    list key (`features/chat`).
  - `PeoplePage.tsx`: the heading "מחפשים חדר", the room's title line from `cardTitle` (`0007f`,
    `features/listings/cardTitle.ts`), the back link to `/me/listings`, the list and "טעינת עוד". The listing
    comes from `useMyListings` by id, which gives `lifestyle` for the answers panel, the title and whether it
    is a room.
  - `PersonCard.tsx`, which shows:
    - `display_name`;
    - "אישה · 27" (gender label from `profile.room.gender.*`, the age left out when null);
    - the areas' names (`useAreas`), the move-in date with "גמיש" when flexible
      (`features/listings/format.ts`'s `formatDate`), and `about_me` as plain text with `whitespace-pre-line`;
    - `MatchBadge` with `MatchChips` / reasons in the **owner** voice, as `ApplicantCard` uses them
      (`features/match/reasons.ts`);
    - a chip **"אהב/ה את החדר"** when `liked_me`;
    - "עוד פרטים" → `RoomDetails` (`0007c`), with `room = {gender, age, lifestyle}`, `flat =
      listing.lifestyle`, `flatIsRoom = true`;
    - the like toggle: a `button` with `aria-pressed={liked_by_me}`. Its label is "אהבתי" (not pressed) or
      "אהבתי ✓" with the accessible name "ביטול לייק" (pressed). On a mutual like it is replaced by the
      banner "זו התאמה הדדית! הצ'אט נפתח" and a link "לצ'אט" to `/chat/{application_id}`. The banner stays
      after the refetch removes the card from the list, rendered from the mutation result above the list.
- `web/src/features/listings/MyListingsPage.tsx`: on a **room** card whose status is live (`active` and not
  expired, the same test the card uses for its pause button), a link "מחפשים חדר" to
  `/me/listings/{id}/people`. When `liked_me_count > 0` it carries the badge "{{count}} אהבו את החדר", with
  the amber "new" token of the applicants badge. It is placed after the applicants link. Apartments and paused
  or expired rooms get no link.
- `web/src/features/applicants/ApplicantCard.tsx`: when `applicant.source === 'like'`, the message paragraph
  (`data-testid="applicant-message"`) is replaced by a teal tag **"התאמה הדדית"**
  (`data-testid="applicant-mutual"`). It is not rendered for a null message any more.
- `web/src/locales/he.json`: the `people.*` keys (UI), `applicants.mutual`, and `listings.mine.people` /
  `listings.mine.peopleLiked`. `make i18n-check` stays green.
- Fixtures: `web/src/features/people/__tests__/fixtures.ts` `person(overrides)`, and
  `features/applicants/__tests__/fixtures.ts` `applicant()` gains `source: 'apply'`. Listing fixtures gain
  `liked_me_count: 0`.

**Out:**
- The seeker side (profile opt-in, liking rooms, `/me/likes`): `0008c`.
- Filters and sort choices on the people page (`0008a` Out).
- Hiding a person, or answering a like with "no" (FOLLOWUPS from `0008a`).
- Flatmates (`0008d` / `0008e`).

**New dependencies:** none.

## Data
None (web only).

## API
Consumes `0008a`: `GET /listings/{id}/people?offset=`, `PUT`/`DELETE /listings/{id}/people/{person_id}/like`,
`GET /me/listings` (`liked_me_count`), and the inbox's `source`. The client is regenerated with `make client`.

## UI
`/me/listings/:id/people`:
- **loading**: `Skeleton`, three card-shaped blocks with `aria-busy`, as `ApplicantsPage`.
- **error**: `ErrorState` with retry.
- **404** (`not_found`: not the owner's, an apartment, unknown): "המודעה לא נמצאה" and the back link.
- **409** `listing_not_live`: "המודעה לא פעילה כרגע. כדי לראות מחפשים, חדשו או הפעילו אותה." and the back link.
- **empty** (`total` 0): `EmptyState`, "עדיין אין מחפשים שמתאימים לחדר. כשמישהו יפתח את הפרופיל שלו לשותפים
  או יאהב את החדר, הוא יופיע כאן."
- **success**: the cards and "{{count}} מחפשים" above them. "טעינת עוד" appears while pages remain, and is
  disabled while fetching.
- **like errors** show inline on the card (`role="alert"`) and refetch the page:
  - `already_applied`: "כבר הגיש/ה מועמדות לחדר — אפשר לראות אותו/ה בתיבת המועמדויות", with a link to
    `/me/listings/:id/applicants`;
  - `not_found`: "הפרופיל הזה כבר לא זמין";
  - `rate_limited`: "יותר מדי לייקים בזמן קצר. נסו שוב מאוחר יותר.";
  - anything else: `common.error`.
- The like button is disabled while its mutation runs. Unlike has no confirm, because it is reversible.

RTL: logical classes only (`ms-`, `me-`, `ps-`, `pe-`, `text-start`). The chips wrap. Mobile is one column and
desktop is `max-w-[640px]`, as the inbox.

i18n keys (Hebrew in `he.json`; the plural forms follow the file's existing `_one` / `_other` pattern):
- `people.title`, `people.count`, `people.loadMore`, `people.empty`, `people.notFound`, `people.notLive`,
  `people.back`;
- `people.likedMe`, `people.like`, `people.liked`, `people.unlikeLabel`, `people.mutual`,
  `people.toChat`, `people.moreDetails`, `people.flexible`;
- `people.errors.alreadyApplied`, `people.errors.toApplicants`, `people.errors.gone`,
  `people.errors.rateLimited`;
- `listings.mine.people`, `listings.mine.peopleLiked`;
- `applicants.mutual`.

## Acceptance criteria
- [ ] AC1 Given `GET /listings/L/people` answering two persons (`P1` with `liked_me: true`, `P2` without),
  `total` 2, Then the page renders two cards in that order. `P1` has the chip "אהב/ה את החדר". Each shows
  the name, "אישה · 27" (and "גבר" alone when the age is null), the area names, the move-in date, the about-me
  text, and the score badge with reasons in the owner voice. "עוד פרטים" opens `RoomDetails` with the flat's
  answers. — `web/src/features/people/__tests__/PeoplePage.test.tsx::ac1_cards`
- [ ] AC2 Given `total` 25 and a first page of 20, When "טעינת עוד" is clicked, Then a request with
  `offset=20` is made, 25 cards show, and the button is gone. — `PeoplePage.test.tsx::ac2_load_more`
- [ ] AC3 When the like on `P2` is clicked and the PUT answers `{liked: true, application_id: null}`, Then the
  button is `aria-pressed="true"` after the refetch. A second click sends the DELETE and returns the button to
  `aria-pressed="false"`. — `PeoplePage.test.tsx::ac3_like_unlike`
- [ ] AC4 When the like on `P1` answers `{liked: true, application_id: "X"}`, Then the banner "זו התאמה
  הדדית! הצ'אט נפתח" with a link to `/chat/X` is shown, and stays after the refetch drops `P1` from the list.
  — `PeoplePage.test.tsx::ac4_mutual_banner`
- [ ] AC5 Given the like answering 409 `already_applied`, Then the card shows the alert with a link to the
  applicants page. Given 429, the rate-limit text. Given 404, the "no longer available" text. Each refetches
  the page. — `PeoplePage.test.tsx::ac5_like_errors`
- [ ] AC6 Given the page GET answering 404, 409 `listing_not_live`, a 500, or `total` 0, Then it shows,
  respectively, the not-found text, the not-live text, `ErrorState` with a working retry, or the empty state.
  — `PeoplePage.test.tsx::ac6_page_states`
- [ ] AC7 Given `/me/listings` with a live room (`liked_me_count` 2), a paused room and an apartment, Then only
  the live room has "מחפשים חדר", linking to `/me/listings/{id}/people`, with the badge "2 אהבו את החדר". With
  `liked_me_count` 0 the link shows without a badge. — `web/src/features/listings/__tests__/MyListingsPage.test.tsx::ac7_people_link`
- [ ] AC8 Given an inbox applicant with `source: 'like'` and `message: null`, Then the card shows the
  "התאמה הדדית" tag and no message paragraph. An `apply` applicant still shows its message.
  — `web/src/features/applicants/__tests__/ApplicantsPage.test.tsx::ac8_mutual_tag`
- [ ] AC9 A seeker opening `/me/listings/L/people` is redirected by `RequireOwner`, as the other owner routes
  are. — `web/src/features/auth/__tests__/routes.test.tsx` (one added case)
- [ ] AC10 E2E. An owner posts a room. A seeker signs up, `PUT`s a profile with a room section and
  `people_visible: true`, and likes the room **through the API** (`0008c` builds the seeker UI). The owner
  opens "my listings", sees "1 אהבו את החדר", opens the people page, sees the seeker's card with "אהב/ה את
  החדר", and clicks "אהבתי". Then the mutual banner shows, "לצ'אט" opens the thread, and the inbox lists the
  seeker with "התאמה הדדית". — `web/e2e/people.spec.ts::ac10_owner_likes_back_and_chats`
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green (Speed
  rule 7). The e2e result goes in the digest.

## Tests to write
Component: `PeoplePage.test.tsx` AC1–AC6, using `vi.stubGlobal('fetch', ...)` as `ApplicantsPage.test.tsx`
does, plus the `MyListingsPage`, `ApplicantsPage` and `routes` cases (AC7–AC9).
E2E: `web/e2e/people.spec.ts`, reusing `helpers.ts` (`signUpOwner`, `postListing` with a room body,
`putProfile`). A helper `likeRoom(page, listingId)` is added to `helpers.ts`.

## Risks / open questions
- No artboard. The card copies the inbox card's anatomy, and the UX reviewer judges it against
  `Inbox.dc.html`.
- `RoomDetails` comes from `0007c`. If its props differ when this builds, adapt the call, not `RoomDetails`.
- The mutual banner is held in component state from the mutation result. It is lost on reload, which is fine:
  the chat and the inbox tag remain.
- Gendered copy uses the "/" forms, as the rest of `he.json` does (e.g. "הגיש/ה").

## Digest (filled by orchestrator after verification)
See `/digest`.
