---
id: 0007f
title: A seeker (or a visitor) finds rooms next to apartments in /search with a type filter, reads a room's flatmates and lifestyle on its page, and is told plainly when a room cannot take their application
status: done
depends_on: [0007g, 0007d, 0006f]   # 0007g (implies 0007b): the `lifestyle` criterion, its `Criterion` value and the `reasons.ts` stub; 0007b: rooms public, `listing_type` filter, `room_fit`, the 409s, the room fields; 0007d: `features/lifestyle`, `roomSectionHref`, `rooms.genderPreference.*`, `lifestyle.<key>.topic`; `SeekerProfileOut.birth_year` comes from 0007a; 0006f: the match module this extends (`reasons.ts`, `MatchChips`, `MatchCard`)
reviewers: [code, qa, ux]           # ux: new filter, new card variant and new page sections vs the artboards; qa: URL rules, apply-gate branches
estimate: 1 coder run               # top of the range, same size as 0006f; if it overruns, split the listing page + apply gate (AC7-AC10, AC13) into 0007h
---

## Goal
After this ships, `/search` shows apartments and rooms together, with a "סוג" filter (דירה שלמה / חדר בדירת שותפים,
both on by default, in the URL as `listing_type`); a room card says "חדר בדירת שותפים", "חדר ב־3 חדרים", "2 שותפים
(27, 30)", who it is for when gendered, and "שותפים בגילך" for a seeker whose age is within 5 years of every listed
flatmate. A room's public page shows its flatmates and "אורח החיים בדירה". A seeker the room cannot take sees a short
neutral reason instead of the apply button; one who must fill the profile's room section first gets a link there and
back. The `lifestyle` match reason is worded on the card and the listing page. Serves Dev Plan slice 7, part f of
seven (contract in `0007a`/`0007b`). PRODUCT.md rows "Rooms", "Gender preference", "Search", "Matching". Artboards:
`design/screens-v1/SearchDesktop.dc.html` (the "סוג" fieldset, the room card, the chip), `Search.dc.html` (mobile room
card), `Listing.dc.html` (the page the room facts join; the artboards draw no room page).

## Scope
**In:**
- `web/src/features/search/filters.ts`: `Filters.listing_type?: 'apartment' | 'room'` (set only when exactly one type
  is on; both on = absent). `KEYS` gains `'listing_type'` after `'available_by'` (so the canonical URL is
  `…&available_by=…&listing_type=room&pets=true…`); `parseFilters` keeps it only when it is exactly `apartment` or
  `room` (anything else is dropped, so no URL can 422); `countActive` counts it (one type = one active filter).
- `web/src/features/search/api.ts`: `searchListings` sends `listing_type` when set. `make client` before building
  (`operations['search_listings_listings_get']` gains it from `0007b`). The map query (`useMapSearch`) passes the same
  filters, so the type filter applies to pins too.
- `web/src/features/search/FiltersForm.tsx`: a fieldset (legend `search.type.legend`) above "מחיר חודשי", as the
  artboard: two checkbox rows (visible native inputs `h-[18px] w-[18px] accent-accent` inside a `<label className="flex
  min-h-[44px] items-center gap-[10px]">`, not the `sr-only peer` pills of the features; the legend reuses the panel's
  `legend` class), `search.type.apartment` and `search.type.room`. `Values` gains `apartment: boolean`, `room: boolean`
  (both `true` initially and in `EMPTY`; from `filters.listing_type`: `apartment` → only apartment on, `room` → only
  room on). **At least one stays on:** the box that is the only one checked is `disabled`, and `search.type.hint` is
  shown under the fieldset while exactly one is on, with id `${fieldId('room')}-type-hint` and `aria-describedby` on both
  boxes **only while the hint is rendered**. `toFilters` returns the new `listing_type` key (`FormFilters` is a mapped
  type over `Filters`, so `tsc` requires it), written through `parseFilters` (the form can only write what it reads). "ניקוי" resets both to on.
  `SearchPage.clear` already empties the URL, which drops `listing_type`.
- `web/src/features/listings/cardTitle.ts` (new): `cardTitle(t, { listing_type, rooms, street, city }) → string` =
  `listings.card.roomTitle` for a room, else `listings.card.title` (existing). Used by `ListingCard`, `ListingPage`'s
  `<h1>` and `SearchMap`'s pin label, so a room is "חדר ב־3 חדרים, רחוב …" everywhere on these three screens.
