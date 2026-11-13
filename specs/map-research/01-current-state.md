# 01 · The map today

Read from `main` at `3466027` and measured on the running main stack (demo seed, 38 live listings) on 2026-11-13.

## How it is built

| Piece | Where | What it does |
| --- | --- | --- |
| Map component | `web/src/components/map/MapCanvas.tsx` | The only module that loads `maplibre-gl` (6.16.0), through `import()`, so the library is a separate chunk the list view never fetches. |
| Map settings | `web/src/components/map/config.ts` | Style URL, Gush Dan box, zoom limits, the 50-pin limit, `roundBbox`, the control labels. |
| Map style | `web/public/map/osm-raster.json` | Public OpenStreetMap raster tiles. One raster source, one layer. No `glyphs`, no sprite. Swapped by `VITE_MAP_STYLE_URL`. |
| Search map view | `web/src/features/search/SearchMap.tsx` | `/search?view=map`: count line, 60vh map, selected listing's card under the map. |
| Map query | `web/src/features/search/useMapSearch.ts` | `GET /listings` with the filters, the visible box and `limit=50`; old pins stay while the next box loads. |
| Listing page map | `web/src/features/listings/ListingPage.tsx:155` | A static map (not interactive), zoom 14, with a 56 px accent circle in the middle. |
| Location data | `api/app/services/geocoding.py` (spec 0003c) | The worker geocodes city + street name with Nominatim and stores an approximate point. |

## Behaviour

- **Opening view.** The map always opens fitted to the whole Gush Dan box (`GUSH_DAN_BOUNDS`), whatever the results are.
- **Search on move.** Every pan or zoom re-runs the search for the visible box. The box is rounded to 4 decimals so small moves share a cache entry.
- **Pins.** Each pin is a real `<button>` inside a MapLibre `Marker`: a 44 px hit area around a chip about 74 × 35 px. The chip shows the price, or price and match score ("7,200 ₪ · 87%") for a seeker with a profile. The selected chip is filled with the accent colour.
- **Card.** Pressing a pin renders that listing's `ListingCard` below the map and moves keyboard focus to its link.
- **Limit.** The API returns at most 50 listings per request (`SEARCH_LIMIT_MAX = 50` in `api/app/schemas/search.py`). Past that the count line says "מוצגות 50 מתוך N". Which 50 depends on the sort.
- **State.** Only `view=map` is in the URL. The visible box and the selected pin are component state in `SearchMap`, so they are lost when the component unmounts (opening a listing and pressing Back, or switching to the list and back).
- **Failure.** If the library, WebGL or the style fails, the map is replaced by a message and a "list" button.

## Measurements on the running app

Demo data: 38 live listings (28 apartments, 10 rooms). The dev stack uses the fake geocoder, which places points by hash in the middle half of the Gush Dan box, not on real streets. Real data will sit on real streets, so listings on one street will be closer together than here.

| Check | Desktop 1440 × 900 | Phone 375 × 812 |
| --- | --- | --- |
| Map size | 1032 × 540 px | 343 × 487 px |
| Where the map starts | below the title and toolbar | 309 px down (38% of the screen is above it) |
| Chips touching another chip on first open | 38 of 38 | not measured |
| Chips at least half covered by another on first open | 23 of 38 | 26 of 38 |
| Page scroll caused by pressing a pin | 342 px | 374 px |
| Card height | 411 px | 345 px |

Screenshots: `screenshots/desktop-1440-first-open.jpg`, `screenshots/desktop-1440-pin-pressed.jpg`, `screenshots/phone-375-pin-pressed.jpg`.

What these show:

1. **Most pins are unreadable on first open.** With only 38 listings, more than half the chips are hidden under others. The pins use about a fifth of the map's width; the rest is sea and empty land, because the view is fitted to the area box and not to the results.
2. **Pressing a pin makes the page jump.** The card is under the map, so focus moving to it scrolls the page and pushes the map partly off screen. On a phone the pin the person just pressed can leave the screen.
3. **The card is mostly an empty box.** Listings have no photos yet, so about 60% of the card is the grey photo placeholder.
4. **The payload is heavy for pins.** One listing in the map response is about 990 bytes of JSON (measured), about 50 KB per map move at the limit. A pin needs six fields.

## From the code, not measured

- **Which pin is on top is the wrong way round.** Markers are added in the API's order and later ones paint over earlier ones. With the default "match" sort, the lowest score of the set is drawn on top of the best ones (`MapCanvas.tsx`, markers effect; only the selected marker gets a `z-index`).
- **Back resets the map.** `SearchMap` builds the map from `GUSH_DAN_BOUNDS` on every mount and keeps the box in `useState`.
- **Visitors and owners never see match on pins.** `match` is `null` unless the caller is a seeker with a profile.

## Constraints any change must respect

### Privacy (spec 0003c, decided)
- The stored and returned point is never the real location: Nominatim's point for the *street* (no house number) plus a fixed per-listing offset of 0.0001° to 0.0020° on each axis (about 10 to 220 m north-south, 10 to 190 m east-west).
- Two listings on one street get different points on purpose, so pins never stack exactly. There is no "same building" in the public data, and showing one would leak what the offset hides.
- A listing whose street is not found has `lat` / `lng` `null`: it is in the list and never on the map.
- A room that does not fit the seeker's gender or flatmate preference is hidden from that seeker everywhere, the map included.

### Brand (`design/brand/README.md`, `web/tailwind.config.ts`)
- One theme, Light. Dark mode is not designed.
- "One accent-filled element per screen is usually enough." `MatchBadge` already follows it: a high score is accent-soft, the others neutral.
- Outline icons only (1.5 to 2 px stroke), no filled icons, no emoji.
- No shadows on cards; `shadow-pin` exists for pins only.
- Logical CSS properties only (`start` / `end`), and every user-facing string through `web/src/locales/he.json`.

### Accessibility (specs 0009c, 0009t, decided)
- Pins are buttons with `aria-pressed` and a full spoken name (title, price, match).
- The map wrapper is the one labelled region; the count line above it is the single live region.
- Overlapping pins are exempt from the 24 px target-size rule as "essential" (Gilad, 2026-11-12); only `.maplibregl-marker` is excluded from the axe check. Clustering was logged as the way out of that exemption (`specs/FOLLOWUPS.md`, the 0009t line).

### Cost and policy (PRODUCT.md "Search", spec 0003d question 2)
- Public OSM tiles are allowed only "while traffic is tiny"; the plan is self-hosted Protomaps on R2 before launch.
- Nominatim is called only by the worker, at most once per 1.1 s, with a cache.

### Tests
- Unit tests cannot run a real map (jsdom has no WebGL): they replace `MapCanvas` with `components/map/__tests__/fakeMapCanvas.tsx`. Logic placed inside `MapCanvas` is only covered by e2e.
- e2e runs in CI only, with software WebGL. The map e2e already flakes under load at its tile-attribution check (`FOLLOWUPS.md`, 0007e line).

## Open follow-ups that touch the map (`specs/FOLLOWUPS.md`)

| From | What |
| --- | --- |
| 0009t | Cluster pins whose chips overlap into one "N מודעות" bubble that zooms in when pressed. |
| 0009i (two lines) | Desktop map view: pair the map with a list column of its own listings, as `SearchDesktop.dc.html` draws it. |
| 0008c | Heart (like) on room cards in `/search` and on the map pins. |
| 0006f | In map view the sort select ignores the map query's real sort; no tests for the map-view sort select or the profile nudge. |
| 0007e | The map e2e's 5 s attribution check fails under machine load. |
| 0003c | With real Nominatim a sweep locates about 30 listings a minute. |
