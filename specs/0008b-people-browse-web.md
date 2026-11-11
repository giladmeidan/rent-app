---
id: 0008b
title: A room lister opens "מחפשים חדר" from "my listings", pages through the people who want a room there, likes them, and lands in the chat when a like turns mutual; mutual matches are tagged in the applicant inbox
status: verified
depends_on: [0008a, 0007c, 0007f]   # 0008a: GET /listings/{id}/people, the lister like PUT/DELETE, MyListingOut.liked_me_count, ApplicantOut.source (and the type-only fixture edits); 0007c: RoomDetails and applicants.room.line; 0007f: features/listings/cardTitle.ts
reviewers: [code, qa, ux]   # ux: a new screen with no artboard; qa: like / unlike / mutual / error states, paging; no security: shows only what 0008a returns (its security review covers the fields and the fact-free reasons); no perf: one paged query
estimate: 1 coder run   # coder Sonnet/medium is enough (no auth, money or data); Opus if the run overflows
---

## Goal
After this ships, an owner with a live room listing opens **"מחפשים חדר"** (people looking for a room) from that
listing's card in `/me/listings`. The link carries a badge, "N אהבו את החדר", when seekers liked the room. The
people page `/me/listings/:id/people` lists person cards, the ones who liked the room first and then by match.
A card has the name, gender and age, the areas and the move-in date, "קצת עליי", the match score with two
fact-free reason chips and the full lines behind "למה ההתאמה?", and the questionnaire answers next to the
flat's behind "עוד פרטים". The owner likes or unlikes each card. When a like turns mutual, a banner says so and
links to the chat that just opened. In the applicant inbox (`0004d`), a mutual match carries the tag
**"התאמה הדדית"** where the message would be.

This serves PRODUCT.md "People & likes" (Gilad, 2026-11-11). It is Dev Plan slice 8, part b. No artboard covers
people browse. The card follows `Inbox.dc.html`'s applicant card anatomy as `0006g` / `0007c` built it: name
line, chips, the score badge and a disclosure. It reuses those components and their classes.

## Scope
**In:**
- `web/src/app/routes.tsx`: `me/listings/:id/people` → `PeoplePage`, inside the existing `RequireOwner`
  group.
- `web/src/features/match/reasons.ts`: `personShort(criterion, kind, person, t)` and `personReason(criterion,
  kind, person, t)`. Both are **fact-free** (verifier finding 1). They reuse the `match.owner.short.*` base
  keys (`agree` / `differ`) for every criterion except `move_in`, which reuses `match.owner.move_in.*` with
  `formatDate(later(person.move_in_date, todayInIsrael()))`. They never use `agreeSmoker`, `agreePet`,
  `agreeLong`, or any owner key that states a fact the card hides (household, pets, smoking, contract,
  parking). One test goes in `features/match/__tests__/reasons.test.ts`.
