// The visual check for the room lister's people page (spec 0009p, AC5): one screenshot per state at
// each project's size, in web/screens/0009p/. Every API request is answered here, so it needs only
// the vite server: no sign-up, no OTP. An unmatched request fails the run.
import { expect, type Page, type Route } from '@playwright/test';

import he from '../../src/locales/he.json' with { type: 'json' };
import type { MyListingOut } from '../../src/features/listings/api';
import type { PeoplePageOut, PersonOut } from '../../src/features/people/api';
import { API } from '../helpers';
import { WEB_ORIGIN } from './origin';
import { test } from '../fixtures';

// --- fixtures (obviously fake) ----------------------------------------------------------------------

const OWNER = {
  id: '00000000-0000-0000-0000-0000000000aa',
  email: 'dana@example.com',
  display_name: 'דנה',
  role: 'owner',
  account_type: 'standard',
  created_at: '2026-11-10T10:00:00Z',
};
const AREA_A = '00000000-0000-0000-0000-00000000a1a1';
const AREA_B = '00000000-0000-0000-0000-00000000a2a2';
const AREAS = [
  { id: AREA_A, slug: 'givatayim', name_he: 'גבעתיים' },
  { id: AREA_B, slug: 'ramat-gan', name_he: 'רמת גן' },
];

const ROOM: MyListingOut = {
  id: '00000000-0000-0000-0000-000000000002',
  owner_id: OWNER.id,
  status: 'active',
  listing_type: 'room',
  area_id: AREA_B,
  city: 'רמת גן',
  street: 'ביאליק',
  rooms: 3,
  floor: 2,
  total_floors: 4,
  size_sqm: 95,
  price_ils: 3100,
  available_from: '2027-01-01',
  entry_flexible: false,
  elevator: true,
  parking_spots: 1,
  furnished: 'none',
  pets_allowed: false,
  arnona_ils: null,
  vaad_ils: null,
  description: null,
  accepted_households: ['single', 'couple', 'family', 'roommates'],
  smoking_allowed: true,
  min_contract_months: null,
  gender_preference: 'any',
  flatmates_count: 2,
  flatmate_ages: [27, 30],
  lifestyle: { cleanliness: 1, guests: 2 },
  room_size_sqm: null, // spec 0010f: the flat facts
  private_bathroom: null,
  balcony: null,
  bills_included: null,
  poster: null,
  shelter: null, // spec 0015a: the flat's protected space
  air_conditioning: null, // spec 0014b: the apartment facts
  condition: null,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
  expires_at: '2099-01-01T10:00:00Z',
  photos: [], // spec 0010d
  applicant_count: 0,
  new_applicant_count: 0,
  flatmate_count: 0,
  flatmate_invite_active: false,
  close_reason: null, // spec 0014b: the owner's closure answer
  final_rent_ils: null,
};
const APARTMENT: MyListingOut = {
  ...ROOM,
  id: '00000000-0000-0000-0000-000000000001',
  listing_type: 'apartment',
};

const ABOUT_300 =
  'אני עובדת בהייטק, יוצאת מוקדם וחוזרת בערב. אוהבת בית שקט ומסודר, מבשלת בסופי שבוע ושמחה לארח חברים מדי פעם. '
    .repeat(3)
    .slice(0, 300);

const person = (id: number, overrides: Partial<PersonOut>): PersonOut => ({
  id: `00000000-0000-0000-0000-${String(id).padStart(12, 'c')}`,
  display_name: `מחפשת ${String(id)}`,
  photo_url: null,
  gender: 'woman',
  age: 27,
  area_ids: [AREA_A, AREA_B],
  move_in_date: '2027-01-01',
  move_in_flexible: true,
  lifestyle: { cleanliness: 3, guests: 2 },
  about_me: null,
  match: { score: 88, agrees: ['budget', 'area'], differs: 'pets' },
  liked_by_me: false,
  ...overrides,
});

const P1 = person(1, {
  display_name: 'מיכל אברהם',
  about_me: ABOUT_300,
  match: { score: 91, agrees: ['budget', 'area', 'lifestyle'], differs: null },
});
const P2 = person(2, {
  display_name: 'נועה לוי',
  liked_by_me: true,
  age: 31,
  area_ids: [AREA_A],
  move_in_flexible: false,
  match: { score: 74, agrees: ['budget'], differs: 'move_in' },
});
const P3 = person(3, {
  display_name: 'איתי כהן',
  gender: 'man',
  age: null,
  match: { score: 66, agrees: ['area'], differs: 'pets' },
});
const THREE = [P1, P2, P3];

// --- the mocked API --------------------------------------------------------------------------------

type Mode = 'pending' | 'error' | 'ok';
type Setup = {
  mine?: Mode;
  listings?: MyListingOut[];
  people?: Mode | 404 | 409;
  items?: PersonOut[];
  total?: number;
  // The like's answer: an invite (spec 0010l, the default), or an error.
  like?: 'invite' | 'already_applied' | 'rate_limited';
};

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