- `web/src/features/rooms/` (new, no barrel file):
  - `flatmates.ts`: `flatmatesText(t, { flatmates_count?: number | null; flatmate_ages?: readonly number[] }) → string | null`: `null`
    when `flatmates_count` is `null` or `undefined` (a legacy room, `0007a`, or the wizard preview before `0007e`;
    missing ages count as `[]`); `rooms.flatmates.one` (count 1) or `rooms.flatmates.many`
    otherwise; with ages, `rooms.flatmates.withAges` with `{{flatmates}}` = that text and `{{ages}}` = the ages in
    API order joined with `', '`. Ages are optional and may be fewer than the count: "3 שותפים (27)" is legal.
  - `genderPreferenceLabel(t, value) → string` (in `flatmates.ts`): a literal map `{ any: t('rooms.genderPreference.any'),
    women: t('rooms.genderPreference.women'), men: t('rooms.genderPreference.men') }[value]`, so `i18n-check` sees the
    keys (it verifies only literal `t('…')`). Used by the card chip, `RoomFacts` and `RoomGate`.
  - `age.ts`: `export const SIMILAR_AGE_YEARS = 5`; `seekerAge(birthYear: number, now = new Date()) =
    now.getUTCFullYear() - birthYear` (the API's rule, `0007a`); `flatmatesNearAge(birthYear: number | null |
    undefined, ages: readonly number[], now?) → boolean`: `false` when `birthYear` is null/undefined or `ages` is
    empty, else every `|age - seekerAge| <= 5`. Computed in the web from `GET /me/profile`; no API field.
  - `RoomFacts.tsx` (`{ listing: ListingPublic }`): the listing page's room block (UI).
  - `RoomGate.tsx` (`{ listing: ListingDetail }`): the "fill the room section first" block (UI).
- `web/src/features/listings/ListingCard.tsx`: `CardFacts` gains the optional (so `0007e`'s wizard preview and
  `PreviewStep` keep compiling) `Partial<Pick<ListingOut, 'gender_preference' | 'flatmates_count' |
  'flatmate_ages'>>`; new optional prop `seekerBirthYear?: number | null`. For `listing_type === 'room'`: the photo
  placeholder carries a bottom-end pill `listings.card.room` (existing key, "חדר בדירת שותפים", as the artboard; the
  same text is **removed from the chips list**, where it was), the title via `cardTitle`, `flatmatesText` becomes the
  first entry of the facts line (before the floor), the chips gain `rooms.card.forGender` (when `gender_preference`
  is `women` or `men`; `{{who}}` = `genderPreferenceLabel(t, value)`) and, **first in the list and accent-tinted**
  (`bg-accent-tint text-accent-text`, the artboard's chip), `rooms.card.similarAge` when
  `flatmatesNearAge(seekerBirthYear, listing.flatmate_ages ?? [])`. The chips list stays one `<ul data-testid="listing-chips">`;
  each chip becomes `{ text, tone }`. Apartments render exactly as today. `ListingCard` also renders `MyListingsPage`'s rows and the wizard preview: an
  owner's own room rows and the preview get the same room anatomy (pill, flatmates, "who" chip). Accepted and intended:
  the owner sees what seekers see; `0007e`'s Out line that the "my listings" card shows no flatmates count was only
  deferring the card to this spec.
- `web/src/features/search/ResultsList.tsx` and `SearchMap.tsx` (the selected pin's card): pass
  `seekerBirthYear={profile?.birth_year}` to `ListingCard` (`profile` is already a prop after `0006f`; a visitor, an
  owner or a seeker without the room section has none, so no chip). `SearchMap`'s pin `label` uses `cardTitle`; the
  pin `text` is unchanged (rooms are plain price pins, the artboards draw nothing else).
- `web/src/features/listings/ListingPage.tsx`: `<h1>` via `cardTitle`; for a room, `<RoomFacts>` directly after
  `ListingFacts`. Final order for a room: price + title + facts line → `ListingFacts` → `RoomFacts` → description →
  (`0006e`'s `OwnerPreferences`) → location → `MatchCard` → `ApplySection`.
- `web/src/features/applications/ApplySection.tsx`, `useApply.ts` (apply gate, UI + API errors), plus
  `web/src/features/applications/ProfileGate.tsx` unchanged.
- `web/src/features/match/reasons.ts`: the `lifestyle` criterion (`SEEKER.lifestyle`, `SEEKER_SHORT.lifestyle`),
  because `0007g`'s type-only `Criterion` edit makes the `Record<Criterion, …>` maps incomplete. `0006f` is on `main`, so `0007g` **will** leave a stub: `SEEKER.lifestyle` without params, `SEEKER_SHORT.lifestyle` →
  `null` and `he.json` `match.seeker.lifestyle.agree|differ`. This spec replaces all three (and any reasons-test row
  0007g added for the stub). No other file in `features/match/` changes (`MatchChips`, `MatchCard` call the maps).
- `web/src/locales/he.json`: `search.type.*`, `listings.card.roomTitle`, `rooms.flatmates.*`, `rooms.card.*`,
  `rooms.facts.*`, `rooms.apply.*`, `match.seeker.lifestyle.*`, `match.short.lifestyle.*` (UI has every string).
- Fixtures: `features/search/__tests__/fixtures.ts` `publicListing()` gains `gender_preference: 'any'`,
  `flatmates_count: null`, `flatmate_ages: []`, `lifestyle: {}`; `listingDetail()` gains `room_fit: null` (done by `0007b`, which this spec takes as done; nothing to
  add if it landed). Other fixtures typed `ListingPublic`/`ListingOut`
  fail `tsc` until they get the same defaults: the coder fixes what `make lint` finds.
- `web/e2e/helpers.ts`: `putProfile(page, overrides: Record<string, unknown> = {})` spreads `overrides` into the
  body (e.g. `{ gender: 'man' }`). `postListing`'s `overrides` come from `0006f`.

**Out:**
- The owner side of the `lifestyle` criterion and the inbox: `0007c` (`specs/0007c-room-inbox.md`). The listing wizard's room fields: `0007e`. The
  profile room section itself: `0007d`.
- `cardTitle` on the other screens that show a listing title (`MyApplicationsPage`, `ApplicantsPage`, `ChatListPage`,
  `ChatThreadPage`, `MyListingsPage` uses `ListingCard` and gets it free): they keep "N חדרים, רחוב …" for rooms;
  logged in FOLLOWUPS by the coder, or picked up by `0007c`.
- The artboard's third checkbox "מחפשים שותף/ה לדירה קיימת": Slice 8 (people browsing).
- A link from the "room does not fit" reason to the profile (the reason can be the room's gender or the seeker's
  flatmates preference; one neutral line, no call to change who one is).
- `MyApplicationsPage` and chat: no change.

**New dependencies:** none.

## Data
None (web only). Reads `listing_type` (query), `gender_preference`, `flatmates_count`, `flatmate_ages`, `lifestyle`
and `room_fit` on `GET /listings(/{id})` (`0007b`), and `gender`, `birth_year`, `flatmate_gender`, `lifestyle` on
`GET /me/profile` (`0007a`/`0007d`).

**Room privacy (Gilad 2026-11-11, PRODUCT.md "Rooms", option (b), shipped by `0007b`):** on the public responses
(`GET /listings`, the map, `GET /listings/{id}`) a room's `flatmate_ages` and `lifestyle` are filled only for a
signed-in **seeker**; an anonymous visitor and any owner get `flatmate_ages: []` and `lifestyle: {}` (the types do
not change). `flatmates_count` and `gender_preference` stay public. An owner's own room in "my listings"
(`MyListingOut`) keeps its ages. So every room view here must read well with empty ages and answers: the flatmates
text drops the parentheses ("2 שותפים"), the "אורח החיים בדירה" heading and rows are absent, no empty heading and no
placeholder row. The web never branches on the viewer's role for this: it renders what the response holds.

## API
Consumed, no new endpoints:
| Method | Path | Auth rule | Use here | Errors handled |
| --- | --- | --- | --- | --- |
| GET | `/listings` | public (cookie optional) | `listing_type=apartment\|room`, sent only when one type is on | 422 impossible (the URL parser) |
| GET | `/listings/{id}` | public | `room_fit: boolean \| null`, room fields | 404 / 422 as today |
| GET | `/me/profile` | seeker | `birth_year`, `gender`, `lifestyle` | 404 `seeker_profile_not_found` = no profile |
| POST | `/listings/{id}/applications` (`0004a`) | seeker | the apply | 409 `seeker_gender_required`, 409 `room_gender_mismatch` (new), as before 409 `seeker_profile_required`, `already_applied` |

## UI
**Copy (`he.json`, gender-neutral; `־` is the maqaf U+05BE, never a hyphen):**
| key | Hebrew |
| --- | --- |
| `search.type.legend` | סוג |
| `search.type.apartment` | דירה שלמה |
| `search.type.room` | חדר בדירת שותפים |
| `search.type.hint` | לפחות סוג אחד צריך להישאר מסומן |
| `listings.card.roomTitle` | חדר ב־{{rooms}} חדרים, רחוב {{street}}, {{city}} |
| `rooms.flatmates.one` | שותף/ה אחד/ת |
| `rooms.flatmates.many` | {{count}} שותפים |
| `rooms.flatmates.withAges` | {{flatmates}} ({{ages}}) |
| `rooms.card.forGender` | ל{{who}} בלבד |
| `rooms.card.similarAge` | שותפים בגילך |
| `rooms.facts.title` | על החדר |
| `rooms.facts.gender` | העדפת מגדר |
| `rooms.facts.flatmates` | שותפים בדירה |
| `rooms.apply.misfit` | החדר לא מתאים לפרטים שבפרופיל שלך, ולכן אי אפשר להגיש אליו מועמדות. |
| `rooms.apply.roomSectionRequired` | החדר מיועד ל{{who}} בלבד. כדי להגיש מועמדות צריך להשלים בפרופיל את החלק ״חדר בדירת שותפים״. |
| `rooms.apply.fillRoomSection` | השלמת הפרטים בפרופיל |
| `match.seeker.lifestyle.agree` | אורח החיים שלך קרוב לזה שבדירה |
| `match.seeker.lifestyle.agreeSame` | אורח החיים שלך קרוב לזה שבדירה (תשובות זהות: {{same}} מתוך {{shared}}) |
| `match.seeker.lifestyle.differ` | אורח החיים שונה: {{topics}} |
| `match.short.lifestyle.agree` | אורח חיים דומה |
| `match.short.lifestyle.differ` | אורח חיים שונה |

Reused, owned by `0007d`: `rooms.genderPreference.any|women|men` ("לא משנה" / "נשים" / "גברים"),
`lifestyle.title.flat` ("אורח החיים בדירה"), `lifestyle.<key>.topic` and `lifestyle.<key>.answer.1|2|3`. `0007e` adds
`listings.room.*` / `listings.roomPreview.*` (the wizard), so no key clashes; `he.json` merges are the second PR's rebase.

**`/search` filter.** The form is the panel of `0003b` ("מסננים"); the type fieldset is its first group. Apply on
"הצגת תוצאות" like every other field (no instant apply). States: loading / empty / error / success are the page's
(`ResultsList`); a type that matches nothing shows today's `search.empty` and the "ניקוי" button (the filter counts
as active). Count line unchanged ("N דירות" counts rooms too). URL: `listing_type=room` / `listing_type=apartment`;
both on = no key; reload keeps it.

**Room card** (`ListingCard`, both the list and the selected pin's card): anatomy of `SearchDesktop.dc.html` lines
139-149: dark pill on the photo, "חדר ב־3 חדרים, רחוב …, …", facts line "2 שותפים (27, 30) · קומה 2 · … · כניסה …",
chips (teal "שותפים בגילך" first, then "לנשים בלבד" when gendered, then the usual chips; the room chip is the photo
pill now). For a visitor or an owner the response has no ages, so the facts line begins "2 שותפים" (Data, room
privacy). The match badge and chips of `0006f` keep their slots. Photo pill uses `start-2 bottom-2` (the artboards put it at `right`, which is inline-start in RTL); the photo placeholder `div` gets `relative` (it has none today).

**Room facts** (`RoomFacts`, rendered only for a room): `<section aria-labelledby>` with `<h2>` `rooms.facts.title`,
a `<dl>` styled like `ListingFacts`'s cards with `rooms.facts.gender` → `genderPreferenceLabel(t, value)` and, when
`flatmatesText` is not `null`, `rooms.facts.flatmates` → that text. Under it, when the listing's `lifestyle` has at
least one answered key: `<h3>` `lifestyle.title.flat`, a `<dl>` of one row per answered key in `LIFESTYLE_KEYS` order
(from `features/lifestyle/keys.ts`): `<dt>` `lifestyle.<key>.topic`, `<dd>` `lifestyle.<key>.answer.<n>`
(`t(\`lifestyle.${key}.answer.${n}\`)`; `i18n-check` does not see the dynamic key, `0007d` AC1 checks the catalogue).
No answers: the lifestyle block is absent (no empty box, no nudge: that is the owner's wizard's job). That is also
what a visitor and an owner see on every room, whose response carries `lifestyle: {}` and `flatmate_ages: []` (Data,
room privacy): the flatmates row then reads "2 שותפים" and the `<h3>` is not rendered. A legacy room
(`flatmates_count: null`) shows no flatmates row.

