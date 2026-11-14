// The visual check of spec 0009j (`make screens`): /listings/:id in six states at 390px and
// 1440px, plus the phone's apartment scrolled halfway with the apply bar showing. Every API
// request is answered here, so it needs only the vite server: no sign-up, no OTP. The apartment
// copies Listing.dc.html. An unmatched request fails the run.
import { expect, type Page, type Route } from '@playwright/test';

import he from '../../src/locales/he.json' with { type: 'json' };
import { API, routeTiles } from '../helpers';
import { PROFILE, SEEKER } from './fixtures-seeker';
import { WEB_ORIGIN } from './origin';
import { test } from '../fixtures';

const CORS = {
  'Access-Control-Allow-Origin': WEB_ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
};

const reply = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: CORS,
    body: JSON.stringify(body),
  });

const APARTMENT_ID = '00000000-0000-4000-8000-0000000000a1';
const ROOM_ID = '00000000-0000-4000-8000-0000000000b2';

/** `GET /listings/{id}`'s body; every field the page reads. */
function detail(overrides: Record<string, unknown>) {
  return {
    id: APARTMENT_ID,
    listing_type: 'apartment',
    city: 'גבעתיים',
    street: 'כצנלסון',
    rooms: 4,
    floor: 3,
    total_floors: 5,
    size_sqm: 95,
    price_ils: 7200,
    available_from: '2027-01-01',
    entry_flexible: false,
    elevator: true,
    parking_spots: 1,
    furnished: 'partial',
    pets_allowed: true,
    arnona_ils: 960,
    vaad_ils: 150,
    description:
      'דירה מוארת ושקטה, קרובה לפארק ולתחבורה ציבורית.\nמטבח מחודש, מרפסת שמש ושתי קומות של שקט.',
    accepted_households: ['single', 'couple'],
    smoking_allowed: false,
    min_contract_months: 12,
    gender_preference: 'any',
    flatmates_count: null,
    flatmate_ages: [],
    lifestyle: {},
    created_at: '2026-11-01T10:00:00Z',
    lat: 32.0707,
    lng: 34.811,
    match: null,
    is_mine: false,
    applicant_count: 3,
    room_fit: null,
    like: null,
    photos: [],
    ...overrides,
  };
}

const APARTMENT = detail({});

const APARTMENT_SEEKER = detail({
  match: { score: 87, agrees: ['budget', 'move_in', 'contract'], differs: 'parking' },
});

/** The room as a signed-in seeker gets it: the ages and the answers (PRODUCT.md "Rooms"). */
const ROOM_SEEKER = detail({
  id: ROOM_ID,
  listing_type: 'room',
  street: 'פלורנטין',
  city: 'תל אביב',
  rooms: 3,
  size_sqm: 14,
  price_ils: 3400,
  arnona_ils: null,
  vaad_ils: null,
  furnished: 'full',
  description: 'חדר מואר בדירה שקטה, עם מרפסת משותפת.',
  accepted_households: ['single', 'couple', 'family', 'roommates'],
  smoking_allowed: true,
  min_contract_months: null,
  gender_preference: 'women',
  flatmates_count: 2,
  flatmate_ages: [27, 30],
  lifestyle: { cleanliness: 3, kosher: 1, night: 2 },
  room_fit: true,
  like: { liked_by_me: false, liked_me: true },
  applicant_count: 0,
});

/** The same room as a visitor gets it: no ages, no answers, no like state. */
const ROOM_VISITOR = {
  ...ROOM_SEEKER,
  flatmate_ages: [],
  lifestyle: {},
  like: null,
  room_fit: null,
};

type Setup = {
  /** The listing `GET /listings/{id}` answers; `null` never answers (the loading state). */
  listing: Record<string, unknown> | null;
  seeker: boolean;
  /** The seeker's applications. */
  applications?: unknown[];
};

async function mockApi(page: Page, { listing, seeker, applications = [] }: Setup) {
  const unmatched: string[] = [];
  await routeTiles(page);
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const key = `${request.method()} ${pathname}`;
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...CORS,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
          'Access-Control-Allow-Headers': 'content-type',
        },
      });
    }
    if (pathname === '/me/events') return route.abort();
    if (key === 'GET /me') {
      return seeker ? reply(route, SEEKER) : reply(route, { detail: 'unauthenticated' }, 401);
    }
    if (key === 'GET /me/conversations') return reply(route, []);
    if (key === 'GET /me/likes') return reply(route, { liked_me: [], mine: [] });
    if (key === 'GET /me/profile') {
      return reply(route, { ...PROFILE, parking_needed: 2, move_in_date: '2027-01-01' });
    }
    if (key === 'GET /me/applications') return reply(route, applications);
    if (key.startsWith('GET /listings/')) {
      // A held request never answers: the page stays on its loading state.
      if (listing === null) return new Promise<void>(() => {});
      return reply(route, listing);
    }
    unmatched.push(key);
    return route.fulfill({ status: 500, headers: CORS, body: `unmatched ${key}` });
  });
  return unmatched;
}