async function mockApi(page: Page, setup: Setup): Promise<string[]> {
  const unmatched: string[] = [];
  const {
    mine = 'ok',
    listings = [ROOM, APARTMENT],
    people = 'ok',
    items = [],
    total = items.length,
    like = 'invite',
  } = setup;
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const key = `${request.method()} ${pathname}`;
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...CORS,
          'Access-Control-Allow-Methods': 'GET, PUT, DELETE',
          'Access-Control-Allow-Headers': 'content-type',
        },
      });
    }
    if (pathname === '/me/events') return route.abort();
    if (key === 'GET /me') return reply(route, OWNER);
    if (key === 'GET /me/conversations') return reply(route, []);
    if (key === 'GET /areas') return reply(route, AREAS);
    if (key === 'GET /me/listings') {
      // A held request never answers: the page stays on its loading state.
      if (mine === 'pending') return new Promise<void>(() => {});
      return mine === 'error' ? reply(route, { detail: 'boom' }, 500) : reply(route, listings);
    }
    if (/^GET \/listings\/[^/]+\/people$/.test(key)) {
      if (people === 'pending') return new Promise<void>(() => {});
      if (people === 'error') return reply(route, { detail: 'boom' }, 500);
      if (people === 404) return reply(route, { detail: 'not_found' }, 404);
      if (people === 409) return reply(route, { detail: 'listing_not_live' }, 409);
      const body: PeoplePageOut = { items, total };
      return reply(route, body);
    }
    if (/^PUT \/listings\/[^/]+\/people\/[^/]+\/like$/.test(key)) {
      if (like === 'rate_limited') return reply(route, { detail: 'rate_limited' }, 429);
      if (like === 'already_applied') return reply(route, { detail: 'already_applied' }, 409);
      return reply(route, { liked: true });
    }
    unmatched.push(key);
    return route.fulfill({ status: 500, headers: CORS, body: `unmatched ${key}` });
  });
  return unmatched;
}

// --- the states ------------------------------------------------------------------------------------

const PATH = `/me/listings/${ROOM.id}/people`;
const likeButton = (page: Page, index: number) =>
  page.getByRole('article').nth(index).getByRole('button', { name: he.people.invite, exact: true });

type State = {
  name: string;
  setup: Setup;
  path: string;
  /** What to wait for, and do, before the shot. */
  act: (page: Page) => Promise<void>;
};

const h1 = (page: Page, name: string) =>
  expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

const STATES: State[] = [
  {
    name: 'loading',
    setup: { people: 'pending' },
    path: PATH,
    act: async (page) => {
      await h1(page, he.people.title);
      await expect(page.getByTestId('skeleton')).toHaveCount(3);
    },
  },
  {
    name: 'error',
    setup: { people: 'error' },
    path: PATH,
    act: async (page) => {
      await expect(page.getByRole('button', { name: he.common.retry })).toBeVisible();
    },
  },
  {
    name: 'not-found',
    setup: { people: 404 },
    path: PATH,
    act: async (page) => h1(page, he.people.notFound),
  },
  {
    name: 'not-live',
    setup: { people: 409 },
    path: PATH,
    act: async (page) => h1(page, he.people.notLive),
  },
  {
    name: 'empty',
    setup: { items: [], total: 0 },
    path: PATH,
    act: async (page) => {
      await expect(page.getByText(he.people.empty)).toBeVisible();
    },
  },
  {
    name: 'list',
    setup: { items: THREE, total: 25 },
    path: PATH,
    act: async (page) => {
      await expect(page.getByRole('article')).toHaveCount(3);
      await expect(page.getByRole('button', { name: he.people.loadMore })).toBeVisible();
    },
  },
  {
    name: 'disclosures-open',
    setup: { items: THREE, total: 25 },
    path: PATH,
    act: async (page) => {
      const card = page.getByRole('article').first();
      await card.getByRole('button', { name: he.applicants.why }).click();
      await card.getByRole('button', { name: he.people.moreDetails }).click();
      await expect(card.getByRole('button', { name: he.people.moreDetails })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    },
  },
  {
    name: 'page-alert',
    setup: { items: THREE, total: 3, like: 'already_applied' },
    path: PATH,
    act: async (page) => {
      await likeButton(page, 0).click();
      await expect(page.getByRole('link', { name: he.people.errors.toApplicants })).toBeVisible();
    },
  },
  {
    name: 'inline-error',
    setup: { items: THREE, total: 3, like: 'rate_limited' },
    path: PATH,
    act: async (page) => {
      await likeButton(page, 0).click();
      await expect(
        page.getByRole('alert').filter({ hasText: he.people.errors.inviteRateLimited }),
      ).toBeVisible();
    },
  },
];

for (const state of STATES) {
  test(state.name, async ({ page }, testInfo) => {
    const unmatched = await mockApi(page, state.setup);
    await page.goto(state.path);
    await state.act(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      fullPage: true,
      animations: 'disabled',
      path: `screens/0009p/${state.name}-${testInfo.project.name}.png`,
    });
    expect(unmatched, 'unmatched API requests').toEqual([]);
  });
}
