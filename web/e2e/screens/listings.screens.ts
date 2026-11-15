// The visual check for the listing wizard (spec 0009k, AC11): one screenshot per state at each
// project's size, in web/screens/0009k/; the photos step's states (spec 0010e) in
// web/screens/0010e/; the rent estimate hint (spec 0014c) in web/screens/0014c/, its small-flat copy (spec 0014d) in web/screens/0014d/. Every API request is answered here, so it needs only the vite server: no
// sign-up, no OTP. An unmatched request fails the run.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, type Page, type Route } from '@playwright/test';

import he from '../../src/locales/he.json' with { type: 'json' };
import type { MyListingOut, RentEstimateOut } from '../../src/features/listings/api';
import { API } from '../helpers';
import { AREA, EXPIRED, LISTING_ID, OWNER, UNKNOWN_ID, listing } from './fixtures-listings';
import { WEB_ORIGIN } from './origin';
import { test } from '../fixtures';

type Setup = {
  /** What `GET /me/listings` answers; `'pending'` never answers. */
  mine?: MyListingOut[] | 'pending';
  /** The status of `POST /listings` (201 answers the stored listing). */
  post?: { status: number; body: unknown };
  /** The statuses of the photo uploads, in order (the last repeats); `'hold'` never answers. */
  uploads?: (number | 'hold')[];
  /** What `GET /rent-estimate` answers (spec 0014c); by default no figures, so no hint. */
  estimate?: RentEstimateOut;
};

/** The committed e2e JPEG: every photo the screens pick, and every `/media` image they show. */
const JPEG = readFileSync(fileURLToPath(new URL('../fixtures/photo.jpg', import.meta.url)));

/** A stored photo's addresses, served by the mock below. */
const photoOut = (n: number) => ({
  id: `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`,
  small_url: `${API}/media/screen-${String(n)}-s.webp`,
  large_url: `${API}/media/screen-${String(n)}-l.webp`,
});

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
    mine = [],
    post = { status: 201, body: listing() },
    uploads = [201],
    estimate = { estimate: null, reason: 'no_figures' },
  } = setup;
  let uploaded = 0;
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
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE',
          'Access-Control-Allow-Headers': 'content-type',
        },
      });
    }
    if (pathname === '/me/events') return route.abort();
    if (key === 'GET /me') return reply(route, OWNER);
    if (key === 'GET /areas') return reply(route, [AREA]);
    if (key === 'GET /me/conversations') return reply(route, []);
    if (key === 'GET /rent-estimate') return reply(route, estimate);
    if (key === 'GET /me/listings') {
      // A held request never answers: the page stays on its loading state.
      if (mine === 'pending') return new Promise<void>(() => {});
      return reply(route, mine);
    }
    if (key === 'POST /listings') return reply(route, post.body, post.status);
    if (/^PATCH \/listings\/[^/]+$/.test(key)) return reply(route, listing());
    if (/^POST \/listings\/[^/]+\/photos$/.test(key)) {
      uploaded += 1;
      const status = uploads[Math.min(uploaded, uploads.length) - 1] ?? 201;
      if (status === 'hold') return new Promise<void>(() => {});
      return status === 201
        ? reply(route, photoOut(uploaded), 201)
        : reply(route, { detail: 'photo_storage_unavailable' }, status);
    }
    if (method === 'GET' && pathname.startsWith('/media/')) {
      return route.fulfill({ status: 200, contentType: 'image/jpeg', headers: CORS, body: JPEG });
    }
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
  await expect(page.getByLabel(f.area, { exact: true })).toBeEnabled();
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
  // The protected space is required (spec 0015b).
  await page
    .getByRole('group', { name: f.shelter })
    .getByText(he.listings.shelter.none, { exact: true })
    .click();
  await page.getByLabel(f.price).fill('7200');
}

/** Steps 1 and 2 filled in, on the photos step (spec 0010e). */
async function toPhotos(page: Page, type: 'apartment' | 'room') {
  await toDetails(page, type);
  await fillDetails(page, type);
  await next(page).click();
  await expect(
    heading(
      page,
      type === 'room' ? he.listings.stepTitle.photosRoom : he.listings.stepTitle.photos,
    ),
  ).toBeVisible();
}

