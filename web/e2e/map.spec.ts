import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { expectNoAxeViolations } from './a11y';
import { test } from './fixtures';
import { intoTheDockedCard, latNorthBy, routeTiles, signUpOwner } from './helpers';

// `localhost`, not 127.0.0.1, so the session cookie set for the web's site is sent with
// `page.request`. `make e2e` exports API_PORT.
const API = 'http://localhost:' + (process.env.API_PORT ?? '8000');

type Box = { x: number; y: number; width: number; height: number };

/** The element's box in viewport pixels, failing the test when it is not rendered. */
async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('no bounding box');
  return box;
}

/** Whether two boxes overlap with a positive area. */
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** `inner` lies within `outer` (1 px of rounding allowed). */
const within = (inner: Box, outer: Box) =>
  inner.x >= outer.x - 1 &&
  inner.y >= outer.y - 1 &&
  inner.x + inner.width <= outer.x + outer.width + 1 &&
  inner.y + inner.height <= outer.y + outer.height + 1;

/** The current URL's query. */
const query = (page: Page) => new URL(page.url()).searchParams;

/** `YYYY-MM-DD`, `days` from today in Israel. */
function israelDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type Point = { lat: number; lng: number };
type Posted = { price: number; streets: string[]; ids: string[]; points: Map<string, Point> };

/**
 * A fresh owner posts `count` apartments at one price, then waits for the worker's geocoding sweep
 * (every 10 s, GEOCODER=fake) to give each a point. The price is one no other test posts (spec
 * 0009v Scope 9): filtered to it, only these listings are on the map, whatever else CI's shared
 * database holds. 0009v reserved 7001-7899 (7200 is every other test's price); each map test
 * draws from its own sub-range of it (`range`), so two tests in one CI run never share a price;
 * 0009x's side map test takes 7901-7999.
 */
async function postAtOnePrice(
  page: Page,
  request: APIRequestContext,
  count: number,
  [low, high]: [number, number],
): Promise<Posted> {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const streets = Array.from(
    { length: count },
    (_, i) => `e2e ${String.fromCharCode(97 + i)}-${tag}`,
  );
  let price = low + Math.floor(Math.random() * (high - low + 1));
  if (price === 7200) price += 1;

  // A fresh owner posts them through the API (as search.spec.ts).
  await signUpOwner(page);
  const areas = await page.request.get(API + '/areas');
  expect(areas.ok()).toBe(true);
  const [area] = (await areas.json()) as { id: string }[];
  expect(area).toBeDefined();
  const ids: string[] = [];
  for (const name of streets) {
    const created = await page.request.post(API + '/listings', {
      data: {
        listing_type: 'apartment',
        area_id: area?.id,
        city: 'גבעתיים',
        street: name,
        rooms: 3.5,
        floor: 3,
        total_floors: 5,
        size_sqm: 95,
        price_ils: price,
        available_from: israelDay(30),
        entry_flexible: false,
        elevator: true,
        parking_spots: 1,
        furnished: 'partial',
        pets_allowed: true,
        arnona_ils: null,
        vaad_ils: null,
        description: null,
      },
    });
    expect(created.status()).toBe(201);
    ids.push(((await created.json()) as { id: string }).id);
  }

  // `request` has no session cookie.
  const points = new Map<string, Point>();
  for (const listingId of ids) {
    await expect
      .poll(
        async () => {
          const listing = await request.get(`${API}/listings/${listingId}`);
          const { lat, lng } = (await listing.json()) as {
            lat: number | null;
            lng: number | null;
          };
          if (lat !== null && lng !== null) points.set(listingId, { lat, lng });
          return lat;
        },
        { timeout: 30_000 },
      )
      .not.toBeNull();
  }
  return { price, streets, ids, points };
}

