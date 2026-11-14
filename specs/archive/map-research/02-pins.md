# 02 · Bundle 1: pins that say more

Scope agreed with Gilad on 2026-11-13: match tiers, pin states, density (clusters and zoom), all on the existing search map.

## Summary

| Idea | Verdict | Needs an API change |
| --- | --- | --- |
| Best match drawn on top | Do it, it is one line | No |
| Match tiers on the chip | Do it | No |
| Liked and applied marks | Do it | No (two existing endpoints) |
| Seen state | Do it, per device first | No |
| Clusters for overlapping pins | Do it, as a pure function | No, for up to 50 listings |
| More than 50 listings on the map | Later, when real density needs it | Yes (a slim pins response) |
| Dots at low zoom | Skip: clusters cover it | n/a |
| "3 rooms in this building" pin | Drop: the data cannot support it | n/a |

## 1. Best match on top

Today the lowest score of the result set is painted over the best ones (see `01-current-state.md`). Setting each marker's `z-index` from its score fixes it: selected first, then by score, then newest. This is worth doing even if nothing else in this bundle ships.

## 2. Match tiers

The buckets already exist in `web/src/features/match/bucket.ts`: high is 80 and above, good is 60 to 79, partial is below 60 (a failed hard filter caps the score at 59).

Proposed chip per tier, using only existing tokens:

| Tier | Background | Border | Text | Notes |
| --- | --- | --- | --- | --- |
| High | `accent-soft` | `accent` | `accent-strong`, bold | Same idea as `MatchBadge`'s accent tone. |
| Good | `surface` | `border-strong` | `ink`, bold | Today's chip, unchanged. |
| Partial | `surface-subtle` | `border` | `ink-muted`, medium | Recedes without disappearing. |
| No match data (visitor, owner, no profile) | as Good | | | Nothing changes for them. |
| Selected | `accent` fill | `on-ink` | `on-ink` | Unchanged; stays the one accent-filled element. |

Findings:

- **Contrast holds.** Computed by hand from the token values: `accent-strong` on `accent-soft` is about 5.9:1 and `ink-muted` on `surface-subtle` about 5.5:1, both above the 4.5:1 needed for 13 px bold text. Re-check with a tool when speccing.
- **Colour is not the only signal.** The spoken name already carries the score (`search.map.pinMatch`), and the tiers differ in lightness and border as well as hue.
- **Chip width is the real cost of the score text.** "7,200 ₪ · 87%" is roughly half again as wide as "7,200 ₪" (estimated from the text length; only the 74 px price-only chip was measured), which means more overlap. Three options: keep price and score on every chip (as today); show the score only on High chips; or show price only and let the tier colour and the card carry the score. This is a product call (decision 1 in the README).

## 3. Pin states: seen, liked, applied

### Where the data comes from

| State | Source today | Extra requests on the map |
| --- | --- | --- |
| Liked | `useMyLikes()` → `mine[].listing.id` (`GET /me/likes`) | None: the header's `LikesNavLink` already loads it for seekers. Rooms only, since only rooms can be liked. |
| Applied | `useMyApplications()` → `listing.id` + `status` (`GET /me/applications`) | One, for seekers. Today it is loaded only on the listing and applications pages. |
| Seen | Nothing exists | None if kept in the browser. |

Search items carry no like or application state (`ListingPublic` in `api/app/schemas/search.py`), and they do not need to: both sets can be joined in the browser by listing id.

### Seen: two ways

| | Per device (`localStorage`) | Per account (server table) |
| --- | --- | --- |
| Work | A small store of listing ids, written when a listing page opens | Migration, a write on every listing view, a read on search |
| Follows the person across devices | No | Yes |
| Works for visitors | Yes | No |
| Privacy | Stays in the browser; must be cleared on logout, like the query caches in `useLogout.ts` | A record of what each person looked at, which needs a retention rule |
| Later uses | None | Could feed "N people viewed" for owners |

Recommendation: per device first. "Seen" means the listing page was opened, not that the pin was pressed. Cap the store (a few hundred ids, oldest dropped). The same store can grey list cards later at no extra cost.

### How the states look

Tier and state must not share a visual channel, or a seen High match and an unseen Partial match would look alike.

- **Tier** owns colour and border (section 2).
- **Seen** owns weight: the price in normal weight at reduced opacity.
- **Liked** and **applied** each add one small outline icon before the price (a heart, a check), in the chip's own text colour. The brand allows outline icons only.
- When several apply, show one icon: applied wins over liked. Seen can combine with either.
- Each state adds a word to the pin's spoken name, so three new `he.json` keys.