/** `count` copies of the e2e JPEG, picked on the photos step. */
async function pickPhotos(page: Page, count: number) {
  await page.locator('input[type="file"]').setInputFiles(
    Array.from({ length: count }, (_, i) => ({
      name: `photo-${String(i + 1)}.jpg`,
      mimeType: 'image/jpeg',
      buffer: JPEG,
    })),
  );
  await expect(page.locator('li[data-photo] img')).toHaveCount(count);
}

/** Steps 1 and 2 filled in, through the photos (none chosen), on the preferences. */
async function toPreferences(page: Page, type: 'apartment' | 'room') {
  await toPhotos(page, type);
  await next(page).click();
  await expect(
    heading(page, type === 'room' ? he.listings.prefs.titleRoom : he.listings.prefs.title),
  ).toBeVisible();
}

/** A room's block: women, two flatmates aged 27 and 30, a 12 m² room with a private bathroom and
 * bills included, the balcony left unsaid, the lister living there (spec 0010f), two questions
 * answered. */
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
  await block.getByLabel(room.roomSize).fill('12');
  for (const legend of [room.privateBathroom, room.bills]) {
    await block
      .getByRole('group', { name: legend })
      .getByText(he.common.yes, { exact: true })
      .click();
  }
  await block
    .getByRole('group', { name: room.poster.title })
    .getByText(room.poster.lives_here, { exact: true })
    .click();
  await expect(block.getByText(room.poster.livesHereHint)).toBeVisible();
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
  /** The folder under web/screens/ (default the wizard's spec, 0009k). */
  spec?: string;
};

/** Spec 0014b: no horizontal page scroll, and every apartment-fact option inside the amenities card
 * (the condition's five wrap onto a second row on a phone). */
async function expectFactsFit(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal overflow (px)').toBe(0);
  const card = await page
    .getByRole('switch', { name: f.pets })
    .locator('xpath=ancestor::*[contains(@class, "divide-y")][1]')
    .boundingBox();
  expect(card).not.toBeNull();
  const labels = page.getByRole('group', { name: f.condition }).locator('label');
  await expect(labels).toHaveCount(5);
  for (const box of await Promise.all((await labels.all()).map((label) => label.boundingBox()))) {
    expect(box).not.toBeNull();
    if (box === null || card === null) continue;
    expect(box.x).toBeGreaterThanOrEqual(card.x);
    expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
  }
}