/** The search map's locators for the listing on `street`. */
function mapOf(page: Page, street: string) {
  const region = page.getByRole('region', { name: he.search.map.label });
  const docked = region.locator('[data-map-card]');
  return {
    region,
    pin: region.getByRole('button', { name: street }),
    docked,
    dockedCard: docked.getByRole('article').filter({ hasText: street }),
  };
}
type MapLocators = ReturnType<typeof mapOf>;

/**
 * Spec 0009w AC7: the map at the test pin, alone at the centre (its own price, zoom 16, at its
 * point; `c` takes at most 6 decimals, the fake geocoder's points have more: about 0.1 m off), or
 * centred `north` px north of it.
 */
function atThePin(price: number, point: Point, north = 0): string {
  const lat = north === 0 ? point.lat : latNorthBy(point.lat, north, 16);
  const centre = `${lat.toFixed(6)},${point.lng.toFixed(6)}`;
  return `/search?view=map&price_min=${String(price)}&price_max=${String(price)}&c=${centre}&z=16`;
}

/** Tiles answered locally, and the owner's session dropped: a visitor. */
async function asVisitor(page: Page) {
  await routeTiles(page);
  await page.context().clearCookies();
}

/** Presses the pin from the keyboard: the page does not move and the card docks in the map,
 * clear of the pin and of the OpenStreetMap attribution. */
async function pressAndCheckTheCard(
  page: Page,
  { region, pin, docked, dockedCard }: MapLocators,
  url: string,
) {
  // The next lines wait for the map and the pin themselves.
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(region).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await expect(pin).toBeVisible({ timeout: 15_000 });
  await region.scrollIntoViewIfNeeded();
  await pin.focus();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await pin.press('Enter');
  await expect(dockedCard).toHaveCount(1);
  await expect(dockedCard.getByRole('link')).toBeFocused();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  // No page jump (today 342 px on desktop, 374 px on a phone).
  const scrollAfter = await page.evaluate(() => window.scrollY);
  expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(2);
  // Inside the map region, and painted above the markers: the card's centre hits the card.
  const regionBox = await boxOf(region);
  const cardBox = await boxOf(docked);
  expect(within(cardBox, regionBox)).toBe(true);
  const hitsTheCard = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-map-card]') != null,
    [cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2] as const,
  );
  expect(hitsTheCard).toBe(true);
  // The pin is panned clear of the card (the pan may still be easing), and the attribution
  // (licence) is never covered.
  await expect
    .poll(async () => intersects(await boxOf(pin), await boxOf(docked)), { timeout: 10_000 })
    .toBe(false);
  const attribution = region.locator('.maplibregl-ctrl-attrib');
  await expect(attribution).toBeVisible();
  expect(intersects(await boxOf(attribution), await boxOf(docked))).toBe(false);
}

