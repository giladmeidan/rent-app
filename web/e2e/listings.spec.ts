import { expect, type Locator } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { expectNoAxeViolations } from './a11y';
import { latestCode, signUpOwner, uniqueEmail } from './helpers';
import { test } from './fixtures';

// `localhost`, not 127.0.0.1, so the session cookie set for the web's site is sent with
// `page.request`. `make e2e` exports API_PORT.
const API = 'http://localhost:' + (process.env.API_PORT ?? '8000');

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
  await expect(page).toHaveURL('/me/listings');
  await expect(header.getByRole('link', { name: he.header.myListings })).toBeVisible();

  // The wizard.
  await page.goto('/listings/new');
  await expect(page.getByRole('heading', { level: 1, name: he.listings.new.title })).toBeVisible();
  await expectNoAxeViolations(page, 'wizard step 1');
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

  // Preferences (0006e): no smokers.
  await expect(
    page.getByRole('heading', { level: 2, name: he.listings.prefs.title }),
  ).toBeVisible();
  await page.getByRole('switch', { name: he.listings.prefs.noSmokers }).check();
  await page.getByRole('button', { name: he.listings.next }).click();

  await expect(page.getByText(he.listings.preview.hint)).toBeVisible();
  const published = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/listings' &&
      response.status() === 201,
  );
  // A double click publishes once (the second click lands before the button re-renders disabled).
  await page.getByRole('button', { name: he.listings.publish }).dblclick();
  const { id } = (await (await published).json()) as { id: string };

  // My listings.
  await expect(page).toHaveURL('/me/listings');
  const card = page.getByRole('article');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('כצנלסון');
  await expect(card.getByText(/7,200\s*₪/)).toBeVisible();
  await expect(card.getByTestId('status-badge')).toHaveText(he.listings.status.live);
  await expectNoAxeViolations(page, '/me/listings');

  // The public page shows the preference (before pausing: a paused listing is a 404 there).
  await page.goto('/listings/' + id);
  await expect(page.getByRole('region', { name: he.listing.ownerLooksFor.title })).toContainText(
    he.listing.ownerLooksFor.noSmokers,
  );
  await page.goto('/me/listings');
  await expect(card).toHaveCount(1);

  await card.getByRole('button', { name: he.listings.actions.pause }).click();
  await expect(card.getByTestId('status-badge')).toHaveText(he.listings.status.paused);
  await expect(card.getByRole('button', { name: he.listings.actions.resume })).toBeVisible();
  await expect(header.getByRole('link', { name: he.header.myListings })).toBeVisible();
});