type State = {
  name: string;
  setup: Setup;
  /** What to wait for, and do, before the shot. */
  act: (page: Page) => Promise<void>;
};

const heading = (page: Page) => page.getByRole('heading', { level: 1 });

/** The small map's canvas, then a moment for its tiles. */
const mapReady = async (page: Page) => {
  await page.locator('.maplibregl-canvas').first().waitFor();
  await page.waitForTimeout(600);
};

const SUBMITTED = {
  id: '00000000-0000-4000-8000-0000000000c3',
  status: 'submitted',
  source: 'apply',
  message: 'שלום, אנחנו זוג שקט.',
  created_at: '2026-11-10T10:00:00Z',
  updated_at: '2026-11-10T10:00:00Z',
  listing: {
    id: APARTMENT_ID,
    listing_type: 'apartment',
    city: 'גבעתיים',
    street: 'כצנלסון',
    rooms: 4,
    price_ils: 7200,
  },
};

/** A photo whose two sizes are inline SVGs of one colour (no media request to answer). */
const photo = (n: number, colour: string) => {
  const svg = (w: number, h: number) =>
    `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${String(w)}" height="${String(h)}"><rect width="100%" height="100%" fill="${colour}"/></svg>`,
    )}`;
  return { id: `p${String(n)}`, small_url: svg(480, 300), large_url: svg(1600, 1000) };
};

const STATES: State[] = [
  {
    name: 'apartment-visitor',
    setup: { listing: APARTMENT, seeker: false },
    act: async (page) => {
      await expect(heading(page)).toBeVisible();
      await mapReady(page);
    },
  },
  {
    name: 'apartment-seeker',
    setup: { listing: APARTMENT_SEEKER, seeker: true },
    act: async (page) => {
      await expect(page.getByRole('region', { name: he.match.card.title })).toBeVisible();
      await page
        .getByRole('region', { name: he.applications.heading })
        .getByRole('button', { name: he.applications.apply })
        .click();
      await expect(page.getByLabel(he.applications.form.label)).toBeVisible();
      await mapReady(page);
    },
  },
  {
    name: 'room-seeker',
    setup: { listing: ROOM_SEEKER, seeker: true },
    act: async (page) => {
      await expect(page.getByText(he.likes.likedYouLine)).toBeVisible();
      await expect(page.getByTestId('room-lifestyle')).toBeVisible();
      await mapReady(page);
    },
  },
  {
    name: 'room-visitor',
    setup: { listing: ROOM_VISITOR, seeker: false },
    act: async (page) => {
      await expect(page.getByTestId('room-facts')).toBeVisible();
      await mapReady(page);
    },
  },
  {
    name: 'applied',
    setup: { listing: APARTMENT_SEEKER, seeker: true, applications: [SUBMITTED] },
    act: async (page) => {
      await expect(page.getByRole('link', { name: he.applications.viewMine })).toBeVisible();
      await mapReady(page);
    },
  },
  {
    name: 'gallery-three',
    setup: {
      listing: detail({
        photos: [photo(1, '#D9D2CA'), photo(2, '#C9BFB3'), photo(3, '#B8AC9E')],
      }),
      seeker: false,
    },
    act: async (page) => {
      await expect(heading(page)).toBeVisible();
      await page
        .getByRole('button', {
          name: he.listing.photos.show.replace('{{n}}', '2').replace('{{total}}', '3'),
        })
        .click();
      await expect(page.getByText('2 / 3')).toBeVisible();
      await mapReady(page);
    },
  },
  {
    name: 'gallery-one',
    setup: { listing: detail({ photos: [photo(1, '#D9D2CA')] }), seeker: false },
    act: async (page) => {
      await expect(heading(page)).toBeVisible();
      await mapReady(page);
    },
  },
  {
    name: 'loading',
    setup: { listing: null, seeker: false },
    act: async (page) => {
      await expect(page.getByTestId('skeleton').first()).toBeVisible();
    },
  },
];

for (const state of STATES) {
  test(state.name, async ({ page }, info) => {
    const unmatched = await mockApi(page, state.setup);
    const id = state.setup.listing?.id ?? APARTMENT_ID;
    await page.goto(`/listings/${String(id)}`);
    await state.act(page);
    // A fixed bar would float over the middle of a full-page capture: hide it for that shot.
    const hideBar = await page.addStyleTag({
      content: '[data-testid="apply-bar"] { display: none !important; }',
    });
    await page.screenshot({
      path: `screens/0009j/${state.name}-${info.project.name}.png`,
      fullPage: true,
    });
    await hideBar.evaluate((el) => {
      (el as Element).remove();
    });
    // On the phone the apartment is also shot scrolled down a little, with the apply bar showing
    // (the whole page is short: halfway would already have the action column on screen).
    if (state.name === 'apartment-visitor' && info.project.name === 'mobile') {
      await page.evaluate(() => {
        window.scrollTo(0, 320);
      });
      await expect(page.getByTestId('apply-bar')).toBeVisible();
      await page.screenshot({ path: 'screens/0009j/apartment-visitor-scrolled-mobile.png' });
    }
    expect(unmatched).toEqual([]);
  });
}
