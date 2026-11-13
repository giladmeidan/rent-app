// The visual check for the seeker profile (spec 0009r, AC8): one screenshot per state at each
// project's size, in web/screens/0009r/. Every API request is answered here, so it needs only the
// vite server: no sign-up, no OTP. An unmatched request fails the run.
import { expect, type Page, type Route } from '@playwright/test';

import he from '../../src/locales/he.json' with { type: 'json' };
import type { SeekerProfileOut } from '../../src/features/profile/api';
import { API } from '../helpers';
import { AREAS, PROFILE, PROFILE_ROOM, SEEKER } from './fixtures-profile';
import { WEB_ORIGIN } from './origin';
import { test } from '../fixtures';

type Setup = {
  /** What `GET /me/profile` answers: a stored profile, 404 (a new seeker), 500, or never. */
  profile?: SeekerProfileOut | 'none' | 'error' | 'pending';
  /** What `GET /areas` answers. */
  areas?: typeof AREAS;
  /** What `PUT /me/profile` answers; `'pending'` is held, so the page stays on "saving". */
  put?: 'ok' | 'error' | 'pending';
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
  const { profile = PROFILE, areas = AREAS, put = 'ok' } = setup;
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const key = `${method} ${pathname}`;
    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...CORS,
          'Access-Control-Allow-Methods': 'GET, PUT',
          'Access-Control-Allow-Headers': 'content-type',
        },
      });
    }
    if (pathname === '/me/events') return route.abort();
    if (key === 'GET /me') return reply(route, SEEKER);
    if (key === 'GET /me/conversations') return reply(route, []);
    if (key === 'GET /me/likes') return reply(route, { liked_me: [], mine: [] });
    if (key === 'GET /areas') return reply(route, areas);
    if (key === 'GET /me/profile') {
      // A held request never answers: the page stays on its loading state.
      if (profile === 'pending') return new Promise<void>(() => {});
      if (profile === 'error') return reply(route, { detail: 'boom' }, 500);
      if (profile === 'none') return reply(route, { detail: 'seeker_profile_not_found' }, 404);
      return reply(route, profile);
    }
    if (key === 'PUT /me/profile') {
      if (put === 'pending') return new Promise<void>(() => {});
      if (put === 'error') return reply(route, { detail: 'boom' }, 500);
      return reply(route, request.postDataJSON() as unknown as SeekerProfileOut);
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
  /** Viewport shot (the sticky bar shows in place) instead of the full page. */
  viewport?: boolean;
  /** What to wait for, and do, before the shot. */
  act: (page: Page) => Promise<void>;
};

const PROFILE_PATH = '/me/profile';
const save = (page: Page) => page.getByRole('button', { name: he.profile.save });
const title = (page: Page) => page.getByRole('heading', { level: 1, name: he.profile.title });

const STATES: State[] = [
  {
    name: 'p1-loading',
    setup: { profile: 'pending' },
    path: PROFILE_PATH,
    act: async (page) => {
      await expect(title(page)).toBeVisible();
      await expect(page.getByTestId('skeleton')).toHaveCount(1);
    },
  },
  {
    name: 'p2-load-error',
    setup: { profile: 'error' },
    path: PROFILE_PATH,
    act: async (page) => {
      await expect(page.getByRole('button', { name: he.common.retry })).toBeVisible();
    },
  },
  {
    name: 'p3-new-seeker',
    setup: { profile: 'none' },
    path: PROFILE_PATH,
    act: async (page) => {
      await expect(save(page)).toBeVisible();
    },
  },
  {
    name: 'p4-empty-errors',
    setup: { profile: 'none' },
    path: PROFILE_PATH,
    act: async (page) => {
      await save(page).click();
      await expect(page.getByLabel(he.profile.fields.budget)).toBeFocused();
      await expect(page.getByRole('alert').first()).toBeVisible();
    },
  },
  {
    name: 'p5-filled',
    setup: { profile: PROFILE },
    path: PROFILE_PATH,
    act: async (page) => {
      await expect(page.getByLabel(he.profile.fields.budget)).toHaveValue('7500');
    },
  },
  {
    name: 'p6-room-on',
    setup: { profile: PROFILE_ROOM },
    path: PROFILE_PATH,
    act: async (page) => {
      await expect(page.getByRole('switch', { name: he.profile.about.switch })).toBeChecked();
      await expect(page.getByRole('region', { name: he.lifestyle.title.seeker })).toBeVisible();
    },
  },
  {
    name: 'p7-saved',
    setup: { profile: PROFILE_ROOM },
    path: PROFILE_PATH,
    viewport: true,
    act: async (page) => {
      await save(page).click();
      await expect(page.getByRole('status').filter({ hasText: he.profile.saved })).toBeVisible();
      // The save moved focus to the saved line; the shot is the middle of the page.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    },
  },
  {
    name: 'p8-save-failed',
    setup: { profile: PROFILE, put: 'error' },
    path: PROFILE_PATH,
    viewport: true,
    act: async (page) => {
      await save(page).click();
      await expect(page.getByRole('alert')).toBeVisible();
    },
  },
  {
    name: 'p9-no-areas',
    setup: { profile: 'none', areas: [] },
    path: PROFILE_PATH,
    act: async (page) => {
      await expect(page.getByText(he.areas.empty)).toBeVisible();
    },
  },
  {
    name: 'p10-section-room',
    setup: { profile: 'none' },
    path: `${PROFILE_PATH}?section=about`,
    viewport: true,
    act: async (page) => {
      await expect(
        page.getByRole('heading', { level: 2, name: he.profile.about.title }),
      ).toBeFocused();
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
      fullPage: state.viewport !== true,
      animations: 'disabled',
      path: `screens/0009r/${state.name}-${testInfo.project.name}.png`,
    });
    expect(unmatched, 'unmatched API requests').toEqual([]);
  });
}