test('ac8_visitor_finds_a_listing_on_the_map', async ({ page, request }) => {
  const {
    price,
    streets: [street = '', other = ''],
    ids: [id],
  } = await postAtOnePrice(page, request, 2, [7001, 7299]);

  // Tiles answered locally, MapLibre's workers included; every request URL is recorded.
  await routeTiles(page);
  const urls: string[] = [];
  page.context().on('request', (r) => urls.push(r.url()));

  // A visitor on the list below 1280 px (no side map, spec 0009x): the library is never downloaded.
  const search = `/search?price_min=${String(price)}&price_max=${String(price)}`;
  await page.context().clearCookies();
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto(search);
  await expect(page.getByRole('article').filter({ hasText: street })).toHaveCount(1);
  expect(urls.filter((url) => url.includes('maplibre'))).toEqual([]);

  // The map: the library loads (on the Vite dev server, its pre-bundled module), WebGL works and
  // attribution is shown.
  await page
    .getByRole('group', { name: he.search.view.label })
    .getByRole('button', { name: he.search.view.map })
    .click();
  /** The page is `search` in map view; the map adds its `c` / `z` as soon as it loads (0009w). */
  const onTheMap = () => {
    const url = new URL(page.url());
    return [
      url.pathname,
      url.searchParams.get('price_min'),
      url.searchParams.get('price_max'),
      url.searchParams.get('view'),
    ];
  };
  const mapOfSearch = ['/search', String(price), String(price), 'map'];
  await expect.poll(onTheMap).toEqual(mapOfSearch);
  const region = page.getByRole('region', { name: he.search.map.label });
  await expect(region).toBeVisible();
  await expect(page.getByText(he.search.map.unavailable)).toHaveCount(0);
  await expect.poll(() => urls.some((url) => url.includes('maplibre'))).toBe(true);
  await expect(region.getByText('OpenStreetMap')).toBeVisible();
  await expect(page.getByText(he.search.map.unavailable)).toHaveCount(0);

  await test.step('ac6_one_map_landmark', async () => {
    // One landmark: the wrapper's region; MapLibre's canvas region is now an `application`.
    await expect(page.getByRole('region', { name: he.search.map.label, exact: true })).toHaveCount(
      1,
    );
    await expect(page.getByRole('region', { name: he.map.title, exact: true })).toHaveCount(0);
    const canvas = region.locator('canvas.maplibregl-canvas');
    await expect(canvas).toHaveAttribute('role', 'application');
    await expect(canvas).toHaveAttribute('tabindex', '0');
    await expect(canvas).toHaveAttribute('aria-label', he.map.title);
    // The "updating" pill (drawn once the map has loaded) is gone with the busy state.
    await expect(region).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
    await expect(page.getByTestId('map-updating')).toHaveCount(0);
  });

  await test.step('ac10_bubble_zooms_in', async () => {
    // Zoomed out to the minimum, the two points lie within ~40 px: one bubble of 2.
    const zoomOut = region.getByRole('button', { name: he.map.zoomOut });
    for (let i = 0; i < 20 && (await zoomOut.isEnabled()); i += 1) await zoomOut.click();
    await expect(zoomOut).toBeDisabled();
    const bubble = region.getByRole('button', { name: he.search.map.bubble_two, exact: true });
    await expect(bubble).toBeVisible({ timeout: 15_000 });
    await expect(bubble).toHaveText('2');
    await expect(region.getByRole('button', { name: street })).toHaveCount(0);

    // Pressed from the keyboard: the map zooms in until the two part, and focus lands on a pin.
    await bubble.press('Enter');
    await expect(zoomOut).toBeEnabled();
    await expect(region.getByRole('button', { name: street })).toBeVisible({ timeout: 15_000 });
    await expect(region.getByRole('button', { name: other })).toBeVisible();
    await expect(bubble).toHaveCount(0);
    await expect(page.locator('[data-pin-id]:focus')).toHaveCount(1);
  });

  await test.step('ac10_no_marker_exemption', async () => {
    await expect(region).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
    // The pins are checked like every other control (spec 0009v ended the "essential" exemption).
    await expectNoAxeViolations(page, '/search?view=map (with pins)');
  });

  // Its pin opens its card, docked in the map.
  const pin = region.getByRole('button', { name: street });
  await pin.press('Enter');
  const card = region.locator('[data-map-card]').getByRole('article').filter({ hasText: street });
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('link')).toBeFocused();
  await expect.poll(() => query(page).get('pin')).toBe(id ?? '');

  // The card's title opens the listing page, with its approximate-area map.
  await card.getByRole('link').click();
  await expect(page).toHaveURL(`/listings/${id ?? ''}`);
  const small = page.getByRole('region', { name: he.listing.mapLabel });
  await expect(small).toBeVisible();
  // The small static map is hidden from assistive tech and never focusable (spec 0009t AC6).
  await expect(small).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  const smallCanvas = small.locator('canvas.maplibregl-canvas');
  await expect(smallCanvas).toHaveAttribute('aria-hidden', 'true');
  await expect(smallCanvas).toHaveAttribute('tabindex', '-1');
  await expect(smallCanvas).not.toHaveAttribute('role', /.*/);
  await expect(smallCanvas).not.toHaveAttribute('aria-label', /.*/);
  await expectNoAxeViolations(page, 'listing page (visitor)');

  // Back on the map view, a reload keeps it.
  await page.goBack();
  await expect.poll(onTheMap).toEqual(mapOfSearch);
  await page.reload();
  await expect(page.getByRole('region', { name: he.search.map.label })).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: he.search.view.label })
      .getByRole('button', { name: he.search.view.map }),
  ).toHaveAttribute('aria-pressed', 'true');
});

