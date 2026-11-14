---
id: 0010m
title: שוק השותפים has two separate streams — people like people to search together (your own card needed to see anyone), and a room's lister invites seekers who answer by applying; invites live with room applications, not with likes
status: in-progress
depends_on: []   # 0010h/0010i/0010l done (PR #84), #87 merged
reviewers: [code, qa, ux]   # qa: market people tab, likes page and "my activity" end to end; ux: two screens change content and the nav badge moves. No security: the API change only narrows who may browse (a live room alone no longer opens GET /people or /me/people-likes), adds no endpoint, field or data path, and the invites move shows the caller's own GET /me/likes rows in a new place
estimate: 1 coder run, medium   # coder Sonnet/high: one API access rule narrows (no migration, no new endpoint); the rest is web copy and moving one list. ~30 files, most of them tests and mocks
---

## Goal
After this ships the market has two streams that never mix (PRODUCT.md "People & likes", changed 2026-11-14):

1. **People ↔ people, to search together.** Likes, a mutual like opens a direct chat (0010h/0010i, unchanged).
   Only someone showing their **own card** sees and likes people (`/market/people`, `/me/likes`). A live room is
   no longer a ticket into this stream.
2. **Room ↔ seeker.** The seeker **applies** to a room (0010l); the room's lister **invites** a seeker from the
   room's own people page (`/me/listings/:id/people`). Everything about this stream says "invite" / "application",
   never "like", and a seeker's invites show next to their room applications.

Why: a lister with a live room and no card could browse `/market/people` (a live room was a browse ticket), but
every like there returned 403 `card_required` and the nudge sent them to fill "what I am looking for", that is,
to become a seeker. The lister's real tool, the room's invite page, needs no card. The fix is to separate the two
streams, not to loosen the card rule (a liked person must be able to see the liker's card to like back, Q-B
2026-11-13).

## Scope
**In:**
- API: the people-browse ticket becomes the caller's own visible card only (`GET /people`,
  `GET /me/people-likes`); a live room no longer counts. `Viewer.has_live_room`, `Viewer.ticket` and the
  `live_room` EXISTS go.
- Web, `/market/people`: the 403 nudge is reworded for stream 1, and an account with a live room also gets a
  link to its room's invite page.
- Web, room's people page (`/me/listings/:id/people`): the lister's action reads "invite", not "אהבתי".
- Web, `/me/likes`: people only (stream 1). The "rooms that liked you" section (invites) moves to the room
  applications panel of `/market/mine` as "הזמנות לחדרים". The invite count moves from the "לייקים" nav tab to
  the market's "הפעילות שלי" tab.
