---
id: 0010i
title: In שוק השותפים the אנשים tab shows people's cards with a like button, the likes page lists people who liked you, people you liked and your matches, a mutual like leads to the direct chat, and a match can be removed from the chat
status: in-progress
depends_on: [0010h, 0010k]   # 0010h: GET /people, the like endpoints, /me/people-likes, /me/matches; 0010k: the shared `Avatar`. 0010g (via 0010h): direct chats in the chat screens
reviewers: [code, qa, ux]   # qa: page states, the like toggle and the cache, remove-match flow; ux: new market people tab, card, likes sections, remove-match confirm
estimate: 1 coder run   # coder Opus/high is not needed: web only, no auth or data rules of its own (Sonnet/high is fine; Speed rule 6)
---

## Goal
After this ships, a signed-in person in שוק השותפים opens the inner **אנשים** tab (`/market/people`). They page
through other people's cards: name, photo, age, gender, areas, move-in date, "about me", and their questionnaire
answers compared with the viewer's own (**no score**, Q15). They like or unlike a card. A mutual like shows a
banner that leads to the direct chat. The likes page gains three people sections (people who liked you, people
you liked, matches). In a direct chat, "הסרת ההתאמה" removes the match after a confirm.

The room-side people page gains a 429 state, because `0010h` puts the browse rate limit on it too. This is
the web half of Slice 10, Step 5 part two. The API and its rules are `specs/0010h-people-browse-api.md` (read its
Rules, API and Data first); MARKET-PLAN.md section 7 "People (0010h)".

