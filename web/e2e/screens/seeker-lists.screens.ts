// The visual check for the seeker's lists (spec 0009qa, AC6): one screenshot per state at each
// project's size, in web/screens/0009qa/. Every API request is answered here, so it needs only the
// vite server: no sign-up, no OTP. An unmatched request fails the run.
import { expect, test, type Page, type Route } from '@playwright/test';

import he from '../../src/locales/he.json' with { type: 'json' };
import type { MyApplicationOut } from '../../src/features/applications/api';
import type { MyLikesOut } from '../../src/features/likes/api';
import { API } from '../helpers';
import { FIVE_APPLICATIONS, LIKED_ME, LIKES, PROFILE, SEEKER } from './fixtures-seeker';
import { WEB_ORIGIN } from './origin';

type Mode = 'pending' | 'error' | 'ok';
type Setup = {
  applications?: Mode;
  applicationList?: MyApplicationOut[];
  withdraw?: 'error' | 'ok';
  likes?: Mode;
  likeLists?: MyLikesOut;
  /** What `PUT /listings/{id}/like` answers. */
  like?: 'mutual' | 'room_section_required';
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
    applications = 'ok',
    applicationList = [],
    withdraw = 'ok',
    likes = 'ok',
    likeLists = { liked_me: [], mine: [] },
    like = 'mutual',
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
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
          'Access-Control-Allow-Headers': 'content-type',
        },
      });
    }
    if (pathname === '/me/events') return route.abort();
    if (key === 'GET /me') return reply(route, SEEKER);
    if (key === 'GET /me/conversations') return reply(route, []);
    if (key === 'GET /me/profile') return reply(route, PROFILE);
    if (key === 'GET /me/applications') {
      // A held request never answers: the page stays on its loading state.
      if (applications === 'pending') return new Promise<void>(() => {});
      return applications === 'error'
        ? reply(route, { detail: 'boom' }, 500)
        : reply(route, applicationList);
    }
    if (/^POST \/me\/applications\/[^/]+\/withdraw$/.test(key)) {
      return reply(route, { detail: 'boom' }, withdraw === 'error' ? 500 : 200);
    }
    if (key === 'GET /me/likes') {
      if (likes === 'pending') return new Promise<void>(() => {});
      return likes === 'error' ? reply(route, { detail: 'boom' }, 500) : reply(route, likeLists);
    }
    if (/^PUT \/listings\/[^/]+\/like$/.test(key)) {
      return like === 'mutual'
        ? reply(route, { liked: true, application_id: FIVE_APPLICATIONS[1]?.id })
        : reply(route, { detail: like }, 409);
    }
    unmatched.push(key);
    return route.fulfill({ status: 500, headers: CORS, body: `unmatched ${key}` });
  });
  return unmatched;
}

type State = {
  name: string;
  setup: Setup;
  path: string;
  /** What to wait for, and do, before the shot. */
  act: (page: Page) => Promise<void>;
};

const APPLICATIONS = '/me/applications';
const LIKES_PATH = '/me/likes';

const STATES: State[] = [
  {
    name: '01-applications-loading',
    setup: { applications: 'pending' },
    path: APPLICATIONS,
    act: async (page) => {
      await expect(
        page.getByRole('heading', { level: 1, name: he.applications.mine.title }),
      ).toBeVisible();
      await expect(page.getByTestId('skeleton')).toHaveCount(3);
    },
  },
  {
    name: '02-applications-error',
    setup: { applications: 'error' },
    path: APPLICATIONS,
    act: async (page) => {
      await expect(page.getByRole('button', { name: he.common.retry })).toBeVisible();
    },
  },
  {
    name: '03-applications-empty',
    setup: { applicationList: [] },
    path: APPLICATIONS,
    act: async (page) => {
      await expect(page.getByText(he.applications.mine.empty)).toBeVisible();
    },
  },
  {
    name: '04-applications-five',
    setup: { applicationList: FIVE_APPLICATIONS },
    path: APPLICATIONS,
    act: async (page) => {
      await expect(page.getByRole('article')).toHaveCount(5);
    },
  },
  {
    name: '05-applications-withdraw-error',
    setup: { applicationList: FIVE_APPLICATIONS, withdraw: 'error' },
    path: APPLICATIONS,
    act: async (page) => {
      await page
        .getByRole('article')
        .first()
        .getByRole('button', { name: he.applications.withdraw })
        .click();
      await expect(page.getByRole('alert')).toBeVisible();
    },
  },
  {
    name: '06-likes-loading',
    setup: { likes: 'pending' },
    path: LIKES_PATH,
    act: async (page) => {
      await expect(page.getByRole('heading', { level: 1, name: he.likes.title })).toBeVisible();
      await expect(page.getByTestId('skeleton')).toHaveCount(3);
    },
  },
  {
    name: '07-likes-error',
    setup: { likes: 'error' },
    path: LIKES_PATH,
    act: async (page) => {
      await expect(page.getByRole('button', { name: he.common.retry })).toBeVisible();
    },
  },
  {
    name: '08-likes-empty',
    setup: { likeLists: { liked_me: [], mine: [] } },
    path: LIKES_PATH,
    act: async (page) => {
      await expect(page.getByText(he.likes.mineEmpty)).toBeVisible();
    },
  },
  {
    name: '09-likes-six',
    setup: { likeLists: LIKES },
    path: LIKES_PATH,
    act: async (page) => {
      await expect(page.getByRole('article')).toHaveCount(6);
      await expect(page.getByTestId('match-badge')).toHaveCount(3);
    },
  },
  {
    name: '10-likes-mutual',
    setup: { likeLists: LIKES },
    path: LIKES_PATH,
    act: async (page) => {
      await page
        .getByRole('article')
        .filter({ hasText: LIKED_ME.listing.street })
        .getByRole('button', { name: he.likes.like })
        .click();
      await expect(page.getByRole('status')).toContainText(he.likes.mutual);
    },
  },
  {
    name: '11-likes-card-error',
    setup: { likeLists: LIKES, like: 'room_section_required' },
    path: LIKES_PATH,
    act: async (page) => {
      await page
        .getByRole('article')
        .filter({ hasText: LIKED_ME.listing.street })
        .getByRole('button', { name: he.likes.like })
        .click();
      await expect(page.getByRole('alert')).toBeVisible();
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
      path: `screens/0009qa/${state.name}-${testInfo.project.name}.png`,
    });
    expect(unmatched, 'unmatched API requests').toEqual([]);
  });
}
