import { expect } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { postListing, signUpApi, TEL_AVIV, telAvivId } from './helpers';
import { test } from './fixtures';

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

// The phone layout (spec 0009i AC7): the filters toggle this test clicks exists below 1024px only.
test.use({ viewport: { width: 390, height: 844 } });

test('ac9_visitor_searches_and_opens_listing', async ({ page }) => {
  const street = `e2e ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // Minted on its own: it neither contains nor is contained in `street` (cards are found by
  // substring), spec 0007f AC12.
  const roomStreet = `חדר ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // A fresh owner, signed up through the API (the UI signup is auth.spec.ts's).
  await signUpApi(page, 'owner');

  // One listing, posted through the API with the owner's session.
  const areaId = await telAvivId(page);
  const created = await page.request.post(API + '/listings', {
    data: {
      listing_type: 'apartment',
      area_id: areaId,
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
      shelter: 'none', // required since 0015b
      arnona_ils: null,
      vaad_ils: null,
      description: null,
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  // And a women-only room with two flatmates, their ages and two answers (0007f AC12).
  const roomId = await postListing(page, roomStreet, {
    listing_type: 'room',
    price_ils: 7200,
    gender_preference: 'women',
    flatmates_count: 2,
    flatmate_ages: [27, 30],
    lifestyle: { cleanliness: 3, kosher: 1 },
  });

  // A visitor: no session.
  await page.context().clearCookies();
  await page.goto('/search');
  await expect(page.getByRole('heading', { level: 1, name: he.search.title })).toBeVisible();
  const card = page.getByRole('article').filter({ hasText: street });
  await expect(card).toHaveCount(1);
  await expect(card.getByText(PRICE)).toBeVisible();

  // 0009i AC7: with filters set and the sheet open, nothing overflows the 390px screen (the
  // toolbar of tags, sort and toggle is the risk). The tags are checked first: the open modal makes
  // the page behind it inert.
  await test.step('0009i phone: no horizontal overflow with filters and the sheet open', async () => {
    await page.goto('/search?price_max=8000&rooms_min=3&pets=true');
    await expect(page.getByRole('list', { name: he.search.tags.label })).toBeVisible();
    await page.getByRole('button', { name: /^מסננים/ }).click();
    await expect(page.getByRole('dialog', { name: he.search.filters })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.goto('/search');
    await expect(card).toHaveCount(1);
  });

  // Up to 5,000 ₪: the 7,200 ₪ listing is filtered out.
  await page.getByRole('button', { name: he.search.filters, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: he.search.filters });
  const price = sheet.getByRole('group', { name: he.search.price });
  await price.getByLabel(he.search.to).fill('5000');
  // By its type: the button's words follow the live count.
  await sheet.locator('button[type="submit"]').click();
  await expect(page).toHaveURL('/search?price_max=5000');
  await expect(sheet).toBeHidden();
  // Wait for the filtered results (the count line fills in once they land), then look.
  await expect(page.getByText(he.common.loading)).toHaveCount(0);
  await expect(page.locator('[aria-live="polite"]')).not.toBeEmpty();
  await expect(card).toHaveCount(0);

  // Clear, in the sheet (other listings may still match, so no empty state offers it): it is back.
  await page.getByRole('button', { name: /^מסננים/ }).click();
  await sheet.getByRole('button', { name: he.search.clear }).click();
  await expect(page).toHaveURL('/search');
  await expect(sheet).toBeHidden();
  await expect(card).toHaveCount(1);

  // Its title opens the public listing page, which survives a reload.
  await card.getByRole('link').click();
  await expect(page).toHaveURL(`/listings/${id}`);
  const title = page.getByRole('heading', { level: 1 });
  await expect(title).toContainText(street);
  await page.reload();
  await expect(title).toContainText(street);
  await expect(page.getByText(he.listing.locationHint)).toBeVisible();

  await test.step('ac12 the visitor finds the room in the market and opens it', async () => {
    // A visitor gets no flatmate ages and no lifestyle answers (PRODUCT.md "Rooms", room privacy).
    const twoFlatmates = he.rooms.flatmates_two;
    const roomCard = page.getByRole('article').filter({ hasText: roomStreet });
    // Spec 0010a: the apartments' search has no rooms; the market (no type filter) has them.
    await page.goto('/search');
    await expect(card).toHaveCount(1);
    await expect(roomCard).toHaveCount(0);
    await page.goto('/market');
    await expect(page.getByRole('heading', { level: 1, name: he.market.title })).toBeVisible();
    await expect(roomCard).toHaveCount(1);
    await expect(card).toHaveCount(0);
    await expect(roomCard.getByText(he.listings.card.room, { exact: true })).toBeVisible();
    await expect(roomCard.getByText(twoFlatmates, { exact: true })).toBeVisible();
    await expect(
      roomCard.getByText(
        he.rooms.card.forGender.replace('{{who}}', he.rooms.genderPreference.women),
        { exact: true },
      ),
    ).toBeVisible();
    await expect(roomCard).not.toContainText('27, 30');

    // The room's page: its facts, and nothing private.
    await roomCard.getByRole('link').click();
    await expect(page).toHaveURL(`/listings/${roomId}`);
    const facts = page.getByRole('region', { name: he.rooms.facts.title });
    await expect(facts).toBeVisible();
    await expect(facts).toContainText(he.rooms.facts.gender);
    await expect(facts).toContainText(he.rooms.facts.flatmates);
    await expect(page.getByText(he.lifestyle.title.flat)).toHaveCount(0);
    await expect(page.getByText('27, 30')).toHaveCount(0);
  });

  await test.step('0009i desktop: filters panel beside a grid of row cards', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/search');
    await expect(card).toHaveCount(1);
    const panel = page.getByRole('region', { name: he.search.filters });
    await expect(panel).toBeVisible();
    // No toggle button on a desktop.
    await expect(page.getByRole('button', { name: he.search.filters, exact: true })).toHaveCount(0);
    await expect(card).toHaveAttribute('data-layout', 'row');
    // RTL: the panel is at the inline start, to the right of the card, with no overlap.
    const panelBox = await panel.boundingBox();
    const cardBox = await card.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect((panelBox?.x ?? 0) >= (cardBox?.x ?? 0) + (cardBox?.width ?? 0) - 1).toBe(true);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await panel.getByRole('group', { name: he.search.price }).getByLabel(he.search.to).fill('5000');
    await panel.locator('button[type="submit"]').click();
    await expect(page).toHaveURL('/search?price_max=5000');
    await expect(page.getByText(he.common.loading)).toHaveCount(0);
    await expect(page.locator('[aria-live="polite"]')).not.toBeEmpty();
    await expect(card).toHaveCount(0);
    await panel.getByRole('button', { name: he.search.clear }).click();
    await expect(page).toHaveURL('/search');
    await expect(card).toHaveCount(1);
  });

  await test.step('0009j desktop: the room page keeps its privacy in the two-column layout', async () => {
    // The viewport is still 1440x900 from the step above. The same visitor, no sign-up.
    await page.goto(`/listings/${roomId}`);
    await expect(page.getByTestId('room-facts')).toBeVisible();
    await expect(page.getByText('27, 30')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: he.lifestyle.title.flat })).toHaveCount(0);
  });

  // 0009j AC6, as the same visitor (no sign-up; kept out of applications.spec.ts's long ac9): a
  // visitor's apply region holds the count and the log-in prompt, and the phone bar is offered.
  await test.step('0009j the listing page on a desktop and a phone', async () => {
    // A room: the section and the bar read "I'm interested" (spec 0010l).
    const apply = page.getByRole('region', { name: he.applications.room.cta });
    const bar = page.getByTestId('apply-bar');
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

    // A desktop (still 1440x900, on the room's page): the action column is beside the title (left
    // of it, in RTL), and stays in view.
    await expect(apply.getByRole('link', { name: he.header.login })).toBeVisible();
    const h1 = await page.getByRole('heading', { level: 1 }).boundingBox();
    const beside = await apply.boundingBox();
    expect(h1).not.toBeNull();
    expect(beside).not.toBeNull();
    expect((beside?.x ?? 0) + (beside?.width ?? 0)).toBeLessThanOrEqual((h1?.x ?? 0) + 1);
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    const sticky = await apply.boundingBox();
    expect(sticky).not.toBeNull();
    expect((sticky?.y ?? 900) < 900 && (sticky?.y ?? 0) + (sticky?.height ?? 0) > 0).toBe(true);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await expect(bar).toHaveCount(0);

    // A phone: the bar jumps to the section and focuses its heading, then goes away.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/listings/${roomId}`);
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: he.applications.room.cta }).click();
    const heading = apply.getByRole('heading', { level: 2, name: he.applications.room.cta });
    await expect(heading).toBeFocused();
    const shown = await apply.boundingBox();
    expect(shown).not.toBeNull();
    expect((shown?.y ?? 844) < 844 && (shown?.y ?? 0) + (shown?.height ?? 0) > 0).toBe(true);
    await expect(bar).toHaveCount(0);
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});

test('ac20_phone_filter_flow', async ({ page }) => {
  // Spec 0023a, at the file's 390 px: a city in the sheet, its count, Apply, then the tag's X.
  await signUpApi(page, 'owner');
  await postListing(
    page,
    `e2e ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  );
  const areaId = await telAvivId(page);
  await page.context().clearCookies();
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const removeArea = he.search.tags.remove.replace('{{name}}', TEL_AVIV);

  await page.goto('/search');
  await page.getByRole('button', { name: he.search.filters, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: he.search.filters });
  await expect(sheet).toBeVisible();
  // It fills the screen, and the close button took focus, so the keyboard stays shut.
  expect((await sheet.boundingBox())?.width).toBe(390);
  await expect(sheet.getByRole('button', { name: he.search.closeFilters })).toBeFocused();

  await sheet.getByRole('combobox', { name: he.search.area }).fill(TEL_AVIV);
  await expect(sheet.getByRole('button', { name: removeArea })).toBeVisible();

  // The count replaces the plain words, and the posted listing means it is not zero.
  const submit = sheet.locator('button[type="submit"]');
  await expect(submit).not.toHaveText(he.search.apply);
  await expect(submit).not.toHaveText(he.search.applyNone);
  expect(await sheet.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await submit.click();
  await expect(page).toHaveURL(`/search?area_ids=${areaId}`);
  await expect(sheet).toBeHidden();
  await expect(page.locator('[aria-live="polite"]')).toBeFocused();
  expect(await overflow()).toBeLessThanOrEqual(0);

  const tags = page.getByRole('list', { name: he.search.tags.label });
  await tags.getByRole('button', { name: removeArea }).click();
  await expect(page).toHaveURL('/search');
  await expect(tags).toHaveCount(0);
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test('ac10_phone_back_closes_only_the_sheet', async ({ page }) => {
  // Gilad 2026-11-18: Back with the sheet open closes it; the applied search stays.
  const areaId = await telAvivId(page);
  const removeLabel = (name: string) => he.search.tags.remove.replace('{{name}}', name);
  const sheet = page.getByRole('dialog', { name: he.search.filters });
  const picker = sheet.getByRole('combobox', { name: he.search.area });
  const openSheet = () => page.getByRole('button', { name: /^מסננים/ }).click();

  await page.goto('/search');
  await openSheet();
  await picker.fill(TEL_AVIV);
  await sheet.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(`/search?area_ids=${areaId}`);
  await expect(sheet).toBeHidden();

  await openSheet();
  await picker.fill('חיפה');
  await expect(sheet.getByRole('button', { name: removeLabel('חיפה') })).toBeVisible();
  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(`/search?area_ids=${areaId}`);
  const tags = page.getByRole('list', { name: he.search.tags.label });
  await expect(tags.getByRole('button', { name: removeLabel(TEL_AVIV) })).toBeVisible();
  await expect(tags.getByRole('button', { name: removeLabel('חיפה') })).toHaveCount(0);

  // The draft is gone, and the X leaves no entry: one Back from here is the unfiltered search.
  await openSheet();
  await expect(sheet.getByRole('button', { name: removeLabel(TEL_AVIV) })).toBeVisible();
  await expect(sheet.getByRole('button', { name: removeLabel('חיפה') })).toHaveCount(0);
  await sheet.getByRole('button', { name: he.search.closeFilters }).click();
  await expect(sheet).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL('/search');
});
