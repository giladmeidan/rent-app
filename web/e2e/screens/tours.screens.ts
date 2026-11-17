// The visual check for the tours page (spec 0018b, AC15): one screenshot per state at each
// project's size, in web/screens/0018b/. Every API request is answered here, so it needs only the
// vite server: no sign-up, no OTP. An unmatched request fails the run.
import { expect, type Page, type Route } from '@playwright/test';

import he from '../../src/locales/he.json' with { type: 'json' };
import type { TourAgendaItemOut } from '../../src/features/tours/api';
import { API } from '../helpers';
import { AGENDA, LISTER_ROWS, OWNER } from './fixtures-tours';
import { WEB_ORIGIN } from './origin';
import { test } from '../fixtures';

type Setup = {
  /** What `GET /tours` answers; `'error'` answers 500. */
  agenda: TourAgendaItemOut[] | 'error';
  /** The answer to every POST /tours/{id}/cancel. */
  cancel?: { status: number; body: unknown };
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
  const { agenda, cancel = { status: 200, body: {} } } = setup;
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const key = `${request.method()} ${pathname}`;
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...CORS,
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'content-type',
        },
      });
    }
    if (pathname === '/me/events') return route.abort();
    if (key === 'GET /me') return reply(route, OWNER);
    if (key === 'GET /me/conversations') return reply(route, []);
    if (key === 'GET /tours') {
      return agenda === 'error' ? reply(route, { detail: 'boom' }, 500) : reply(route, agenda);
    }
    if (/^POST \/tours\/[^/]+\/cancel$/.test(key)) return reply(route, cancel.body, cancel.status);
    unmatched.push(key);
    return route.fulfill({ status: 500, headers: CORS, body: `unmatched ${key}` });
  });
  return unmatched;
}

type State = {
  name: string;
  /** A modal is open: the shot is the viewport, not the full page. */
  modal?: boolean;
  setup: Setup;
  /** What to wait for, and do, before the shot. */
  act: (page: Page) => Promise<void>;
};

const t = he.tours;

const STATES: State[] = [
  {
    // Both sections, with today, tomorrow and a later day.
    name: 'agenda',
    setup: { agenda: AGENDA },
    act: async (page) => {
      await expect(page.getByRole('heading', { level: 2, name: t.sections.lister })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: t.sections.seeker })).toBeVisible();
      await expect(page.getByRole('heading', { level: 3, name: t.day.today })).toBeVisible();
      await expect(page.getByRole('heading', { level: 3, name: t.day.tomorrow })).toBeVisible();
    },
  },
  {
    name: 'lister-only',
    setup: { agenda: LISTER_ROWS },
    act: async (page) => {
      await expect(page.getByRole('heading', { level: 2, name: t.sections.lister })).toBeVisible();
      await expect(page.getByRole('heading', { name: t.sections.seeker })).toHaveCount(0);
    },
  },
  {
    name: 'empty',
    setup: { agenda: [] },
    act: async (page) => {
      await expect(page.getByText(t.empty.title)).toBeVisible();
    },
  },
  {
    name: 'cancel-dialog',
    modal: true,
    setup: { agenda: AGENDA },
    act: async (page) => {
      await page.getByRole('button', { name: t.row.cancel }).first().click();
      await expect(page.getByRole('dialog', { name: t.cancel.title })).toBeVisible();
    },
  },
  {
    name: 'error',
    setup: { agenda: 'error' },
    act: async (page) => {
      await expect(page.getByRole('button', { name: he.common.retry })).toBeVisible();
    },
  },
];

for (const state of STATES) {
  test(state.name, async ({ page }, testInfo) => {
    const unmatched = await mockApi(page, state.setup);
    await page.goto('/tours');
    await state.act(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      fullPage: state.modal !== true,
      animations: 'disabled',
      path: `screens/0018b/${state.name}-${testInfo.project.name}.png`,
    });
    expect(unmatched, 'unmatched API requests').toEqual([]);
  });
}