- Web, profile: `profile.looking.hint` loses "לסמן לייק לחדר" (the seeker's room-like is gone since 0010l).
- Tests, e2e and `make screens` mocks that cover the changed paths.
- `specs/PRODUCT.md` "People & likes" and "שוק השותפים" rows (done by the orchestrator with this spec).

**Out:**
- Data: no migration. Invites stay `room_pairs.lister_liked_at`, person likes stay `person_pairs`, applications
  unchanged; stored rows keep working and only show in a new place.
- API paths and names: `GET /me/likes` (lists invites) and `PUT` / `DELETE /listings/{id}/people/{person_id}/like`
  (the lister's invite) keep their paths, schemas and the shared `rl:like:*` limit. A rename to `/invite(s)` is
  cosmetic and costs a client regen plus every mock; not now. Code identifiers that follow the API names
  (`liked_by_me`, `useLikePerson`, `likePerson`, `MY_LIKES_KEY`, `useMyLikes`) stay.
- A "liked you" count on the "לייקים" tab for person likes: not added (the tab simply has no count).
- Apartments: unchanged (the apartments' "הפעילות שלי" tab gets no count and never requests `/me/likes`).

**New dependencies:** none.

## Data
None.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/people` | signed in **and** own visible card (`people_visible`) | unchanged | unchanged | 403 `card_required` without a visible card, **also with a live room** (was: a live room was enough); 401, 429 unchanged (the limiter still counts first, so a refused call counts) |
| GET | `/me/people-likes` | signed in and own visible card | — | unchanged | 403 `card_required` as above (was: a lister with a live room and no card got three empty lists) |
| PUT | `/people/{card_id}/like` | signed in and own visible card | — | unchanged | unchanged (already card only) |
| GET | `/listings/{id}/people`, PUT/DELETE `/listings/{id}/people/{person_id}/like`, GET `/me/likes` | unchanged | — | unchanged | unchanged |

Code (`api/app/services/market_people.py`, `api/app/routers/market_people.py`):
- `Viewer` loses `has_live_room` and the `ticket` property; `browse` and `my_people_likes` check
  `viewer.people_visible`, as `like` already does (one `CardRequiredError` raise per entry point). `_viewer`
  loses the `live_room` EXISTS and its label: still one SELECT (AC13's statement counts hold). The imports
  `Listing` and `search_service` are used only there: both go.
- Rewrite the module docstring's viewer and ticket bullets ("one's own visible card"; drop `has_live_room`, "or
  a live room" and the "a live room alone lets you browse but not like" aside; keep the Q-B reason as the reason
  for the one rule), `CardRequiredError`'s docstring ("no visible card"), the `browse` / `my_people_likes`
  docstrings, the router module docstring (lines 6–10: the entry ticket and the like's "a live room" aside) and
  `_CARD_REQUIRED`'s description ("card_required: the caller shows no card", as `like_person`'s already says).
  Note in `_viewer`'s docstring that `gender` is always set for a carded viewer. `matching.fit.person_fit`
  keeps its NULL-viewer handling (its only caller is `_candidate`; `api/tests/test_person_fit.py` covers it
  directly; harmless, not worth a change).
- Run `make client` (descriptions change in `web/src/api/schema.d.ts`).

## UI
- **`/market/people`** (`web/src/features/people/MarketPeoplePage.tsx`): on 403 the `EmptyState` says
  `market.people.cardRequired` = "כאן אנשים מחפשים שותפים לחיפוש דירה ביחד. כדי לראות אותם ולסמן לייק, צריך
  להציג את הכרטיס שלך בשוק השותפים." with the existing `market.people.toProfile` button. Below it, a small
  component rendered **only in the 403 branch** (so `GET /me/listings` is requested only then) calls
  `useMyListings` (`features/listings/useMyListings.ts`, existing) and keeps the rooms that are live by the test
  `MyListingsPage` uses for its people button: `listing.listing_type === 'room' && listingState(listing, new
  Date()) === 'live'` (`listingState` from `features/listings/StatusBadge.tsx`). With at least one, a line and a
  secondary button follow: `market.people.roomHint` = "יש לך חדר להשכיר? מזמינים מועמדים מתוך העמוד של החדר."
  and `market.people.toRoomPeople` = "למחפשים לחדר שלך", linking to `/me/listings/{id}/people` for one live room,
  or to `/market/mine` for two or more. Loading or failed my-listings, or no live room: no line (never blocks the
  nudge). `market.people.likeNeedsCard` stays (a card hidden mid-session can still 403 a like in
  `MarketPersonCard`).
- **Room's people page** (`features/people/PersonCard.tsx`, `PeoplePage.tsx`): the toggle's label key
  `people.like` ("אהבתי") becomes `people.invite` = "הזמנה להגיש מועמדות" (same `aria-pressed` toggle and ✓);
  its 429 alert uses a new key `people.errors.inviteRateLimited` = "יותר מדי הזמנות בזמן קצר. נסו שוב מאוחר
  יותר.". **`people.errors.rateLimited` stays as it is**: `MarketPersonCard.tsx` (person likes, stream 1) shows
  it too. The page and my-listings button titles ("מחפשים חדר") stay. No user-facing string on this page says
  like/לייק/אהבתי afterwards; code identifiers stay (Out).
- **Invites move** from `features/likes/MyLikesPage.tsx` to the room panel of
  `features/applications/MyApplicationsPage.tsx`. Move `RoomList` (and what only it uses: `ListingCard`,
  `MatchBadge`, `MatchChips`, `todayInIsrael`, `LikedRoomOut`, `hasLooking`) with it into an `InvitesSection`
  that `MyApplications` renders **only when `type === 'room'`** (hooks are not conditional: the section is its
  own component), so `/me/applications` (apartments) never requests `/me/likes`. The section calls
  `useMyLikes()`; it renders only when `liked_me` has at least one invite: a `<section aria-labelledby>` with an
  `<h2>` `applications.invites.title` = "הזמנות לחדרים", the line `applications.invites.hint` = "המפרסמים בחרו
  בך — פנייה מהעמוד של החדר תפתח צ'אט מיד.", and the cards (`ListingCard titleAs="h3"`, linking to the room
  page, match badge and chips as today). The profile for the chips (`useProfile` + `hasLooking`, as on the likes
  page today) is read inside the rendered section, so an empty invites list requests no profile. It sits above
  the panel's body (above the applications' loading, error, empty state and list). Loading, error or zero
  invites render nothing (no skeleton, no retry, no empty state) and never block the applications. Grid inside
  the panel's 720px reading column: `grid grid-cols-1 items-start gap-4 md:grid-cols-2` (never three across).
- **`/me/likes`** becomes people only: `RoomList`, the rooms section, `useMyLikes` and the rooms' loading /
  error / empty branches leave the page; `PeopleSections` (with its 403 nudge), the `MutualBanner` and the
  `gone` alert stay, and `useProfile` stays for `viewerLifestyle`. Update its docstring.
- **Nav** (`features/auth/AuthMenu.tsx`, `features/likes/LikesNavLink.tsx`): the "לייקים" tab loses the count
  (`LikesNavLink` no longer calls `useMyLikes`; a plain `NavTab`, or inline it into `AuthMenu` and delete the
  file). A new `MarketMineNavLink` (in `features/likes/`, built as `LikesNavLink` is today: `useMyLikes()`,
  count = `liked_me.length`, a pending or failed list shows no count) replaces the market's plain "הפעילות שלי"
  `NavTab`; `AuthMenu` renders it only when `side === 'market'`, so the set of `/me/likes` requests per side is
  unchanged (the existing nav mocks of `/me/likes` stay valid). Its `countLabel` is
  `market.mine.invitesBadge_one` = "הזמנה אחת לחדר", `_two` = "2 הזמנות לחדרים", `_other` = "{{count}} הזמנות
  לחדרים"; its `to` is `/market/mine?tab=applications` while the count is above 0, else `/market/mine` as now
  (`NavLink`'s current-page match ignores the query). The apartments side keeps its plain tab.
- **Invalidation**: `useApply.ts` already invalidates `MY_LIKES_KEY` on a room's 201 (line 54); keep it and
  update its comment ("the header's badge" → "the invites section and the הפעילות שלי badge"). The badge and the
  section read the same query.
- **Profile** (`features/profile/ProfilePage.tsx`): `profile.looking.hint` = "נדרש כדי להגיש מועמדות ולקבל ציון
  התאמה." (drops "לסמן לייק לחדר").
- i18n: add `people.invite`, `people.errors.inviteRateLimited`, `market.people.roomHint`,
  `market.people.toRoomPeople`, `applications.invites.title`, `applications.invites.hint`,
  `market.mine.invitesBadge_one/_two/_other`; reword `market.people.cardRequired`, `profile.looking.hint`;
  delete `people.like`, `likes.likedMe`, `likes.likedMeEmpty`, `likes.badgeLabel_one/_two/_other` and
  `likes.toProfile` (only the rooms section uses it). Keep `people.errors.rateLimited`, `market.people.like`,
  `likes.title`, `likes.people.*`. `make i18n-check` passes (`locales/__tests__/plurals.test.ts` already lists
  `likes.badgeLabel` as a removed base and scans the new family by itself).
- RTL: no new layout (a line and a button in an existing empty state, one section with a 1–2 column grid in an
  existing list; logical properties only). Artboards: none changed.

## Acceptance criteria
- [ ] AC1 Given an account with a live room and no visible card, when it calls `GET /people` or
  `GET /me/people-likes`, then 403 `card_required`; given a visible card (with or without a room), 200 —
  `api/tests/test_market_people.py::test_ac1_entry_ticket` (rewritten)
- [ ] AC2 The gender-rule matrix holds for carded viewers; the no-profile viewer with a live room (`nobody`) is
  gone from it — `test_market_people.py::test_ac2_browse_applies_gender_rule`
- [ ] AC3 Hiding one's card ends browse even with a live room (403 on `GET /people`) —
  `test_market_people.py::test_ac10_hidden_card` (the "a live room gives B the ticket back" step flips)
- [ ] AC4 The lister's invite on the room's people page needs no card (unchanged), so a lister without a card can
  still invite — `api/tests/test_people.py::test_ac6_lister_like_unlike` (its `owner` fixture already has no
  card: no change needed beyond passing)
- [ ] AC5 `/market/people` on 403 shows the reworded nudge; with one live room the room link goes to
  `/me/listings/{id}/people`, with two to `/market/mine`, with none, only paused/expired rooms, or my-listings
  failed there is no room line; a 200 makes no `GET /me/listings` request —
  `web/src/features/people/__tests__/MarketPeoplePage.test.tsx`
- [ ] AC6 The room's people page toggle is named "הזמנה להגיש מועמדות" and its rate-limit alert is
  `people.errors.inviteRateLimited`; `/market/people`'s like 429 still shows `people.errors.rateLimited` —
  `web/src/features/people/__tests__/PeoplePage.test.tsx` (`ac3_like_unlike`, `ac5_like_errors`) and
  `MarketPeoplePage.test.tsx::ac15_like_errors` (unchanged)
- [ ] AC7 `/market/mine?tab=applications` shows "הזמנות לחדרים" (an `h2`, cards `h3`) with the invited rooms
  above the applications when `GET /me/likes` has any, nothing when it has none, errors or is pending (the
  applications still render), and `/me/applications` never shows it nor requests `/me/likes` —
  `web/src/features/applications/__tests__/MyApplicationsPage.test.tsx`
- [ ] AC8 `/me/likes` shows only the people sections (no rooms section, no `/me/likes` request from the page
  itself: with the market nav mocked the only `GET /me/likes` call is the nav badge's) —
  `web/src/features/likes/__tests__/MyLikesPage.test.tsx`
- [ ] AC9 In the market, "לייקים" has no count and links to `/me/likes`; "הפעילות שלי" shows the invite count
  with the `market.mine.invitesBadge_*` sentence (sr-only) and links to `/market/mine?tab=applications` while it
  is above 0, else `/market/mine`; on the apartments side no tab requests `/me/likes` —
  `web/src/features/auth/__tests__/AuthMenu.test.tsx` (`ac3_likes_badge_forms` and `ac6_likes_link` rewritten)
- [ ] AC10 E2E: a lister invites a seeker (through the API, `likePerson` from `e2e/helpers.ts`, as now); the
  seeker sees the badge on "הפעילות שלי" (`he.market.mine.invitesBadge_one`), follows it to
  `/market/mine?tab=applications`, opens the room from "הזמנות לחדרים", applies, sees "התאמה הדדית" and chats —
  `web/e2e/likes.spec.ts::ac9_seeker_answers_invite_and_chats`; axe on `/market/mine?tab=applications` in the
  same run (`expectNoAxeViolations`), replacing its axe on `/me/likes`
- [ ] AC11 E2E: `people.spec.ts::ac10_owner_likes_seeker_applies_and_chats` clicks the button
  `he.people.invite`; `people-market.spec.ts::ac19_people_like_match_chat_remove` (person likes, `/me/likes`)
  passes unchanged plus an `expectNoAxeViolations(b, '/me/likes')` after `b.goto('/me/likes')` (the axe on
  `/me/likes` moves here from `likes.spec.ts`)

## Tests to write
API (`api/tests/`), AC1–AC4. Every test that used a live room as a cardless viewer's ticket:
- `test_market_people.py::test_ac1_entry_ticket` (L239–270): the "live room, no card" step asserts 403 on both
  paths; the paused-room step goes; the card steps stay.
- `test_ac2_browse_applies_gender_rule` (L274–305): drop `nobody` (L288–290) and its final assertion (L300–304).
- `test_ac9_like_guards` (L672): `lister`'s `_browse` (L676) now asserts 403 `card_required`; the like 403 and
  `_like_count == 1` stay.
- `test_ac10_hidden_card` (L714): the last step (L745–748) asserts `_browse(b.caller).json() == CARD_REQUIRED`
  after `_live_room`, and the like still 403s.
- `test_people.py::test_ac12_room_people_browse_rate_limited` (L828): the cardless `owner`'s
  `owner.get("/people")` loop (L841–842) asserts 403 instead of 200 (still counted: the limiter runs first), and
  its comment goes; the counter total and the final 429s stay.
- Stay as they are (the room is the subject, not the ticket): `test_market_people.py` L645 (`ac8`, an
  application chat), L698 (`ac9`, `v` has a card; the shared like limit), L781 and L826 (`ac12b`, the listing
  page's people), `ac13` (L865, `_viewer` still one SELECT; L899 calls `market_service._viewer`, which keeps its
  signature); `ac11_browse_rate_limit` (cardless 403s, unchanged). `test_person_photo.py` (only the room's people
  page and the lister's invite, no `GET /people`), `test_direct_chat.py` (imports `test_people` helpers only),
  `test_flatmates.py` and `test_person_fit.py`: untouched.

Web (vitest), AC5–AC9:
- `people/__tests__/MarketPeoplePage.test.tsx`: `ac15_page_states` (L175, the 403 state) gains the room-line
  cases (mock `GET /me/listings`); `ac15_like_errors` (L288–304) keeps `he.people.errors.rateLimited`.
- `people/__tests__/PeoplePage.test.tsx`: `he.people.like` → `he.people.invite` (L232, L248);
  `he.people.errors.rateLimited` → `he.people.errors.inviteRateLimited` (L304).
- `likes/__tests__/MyLikesPage.test.tsx`: the room tests (`ac11_invites_without_mine_or_like_button`,
  `ac5_empty_error_and_loading`, `ac4_card_heading_level`, `ac3_grid_and_match`, `ac2_cover`) move to
  `MyApplicationsPage.test.tsx` as invites-section tests (or go where the behaviour is gone: the rooms' empty
  state and `likes.toProfile`); `ac4_banner_and_one_mascot` and the L285 assertion no longer use the rooms
  section; the `ac17_people_*` tests stay. `likes/__tests__/fixtures.ts` (`likedRoom`, `myLikes`) is reused.
- `applications/__tests__/MyApplicationsPage.test.tsx`: `renderRooms` mocks `GET /me/likes` (and
  `GET /me/profile` when it has invites); AC7's cases; `ac11_apartments_only` asserts no `/me/likes` call.
- `auth/__tests__/AuthMenu.test.tsx`: `ac3_likes_badge_forms` (L253) and `ac6_likes_link` (L273) move the count
  to the `he.nav.mine` link (`market.mine.invitesBadge` forms, the `?tab=applications` href); the "לייקים" link
  has no number; the apartments block (L333–343) stays.
- Expected to pass unchanged (check): `market/__tests__/MarketMinePage.test.tsx` (already mocks `GET /me/likes`
  with an empty list), `app/__tests__/Layout.test.tsx` (L417, L491: tab labels and hrefs with no count),
  `app/__tests__/queryClient.test.tsx` (L78–95: the 401 on `/me/likes` now comes from the nav badge on the
  market path `/me/likes`; if that path stops requesting it, retarget the case to
  `/market/mine?tab=applications`), `auth/__tests__/routes.test.tsx` (`likes.title` stays),
  `applications/__tests__/ApplySection.test.tsx` (L1217, `MY_LIKES_KEY` invalidation; comment wording only),
  `profile/__tests__/ProfilePage.test.tsx` (L1132, reads the key), `locales/__tests__/plurals.test.ts`.

E2E and `make screens` (AC10, AC11). **E2E runs in CI only** (no local e2e):
- `e2e/likes.spec.ts::ac9_seeker_answers_invite_and_chats` (L48): L132–147 (the "לייקים" badge
  `he.likes.badgeLabel_one`, `/me/likes`, the `he.likes.likedMe` region, axe on `/me/likes`) move to the
  "הפעילות שלי" link and the `he.applications.invites.title` region on `/market/mine?tab=applications`; the
  0009qa layout step (L149–168) is re-measured there: at 1440 the card is at most half the 720px reading column,
  at 390 it fills the column between the 16px gutters with no horizontal scroll; the five-tab bar checks
  (L60–66) stay.
- `e2e/people.spec.ts` L60: `he.people.like` → `he.people.invite`.
- `e2e/people-market.spec.ts`: axe on `/me/likes` (AC11); otherwise unchanged (both people have cards).
- `e2e/market.spec.ts` L164–169: unchanged (a fresh account has no invites, so `he.nav.mine` matches exactly).
- `e2e/screens/market-people.screens.ts`: the mock answers `GET /me/listings` (an empty list by default; an
  unmatched request fails the run); `people-card-required` (L244) keeps its assertions (the key is reworded);
  add `people-card-required-room` (one live room: the hint and the `toRoomPeople` link to
  `/me/listings/{id}/people`).
- `e2e/screens/people.screens.ts`: L203 `he.people.like` → `he.people.invite`; L293
  `he.people.errors.rateLimited` → `he.people.errors.inviteRateLimited`.
- `e2e/screens/seeker-lists.screens.ts`: `06-likes-loading`, `07-likes-error` and `08-likes-empty` go (the rooms
  section no longer has those states); `09-likes-six` becomes an invites state on
  `/market/mine?tab=applications` (`LIKES`, six cards, three match badges, above the applications); the mock
  answers whatever that page requests. Mocks that only stub `GET /me/likes` with `{ liked_me: [] }` for the nav
  (`market-people`, `profile`, `search`, `flatmates`, `chat`, `listing` screens) stay.

## Risks / open questions
- Decided (Gilad 2026-11-14, in chat): likes are only person ↔ person, to search together; the room stream is
  application + invite, kept apart; the invite stays its own record (not an application row).
- Orchestrator's calls inside that direction (Speed rule 9 does not apply; tell Gilad in the digest): invites
  show in the market's room applications panel; the invite badge moves to "הפעילות שלי"; the lister's nudge on
  `/market/people` links to the room's people page; API paths keep "like".
- Risk: a lister who also shows a card sees both streams; nothing changes for them except the copy. A seeker
  whose card is hidden still sees invites (they are on "הפעילות שלי", not gated by the card), which matches the
  0010l decision that an invite survives opting out.
- Risk: `MyApplicationsPage` is shared by apartments and rooms; the invites section must key on `type === 'room'`
  (AC7 checks `/me/applications` makes no `/me/likes` request).
- Risk: "הזמנה" now names two things in the market: a room's invite to a seeker and the flatmates' join link
  (`flatmates.invite.*`, "קישור הזמנה"). The new strings always say "הזמנות לחדרים" / "הזמנה להגיש מועמדות", so
  they read apart; the ux reviewer checks.
- Risk: the web's "live room" (`listingState`) and the API's (`search._public_listings()`) can disagree at the
  edge (e.g. a room expiring this minute); the worst case is a hint link to a people page that answers 409
  `listing_not_live`, which that page already handles.

## Blast radius
`graphify affected` (graph of `main`, 2026-11-14) plus grep for the strings the graph does not hold:
- `Viewer` (services/market_people.py): `_viewer`, `_candidate`, `browse_statement`, `likes_statement`, `browse`,
  `like`, `my_people_likes` (all in Scope, same file); `test_market_people.py::test_ac13_statement_counts_and_plan`
  L899 (builds one via `_viewer`; passes unchanged).
- `_viewer`: `browse`, `like`, `my_people_likes` → routers `browse_people`, `like_person`, `my_people_likes`
  (Scope: docstrings/description only); `ac13` L899 and the `run()` race helper L518 (calls `like`; carded
  people; unchanged).
- `browse()` / `my_people_likes()` / `like()` (service): their routers only, plus `test_market_people.py` `run()`
  for `like` (unchanged). The ticket's tests: `test_market_people.py` `ac1`, `ac2`, `ac9`, `ac10` and
  `test_people.py::test_ac12_room_people_browse_rate_limited` (Tests to write).
- `CardRequiredError`: no graph hits beyond the module; raised in the three service functions, mapped by the
  router's `_card_required()` (Scope).
- `has_live_room` / `.ticket` (grep): only `services/market_people.py` (Scope). `person_fit`: only `_candidate`
  plus `test_person_fit.py` (untouched).
- `MarketPeoplePage`: `routes.tsx` and route-rendering tests (`MarketMinePage.test`, `Layout.test`,
  `queryClient.test`, `SideSwitch.test`, `usePageTitle.test`, `KitPreview.test`, `LandingPage.test`, the two
  `routes.test`s) import it via `AppRoutes` only; none render `/market/people` with a 403, so they are untouched;
  `MarketPeoplePage.test.tsx` and `market-people.screens.ts` (Tests to write).
- `PersonCard` / `PeoplePage`: `PeoplePage.test.tsx`, `RequireOwner.test.tsx` (route guard, no label
  assertion: untouched), `people.spec.ts`, `people.screens.ts` (Tests to write).
- `MyLikesPage`: `routes.tsx`; `MyLikesPage.test.tsx` (Tests to write); the route-rendering tests above
  (untouched; `queryClient.test` L78–95 checked in Tests to write).
- `RoomList`: only `MyLikesPage` (moves to `MyApplicationsPage`, Scope).
- `useMyLikes`: `LikesNavLink` (loses it), `MyLikesPage` (loses it), the new `MarketMineNavLink` and
  `InvitesSection` (Scope); `MY_LIKES_KEY` in `useApply.ts` L54 and `ApplySection.test.tsx` L1217 (unchanged).
- `LikesNavLink` / `AuthMenu`: `Layout.tsx`, `AuthMenu.test.tsx` (Tests to write), `Layout.test.tsx`,
  `listings/__tests__/logout.test.tsx`, `match/__tests__/logout.test.tsx`, `chat/__tests__/harness.tsx` (the
  `/me/likes` requests per side are unchanged, so their mocks hold: untouched).
- `MyApplicationsPage`: `MarketMinePage.tsx` (unchanged; its test already mocks `GET /me/likes`),
  `routes.tsx` (`/me/applications`: apartments, no invites), `MyApplicationsPage.test.tsx` (Tests to write),
  `RequireSeeker.test.tsx`, `LoginPage.test.tsx` `Landing()`, `ListingWizard.test.tsx` (apartments or the
  listings tab: untouched), `OtpForm.test.tsx` L398 and `JoinFlatPage.test.tsx` L308/L349 (only redirect to
  `/market/mine?tab=applications`; an unmocked `/me/likes` renders no section: untouched).
- i18n keys (grep): `people.like` → `PersonCard.tsx:195`, `PeoplePage.test.tsx` L232/L248, `people.spec.ts` L60,
  `people.screens.ts` L203. `people.errors.rateLimited` → `PersonCard.tsx:201` (moves to the new key),
  `MarketPersonCard.tsx:188` and `MarketPeoplePage.test.tsx` L304 (stay), `PeoplePage.test.tsx` L304,
  `people.screens.ts` L293. `likes.likedMe` / `likes.likedMeEmpty` / `likes.toProfile` → `MyLikesPage.tsx`,
  `MyLikesPage.test.tsx`, `likes.spec.ts` L143, `seeker-lists.screens.ts` L169. `likes.badgeLabel*` →
  `LikesNavLink.tsx:26`, `AuthMenu.test.tsx` L285/L297, `likes.spec.ts` L138, `plurals.test.ts` L74/L94 (already
  "removed" lists). `market.people.cardRequired` → `MarketPeoplePage.tsx:84`, `MarketPeoplePage.test.tsx` L194,
  `market-people.screens.ts` L247 (key-based: reword passes). `profile.looking.hint` → `ProfilePage.tsx:463`,
  `ProfilePage.test.tsx` L1132 (key-based). `he.header.likes` / `he.nav.mine` labels → `Layout.test.tsx`,
  `AuthMenu.test.tsx`, `market.spec.ts` L164–169, `likes.spec.ts` L137 (Tests to write where the count moves).

## Digest (filled by orchestrator after verification)
Verified 2026-11-14 (one spec-verifier round, Opus/high; verdict ready, no product question; the verifier
applied its own findings, second round waived).

    Spec 0010m — two streams in שוק השותפים   (verified, one part)
    What a user can do after this: likes are only person ↔ person (your own card needed to see anyone); a
      lister invites from the room's own page ("הזמנה להגיש מועמדות"), and a seeker finds invites under
      הפעילות שלי → מועמדויות לחדרים, with the count on that tab.
    Decisions I need from you: none. Orchestrator calls inside your direction (say if you disagree): invites
      sit with room applications; the badge moves to "הפעילות שלי"; a cardless lister on /market/people gets a
      link to their room's people page; API paths keep "like" (internal, a rename costs a client regen).
    Risks: "הזמנה" also names the flatmates' join link — new strings say "הזמנות לחדרים" / "הזמנה להגיש
      מועמדות", ux checks; the shared applications page must key the invites on rooms only (AC7).
    Verifier changes: a separate rate-limit key so person likes keep "לייקים" wording; one missed test
      (`test_people.py::test_ac12`); exact test lines; components that fetch only when needed (no extra
      /me/likes or /me/listings requests); stale `profile.looking.hint` copy fixed; full blast radius.
    Reviewers: code, qa, ux   Estimated: 1 coder run (Sonnet/high), ~30 files, no migration
