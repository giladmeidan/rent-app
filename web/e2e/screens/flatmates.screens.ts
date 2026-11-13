// The visual check for the flatmates screens (spec 0009qb, AC7): one screenshot per state at each
// project's size, in web/screens/0009qb/. Every API request is answered here, so it needs only the
// vite server: no sign-up, no OTP. An unmatched request fails the run.
import { expect, type Page, type Route } from '@playwright/test';

import he from '../../src/locales/he.json' with { type: 'json' };
import type { FlatmateOut, MyFlatOut } from '../../src/features/flatmates/api';
import type { MyListingOut } from '../../src/features/listings/api';
import { API } from '../helpers';
import {
  OWNER,
  PREVIEW,
  SEEKER,
  THREE_FLATMATES,
  TOKEN,
  TWO_FLATMATES,
  TWO_FLATS,
  room,
} from './fixtures-flatmates';
import { WEB_ORIGIN } from './origin';
import { test } from '../fixtures';

type Mode = 'pending' | 'error' | 'ok';
/** An answer to a POST: held (never answers), or a status and a body. */
type Answer = 'pending' | { status: number; body: unknown };
type Setup = {
  user: 'owner' | 'seeker';
  mine?: Mode;
  listings?: MyListingOut[];
  flatmates?: FlatmateOut[];
  remove?: 'ok' | 'error';
  preview?: Answer;
  join?: Answer;
  flats?: Mode;
  flatList?: MyFlatOut[];
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
const noContent = (route: Route) => route.fulfill({ status: 204, headers: CORS });
const answer = (route: Route, a: Answer) =>
  a === 'pending' ? new Promise<void>(() => {}) : reply(route, a.body, a.status);
const ok = (body: unknown): Answer => ({ status: 200, body });
const fail = (status: number, detail: string): Answer => ({ status, body: { detail } });

async function mockApi(page: Page, setup: Setup): Promise<string[]> {
  const unmatched: string[] = [];
  const {
    user,
    mine = 'ok',
    listings = [room()],
    flatmates = [],
    remove = 'ok',
    preview = ok(PREVIEW),
    join = ok({ listing_id: PREVIEW.listing.id }),
    flats = 'ok',
    flatList = [],
  } = setup;
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
          'Access-Control-Allow-Methods': 'GET, POST, DELETE',
          'Access-Control-Allow-Headers': 'content-type',
        },
      });
    }
    if (pathname === '/me/events') return route.abort();
    if (key === 'GET /me') return reply(route, user === 'owner' ? OWNER : SEEKER);
    if (key === 'GET /me/conversations') return reply(route, []);
    // The seeker's header counts the likes received.
    if (key === 'GET /me/likes') return reply(route, { liked_me: [], mine: [] });
    if (key === 'GET /me/listings') {
      // A held request never answers: the page stays on its loading state.
      if (mine === 'pending') return new Promise<void>(() => {});
      return mine === 'error' ? reply(route, { detail: 'boom' }, 500) : reply(route, listings);
    }
    if (/^GET \/listings\/[^/]+\/flatmates$/.test(key)) return reply(route, flatmates);
    if (/^POST \/listings\/[^/]+\/flatmate-invite$/.test(key)) {
      return reply(route, { token: TOKEN }, 201);
    }
    if (/^DELETE \/listings\/[^/]+\/flatmate-invite$/.test(key)) return noContent(route);
    if (/^DELETE \/listings\/[^/]+\/flatmates\/[^/]+$/.test(key)) {
      return remove === 'error' ? reply(route, { detail: 'boom' }, 500) : noContent(route);
    }
    if (key === 'POST /flatmate-invites/preview') return answer(route, preview);
    if (key === 'POST /flatmate-invites/join') return answer(route, join);
    if (key === 'GET /me/flats') {
      if (flats === 'pending') return new Promise<void>(() => {});
      return flats === 'error' ? reply(route, { detail: 'boom' }, 500) : reply(route, flatList);
    }
    if (/^DELETE \/me\/flats\/[^/]+$/.test(key)) return noContent(route);
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
  /** A modal is fixed to the viewport: a full-page capture would misplace it and its backdrop. */
  modal?: boolean;
};

const FLATMATES = `/me/listings/${room().id}/flatmates`;
const JOIN = `/flatmates/join#${TOKEN}`;
const FLATS = '/me/flats';

const busy = (page: Page) => expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
const removeIn = (page: Page, name: string) =>
  page
    .getByRole('listitem')
    .filter({ hasText: name })
    .getByRole('button', { name: he.flatmates.list.remove });
const joinCta = (page: Page) => page.getByRole('button', { name: he.flatmates.join.cta });

/** The join page after a click on "join" that the API refuses with `text`. */
const joinRefused = (text: string) => async (page: Page) => {
  await joinCta(page).click();
  await expect(page.getByRole('alert')).toHaveText(text);
};

