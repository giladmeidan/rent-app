# Map improvements: findings

Research for improving the search map and the listing page map. These are findings, not specs: what exists, what was measured, what each idea costs, and what needs a decision. Specs get written from here later.

Written 2026-11-13 from `main` at `3466027` and the running main stack (demo seed, 38 listings). Nothing in the app was changed.

## What Gilad decided on 2026-11-13

1. **Bundle 1, pins that say more:** go.
2. **Bundle 2, the map as part of search:** go, with one change. The full map view stays a feature of its own, as it is now. A smaller map is added beside the list on desktop.
3. **Bundle 3, a map that looks like ours** (vector style, neighbourhoods, transit, commute): not now, after 1 and 2.

## The files

| File | What is in it |
| --- | --- |
| [01-current-state.md](01-current-state.md) | How the map works today, measurements from the running app, and the privacy, brand, accessibility and cost rules any change must respect. |
| [02-pins.md](02-pins.md) | Bundle 1: match tiers, seen / liked / applied states, clustering, the 50-listing limit. |
| [03-search-surface.md](03-search-surface.md) | Bundle 2: the card, remembered position, the side map, locate me, place search, the empty view, the listing page map. |
| [04-technical-notes.md](04-technical-notes.md) | What the installed MapLibre offers, where logic must live to be testable, the changes `MapCanvas` needs, API changes per idea. |
| `screenshots/` | The map on first open and after a pin press, desktop and phone. |

## The five findings that matter most

1. **Most pins cannot be read on first open.** With only 38 listings, 23 chips on desktop and 26 on a phone are at least half hidden under other chips. Real geocoding will pack them tighter.
2. **The best matches are drawn underneath.** Markers paint in the API's order, so with the match sort the lowest score sits on top. One line fixes it.
3. **Pressing a pin makes the page jump** by about 350 px, because the card is under the map and takes focus. The pressed pin can leave the screen.
4. **Back resets the map.** The position and the selected pin live in component state.
5. **Almost none of this needs the API.** Tiers, states, clusters, the card, remembered position, the side map and locate me are all web-only. The exceptions are showing more than 50 listings and street-level place search.

## What I recommend, in order

| Step | What | Why here |
| --- | --- | --- |
| 1 | Best match on top, match tiers, liked and applied marks, seen (per device) | Small, web-only, and it shows the thing only this app has: personal fit on the map. |
| 2 | Clusters as a pure function, and fit the first view to the results | Fixes the unreadable first view and closes the 0009t follow-up and its axe exemption. |
| 3 | Card over the map, position in the URL | Removes the page jump and the Back reset. The URL position is also what steps 4 and 5 hang on. |
| 4 | Side map beside the list from 1280 px, mirroring the list, with hover sync | The desktop layout the artboard already draws; closes the two 0009i follow-ups. |
| 5 | Locate me, empty-view action, listing page circle and link, static place search | Independent small pieces; any order. |
| Later | Slim pins response and a higher cap; then bundle 3 | Only when real density shows the 50 limit biting. |

Following the "fewer specs per slice" rule, steps 1 and 2 could be one web spec, step 3 one, step 4 one, and step 5 one or two.

## Decided by Gilad on 2026-11-13

Gilad accepted the recommendation on each of these. They are in `specs/PRODUCT.md`, row "Map", and the specs are `0009v`–`0009y`.

1. **Score on the chip:** the score is shown only on high matches (80 and above). Other chips show the price alone; the tier colour, the spoken name and the card carry the score.
2. **Seen:** per device, kept in the browser and cleared on logout. Per account is not planned.
3. **Side map:** a mirror of the list. Its pins are the listings loaded in the list, panning does not change the list, and a button opens the full map view at the same place.
4. **Remembered position:** in the URL.
5. **Tiles:** the side map ships on the public OSM tiles and stays on them until launch. The Protomaps switch keeps its place before going public (PRODUCT.md "Search"); it is not moved ahead of the side map. The side map multiplies tile requests, so this holds only while the traffic is testers.
6. **The listing page circle:** enlarged to an honest radius of about 300 m on the ground.
7. **Keyboard on the side map:** the cards are the accessible path; the side map's pins are not tab stops.

## Ideas dropped, and why

| Idea | Why |
| --- | --- |
| "3 rooms in this building" pin | The public point is deliberately offset per listing and has no building. Overlap is handled by clusters. |
| Dots at low zoom | Clusters cover it at this scale; dots drawn by the map cannot take keyboard focus. |
| Draggable bottom sheet | A docked card gives most of the benefit for a fraction of the work. |
| Photo preview on hover | Listings have no photos yet. |
| MapLibre's built-in URL hash | It changes the URL behind React Router's back. |
| "Search as I move" checkbox | The map always searches on move; already decided in 0003d. |

## Bundle 3, parked

Kept here so it is not lost: self-hosted Protomaps vector style in the brand's palette, neighbourhood outlines with typical prices, light rail and train stations, commute distance to a chosen place, restyled controls and motion. Two things from this research feed it: the static places list (step 5) is the start of the neighbourhood layer, and the vector style is what unlocks text in map layers and a muted base map.

## What this research did not cover

- **Real data.** The demo stack uses the fake geocoder, so pin positions are not on real streets. Overlap on real data is expected to be worse, but it was not measured.
- **Runtime behaviour of MapLibre 6.16.0.** The API surface was read from the installed types; no prototype was built.
- **Back from a listing** was read from the code, not clicked through.
- **Other products** are described from general knowledge, not checked today.
- **The Nominatim policy on search-as-you-type** is from memory and should be confirmed.
- **Widths for the side map** are computed from the layout classes, with page padding estimated.
