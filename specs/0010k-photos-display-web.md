---
id: 0010k
title: The listing page shows a photo gallery, every public listing card its cover, every person their photo through one shared Avatar, and anyone sets, replaces or removes their own photo on the profile
status: verified
depends_on: [0010c, 0010d, 0010j]   # 0010c: the profile's "עליי" section; 0010d: `cover` / `photos` on listing responses; 0010j: /me/photo and every photo_url
reviewers: [code, qa, ux]   # no security: display only, the server decides who gets an address (0010d/0010j have security); ux: gallery, avatars on five screens, profile photo (no artboard body for the last two); qa: every card and avatar site
estimate: 1 coder run   # coder Sonnet/high
---

## Goal
After this ships:
- the listing page shows a **gallery** (main photo 16:10, a counter, thumbnails) in place of the grey band;
- every public listing card shows its **cover** (search list, map, likes);
- one shared **`Avatar`** shows a person's photo, or their initial as today, on the people page, the chat list,
  the applicant card and pane, and the flatmates page;
- anyone sets, replaces or removes **their own photo** at the top of the profile's "עליי" section.

This serves PRODUCT.md "שוק השותפים" (photos for rooms, apartments and people) and MARKET-PLAN §7 "Photos
(0010d)". The API is `0010d` (listing photos) and `0010j` (person photo). The wizard side is `0010e` (split by
the orchestrator, 2026-11-13). Design: `Listing.dc.html:21-43` (gallery, "1 / 12" counter, 56 px thumbnails)
and the brand kit (`design/brand/README.md:50`); no artboard has a person photo (PRODUCT.md: no new artboards),
so that design is in UI below.

## Scope
**In:**
- `make client` regenerates `web/src/api/schema.d.ts` (git-ignored). The typed fixtures already carry the new
  fields (`0010d` and `0010j` added them for their own CI). `features/listings/api.ts` exports `type PhotoOut =
  components['schemas']['PhotoOut']`.