// Spec 0009w AC7, apart from ac8 so each test fits the 30 s budget: one listing each (the pin is
// alone at its price), seen by a visitor.
test('ac7_card_docked_desktop_and_back', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const {
    price,
    streets: [street = ''],
    ids: [id = ''],
    points,
  } = await postAtOnePrice(page, request, 1, [7300, 7499]);
  const point = points.get(id);
  if (point === undefined) throw new Error('no point for the test listing');
  await asVisitor(page);
  const map = mapOf(page, street);
  const { region, pin, dockedCard } = map;

  await test.step('ac7_card_docked_desktop', async () => {
    await pressAndCheckTheCard(page, map, atThePin(price, point));
  });

  await test.step('ac7_back_restores_the_view', async () => {
    // The map has settled (a keep-visible pan would write its `c`): the URL reads the same twice.
    await expect(region).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
    let settledUrl = '';
    await expect
      .poll(
        () => {
          const previous = settledUrl;
          settledUrl = page.url();
          return previous === settledUrl;
        },
        { intervals: [500], timeout: 15_000 },
      )
      .toBe(true);
    const before = new URL(settledUrl).searchParams;
    expect(before.get('pin')).toBe(id);

    await dockedCard.getByRole('link').click();
    await expect(page).toHaveURL(`/listings/${id}`);
    await page.goBack();

    // The same centre, zoom and pin by value, the card back once the results load, its pin pressed.
    await expect(dockedCard).toHaveCount(1, { timeout: 15_000 });
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    const after = query(page);
    for (const key of ['c', 'z', 'pin']) expect(after.get(key)).toBe(before.get(key));
  });
});

test('ac7_card_docked_phone', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const {
    price,
    streets: [street = ''],
    ids: [id = ''],
    points,
  } = await postAtOnePrice(page, request, 1, [7500, 7699]);
  const point = points.get(id);
  if (point === undefined) throw new Error('no point for the test listing');
  await asVisitor(page);
  await pressAndCheckTheCard(page, mapOf(page, street), atThePin(price, point));
});

// Apart from the Back check: after a pan, the 4-decimal `c` can move the pin a few px on restore and
// pan it again, so a pan never meets an exact-`c` comparison.
test('ac7_card_keeps_the_pin_clear', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const {
    price,
    streets: [street = ''],
    ids: [id = ''],
    points,
  } = await postAtOnePrice(page, request, 1, [7700, 7899]);
  const point = points.get(id);
  if (point === undefined) throw new Error('no point for the test listing');
  await asVisitor(page);
  const { region, pin, docked, dockedCard } = mapOf(page, street);

  // The map's height at 390 decides how far below the centre the card docks.
  await page.goto(atThePin(price, point), { waitUntil: 'domcontentloaded' });
  await expect(region).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  const drop = intoTheDockedCard((await boxOf(region)).height);
  // The centre `drop` px north of the pin: the pin starts low in the map, in the card's band.
  await page.goto(atThePin(price, point, drop), { waitUntil: 'domcontentloaded' });
  await expect(region).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await expect(pin).toBeVisible({ timeout: 15_000 });
  await region.scrollIntoViewIfNeeded();
  const regionBox = await boxOf(region);
  const start = await boxOf(pin);
  expect(
    Math.abs(start.y + start.height / 2 - (regionBox.y + regionBox.height / 2) - drop),
  ).toBeLessThanOrEqual(3);

  await pin.focus();
  await pin.press('Enter');
  await expect(dockedCard).toHaveCount(1);
  // The card covers where the pin started, so the map has to pan.
  expect(intersects(start, await boxOf(docked))).toBe(true);
  await expect
    .poll(async () => intersects(await boxOf(pin), await boxOf(docked)), { timeout: 10_000 })
    .toBe(false);
  expect((await boxOf(pin)).y).toBeLessThan(start.y);
  await expect(pin).toBeInViewport();
  const attribution = region.locator('.maplibregl-ctrl-attrib');
  await expect(attribution).toBeVisible();
  expect(intersects(await boxOf(attribution), await boxOf(docked))).toBe(false);
});

