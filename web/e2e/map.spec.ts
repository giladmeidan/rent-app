import { expect, test } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { expectNoAxeViolations } from './a11y';
import { routeTiles, signUpOwner } from './helpers';

// `localhost`, not 127.0.0.1, so the session cookie set for the web's site is sent with
// `page.request`. `make e2e` exports API_PORT.
const API = 'http://localhost:' + (process.env.API_PORT ?? '8000');

/** `YYYY-MM-DD`, `days` from today in Israel. */
function israelDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('ac8_visitor_finds_a_listing_on_the_map', async ({ page, request }) => {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const street = `e2e a-${tag}`;
  const other = `e2e b-${tag}`;
  // One price no other test posts (spec 0009v Scope 9): filtered to it, only these two listings are
  // on the map, whatever else CI's shared database holds. 7200 is every other test's price.
  let price = 7001 + Math.floor(Math.random() * 899);
  if (price === 7200) price += 1;

  // A fresh owner posts two listings through the API (as search.spec.ts).
  await signUpOwner(page);
  const areas = await page.request.get(API + '/areas');
  expect(areas.ok()).toBe(true);
  const [area] = (await areas.json()) as { id: string }[];
  expect(area).toBeDefined();
  const ids: string[] = [];
  for (const name of [street, other]) {
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
  const [id] = ids;

  // The worker's geocoding sweep (every 10 s, GEOCODER=fake) gives each a point; `request` has no
  // session cookie.
  for (const listingId of ids) {
    await expect
      .poll(
        async () => {
          const listing = await request.get(`${API}/listings/${listingId}`);
          return ((await listing.json()) as { lat: number | null }).lat;
        },
        { timeout: 30_000 },
      )
      .not.toBeNull();
  }

  // Tiles answered locally, MapLibre's workers included; every request URL is recorded.
  await routeTiles(page);
  const urls: string[] = [];
  page.context().on('request', (r) => urls.push(r.url()));

  // A visitor on the list: the library is never downloaded.
  const search = `/search?price_min=${String(price)}&price_max=${String(price)}`;
  await page.context().clearCookies();
  await page.goto(search);
  await expect(page.getByRole('article').filter({ hasText: street })).toHaveCount(1);
  expect(urls.filter((url) => url.includes('maplibre'))).toEqual([]);

  // The map: the library loads (on the Vite dev server, its pre-bundled module), WebGL works and
  // attribution is shown.
  await page
    .getByRole('group', { name: he.search.view.label })
    .getByRole('button', { name: he.search.view.map })
    .click();
  await expect(page).toHaveURL(`${search}&view=map`);
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

  // Its pin opens its card.
  const pin = region.getByRole('button', { name: street });
  await pin.press('Enter');
  const card = page.getByRole('article').filter({ hasText: street });
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('link')).toBeFocused();

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
  await expect(page).toHaveURL(`${search}&view=map`);
  await page.reload();
  await expect(page.getByRole('region', { name: he.search.map.label })).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: he.search.view.label })
      .getByRole('button', { name: he.search.view.map }),
  ).toHaveAttribute('aria-pressed', 'true');
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

  await page.goto('/search?view=map');
  const region = page.getByRole('region', { name: he.search.map.label });
  await expect(region).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });

  // Zoom in to the limit, one step per answered search (each step's `moveend` is a new box); the
  // button is disabled at `MAP_MAX_ZOOM`.
  const zoomIn = region.getByRole('button', { name: he.map.zoomIn });
  for (let i = 0; i < 20 && (await zoomIn.isEnabled()); i += 1) {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/listings?')),
      zoomIn.click(),
    ]);
  }
  await expect(zoomIn).toBeDisabled();
  await expect(region).toHaveAttribute('aria-busy', 'false');

  expect(statuses.length).toBeGreaterThan(1);
  expect(statuses.filter((status) => status !== 200)).toEqual([]);
  await expect(page.getByText(he.common.error)).toHaveCount(0);
});
