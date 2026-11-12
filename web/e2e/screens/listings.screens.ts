// The visual check for the listing wizard (spec 0009k, AC11): one screenshot per state at each
// project's size, in web/screens/0009k/. Every API request is answered here, so it needs only the
// vite server: no sign-up, no OTP. An unmatched request fails the run.
import { expect, test, type Page, type Route } from '@playwright/test';

import he from '../../src/locales/he.json' with { type: 'json' };
import type { MyListingOut } from '../../src/features/listings/api';
import { API } from '../helpers';
import { AREA, EXPIRED, LISTING_ID, OWNER, UNKNOWN_ID, listing } from './fixtures-listings';
import { WEB_ORIGIN } from './origin';

type Setup = {
  /** What `GET /me/listings` answers; `'pending'` never answers. */
  mine?: MyListingOut[] | 'pending';
  /** The status of `POST /listings` (201 answers the stored listing). */
  post?: { status: number; body: unknown };
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
  const { mine = [], post = { status: 201, body: listing() } } = setup;
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
          'Access-Control-Allow-Methods': 'GET, POST, PATCH',
          'Access-Control-Allow-Headers': 'content-type',
        },
      });
    }
    if (pathname === '/me/events') return route.abort();
    if (key === 'GET /me') return reply(route, OWNER);
    if (key === 'GET /areas') return reply(route, [AREA]);
    if (key === 'GET /me/conversations') return reply(route, []);
    if (key === 'GET /me/listings') {
      // A held request never answers: the page stays on its loading state.
      if (mine === 'pending') return new Promise<void>(() => {});
      return reply(route, mine);
    }
    if (key === 'POST /listings') return reply(route, post.body, post.status);
    if (/^PATCH \/listings\/[^/]+$/.test(key)) return reply(route, listing());
    unmatched.push(key);
    return route.fulfill({ status: 500, headers: CORS, body: `unmatched ${key}` });
  });
  return unmatched;
}

/** `YYYY-MM-DD`, `days` from today in Israel. */
function israelDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const f = he.listings.fields;
const next = (page: Page) => page.getByRole('button', { name: he.listings.next });
const heading = (page: Page, name: string) => page.getByRole('heading', { level: 2, name });

/** Step 1 → step 2 for `type`, with the areas loaded. */
async function toDetails(page: Page, type: 'apartment' | 'room') {
  await page.goto('/listings/new');
  await page.getByText(he.listings.type[type], { exact: true }).click();
  await next(page).click();
  await expect(page.getByLabel(f.area)).toBeEnabled();
}

/** The required details, with the artboard's values (the price is typed last, so it keeps focus). */
async function fillDetails(page: Page, type: 'apartment' | 'room') {
  await page.getByLabel(f.city, { exact: true }).fill('גבעתיים');
  await page.getByLabel(f.street, { exact: true }).fill('כצנלסון');
  await page.getByLabel(f.rooms).selectOption('4');
  await page.getByLabel(f.floor, { exact: true }).fill('3');
  await page.getByLabel(f.totalFloors).fill('5');
  await page.getByLabel(f.size, { exact: true }).fill('95');
  await page.getByLabel(f.availableFrom).fill(israelDay(30));
  await page.getByRole('switch', { name: f.elevator }).check();
  await page.getByRole('switch', { name: f.pets }).check();
  await page.getByLabel(f.parking).selectOption('1');
  const furnished = type === 'room' ? he.listings.furnishedRoom : he.listings.furnished;
  await page.getByText(furnished.partial, { exact: true }).click();
  await page.getByLabel(f.price).fill('7200');
}

/** Steps 1 and 2 filled in, on step 3. */
async function toPreferences(page: Page, type: 'apartment' | 'room') {
  await toDetails(page, type);
  await fillDetails(page, type);
  await next(page).click();
  await expect(
    heading(page, type === 'room' ? he.listings.prefs.titleRoom : he.listings.prefs.title),
  ).toBeVisible();
}

/** A room's block: women, two flatmates aged 27 and 30, two questions answered. */
async function fillRoomBlock(page: Page) {
  const room = he.listings.room;
  const block = page.getByRole('region', { name: room.title });
  await block
    .getByRole('group', { name: room.genderPreference })
    .getByText(he.rooms.genderPreference.women, { exact: true })
    .click();
  await block.getByLabel(room.flatmatesCount).selectOption('2');
  await block.getByLabel(room.ageOf.replace('{{n}}', '1'), { exact: true }).fill('27');
  await block.getByLabel(room.ageOf.replace('{{n}}', '2'), { exact: true }).fill('30');
  const { cleanliness, guests } = he.lifestyle;
  await block
    .getByRole('group', { name: cleanliness.question.flat })
    .getByText(cleanliness.answer['3'], { exact: true })
    .click();
  await block
    .getByRole('group', { name: guests.question.flat })
    .getByText(guests.answer['2'], { exact: true })
    .click();
}