**Apply section for a room** (the existing controls chain of `ApplySection`; rooms add two branches, apartments are
untouched). Exact positions in the chain:
1. Right after the `live` (already applied) branch (`ApplySection.tsx` ~309-320): `listing.room_fit === false` → `<p>` `rooms.apply.misfit` (`text-start`, no button, no form, no profile gate). It
   needs no profile request to render; the count line above it stays. No link: see Out.
2. Between the `profile.isError && profile.data === undefined` branch (~323) and `profile.data === null` (~325), so "profile
   settled" is the chain itself: `listing.listing_type === 'room'` and
   `listing.gender_preference !== 'any'` and (`profile.data === null` or `profile.data.gender === null`) → `RoomGate`:
   `<p>` `rooms.apply.roomSectionRequired` (`{{who}}` = `genderPreferenceLabel(t, gender_preference)`), a primary link
   `rooms.apply.fillRoomSection`, ≥ 44 px, to `roomSectionHref('/listings/' + listing.id)` (from
   `features/profile/links.ts`, `0007d`: `/me/profile?section=room&next=%2Flistings%2F<id>`; `next` is the same safe
   same-origin path the profile page validates with `safeNext`). This branch comes before `ProfileGate`, so a seeker
   with no housing profile at all lands on the one page that now serves both.
3. Everything else as today (`ProfileGate` for no profile, `ApplyForm`). A `לא משנה` room never asks for the room
   section (PRODUCT.md "Rooms").

**409 handling** (`useApply.onError`, beside the existing branches; neither costs rate-limit budget, `0007b`):
`useApply.ts` (~41-44) replaces its two-way ternary: `seeker_profile_required` and `seeker_gender_required` →
invalidate `PROFILE_KEY` (the gate of branch 2 appears); `seeker_gender_required` also invalidates
`['listing', listingId]` (the owner may have switched an `any` room to gendered after the page loaded: without it the
cached `any` listing keeps a button whose every submit is a swallowed 409; one extra counted view, on a rare race);
`room_gender_mismatch` → `setQueryData(['listing', id], old => old && { ...old, room_fit: false })` (branch 1 appears
at once, no extra view counted); any other 409 (`already_applied`) → `MY_APPLICATIONS_KEY`, as today. No `['search']`
invalidation: the search queries are unmounted while the page is open and refetch on mount. Update the hook's
docstring. `ApplyForm.onError` already returns silently on any 409; the swap of the controls is the feedback.

**`lifestyle` reasons** (`reasons.ts`; `listing.lifestyle` and `profile.lifestyle` are `LifestyleAnswers`,
`compareLifestyle` from `features/lifestyle/keys.ts`): let `c = compareLifestyle(listing.lifestyle, profile.lifestyle)`.
- long, agree: `match.seeker.lifestyle.agree` (no params) when `c.same === 0`, else `match.seeker.lifestyle.agreeSame` with
  `{ same: c.same, shared: c.shared }` (a key one step apart still agrees under `0007g`, so "0 מתוך 1" must not show).
- long, differ: `match.seeker.lifestyle.differ` with `{ topics }` = the first three of `c.differing` mapped through
  `lifestyle.<key>.topic` and joined with `new Intl.ListFormat('he', { type: 'conjunction' })` (the conjunction from
  the locale, never a hardcoded "ו" in a `.ts` file): "אורח החיים שונה: ניקיון ושעות לילה". When `c.differing` is
  empty (the profile changed after the score was computed) the line is `t('match.short.lifestyle.differ')`.
- short: `match.short.lifestyle.agree|differ` (the listing and profile are not needed).
`0006f`'s `MatchChips` shows `agrees[0]` and `differs`, `MatchCard` all agree lines and the differ line, so both pick
the new copy up with no code change. A listing answers `lifestyle` only for rooms (`0007g`), so apartments never show it.

