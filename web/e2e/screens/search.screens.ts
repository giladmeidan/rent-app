import { test, type Page, type Route } from '@playwright/test';

import he from '../../src/locales/he.json' with { type: 'json' };
import { routeTiles } from '../helpers';
import { WEB_ORIGIN } from './origin';

// The visual check of spec 0009i (`make screens`): /search in seven states at 390px and 1440px.
// Every API call is mocked, so the data is deterministic and nothing signs up. The four listings
// copy the artboards (Search.dc.html / SearchDesktop.dc.html).

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

/** The artboards' four listings. A visitor gets no match and no flatmate ages (room privacy). */
function listings(seeker: boolean) {
  const match = (m: Match) => (seeker ? m : null);
  return [
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
      lat: 32.0707,
      lng: 34.811,
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
      lat: 32.0565,
      lng: 34.7695,
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
      lat: 32.0824,
      lng: 34.8147,
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
      lat: 32.0505,
      lng: 34.7568,
      match: match({ score: 58, agrees: ['area'], differs: 'move_in' }),
    }),
  ];
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
async function mockApi(page: Page, { seeker, search }: { seeker: boolean; search: Search }) {
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
    if (url.pathname === '/listings') {
      const items = listings(seeker);
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

test('map', async ({ page }, info) => {
  await mockApi(page, { seeker: false, search: 'items' });
  await page.goto('/search?view=map');
  const pin = page.getByRole('button', { name: /כצנלסון/ });
  await pin.waitFor();
  await pin.click();
  await page.getByRole('article').waitFor();
  await shot(page, info.project.name, 'map');
});
