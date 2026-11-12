---
id: 0009i
title: Search fills the screen in the homie look — on a phone the Search.dc.html stack (title, active-filter chips, list/map toggle, stacked cards), on a desktop a filter side panel always open beside a grid of row cards — with behaviour unchanged
status: in-progress
depends_on: [0009d, 0009h]   # 0009d: the brand tokens and the kit (PageContainer, PageHeader, Button, Card, Tag, Badge, Field + TextInput / Select, EmptyState pose, Mascot, useIsDesktop); 0009h: the full-width shell, the page roots and the colour swap of every file here (branch from its PR)
reviewers: [ux]   # quick route (Gilad 2026-11-12: a cosmetic, behaviour-unchanged spec gets one ux review; coder Sonnet/high). The spec session also greps its diff for raw-HTML rendering (dangerouslySetInnerHTML / innerHTML / linkify) and runs lint, test and e2e. Was: reviewers: [code, qa, ux]
estimate: 1 coder run   # coder Opus/medium: styling, ~9 coupled components (ListingCard is shared with 3 screens), four test files, one e2e file at two viewports (Speed rule 6, "when in doubt, the stronger one"). The desktop map pairing was split off to 0009n by the verifier
---

> **Brand kit amendment (orchestrator, 2026-11-12, no verifier re-run):** `design/brand/` (README.md, tokens.json) wins over the artboards and over any older wording below for colour, type (Fredoka for display/h1/h2, Rubik for the rest), radii, no card shadows, the name homie / הומי, the mascot and the voice (no slash forms: plural, infinitive or noun; action-noun buttons; errors say "what happened. what to do."). Token and kit names are those of 0009d. Where this spec still names a teal token, Heebo or a slash form, the builder applies the brand equivalent.

