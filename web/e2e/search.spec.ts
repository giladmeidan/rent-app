import { expect, test } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { latestCode, uniqueEmail } from './helpers';

// `localhost`, not 127.0.0.1, so the session cookie set for the web's site is sent with
// `page.request`. `make e2e` exports API_PORT.
const API = 'http://localhost:' + (process.env.API_PORT ?? '8000');
const PRICE = /7,200[\s‎‏]*₪/;

/** `YYYY-MM-DD`, `days` from today in Israel. */
function israelDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('ac9_visitor_searches_and_opens_listing', async ({ page }) => {
  const email = uniqueEmail();
  const street = `e2e ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // A fresh owner, signed up through the outbox (as auth.spec.ts).
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

  // One listing, posted through the API with the owner's session.
  const areas = await page.request.get(API + '/areas');
  expect(areas.ok()).toBe(true);
  const [area] = (await areas.json()) as { id: string }[];
  expect(area).toBeDefined();
  const created = await page.request.post(API + '/listings', {
    data: {
      listing_type: 'apartment',
      area_id: area?.id,
      city: 'גבעתיים',
      street,
      rooms: 3.5,
      floor: 3,
      total_floors: 5,
      size_sqm: 95,
      price_ils: 7200,
      available_from: israelDay(30),
      entry_flexible: false,
      elevator: true,
      parking_spots: 1,
      furnished: 'partial',
      pets_allowed: true,
      arnona_ils: null,
      vaad_ils: null,
      description: null,
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  // A visitor: no session.
  await page.context().clearCookies();
  await page.goto('/search');
  await expect(page.getByRole('heading', { level: 1, name: he.search.title })).toBeVisible();
  const card = page.getByRole('article').filter({ hasText: street });
  await expect(card).toHaveCount(1);
  await expect(card.getByText(PRICE)).toBeVisible();

  // Up to 5,000 ₪: the 7,200 ₪ listing is filtered out.
  await page.getByRole('button', { name: he.search.filters, exact: true }).click();
  const price = page.getByRole('group', { name: he.search.price });
  await price.getByLabel(he.search.to).fill('5000');
  await page.getByRole('button', { name: he.search.apply }).click();
  await expect(page).toHaveURL('/search?price_max=5000');
  // Wait for the filtered results (the count line fills in once they land), then look.
  await expect(page.getByRole('list', { name: he.common.loading })).toHaveCount(0);
  await expect(page.locator('[aria-live="polite"]')).not.toBeEmpty();
  await expect(card).toHaveCount(0);

  // Clear: it is back.
  await page.getByRole('button', { name: he.search.clear }).first().click();
  await expect(page).toHaveURL('/search');
  await expect(card).toHaveCount(1);

  // Its title opens the public listing page, which survives a reload.
  await card.getByRole('link').click();
  await expect(page).toHaveURL(`/listings/${id}`);
  const title = page.getByRole('heading', { level: 1 });
  await expect(title).toContainText(street);
  await page.reload();
  await expect(title).toContainText(street);
  await expect(page.getByText(he.listing.locationHint)).toBeVisible();
});
