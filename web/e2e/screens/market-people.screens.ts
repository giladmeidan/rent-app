// The visual check for people browse in שוק השותפים (spec 0010i): one screenshot per state at each
// project's size, in web/screens/0010i/. Every API request is answered here, so it needs only the
// vite server: no sign-up, no OTP. An unmatched request fails the run.
import { expect, type Page, type Route } from '@playwright/test';

import he from '../../src/locales/he.json' with { type: 'json' };
import type { ThreadOut } from '../../src/features/chat/api';
import type { MyPeopleLikesOut, PersonCardOut } from '../../src/features/people/api';
import { API } from '../helpers';
import { listing } from './fixtures-listings';
import { WEB_ORIGIN } from './origin';
import { test } from '../fixtures';

// --- fixtures (obviously fake) ----------------------------------------------------------------------

const ME = {
  id: '00000000-0000-0000-0000-0000000000aa',
  email: 'dana@example.com',
  display_name: 'דנה',
  role: 'seeker',
  account_type: 'standard',
  created_at: '2026-11-10T10:00:00Z',
  photo_url: null,
};
const AREA_A = '00000000-0000-0000-0000-00000000a1a1';
const AREA_B = '00000000-0000-0000-0000-00000000a2a2';
const AREAS = [
  { id: AREA_A, slug: 'givatayim', name_he: 'גבעתיים' },
  { id: AREA_B, slug: 'ramat-gan', name_he: 'רמת גן' },
];
// The viewer's own profile: both parts, the card shown; the cards' answers are compared with it.
const PROFILE = {
  budget_max_ils: 3500,
  move_in_date: '2027-01-01',
  move_in_flexible: true,
  area_ids: [AREA_A],
  household: 'single',
  has_pets: false,
  smoker: false,
  contract_months: 12,
  parking_needed: 0,
  gender: 'woman',
  birth_year: 1997,
  flatmate_gender: 'any',
  lifestyle: { cleanliness: 3, guests: 2, night: 1, shabbat: 2, social: 3, kosher: 1 },
  people_visible: true,
  about_me: 'שקטה ומסודרת',
  updated_at: '2026-11-10T10:00:00Z',
};

const ABOUT_300 =
  'אני עובד בהייטק, יוצא מוקדם וחוזר בערב. אוהב בית שקט ומסודר, מבשל בסופי שבוע ושמח לארח חברים מדי פעם. '
    .repeat(3)
    .slice(0, 300);

const card = (n: number, overrides: Partial<PersonCardOut>): PersonCardOut => ({
  card_id: `00000000-0000-0000-0000-${String(n).padStart(12, 'd')}`,
  display_name: `אדם ${String(n)}`,
  gender: 'woman',
  age: 27,
  area_ids: [AREA_A, AREA_B],
  move_in_date: '2027-01-01',
  move_in_flexible: true,
  lifestyle: { cleanliness: 3, guests: 2 },
  about_me: null,
  photo_url: null,
  liked_by_me: false,
  liked_me: false,
  ...overrides,
});

const C1 = card(1, {
  display_name: 'מיכל אברהם',
  liked_me: true,
  about_me: ABOUT_300,
  lifestyle: { cleanliness: 3, guests: 1, night: 1, shabbat: 3, social: 3, kosher: 1 },
});
const C2 = card(2, {
  display_name: 'נועה לוי',
  liked_by_me: true,
  age: 31,
  area_ids: [AREA_A],
  move_in_flexible: false,
  lifestyle: { cleanliness: 3, guests: 2 },
});
const C3 = card(3, {
  display_name: 'איתי כהן',
  gender: 'man',
  age: null,
  lifestyle: {},
});
const THREE = [C1, C2, C3];