**RTL notes:** logical properties only (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`). The photo pill is `start-2` (artboards: `right: 8px`). "2 שותפים
(27, 30)": digits are European numbers, so ", " between them takes the paragraph's RTL direction (UAX 9 rule N1) and the
ages read 27 then 30 from the right, as the artboard; no `dir` attributes. "ב־3 חדרים": the maqaf (U+05BE) sits
between the letter and the digits, rendering "ב־3"; do not use `-`. "(2 מתוך 3 תשובות זהות)" and "7,200" are the same
kind of run. The type checkboxes are native inputs: the box is on the inline-start side of its label in RTL.

**A11y:** the type boxes are in a `<fieldset>` with a `<legend>`; the disabled last box has the hint as its
description; the room pill on the photo is text (not an image), the chips carry words; the gate and misfit blocks are
plain text in the apply `<section>` (no `role=alert`; they are state, not an event).

## Acceptance criteria
Vitest + Testing Library with the search / listing / applications harnesses (`features/search/__tests__/fixtures.ts`,
`features/auth/__tests__/harness`, `features/applications/__tests__/ApplySection.test.tsx`'s `renderSeeker`); AC texts
assert rendered Hebrew, not keys. The apartment-only assertions of the existing tests must still pass unchanged.
- [ ] AC1 `filters.ts`: `parseFilters('listing_type=room')` and `'listing_type=apartment'` keep it; `'listing_type=both'`, `'listing_type='`, `'listing_type=Room'` drop it; `toSearchParams` writes it after `available_by` (`'available_by=2027-01-05&listing_type=room&pets=true'`); `countActive` is 1 for `listing_type=room` alone and 0 for none — `web/src/features/search/__tests__/filters.test.ts::ac1_listing_type_in_url`
- [ ] AC2 Given `/search` and the panel open, Then the group "סוג" has "דירה שלמה" and "חדר בדירת שותפים" both checked and no `listing_type` in the request; When "דירה שלמה" is unchecked and "הצגת תוצאות" pressed, Then the URL is `/search?listing_type=room`, the request carries `listing_type=room`, the filters button reads "מסננים · 1", and the remaining checked box is disabled with "לפחות סוג אחד צריך להישאר מסומן" shown; re-checking it and applying removes the key; given `/search?listing_type=apartment` the form opens with only "דירה שלמה" checked; "ניקוי" re-checks both and empties the URL — `web/src/features/search/__tests__/SearchPage.test.tsx::ac2_type_filter`
- [ ] AC3 Given the map view (`view=map`) with `listing_type=room`, Then the map request carries `listing_type=room` — `web/src/features/search/__tests__/SearchMap.test.tsx::ac3_map_sends_type`
- [ ] AC4 Given a room `{ rooms: 3, street, city, gender_preference: 'women', flatmates_count: 2, flatmate_ages: [27, 30] }`, Then its card's title link reads "חדר ב־3 חדרים, רחוב …, …", the photo pill and no chip read "חדר בדירת שותפים" once (the pill only), the facts line begins "2 שותפים (27, 30)", the chips include "לנשים בלבד"; with `flatmates_count: 1` and `[]` the line begins "שותף/ה אחד/ת"; with `flatmates_count: 2` and `[]` (a visitor's or an owner's response) it begins "2 שותפים" and the card has no "(" in the facts line; with `flatmates_count: null` there is no flatmates text; with `flatmates_count: 3` and `[27]` it begins "3 שותפים (27)"; an apartment card is unchanged (title "N חדרים, …", no pill, no flatmates, no gender chip); `cardTitle` is used for the map pin label — `web/src/features/listings/__tests__/ListingCard.test.tsx::ac4_room_card` (new file; pin label asserted in `SearchMap.test.tsx::ac4_room_pin_label`)
- [ ] AC5 `flatmatesNearAge(birthYear, ages, now)` with `now` in 2026: birth 1999 (age 27) and ages `[27, 30]` → true; ages `[27, 33]` → false (6 apart); ages `[22, 32]` → true (exactly 5); `[]` → false; birth `null` / `undefined` → false. Component (the fixture's `birth_year` is `new Date().getUTCFullYear() - 28`, within 5 of `[27, 30]` in any year; the "no chip" seeker uses `getUTCFullYear() - 40`): a seeker whose `GET /me/profile` has `birth_year` within 5 years of `[27, 30]` sees "שותפים בגילך" as the first chip of the room card (list and selected pin card) and not on an apartment card; a visitor, an owner, a seeker with `birth_year: null`, and a seeker whose profile request failed see no such chip and the page sends no `GET /me/profile` for visitors and owners — `web/src/features/rooms/__tests__/age.test.ts::ac5_flatmates_near_age`, `web/src/features/search/__tests__/SearchPage.test.tsx::ac5_similar_age_chip`
- [ ] AC6 Given `GET /listings` answering a room and an apartment with `match` set, Then the room card keeps the match badge and chips of `0006f` (a `lifestyle` agree chip reads "אורח חיים דומה", a differ chip "אורח חיים שונה") — `SearchPage.test.tsx::ac6_room_with_match_chips`
- [ ] AC7 Given `GET /listings/{id}` for a room `{ gender_preference: 'men', flatmates_count: 2, flatmate_ages: [27, 30], lifestyle: { cleanliness: 3, kosher: 1 } }`, Then the page `<h1>` is "חדר ב־…", a section "על החדר" has the rows "העדפת מגדר: גברים" and "שותפים בדירה: 2 שותפים (27, 30)", and a heading "אורח החיים בדירה" is followed by exactly two rows in `LIFESTYLE_KEYS` order "ניקיון: בקפדנות" and "כשרות: לא כשר" (the `topic` and `answer` strings of `0007d`); with `lifestyle: {}` no "אורח החיים בדירה" heading; with `flatmate_ages: []` and `lifestyle: {}` together (what a visitor or an owner receives) the section still shows "העדפת מגדר" and "שותפים בדירה: 2 שותפים" (no parentheses) and nothing else, no empty heading; with `gender_preference: 'any'` the row reads "לא משנה"; with `flatmates_count: null` no flatmates row; an apartment page has no "על החדר" section; the section sits after the facts grid and before the description — `web/src/features/listings/__tests__/ListingPage.test.tsx::ac7_room_facts_and_lifestyle`
- [ ] AC8 Given a seeker with a profile and a room `GET /listings/A` answering `room_fit: false`, Then the apply section shows "החדר לא מתאים לפרטים שבפרופיל שלך, ולכן אי אפשר להגיש אליו מועמדות." and no "הגשת מועמדות" button, no form, no profile gate (even while `GET /me/profile` is pending); `room_fit: true` or `null` on an `any` room shows the apply button; an apartment with `room_fit: null` is unchanged; a seeker who already applied (`live`) still sees the applied state, not the misfit text — `web/src/features/applications/__tests__/ApplySection.test.tsx::ac8_room_misfit` (room listings via `renderSeeker`'s `extra: { 'GET /listings/A': [() => json(listingDetail({ id: 'A', listing_type: 'room', … }))] }`; test names carry this spec's AC number, duplicates across specs are accepted)
- [ ] AC9 Given a `women` room and a seeker whose profile has `gender: null` (or no housing profile at all, 404), Then the section shows "החדר מיועד לנשים בלבד. כדי להגיש מועמדות צריך להשלים בפרופיל את החלק ״חדר בדירת שותפים״." and a link "השלמת הפרטים בפרופיל" whose `href` is `/me/profile?section=room&next=%2Flistings%2FA`, no apply button and (even with no housing profile) no `ProfileGate` text; given the same room and a profile with `gender: 'woman'`, the apply button; given an `any` room and `gender: null`, the apply button (and with no housing profile, the existing `ProfileGate`) — `ApplySection.test.tsx::ac9_room_section_gate`
- [ ] AC10 Given a seeker whose apply answers 409 `room_gender_mismatch`, Then the apply controls become the misfit text with no reload, the cached listing's `room_fit` is `false`, and the 429 / error banners do not show; given 409 `seeker_gender_required`, Then `GET /me/profile` **and a second `GET /listings/A`** are requested (the stale-`any` race) and, when the profile now answers `gender: null`, the room-section gate shows; neither 409 shows the generic error — `ApplySection.test.tsx::ac10_room_409s`
- [ ] AC11 `reasons.ts` for `lifestyle`: listing `{ cleanliness: 3, guests: 1, night: 2 }` vs profile `{ cleanliness: 3, guests: 1, night: 3, kosher: 1 }` → agree "אורח החיים שלך קרוב לזה שבדירה (תשובות זהות: 2 מתוך 3)"; a pair one step apart on the one shared key (`same` 0) → agree "אורח החיים שלך קרוב לזה שבדירה" with no counts; a `differ` whose `differing` is empty → "אורח חיים שונה"; listing `{ cleanliness: 1, guests: 3, night: 1, social: 3 }` vs profile `{ cleanliness: 3, guests: 1, night: 3, social: 1 }` → differ "אורח החיים שונה: ניקיון, אורחים ושעות לילה" with the list joined by the locale's `ListFormat` ("ניקיון, אורחים ושעות לילה" in `he`; the test asserts `new Intl.ListFormat('he', { type: 'conjunction' }).format([...])` so it follows the runtime's ICU), only the first three topics; short chips "אורח חיים דומה" / "אורח חיים שונה"; `MatchCard` on a room with `match { agrees: [budget, lifestyle], differs: null }` renders the agree line — `web/src/features/match/__tests__/reasons.test.ts::ac11_lifestyle_copy` (extends `0006f`'s parametrized AC2) and `web/src/features/listings/__tests__/ListingPage.test.tsx::ac11_match_card_lifestyle`
- [ ] AC12 Given `make dev` is up, with `const roomStreet = \`חדר ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}\`` minted independently (it neither contains nor is contained in `street`, which the existing cards locate by substring: `search.spec.ts:73-74, 91`; never `${street} room`), When `web/e2e/search.spec.ts::ac9_visitor_searches_and_opens_listing` (extended; no new signup) has its owner also post, before the visitor step, a room (`postListing(page, roomStreet, { listing_type: 'room', price_ils: 7200, gender_preference: 'women', flatmates_count: 2, flatmate_ages: [27, 30], lifestyle: { cleanliness: 3, kosher: 1 } })`), Then, in a `test.step('ac12 …')` after the existing steps (the viewer is the anonymous visitor, so the API sends no ages and no answers, Data → room privacy): `/search` shows both cards (each found by its own street), the room card has "חדר בדירת שותפים", "2 שותפים" and "לנשים בלבד" and does **not** contain "27, 30"; unchecking "דירה שלמה" and applying leaves the URL `/search?listing_type=room` with the room card and without the apartment card (waiting for the count line as the existing steps do); the room card's link opens a page with "על החדר", "העדפת מגדר" and "שותפים בדירה", and **without** "אורח החיים בדירה" or "27, 30" — `web/e2e/search.spec.ts::ac9_visitor_searches_and_opens_listing` (extended)
- [ ] AC13 Given the same e2e flow as `applications.spec.ts::ac9_fill_profile_apply_withdraw` (extended; no new signup: its owner posts a second listing, a `women` room `{ listing_type: 'room', gender_preference: 'women', flatmates_count: 2, flatmate_ages: [27, 30], lifestyle: { cleanliness: 3, kosher: 1 } }`, before the seeker signs up), with the room's street minted independently as in AC12 (the file's `fitting` locator uses `hasText: street` and `toHaveCount(1)`, lines 101-104, and the room is visible to a seeker without a room section), Then, in a `test.step('ac13 …')` after its existing steps (and `0006f`'s ac10 and `0007d`'s steps), which opens with `await putProfile(page)` (a plain profile: PUT replaces, so the room section is cleared whatever `0007d`'s steps did): the seeker (housing profile, no room section) opens the room's page and sees the room-section gate link with `href` containing `section=room` and no apply button, and, being a signed-in seeker, the flatmates row "2 שותפים (27, 30)" and the "אורח החיים בדירה" block with its two answer rows (room privacy: the counterpart of AC12's visitor); after `putProfile(page, { gender: 'man' })` and a reload the room page shows the misfit text and no apply button, and `/search?listing_type=room` has no card for that street (after waiting for the count line, `p[aria-live="polite"]` not empty, as `search.spec.ts:84-86` does, so "no card" is not true only because the results have not loaded); after `putProfile(page, { gender: 'woman' })` and a reload the apply button is there — `web/e2e/applications.spec.ts::ac9_fill_profile_apply_withdraw` (extended)
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` clean; no hardcoded copy (no " ו", no "₪" outside keys; the `', '` age separator is punctuation, not copy); logical properties only; and `make e2e` green **locally** on the final head (first check `lsof -nP -iTCP:5173 -sTCP:LISTEN`; the result goes in the digest; CI `e2e` is off while `E2E_IN_CI=off`, CLAUDE.md Speed rule 7) — CI `web`, local `make e2e`
- [ ] NF2 Accessibility at 390 px and 1280 px: the type fieldset is keyboard-operable, rows ≥ 44 px, the last box's disabled state is explained by text; no meaning by colour alone (the "שותפים בגילך" chip is words); the gate link and the apply section stay one tab stop each — ux reviewer

## Tests to write
Unit: `filters.test.ts` (AC1), `rooms/__tests__/age.test.ts` (AC5), `reasons.test.ts` (AC11). Component: `SearchPage.test.tsx`
(AC2, AC5, AC6), `SearchMap.test.tsx` (AC3, pin label of AC4), `ListingCard.test.tsx` (AC4, new), `ListingPage.test.tsx`
(AC7, AC11), `ApplySection.test.tsx` (AC8-AC10; names `ac8_…`, `ac9_…`, `ac10_…`). E2E (run locally, NF1): `search.spec.ts` and `applications.spec.ts` extended (AC12, AC13; the room's street is minted independently, never derived from an existing street)
+ `helpers.ts` `putProfile` overrides.
Existing tests that may break: any that render a room listing's card or title (the room chip leaves the chips list;
the title becomes `roomTitle`), found by `make test`; `filters.test.ts`'s `KEYS`-order cases only if they list all keys;
`SearchPage.test.tsx::ac2_url_is_the_filter_state`'s count of active filters is unaffected (no `listing_type`).
Fixtures: see Scope. No new test fixtures for `GET /me/profile` beyond `0007d`'s `profile({ gender, birth_year })`.

## Risks / open questions
- **Decided (orchestrator, 2026-11-11):** `lifestyle.<key>.topic` + `answer.n` read as "ניקיון: בקפדנות", "שבת: גמישות" in the flat's
  block. If the UX reviewer finds some pairs awkward, the fix is in `0007d`'s copy (the `topic` strings), not here.
- **Decided (orchestrator, 2026-11-11), option A:** the misfit line is deliberately one neutral sentence with no link, because the cause can be
  the room's gender preference or the seeker's own flatmates preference and the web should not nudge anyone to change
  their gender to apply. Option B: when the seeker's `flatmate_gender` is not `any`, add a link to the room section
  ("שינוי העדפת השותפים"). Revisit if misfit sessions show up in support.
- **Decided (orchestrator, 2026-11-11):** the count line says "N דירות" also for rooms. Option B: "N תוצאות" (touches 6 existing tests and the
  `0003b` copy). Kept as "N דירות".
- A room's `{{rooms}}` of "1" gives "חדר ב־1 חדרים" (the apartment title has the same "1 חדרים"); not fixed here.
- A viewer who is a seeker without the room section sees misfit rooms in results (the API hides only for those with a
  section, `0007b`); they meet `room_fit` only on the page, and the gate. Expected, per PRODUCT.md "Rooms".
- `room_fit` is cached per caller with the rest of `GET /listings/{id}`; `0006f`'s `clearSession` reset on logout
  already covers it (a different viewer never sees the previous one's `room_fit`).
- **Decided (Gilad, 2026-11-11, option (b), PRODUCT.md "Rooms"):** flatmate ages and lifestyle answers reach only a
  signed-in seeker; visitors and owners get `[]` / `{}` (Data). The web renders what it gets, so it needs no role
  check; AC4, AC7, AC12 and AC13 cover both sides. AC12's visitor assertions need `0007b`'s (b) change on the branch
  that runs `make e2e`: merge `origin/main` (or `0007b`'s branch) first. The seeker's birth year never leaves
  `GET /me/profile`, the chip is computed in the browser.
- `0007e`'s Out line ("my listings" card shows no flatmates count) is superseded: owner rows and the wizard preview get the room anatomy (Scope). Whichever of `0007e` / `0007f` builds second drops `RoomPreview`'s flatmates / "who" chips, because the card now shows them.
- `0006g` (in progress, `../rent-app-0006g`) also edits `reasons.ts` (the owner's voice): the second to merge rebases and keeps both maps.
- `0007g` (`specs/0007g-lifestyle-match-api.md`) leaves a `lifestyle` stub in `reasons.ts` and `he.json` (0006f merged first); this spec replaces it (Scope).
- `0007e` also edits `ListingCard`'s consumers (`PreviewStep`) and `he.json`; `0006e`/`0006f`/`0007d` edit
  `ListingPage.tsx` / `he.json`. Web specs never build at the same time (port 5173); the second to merge rebases and
  keeps the page order in Scope. The e2e OTP budget: this spec adds **zero** signups (it extends two existing flows).
- Size: top of one coder run (about 25 keys, 12 files). Split line if it overruns: `0007h` = listing page + apply gate
  (`RoomFacts`, `RoomGate`, `useApply`, AC7-AC10, AC13), leaving search + card + `lifestyle` copy here.

## Verifier findings — one round, 17 findings, all applied (0 blocker, 2 major, 15 minor; kept as the record)
Verdict: **would reject as written, but nothing needs a redesign.** Findings 1 and 2 turn `make e2e` red or skip it
against the current process. The rest are exact edits. Checked against `main` at `d917d05` (0006f merged, `1308156`):
every cited path, component and prop exists as the spec says. That covers `features/match/{reasons.ts,MatchChips,MatchCard}`,
`features/search/{filters,api,FiltersForm,ResultsList,SearchMap,useMapSearch}`, `ListingCard` / `CardFacts`,
`ListingPage`, `ApplySection` / `useApply` / `ProfileGate`, `PROFILE_KEY`, the fixtures, `e2e/helpers.ts`
`postListing(page, street, overrides)` and `putProfile(page)`, and the `he.json` keys `listings.card.room` /
`.title`, `search.filtersActive` ("מסננים · {{count}}") and `search.count` ("{{count}} דירות"). The four room fields
on `ListingPublic`, `room_fit` on `ListingDetail` only and both 409 codes match `0007b`. `features/lifestyle/keys.ts`,
`compareLifestyle`, `roomSectionHref` (`features/profile/links.ts`), `rooms.genderPreference.*` and
`lifestyle.<key>.topic|answer.n` match `0007d`; "ניקיון: בקפדנות" and "כשרות: לא כשר" are 0007d's strings. The
generated `lifestyle` type `{ [key: string]: 1 | 2 | 3 }` (0007a) assigns to `LifestyleAnswers` under this repo's
`strict` + `noUncheckedIndexedAccess`; checked with `tsc`. `new Intl.ListFormat('he', {type:'conjunction'})`
gives "ניקיון, אורחים ושעות לילה" in Node. The spec's `ב־` uses U+05BE, and there are no invisible characters.
PRODUCT.md "Rooms", "Gender preference", "Search" and "Matching": no contradiction. Reviewers `[code, qa, ux]` are
right: no new query or endpoint, so no perf; no PII leaves the browser (the birth year stays in `GET /me/profile`),
so no security. OTP budget: 0 new signups, correct (9 of 10, `0006d` finding 1).

**Orchestrator rulings (decided, record them in Risks, finding 17):** (1) the misfit line has no link; (2) the count
line keeps "N דירות"; (3) the topic + answer copy stays as `0007d` defines it, and the ux reviewer may flag it. Also
decided: `0007b` adds the `lifestyle` stub in `reasons.ts` and `he.json` (0006f merged first), and this spec replaces it.

1. (major) NF1 (line 217) and AC12/AC13 say e2e is "written and type-checked, **not run locally** … CI `e2e` runs
   them". That is obsolete. `CLAUDE.md` Speed rule 7 (commit `d917d05`, Gilad, 2026-11-11) now says that CI's
   `e2e` is off (`E2E_IN_CI=off`) and that every web spec runs `make e2e` locally on its final head and reports the
   result in its digest. The orchestrator's correction says the same, and so does the contract ("Pending cross-spec
   edits": "rule 7 = local `make e2e`"). **Fix:** NF1 → "`make lint`, `make test`, `make i18n-check`, `make
   build-web` clean, and `make e2e` green **locally** on the final head (first check
   `lsof -nP -iTCP:5173 -sTCP:LISTEN`; the result goes in the digest; CI `e2e` is off while `E2E_IN_CI=off`) — CI
   `web`, local `make e2e`". Delete "(CLAUDE.md rule 7), CI `e2e` runs them on the single push".
2. (major) The e2e locators match streets by substring, so the new room makes the existing assertions fail:
   - `search.spec.ts:73` `card = getByRole('article').filter({ hasText: street })`, then `toHaveCount(1)` at :74
     and :91.
   - `applications.spec.ts:101-104` `fitting = filter({ hasText: street }).filter({ hasNotText: overBudgetStreet })`,
     then `toHaveCount(1)`. At that point the seeker has no room section, so every room is visible.

   The file's own pattern is `` `${street} over` `` (`applications.spec.ts:18`). If the coder copies it for the room
   (`` `${street} room` ``), both counts become 2. **Fix (AC12, AC13 and Tests to write):** the room's street is an
   independent unique string that neither contains nor is contained in `street`. For example:
   `` const roomStreet = `חדר ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` ``, minted
   separately. Each card is then located by its own street.
3. (minor) AC13's starting state depends on `0007d` AC9. That AC extends the same `ac9_fill_profile_apply_withdraw`:
   it fills a room section as "אישה" + "נשים" and switches it off again later. **Fix:** open the `ac13` step with
   `await putProfile(page)` (a plain `P`, which clears the room section because PUT replaces), so "housing profile,
   no room section" holds whatever 0007d's steps did. Before the negative `/search?listing_type=room` assertion,
   wait for the count line (`p[aria-live="polite"]` not empty), as `search.spec.ts:84-86` does. Otherwise "no card"
   passes before the results load.
4. (minor) RTL: the photo pill is on the wrong side. The artboards put it at `right: 8px` / `right: 12px`
   (`SearchDesktop.dc.html:140`, `Search.dc.html:85`), and in `dir="rtl"` the right edge is inline-**start**.
   **Fix:** line 149 and the RTL notes (line 190): `start-2 bottom-2` (not `end-2`). Also,
   `ListingCard.tsx:87`'s placeholder `div` has no `relative`. Add it, or the absolute pill anchors to the
   `article`, which is `relative` only when linked (`linkedCard`, :10).
5. (minor) `CardFacts` makes the room fields optional (line 52). `PreviewStep.tsx:29` passes the wizard body, which
   lacks them until `0007e`, because `0007a` omits them from `ListingInBody`. **Fix:** `flatmatesText(t,
   { flatmates_count?: number | null; flatmate_ages?: readonly number[] })`: `undefined` counts as `null` (no text),
   and missing ages count as `[]`. `ListingCard` calls `flatmatesNearAge(seekerBirthYear, listing.flatmate_ages ?? [])`.
6. (minor) `ListingCard` also renders `MyListingsPage`'s rows and the wizard preview. With a full `MyListingOut`,
   the owner's own room rows gain the pill, "2 שותפים (27, 30)" and "לנשים בלבד". That contradicts `0007e`'s Out
   ("The 'my listings' card: it shows no flatmates count", 0007e line 72). Once 0007e passes the fields, the preview
   would also repeat 0007e's `RoomPreview` chips. **Fix:** in Scope, say that owner rows and the preview get the same
   room anatomy (accepted: the owner sees what seekers see). In Risks, say that 0007e's Out line is superseded, and
   that whichever of 0007e / 0007f builds second drops `RoomPreview`'s flatmates / "who" chips, because the card
   now shows them.
7. (minor) Gender-preference labels are built from dynamic keys: `` t('rooms.genderPreference.' + value) `` (lines
   58, 152, 166). `scripts/i18n-check.mjs:91-96` verifies only literal `t('…')` keys, and the codebase's pattern is a
   literal map (`ListingCard.tsx:58-64`, `ListingFacts.tsx:27-31`). **Fix:** add a
   `genderPreferenceLabel(t, value)` in `features/rooms/flatmates.ts` that returns `{ any: t('rooms.genderPreference.any'),
   women: t('rooms.genderPreference.women'), men: t('rooms.genderPreference.men') }[value]`. Use it for the card
   chip, `RoomFacts` and `RoomGate`. The lifestyle answer keys stay dynamic, as line 156 says.
8. (minor) The `lifestyle` agree copy reads wrong in common cases. Under `0007b`, a key whose answers are one step
   apart scores 0.5 and still agrees, so one shared key one step apart renders "קרוב … (0 מתוך 1 תשובות זהות)", and
   one equal key renders "1 מתוך 1 תשובות". The profile can also change after the score was computed, giving
   `c.shared === 0` on an agree or `c.differing` empty on a differ ("אורח החיים שונה: "). **Fix (UI copy + AC11
   rows):**
   - `match.seeker.lifestyle.agree` = "אורח החיים שלך קרוב לזה שבדירה", with no params. Use it when `c.same === 0`.
   - New `match.seeker.lifestyle.agreeSame` = "אורח החיים שלך קרוב לזה שבדירה (תשובות זהות: {{same}} מתוך
     {{shared}})". Use it otherwise.
   - `differ` with `c.differing.length === 0` falls back to `t('match.short.lifestyle.differ')`.

   AC11's first example becomes "… (תשובות זהות: 2 מתוך 3)". Add rows for `same === 0` and for an empty `differing`.
9. (minor) Make the 0007b / 0006f overlap definite and fix the attributions:
   - Scope (lines 71-73): 0006f is on `main`, so `0007b` **will** leave the stub. That stub is
     `SEEKER.lifestyle` without params, `SEEKER_SHORT.lifestyle` → `null`, and `he.json`
     `match.seeker.lifestyle.agree|differ` (0007b lines 135-142). This spec replaces all three, and any reasons-test
     row 0007b adds for the stub.
   - Fixtures (lines 76-79): `publicListing()` / `listingDetail()` are done by `0007b` ("0007f takes these as done",
     0007b line 133), so drop the conditional.
   - Frontmatter `depends_on` comment: `SeekerProfileOut.birth_year` comes from `0007a`, not `0007d` (contract,
     "Pending cross-spec edits").
   - Lines 135-138: `0007e` adds `listings.room.*` / `listings.roomPreview.*` (0007e line 65), not `rooms.*`.
   - Add to Risks: `0006g` (in progress, `../rent-app-0006g`) also edits `reasons.ts` (the owner's voice). The second
     to merge rebases and keeps both maps.
10. (minor) The ApplySection test names break the repo convention. Tests carry their own spec's AC number, and
    duplicates across specs are accepted (`SearchPage.test.tsx:133` and `:399` are both `ac3_…`). **Fix:** AC8 →
    `ApplySection.test.tsx::ac8_room_misfit`, AC9 → `::ac9_room_section_gate`, AC10 → `::ac10_room_409s`. Drop
    "(numbered after the file's existing ACs)". For room listings, the tests pass
    `extra: { 'GET /listings/A': [() => json(listingDetail({ id: 'A', listing_type: 'room', … }))] }` to `renderSeeker`
    (it spreads `extra` last, `ApplySection.test.tsx:91-97`).
11. (minor) Give the exact branch positions instead of "before the profile skeleton" (line 161):
    - Branch 1 (`room_fit === false`) goes right after the `live` branch (`ApplySection.tsx:309-320`).
    - Branch 2 (`RoomGate`) goes between the `profile.isError && profile.data === undefined` branch (:323) and
      `profile.data === null` (:325). Its "settled" guard is then the chain itself.
    - `useApply.ts:41-44`: replace the two-way ternary with `seeker_profile_required` / `seeker_gender_required` →
      `PROFILE_KEY`, `room_gender_mismatch` → `setQueryData`, and any other 409 (`already_applied`) →
      `MY_APPLICATIONS_KEY`, as today. Update the hook's docstring.
12. (minor) A stale `gender_preference` leaves a dead button. The owner may switch an `any` room to `women` after the
    page loaded. The cached listing still says `any`, so branch 2 never shows, and `ApplyForm.onError` swallows every
    409 (`ApplySection.tsx:83`). Each submit then does nothing. **Fix:** on `seeker_gender_required`, also
    `invalidateQueries(['listing', listingId])`. That costs one extra counted view, on a rare race. AC10 asserts a
    second `GET /listings/A` for that 409.
13. (minor) `invalidate ['search']` on `room_gender_mismatch` (line 177) does not reach the map, whose key is
    `['search-map', …]` (`useMapSearch.ts:13`). Neither invalidation is needed anyway: both queries are unmounted
    while the listing page is open, and they refetch on mount (default `staleTime` 0, `App.tsx:12`). **Fix:** drop
    the `['search']` invalidation from line 177 and from AC10. The search lists, not the 409, keep a misfit room away.
14. (minor) AC5's component half depends on the year: `seekerAge` reads `new Date()`. **Fix:** build the fixture's
    `birth_year` as `new Date().getUTCFullYear() - 28`, so it is within 5 of `[27, 30]` in any year. Use
    `getUTCFullYear() - 40` for the "no chip" seeker.
15. (minor) The misfit copy (`rooms.apply.misfit`, line 127) blames "ההעדפות". The usual cause is the seeker's own
    gender against the room's preference, which is not a preference. **Fix:** "החדר לא מתאים לפרטים שבפרופיל שלך,
    ולכן אי אפשר להגיש אליו מועמדות." AC8 changes to match. The ux reviewer may still tune it.
16. (minor) Type fieldset details (lines 30-36):
    - Set `aria-describedby` only while the hint is rendered, so it never points at a missing id. The hint's id is
      `` `${fieldId('room')}-type-hint` ``, in the form's `fieldId` scheme.
    - The boxes are visible native inputs (`h-[18px] w-[18px] accent-accent` inside a `<label className="flex
      min-h-[44px] items-center gap-[10px]">`), not the features' `sr-only peer` pills (`FiltersForm.tsx:276-288`).
    - `toFilters` (`FiltersForm.tsx:92-116`) must return the new `listing_type` key: `FormFilters` is a mapped type
      over `Filters` (:17), so `tsc` requires it.
    - The fieldset reuses the panel's `legend` class (:118).
17. (minor) Checklist line 9: Risks still carries three "Open" items (lines 231-238). **Fix:** rewrite them as
    "Decided (orchestrator, 2026-11-11)": the misfit line has no link (option A); the count line keeps "N דירות"; the
    topic + answer copy stays as `0007d` defines it, and the ux reviewer may flag pairs for `0007d` to fix.

**Size:** it fits one coder run, at the top of the range. That is 13 ACs, 2 screens, 0 endpoints and about 17 source
files, against 0006f's 11 ACs, which landed in one run. The extra cost is the local `make e2e` (finding 1). **No
split now.** If the run overruns, the contingency split is exactly this: `0007h-room-listing-page-web` with
`depends_on: [0007f]` takes AC7, AC8, AC9, AC10, AC13 and AC11's
`ListingPage.test.tsx::ac11_match_card_lifestyle` half, plus `RoomFacts`, `RoomGate`, `ListingPage.tsx`,
`ApplySection.tsx`, `useApply.ts` and the `putProfile` overrides. 0007f keeps AC1–AC6, AC11's `reasons.test.ts`
half and AC12. `cardTitle` / `flatmatesText` / `genderPreferenceLabel` stay in 0007f, because 0007h imports them.

## Digest (filled by orchestrator after verification)

    Spec 0007f - Rooms in search and on the listing page (web)   (verified, Slice 7, depends on 0007g, 0007d, 0006f)
    What a user can do after this: anyone finds rooms next to apartments in /search (type filter "דירה שלמה" /
             "חדר בדירת שותפים", both on by default), sees the room card ("חדר ב־3 חדרים", "2 שותפים (27, 30)",
             "שותפים בגילך"), reads a room's flatmates and lifestyle on its page, and is told plainly when a
             room cannot take their application (or sent to fill the profile's room section first).
    Decisions I need from you: none new. Kept: the misfit line has no link; the count line stays "N דירות".
    KPIs this slice moves: share of searches that open a room; applications to rooms.
    Acceptance targets: NF1 lint/test/i18n/build clean + make e2e green locally - NF2 checkbox group with
             legend, 44 px targets, RTL pill at start.
    Risks: top of one coder run (same size as 0006f) - mitigation: a ready 0007h fallback split (listing page +
             apply gate). e2e locators matching streets by substring - mitigation: an independently minted street.
    Reviewers: code, qa, ux   Estimated: 1 coder run, 1 review round
    Links: specs/0007f-room-search-web.md - PRODUCT.md "Rooms", "Search" - design/screens-v1/Search.dc.html,
             SearchDesktop.dc.html, Listing.dc.html

    Spec 0007f - Rooms in search and on the listing page (web)   PR OPEN (not merged), code head 8de93b8
    Shipped: /search shows rooms next to apartments with a "סוג" filter (both types on by default, `listing_type`
             in the URL, the last box locked with a hint; the map follows it). A room card: "חדר בדירת שותפים"
             photo pill, "חדר ב־3 חדרים, רחוב …", "2 שותפים (27, 30)", "לנשים בלבד", and a teal "שותפים בגילך"
             for a seeker within 5 years of every flatmate. The room page adds "על החדר" and "אורח החיים בדירה".
             Apply: one neutral misfit line when the room cannot take the seeker, or a link to the profile's room
             section for a gendered room; both 409s swap the controls with no reload. The `lifestyle` match reason
             is worded. Room privacy (b): visitors and owners see "2 שותפים" and no lifestyle block, no empty headings.
    Demo: make dev -> an owner posts a women room (2 flatmates, 27 and 30, two answers) -> logged out, /search
          shows "2 שותפים" and "לנשים בלבד"; uncheck "דירה שלמה" -> rooms only -> as a seeker with no room
          section, open it: the ages, "אורח החיים בדירה", and "השלמת הפרטים בפרופיל" instead of the apply button.
    Tests: +17 web test blocks (AC1-AC11, incl. 4 parametrized lifestyle-copy rows), +0 new e2e (AC12/AC13 extend
           search.spec and applications.spec ac9; no new signup)   (api 432, web 254)
    CI: api + web on the single push (result on the PR); e2e local while CI e2e is off: 10 of 10, 30.0 s on 8de93b8
    Findings: 0 blockers, 0 majors (code, qa, ux; qa and ux static while 5173 was held). 6 minors: 3 fixed (one
              topic helper, listing cache reset on profile save, gate copy names the section), 3 to FOLLOWUPS
              (type-filter back/forward test, focus after a 409 swap, 0007d's "שעות לילה"/"חברתיות" topic copy); 11 nits dropped
    Decisions I need from you: none. (Spec updated the same day for your room-privacy option (b).)
    Changed in PRODUCT.md: nothing
    Next: 0007e merges second, so it drops RoomPreview's flatmates / "who" chips (the card shows them now). Room
          titles on the inbox, applications and chat screens are a FOLLOWUPS line (chat needs `listing_type` first).
