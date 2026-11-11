---
id: 0008e
title: A room's lister creates and shares the flat's invite link and manages flatmates; whoever opens the link, logged in or not, joins the flat
status: verified
depends_on: [0008d, 0008b, 0007f]   # 0008d: the flatmates endpoints and MyListingOut.flatmate_count / flatmate_invite_active; 0008b: the room card's link row in MyListingsPage this extends (same file, built first); 0007f: features/listings/cardTitle.ts
reviewers: [code, qa, security, ux]   # security: an auth-guard redirect change (`next`) and a capability token in the URL, clipboard and join page; ux: two new screens; qa: invite create/rotate/disable, join states
estimate: 1 coder run   # coder Sonnet/medium; Opus if the run overflows. Split from the draft 0008e by the verifier (screens limit); the group chat is 0008f
---

## Goal
After this ships, an owner's **room** card in `/me/listings` has **"שותפים בדירה (N)"**. It opens
`/me/listings/:id/flatmates`, which offers:
- "יצירת קישור הזמנה": the link is shown once, with a copy button;
- "קישור חדש" to rotate the link, and "ביטול הקישור" to turn it off;
- the flatmates list, each with "הסרה" behind a confirm.

Whoever opens `/flatmates/join/:token` signs in first if needed, and the login brings them back to the link.
They see which flat it is and whose, and tap "הצטרפות לדירה". Then they land on `/chat` with a confirmation. The
group chat itself (member line, sender names, "הדירות שלי") is `0008f`.

This serves PRODUCT.md "Flatmates" (Gilad, 2026-11-11). It is Dev Plan slice 8, part e. No artboard. The pages
use the `/me/listings` page frame and its card tokens.

## Scope
**In:**
- `web/src/features/auth/RequireUser.tsx` (and `RequireOwner.tsx` / `RequireSeeker.tsx`, which share the
  pattern): a logged-out visitor goes to `/login?next=${encodeURIComponent(pathname + search)}` (`useLocation`)
  in place of a bare `/login`. `LoginPage` / `OtpForm` already validate `next` through `safeNext`
  (`auth/next.ts`, `0004b`), signup included.
- `web/src/app/routes.tsx`:
  - inside `RequireOwner`: `me/listings/:id/flatmates` → `FlatmatesPage`;
  - inside `RequireUser`: `flatmates/join/:token` → `JoinFlatPage`.