- **Shared code with `0010k`** (identical text in both specs, so the two build in parallel; the second to
  merge keeps the first one's copy on rebase and drops its own):
  - `web/src/features/photos/limits.ts`: `MAX_PHOTOS = 10`, `MAX_PHOTO_BYTES = 8 * 1024 * 1024`, `PHOTO_TYPES =
    ['image/jpeg', 'image/png', 'image/webp']`, `PHOTO_ACCEPT = PHOTO_TYPES.join(',')`, and `checkFile(file):
    'type' | 'size' | null` (the API checks again; this only saves a wasted upload). Mirrors 0010d's
    constants; a comment names them.
  - `web/src/features/photos/errors.ts`: `photoErrorText(t, error: unknown): string`: 413 →
    `photos.errors.size`, 415 → `photos.errors.type`, 409 `photo_limit` → `photos.errors.limit`, 429 →
    `photos.errors.rateLimitedIn` with `{{when}}` = `retryAfterText(t, retryAfter)`
    (`components/retryAfter.ts:14-19`), or `photos.errors.rateLimited` without a `Retry-After` (the house
    pair, `he.json:414,417`), anything else (503, network) → `photos.errors.failed`.
  - `he.json` `photos.errors.type` ("אפשר להעלות רק תמונות JPEG, ‏PNG או WebP."), `photos.errors.size` ("התמונה
    גדולה מדי. אפשר לבחור תמונה של עד 8MB."), `photos.errors.limit` ("כבר יש 10 תמונות. אפשר להסיר אחת ולהוסיף
    אחרת."), `photos.errors.rateLimited` ("הרבה העלאות בזמן קצר. אפשר לנסות שוב מאוחר יותר."),
    `photos.errors.rateLimitedIn` ("הרבה העלאות בזמן קצר. אפשר לנסות שוב {{when}}."), `photos.errors.failed`
    ("התמונה לא הועלתה. אפשר לנסות שוב.").
  - `features/listings/ListingCard.tsx` gains `coverUrl?: string | null`. The photo box (`:154-179`) keeps its
    16:10 box and room `Tag`; with a `coverUrl` it renders `<img src={coverUrl} alt="" loading="lazy"
    decoding="async" className="absolute inset-0 size-full object-cover">` (rounded by the box,
    `overflow-hidden`) under the tag, and the placeholder icon only without one or after `onError` (the error
    state resets when `coverUrl` changes). `alt=""`: the card's title names the listing. Test:
    `ListingCard.test.tsx::cover` (image, `alt=""`, error → placeholder, none → today's card).
- `web/src/features/profile/photoApi.ts` (new; kept out of `features/photos/api.ts`, which is `0010e`'s, so the two
  never edit one file): `uploadMyPhoto(file): Promise<UserOut>` (raw body exactly as 0010e's listing upload:
  `body: file as unknown as string`, identity `bodySerializer`, `Content-Type` = `file.type`, the cast
  commented) and `deleteMyPhoto()` (204: checks `!response.ok` as `likes/api.ts:29-33`). Both throw `ApiError`
  with the response headers.
- `web/src/components/Avatar.tsx` (new, shared): `Avatar({ name, photoUrl, size, tone = 'neutral',
  className })`, `size: 'sm' | 'md' | 'lg' | 'xl'` = 40 / 48 / 56 / 96 px (`size-10`, `size-12`, `size-14`,
  `size-24`), `tone: 'neutral' | 'accent'` = today's two looks (`bg-surface-subtle text-ink-muted` /
  `bg-accent-soft text-accent-strong`). It renders one `<span aria-hidden="true">` circle: with a `photoUrl`, an
  `<img src alt="" loading="lazy" decoding="async" className="size-full rounded-full object-cover">`; without
  one, or after the image's `onError`, the first code point `Array.from(name)[0] ?? ''` as today (the failure
  state resets when `photoUrl` changes). `aria-hidden` because every site shows the name as text beside it.
  `sm` uses `text-body font-semibold` (FlatmatesPage today), `md`/`lg` `text-h3 font-semibold` (unifying
  `ConversationsPane:68`, which has it, with `PersonCard:113`, which does not), `xl` `text-h1`.
  Replaces the initial circles at:
  - `features/people/PersonCard.tsx:111-116` → `md`, neutral, `person.photo_url`;
  - `features/chat/ConversationsPane.tsx:66-71` → `md`, accent, `conversation.other_photo_url`;
  - `features/applicants/ApplicantCard.tsx:187-197` → `md`, accent when `compact && selected` else neutral,
    `applicant.photo_url`;
  - `features/applicants/ApplicantPane.tsx:68-73` → `lg`, accent, `applicant.photo_url`;
  - `features/flatmates/FlatmatesPage.tsx:262-267` → `sm`, accent, `flatmate.photo_url`.
  After the swap, no
  `Array.from(…)[0]` initial remains in `features/` outside `Avatar` (a unit test greps for it).
- Public card covers: `search/ResultsList.tsx`, `search/SearchMap.tsx` and `likes/MyLikesPage.tsx` pass
  `listing.cover?.small_url` to `ListingCard` (`landing/LandingPage.tsx` is unchanged: its card is the
  fabricated `exampleListing()`, `landing/example.ts:13-21`).
- Listing page: `features/listings/Gallery.tsx` (new), used by `ListingPage.tsx` in place of the band at
  `:92-110`:
  - no photos → today's band unchanged (moved into `Gallery`);
  - photos → a main image (`large_url`) in a 16:10 box (`aspect-[16/10]`), edge to edge below `md` (`-mx-4
    md:-mx-6` as the band), `lg:rounded-lg`, `object-cover`; at `lg` the box keeps the band's place
    (`lg:col-span-2`) with its width capped at `lg:max-w-3xl` (start-aligned) so it is at most 480 px tall.
    `alt` = `listing.photos.alt` ("{{title}}, תמונה {{n}} מתוך {{total}}", title from `cardTitle`);
  - more than one photo → the counter pill at the bottom end corner ("{{n}} / {{total}}",
    `listing.photos.counter`, `aria-hidden`: the thumbnails carry the state), as the artboard's "1 / 12";
    and a row of thumbnail buttons under it (`small_url`, `h-14` = 56 px, 16:10, `rounded-md`, `gap-2`,
    horizontal scroll with `overflow-x-auto` and no wrap; the thumbnail `img` has `alt=""`), each `aria-label` = `listing.photos.show` ("הצגת
    תמונה {{n}} מתוך {{total}}"), `aria-pressed` on the shown one, which also gets `border-2 border-accent`
    (artboard). Clicking a thumbnail changes the main image; focus stays on the thumbnail. All 44 px tap
    targets: the 56 px thumbs meet it. `ListingPage` renders `<Gallery key={listing.id}>`, and the shown index
    is clamped when `photos` shrinks (a refetch after a delete);
  - the loading skeleton (`:64`) becomes a 16:10 box with the same width rules.
- Profile (`features/profile/PersonPhoto.tsx`, new; placed by `ProfilePage.tsx` at the top of 0010c's
  `#profile-about` section, **above** its switch and shown whether the switch is on or off, because the photo
  is saved on its own, not with the profile form):
  - reads `photo_url` from `useMe()` (`features/auth/useMe.ts`, 0010j's `UserOut.photo_url`); shows `Avatar`
    `xl` with the display name;
  - buttons: `profile.photo.add` ("העלאת תמונה") without a photo, `profile.photo.replace` ("החלפת תמונה") and
    `profile.photo.remove` ("הסרת תמונה") with one; the add/replace button opens a hidden single-file input
    (`accept={PHOTO_ACCEPT}`); `checkFile` first; then `uploadMyPhoto` / `deleteMyPhoto` immediately (no
    confirm: re-uploading undoes a removal) and `queryClient.setQueryData(ME_KEY, user)` (on delete: the
    cached user with `photo_url: null`); after a removal focus moves to "העלאת תמונה"; the input's `value` is
    reset after each pick;
  - busy state on the pressed button; a `role="status"` line `profile.photo.saved` ("התמונה נשמרה") /
    `profile.photo.removed` ("התמונה הוסרה"); errors as one `role="alert"` line via `photoErrorText`;
  - the hint `profile.photo.hint`: "התמונה מוצגת רק במקומות שבהם הכרטיס כבר מוצג: למפרסמים שהוגשה אליהם
    מועמדות, למפרסמי חדרים בשוק השותפים ולמשתתפי הצ'אט." (apartment owners see applicants too, 0010j);
  - the side index (`profile.nav.label`) is unchanged (the photo is part of "עליי").
- i18n (`web/src/locales/he.json`): the keys named above. Voice: plural or infinitive, no slash forms, never one gender (`specs/0009-brand-amendment.md`). `make i18n-check` green.
- PWA: nothing changes. Photos are `<img>` requests to the API's `/media` (dev/CI) or the R2 address, never
  cached by the worker (`web/pwa.config.ts`: no `runtimeCaching`; `web/scripts/build-check.mjs:228-267` fails
  on any runtime strategy). `make build-check` stays green. No photo URL is added to the precache.

**Out:**
- A full-screen viewer (lightbox), swipe gestures and zoom on the gallery; prev/next arrows (the artboard has
  none; thumbnails are the control). The artboard's share/save/back overlay buttons.
- A person photo on surfaces that do not show the person today (0010f room page flatmates, 0010h people
  browse) and in the chat thread header's member list (`MemberOut.photo_url` is ready for it).
- The wizard and the lister's own cards (`0010e`).

**New dependencies:** none.

## Data
None (0010d, 0010j).

## API
None new. Consumed: `PUT` / `DELETE /me/photo` (0010j), and the read fields `cover`, `photos` (0010d),
`photo_url`, `other_photo_url` (0010j).

## UI
- **Gallery** (`Listing.dc.html:21-43`): no photos (band as today), one (main only), many (main + counter +
  thumbnails), loading (16:10 skeleton), image error (the placeholder icon in the box).
- **Card cover**: with cover / without / image error. **Avatar**: photo / initial / image error.
- **Profile photo**: none / set / uploading / removing / error.
- All logical properties (`start`, `end`, `ms-`, `me-`); every image box has a fixed aspect or size, so
  nothing shifts while an image loads (CLS).

## Acceptance criteria
- [ ] AC1 Gallery: a listing with 3 photos shows the first `large_url` with alt "…, תמונה 1 מתוך 3", the counter
  "1 / 3" and three thumbnail buttons; pressing the third shows its `large_url`, moves `aria-pressed` and the
  counter to "3 / 3"; one photo shows no counter and no thumbnails; none shows today's band. —
  `ListingPage.test.tsx::ac1_gallery`
- [ ] AC2 Card cover: the public callers pass the cover: `ResultsList` and `MyLikesPage` render
  `cover.small_url` for a listing with a cover and the placeholder without one; the `ListingCard` prop itself is
  covered by the shared `ListingCard.test.tsx::cover`. — `search/__tests__/ResultsList.test.tsx::ac2_cover`,
  `likes/__tests__/MyLikesPage.test.tsx::ac2_cover`, `ListingCard.test.tsx::cover`
- [ ] AC3 Avatar: renders the photo, or the first code point of "אבי" / a single-code-point emoji name, or the initial after an
  `error`; it is `aria-hidden`; the five sites use it with their sizes and tones; no other `Array.from(…)[0]`
  initial remains under `src/features`. — `web/src/components/__tests__/Avatar.test.tsx::ac3_avatar`
- [ ] AC4 Profile photo: without a photo the page shows the initial and "העלאת תמונה"; choosing a file sends
  `PUT /me/photo` with the file as the body, then shows the photo and "התמונה נשמרה"; "הסרת תמונה" sends the
  DELETE, goes back to the initial and focuses "העלאת תמונה"; a 413 shows `photos.errors.size`; a 429 with
  `Retry-After` shows `photos.errors.rateLimitedIn`; the control is shown with the "עליי" switch off. — `features/profile/__tests__/PersonPhoto.test.tsx::ac4_person_photo`
- [ ] AC5 E2E (CI only): create a listing through the API helpers, upload `web/e2e/fixtures/photo.jpg` (a small
  committed JPEG) to it with Playwright's `request.post` (raw body, `Content-Type: image/jpeg`), then the
  public listing page shows an `img` whose `src` ends in `-l.webp` and loads (natural width > 0) and the search
  card one ending in `-s.webp`; on `/me/profile` upload the same file through the page and see it. —
  `web/e2e/photos.spec.ts::ac5_gallery_and_profile_photo`
- [ ] NF1 `make build-check` passes (no runtime caching); `make i18n-check` passes; axe on the listing page and
  the profile page (existing `e2e` axe helpers) reports no new violations. — CI

## Tests to write
Unit (vitest): `ListingPage.test.tsx` (AC1), `ResultsList.test.tsx` and `MyLikesPage.test.tsx` (AC2),
`ListingCard.test.tsx::cover` (shared), `Avatar.test.tsx` (AC3), `PersonPhoto.test.tsx` (AC4),
`photos/__tests__/limits.test.ts` and `errors.test.ts` (shared). Test files are built with `node:buffer`'s
`File` if jsdom's is not accepted as a fetch body; the upload test asserts `arrayBuffer().byteLength` and the
`Content-Type`.
E2E (CI only, never locally): `photos.spec.ts::ac5_gallery_and_profile_photo` (if `0010e` merged first, the
file exists: add the test to it). CI's e2e job runs `make dev`, which creates `.media` (0010d).

## Risks / open questions
- **Order of merges.** Needs 0010c's "עליי" section, 0010d's and 0010j's fields. `0010e` shares four small
  pieces (Scope, "Shared code"); the second to merge drops its own copy. The map specs `0009v`–`0009y` (Slice
  9c) may touch `ListingCard` and the listing page; the second to merge rebases.
- **Brand vs artboard**: the brand allows only a corner badge on photos; the artboard has a "1 / 12" counter
  at the bottom. The gallery keeps the counter (artboard anatomy) on the listing page only, never on cards.
  The ux reviewer may move it below the image.
- **Person photo hint copy** promises where the photo is shown (0010j's surfaces: applicants of any listing,
  room people browse, chat); it must stay true when 0010f/0010h add surfaces.
- `PersonPhoto` reads `UserOut` from `useMe()`; if 0010c's profile page later reads the photo from
  `/me/profile` instead, only this component changes.

Spec-verifier round 1 (Opus/high) ran on the combined `0010e` (wizard + display): 1 blocker-free reject
with 8 majors and 9 minors plus nits; **round 1: 17 findings applied** across `0010e` and `0010k` (finding 6,
the split, decided by the orchestrator 2026-11-13: option b; finding 4, fixtures, moved to `0010d`/`0010j`). No
second round (one verifier round).

## Digest (filled by orchestrator after verification)
See `/digest`.