const STATES: State[] = [
  {
    name: '01-flatmates-loading',
    setup: { user: 'owner', mine: 'pending' },
    path: FLATMATES,
    act: async (page) => {
      await expect(page.getByRole('heading', { level: 1, name: he.flatmates.title })).toBeVisible();
      await busy(page);
    },
  },
  {
    name: '02-flatmates-not-found',
    setup: { user: 'owner' },
    path: '/me/listings/00000000-0000-0000-0000-0000000000ff/flatmates',
    act: async (page) => {
      await expect(
        page.getByRole('heading', { level: 1, name: he.flatmates.notFound }),
      ).toBeVisible();
    },
  },
  {
    name: '03-flatmates-empty',
    setup: { user: 'owner', flatmates: [] },
    path: FLATMATES,
    act: async (page) => {
      await expect(page.getByText(he.flatmates.list.empty)).toBeVisible();
      await expect(page.getByRole('button', { name: he.flatmates.invite.create })).toBeVisible();
    },
  },
  {
    name: '04-flatmates-link-created',
    setup: { user: 'owner', flatmates: TWO_FLATMATES },
    path: FLATMATES,
    act: async (page) => {
      await page.getByRole('button', { name: he.flatmates.invite.create }).click();
      await expect(page.getByRole('textbox', { name: he.flatmates.invite.linkLabel })).toHaveValue(
        new RegExp(`#${TOKEN}$`),
      );
      await expect(page.getByRole('listitem')).toHaveCount(2);
    },
  },
  {
    name: '05-flatmates-remove-error',
    setup: {
      user: 'owner',
      listings: [room({ flatmate_invite_active: true, flatmate_count: 3 })],
      flatmates: THREE_FLATMATES,
      remove: 'error',
    },
    path: FLATMATES,
    act: async (page) => {
      await expect(page.getByText(he.flatmates.invite.active)).toBeVisible();
      await removeIn(page, 'Yoni Levi').click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: he.flatmates.list.remove })
        .click();
      await expect(page.getByRole('alert')).toHaveText(he.common.error);
      await expect(page.getByRole('dialog')).toBeHidden();
    },
  },
  {
    name: '06-flatmates-remove-dialog',
    setup: {
      user: 'owner',
      listings: [room({ flatmate_invite_active: true, flatmate_count: 3 })],
      flatmates: THREE_FLATMATES,
    },
    path: FLATMATES,
    act: async (page) => {
      await removeIn(page, 'דנה כהן').click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
    modal: true,
  },
  {
    name: '07-join-loading',
    setup: { user: 'seeker', preview: 'pending' },
    path: JOIN,
    act: async (page) => {
      await expect(
        page.getByRole('heading', { level: 1, name: he.flatmates.join.title }),
      ).toBeVisible();
      await busy(page);
    },
  },
  {
    name: '08-join-preview',
    setup: { user: 'seeker' },
    path: JOIN,
    act: async (page) => {
      await expect(joinCta(page)).toBeVisible();
    },
  },
  {
    name: '09-join-member',
    setup: { user: 'seeker', preview: ok({ ...PREVIEW, member: true }) },
    path: JOIN,
    act: async (page) => {
      await expect(page.getByText(he.flatmates.join.member)).toBeVisible();
    },
  },
  {
    name: '10-join-invalid',
    setup: { user: 'seeker', preview: fail(404, 'not_found') },
    path: JOIN,
    act: async (page) => {
      await expect(page.getByRole('alert')).toHaveText(he.flatmates.join.invalid);
    },
  },
  {
    name: '11-join-own',
    setup: { user: 'seeker', preview: fail(409, 'own_listing') },
    path: JOIN,
    act: async (page) => {
      await expect(page.getByRole('alert')).toHaveText(he.flatmates.join.own);
    },
  },
  {
    name: '12-join-applied',
    setup: { user: 'seeker', join: fail(409, 'already_applied') },
    path: JOIN,
    act: joinRefused(he.flatmates.join.applied),
  },
  {
    name: '13-join-declined',
    setup: { user: 'seeker', join: fail(409, 'declined') },
    path: JOIN,
    act: joinRefused(he.flatmates.join.declined),
  },
  {
    name: '14-join-full',
    setup: { user: 'seeker', join: fail(409, 'flatmates_full') },
    path: JOIN,
    act: joinRefused(he.flatmates.join.full),
  },
  {
    name: '15-join-rate-limited',
    setup: { user: 'seeker', join: fail(429, 'rate_limited') },
    path: JOIN,
    act: async (page) => {
      await joinRefused(he.flatmates.join.rateLimited)(page);
      await expect(joinCta(page)).toBeEnabled();
    },
  },
  {
    name: '16-join-other-error',
    setup: { user: 'seeker', join: fail(500, 'boom') },
    path: JOIN,
    act: async (page) => {
      await joinCta(page).click();
      await expect(page.getByRole('button', { name: he.common.retry })).toBeVisible();
    },
  },
  {
    name: '17-flats-loading',
    setup: { user: 'seeker', flats: 'pending' },
    path: FLATS,
    act: async (page) => {
      await expect(
        page.getByRole('heading', { level: 1, name: he.flatmates.mine.title }),
      ).toBeVisible();
      await busy(page);
    },
  },
  {
    name: '18-flats-empty',
    setup: { user: 'seeker', flatList: [] },
    path: FLATS,
    act: async (page) => {
      await expect(page.getByText(he.flatmates.mine.empty)).toBeVisible();
    },
  },
  {
    name: '19-flats-two',
    setup: { user: 'seeker', flatList: TWO_FLATS },
    path: FLATS,
    act: async (page) => {
      await expect(page.getByRole('listitem')).toHaveCount(2);
    },
  },
  {
    name: '20-flats-leave-dialog',
    setup: { user: 'seeker', flatList: TWO_FLATS },
    path: FLATS,
    act: async (page) => {
      await page
        .getByRole('listitem')
        .first()
        .getByRole('button', { name: he.flatmates.mine.leave })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
    modal: true,
  },
];

for (const state of STATES) {
  test(state.name, async ({ page }, testInfo) => {
    const unmatched = await mockApi(page, state.setup);
    await page.goto(state.path);
    await state.act(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      fullPage: state.modal !== true,
      animations: 'disabled',
      path: `screens/0009qb/${state.name}-${testInfo.project.name}.png`,
    });
    expect(unmatched, 'unmatched API requests').toEqual([]);
  });
}
