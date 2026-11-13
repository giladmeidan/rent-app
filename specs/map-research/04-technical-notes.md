# 04 · Technical notes for the spec writer

## What the installed MapLibre can do

`maplibre-gl` 6.16.0, checked in `web/node_modules/maplibre-gl/dist/maplibre-gl.d.ts` on 2026-11-13. This version is newer than my training data, so everything here was read from the installed types, and anything about runtime behaviour should be confirmed against the MapLibre examples when speccing.

| Need | Present in 6.16.0 | Note |
| --- | --- | --- |
| Clustering | `cluster`, `clusterRadius`, `clusterMaxZoom`, `clusterMinPoints`, `clusterProperties` on GeoJSON sources; `getClusterExpansionZoom`, `getClusterLeaves`, `getClusterChildren` | Runs in the worker. Not needed for the recommended pure-function approach. |
| Locate me | `GeolocateControl` | Two locale keys to translate. |
| Camera moves | `fitBounds`, `cameraForBounds`, `flyTo`, `easeTo`, `setPadding` | Animations are skipped under `prefers-reduced-motion` unless `essential: true`. |
| Per-feature state | `setFeatureState` | Only for features drawn by map layers, not DOM markers. |
| URL sync | `hash: boolean \| string` map option | Not recommended here, see `03-search-surface.md`. |
| Marker options | `opacityWhenCovered`, `subpixelPositioning` | |
| Right-to-left labels | `setRTLTextPlugin` | Needed only with vector tiles (bundle 3). |
| Other controls | `ScaleControl`, `FullscreenControl`, `Popup` | |

## Two limits of the current style

1. **No text in map layers.** `osm-raster.json` has no `glyphs` URL, so a map layer cannot draw text (a cluster count, a price). Text must stay in DOM markers until the style gains a font endpoint, which comes with Protomaps.
2. **No restyling.** Raster tiles are finished pictures. Muting the base map so pins stand out, dark mode, or hiding labels are not possible until vector tiles.

## DOM markers or map layers

Pins are DOM markers today. Findings for keeping them:

- They are real buttons, which is what the accessibility decisions rest on (spoken names, `aria-pressed`, focus rings).
- They are styled with the Tailwind tokens, so tiers and states are class changes.
- MapLibre repositions every marker on each frame. That is fine for tens to a few hundred elements and not for thousands (general knowledge of the library, not measured here). Clustering keeps the drawn count small, so this limit is not reached.

Map layers (circles drawn by WebGL) scale to tens of thousands of points, but they are not focusable, cannot show text with the current style, and cannot be unit-tested. They become relevant only with the slim pins response and a much larger dataset.

## Where the logic should live

Unit tests replace `MapCanvas` with `components/map/__tests__/fakeMapCanvas.tsx`, because jsdom has no WebGL. So:

- Put clustering, tier choice, state joins and URL position parsing in plain functions outside `MapCanvas` (for example next to `config.ts`, which already holds `roundBbox` and its tests). They can then be tested in vitest.
- Keep `MapCanvas` a thin renderer: it receives finished pins and bubbles and draws them.
- The fake canvas must learn any new prop (highlighted pin, cluster bubbles, the card slot) or the existing tests stop reflecting the real component.

Clustering as a pure function needs no map instance: a point's pixel position at zoom `z` is its Web Mercator coordinate times `512 × 2^z` (MapLibre's zoom levels use 512 px tiles). Group points whose chip rectangles (about 74 × 35 px, wider with a score) would intersect.

## Changes `MapCanvas` would need

| For | Change |
| --- | --- |
| Best match on top | `z-index` per marker from a priority on `Pin` |
| Tiers and states | A `tier` and `state` on `Pin`, or ready-made class names, instead of the two fixed chip styles |
| Clusters | A second marker kind (bubble) with its own press handler |
| Card over the map | A slot that accepts presses (the current `overlay` is pointer-events-none by contract) |
| Side map, remembered position | A way to move the camera after mount: today the view is read once from a ref at creation |
| Side map | A highlighted-pin prop, separate from `selectedId` |
| Locate me | An opt-in control and two more keys in `mapLocale` |

## API changes, by idea

| Idea | API change |
| --- | --- |
| Tiers, best match on top, clusters up to 50 | None |
| Liked and applied marks | None (`GET /me/likes`, `GET /me/applications`) |
| Seen, per device | None |
| Seen, per account | New table, migration, write on view, read on search |
| Card over the map, remembered position, side map (mirror), locate me, static place search | None |
| "N listings outside this area" | None (one extra request, `total` only) |
| Fit to where the results are | A `bounds` field on `ListingSearchOut` |
| More than 50 listings on the map | A slim pins response and a higher cap |
| Place search that finds streets | A geocoding endpoint and a geocoder that allows it |

Existing performance numbers to carry into any spec that raises the cap (`specs/FOLLOWUPS.md`, 0007g line): at 50,000 listings the map query takes 113 to 119 ms serial, and the match sort 262 to 277 ms.

## Smaller things to remember

- **The filters form key.** `SearchPage.tsx` keys `FiltersForm` on the whole query string. Any new URL parameter that changes while the page is open (map position, selected pin) must be excluded from that key.
- **Query keys.** `['search-map', filters, bbox]` and `['search', filters]` are reset on logout and on profile save (`useLogout.ts`, `useSaveProfile.ts`). A per-device "seen" store needs the same logout handling.
- **Right-to-left.** Control corners are MapLibre option strings computed from `i18n.dir()`. Anything positioned over the map in our own markup uses logical properties.
- **Copy.** Every new string goes through `he.json`; counts use i18next plural forms.
- **e2e.** Runs in CI only. Avoid new assertions that wait on third-party tiles: the existing attribution check already flakes under load.
- **Tile traffic.** Anything that shows a map to more people (the side map) raises requests to the public OSM tile server.
