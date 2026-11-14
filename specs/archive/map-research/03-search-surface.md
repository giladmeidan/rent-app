# 03 · Bundle 2: the map as part of search

Scope agreed with Gilad on 2026-11-13: the full map view stays a feature of its own, as it is now (the list / map toggle). New: a smaller map beside the list on desktop. Everything else from the brainstorm is in: the card, remembered position, locate me, place search, the empty view, the listing page map.

## Summary

| Idea | Verdict | Needs an API change |
| --- | --- | --- |
| Card over the map instead of under it | Do it first: it removes the page jump | No |
| Remembered position | Do it | No |
| Side map beside the list (desktop) | Do it, as a mirror of the list | No |
| Locate me | Do it | No |
| Empty-view action | Do it, cheap version | No |
| Listing page map | Honest circle and a link to the search map | No |
| Place search | Static list of places first | No |
| Swipeable cards on phone | After the card move, if wanted | No |
| Draggable bottom sheet | Skip: a docked card gives most of it | n/a |

## 1. The card: over the map, not under it

Finding: pressing a pin scrolls the page by 342 px on desktop and 374 px on a phone, because the card is rendered below a 60vh map and takes focus. The map, and sometimes the pressed pin, leaves the screen.

Proposal: dock the card inside the map's box.

- **Phone:** along the bottom edge, full width minus the gutter.
- **Desktop:** in the bottom corner at the inline start, about 360 px wide.
- **Compact layout.** `ListingCard` already has a `layout="row"` variant with the photo box at the side (176 px). Using it at every width in the map makes the card far shorter than today's 345 to 411 px, most of which is the empty photo placeholder.
- **Focus rule stays.** Spec 0009t moves focus to the card's link on a pin press; with the card inside the map there is nothing to scroll to.
- **Keep the pin visible.** When the card would cover the selected pin, pan the map by the card's height (`easeTo` with padding).
- **A close button**, and Escape, to deselect.
- **`MapCanvas` change:** its `overlay` slot is documented as pointer-events-none (it holds the "updating" pill). The card needs its own slot that accepts presses.

### Swipeable cards on a phone (optional next step)

A row of cards with CSS scroll snapping, where swiping to a card selects its pin. It needs no library and works in RTL with logical properties. To learn which card is in view, use `IntersectionObserver`; the newer `scrollsnapchange` event is not available in Safari (from memory, check when speccing).

A true draggable bottom sheet (drag handle, several heights, scroll locking, focus handling) is a lot of gesture and accessibility work for little more than the docked card gives. Skip it.

### More map on a phone

The map starts 309 px down a 812 px screen. Ways to give it room, cheapest first: let the map take the remaining viewport height instead of a fixed 60vh; hide the sort select in map view (see `02-pins.md`, "Sort on the map"); put the title, filters button and toggle on one row.

## 2. Remembered position

Finding: the visible box and the selected pin are component state, so Back from a listing reopens the map on all of Gush Dan with nothing selected. Spec 0003d left "the bbox in the URL" out on purpose; this revisits it.

| | A. In the URL | B. In `sessionStorage` | C. MapLibre's `hash` option |
| --- | --- | --- | --- |
| Back restores the view | Yes | Yes | Untested with the router |
| Reload restores it | Yes | Yes | Yes |
| A link can point at an area | Yes | No | Yes |
| Work | Medium | Small (about ten lines) | Small, but risky |
| Catch | Two fixes in `SearchPage`, below | Not shareable | It rewrites the URL fragment behind React Router's back, so the router's next navigation may drop it |

Recommendation: A. Besides Back, it gives three things the other bundles need: the side map's "open the full map here" button, the listing page's "show on the search map" link, and later a link in a "new listings in this area" email. If none of those matter yet, B is the cheap answer. This is decision 4 in the README.

Details for A:

- **Shape.** `c=32.0712,34.8123&z=13.5` and `pin=<listing id>`, written with `replace` on every move so the history does not fill up with pans.
- **Parse and clamp** like `roundBbox` does: a hand-edited URL must not produce a 422 or fly the map to another continent.
- **Fix 1: the filters form remounts on any URL change.** `SearchPage.tsx` gives `FiltersForm` the key `searchParams.toString()`. A map move would then reset a half-edited filter form. The key must be built from the filters only.
- **Fix 2: keep map params out of the query keys**, as `view` already is.
- **First open with no position:** fit to the first response's pins once, instead of the fixed Gush Dan box.

## 3. A smaller map beside the list (desktop)

### Does it fit

The search page is at most 1336 px wide: a 288 px filters panel and a results column whose cards need at least 440 px each (`ResultsList.tsx`). `SearchDesktop.dc.html` already draws three columns: filters, a 440 px list, a map.

Computed from the layout classes, with page padding and column gaps estimated at about 64 px in total; measure when speccing.

| Viewport | Left for the map after filters (288) and one 440 px list column | Verdict |
| --- | --- | --- |
| 1024 px (`lg`) | about 230 px | Too small: no side map, toggle only |
| 1280 px (`xl`) | about 490 px | Works |
| 1440 px and wider | about 540 px (page capped at 1336) | Comfortable |

So the side map appears from `xl` up, the list drops to one column there, and the map column is sticky under the header at the height of the viewport.

### What it shows: mirror or driver

