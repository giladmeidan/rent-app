import { expect, test } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { signUpOwner } from './helpers';

// `localhost`, not 127.0.0.1, so the session cookie set for the web's site is sent with
// `page.request`. `make e2e` exports API_PORT.
const API = 'http://localhost:' + (process.env.API_PORT ?? '8000');

// A 1x1 transparent PNG: every OSM tile is answered locally, so a run never calls OpenStreetMap.
const TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** `YYYY-MM-DD`, `days` from today in Israel. */
function israelDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('ac8_visitor_finds_a_listing_on_the_map', async ({ page, request }) => {
  const street = `e2e ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // A fresh owner posts one listing through the API (as search.spec.ts).
  await signUpOwner(page);
  const areas = await page.request.get(API + '/areas');
  expect(areas.ok()).toBe(true);
  const [area] = (await areas.json()) as { id: string }[];
  expect(area).toBeDefined();
  const created = await page.request.post(API + '/listings', {
    data: {
      listing_type: 'apartment',
      area_id: area?.id,
      city: 'גבעתיים',
      street,
      rooms: 3.5,
      floor: 3,
      total_floors: 5,
      size_sqm: 95,
      price_ils: 7200,
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
  const { id } = (await created.json()) as { id: string };

  // The worker's geocoding sweep (every 10 s, GEOCODER=fake) gives it a point; `request` has no
  // session cookie.
  await expect
    .poll(
      async () => {
        const listing = await request.get(`${API}/listings/${id}`);
        return ((await listing.json()) as { lat: number | null }).lat;
      },
      { timeout: 30_000 },
    )
    .not.toBeNull();

  // Tiles answered locally, MapLibre's workers included; every request URL is recorded.
  await page
    .context()
    .route('https://tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: TILE }),
    );
  const urls: string[] = [];
  page.context().on('request', (r) => urls.push(r.url()));

  // A visitor on the list: the library is never downloaded.
  await page.context().clearCookies();
  await page.goto('/search');
  await expect(page.getByRole('article').filter({ hasText: street })).toHaveCount(1);
  expect(urls.filter((url) => url.includes('maplibre'))).toEqual([]);

  // The map: the library loads (on the Vite dev server, its pre-bundled module), WebGL works,
  // attribution is shown, and the new listing has a pin.
  await page
    .getByRole('group', { name: he.search.view.label })
    .getByRole('button', { name: he.search.view.map })
    .click();
  await expect(page).toHaveURL('/search?view=map');
  const region = page.getByRole('region', { name: he.search.map.label });
  await expect(region).toBeVisible();
  await expect(page.getByText(he.search.map.unavailable)).toHaveCount(0);
  await expect.poll(() => urls.some((url) => url.includes('maplibre'))).toBe(true);
  await expect(region.getByText('OpenStreetMap')).toBeVisible();
  const pin = region.getByRole('button', { name: street });
  await expect(pin).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(he.search.map.unavailable)).toHaveCount(0);

  // Its pin opens its card (pressed from the keyboard: pins may overlap among 50).
  await pin.press('Enter');
  const card = page.getByRole('article').filter({ hasText: street });
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('link')).toBeFocused();

  // The card's title opens the listing page, with its approximate-area map.
  await card.getByRole('link').click();
  await expect(page).toHaveURL(`/listings/${id}`);
  await expect(page.getByRole('region', { name: he.listing.mapLabel })).toBeVisible();

  // Back on the map view, a reload keeps it.
  await page.goBack();
  await expect(page).toHaveURL('/search?view=map');
  await page.reload();
  await expect(page.getByRole('region', { name: he.search.map.label })).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: he.search.view.label })
      .getByRole('button', { name: he.search.view.map }),
  ).toHaveAttribute('aria-pressed', 'true');
});