## Goal
After this ships, `/search` uses the whole screen, follows its artboards' layout, and wears the homie brand
(`design/brand/`, which overrides the artboards' colour, type, shape and voice, per `specs/0009-brand-amendment.md`).
- **On a phone** (below 1024 px, checked at 390 px) it follows `design/screens-v1/Search.dc.html`:
  - the page title with the filters button;
  - the active filters as chips;
  - a toolbar with the sort and the list/map toggle;
  - the count line;
  - full-width stacked cards with a 16:10 photo box and the price with its match badge on one row.
- **On a desktop** (1024 px and up, checked at 1440 px) it follows `SearchDesktop.dc.html`:
  - the filters are a panel that is always open at the inline start;
  - the results are a grid of the artboard's row cards, with the photo at the inline start.
- No results and a loading search show the brand's turtle (`Mascot pose="search"`).
- The map view keeps today's structure inside the results column. Pairing the map with a list of its own
  listings, as the desktop artboard draws it, is a later follow-up (FOLLOWUPS), accepted by Gilad 2026-11-12's Q1 there.

Behaviour, URLs, requests and existing copy are unchanged. This serves `specs/FOLLOWUPS.md` line 44 (desktop is a
single 640 px column) and line 43's radius half, and the Product Plan's screen 5 (Search). It is Slice 9b (Gilad,
2026-11-12: "the app does not look good, layouts do not fill the screen").

## Scope
**In** (paths under `web/src/`):
- `features/search/SearchPage.tsx`: the layout below ("UI").
  - It uses `PageContainer width="wide"` on every return path. 0009h sets `default`; this spec changes the
    page's row in 0009h's `web/src/app/__tests__/pageWidths.test.ts` table to `wide`.
  - It uses `PageHeader` (`title` = `search.title`; `actions` = the filters toggle, on the phone only).
  - The desktop layout is chosen with the kit's `useIsDesktop()` (0009d, `(min-width: 1024px)`, Tailwind `lg`).
    It is `false` when `window.matchMedia` is missing (jsdom), so every existing component test keeps the phone
    layout. No local hook is added.
  - The panel's open state stays component state, as today.
- `features/search/ActiveFilterTags.tsx` (new): the active filters as kit `Tag`s, read from `parseFilters`'s
  result. There is one tag per set filter group:
  - price and rooms are one tag each (from, to or both);
  - the date is one tag;
  - one listing type is one tag;
  - each feature is one tag.
  It renders nothing when no filter is set (`countActive === 0`). The tags are static, not buttons.
- `features/search/FiltersForm.tsx`: restyled with the kit (`Field`, `TextInput`, `Select`, `Button`).
  - Unchanged:
    - the behaviour and the validate-on-submit flow;
    - the control ids, passed as `Field`'s `id`, so `submit`'s focus-the-first-error keeps working;
    - `aria-invalid`, and the `role="alert"` errors (now `Field`'s `error`);
    - the four `fieldset` / `legend` groups (type, price, rooms, features). The tests and the e2e find them with
      `getByRole('group', { name })`.
  - Each price box is a `Field` whose `label` is "מ־" / "עד", with `labelHidden`, so `getByLabel(he.search.to)`
    still finds the input. Its `TextInput` has `start` = the same word (`aria-hidden`) and `end` = "₪". Today's
    box keeps its "₪" on both layouts; the desktop artboard has none, which is an accepted difference.
  - The form loses its own frame (`FiltersForm.tsx:264`, `rounded-2xl border … p-4`). The `Card` around it in
    `SearchPage` is the frame; there is no card inside a card.
  - It gains an `<h2>` `search.filters` with `className="sr-only lg:not-sr-only"`, and a `titleId` prop so
    `SearchPage` can make the panel `aria-labelledby` it.
- `features/search/ResultsList.tsx`:
  - it passes `layout="row"` at every width. The card stacks below `lg` by CSS, so the phone layout is a single
    column of stacked cards and the desktop layout is the grid of row cards; the list needs no hook;
  - **loading**: `Mascot pose="search"` (96 px, decorative, `aria-hidden`), above three card-shaped skeletons
    (`h-64 lg:h-40`). This is inside 0009c's `Loading` wrapper once that has merged;
  - **empty**: `EmptyState pose="search"` with `search.empty`, and the clear button as its `action` when filters
    are set;
  - the count line stays the always-mounted first element (`0009t` focuses it after Apply / Clear). It is
    `text-label` on the phone and `lg:text-h3` on the desktop (the artboard's larger desktop count).
- `features/search/SearchMap.tsx`: the structure is unchanged (count line, states, map, selected card below),
  inside the results column. The map keeps `h-[60vh] min-h-[360px]` at every width.
  - `0009t` owns its states and its loading pill: the empty text in the count line, `ErrorState` above the map,
    and `MapCanvas`'s `overlay`.
  - The desktop pairing is a later follow-up (FOLLOWUPS).
- `features/search/SortSelect.tsx`: the kit `Select`. Its own `<label>` stays inline beside it (`flex items-center
  gap-2`, as today), not a `Field`, which would stack the label above the control.
- Kit `Button`s keep today's states: a control that is `disabled` today ("עוד דירות" while fetching) stays
  `disabled` with `aria-busy`, not the kit's `busy`, because the tests pin `disabled`.
- `features/search/ViewToggle.tsx`: brand tokens only:
  - the track is `bg-surface-subtle`;
  - the pressed segment is `bg-surface text-ink` with a `border` and no shadow;
  - `p-[3px]` becomes `p-0.5`.
  It keeps its `role="group"`, its `aria-pressed` buttons and its double-click guard. It is not the kit `Tabs`,
  because the e2e and the semantics are `aria-pressed` toggles.
- `features/match/ProfileNudge.tsx`: `bg-accent-soft`, with ink text and an `accent-strong` link (brand: accent
  text on `accent-soft` is `accent-strong`).
- `features/listings/ListingCard.tsx` (shared with my listings, the wizard preview and `/me/likes`): the card
  anatomy below.
  - The root is `Card as="article" padding="none"`. It is `interactive` when `to` is set, and has the brand's
    `rounded-lg` and `border`, with no shadow.
  - It gains `layout?: 'stack' | 'row'`, default `'stack'` (today's vertical card). `'row'` is the
    SearchDesktop row card from `lg` up and the stacked card below `lg`, chosen with CSS only.
  - The row layout's 12 px padding and 16 px gap come from an inner wrapper (`lg:flex-row lg:gap-4 lg:p-3`), never
    from `Card`'s `className`.
  - It gains `data-layout` on the root, for tests.
  - The root stays an `<article>` with exactly one link, the title, because every e2e finds cards that way.
  - The facts `<p>` stays the title's next sibling (`ListingCard.test.tsx`'s `factsLine` reads
    `heading.nextElementSibling`).
  - 0009c's `titleAs` prop (default `h2`), if merged, is kept.
- `features/listings/facts.ts` (new, FOLLOWUPS 42):
  - `floorFact(listing, t)`, `sizeFact(listing, t)` and `entryFact(listing, today, t)`: the three strings that
    `ListingCard.tsx:104-113` and `ListingPage.tsx:58-66` both build today;
  - `ListingCard` and `ListingPage`'s facts line use them. `ListingPage` keeps appending `entryFlexible`; its
    other lines are 0009j's.
- `features/match/MatchBadge.tsx`: the kit's `Badge size="md"`.
  - The `high` bucket uses the accent tone: `bg-accent-soft text-accent-strong`. It is not accent-filled, since
    the brand allows one accent-filled element per screen and a results page shows many badges.
  - `good` / `partial` use the neutral tone: `bg-surface-subtle text-ink-muted`.
  - If 0009d's brand revision names those tones differently, use the tones with these classes.
  - `Badge` must forward `data-testid` / `data-bucket`. `match-badge` is asserted in `inbox.spec.ts:56`,
    `ApplicantsPage.test.tsx` and `PeoplePage.test.tsx`. If it does not forward HTML attributes, add a `...rest`
    pass-through with a `Badge.test.tsx` case (an additive prop).
- `features/match/MatchChips.tsx`: each chip is `Tag as="li" size="sm"`:
  - `tone="accent"` for the agree chip (`bg-accent-soft text-accent-strong`);
  - the kit's warning tone for the differ chip (brand `warning` text, with the words carrying the meaning).
- For `MatchBadge`, `MatchChips` and `Tag`: the text is the element's own direct child. The tests'
  `getByText(…).toHaveClass(…)` and `badge.parentElement` checks rely on it. The anatomy, `data-testid` and
  `data-bucket` stay the same. The inbox (`ApplicantCard`, 0009l) and people (0009p, which adds a
  `voice: 'person'` prop shape) use them as this spec leaves them.
- `locales/he.json`: the new keys in "UI", in the brand's voice. No existing key's wording changes (that is
  0009b's).
- Tests and e2e: see "Tests to write". The screenshots are AC10.

**Out:**
- Elements of the artboards with nothing behind them in the API or the product:
  - the location search field (`GET /listings` has no area or text filter);
  - "שמור חיפוש" (saved searches are not built);
  - the heart on cards (liking stays on the listing page and `/me/likes`, FOLLOWUPS line 186);
  - "חיפוש בעת הזזת המפה" (the map view always searches its box, and the list never does, per 0003d);
  - the "מרפסת" filter (no balcony field);
  - the third type "מחפשים שותף/ה לדירה קיימת" (people browse is a lister flow, not a listing type);
  - the "12 תמונות" counter (no photos before `0002c`).
- New interactions the artboards hint at:
  - one-tap quick-filter chips and removable active-filter chips;
  - a hover link between a card and its pin.
  These are follow-ups if Gilad wants them.
- The desktop map view's list column beside the map: a later follow-up (FOLLOWUPS).
- Owned by other specs:
  - the header and the bottom tab bar (`0009a` / `0009h`);
  - the map's pins, controls and attribution in `components/map/MapCanvas.tsx` (`0009h`'s class swaps and
    `0009t`'s landmark and overlay);
  - the map states (FOLLOWUPS 73–75, `0009t`);
  - focus after Apply / Clear (`0009t`).
- The date input's locale placeholder (FOLLOWUPS 47) and every wording change are 0009b's. The sort select
  flashing "newest" while the profile loads (FOLLOWUPS 125) is a behaviour fix, not styling.

**New dependencies:** none.

## Data
None (web only).

## API
None changed. It consumes `GET /listings` (list pages of 20, and the map's `west/south/east/north` with
`limit=50`) exactly as today.

## UI
- Sources: the brand kit `design/brand/` (`README.md`, `tokens.json`) and `specs/0009-brand-amendment.md` for
  colour, type, shape, voice and photos. `design/screens-v1/Search.dc.html` (phone) and `SearchDesktop.dc.html`
  (desktop) for layout and anatomy.
- The ux reviewer compares the screenshots (AC10) with both, using the gap tables below.
- "Today" means `8c3c480`.

### Brand tokens and the allowed arbitrary values
- **Colours.** These are the brand names only:
  - `surface` (page and cards), `surface-subtle` (photo placeholder, segmented track, quiet areas);
  - `ink`, `ink-muted`, `on-ink`;
  - `accent`, `accent-strong`, `accent-soft`;
  - `border` (card outlines), `border-strong` (inputs, controls, idle chips);
  - `warning` and `danger`.

  Other rules:
  - The teal set and the amber `warn` are gone.
  - Primary buttons are `ink` with `on-ink` (the kit's `primary`).
  - Accent text sits only on `surface`; on `accent-soft` it is `accent-strong`.
  - At most one accent-filled element per screen; this page has none.
  - Status colours come with words or an icon.
  - 0009h's `noColourLiterals.test.ts` keeps hex and `rgba(` out.
- **Type.**
  - `font-display` (Fredoka) is only for the `PageHeader` `<h1>` (the kit's `h1` style).
  - Everything else is Rubik through the brand `fontSize` keys:
    - the card price `text-h3 font-bold`;
    - the card title `text-body font-medium`;
    - facts `text-body-sm text-ink-muted`;
    - the count line `text-label` (`lg:text-h3`);
    - legends and labels `text-label`;
    - hints `text-caption`.
  - `tracking-[-0.3px]` (`ListingCard.tsx:146`) becomes `tracking-tight`.
- **Shape.**
  - `rounded-md` (12) for inputs, selects and buttons;
  - `rounded-lg` (16) for cards, the panel and the photo's top corners;
  - `rounded-full` for chips, tags, badges and the toggle;
  - no card shadows, with `border` between cards;
  - cards sit `gap-3` apart;
  - phone side padding is `PageContainer`'s `px-4`.

  Each `rounded-[14px]` / `rounded-[10px]` / `text-[13px]` / `text-[15px]` / `min-h-[44px]` / `px-[14px]`-style
  class becomes the nearest brand or kit step (FOLLOWUPS 43's radius half).
- **Arbitrary values.** These are allowed only where no token fits, each with a one-line comment:
  - `lg:grid-cols-[18rem_minmax(0,1fr)]`: the side panel, the artboard's 280 px;
  - `lg:grid-cols-[repeat(auto-fill,minmax(min(100%,27.5rem),1fr))]`: the results grid, each row card at least
    the artboard's 440 px list column;
  - `aspect-[16/10]`: the brand's photo crop, unless 0009d adds an aspect token;
  - the map's `h-[60vh] min-h-[360px]` (as today).

### Phone layout (below `lg`), against `Search.dc.html`
| Artboard element | Today | This spec |
| --- | --- | --- |
| White header band: back button, location field, 48 px filter icon button | `<h1>` text, then one row: filters button, view toggle, sort | `PageHeader`: the `<h1>` `search.title`, kept for a11y and the e2e. Its action is the filters toggle, a kit `Button`: `icon` (today's three-line icon, outline), `search.filters` / `search.filtersActive`, `variant="secondary"`, or `"tint"` (accent-soft) while filters are active, with `aria-expanded` / `aria-controls`. The visible text and the accessible name stay, so `search.spec.ts` still finds it by name. No back button (the shell's logo goes home); no location field (Out). |
| Chip row under the header: active chips are filled, the rest outlined, 40 px with a 1.5 px border | — | `ActiveFilterTags` at the start of the toolbar row: accent `Tag`s (`bg-accent-soft text-accent-strong`) in a `<ul aria-label={search.tags.label}>`, scrolling sideways on overflow (`flex-nowrap overflow-x-auto`). Only active filters show; the outlined quick chips are Out. They are static `Tag`s with no border at the kit's height, an accepted difference, because they are not buttons. |
| Filter panel | Collapsible card under the controls | Unchanged behaviour: a `Card padding="md"` below `PageHeader`, opened by the toggle. It carries the `hidden` attribute while closed, as today, which the tests rely on. Its contents are in "Filters panel" below. |
| Results bar: "38 דירות · ממוינות לפי התאמה" and the list/map segmented control | The count line inside the view; the toggle and the sort in the top row | A toolbar row in `SearchPage` holds the tags, `SortSelect` and `ViewToggle`; it wraps, with the sort and the toggle at the inline end. The count line is the first line of the view below it. It stays in the view, so it is always mounted and the toggle never remounts on a view switch (focus stays on the pressed toggle). |
| — | `ProfileNudge` above the view | Under the toolbar row, above the view. |
| "שמור חיפוש" dashed button | — | Out. |
| Cards 14 px apart, full width | 16 px apart | `gap-3` (the brand's card gap), one column. Card anatomy is in "The card". |
| Bottom navigation | — | `0009a`'s tab bar. |

### Desktop layout (`lg` and up, checked at 1440 px), against `SearchDesktop.dc.html`
| Artboard element | Today | This spec |
| --- | --- | --- |
| Top nav with brand, location search, links | The shell's header | `0009a` / `0009h`. The page starts under it with `PageHeader` (the `<h1>` `search.title`, no actions). |
| Filters `aside`: 280 px, white, an inline-end border, "מסננים" `<h2>` with "ניקוי" beside it | A collapsible panel in the 640 px column | The same panel element, always shown (no `hidden`, no toggle), in the grid's first column (`lg:grid-cols-[18rem_minmax(0,1fr)]`), so it is at the inline start (the right in RTL). It is a `Card padding="lg"`, not an edge-to-edge strip, because the shell has a page container. Its `<h2>` is visible here. It is a labelled `<section>`, not an `<aside>`: an `aside` inside `<main>` fails axe's `landmark-complementary-is-top-level`, and 0009c runs axe on `/search`. |
| "ניקוי" in the panel header | Clear at the bottom next to apply | One clear button, at the bottom next to apply, as today. Two would put two "ניקוי" buttons in the DOM, which breaks the component tests and duplicates a control. |
| No apply button (implied live filtering) | Apply button | Kept: the form validates on submit (0003b). |
| Results header: "38 דירות … · ממוינות לפי התאמה" first (17 px, weight 800), filter chips on the same row | Count, sort and toggle | The toolbar row (tags, sort, toggle) sits above the count line, in the results column. This is a decision: the count line must stay inside the view, always mounted, and the toggle outside it (see the phone row). The count line takes `lg:text-h3`. `ProfileNudge` is first in the results column. |
| A list column of row cards beside a map | One 640 px list | **List view:** the results column holds a grid of `layout="row"` cards, one column at 1024 px and two at 1440 px (the `auto-fill` grid). **Map view:** today's structure in the results column; the pairing is a later follow-up (FOLLOWUPS). |

### Filters panel (both layouts)
| Artboard | Today | This spec |
| --- | --- | --- |
| Price: "מ־" / "עד" boxes, 42 px | 48 px boxes with "₪" | Kit `TextInput` (48 px, `rounded-md`, `border-strong`) with the start word and the end "₪". See Scope. |
| Rooms: toggle buttons 1–2 / 3 / 4 / 5+ | From / to selects in half steps | The from / to kit `Select`s are kept. The buttons cannot express today's half-step ranges, so they would change behaviour. |
| Entry date with a calendar icon | Native date input and hint | A `Field` (`label` `search.availableBy`, `hint` `search.availableByHint`) holding a kit `TextInput type="date"`. |
| Type: three checkboxes | Two checkbox rows with the one-type lock and its hint | Two rows (the third is Out), the lock and the hint unchanged, with `accent-color` from `accent`. |
| Features: checkbox rows on desktop, chips on the phone | Chip-styled checkboxes | Chip-styled checkboxes at every width: one rendering, no duplicate inputs. Idle is `border-border-strong bg-surface text-ink`; checked is `border-accent bg-accent-soft text-accent-strong`. The kit has no multi-select chip group (`ChoiceGroup` is radios), so the local styles stay, in brand tokens; the gap is reported. |
| "שמור חיפוש" | — | Out. |
| — | Apply (primary) and clear (secondary) | Kit `Button` `primary` (ink) / `secondary`, `size="md"`, side by side across the panel. Apply keeps `type="submit"`. |

### The card (`ListingCard`)
| Artboard | Today | This spec |
| --- | --- | --- |
| Phone: 170 px photo; match badge on it (top start); heart (top end); room pill (bottom start) | 120 px placeholder, room pill at the bottom start | The photo box is `aspect-[16/10]` with `rounded-t-lg` (the brand's crop and top corners), `bg-surface-subtle`, and a 40 px outline icon in `text-ink-muted`. The brand allows one overlay on a photo: a badge in the top corner. That is the room pill, `Tag size="sm"` in the neutral tone at `top-2 start-2`, so it moves from the bottom. The match badge stays in the price row (below). The heart is Out. The 16:10 box is taller than today's placeholder; that is the brand's rule, and FOLLOWUPS 45 stays open until photos (`0002c`). |
| Desktop: row card, 180×136 photo at the inline start | — | `layout="row"` from `lg`. The photo is a fixed `lg:w-44` (176 px) `aspect-[16/10]` box (110 px high) with `lg:rounded-md`, an inset image inside the 12 px padding, not stretched. Below `lg` it is the stacked card. |
| Price 19–20 px weight 800 with "/ חודש" 13 px muted; on desktop the badge at the row's end | 24 px price; the `badge` slot at the end | The price is `text-h3 font-bold`, and "/ חודש" is `text-body-sm text-ink-muted`. `badge` stays at the end of the price row in **both** layouts, unlike the phone artboard's badge on the photo. One placement keeps one element (no duplicate "התאמה 87%" for tests or screen readers), and the photo's one corner badge is the room pill. |
| Phone: "כניסה 1.1.27" at the end of the price row | In the facts line | Stays in the facts line, as its last item, as on SearchDesktop. |
| Title 15–16 px, weight 500–600 | `<h2>` 18 px bold | `<h2>` (or 0009c's `titleAs`) in `text-body font-medium`. The text is still `cardTitle`; its wording is 0009b's. |
| Facts line 13 px muted: "קומה 3 · 95 מ״ר · מעלית · חניה · כניסה 1.1.27"; a room: "2 שותפים (27, 30) · קומה 2 · מרוהט · …" | `[flatmates] · floor · m² · entry`, and the features as chips | `<p data-testid="listing-facts">`, right after the title, in this order: flatmates (rooms only; `flatmatesText`, with ages only when the API sent them) · floor · m² · elevator / no elevator · parking (one / many, nothing for 0) · furnished · pets (when allowed) · entry. These are today's chip strings (`listings.card.*`, `listings.furnished.*`). The `·` separators stay `aria-hidden`, as today. |
| Chips at the bottom: "שותפים בגילך" and the match chips | `listing-chips` holds: similar age, for gender, elevator, parking, furnished, pets | `listing-chips` keeps only the room chips: "שותפים בגילך" (accent `Tag`) and "לנשים בלבד" / "לגברים בלבד" (neutral `Tag`). It is not rendered when empty. `MatchChips` (children) follows, pushed to the bottom in the row layout (`mt-auto`). |
| Card radius 20 / 18, `line` border; the selected row card has a shadow | `rounded-2xl` | `rounded-lg` with `border`, no shadow, in both layouts. `interactive` keeps today's focus ring around the card (the `has-[a:focus-visible]` outline). |

### Map view
- The structure is today's at every width: the count line, the states as `0009t` places them, the map
  (`h-[60vh] min-h-[360px]`) and the selected pin's card below it. It sits in the results column, beside the
  panel on a desktop.
- The selected card is a stacked `ListingCard` with the new anatomy.
- a later follow-up (FOLLOWUPS) adds the desktop list column.

### States
Both layouts have the same states as today:
- **loading**: the search mascot above the card-shaped skeletons (one turtle on the screen);
- **error**: `ErrorState`;
- **empty**: `EmptyState pose="search"` with `search.empty` and, when filters are set, the clear button as its
  `action`;
- **results**, with "עוד דירות" (a kit `secondary` `Button`, centred);
- **next-page error**.

The map view's states are `0009t`'s. It shows no mascot: the map has its own loading skeleton, and its empty
state is the count line.

### RTL
- Logical classes only.
- The panel is the grid's first column, so it is at the inline start (the right).
- The photo in a row card is the first flex child (the inline start).
- The room pill is at `top-2 start-2`.

### i18n keys added (brand voice: no slash forms, no gendered address)
| Key | Hebrew |
| --- | --- |
| `search.tags.label` | "מסננים פעילים" |
| `search.tags.priceRange` | "{{min}}–{{max}} ₪" |
| `search.tags.priceAtLeast` | "מ־{{min}} ₪" |
| `search.tags.priceUpTo` | "עד {{max}} ₪" |
| `search.tags.rooms` | "חדרים: {{range}}" |
| `search.tags.roomsRange` | "{{min}}–{{max}}" |
| `search.tags.roomsAtLeast` | "{{min}} ומעלה" |
| `search.tags.roomsUpTo` | "עד {{max}}" |
| `search.tags.availableBy` | "כניסה עד {{date}}" |

How the tags are built:
- Rooms use "חדרים: …", so that no number needs a plural form.
- A rooms tag is `search.tags.rooms` with `range` set to one of:
  - `roomsRange`;
  - the single value, when min equals max;
  - `roomsAtLeast`;
  - `roomsUpTo`.
  The values go through `formatRooms`. Prices go through `formatIls`, and the date through `formatDate`.
- One listing type reuses `search.type.apartment` / `search.type.room`. Features reuse `search.feature.*`.
- Every branch uses a static key, so `i18n-check` sees them all.

The toggle's count (`search.filtersActive`, from `countActive`) counts each price and rooms bound. With a range
set, it can be one more than the number of tags. That is accepted: the count is behaviour and stays.

## Acceptance criteria
- [ ] AC1 Phone layout (jsdom: no `matchMedia`, so the phone layout). Given `/search`, Then:
  - the page has one `<h1>` "חיפוש דירות";
  - the filters toggle is a button named "מסננים" with `aria-expanded="false"`;
  - the panel is `hidden`, and clicking the toggle shows it;
  - the toolbar holds the sort select and the view toggle group, before the count line in DOM order;
  - `ProfileNudge` comes after the toolbar and before the count line;
  - the result cards are `article`s with `data-layout="row"`.

  The existing `SearchPage.test.tsx` cases pass with only the updates listed in "Tests to write".
  — `web/src/features/search/__tests__/SearchPage.test.tsx::ac1_phone_layout`
- [ ] AC2 Given `?price_max=8000&rooms_min=3&rooms_max=4&available_by=2027-01-01&listing_type=room&pets=true`,
  Then the list "מסננים פעילים" holds, in order:
  - "עד 8,000 ₪";
  - "חדרים: 3–4";
  - "כניסה עד" with that date (`formatDate`);
  - "חדר בדירת שותפים";
  - "חיות מחמד".

  Further cases:
  - `?price_min=4000&price_max=8000&rooms_min=3` gives "4,000–8,000 ₪" and "חדרים: 3 ומעלה";
  - `?rooms_max=4` gives "חדרים: עד 4";
  - `?sort=price_asc&view=map` has no list at all.

  The tags are not buttons. — `SearchPage.test.tsx::ac2_active_filter_tags`
- [ ] AC3 Desktop layout (`matchMedia` stubbed to match `(min-width: 1024px)`). Given `/search` with two results,
  Then:
  - there is no filters toggle;
  - the region named "מסננים" (`aria-labelledby` its `<h2>`) has no `hidden`, and comes before the results in DOM
    order;
  - filling "עד" 5000 in it and pressing "הצגת תוצאות" navigates to `?price_max=5000`;
  - there is one count line (`[aria-live="polite"]`).
  — `SearchPage.test.tsx::ac3_desktop_side_panel`
- [ ] AC4 `ListingCard` anatomy. Given an apartment with an elevator, one parking spot, partly furnished, pets
  allowed, floor 3 of 5, 95 m² and entry in 30 days, Then:
  - `listing-facts` is the title's next sibling and reads, in order: "קומה 3 מתוך 5", "95 מ״ר", "מעלית", "חניה",
    "מרוהטת חלקית", "חיות מחמד", "כניסה …";
  - there is no `listing-chips` list;
  - the `badge` renders in the price row.

  Further cases:
  - A women-only room with ages [27, 30], for a seeker born 28 years ago:
    - the facts start with the flatmates text with ages;
    - `listing-chips` holds exactly "שותפים בגילך" (accent tone) and "לנשים בלבד" (neutral tone);
    - the room pill is in the photo box.
  - The same room without ages (a visitor's response) shows no ages anywhere on the card.
  - `layout="row"` sets `data-layout="row"`.
  - The root is an `article` with exactly one link.

  — `web/src/features/listings/__tests__/ListingCard.test.tsx::ac4_card_anatomy`
- [ ] AC5 States. Given the first page pending, Then the search mascot (`aria-hidden`) and three skeletons render.
  Given `total` 0 with filters set, Then `EmptyState`'s mascot, `search.empty` and a working "ניקוי" render. Given
  `total` 0 with no filters, there is no clear button. There is one mascot on the page in each state. —
  `SearchPage.test.tsx::ac5_mascot_states`
- [ ] AC6 Match chips and badge:
  - `MatchBadge` is `Badge size="md"`, with `bg-accent-soft text-accent-strong` for `high` and
    `bg-surface-subtle text-ink-muted` for `good` / `partial`. Its `data-testid="match-badge"` and `data-bucket`
    are on the badge element;
  - `MatchChips` renders `li` chips with the agree (accent) and differ (warning) tone classes.
  The assertions in `MatchBadge.test.tsx` and `SearchPage.test.tsx` that pin colour classes follow these brand
  classes. — `web/src/features/match/__tests__/MatchBadge.test.tsx`, `SearchPage.test.tsx` (updated assertions)
- [ ] AC7 E2E, phone. `web/e2e/search.spec.ts` gets `test.use({ viewport: { width: 390, height: 844 } })` at file
  level, so `ac9_visitor_searches_and_opens_listing` (and its `ac12` step) runs the phone layout. Its selectors are
  unchanged: Playwright's `Desktop Chrome` project is 1280×720, where the toggle it clicks no longer exists.

  A step is added at 390 px. On `/search?price_max=8000&rooms_min=3&pets=true`, with the panel opened:
  - `document.documentElement.scrollWidth <= innerWidth` (the toolbar of tags, sort and toggle is the overflow
    risk).
  — `web/e2e/search.spec.ts::ac9_visitor_searches_and_opens_listing`
- [ ] AC8 E2E, desktop, reusing AC7's sign-up. A last `test.step('0009i desktop: filters panel beside a grid of row
  cards')` in `ac9`, at `page.setViewportSize({ width: 1440, height: 900 })` on `/search`:
  - the region "מסננים" is visible, and the button "מסננים" (exact) has count 0;
  - the apartment's card has `data-layout="row"`;
  - the panel's box lies to the right of the card's box, with no overlap (`panel.x >= card.x + card.width - 1`);
  - `document.documentElement.scrollWidth <= innerWidth`;
  - setting "עד" 5000 in the panel and applying gives `/search?price_max=5000` and removes the card;
  - "ניקוי" brings it back.
  — `web/e2e/search.spec.ts::ac9_visitor_searches_and_opens_listing`
- [ ] AC9 `web/e2e/map.spec.ts` passes unchanged at 1280×720 (the map view keeps its structure). — `make e2e`
- [ ] AC10 Visual check.
  - **The harness** is the one `0009l` defines:
    - `web/playwright.screens.config.ts`: `testDir: 'e2e/screens'`, `testMatch: '*.screens.ts'`, so `make e2e`
      never runs it;
    - the projects `mobile` (390×844) and `desktop` (1440×900);
    - `make screens`;
    - `web/screens/` git-ignored.

    Whichever of 0009i / 0009k / 0009l builds first adds it, and the others add only their script. Its projects
    carry `playwright.config.ts`'s swiftshader `launchOptions`; otherwise the map renders "unavailable".
  - **The script** is `web/e2e/screens/search.screens.ts`:
    - it mocks every API call with `page.route` (no sign-up, deterministic data), and answers OSM tiles with the
      1×1 PNG of `map.spec.ts`;
    - its fixtures copy the artboards' four listings:
      - 7,200 ₪ / 4 rooms / Katznelson, Givatayim / 87%;
      - 3,400 ₪ room / Florentin / 2 flatmates / 82%;
      - 6,500 ₪ / 3 rooms / Bialik, Ramat Gan / 64%, pets differ;
      - 7,900 ₪ / 3.5 rooms / Jaffa / 58%, move-in differs;
    - visitor fixtures send `flatmate_ages: []` and `lifestyle: {}`; ages appear only in `list-seeker`.
  - **The states**, in both projects, full page, 14 PNGs at `web/screens/0009i/<state>-<project>.png`:
    - `list-visitor`;
    - `list-seeker` (badges and chips);
    - `filters-active` (the AC2 URL; on the phone with the panel opened);
    - `empty` (with filters, the mascot);
    - `loading` (a `/listings` route that never answers, the mascot);
    - `error` (500);
    - `map` (four pins, one pressed).
  - **Pass:** the 14 PNGs are written and listed in the digest.
  - **Review:** comparing them with the artboards and the brand kit is the ux reviewer's step. It uses the gap
    tables. The `.dc.html` files need the canvas runtime (`support.js`, not in the repo), so they are read as
    source or opened on the canvas (`design/README.md`).
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green (Speed rule
  7). The e2e result goes in the digest.
- [ ] NF2 Literals and widths:
  - 0009h's `noColourLiterals.test.ts` stays green;
  - `pageWidths.test.ts` passes with `/search` set to `wide`;
  - `grep -nE '\[[^]]*(px|rem|vh|/)[^]]*\]' <the files in "In">` lists only the four values under "Brand tokens",
    each with its comment. The build pastes that output in the digest.

## Tests to write
- **Component, new:**
  - `SearchPage.test.tsx`: `ac1_phone_layout`, `ac2_active_filter_tags`, `ac3_desktop_side_panel` and
    `ac5_mascot_states`;
  - `ListingCard.test.tsx`: `ac4_card_anatomy`.

  `ac3` stubs `window.matchMedia` with `vi.stubGlobal`, matching `(min-width: 1024px)`, and restores it after the
  test.
- **Component, updated.** Only these edits are allowed, and no assertion is deleted without a replacement that
  checks the same fact:

  | Where | Today | Replacement |
  | --- | --- | --- |
  | `ListingCard.test.tsx:29` (`chips()` helper) | `getByTestId('listing-chips')` | `queryByTestId`; it returns `[]` when the list is absent |
  | `ListingCard.test.tsx:95` (apartment) | chips = noElevator, furnished.none | `chips()` is `[]`, and `factsLine()` contains `he.listings.card.noElevator` and `he.listings.furnished.none` |
  | `ListingCard.test.tsx:111-117` (room) | similarAge, "לנשים בלבד", noElevator, furnished.none | exactly `[similarAge, 'לנשים בלבד']`; `chips[0]`'s class is the accent tone's |
  | `SearchPage.test.tsx:431-432` | `bg-warn text-warning` / `bg-accent-soft` | the warning / accent tone classes (AC6) |
  | `SearchPage.test.tsx:434` (apartment) | `listing-chips` lacks "בתקציב" | `queryByTestId('listing-chips')` is null, and `listing-facts` does not contain "בתקציב" |
  | `SearchPage.test.tsx:684-687` (`listChips`) | `getByTestId` | `queryByTestId`, returning `[]` when absent, so `:709` (apartment) holds |
  | `SearchPage.test.tsx:705` | `bg-accent-soft text-accent-strong` | the accent tone classes |
  | `SearchPage.test.tsx` (`:793`, `:799`, and any other colour-class assertion found by `grep -n "toHaveClass"`) | teal / amber classes | the brand tone classes |
  | `ListingWizard.test.tsx:150-156` (preview, apartment) | chips = 'מעלית', 'חניה', 'מרוהטת חלקית', 'חיות מחמד' | `listing-facts` holds those four in that order, and there is no `listing-chips`. 0009k expects this edit from whichever spec lands first |
  | `MatchBadge.test.tsx` | 0009h's `bg-accent text-white` / `bg-line text-ink-soft` | AC6's brand classes |

  `SearchMap.test.tsx:448` reads a room card's chips and still holds.
- **E2E:** `search.spec.ts` gets the file-level 390×844 `test.use`, the overflow step (AC7) and the desktop step
  (AC8). There are zero new sign-ups.
- **Visual:** `web/e2e/screens/search.screens.ts` (AC10), run by `make screens`, not by `make e2e`.

## Risks / open questions
- **No question for Gilad here.** Q1, the desktop map placement, moved to a later follow-up (FOLLOWUPS) with the map pairing (verifier
  i-M1). This spec keeps the map view as it is, so nothing here waits on Gilad.
- **Decisions this spec takes** (not product questions; the ux reviewer judges each against its reason):
  - the match badge stays in the price row on phone cards, and the room pill is the photo's one corner badge
    (brand);
  - one clear button;
  - feature chips at every width;
  - room selects rather than toggle buttons;
  - a labelled `section`, not an `aside`;
  - the toolbar above the count line on the desktop;
  - static active-filter tags;
  - the 16:10 photo box while there are no photos (brand).
- **Edits in the always-open desktop panel are lost on a sort or view change**, because the form is keyed by
  `searchParams.toString()` (`SearchPage.tsx:92`), as today. That is accepted; keying the form on the filters only
  would be a behaviour change.
- **Kit gaps**, checked against `specs/0009d-ui-kit.md`, `0009d-ui-kit-api.md` and the brand amendment:
  - there is no multi-select chip group. The feature chips keep FiltersForm's own checkbox markup in brand
    tokens; 0009k reports the same gap for the wizard's households;
  - `Badge` may not forward `data-*` attributes; see Scope for the additive fix.
  - Brand tone names (accent / neutral / warning) are 0009d's to settle. This spec gives the classes the tests
    expect.
  - The coder never adds a look-alike component, and never passes colour, size or padding through a kit
    `className` (0009d's rule: layout only).
- **Shared files.**
  - `ListingCard` changes for my listings (0009k / 0009o), the wizard preview and `/me/likes` too: the features
    move to the facts line there as well, and the 16:10 photo box is everywhere. 0009k consumes `layout`; it does
    not fork the card.
  - `MatchBadge` / `MatchChips` are used by the inbox (0009l) and people (0009p) as this spec leaves them.
- **Order with 0009c / 0009t / 0009g.**
  - 0009c edits `ResultsList` (`Loading`) and `ListingCard` (`titleAs`).
  - 0009t edits `SearchPage`, `ResultsList` and `SearchMap` (`countRef`, the map states, the overlay) and
    `ViewToggle` (`listButtonRef`).
  - 0009g edits `ErrorState`.
  - Whichever merges second rebases (Speed rule 3). Building after 0009t is cheaper, but this spec does not depend
    on it.
- **FOLLOWUPS lines claimed** (as of `8c3c480`):
  - 43, the radius half for the search files (0009h ticks the colour half; `ListingPage` is 0009j's);
  - 44;
  - 42 (the facts helper, used by the card and the listing page).

  Line 45 stays open: the brand's 16:10 rule sets the photo box. Line 127 is 0009h's.
- Verifier round 1: 6 majors and 13 minors, all applied (i-M1 split the desktop map pairing and Q1 into a later follow-up (FOLLOWUPS)).
  The orchestrator's brand amendment (`specs/0009-brand-amendment.md`) was applied in the same pass. Second round
  waived.

## Digest (filled by orchestrator after verification)
See `/digest`.
