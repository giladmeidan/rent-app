import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { expectNoAxeViolations } from './a11y';
import { API, postListing, signUpOwner } from './helpers';
import { newTileContext, test } from './fixtures';

/** A small committed JPEG (320x200). */
const PHOTO = fileURLToPath(new URL('./fixtures/photo.jpg', import.meta.url));

/** `YYYY-MM-DD`, `days` from today in Israel. */
function israelDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Spec 0010e AC7 and NF1: a photo chosen in the wizard is uploaded after the publish, and "my
// listings" shows its small WebP copy as the card's cover. One sign-up.
test('ac7_wizard_photo', async ({ page }) => {
  const f = he.listings.fields;
  const ph = he.listings.photos;
  const street = `e2e ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await signUpOwner(page);

  await page.goto('/listings/new?type=apartment');
  await expect(page.getByLabel(f.area, { exact: true })).toBeEnabled();
  await page.getByLabel(f.city, { exact: true }).fill('גבעתיים');
  await page.getByLabel(f.street, { exact: true }).fill(street);
  await page.getByLabel(f.rooms).selectOption('3');
  await page.getByLabel(f.floor, { exact: true }).fill('2');
  await page.getByLabel(f.size, { exact: true }).fill('80');
  await page.getByLabel(f.price).fill('6500');
  await page.getByLabel(f.availableFrom).fill(israelDay(30));
  // The protected space is required (spec 0015b).
  await page
    .getByRole('group', { name: f.shelter })
    .getByText(he.listings.shelter.none, { exact: true })
    .click();
  const next = page.getByRole('button', { name: he.listings.next });
  await next.click();

  // The photos step, empty, then with the photo as its cover; axe on both.
  await expect(
    page.getByRole('heading', { level: 2, name: he.listings.stepTitle.photos }),
  ).toBeVisible();
  await expect(page.getByText(ph.empty)).toBeVisible();
  await expectNoAxeViolations(page, 'wizard photos step (empty)');
  await page.locator('input[type="file"]').setInputFiles(PHOTO);
  const tile = page.getByRole('img', { name: ph.tileAlt.replace('{{n}}', '1') });
  await expect(tile).toBeVisible();
  await expect(page.getByText(ph.cover, { exact: true })).toBeVisible();
  await expect(page.getByText(ph.count.replace('{{count}}', '1'), { exact: true })).toBeVisible();
  await expectNoAxeViolations(page, 'wizard photos step (one photo)');
  await next.click();

  // Preferences untouched, then the preview with the photo as the card's cover.
  await expect(
    page.getByRole('heading', { level: 2, name: he.listings.prefs.title }),
  ).toBeVisible();
  await next.click();
  await expect(page.getByText(he.listings.preview.hint)).toBeVisible();
  await expect(page.getByRole('article').locator('img')).toHaveAttribute('src', /^blob:/);

  // Publish: the POST, then the upload to the new listing.
  const published = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/listings' &&
      response.status() === 201,
  );
  const uploaded = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /^\/listings\/[^/]+\/photos$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: he.listings.publish }).click();
  const { id } = (await (await published).json()) as { id: string };
  const upload = await uploaded;
  expect(new URL(upload.url()).pathname).toBe(`/listings/${id}/photos`);
  expect(upload.status()).toBe(201);
  expect(upload.request().headers()['content-type']).toBe('image/jpeg');

  // "My listings": the card's cover is the small WebP copy, and it loads.
  await expect(page).toHaveURL('/me/listings');
  await expect(page.getByText(he.listings.mine.published)).toBeVisible();
  const card = page.getByRole('article').filter({ hasText: street });
  const cover = card.locator('img');
  await expect(cover).toHaveCount(1);
  await expect(cover).toHaveAttribute('src', /-s\.webp$/);
  await expect
    .poll(() => cover.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)))
    .toBeGreaterThan(0);
  // Every photo uploaded: no "not uploaded" alert.
  await expect(page.getByText(/לא הועלו?/)).toHaveCount(0);
});

// Spec 0010k AC5, NF1: a listing's photo is the large WebP on its public page and the small one on
// its search card; the owner's own photo is set on the profile page and shown there. One sign-up
// (the owner is also the profile-photo user); the visitor is a second context with no session.
test('ac5_gallery_and_profile_photo', async ({ page, browser }) => {
  const street = `e2e ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await signUpOwner(page);
  const id = await postListing(page, street);

  // The upload: the raw JPEG as the body (not multipart).
  const upload = await page.request.post(`${API}/listings/${id}/photos`, {
    data: readFileSync(PHOTO),
    headers: { 'Content-Type': 'image/jpeg' },
  });
  expect(upload.status()).toBe(201);

  const visitor = await newTileContext(browser);
  try {
    const guest = await visitor.newPage();

    // The public listing page: one photo, the large copy, and it loads; no counter, no thumbnails.
    await guest.goto(`/listings/${id}`);
    await expect(guest.getByRole('heading', { level: 1 })).toBeVisible();
    const main = guest.getByRole('article').locator('img');
    await expect(main).toHaveCount(1);
    await expect(main).toHaveAttribute('src', /-l\.webp$/);
    await expect
      .poll(() => main.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)))
      .toBeGreaterThan(0);
    await expectNoAxeViolations(guest, 'listing page with a photo');

    // The search card: the small copy, and it loads.
    await guest.goto('/search');
    const card = guest.getByRole('article').filter({ hasText: street });
    await expect(card).toHaveCount(1);
    const cover = card.locator('img');
    await expect(cover).toHaveCount(1);
    await expect(cover).toHaveAttribute('src', /-s\.webp$/);
    await expect
      .poll(() => cover.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)))
      .toBeGreaterThan(0);
  } finally {
    await visitor.close();
  }

  // The profile: no photo, then the same file through the page.
  await page.goto('/me/profile');
  await expect(page.getByRole('button', { name: he.profile.photo.add })).toBeVisible();
  await expectNoAxeViolations(page, 'profile page without a photo');
  await page.locator('input[type="file"]').setInputFiles(PHOTO);
  await expect(page.getByText(he.profile.photo.saved, { exact: true })).toBeVisible();
  const mine = page.locator('#profile-about img');
  await expect(mine).toHaveCount(1);
  await expect(mine).toHaveAttribute('src', /-s\.webp$/);
  await expect
    .poll(() => mine.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)))
    .toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: he.profile.photo.replace })).toBeVisible();
  await expectNoAxeViolations(page, 'profile page with a photo');

  // It is the account's: still there after a reload.
  await page.reload();
  await expect(page.locator('#profile-about img')).toHaveAttribute('src', /-s\.webp$/);
});