// Spec 0009y AC7: "show on the search map" opens the full map at this listing, its card in the map
// and its pin pressed (newest first, so this fresh listing is among the box's results; the pressed
// pin is kept out of bubbles). The link carries no price filter. Its price sits above 0009v's
// 7001-7899 (every sub-range taken), so it never joins a map test's one-price view (ac8 expects a
// bubble of exactly 2).
test('ac7_listing_page_link', async ({ page, request }) => {
  const {
    streets: [street = ''],
    ids: [id = ''],
  } = await postAtOnePrice(page, request, 1, [8301, 8399]);
  await asVisitor(page);
  const { region, pin, dockedCard } = mapOf(page, street);

  await page.goto(`/listings/${id}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: he.listing.showOnMap }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/search');
  expect(query(page).get('view')).toBe('map');
  expect(query(page).get('listing_type')).toBe('apartment');
  expect(query(page).get('pin')).toBe(id);
  await expect(region).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await expect(dockedCard).toHaveCount(1, { timeout: 15_000 });
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
});

test('map_survives_one_failed_tile', async ({ page }) => {
  await routeTiles(page, 1);
  await page.goto('/search?view=map');
  const region = page.getByRole('region', { name: he.search.map.label });
  await expect(region).toBeVisible();
  await expect(region).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await expect(page.getByTestId('map-unavailable')).toHaveCount(0);
});

test('map_max_zoom_never_422_on_390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeTiles(page);
  const statuses: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/listings?')) statuses.push(r.status());
  });

  // Opened at a position, so 0009w's first-open fit never runs: a fit racing the clicks made a step
  // wait for a search that never came (CI, f986008 and #67).
  await page.goto('/search?view=map&c=32.08,34.8&z=13', { waitUntil: 'domcontentloaded' });
  const region = page.getByRole('region', { name: he.search.map.label });
  await expect(region).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });

  // Zoom in to the limit, one step per settled view (each step's `moveend` writes `z` and asks for
  // a new box); the button is disabled at `MAP_MAX_ZOOM`.
  const zoomIn = region.getByRole('button', { name: he.map.zoomIn });
  for (let i = 0; i < 20 && (await zoomIn.isEnabled()); i += 1) {
    const zoomBefore = query(page).get('z');
    await zoomIn.click();
    await expect.poll(() => query(page).get('z')).not.toBe(zoomBefore);
    await expect(region).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  }
  await expect(zoomIn).toBeDisabled();
  await expect(region).toHaveAttribute('aria-busy', 'false');

  expect(statuses.length).toBeGreaterThan(1);
  expect(statuses.filter((status) => status !== 200)).toEqual([]);
  await expect(page.getByText(he.common.error)).toHaveCount(0);
});

test('ac6_side_map_mirrors_the_list', async ({ page, request }) => {
  // One listing at its own price: filtered to it, the list (and so the side map) holds only it.
  const {
    price,
    streets: [street = ''],
    ids: [id = ''],
  } = await postAtOnePrice(page, request, 1, [7901, 7999]);

  // Tiles are answered by the auto fixture; every request URL is recorded.
  const urls: string[] = [];
  page.context().on('request', (r) => urls.push(r.url()));
  const search = `/search?price_min=${String(price)}&price_max=${String(price)}`;
  const card = page.getByRole('article').filter({ hasText: street });
  const region = page.getByRole('region', { name: he.search.sideMap.label });
  const open = page.getByRole('button', { name: he.search.sideMap.open });
  await page.context().clearCookies();

  await test.step('below 1280 px: no side map, no library', async () => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(search, { waitUntil: 'domcontentloaded' });
    await expect(card).toHaveCount(1);
    // Past the idle mount's 2 s timeout: nothing mounted, nothing downloaded.
    await page.waitForTimeout(2_500);
    await expect(region).toHaveCount(0);
    expect(urls.filter((url) => url.includes('maplibre'))).toEqual([]);
  });

  await test.step('at 1440 px the side map follows the list', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(search, { waitUntil: 'domcontentloaded' });
    await expect(card).toBeVisible();
    await expect(region).toBeVisible({ timeout: 15_000 });
    await expect(region).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
    await expect(region.getByText('OpenStreetMap')).toBeVisible();
  });

  await test.step('hovering the card highlights its pin', async () => {
    await card.hover();
    // Highlighted, it is kept apart from any bubble and drawn as the selected chip.
    const pin = region.locator(`[data-pin-id="${id}"]`);
    await expect(pin).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(pin.locator('span').first()).toHaveClass(/(^| )bg-accent( |$)/);
    await expect(page.locator('li[data-highlighted]')).toHaveCount(1);
    // Every marker is hidden from assistive tech and none is a tab stop.
    const markers = region.locator('.maplibregl-marker');
    expect(await markers.count()).toBeGreaterThan(0);
    for (const marker of await markers.all()) {
      await expect(marker).toHaveAttribute('aria-hidden', 'true');
    }
  });

  await test.step('the keyboard reaches "open" and never the map', async () => {
    await page.mouse.move(0, 0);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    let reachedOpen = false;
    const intoTheMap: string[] = [];
    let first: string | undefined;
    for (let i = 0; i < 150; i += 1) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate((label) => {
        const element = document.activeElement;
        if (element === null || element === document.body) return { key: 'body', inMap: '' };
        const map = document.querySelector(`[role="region"][aria-label="${label}"]`);
        const inMap =
          map?.contains(element) === true && element.closest('.maplibregl-ctrl-attrib') === null
            ? element.outerHTML.slice(0, 120)
            : '';
        return { key: element.outerHTML.slice(0, 200), inMap, text: element.textContent };
      }, he.search.sideMap.label);
      if (focused.inMap !== '') intoTheMap.push(focused.inMap);
      if (focused.text === he.search.sideMap.open) reachedOpen = true;
      if (first === undefined) first = focused.key;
      else if (focused.key === first) break;
    }
    expect(intoTheMap).toEqual([]);
    expect(reachedOpen).toBe(true);
  });

  await test.step('axe passes with the side map', async () => {
    await page.mouse.move(0, 0);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await expect(page.locator('li[data-highlighted]')).toHaveCount(0);
    await expect(region).toHaveAttribute('aria-busy', 'false');
    await expectNoAxeViolations(page, '/search (side map)');
  });

  await test.step('"open" lands on the full map at the same place', async () => {
    await open.click();
    await expect.poll(() => query(page).get('view')).toBe('map');
    const params = query(page);
    expect(params.get('price_min')).toBe(String(price));
    expect(params.get('price_max')).toBe(String(price));
    expect(params.get('c')).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
    expect(params.get('z')).toMatch(/^\d+(\.\d+)?$/);
    await expect(
      page
        .getByRole('group', { name: he.search.view.label })
        .getByRole('button', { name: he.search.view.map }),
    ).toBeFocused();
    await expect(page.getByRole('region', { name: he.search.map.label })).toBeVisible();
  });
});
