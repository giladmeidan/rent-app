import { test, type Page, type Route } from '@playwright/test';

import he from '../../src/locales/he.json' with { type: 'json' };
import { routeTiles } from '../helpers';
import { WEB_ORIGIN } from './origin';

// The visual check of spec 0009i (`make screens`): /search in seven states at 390px and 1440px.
// Every API call is mocked, so the data is deterministic and nothing signs up. The four listings
// copy the artboards (Search.dc.html / SearchDesktop.dc.html). Spec 0009v adds the map's tiers,
// marks, seen chip, a bubble and the same-place list (into screens/0009v/); on the map the four
// listings' points are spread north to south, so their pins stay apart at the first (fitted) view.
// Spec 0009w docks the pin's card and the same-place list inside the map: states `map`,
// `map-card-match` and `map-same-place` go to screens/0009w/.

const API = 'http://localhost:' + (process.env.API_PORT ?? '8000');

const CORS = {
  'access-control-allow-origin': WEB_ORIGIN,
  'access-control-allow-credentials': 'true',
};
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: CORS,
    body: JSON.stringify(body),
  });

type Match = { score: number; agrees: string[]; differs: string | null };

/** `GET /listings`'s item, with the fields every card needs. */
function listing(n: number, overrides: Record<string, unknown>) {
  return {
    id: `00000000-0000-0000-0000-00000000000${String(n)}`,
    listing_type: 'apartment',
    city: 'רמת גן',
    street: 'ביאליק',
    rooms: 3,
    floor: 2,
    total_floors: 4,
    size_sqm: 80,
    price_ils: 6000,
    available_from: '2026-11-01',
    entry_flexible: false,
    elevator: false,
    parking_spots: 0,
    furnished: 'none',
    pets_allowed: false,
    arnona_ils: null,
    vaad_ils: null,
    description: null,
    accepted_households: ['single', 'couple', 'family', 'roommates'],
    smoking_allowed: true,
    min_contract_months: null,
    gender_preference: 'any',
    flatmates_count: null,
    flatmate_ages: [],
    lifestyle: {},
    created_at: '2026-11-01T10:00:00Z',
    lat: null,
    lng: null,
    match: null,
    ...overrides,
  };
}

/** Where the listings sit: their true points (the list states), or spread on the map (0009v), plus
 * a tight pair or two at one point. */
type MapFixtures = 'true' | 'spread' | 'bubble' | 'samePlace';

/** The four listings' map points, each ~0.04 deg of latitude (~80 px at the fitted view) apart. */
const SPREAD = {
  1: { lng: 34.811, lat: 32.0707 },
  2: { lng: 34.79, lat: 32.03 },
  3: { lng: 34.8247, lat: 32.11 },
  4: { lng: 34.8, lat: 31.99 },
} as const;

/** The artboards' four listings. A visitor gets no match and no flatmate ages (room privacy). */
function listings(seeker: boolean, map: MapFixtures = 'true') {
  const match = (m: Match) => (seeker ? m : null);
  // On the map the true points of 1 and 3 (and of 2 and 4) are ~6 px apart at the fitted view and
  // fold into bubbles; spread, each pin stands alone (0009v AC11).
  const at = (n: 1 | 2 | 3 | 4, lng: number, lat: number) =>
    map === 'true' ? { lng, lat } : SPREAD[n];
  const items = [
    listing(1, {
      street: 'כצנלסון',
      city: 'גבעתיים',
      rooms: 4,
      floor: 3,
      total_floors: 6,
      size_sqm: 95,
      price_ils: 7200,
      available_from: '2027-01-01',
      elevator: true,
      parking_spots: 1,
      furnished: 'partial',
      ...at(1, 34.811, 32.0707),
      match: match({ score: 87, agrees: ['budget', 'area'], differs: null }),
    }),
    listing(2, {
      listing_type: 'room',
      street: 'פלורנטין',
      city: 'תל אביב',
      rooms: 3,
      floor: 2,
      total_floors: 4,
      size_sqm: 14,
      price_ils: 3400,
      available_from: '2026-11-01',
      furnished: 'full',
      pets_allowed: true,
      gender_preference: 'women',
      flatmates_count: 2,
      flatmate_ages: seeker ? [27, 30] : [],
      ...at(2, 34.7695, 32.0565),
      match: match({ score: 82, agrees: ['budget', 'household'], differs: null }),
    }),
    listing(3, {
      street: 'ביאליק',
      city: 'רמת גן',
      rooms: 3,
      floor: 1,
      total_floors: 4,
      size_sqm: 78,
      price_ils: 6500,
      available_from: '2026-12-15',
      elevator: true,
      ...at(3, 34.8147, 32.0824),
      match: match({ score: 64, agrees: ['budget'], differs: 'pets' }),
    }),
    listing(4, {
      street: 'שדרות ירושלים',
      city: 'יפו',
      rooms: 3.5,
      floor: 4,
      total_floors: 5,
      size_sqm: 88,
      price_ils: 7900,
      available_from: '2027-03-01',
      parking_spots: 1,
      furnished: 'partial',
      ...at(4, 34.7568, 32.0505),
      match: match({ score: 58, agrees: ['area'], differs: 'move_in' }),
    }),
  ];
  // Two more listings: a tight pair (a bubble that zooms in) or two at one point (a bubble that
  // lists them).
  if (map === 'bubble' || map === 'samePlace') {
    const second = map === 'bubble' ? { lng: 34.9205, lat: 32.0305 } : { lng: 34.92, lat: 32.03 };
    items.push(
      listing(5, {
        street: 'ז׳בוטינסקי',
        city: 'רמת גן',
        price_ils: 5800,
        lng: 34.92,
        lat: 32.03,
        match: match({ score: 71, agrees: ['budget'], differs: null }),
      }),
      listing(6, {
        street: 'ז׳בוטינסקי',
        city: 'רמת גן',
        rooms: 4,
        price_ils: 6900,
        ...second,
        match: match({ score: 52, agrees: ['area'], differs: 'pets' }),
      }),
    );
  }
  return items;
}