test('ac12_owner_edits_listing', async ({ page }) => {
  // Two viewport steps and a reload on top of the edit and the room flow (FOLLOWUPS: e2e under load).
  test.slow();
  const f = he.listings.fields;
  const street = `e2e ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await signUpOwner(page);

  // One listing with arnona, posted through the API with the owner's session (as search.spec.ts).
  const areas = await page.request.get(API + '/areas');
  expect(areas.ok()).toBe(true);
  const [area] = (await areas.json()) as { id: string }[];
  expect(area).toBeDefined();
  const created = await page.request.post(API + '/listings', {
    data: {
      listing_type: 'apartment',
      area_id: area?.id,
      city: '\u05d2\u05d1\u05e2\u05ea\u05d9\u05d9\u05dd',
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
      arnona_ils: 480,
      vaad_ils: null,
      description: null,
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  // My listings → edit.
  await page.goto('/me/listings');
  let card = page.getByRole('article').filter({ hasText: street });
  await expect(card).toHaveCount(1);
  await card.getByRole('link', { name: he.listings.actions.edit }).click();
  await expect(page).toHaveURL(`/me/listings/${id}/edit`);
  await expect(page.getByRole('heading', { level: 1, name: he.listings.edit.title })).toBeVisible();
  await expect(page.getByLabel(f.area)).toBeEnabled();
  await expect(page.getByLabel(f.arnona, { exact: true })).toHaveValue('480');

  // Price 7500, arnona cleared, preview, save.
  await page.getByLabel(f.price).fill('7500');
  await page.getByLabel(f.arnona, { exact: true }).fill('');
  await page.getByRole('button', { name: he.listings.next }).click();
  // Preferences untouched: the households array must not join the PATCH body.
  await expect(
    page.getByRole('heading', { level: 2, name: he.listings.prefs.title }),
  ).toBeVisible();
  await page.getByRole('button', { name: he.listings.next }).click();
  await expect(page.getByText(he.listings.preview.hint)).toBeVisible();
  const patch = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().endsWith(`/listings/${id}`),
  );
  await page.getByRole('button', { name: he.listings.save }).click();
  expect((await patch).postDataJSON()).toEqual({ price_ils: 7500, arnona_ils: null });

  // Back on my listings with the new price and the saved line.
  await expect(page).toHaveURL('/me/listings');
  card = page.getByRole('article').filter({ hasText: street });
  await expect(card.getByText(/7,500[\s\u200e\u200f]*\u20aa/)).toBeVisible();
  await expect(card.getByTestId('status-badge')).toHaveText(he.listings.status.live);
  await expect(page.getByText(he.listings.edit.saved)).toBeVisible();

  const mine = await page.request.get(API + '/me/listings');
  expect(mine.ok()).toBe(true);
  const stored = ((await mine.json()) as { id: string; arnona_ils: number | null }[]).find(
    (l) => l.id === id,
  );
  expect(stored?.arnona_ils).toBeNull();

  // Spec 0007e AC10, on the same owner (no new signup: the suite's OTP budget is nearly spent). The
  // owner holds one live listing, so the cap of 3 has room.
  await test.step('ac13 owner creates a room listing', async () => {
    const room = he.listings.room;
    const roomStreet = `${street}r`;
    await page.goto('/listings/new');
    await expect(
      page.getByRole('heading', { level: 1, name: he.listings.new.title }),
    ).toBeVisible();
    await page.getByText(he.listings.type.room, { exact: true }).click();
    await page.getByRole('button', { name: he.listings.next }).click();

    await expect(page.getByLabel(f.area)).toBeEnabled();
    await page.getByLabel(f.city, { exact: true }).fill('גבעתיים');
    await page.getByLabel(f.street, { exact: true }).fill(roomStreet);
    await page.getByLabel(f.rooms).selectOption('4');
    await page.getByLabel(f.floor, { exact: true }).fill('2');
    await page.getByLabel(f.size, { exact: true }).fill('90');
    await page.getByLabel(f.price).fill('3200');
    await page.getByLabel(f.availableFrom).fill(israelDay(30));
    await page.getByRole('button', { name: he.listings.next }).click();

    // Step 3: the room block.
    await expect(
      page.getByRole('heading', { level: 2, name: he.listings.prefs.titleRoom }),
    ).toBeVisible();
    const block = page.getByRole('region', { name: room.title });
    await block
      .getByRole('group', { name: room.genderPreference })
      .getByText(he.rooms.genderPreference.women, { exact: true })
      .click();
    await block.getByLabel(room.flatmatesCount).selectOption('2');
    await block.getByLabel(room.ageOf.replace('{{n}}', '1'), { exact: true }).fill('27');
    await block.getByLabel(room.ageOf.replace('{{n}}', '2'), { exact: true }).fill('30');
    const cleanliness = he.lifestyle.cleanliness;
    await block
      .getByRole('group', { name: cleanliness.question.flat })
      .getByText(cleanliness.answer['3'], { exact: true })
      .click();
    await page.getByRole('button', { name: he.listings.next }).click();

    // The preview, then publish.
    await expect(page.getByText(he.listings.preview.hint)).toBeVisible();
    await expect(page.getByRole('list', { name: room.title })).toContainText(
      he.listings.roomPreview.for.replace('{{who}}', he.rooms.genderPreference.women),
    );
    const published = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/listings' &&
        response.status() === 201,
    );
    await page.getByRole('button', { name: he.listings.publish }).click();
    const { id: roomId } = (await (await published).json()) as { id: string };
    await expect(page).toHaveURL('/me/listings');

    const after = await page.request.get(API + '/me/listings');
    expect(after.ok()).toBe(true);
    const saved = (
      (await after.json()) as {
        id: string;
        gender_preference: string;
        flatmates_count: number | null;
        flatmate_ages: number[];
        lifestyle: Record<string, number>;
      }[]
    ).find((l) => l.id === roomId);
    expect(saved).toMatchObject({
      gender_preference: 'women',
      flatmates_count: 2,
      flatmate_ages: [27, 30],
    });
    expect(saved?.lifestyle).toEqual({ cleanliness: 3 });
  });

  // Spec 0009k AC9, on the same owner (no new signup): the wizard's layout at a desktop and a phone.
  await test.step('0009k wizard at 1440 and 390', async () => {
    const toDetails = async () => {
      await page.goto('/listings/new');
      await page.getByText(he.listings.type.apartment, { exact: true }).click();
      await page.getByRole('button', { name: he.listings.next }).click();
      const heading = page.getByRole('heading', { level: 2, name: he.listings.stepTitle.details });
      await expect(heading).toBeVisible();
      return heading;
    };
    const box = async (locator: Locator) => {
      const found = await locator.boundingBox();
      expect(found).not.toBeNull();
      return found as { x: number; y: number; width: number; height: number };
    };
    const stepper = page.locator('ol').filter({ hasText: he.listings.steps.type }).first();
    const next = page.getByRole('button', { name: he.listings.next });

    // 1440: the stepper is a side card at the inline start (the right, in RTL), beside the form.
    await page.setViewportSize({ width: 1440, height: 900 });
    let heading = await toDetails();
    const side = await box(stepper);
    const title = await box(heading);
    expect(side.x).toBeGreaterThanOrEqual(title.x + title.width - 2);
    expect(title.width).toBeLessThanOrEqual(672);
    await expect(next).toBeInViewport();

    // 390: the stepper sits above the heading, and the sticky bar keeps "next" at the viewport's
    // bottom while step 2 scrolls.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    heading = await toDetails();
    const top = await box(stepper);
    expect(top.y + top.height).toBeLessThanOrEqual((await box(heading)).y);
    await expect(next).toBeInViewport();
    const button = await box(next);
    expect(844 - (button.y + button.height)).toBeLessThanOrEqual(40);
    expect(button.y + button.height).toBeLessThanOrEqual(844);
  });

  // Spec 0009o AC4, on the same owner, who holds the apartment and the room by now.
  await test.step('0009o my listings at 1440 and 390', async () => {
    const articles = page.getByRole('article');
    const boxes = async () => {
      await expect(articles).toHaveCount(2);
      const first = await articles.nth(0).boundingBox();
      const second = await articles.nth(1).boundingBox();
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      return {
        first: first as { x: number; y: number; width: number; height: number },
        second: second as { x: number; y: number; width: number; height: number },
      };
    };

    // 1440: two columns, the cards share a top edge.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/me/listings');
    let { first, second } = await boxes();
    expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(2);
    expect(first.x).not.toBe(second.x);

    // 390: one column, the second card below the first.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    ({ first, second } = await boxes());
    expect(second.y).toBeGreaterThan(first.y + first.height - 1);
  });
});