- `web/src/features/people/` (new):
  - `api.ts`: `PersonOut`, `PeoplePageOut` and `LikeOut` re-exported from `api/schema.d.ts`, and
    `peopleKey(listingId)`.
    - `usePeople(listingId)` is a `useInfiniteQuery` over `?offset=`. It copies `useSearch.ts:14-17`'s
      `getNextPageParam`, including the `last.items.length > 0` guard. Items are de-duplicated by `id` when
      flattened, as `flattenPages` does, because a like can move a person between pages.
    - `useLikePerson(listingId)` / `useUnlikePerson(listingId)` invalidate `peopleKey` and `MY_LISTINGS_KEY`.
      On a mutual like they also invalidate `applicantsKey(listingId)` and `CONVERSATIONS_KEY`
      (`features/chat/useConversations.ts:9`).
    - On 401 they set `ME_KEY` to null, and on 403 they invalidate `ME_KEY`, with no alert. This is the
      pattern of `useSetApplicantStatus.ts:29-35`.
  - `PeoplePage.tsx`:
    - the heading `people.title`, the room's title line from `cardTitle` (`features/listings/cardTitle.ts`),
      the back link `people.back` to `/me/listings`, the list, and `people.loadMore`;
    - the listing comes from `useMyListings` by id. It gives `lifestyle` for the answers panel, the title, and
      whether it is a room. While `useMyListings` loads or fails, the page shows the skeleton / `ErrorState`
      of `ApplicantsPage.tsx:116-125`. An id that is not in the list shows `people.notFound`;
    - the areas come from `useQuery({ queryKey: ['areas'], queryFn: fetchAreas })`, as `ProfilePage.tsx:463`
      does. An id with no name is skipped;
    - it holds the last mutual result `{ name, applicationId }` in state and renders it above the list as a
      `role="status"` region: `people.mutual` and the link `people.toChat` to `/chat/{applicationId}`. It
      survives the refetch that drops the card.
  - `PersonCard.tsx` (`{ person, listing, areaNames, onMutual }`), which shows:
    - `display_name`;
    - the line `applicants.room.line` ("{{gender}} · גיל {{age}}", `0007c`) with the gender label from
      `profile.room.gender.*`. With a null age it shows the gender label alone;
    - `people.areas` ("אזורים: {{areas}}", the names joined with `Intl.ListFormat('he', { type:
      'conjunction' })`) and `people.moveIn` ("כניסה מ־{{date}}", plus `people.flexible` "גמיש" when
      flexible), dates via `formatDate`;
    - `people.aboutMe` ("קצת עליי") followed by the text as plain text, with `whitespace-pre-line`,
      `dir="auto"` and `break-words`, as `applicant-message` does;
    - `MatchBadge` with two chips from `personShort` (top agree and the differ), rendered with `MatchChips`'
      classes, and the full `personReason` lines in a "למה ההתאמה?" disclosure (`applicants.why`);
    - the chip `people.likedMe` "אהב/ה את החדר" when `liked_me`;
    - "עוד פרטים" (`people.moreDetails`) → `RoomDetails` (`0007c`), with `room = { gender, age, lifestyle }`,
      `flat = listing.lifestyle` and `flatIsRoom = true`;
    - the like toggle: a `button` with `aria-pressed={liked_by_me}`. Its label is `people.like` "אהבתי"
      (pressed: `people.liked` "אהבתי ✓", with the accessible name `people.unlikeLabel` "ביטול לייק"). It is
      disabled while its mutation runs. After `mutateAsync` resolves with an `application_id`, it calls
      `onMutual({ name: person.display_name, applicationId })`, as `ApplicantCard`'s `onSettled` does.
- `web/src/features/listings/MyListingsPage.tsx`: on a **room** card whose `listingState(...)` is `'live'`, a
  link `listings.mine.people` "מחפשים חדר" to `/me/listings/{id}/people`. It is placed after the applicants
  link. When `liked_me_count > 0` it carries a badge with the amber "new" token of the applicants badge:
  `listings.mine.peopleLikedOne` "אהב/ה אחד/ת את החדר" for 1, `listings.mine.peopleLiked` "{{count}} אהבו את
  החדר" for more. Apartments and paused or expired rooms get no link.
- `web/src/features/applicants/ApplicantCard.tsx`: when `applicant.source === 'like'`, the message paragraph
  (`data-testid="applicant-message"`) is replaced by the teal tag `applicants.mutual` "התאמה הדדית"
  (`data-testid="applicant-mutual"`).
- `web/src/locales/he.json`. The file has no `_one` / `_other` plurals: singulars are separate keys picked in
  code, as `applications.count.one` / `search.countOne` are.

  | Key | Hebrew |
  | --- | --- |
  | `people.title` | "מחפשים חדר" |
  | `people.count` | "{{count}} מחפשים" |
  | `people.countOne` | "מחפש/ת אחד/ת" |
  | `people.loadMore` | "טעינת עוד" |
  | `people.empty` | "עדיין אין מחפשים שמתאימים לחדר. כשמישהו יפתח את הפרופיל שלו לשותפים או יאהב את החדר, הוא יופיע כאן." |
  | `people.notFound` | "המודעה לא נמצאה" |
  | `people.notLive` | "המודעה לא פעילה כרגע. כדי לראות מחפשים, חדשו או הפעילו אותה." |
  | `people.back` | "חזרה למודעות שלי" |
  | `people.areas` | "אזורים: {{areas}}" |
  | `people.moveIn` | "כניסה מ־{{date}}" |
  | `people.flexible` | "גמיש" |
  | `people.aboutMe` | "קצת עליי" |
  | `people.likedMe` | "אהב/ה את החדר" |
  | `people.like` | "אהבתי" |
  | `people.liked` | "אהבתי ✓" |
  | `people.unlikeLabel` | "ביטול לייק" |
  | `people.mutual` | "זו התאמה הדדית עם {{name}}! הצ'אט נפתח" |
  | `people.toChat` | "לצ'אט" |
  | `people.moreDetails` | "עוד פרטים" |
  | `people.errors.alreadyApplied` | "כבר הגיש/ה מועמדות לחדר — אפשר לראות אותו/ה בתיבת המועמדויות" |
  | `people.errors.toApplicants` | "לתיבת המועמדויות" |
  | `people.errors.gone` | "הפרופיל הזה כבר לא זמין" |
  | `people.errors.rateLimited` | "יותר מדי לייקים בזמן קצר. נסו שוב מאוחר יותר." |
  | `listings.mine.people` | "מחפשים חדר" |
  | `listings.mine.peopleLiked` | "{{count}} אהבו את החדר" |
  | `listings.mine.peopleLikedOne` | "אהב/ה אחד/ת את החדר" |
  | `applicants.mutual` | "התאמה הדדית" |
