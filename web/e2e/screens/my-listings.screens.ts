// The visual check for "my listings" (spec 0009o, AC6): one screenshot per state at each project's
// size, in web/screens/0009o/ (a state's `spec` names another folder: 0011a's renewal). Every API
// request is answered here, so it needs only the vite server: no sign-up, no OTP. An unmatched
// request fails the run.
import { expect, type Page, type Route } from '@playwright/test';

import he from '../../src/locales/he.json' with { type: 'json' };
import type { MyListingOut } from '../../src/features/listings/api';
import { API } from '../helpers';
import { daysFromNow, FIVE, OWNER } from './fixtures-my-listings';
import { WEB_ORIGIN } from './origin';
import { test } from '../fixtures';

type Setup = {
  /** What `GET /me/listings` answers; `'pending'` never answers, `'error'` answers 500. */
  mine?: MyListingOut[] | 'pending' | 'error';
  /** The answer to every PATCH /listings/{id}. */
  patch?: { status: number; body: unknown };
  /** The answer to every POST /listings/{id}/renew (spec 0011a). */
  renew?: { status: number; body: unknown };
  /** The router state the page arrives with (as the wizard's navigate would give it). */
  arrive?: { saved?: true; published?: true };
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
    mine = FIVE,
    patch = { status: 200, body: {} },
    renew = { status: 200, body: {} },
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
          'Access-Control-Allow-Methods': 'GET, PATCH, POST',
          'Access-Control-Allow-Headers': 'content-type',
        },
      });
    }
    if (pathname === '/me/events') return route.abort();
    if (key === 'GET /me') return reply(route, OWNER);
    if (key === 'GET /me/conversations') return reply(route, []);
    if (key === 'GET /me/listings') {
      // A held request never answers: the page stays on its loading state.
      if (mine === 'pending') return new Promise<void>(() => {});
      return mine === 'error' ? reply(route, { detail: 'boom' }, 500) : reply(route, mine);
    }
    if (/^PATCH \/listings\/[^/]+$/.test(key)) return reply(route, patch.body, patch.status);
    if (/^POST \/listings\/[^/]+\/renew$/.test(key)) return reply(route, renew.body, renew.status);
    unmatched.push(key);
    return route.fulfill({ status: 500, headers: CORS, body: `unmatched ${key}` });
  });
  if (setup.arrive !== undefined) {
    // What react-router's navigate(…, { state }) leaves in the history entry.
    const entry = { usr: setup.arrive, key: 'screens', idx: 0 };
    await page.addInitScript((value) => {
      window.history.replaceState(value, '');
    }, entry);
  }
  return unmatched;
}

type State = {
  /** The screenshot folder (web/screens/<spec>/); default 0009o. */
  spec?: string;
  name: string;
  setup: Setup;
  /** What to wait for, and do, before the shot. */
  act: (page: Page) => Promise<void>;
};

const STATES: State[] = [
  {
    name: 'loading',
    setup: { mine: 'pending' },
    act: async (page) => {
      await expect(page.getByTestId('skeleton')).toHaveCount(3);
    },
  },
  {
    name: 'error',
    setup: { mine: 'error' },
    act: async (page) => {
      await expect(page.getByRole('button', { name: he.common.retry })).toBeVisible();
    },
  },
  {
    name: 'empty',
    setup: { mine: [] },
    act: async (page) => {
      await expect(page.getByText(he.listings.mine.empty)).toBeVisible();
      await expect(page.getByRole('link', { name: he.listings.mine.new })).toHaveCount(1);
    },
  },
  {
    name: 'five-cards',
    setup: {},
    act: async (page) => {
      // The apartments only (spec 0010a): the rooms are the market's.
      await expect(page.getByRole('article')).toHaveCount(3);
    },
  },
  {
    name: 'saved',
    setup: { arrive: { saved: true } },
    act: async (page) => {
      await expect(page.getByRole('article')).toHaveCount(3);
      await expect(page.getByText(he.listings.edit.saved)).toBeVisible();
    },
  },
  {
    name: 'cap-error',
    setup: { patch: { status: 409, body: { detail: 'listing_cap_reached' } } },
    act: async (page) => {
      await page
        .getByRole('article')
        .nth(1)
        .getByRole('button', { name: he.listings.actions.resume })
        .click();
      await expect(page.getByRole('alert')).toBeVisible();
    },
  },
  {
    name: 'published',
    setup: { mine: [FIVE[0] as MyListingOut], arrive: { published: true } },
    act: async (page) => {
      await expect(page.getByRole('article')).toHaveCount(1);
      await expect(page.getByText(he.listings.mine.published)).toBeVisible();
    },
  },
  {
    spec: '0011a',
    name: 'renewed',
    setup: {
      renew: {
        status: 200,
        body: { ...(FIVE[2] as MyListingOut), status: 'active', expires_at: daysFromNow(90) },
      },
    },
    act: async (page) => {
      // Card 3: the expired apartment.
      await page
        .getByRole('article')
        .nth(2)
        .getByRole('button', { name: he.listings.actions.renew })
        .click();
      await expect(
        page.getByText(he.listings.renew.done.split('{{date}}')[0] as string),
      ).toBeVisible();
    },
  },
];

for (const state of STATES) {
  test(state.name, async ({ page }, testInfo) => {
    const unmatched = await mockApi(page, state.setup);
    await page.goto('/me/listings');
    await state.act(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      fullPage: true,
      animations: 'disabled',
      path: `screens/${state.spec ?? '0009o'}/${state.name}-${testInfo.project.name}.png`,
    });
    expect(unmatched, 'unmatched API requests').toEqual([]);
  });
}