This covers the display half of the 0008c follow-up (heart on pins). Liking from the map itself stays out, as 0008c decided.

## 4. Density: clusters

### What the problem really is

Pins never share a point (the privacy offset is never zero), so there is no stacking case to solve separately. The problem is ordinary overlap, and it is severe already: 23 of 38 chips are at least half hidden on first open. Real geocoding will make it worse, since listings on one street land within about 200 m of each other.

### Three ways to cluster

| | A. Pure function in the browser | B. MapLibre's built-in clustering | C. Server-side aggregation |
| --- | --- | --- | --- |
| How | Convert each pin to pixels at the current zoom (plain Web Mercator maths, no map needed), group pins whose chips would overlap, return pins and groups | A GeoJSON source with `cluster: true`; clusters read back and drawn as DOM markers, or drawn as map layers | The API returns grid cells with a count |
| New dependency | None | None (in 6.16.0 already) | None |
| Unit-testable | Yes, in vitest | No: it runs in the map's worker, so e2e only | Yes, in pytest |
| Keeps pins as buttons | Yes | Only with DOM markers; map-layer labels also need a `glyphs` font endpoint the current style does not have | Yes |
| Good up to | Hundreds of pins | Tens of thousands | Any size |
| Work | Small | Medium | Large |

Recommendation: A. It is the smallest, it is what the 0009t follow-up describes, and it is the only one the unit tests can cover given that they replace `MapCanvas` with a fake. B becomes interesting only if the map ever holds thousands of points.

### Behaviour to spec

- **Bubble content.** The count ("12"). Optionally the lowest price ("מ־3,400 ₪"). If a cluster holds a High match it takes the High tier's colours, so good matches are visible before zooming.
- **Pressing a bubble** zooms to fit its members (`fitBounds` with padding). MapLibre skips the animation for people who prefer reduced motion unless `essential: true` is passed, so no extra work there.
- **Members that never separate.** Two points can be about 10 m apart, which will not separate even at the maximum zoom of 19. A bubble at maximum zoom should open its listings as a short list in the card area.
- **The selected listing** is always drawn as its own chip, never folded into a bubble.
- **Regrouping** runs when the zoom or the data changes, not on every pan frame.
- **Spoken name** for a bubble: "12 מודעות, הגדלה" style, with plural forms (`_one`, `_two`, `_other`) as the count line uses.
- **Target size.** With clusters, pins no longer overlap, so the axe exemption for `.maplibregl-marker` can be removed. That closes the 0009t follow-up.

### The 50-listing limit

Clusters make a promise the limit can break: a bubble saying "12" must hold all 12. When the box holds more than 50 listings, the counts would be wrong.

- **Now:** keep the "מוצגות 50 מתוך N" line and cluster what arrives. At launch scale (tens to low hundreds of listings across Gush Dan, and fewer in any zoomed box) this is mostly correct.
- **Later, when real density is known:** a slim response for the map, for example `GET /listings/pins` returning `id`, `lat`, `lng`, `price_ils`, `listing_type` and `score` for up to about 1,000 listings. A slim item is roughly 90 bytes against 990 today (estimate from the field list), and the card's details load on selection through the existing `GET /listings/{id}`. This is an API shape later slices would depend on, so it is Gilad's call when it comes up (Speed rule 9).
- **Sort on the map.** Today the sort decides which 50 appear. Once every listing in the box is shown, the sort means nothing on the map and the select should hide in map view. That also closes the 0006f follow-up about the map-view sort select.

### Dots at low zoom

Considered and skipped. A dot layer helps when thousands of points must be visible at once; with clustering and a few hundred listings it adds a third pin shape and a keyboard problem (dots drawn by the map are not focusable) for no gain. Revisit together with the slim response.

## 5. Related small wins found on the way

- **Fit the first view to the results.** Opening on the whole Gush Dan box wastes most of the map. Fitting once to the first response's pins (when no position was restored) spreads them out. See `03-search-surface.md`, "Remembered position".
- **Room or apartment on the chip.** Search mixes both. Prices usually tell them apart, so this is optional: a small outline glyph for rooms, if testers confuse them.

## What other products do

From general knowledge of these products, not checked today:

- **Airbnb:** price chips; the selected chip inverts; visited chips turn grey; saved ones show a heart; low-priority results shrink to small dots.
- **Zillow:** dots that change colour once viewed, and count clusters at low zoom.
- **Yad2 and Madlan (Israel):** count clusters at city zoom; Madlan also shows neighbourhood outlines with typical prices.

None of them has a match score. Colouring pins by personal fit is the part that is ours.
