import { expect, test } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { latestCode, uniqueEmail } from './helpers';

/** `YYYY-MM-DD`, `days` from today in Israel. */
function israelDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('ac9_owner_creates_and_pauses_listing', async ({ page }) => {
  const email = uniqueEmail();
  const header = page.getByRole('banner');
  const f = he.listings.fields;

  // Sign up as an owner through the outbox (as 0001b AC7).
  await page.goto('/signup');
  await page.getByText(he.auth.role.owner, { exact: true }).click();
  await page.getByLabel(he.auth.name.label).fill('דנה');
  await page.getByLabel(he.auth.email.label).fill(email);
  await page.getByRole('button', { name: he.auth.sendCode }).click();
  const codeInput = page.getByLabel(he.auth.code.label);
  await expect(codeInput).toBeFocused();
  let code: string | null = null;
  await expect
    .poll(async () => (code = await latestCode(email)), { timeout: 10_000 })
    .toMatch(/^\d{6}$/);
  await codeInput.fill(code ?? '');
  await page.getByRole('button', { name: he.auth.verify }).click();
  await expect(page).toHaveURL('/');
  await expect(header.getByRole('link', { name: he.header.myListings })).toBeVisible();

  // The wizard.
  await page.goto('/listings/new');
  await expect(page.getByRole('heading', { level: 1, name: he.listings.new.title })).toBeVisible();
  await page.getByText(he.listings.type.apartment, { exact: true }).click();
  await page.getByRole('button', { name: he.listings.next }).click();

  await expect(page.getByLabel(f.area)).toBeEnabled();
  await page.getByLabel(f.city, { exact: true }).fill('גבעתיים');
  await page.getByLabel(f.street, { exact: true }).fill('כצנלסון');
  await page.getByLabel(f.rooms).selectOption('3.5');
  await page.getByLabel(f.floor, { exact: true }).fill('3');
  await page.getByLabel(f.totalFloors).fill('5');
  await page.getByLabel(f.size, { exact: true }).fill('95');
  await page.getByLabel(f.price).fill('7200');
  await page.getByLabel(f.availableFrom).fill(israelDay(30));
  await page.getByRole('switch', { name: f.elevator }).check();
  await page.getByLabel(f.parking, { exact: true }).selectOption('1');
  await page.getByText(he.listings.furnished.partial, { exact: true }).click();
  await page.getByRole('switch', { name: f.pets }).check();
  await page.getByLabel(f.description).fill('דירה מוארת');
  await page.getByRole('button', { name: he.listings.next }).click();

  await expect(page.getByText(he.listings.preview.hint)).toBeVisible();
  // A double click publishes once (the second click lands before the button re-renders disabled).
  await page.getByRole('button', { name: he.listings.publish }).dblclick();

  // My listings.
  await expect(page).toHaveURL('/me/listings');
  const card = page.getByRole('article');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('כצנלסון');
  await expect(card.getByText(/7,200\s*₪/)).toBeVisible();
  await expect(card.getByTestId('status-badge')).toHaveText(he.listings.status.live);

  await card.getByRole('button', { name: he.listings.actions.pause }).click();
  await expect(card.getByTestId('status-badge')).toHaveText(he.listings.status.paused);
  await expect(card.getByRole('button', { name: he.listings.actions.resume })).toBeVisible();
  await expect(header.getByRole('link', { name: he.header.myListings })).toBeVisible();
});