async function toRoomPreview(page: Page) {
  await toPreferences(page, 'room');
  await fillRoomBlock(page);
  await next(page).click();
  await expect(heading(page, he.listings.stepTitle.preview)).toBeVisible();
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

const EDIT = `/me/listings/${LISTING_ID}/edit`;
const NEW = '/listings/new';
const editOpened = async (page: Page) => {
  await expect(page.getByRole('heading', { level: 1, name: he.listings.edit.title })).toBeVisible();
  await expect(page.getByLabel(f.area)).toBeEnabled();
};

const STATES: State[] = [
  {
    name: '01-type-nothing-chosen',
    setup: {},
    path: NEW,
    act: async (page) => {
      await expect(heading(page, he.listings.stepTitle.type)).toBeVisible();
      await expect(next(page)).toBeDisabled();
    },
  },
  {
    name: '02-type-apartment-chosen',
    setup: {},
    path: NEW,
    act: async (page) => {
      await page.getByText(he.listings.type.apartment, { exact: true }).click();
      await expect(next(page)).toBeEnabled();
    },
  },
  {
    name: '03-details-empty',
    setup: {},
    path: NEW,
    act: async (page) => {
      await toDetails(page, 'apartment');
      await expect(heading(page, he.listings.stepTitle.details)).toBeVisible();
    },
  },
  {
    name: '04-details-errors',
    setup: {},
    path: NEW,
    act: async (page) => {
      await toDetails(page, 'apartment');
      await next(page).click();
      await expect(page.getByRole('alert').first()).toBeVisible();
      await expect(page.getByLabel(f.city, { exact: true })).toBeFocused();
    },
  },
  {
    name: '05-details-filled',
    setup: {},
    path: NEW,
    act: async (page) => {
      await toDetails(page, 'apartment');
      await fillDetails(page, 'apartment');
      // Focused: the bare digits, as typed.
      await expect(page.getByLabel(f.price)).toBeFocused();
      await expect(page.getByLabel(f.price)).toHaveValue('7200');
    },
  },
  {
    name: '06-preferences-apartment',
    setup: {},
    path: NEW,
    act: async (page) => {
      await toPreferences(page, 'apartment');
    },
  },
  {
    name: '07-preferences-room',
    setup: {},
    path: NEW,
    act: async (page) => {
      await toPreferences(page, 'room');
      await fillRoomBlock(page);
    },
  },
  {
    name: '08-preview-apartment',
    setup: {},
    path: NEW,
    act: async (page) => {
      await toPreferences(page, 'apartment');
      await next(page).click();
      await expect(heading(page, he.listings.stepTitle.preview)).toBeVisible();
      await expect(page.getByRole('article')).toBeVisible();
    },
  },
  {
    name: '09-preview-room',
    setup: {},
    path: NEW,
    act: async (page) => {
      await toRoomPreview(page);
      await expect(page.getByRole('list', { name: he.listings.room.title })).toBeVisible();
    },
  },
  {
    name: '10-preview-cap-error',
    setup: { post: { status: 409, body: { detail: 'cap_reached' } } },
    path: NEW,
    act: async (page) => {
      await toPreferences(page, 'apartment');
      await next(page).click();
      await page.getByRole('button', { name: he.listings.publish }).click();
      await expect(page.getByRole('alert')).toBeVisible();
    },
  },
  {
    name: '11-edit-step-2',
    setup: { mine: [listing()] },
    path: EDIT,
    act: editOpened,
  },
  {
    name: '12-edit-leave-dialog',
    setup: { mine: [listing()] },
    path: EDIT,
    act: async (page) => {
      await editOpened(page);
      await page.getByLabel(f.price).fill('7500');
      await page.getByRole('link', { name: he.listings.edit.backToMine }).click();
      await expect(page.getByRole('dialog', { name: he.listings.edit.leaveConfirm })).toBeVisible();
    },
    modal: true,
  },
  {
    name: '13-edit-expired',
    setup: { mine: [EXPIRED] },
    path: EDIT,
    act: async (page) => {
      await expect(
        page.getByRole('heading', { level: 1, name: he.listings.edit.expiredTitle }),
      ).toBeVisible();
      await expect(page.getByText(he.listings.edit.expiredBody)).toBeVisible();
    },
  },
  {
    name: '14-edit-not-found',
    setup: { mine: [listing()] },
    path: `/me/listings/${UNKNOWN_ID}/edit`,
    act: async (page) => {
      await expect(
        page.getByRole('heading', { level: 1, name: he.listings.edit.notFound }),
      ).toBeVisible();
    },
  },
  {
    name: '15-edit-loading',
    setup: { mine: 'pending' },
    path: EDIT,
    act: async (page) => {
      await expect(
        page.getByRole('heading', { level: 1, name: he.listings.edit.title }),
      ).toBeVisible();
      await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
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
      fullPage: state.modal !== true,
      animations: 'disabled',
      path: `screens/0009k/${state.name}-${testInfo.project.name}.png`,
    });
    expect(unmatched, 'unmatched API requests').toEqual([]);
  });
}