| | Mirror (recommended) | Driver |
| --- | --- | --- |
| Pins | The listings loaded in the list (20 per page; "load more" adds pins) | Its own query for the visible box |
| Panning | Looks around; the list does not change | Filters the list to the box |
| New requests | None | The list query gains a box; paging and sort interact with it |
| Fits "the full map stays a feature of its own" | Yes: the side map is a companion, the map view is where you search by area | It turns list view into a second map view |

Recommendation: mirror, with a button on the side map that opens the full map view at the same position (needs "Remembered position", option A). This is decision 3 in the README.

Behaviour to spec for the mirror:

- **Hover and focus sync.** Hovering or focusing a card highlights its pin; pressing a pin scrolls its card into view and highlights it.
- **Fitting.** Fit to the loaded pins on first load and when the filters change. Do not refit on "load more", or the map jumps while the person is reading.
- **Listings without a point** have a card and no pin. That is already true of the data.
- **Same pin rules as the full map:** tiers, states and clusters from `02-pins.md` apply unchanged.

### Costs to know before speccing

- **The library now loads on every desktop search.** Spec 0003d's performance rule is that the list view never fetches the roughly 1 MB map chunk. The side map breaks that on wide screens. Soften it by loading the map after the list has rendered (on idle), and never below `xl`.
- **Tile traffic goes up.** Every desktop search would request OSM tiles, not only the people who press "מפה". PRODUCT.md allows public OSM tiles "while traffic is tiny" and plans Protomaps before launch. The side map makes that switch more urgent. This is decision 5 in the README.
- **Keyboard and screen readers.** The side map's pins duplicate the cards next to them. Making every pin a tab stop would double the stops on the page. Options: pins out of the tab order with the cards as the accessible path, or the whole side map hidden from assistive tech like the listing page's static map. A call for the UX reviewer (decision 7 in the README).
- **`MapCanvas` needs two additions:** a highlighted-pin prop, and a way to move the camera after mount (today it reads its view once, at creation).

## 4. Locate me

- MapLibre 6.16.0 includes `GeolocateControl` (options checked in the installed types: `positionOptions`, `fitBoundsOptions`, `trackUserLocation`, `showAccuracyCircle`, `showUserLocation`).
- It adds two label keys to `mapLocale` and `he.json`: `GeolocateControl.FindMyLocation` and `GeolocateControl.LocationNotAvailable`.
- The browser asks for permission only when the button is pressed. Geolocation needs HTTPS (localhost counts).
- **Outside the launch area.** The map has a minimum zoom but no bounds, so a person in Haifa would be flown to an empty map. Check the position against the Gush Dan box and show a short message instead of moving.
- **Privacy.** The position stays in the browser. What reaches the API is the visible box, exactly as when panning by hand.

## 5. Place search

Finding: there is nothing to build on yet.

- The API has one area ("גוש דן"). There are no cities or neighbourhoods in the database.
- Nominatim is used only by the worker at one request per 1.1 seconds. Its public usage policy does not allow search-as-you-type from an app (from memory of the policy; confirm before relying on it), so it cannot power a search box.

| | Static places list | Our own geocoding endpoint |
| --- | --- | --- |
| How | A JSON file of Gush Dan cities and main neighbourhoods with a centre and zoom each; a filter box over it | A new API endpoint that proxies a geocoder |
| Finds streets | No | Yes |
| Cost | A one-time list of roughly 60 to 100 places, built from OpenStreetMap | A paid or self-hosted geocoder, rate limits, abuse protection |

Recommendation: the static list. It answers "take me to Florentin", which is what people type. The same list is the first step toward bundle 3's neighbourhood layer.

## 6. The empty view

Today: "אין מודעות באזור הזה. אפשר להזיז את המפה או לשנות את המסננים." with no action.

- **Cheap version:** a button that returns to the whole launch area. No request.
- **Better:** say how many listings exist elsewhere ("יש 38 מודעות מחוץ לאזור הזה") from one extra request without the box, reading only its `total`.
- **Best:** fit to where the results are. That needs the results' extent, which the API does not return; a `bounds` field on the search response would be a small addition.

## 7. The listing page map

- **The circle is smaller than the uncertainty.** At zoom 14 near Tel Aviv one pixel is about 4 m, so the 56 px circle has a radius of about 113 m. The stored point is offset by up to about 220 m on each axis (about 290 m diagonally), and it starts from the middle of the street, not the building. The real home can be well outside the circle. An honest circle is a real distance on the ground of about 300 m. (In the brainstorm I suggested 150 m; that was too small.) Whether to enlarge it is decision 6 in the README.
- **A circle in metres** scales with zoom, which matters once the map can be zoomed. Today it is a fixed-pixel overlay on a map that cannot zoom.
- **Make it useful.** A link "הצגה במפת החיפוש" that opens the search map centred here (needs "Remembered position", option A) is the cheapest valuable step. An expand-to-interactive map and "other listings nearby" (a box query with the existing API) are larger.
- **Technical note:** `MapCanvas` reads `interactive` only when it is created, so switching a map from static to interactive means remounting it.

## 8. Things in the artboard that stay out

- **The "חיפוש בעת הזזת המפה" checkbox.** The map always searches on move, and 0003d already decided a "search this area" button is polish to add only if testers dislike it.
- **"שמור חיפוש".** Saving a search and alerts need notifications first.