const MATCH_ID = '00000000-0000-0000-0000-00000000cc01';
const LIKES_FILLED: MyPeopleLikesOut = {
  liked_me: [C1],
  mine: [C2],
  matches: [
    {
      conversation_id: MATCH_ID,
      display_name: 'רותם שחר',
      photo_url: null,
      matched_at: '2026-11-12T09:00:00Z',
    },
    {
      conversation_id: '00000000-0000-0000-0000-00000000cc02',
      display_name: 'Sam Cohen',
      photo_url: null,
      matched_at: '2026-11-11T09:00:00Z',
    },
  ],
};
const LIKES_EMPTY: MyPeopleLikesOut = { liked_me: [], mine: [], matches: [] };

const DIRECT: ThreadOut = {
  id: MATCH_ID,
  listing: null,
  other_name: 'רותם שחר',
  other_photo_url: null,
  my_role: 'person',
  members: [
    { name: 'דנה', photo_url: null, role: 'person', is_me: true },
    { name: 'רותם שחר', photo_url: null, role: 'person', is_me: false },
  ],
  visible_from: null,
  can_send: true,
  messages: [
    {
      id: '00000000-0000-0000-0000-00000000ee01',
      body: 'היי, ראיתי שאנחנו מחפשים באותו אזור',
      mine: false,
      sender_name: 'רותם שחר',
      created_at: '2026-11-12T09:05:00Z',
    },
  ],
  truncated: false,
};

// --- the mocked API --------------------------------------------------------------------------------

type Answer = 'pending' | 'error' | { status: number; body: unknown };
type Setup = {
  /** `GET /people`. */
  people?: Answer;
  /** `GET /me/people-likes`. */
  likes?: Answer;
  /** The PUT like's answer. */
  like?: Answer;
  /** `GET /me/listings` (spec 0010m: asked only by the card-required nudge). */
  listings?: Answer;
};

const CORS = {
  'Access-Control-Allow-Origin': WEB_ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
};

const ok = (body: unknown): Answer => ({ status: 200, body });

const reply = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: CORS,
    body: JSON.stringify(body),
  });

function answer(route: Route, a: Answer) {
  // A held request never answers: the page stays on its loading state.
  if (a === 'pending') return new Promise<void>(() => {});
  if (a === 'error') return reply(route, { detail: 'boom' }, 500);
  return reply(route, a.body, a.status);
}

async function mockApi(page: Page, setup: Setup): Promise<string[]> {
  const unmatched: string[] = [];
  const {
    people = ok({ items: [], total: 0 }),
    likes = ok(LIKES_EMPTY),
    like,
    listings = ok([]),
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
    if (key === 'GET /me') return reply(route, ME);
    if (key === 'GET /me/conversations') return reply(route, []);
    if (key === 'GET /me/profile') return reply(route, PROFILE);
    if (key === 'GET /me/flats') return reply(route, []);
    if (key === 'GET /areas') return reply(route, AREAS);
    if (key === 'GET /me/likes') return reply(route, { liked_me: [] });
    if (key === 'GET /me/listings') return answer(route, listings);
    if (key === 'GET /people') return answer(route, people);
    if (key === 'GET /me/people-likes') return answer(route, likes);
    if (/^PUT \/people\/[^/]+\/like$/.test(key) && like !== undefined) return answer(route, like);
    if (key === `GET /conversations/${MATCH_ID}`) return reply(route, DIRECT);
    unmatched.push(key);
    return route.fulfill({ status: 500, headers: CORS, body: `unmatched ${key}` });
  });
  return unmatched;
}

// --- the states ------------------------------------------------------------------------------------

type State = {
  name: string;
  setup: Setup;
  path: string;
  /** What to wait for, and do, before the shot. */
  act: (page: Page) => Promise<void>;
};

const likeButton = (page: Page, index: number) =>
  page
    .getByRole('article')
    .nth(index)
    .getByRole('button', { name: he.market.people.like, exact: true });