- `web/src/features/flatmates/` (new):
  - `api.ts` holds the types re-exported from `api/schema.d.ts`, the keys `flatmatesKey(listingId)`, and these
    hooks:
    - `useCreateInvite(listingId)` (also used to rotate) and `useDisableInvite(listingId)`: each invalidates
      `MY_LISTINGS_KEY`;
    - `useFlatmates(listingId)`, and `useRemoveFlatmate(listingId)`, which invalidates `flatmatesKey` and
      `MY_LISTINGS_KEY`;
    - `useInvitePreview(token)`, a query that POSTs `{token}` to `/flatmate-invites/preview` (`0008d`: the
      token never goes in an API URL; `retry: false`);
    - `useJoinFlat()`, which POSTs `{token}` to `/flatmate-invites/join` and on success invalidates
      `CONVERSATIONS_KEY` (`features/chat/useConversations.ts`) and the my-flats key `['me', 'flats']` that
      `0008f` reads.
  - `FlatmatesPage.tsx`. The listing (`listing_type`, title, `flatmate_invite_active`) comes from
    `useMyListings` by id, as `0008b`'s `PeoplePage` does. Its states:
    - **loading**: `Skeleton` with `aria-busy`;
    - **error**: `ErrorState` with retry;
    - **not found** (not in my listings, or an apartment): `flatmates.notFound`, with the back link to
      `/me/listings`.

    **Invite block.** With `flatmate_invite_active` false: the hint `flatmates.invite.hint` and "יצירת קישור
    הזמנה". After a create, the full URL `${window.location.origin}/flatmates/join/${token}` shows in a
    read-only input. Next to it is "העתקה" (`navigator.clipboard.writeText`, with
    `flatmates.invite.copied` as `role="status"`; on failure it selects the input's text), and the warning
    `flatmates.invite.onceWarning`. With an active link whose token is not in memory (after a reload): the text
    `flatmates.invite.active`, "קישור חדש" (confirm `flatmates.invite.rotateConfirm`, then the new link shows),
    and "ביטול הקישור" (confirm `flatmates.invite.disableConfirm`).

    **List** (`useFlatmates`), with its own `Skeleton` and `ErrorState`: each flatmate shows their name,
    `flatmates.list.joinedAt` with the date, and "הסרה" (confirm `flatmates.list.removeConfirm`). An empty
    list shows `flatmates.list.empty`. A failed create, rotate, disable or remove shows `common.error` inline
    (`role="alert"`).
  - `JoinFlatPage.tsx`. The preview POST and the join POST share one error mapping. Its states:
    - **loading** (`Skeleton`);
    - **preview**: `cardTitle(listing)`, `flatmates.join.invitedBy` with the owner's name, and the CTA
      `flatmates.join.cta`, disabled while the POST runs;
    - **member: true**: `flatmates.join.member` with "לשיחות" → `/chat`;
    - **joined**: `navigate('/chat', { state: { joined: true } })`;
    - **404**: `flatmates.join.invalid`;
    - **409 `own_listing`**: `flatmates.join.own`;
    - **409 `already_applied`**: `flatmates.join.applied`;
    - **409 `flatmates_full`**: `flatmates.join.full`;
    - **429**: `flatmates.join.rateLimited`;
    - anything else: `ErrorState`.
  - Dates: `joined_at` is a datetime. It shows as the Asia/Jerusalem calendar day:
    `Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem' })`, in a small `formatDay` in
    `features/flatmates/format.ts`, which `0008f` reuses.
- `web/src/features/chat/ChatListPage.tsx`: when `location.state?.joined`, it shows `flatmates.join.done` as
  `role="status"`, as `MyListingsPage` shows `saved` (`MyListingsPage.tsx:90`), and clears the state on
  dismiss or navigation.
- `web/src/features/listings/MyListingsPage.tsx`: on every **room** card (live, paused, expired), the link
  `listings.mine.flatmates` ("שותפים בדירה ({{count}})") to `/me/listings/{id}/flatmates`. It sits after
  `0008b`'s "מחפשים חדר" when that is shown, else after the applicants link. Apartments get none.
- Confirms use `window.confirm(t(...))`, the pattern of `ApplicantCard.tsx:63` (`0004d`'s decline). The tests
  stub `window.confirm`.
- `web/src/locales/he.json` (Hebrew given here; plurals follow the file's `_one` / `_other` pattern):

  | Key | Hebrew |
  | --- | --- |
  | `flatmates.title` | "שותפים בדירה" |
  | `flatmates.back` | "חזרה למודעות שלי" |
  | `flatmates.notFound` | "המודעה לא נמצאה" |
  | `flatmates.invite.hint` | "שלחו לשותפים קישור הזמנה. מי שמצטרף רואה את השיחות על החדר מרגע ההצטרפות, ויכול לכתוב בהן." |
  | `flatmates.invite.create` | "יצירת קישור הזמנה" |
  | `flatmates.invite.rotate` | "קישור חדש" |
  | `flatmates.invite.disable` | "ביטול הקישור" |
  | `flatmates.invite.copy` | "העתקה" |
  | `flatmates.invite.copied` | "הקישור הועתק" |
  | `flatmates.invite.onceWarning` | "הקישור מוצג פעם אחת. כל מי שמקבל אותו יכול להצטרף." |
  | `flatmates.invite.active` | "יש קישור הזמנה פעיל." |
  | `flatmates.invite.rotateConfirm` | "ליצור קישור חדש? הקישור הקודם יפסיק לעבוד." |
  | `flatmates.invite.disableConfirm` | "לבטל את הקישור? אי אפשר יהיה להצטרף דרכו." |
  | `flatmates.list.title` | "שותפים שהצטרפו" |
  | `flatmates.list.empty` | "עוד אף אחד לא הצטרף." |
  | `flatmates.list.joinedAt` | "הצטרף/ה ב־{{date}}" |
  | `flatmates.list.remove` | "הסרה" |
  | `flatmates.list.removeConfirm` | "להסיר את {{name}}? הוא/היא לא יראה/תראה יותר את השיחות על החדר, וקישור ההזמנה הנוכחי יבוטל (צרו קישור חדש לשאר השותפים)." |
  | `flatmates.join.title` | "הזמנה להצטרף לדירה" |
  | `flatmates.join.invitedBy` | "הוזמנת על ידי {{owner}}" |
  | `flatmates.join.cta` | "הצטרפות לדירה" |
  | `flatmates.join.member` | "כבר הצטרפת לדירה הזו" |
  | `flatmates.join.toChats` | "לשיחות" |
  | `flatmates.join.done` | "הצטרפת לדירה. שיחות על החדר יופיעו כאן." |
  | `flatmates.join.invalid` | "הקישור לא בתוקף. בקשו מבעל/ת הדירה קישור חדש." |
  | `flatmates.join.own` | "זו המודעה שלך" |
  | `flatmates.join.applied` | "הגשת מועמדות לחדר הזה, ולכן אי אפשר להצטרף כשותף/ה" |
  | `flatmates.join.full` | "בדירה כבר 7 שותפים" |
  | `flatmates.join.rateLimited` | "יותר מדי ניסיונות. נסו שוב בעוד שעה." |
  | `listings.mine.flatmates` | "שותפים בדירה ({{count}})" |
- Fixtures: the listing fixtures gain `flatmate_count: 0` and `flatmate_invite_active: false`. There is a new
  `features/flatmates/__tests__/fixtures.ts`.

**Out:**
- The group chat UI (member line, sender names, the chat list chip, "הדירות שלי" and leaving): `0008f`.
- Native share sheets. Copy is enough for MVP.
- Showing the token again after a reload. It is unrecoverable by design (`0008d`); rotate instead.

**New dependencies:** none.

## Data
None (web only).

## API
Consumes `0008d`: the invite POST / DELETE, `POST /flatmate-invites/preview` and `POST /flatmate-invites/join`
(the token in the body), `GET` / `DELETE /listings/{id}/flatmates…`, and the new `MyListingOut` fields. A
removal also turns the link off (`0008d`), so the remove mutation invalidates `MY_LISTINGS_KEY` and the page
shows the inactive-link state. Run `make client`.

## UI
States as listed in Scope. RTL: logical classes only. The URL input is `dir="ltr"` with `text-start` (a URL
reads left to right inside RTL). Buttons wrap under the input below 400 px. Mobile is one column, desktop
`max-w-[480px]`.

## Acceptance criteria
- [ ] AC1 Given a room with `flatmate_invite_active: false`, When "יצירת קישור הזמנה" is clicked and the POST
  answers `{token: "T"}`, Then the input holds `${origin}/flatmates/join/T` with the once-only warning.
  "העתקה" calls `navigator.clipboard.writeText` with it (stubbed) and shows "הקישור הועתק". After a remount
  with `flatmate_invite_active: true`, the page shows "יש קישור הזמנה פעיל." with "קישור חדש" and "ביטול
  הקישור". Each calls `window.confirm` (stubbed true), then POST / DELETE. With the confirm stubbed false,
  nothing is sent. A 500 on create shows `common.error`. — `web/src/features/flatmates/__tests__/FlatmatesPage.test.tsx::ac1_invite_flow`
- [ ] AC2 Given `GET /listings/L/flatmates` with two flatmates, Then both show with their join days
  (Asia/Jerusalem). "הסרה" → confirm → `DELETE /listings/L/flatmates/{id}`, and the list refetches. An empty
  list, a loading list and a failing list show their states. An apartment id or an unknown id shows
  `flatmates.notFound`. — `FlatmatesPage.test.tsx::ac2_list_remove_and_states`
- [ ] AC3 `/flatmates/join/T`:
  - a preview renders the title, "הוזמנת על ידי רוני" and the CTA. The CTA is disabled while pending, POSTs
    the join, and navigates to `/chat`, where `flatmates.join.done` shows;
  - `member: true` shows "כבר הצטרפת";
  - 404, 409 `own_listing`, `already_applied`, `flatmates_full` and 429 show their texts, from the preview and
    from the join alike.

  — `web/src/features/flatmates/__tests__/JoinFlatPage.test.tsx::ac3_states`
- [ ] AC4 A logged-out visit to `/flatmates/join/T` lands on `/login?next=%2Fflatmates%2Fjoin%2FT`. A
  logged-out visit to `/me/listings?x=1` (`RequireOwner`) keeps its query in `next`. — `web/src/features/auth/__tests__/routes.test.tsx::ac4_guards_keep_next`
- [ ] AC5 `/me/listings`: every room card (live, paused, expired) has "שותפים בדירה (N)" linking to its
  flatmates page, after "מחפשים חדר" when that is present. Apartments have none. — `web/src/features/listings/__tests__/MyListingsPage.test.tsx::ac5_flatmates_link`
- [ ] AC6 E2E with two browser contexts. Owner `O` posts a room, opens the flatmates page and creates the link.
  User `F`, **logged out**, opens the link, is sent to login, signs up from there, comes back to the join page,
  and joins. Then `F` is on `/chat` with the confirmation, and `O`'s flatmates page lists `F`. — `web/e2e/flatmates.spec.ts::ac6_invite_and_join`
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green (Speed
  rule 7). The e2e result goes in the digest.

## Tests to write
Component tests: the cases above, with `vi.stubGlobal('fetch', ...)`, and with `navigator.clipboard` and
`window.confirm` stubbed. E2E: `web/e2e/flatmates.spec.ts` (multi-context as `inbox.spec.ts:24` does).
`helpers.ts` gains `createInvite(page, listingId)` (API) for `0008f`'s setup.

## Risks / open questions
- The token is shown once. An owner who loses it rotates, and the copy says so.
- The guard change touches every protected route. AC4 covers it, and the existing `routes.test.tsx` cases must
  pass with the new `/login?next=` target. Update their expected path where they assert a bare `/login`.

Spec-verifier round 1 rejected the draft with 14 findings. All are applied: the split into `0008e` / `0008f`,
`next` on the guards, the states, keys, confirm pattern, dates, invalidation, `security` added. Findings 2 and
13 were against `0008d` and are applied there. The second round is waived (one verifier round, Gilad).

## Digest (filled by orchestrator after verification)
    Spec 0008e - Flatmates web: invite & join   (verified, Slice 8; depends on 0008d, 0008b, 0007f; split by the verifier)
    What a user can do after this: a room lister creates, copies, rotates or turns off the invite link and
             removes flatmates; anyone opening the link (logging in first if needed) joins the flat.
    Decisions I need from you: none.
    KPIs this slice moves: invite links created per room; joins per link.
    Acceptance targets: lint/test/i18n/build clean + make e2e green locally; login keeps the link (`next`).
    Risks: the protected-route redirect now carries `next` for every page - mitigation: guard tests updated.
    Reviewers: code, qa, security, ux   Estimated: 1 coder run (Sonnet/medium)
    Links: specs/0008e-flatmates-web.md - PRODUCT.md "Flatmates" - no artboard