const seekerUser = {
  id: '00000000-0000-0000-0000-0000000000aa',
  email: 'noa@example.com',
  display_name: 'נועה',
  role: 'seeker',
  account_type: 'standard',
  created_at: '2026-11-10T10:00:00Z',
};
const seekerProfile = {
  budget_max_ils: 7500,
  move_in_date: '2026-12-01',
  move_in_flexible: true,
  area_ids: [],
  household: 'couple',
  has_pets: true,
  smoker: false,
  contract_months: 24,
  parking_needed: 1,
  gender: 'woman',
  birth_year: new Date().getUTCFullYear() - 28,
  flatmate_gender: 'any',
  lifestyle: {},
  people_visible: false,
  about_me: null,
  updated_at: '2026-11-10T10:00:00Z',
};

type Search = 'items' | 'empty' | 'never' | 'error';

/** Routes the API: everything unknown is a 404, `GET /listings` answers as `search` says. */
async function mockApi(
  page: Page,
  { seeker, search, map = 'true' }: { seeker: boolean; search: Search; map?: MapFixtures },
) {
  await routeTiles(page);
  await page.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...CORS,
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE',
        },
      });
    }
    if (url.pathname === '/me/events') return route.abort();
    if (url.pathname === '/me') {
      return seeker ? json(route, seekerUser) : json(route, { detail: 'unauthenticated' }, 401);
    }
    if (url.pathname === '/me/profile') {
      return seeker ? json(route, seekerProfile) : json(route, { detail: 'unauthenticated' }, 401);
    }
    // The seeker liked listing 2 (a room) and applied to listing 3 (0009v AC11).
    if (url.pathname === '/me/likes') {
      if (!seeker) return json(route, { detail: 'unauthenticated' }, 401);
      const liked = listings(true, map)[1];
      return json(route, {
        liked_me: [],
        mine: [{ listing: liked, liked_at: '2026-11-10T10:00:00Z' }],
      });
    }
    if (url.pathname === '/me/applications') {
      if (!seeker) return json(route, { detail: 'unauthenticated' }, 401);
      return json(route, [
        {
          id: '00000000-0000-0000-0000-0000000000b1',
          status: 'submitted',
          source: 'apply',
          message: 'fake message for the screens',
          created_at: '2026-11-10T10:00:00Z',
          updated_at: '2026-11-10T10:00:00Z',
          listing: {
            id: '00000000-0000-0000-0000-000000000003',
            listing_type: 'apartment',
            city: 'רמת גן',
            street: 'ביאליק',
            rooms: 3,
            price_ils: 6500,
          },
        },
      ]);
    }
    if (url.pathname === '/listings') {
      const items = listings(seeker, map);
      if (search === 'never') return new Promise<void>(() => undefined);
      if (search === 'error') return json(route, { detail: 'boom' }, 500);
      if (search === 'empty') return json(route, { items: [], total: 0, sort: 'newest' });
      return json(route, { items, total: items.length, sort: seeker ? 'match' : 'newest' });
    }
    return json(route, { detail: 'not_found' }, 404);
  });
}

const FILTERED =
  '/search?price_max=8000&rooms_min=3&rooms_max=4&available_by=2027-01-01&listing_type=room&pets=true';

async function shot(page: Page, project: string, state: string) {
  await page.screenshot({ path: `screens/0009i/${state}-${project}.png`, fullPage: true });
}

/** The count line has text once results landed (or the empty message is shown). */
const settled = async (page: Page) => {
  await page.getByText(he.common.loading).waitFor({ state: 'detached' });
};

test('list-visitor', async ({ page }, info) => {
  await mockApi(page, { seeker: false, search: 'items' });
  await page.goto('/search');
  await page.getByRole('article').first().waitFor();
  await shot(page, info.project.name, 'list-visitor');
});

test('list-seeker', async ({ page }, info) => {
  await mockApi(page, { seeker: true, search: 'items' });
  await page.goto('/search');
  await page.getByTestId('match-badge').first().waitFor();
  await page.getByText(he.rooms.card.similarAge).first().waitFor();
  await shot(page, info.project.name, 'list-seeker');
});