const STATES: State[] = [
  {
    name: 'people-list',
    setup: { people: ok({ items: THREE, total: 25 }) },
    path: '/market/people',
    act: async (page) => {
      await expect(page.getByRole('article')).toHaveCount(3);
      await expect(page.getByText(he.market.people.likedMe)).toBeVisible();
      await expect(page.getByTestId('market-person-alike').first()).toBeVisible();
      await expect(page.getByRole('button', { name: he.people.loadMore })).toBeVisible();
    },
  },
  {
    name: 'people-empty',
    setup: { people: ok({ items: [], total: 0 }) },
    path: '/market/people',
    act: async (page) => {
      await expect(page.getByText(he.market.people.empty)).toBeVisible();
    },
  },
  {
    name: 'people-card-required',
    setup: { people: { status: 403, body: { detail: 'card_required' } } },
    path: '/market/people',
    act: async (page) => {
      await expect(page.getByText(he.market.people.cardRequired)).toBeVisible();
      await expect(page.getByRole('link', { name: he.market.people.toProfile })).toBeVisible();
    },
  },
  {
    // One live room: the nudge also points to that room's people page (spec 0010m).
    name: 'people-card-required-room',
    setup: {
      people: { status: 403, body: { detail: 'card_required' } },
      listings: ok([listing({ listing_type: 'room' })]),
    },
    path: '/market/people',
    act: async (page) => {
      await expect(page.getByText(he.market.people.cardRequired)).toBeVisible();
      await expect(page.getByText(he.market.people.roomHint)).toBeVisible();
      await expect(page.getByRole('link', { name: he.market.people.toRoomPeople })).toHaveAttribute(
        'href',
        `/me/listings/${listing().id}/people`,
      );
    },
  },
  {
    name: 'people-rate-limited',
    setup: { people: { status: 429, body: { detail: 'rate_limited' } } },
    path: '/market/people',
    act: async (page) => {
      await expect(page.getByText(he.people.browseRateLimited)).toBeVisible();
    },
  },
  {
    name: 'people-mutual',
    setup: {
      people: ok({ items: THREE, total: 3 }),
      like: ok({ liked: true, conversation_id: MATCH_ID }),
    },
    path: '/market/people',
    act: async (page) => {
      await likeButton(page, 0).click();
      await expect(page.getByRole('link', { name: he.likes.toChat })).toBeVisible();
    },
  },
  {
    name: 'people-like-needs-card',
    setup: {
      people: ok({ items: THREE, total: 3 }),
      like: { status: 403, body: { detail: 'card_required' } },
    },
    path: '/market/people',
    act: async (page) => {
      await likeButton(page, 0).click();
      await expect(page.getByText(he.market.people.likeNeedsCard)).toBeVisible();
    },
  },
  {
    name: 'likes-people-filled',
    setup: { likes: ok(LIKES_FILLED) },
    path: '/me/likes',
    act: async (page) => {
      await expect(page.getByRole('region', { name: he.likes.people.matches })).toBeVisible();
      await expect(page.getByRole('article')).toHaveCount(2);
    },
  },
  {
    name: 'likes-people-empty',
    setup: { likes: ok(LIKES_EMPTY) },
    path: '/me/likes',
    act: async (page) => {
      await expect(page.getByText(he.likes.people.matchesEmpty)).toBeVisible();
    },
  },
  {
    name: 'likes-people-card-required',
    setup: { likes: { status: 403, body: { detail: 'card_required' } } },
    path: '/me/likes',
    act: async (page) => {
      await expect(page.getByText(he.likes.people.cardRequired)).toBeVisible();
    },
  },
  {
    name: 'chat-direct',
    setup: {},
    path: `/chat/${MATCH_ID}`,
    act: async (page) => {
      await expect(page.getByRole('button', { name: he.chat.thread.removeMatch })).toBeVisible();
    },
  },
  {
    name: 'chat-direct-confirm',
    setup: {},
    path: `/chat/${MATCH_ID}`,
    act: async (page) => {
      await page.getByRole('button', { name: he.chat.thread.removeMatch }).click();
      await expect(
        page.getByRole('dialog', { name: he.chat.thread.removeMatchTitle }),
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
      path: `screens/0010i/${state.name}-${testInfo.project.name}.png`,
    });
    expect(unmatched, 'unmatched API requests').toEqual([]);
  });
}