## Scope
**In:**
- **Web**:
  - `web/src/features/people/PeoplePage.tsx` (room side, :106): a 429 branch replaces the generic
    `ErrorState`, whose retry would only make more 429 calls. It shows `t('people.browseRateLimited')`
    with no retry button (verifier finding 7).
  - `web/src/app/routes.tsx`: route `market/people` → `MarketPeoplePage`, behind the signed-in guard that
    0010b's market routes use. `side.ts`'s `/market/*` already covers it.
  - `web/src/features/people/MarketViewSwitch.tsx` (new) is the inner חדרים / אנשים switch:
    - two links to `/market` and `/market/people`, `aria-current="page"` on the active one;
    - the same pill look as 0010a's header switch, a `nav` with `aria-label` `t('market.view.label')`;
    - rendered at the top of the `/market` rooms search (the `type="room"` `SearchPage`) and of
      `MarketPeoplePage`;
    - signed out, אנשים goes to `/login?next=/market/people`.
  - `web/src/features/people/MarketPeoplePage.tsx` (new). States:
    - **loading:** three `Skeleton` cards;
    - **403 `card_required`:** an `EmptyState` with `t('market.people.cardRequired')` and a button
      `t('market.people.toProfile')` to `profileHref('/market/people', 'about', 'looking')` (0010c's
      helper; a card needs both parts);
    - **empty:** `t('market.people.empty')`;
    - **error:** `ErrorState` with retry;
    - **429:** the text `t('people.browseRateLimited')`, shared with the room side, with no retry button;
    - **list:** a count `t('market.people.count', {count})`, a grid of cards (1/2/3 columns as `PeoplePage`)
      and a "load more" button (`people.loadMore`, reused). It pages with `useInfiniteQuery`, like `usePeople`.
    - A mutual like shows the existing `MutualBanner` above the grid, given `conversation_id` as its
      `applicationId` prop. Both are chat ids, so there is no rename and no change for its callers
      (`MyLikesPage.tsx:220`, `ListingPage.tsx:188`).
    - Cache (verifier finding 2): a like updates the loaded pages with `setQueryData`. It flips
      `liked_by_me`, and on a mutual result it removes the card. It never invalidates `['market-people']`.
      The browse query and the people-likes query use `staleTime: 60_000` and `refetchOnWindowFocus: false`.
  - `web/src/features/people/MarketPersonCard.tsx` (new), built from the `PersonCard.tsx` pieces (`Card`,
    `Badge`, `DisclosureButton`, `formatDate`, the area-names line, the plain-text `about_me` with "more"):
    - 0010k's `Avatar` (`photo_url`, the initial letter as fallback);
    - name and age, gender, areas, move-in;
    - a "liked you" badge (`t('market.people.likedMe')`);
    - the questionnaire comparison: `compareLifestyle(viewerAnswers, person.lifestyle)`
      (`features/lifestyle/keys.ts`, the viewer's answers from `useProfile()`). It shows
      `t('market.people.alike', {same, shared})` and the differing topics through `lifestyleTopic`. It shows
      nothing when `shared` is 0;
    - the like toggle: one label, `t('market.people.like')`, with `aria-pressed`. A visual ✓ is
      `aria-hidden` when pressed, as `PersonCard.tsx:203-208` does;
    - like errors as `PersonCard`'s `errorKind`:
      - 404: the card is gone (a page alert);
      - 429: `people.errors.rateLimited` (reused);
      - 403 `card_required`: an inline `t('market.people.likeNeedsCard')` with the profile link (a live-room
        lister without a card).
  - API calls and hooks: `features/people/api.ts` gains `fetchPeopleBrowse`, `likePersonCard`,
    `unlikePersonCard`, `fetchMyPeopleLikes` and `removeMatch`. `features/people/useMarketPeople.ts` (new)
    holds the query keys `['market-people']` and `['me', 'people-likes']`:
    - `['market-people']` is added to `auth/useLogout.ts`'s reset loop. `['me', …]` is already cleared there by
      its `ME_KEY` prefix.
    - `profile/useSaveProfile.ts` invalidates both keys, since a profile save can change the gender rule and
      the ticket.
  - `web/src/features/likes/MyLikesPage.tsx`: after the room sections, three people sections from
    `GET /me/people-likes`:
    - `t('likes.people.likedMe')`: cards with the like button;
    - `t('likes.people.mine')`: cards with the unlike button;
    - `t('likes.people.matches')`: name, avatar and a `t('likes.toChat')` button to `/chat/{conversation_id}`.

    Each has its own `EmptyState`. On 403 `card_required` the three are replaced by one `EmptyState`
    `t('likes.people.cardRequired')`, with the button `t('market.people.toProfile')` to
    `profileHref('/me/likes', 'about', 'looking')`. Room sections and their copy are unchanged.
  - `web/src/features/chat/ChatThreadPage.tsx`: in a direct chat (`thread.listing === null`) that can send,
    the caption line from 0010g gains a ghost button `t('chat.thread.removeMatch')`:
    - It opens `useConfirm()` (`components/Dialog.tsx:147`) with `t('chat.thread.removeMatchTitle')` /
      `t('chat.thread.removeMatchBody')` / `t('chat.thread.removeMatchConfirm')`.
    - On confirm it calls `DELETE /me/matches/{id}`, then invalidates the thread, `['conversations']` and
      `['me', 'people-likes']`. 0010g's closed note then replaces the composer and takes focus (0009t rule).
    - A failure shows `t('chat.thread.removeMatchFailed')` inline.
  - i18n keys (`web/src/locales/he.json`), brand voice (no slash forms, never one gender):
    - `market.view.label` "תצוגה", `market.view.rooms` "חדרים", `market.view.people` "אנשים"
    - `market.people.title` "אנשים שמחפשים דירה"
    - `market.people.count_one` "אדם אחד", `_two` "2 אנשים", `_other` "{{count}} אנשים"
    - `market.people.empty` "עוד אין כאן אנשים שמתאימים. כשעוד אנשים יציגו את הכרטיס שלהם, הם יופיעו כאן."
    - `market.people.cardRequired` "כדי לראות אנשים, צריך להציג את הכרטיס שלך בשוק השותפים או לפרסם חדר."
    - `market.people.toProfile` "להשלמת הכרטיס"
    - `market.people.likeNeedsCard` "כדי לסמן לייק לאנשים, צריך להציג את הכרטיס שלך."
    - `market.people.likedMe` "אהבו את הכרטיס שלך"
    - `market.people.like` "אהבתי"
    - `market.people.alike` "{{same}} מתוך {{shared}} תשובות דומות"
    - `market.people.differs` "שונה: {{topics}}"
    - `people.browseRateLimited` "צפיתם בהרבה כרטיסים בזמן קצר. אפשר לחזור לזה מאוחר יותר." (shared by
      both browse pages)
    - `likes.people.cardRequired` "כדי לראות כאן אנשים, צריך להציג את הכרטיס שלך בשוק השותפים."
    - `market.people.gone` "הכרטיס הזה כבר לא זמין"
    - `likes.people.likedMe` "אנשים שמתעניינים בך", `likes.people.mine` "אנשים שאהבתי",
      `likes.people.matches` "התאמות"
    - `likes.people.likedMeEmpty` "עוד אין אנשים שאהבו את הכרטיס שלך."
    - `likes.people.mineEmpty` "עוד לא אהבת אנשים."
    - `likes.people.matchesEmpty` "עוד אין התאמות. לייק הדדי פותח צ'אט."
    - `chat.thread.removeMatch` "הסרת ההתאמה"
    - `chat.thread.removeMatchTitle` "להסיר את ההתאמה?"
    - `chat.thread.removeMatchBody` "השיחה תישאר לקריאה, אבל אי אפשר יהיה לשלוח בה הודעות. לייק הדדי חדש
      יפתח אותה שוב."
    - `chat.thread.removeMatchConfirm` "הסרה"
    - `chat.thread.removeMatchFailed` "לא הצלחנו להסיר את ההתאמה. אפשר לנסות שוב."


**Out:**
- The API, the migration and every rule (`0010h`).
- A nav badge for people who liked you (`LikesNavLink` keeps counting rooms only). This is a follow-up.
- Filters and sort options on people browse.
- Hiding, blocking or reporting a person (trust slices).

**New dependencies:** none.

## Data
None (`0010h`).

## API
No change. The web calls `0010h`'s endpoints: `GET /people`, `PUT` / `DELETE /people/{card_id}/like`,
`GET /me/people-likes` and `DELETE /me/matches/{conversation_id}`, plus 429 on `GET /listings/{id}/people`.
Run `make client` after rebasing onto `0010h`.

## UI
No artboard covers people browse (PRODUCT.md "Brand": no new artboards; anatomy from `PersonCard.tsx` /
`ApplicantCard.tsx` and the brand kit `design/brand/`).
- **`/market/people`.** `PageHeader` `t('market.people.title')`, the `MarketViewSwitch`, the count, then the
  card grid and "load more". Empty, loading, error, 403 and 429 states as in Scope. Focus: "load more" keeps
  focus on the first new card (as `PeoplePage`). A like that turns mutual removes the card (it is now a match).
  The `MutualBanner` takes focus.
- **Person card.** The avatar sits at the inline start. Then come the name (`dir="auto"`) and age, then a chip
  row (gender, liked-you badge), then areas and move-in, then "about me" (plain text, clamped, "more"), then the
  questionnaire line ("4 מתוך 6 תשובות דומות" and "שונה: אורחים, שבת"), then the like toggle at the block end.
  Logical properties only.
- **Likes page.** The three people sections follow the room sections, each `section` with `aria-labelledby` its
  `h2`. Matches are compact rows: avatar, name, "לצ'אט" button.
- **Chat, direct.** "הסרת ההתאמה" is a ghost button in the caption line. The confirm dialog is `useConfirm`'s
  (focus trap, Escape cancels). After a confirm, the closed note (0010g) replaces the composer and takes focus.
- RTL: no physical properties. Every Hebrew string goes through i18n, and `make i18n-check` stays green.

## Acceptance criteria
- [ ] AC15 (web: browse) `MarketPeoplePage` renders:
  - loading, empty, error, 429 and 403 (with the profile link);
  - a list with the count and "load more";
  - a card's questionnaire line computed from the viewer's answers ("2 מתוך 3 תשובות דומות"), and no line
    when nothing is shared;
  - the liked-you badge.

  The like toggle sends PUT then DELETE (`aria-pressed`, one unchanged name), and a like sends no
  `GET /people` (the cache is updated in place). A mutual result shows `MutualBanner` linking to
  `/chat/{conversation_id}`, which takes focus. — `web/src/features/people/__tests__/MarketPeoplePage.test.tsx`
- [ ] AC16 (web: switch) `MarketViewSwitch` marks the current view with `aria-current="page"` on `/market` and
  `/market/people`. Signed out, אנשים links to `/login?next=%2Fmarket%2Fpeople`. — `web/src/features/people/__tests__/MarketViewSwitch.test.tsx`
- [ ] AC17 (web: likes page) `MyLikesPage` shows the three people sections with their empty states, the match
  row's "לצ'אט" link and, on 403, one profile nudge in their place. The room sections are unchanged. —
  `web/src/features/likes/__tests__/MyLikesPage.test.tsx` (amended)
- [ ] AC18 (web: remove match) In a direct open chat, "הסרת ההתאמה" opens the confirm. Cancel sends nothing.
  Confirm sends `DELETE /me/matches/{id}`, and then the closed note shows and takes focus. An application chat
  and a closed direct chat show no such button. — `web/src/features/chat/__tests__/ChatThreadPage.test.tsx` (amended)
- [ ] AC20 (web: room side 429) The room-side `PeoplePage` shows `people.browseRateLimited`, with no retry
  button, on a 429. — `web/src/features/people/__tests__/PeoplePage.test.tsx` (amended)
- [ ] AC19 (e2e, CI only) Two people sign up and fill both profile parts with the card shown. `A` opens
  `/market/people`, finds `B` and likes. `B` sees `A` under "אנשים שמתעניינים בך" and likes back. The banner leads
  to the chat, and `B` sends a message that `A` reads. `A` removes the match through the confirm, and the closed
  note shows for both. axe passes on `/market/people`. — `web/e2e/people-market.spec.ts::ac19_people_like_match_chat_remove`

## Tests to write
Unit (web): AC15–AC18, AC20.

E2E (CI only; no local `make e2e`): new `people-market.spec.ts` (AC19). Two existing tests are at risk:
- `likes.spec.ts:135` selects the region named `he.likes.likedMe` ("אהבו אותך"). The new people headings were
  chosen not to contain that text ("אנשים שמתעניינים בך", "אנשים שאהבתי", "התאמות"), so it stays unique.
- `people.spec.ts` (room side) calls `/listings/{id}/people` a few times per run, far under 300.

AC19 reuses the existing sign-up helper (`web/e2e/helpers.ts`). It adds two sign-ups to a suite budgeted at
about 25 per 15 minutes across 3 shards (Makefile:123). If CI hits the OTP limit, add a shard
(`E2E_SHARDS`) in this PR.

If either fails in CI, the fix goes in this PR.

## Risks / open questions
- **Split from 0010h** (spec-verifier round 1, finding 1; orchestrator, 2026-11-13). One coder run could not
  hold both halves. This spec starts from `0010h`'s branch as soon as its PR is open (Speed rule 3).
- **Room-side 429 gap.** Between the `0010h` merge and this one, a lister who passes 300 room-page browses an
  hour sees the generic error. Few real users get there; AC20 closes it.
- **About me is shown as plain text** (FOLLOWUPS:162: it can carry contact details). It is never rendered as
  a link or HTML.
- Spec-verifier round 1 (Opus, high) was run on the joint spec. Its web findings are applied here:
  - the cache updated in place, no refetch on a like, and no refocus refetch;
  - MutualBanner kept as is;
  - the profile link opens both parts;
  - the room-side 429 state;
  - the likes-page 403 key;
  - the e2e sign-up budget;
  - one like label;
  - the cache-reset list.

  round 1: findings applied (shared count with 0010h: 15 applied).

## Digest (filled by orchestrator after verification)
See `/digest`.