test('filters-active', async ({ page }, info) => {
  await mockApi(page, { seeker: false, search: 'items' });
  await page.goto(FILTERED);
  await page.getByRole('article').first().waitFor();
  // On the phone the panel is opened; on the desktop it is always open.
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: /^מסננים/ }).click();
  }
  await shot(page, info.project.name, 'filters-active');
});

test('empty', async ({ page }, info) => {
  await mockApi(page, { seeker: false, search: 'empty' });
  await page.goto('/search?price_max=1000&pets=true');
  await page.getByText(he.search.empty).waitFor();
  await shot(page, info.project.name, 'empty');
});

test('loading', async ({ page }, info) => {
  await mockApi(page, { seeker: false, search: 'never' });
  await page.goto('/search');
  await page.getByText(he.common.loading).waitFor({ state: 'attached' });
  await shot(page, info.project.name, 'loading');
});

test('error', async ({ page }, info) => {
  await mockApi(page, { seeker: false, search: 'error' });
  await page.goto('/search');
  await settled(page);
  await page.getByRole('button', { name: he.common.retry }).waitFor();
  await shot(page, info.project.name, 'error');
});

async function shot0009v(page: Page, project: string, state: string) {
  await page.screenshot({ path: `screens/0009v/${state}-${project}.png`, fullPage: true });
}

async function shot0009w(page: Page, project: string, state: string) {
  await page.screenshot({ path: `screens/0009w/${state}-${project}.png`, fullPage: true });
}

/** The map has stopped: no answer pending and the URL (its `c` / `z`) unchanged for a moment, so
 * the first-open fit and the pin's keep-visible pan are done. */
async function mapSettled(page: Page) {
  let url = '';
  for (let i = 0; i < 20 && url !== page.url(); i += 1) {
    url = page.url();
    await page.waitForTimeout(500);
    await mapReady(page);
  }
}

/** Presses the pin named `name` and waits for its card docked in the map. */
async function openCard(page: Page, name: RegExp) {
  await mapReady(page);
  await mapSettled(page);
  await page.getByRole('button', { name }).click();
  await page.locator('[data-map-card]').getByRole('article').waitFor();
  await mapSettled(page);
}

test('map', async ({ page }, info) => {
  // A visitor's card, docked in the map (spec 0009w): no badge, the close button at its top end.
  await mockApi(page, { seeker: false, search: 'items', map: 'spread' });
  await page.goto('/search?view=map');
  await openCard(page, /כצנלסון/);
  await shot0009w(page, info.project.name, 'map');
});

test('map-card-match', async ({ page }, info) => {
  // A seeker's card: the match badge in the price row clears the close button.
  await mockApi(page, { seeker: true, search: 'items', map: 'spread' });
  await page.goto('/search?view=map');
  await openCard(page, /כצנלסון/);
  await page.locator('[data-map-card]').getByTestId('match-badge').waitFor();
  await shot0009w(page, info.project.name, 'map-card-match');
});

/** The map has loaded and its answer landed. */
async function mapReady(page: Page) {
  const region = page.getByRole('region', { name: he.search.map.label });
  await region.waitFor();
  await page.waitForFunction(
    (label) =>
      document
        .querySelector(`[role="region"][aria-label="${label}"]`)
        ?.getAttribute('aria-busy') === 'false',
    he.search.map.label,
  );
}

test('map-tiers', async ({ page }, info) => {
  // A seeker: tiers high (87, 82), good (64) and partial (58); listing 2 liked, 3 applied, 1 seen.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'rent-app:seen',
      JSON.stringify(['00000000-0000-0000-0000-000000000001']),
    );
  });
  await mockApi(page, { seeker: true, search: 'items', map: 'spread' });
  await page.goto('/search?view=map');
  await mapReady(page);
  await page.locator('[data-pin-id] svg[data-mark="liked"]').waitFor();
  await page.locator('[data-pin-id] svg[data-mark="applied"]').waitFor();
  await shot0009v(page, info.project.name, 'map-tiers');
});

test('map-bubble', async ({ page }, info) => {
  // Two listings ~50 m apart fold into a bubble of 2 (it zooms in when pressed).
  await mockApi(page, { seeker: true, search: 'items', map: 'bubble' });
  await page.goto('/search?view=map');
  await mapReady(page);
  await page.getByRole('button', { name: he.search.map.bubble_two }).waitFor();
  await shot0009v(page, info.project.name, 'map-bubble');
});

test('map-same-place', async ({ page }, info) => {
  // Two listings at one point: their bubble lists both cards in the map's panel (spec 0009w).
  await mockApi(page, { seeker: true, search: 'items', map: 'samePlace' });
  await page.goto('/search?view=map');
  await mapReady(page);
  await mapSettled(page);
  await page.getByRole('button', { name: he.search.map.bubbleSamePlace_two }).click();
  await page
    .locator('[data-map-card]')
    .getByRole('heading', { name: he.search.map.samePlace_two })
    .waitFor();
  await shot0009w(page, info.project.name, 'map-same-place');
});