- Fixtures: `web/src/features/people/__tests__/fixtures.ts` `person(overrides)`. The type-only fixture
  additions (`source`, `liked_me_count`, `people_visible`, `about_me`) land with `0008a`, which regenerates the
  client.

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
- **loading** (the listing or the first page): `Skeleton`, three card-shaped blocks with `aria-busy`, as
  `ApplicantsPage`.
- **error**: `ErrorState` with retry.
- **404** (`not_found`: not the owner's, an apartment, unknown, or missing from `useMyListings`):
  `people.notFound` and the back link.
- **409** `listing_not_live`: `people.notLive` and the back link.
- **empty** (`total` 0): `EmptyState` with `people.empty`.
- **success**: the cards, and `people.count` (or `people.countOne`) above them. `people.loadMore` appears
  while pages remain, and is disabled while fetching.
- **like / unlike errors** show inline on the card (`role="alert"`) and refetch the page:
  - `already_applied`: `people.errors.alreadyApplied`, with the link `people.errors.toApplicants` to
    `/me/listings/:id/applicants`;
  - 404 (like or unlike): `people.errors.gone`;
  - 409 `listing_not_live`: `people.notLive`;
  - `rate_limited`: `people.errors.rateLimited`;
  - 401 / 403: no alert (see `api.ts`);
  - anything else: `common.error`.
- Unlike has no confirm, because it is reversible.

RTL: logical classes only (`ms-`, `me-`, `ps-`, `pe-`, `text-start`). The chips wrap. `about_me` uses
`dir="auto"`. Mobile is one column and desktop is `max-w-[640px]`, as the inbox.

## Acceptance criteria
- [ ] AC1 Given `GET /listings/L/people` answering two persons (`P1` with `liked_me: true` and age 27, `P2`
  with a null age), `total` 2, Then the page renders two cards in that order:
  - `P1` has the chip "אהב/ה את החדר" and the line "אישה · גיל 27"; `P2`'s line is "גבר" alone;
  - each shows "אזורים: גבעתיים ורמת גן", "כניסה מ־…", the about-me text, the score badge and the agree chip
    from `match.owner.short.budget.agree`;
  - no card shows any smoking, pets, household, contract or parking fact;
  - "עוד פרטים" opens `RoomDetails` with the flat's answers.

  — `web/src/features/people/__tests__/PeoplePage.test.tsx::ac1_cards`, plus `reasons.test.ts::ac1_person_reasons_fact_free`
- [ ] AC2 Given `total` 25 and a first page of 20, When "טעינת עוד" is clicked, Then a request with
  `offset=20` is made, 25 cards show, and the button is gone. A person returned on both pages renders once. —
  `PeoplePage.test.tsx::ac2_load_more_dedup`
- [ ] AC3 When the like on `P2` is clicked and the PUT answers `{liked: true, application_id: null}`, Then the
  button is `aria-pressed="true"` after the refetch. A second click sends the DELETE and returns the button to
  `aria-pressed="false"`. — `PeoplePage.test.tsx::ac3_like_unlike`
- [ ] AC4 When the like on `P1` answers `{liked: true, application_id: "X"}`, Then the `role="status"` banner
  "זו התאמה הדדית עם …! הצ'אט נפתח" with a link to `/chat/X` is shown, and stays after the refetch drops
  `P1`. — `PeoplePage.test.tsx::ac4_mutual_banner`
- [ ] AC5 Given the like answering 409 `already_applied`, Then the card shows the alert with a link to the
  applicants page. Given 429, the rate-limit text. Given 404 on a like or an unlike, the "no longer
  available" text. Given 409 `listing_not_live`, the not-live text. Each refetches the page. Given 401, no
  alert, and `ME_KEY` is null. — `PeoplePage.test.tsx::ac5_like_errors`
- [ ] AC6 Given the page GET answering 404, 409 `listing_not_live`, a 500, or `total` 0, Then it shows,
  respectively, the not-found text, the not-live text, `ErrorState` with a working retry, or the empty state.
  Given an id missing from `useMyListings`, the not-found text. — `PeoplePage.test.tsx::ac6_page_states`
- [ ] AC7 Given `/me/listings` with a live room (`liked_me_count` 2), a live room with `liked_me_count` 1, a
  paused room and an apartment, Then only the live rooms have "מחפשים חדר", linking to
  `/me/listings/{id}/people`, with the badges "2 אהבו את החדר" and "אהב/ה אחד/ת את החדר". With
  `liked_me_count` 0 the link shows without a badge. — `web/src/features/listings/__tests__/MyListingsPage.test.tsx::ac7_people_link`
- [ ] AC8 Given an inbox applicant with `source: 'like'` and `message: null`, Then the card shows the
  "התאמה הדדית" tag and no message paragraph. An `apply` applicant still shows its message.
  — `web/src/features/applicants/__tests__/ApplicantsPage.test.tsx::ac8_mutual_tag`
- [ ] AC9 A seeker opening `/me/listings/L/people` is turned away by `RequireOwner`: add
  `/me/listings/${A.id}/people` to `PATHS` and `TITLES` in
  `web/src/features/listings/__tests__/RequireOwner.test.tsx::ac1_owner_only_routes`.
- [ ] AC10 E2E. An owner posts a room. A seeker signs up, `PUT`s a profile with a room section and
  `people_visible: true` (`putProfile` overrides), and likes the room **through the API** (`0008c` builds the
  seeker UI). The owner opens "my listings", sees "אהב/ה אחד/ת את החדר", opens the people page, sees the
  seeker's card with "אהב/ה את החדר", and clicks "אהבתי". Then the mutual banner shows, "לצ'אט" opens the
  thread, and the inbox lists the seeker with "התאמה הדדית". — `web/e2e/people.spec.ts::ac10_owner_likes_back_and_chats`
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green (Speed
  rule 7). The e2e result goes in the digest.

## Tests to write
Component: `PeoplePage.test.tsx` AC1–AC6, using `vi.stubGlobal('fetch', ...)` as `ApplicantsPage.test.tsx`
does, plus the `MyListingsPage`, `ApplicantsPage` and `RequireOwner` cases (AC7–AC9). Unit: `reasons.test.ts`.
E2E: `web/e2e/people.spec.ts`, reusing `helpers.ts` (`signUpOwner`, `postListing` with room overrides,
`putProfile` overrides). A helper `likeRoom(page, listingId)` (seeker, through the API) is added.

## Risks / open questions
- No artboard. The card copies the inbox card's anatomy, and the UX reviewer judges it against
  `Inbox.dc.html`.
- `RoomDetails` comes from `0007c`. If its props differ when this builds, adapt the call, not `RoomDetails`.
- Fact-free chips still say "smoking differs" for a no-smoking room. That reveals that an opted-in seeker
  smokes. `0008a`'s Risks accepts this (the inbox shows it outright on apply), and its security review
  confirms or rejects. If rejected there, `personShort` drops those criteria, which is a one-line change here.
- The mutual banner lives in page state. It is lost on reload, which is fine: the chat and the inbox tag
  remain.

Spec-verifier round 1 rejected with 4 majors and 5 minors. All are applied. Finding 3 (type-only fixture edits)
was moved into `0008a`. The second round is waived (one verifier round, Gilad).

## Digest (filled by orchestrator after verification)
    Spec 0008b - People browse web (lister)   (verified, Slice 8; depends on 0008a, 0007c, 0007f)
    What a user can do after this: from "המודעות שלי" a room lister opens "מחפשים חדר", sees person cards (liked-me
             first, then by match), likes them, and lands in the chat when it turns mutual; the inbox tags mutual
             matches "התאמה הדדית".
    Decisions I need from you: none.
    KPIs this slice moves: share of room listers who like at least one person; mutual matches per room.
    Acceptance targets: lint/test/i18n/build clean + make e2e green locally; reason chips are fact-free (no
             smoking/pets/household facts on a card).
    Risks: no artboard - mitigation: reuses the inbox card's anatomy and components; UX review against Inbox.dc.html.
    Reviewers: code, qa, ux   Estimated: 1 coder run (Sonnet/medium)
    Links: specs/0008b-people-browse-web.md - PRODUCT.md "People & likes" - design/screens-v1/Inbox.dc.html