const EDIT = `/me/listings/${LISTING_ID}/edit`;
const NEW = '/listings/new';
const editOpened = async (page: Page) => {
  await expect(page.getByRole('heading', { level: 1, name: he.listings.edit.title })).toBeVisible();
  await expect(page.getByLabel(f.area, { exact: true })).toBeEnabled();
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
      await expectFactsFit(page);
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
      await expectFactsFit(page);
    },
  },
  {
    // Spec 0014b: the apartment facts at the narrowest phone width, one condition chosen.
    name: '01-details-facts-360',
    spec: '0014b',
    setup: {},
    path: NEW,
    // The viewport only: a full-page capture would draw the sticky step bar over the facts.
    modal: true,
    act: async (page) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await toDetails(page, 'apartment');
      await page.getByText(he.listings.condition.needsWork, { exact: true }).click();
      await page
        .getByRole('group', { name: f.condition })
        .evaluate((group) => group.scrollIntoView({ block: 'center' }));
      await expectFactsFit(page);
    },
  },
  {
    // Spec 0014c: the official average rent under the price, at neighbourhood level.
    name: '01-details-estimate',
    spec: '0014c',
    setup: {
      estimate: {
        estimate: {
          low_ils: 6500,
          high_ils: 7700,
          confidence: 'high',
          level: 'neighbourhood',
          area_name: 'בורוכוב',
          figure_rooms: [4],
          quarters: 4,
          latest_period: '2026-06-01',
          small_flat_ratio: null,
        },
        reason: null,
      },
    },
    path: NEW,
    act: async (page) => {
      await toDetails(page, 'apartment');
      await fillDetails(page, 'apartment');
      await expect(page.getByText(/nadlan\.gov\.il/)).toBeVisible();
      await expectFactsFit(page);
    },
  },
  {
    // Spec 0014d: a 1–2 room apartment, the 3-room figure scaled by the CBS ratio.
    name: '01-details-estimate-small',
    spec: '0014d',
    setup: {
      estimate: {
        estimate: {
          low_ils: 4550,
          high_ils: 5400,
          confidence: 'medium',
          level: 'neighbourhood',
          area_name: 'בורוכוב',
          figure_rooms: [1, 2],
          quarters: 4,
          latest_period: '2026-06-01',
          small_flat_ratio: 'city',
        },
        reason: null,
      },
    },
    path: NEW,
    act: async (page) => {
      await toDetails(page, 'apartment');
      await fillDetails(page, 'apartment');
      await page.getByLabel(f.rooms).selectOption('2');
      await expect(page.getByText(/הלמ״ס/)).toBeVisible();
      await expectFactsFit(page);
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
  {
    name: '01-photos-empty',
    spec: '0010e',
    setup: {},
    path: NEW,
    act: async (page) => {
      await toPhotos(page, 'apartment');
      await expect(page.getByText(he.listings.photos.empty)).toBeVisible();
    },
  },
  {
    name: '02-photos-some',
    spec: '0010e',
    setup: {},
    path: NEW,
    act: async (page) => {
      await toPhotos(page, 'room');
      await pickPhotos(page, 3);
      await expect(page.getByText(he.listings.photos.cover, { exact: true })).toBeVisible();
    },
  },
  {
    name: '03-photos-full',
    spec: '0010e',
    setup: {},
    path: NEW,
    act: async (page) => {
      await toPhotos(page, 'apartment');
      await pickPhotos(page, 10);
      await expect(page.getByRole('button', { name: he.listings.photos.add })).toHaveCount(0);
      await expect(page.getByText('10 מתוך 10', { exact: true })).toBeFocused();
    },
  },
  {
    name: '04-photos-rejected',
    spec: '0010e',
    setup: {},
    path: NEW,
    act: async (page) => {
      await toPhotos(page, 'apartment');
      await page.locator('input[type="file"]').setInputFiles([
        { name: 'animation.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') },
        { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(9 * 1024 * 1024) },
        { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: JPEG },
      ]);
      await expect(page.getByRole('alert')).toBeVisible();
    },
  },
  {
    name: '05-preview-cover',
    spec: '0010e',
    setup: {},
    path: NEW,
    act: async (page) => {
      await toPhotos(page, 'apartment');
      await pickPhotos(page, 2);
      await next(page).click();
      await next(page).click();
      await expect(heading(page, he.listings.stepTitle.preview)).toBeVisible();
      await expect(page.getByRole('article').locator('img')).toBeVisible();
    },
  },
  {
    name: '06-syncing',
    spec: '0010e',
    setup: { uploads: ['hold'] },
    path: NEW,
    act: async (page) => {
      await toPhotos(page, 'apartment');
      await pickPhotos(page, 2);
      await next(page).click();
      await next(page).click();
      await page.getByRole('button', { name: he.listings.publish }).click();
      await expect(
        page.getByText(
          he.listings.photos.uploading.replace('{{done}}', '1').replace('{{total}}', '2'),
        ),
      ).toBeVisible();
    },
  },
  {
    name: '07-mine-photos-failed',
    spec: '0010e',
    setup: { uploads: [201, 503], mine: [listing({ photos: [photoOut(1)] })] },
    path: NEW,
    act: async (page) => {
      await toPhotos(page, 'apartment');
      await pickPhotos(page, 2);
      await next(page).click();
      await next(page).click();
      await page.getByRole('button', { name: he.listings.publish }).click();
      await expect(page).toHaveURL('/me/listings');
      await expect(page.getByRole('alert')).toHaveText(he.listings.mine.photosFailed_one);
      const cover = page.getByRole('article').locator('img');
      await expect
        .poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBeGreaterThan(0);
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
      path: `screens/${state.spec ?? '0009k'}/${state.name}-${testInfo.project.name}.png`,
    });
    expect(unmatched, 'unmatched API requests').toEqual([]);
  });
}
