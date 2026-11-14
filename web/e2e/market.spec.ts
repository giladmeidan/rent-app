import { expect, type Page } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { expectNoAxeViolations } from './a11y';
import { postListing, signUp } from './helpers';
import { newTileContext, test } from './fixtures';

// Spec 0010a AC14: the two sides. One owner sign-up for the whole test (the OTP budget is per
// shard): the owner's listings are posted first, the visitor part runs with the cookies cleared,
// and the owner's part with them restored.

/** `YYYY-MM-DD`, `days` from today in Israel. */
function israelDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Nothing on the page is loading any more (the header's session check included). */
async function settled(page: Page) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
}

/** axe on the current page at a phone and a desktop width, ending at 1280. */
async function axeAtBothWidths(page: Page, label: string) {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await settled(page);
    await expectNoAxeViolations(page, `${label} at ${String(width)}`);
  }
}

test('ac14_two_sides', async ({ page }) => {
  test.slow();
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // Three streets, none a substring of another (cards are found by substring).
  const flatStreet = `דירה ${run}`;
  const roomStreet = `חדר ${run}`;
  const newRoomStreet = `שותפים ${run}`;

  // The owner and two live listings: an apartment and a room (the wizard adds the third, the cap).
  await signUp(page, 'owner');
  await postListing(page, flatStreet);
  const roomId = await postListing(page, roomStreet, {
    listing_type: 'room',
    gender_preference: 'any',
    flatmates_count: 2,
    flatmate_ages: [],
    lifestyle: {},
  });
  const session = await page.context().cookies();

  // A visitor on the apartments' search: the apartment, not the room.
  await page.context().clearCookies();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/search');
  await expect(page.getByRole('heading', { level: 1, name: he.search.title })).toBeVisible();
  const flatCard = page.getByRole('article').filter({ hasText: flatStreet });
  const roomCard = page.getByRole('article').filter({ hasText: roomStreet });
  await expect(flatCard).toHaveCount(1);
  await expect(roomCard).toHaveCount(0);

  // Through the switch to the market: the room, not the apartment.
  const sides = page.getByRole('banner').getByRole('navigation', { name: he.side.label });
  await sides.getByRole('link', { name: he.side.market, exact: true }).click();
  await expect(page).toHaveURL('/market');
  await expect(page.getByRole('heading', { level: 1, name: he.market.title })).toBeVisible();
  await expect(roomCard).toHaveCount(1);
  await expect(flatCard).toHaveCount(0);
  await expect(sides.getByRole('link', { name: he.side.market, exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await axeAtBothWidths(page, '/market');

  // The room's page; its back link returns to the market.
  await roomCard.getByRole('link').first().click();
  await expect(page).toHaveURL(`/listings/${roomId}`);
  await page.getByRole('link', { name: he.listing.backToMarket }).click();
  await expect(page).toHaveURL('/market');

  // An old rooms link lands in the market.
  await page.goto('/search?listing_type=room');
  await expect(page).toHaveURL('/market');
  await expect(page.getByRole('heading', { level: 1, name: he.market.title })).toBeVisible();

  // The owner: שוק השותפים → שלי → חדר חדש, a room through the 3-step wizard.
  await page.context().addCookies(session);
  await page.goto('/me/listings');
  await expect(page.getByRole('article').filter({ hasText: flatStreet })).toHaveCount(1);
  await expect(page.getByRole('article').filter({ hasText: roomStreet })).toHaveCount(0);
  await sides.getByRole('link', { name: he.side.market, exact: true }).click();
  await expect(page).toHaveURL('/market');
  await page
    .getByRole('navigation', { name: he.nav.label })
    .getByRole('link', { name: he.nav.mine, exact: true })
    .click();
  await expect(page).toHaveURL('/market/mine');
  await expect(
    page.getByRole('heading', { level: 1, name: he.market.mine.title, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: roomStreet })).toHaveCount(1);
  await expect(page.getByRole('article').filter({ hasText: flatStreet })).toHaveCount(0);
  await page.getByRole('link', { name: he.market.mine.newRoom, exact: true }).click();
  await expect(page).toHaveURL('/listings/new?type=room');

  const f = he.listings.fields;
  const next = page.getByRole('button', { name: he.listings.next });
  await expect(
    page.getByRole('heading', { level: 2, name: he.listings.stepTitle.detailsRoom }),
  ).toBeVisible();
  await expect(
    page.getByText(he.listings.stepOf.replace('{{n}}', '1').replace('{{total}}', '4')),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: he.common.back })).toHaveCount(0);
  await expect(page.getByLabel(f.area, { exact: true })).toBeEnabled();
  await page.getByLabel(f.city, { exact: true }).fill('גבעתיים');
  await page.getByLabel(f.street, { exact: true }).fill(newRoomStreet);
  await page.getByLabel(f.rooms).selectOption('4');
  await page.getByLabel(f.floor, { exact: true }).fill('2');
  await page.getByLabel(f.size, { exact: true }).fill('90');
  await page.getByLabel(f.price).fill('3200');
  await page.getByLabel(f.availableFrom).fill(israelDay(30));
  await next.click();
  // The photos step (0010e), skipped.
  await expect(
    page.getByRole('heading', { level: 2, name: he.listings.stepTitle.photosRoom }),
  ).toBeVisible();
  await next.click();
  await expect(
    page.getByRole('heading', { level: 2, name: he.listings.prefs.titleRoom }),
  ).toBeVisible();
  await page
    .getByRole('region', { name: he.listings.room.title })
    .getByLabel(he.listings.room.flatmatesCount)
    .selectOption('2');
  await next.click();
  await expect(page.getByText(he.listings.preview.hint)).toBeVisible();
  await page.getByRole('button', { name: he.listings.publish }).click();

  // Published: the market's "שלי", with the new room.
  await expect(page).toHaveURL('/market/mine');
  await expect(page.getByText(he.listings.mine.published)).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: newRoomStreet })).toHaveCount(1);
  await axeAtBothWidths(page, '/market/mine');
});

// Spec 0010b AC18: the market without roles. Two sign-ups: the market's person (no role question)
// and an owner in a second context.
test('ac18_role_free_market', async ({ page, browser }) => {
  test.slow();
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const street = `שוק ${run}`;

  // A visitor signs up from the market: no role question, back on the market.
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUp(page, 'seeker', { market: true });
  await expect(page.getByRole('heading', { level: 1, name: he.market.title })).toBeVisible();

  // The market's bar: five tabs.
  const bar = page.getByRole('navigation', { name: he.nav.label });
  await expect(bar.getByRole('link')).toHaveText(
    [he.nav.market, he.header.likes, he.nav.mine, he.header.chat, he.nav.profile].map(
      (label) => new RegExp(`^${label}`),
    ),
  );

  // "שלי" → "חדר חדש": a room through the 4-step wizard.
  await bar.getByRole('link', { name: he.nav.mine, exact: true }).click();
  await expect(page).toHaveURL('/market/mine');
  await page.getByRole('link', { name: he.market.mine.newRoom, exact: true }).click();
  await expect(page).toHaveURL('/listings/new?type=room');
  const f = he.listings.fields;
  const next = page.getByRole('button', { name: he.listings.next });
  await expect(
    page.getByText(he.listings.stepOf.replace('{{n}}', '1').replace('{{total}}', '4')),
  ).toBeVisible();
  await expect(page.getByLabel(f.area, { exact: true })).toBeEnabled();
  await page.getByLabel(f.city, { exact: true }).fill('גבעתיים');
  await page.getByLabel(f.street, { exact: true }).fill(street);
  await page.getByLabel(f.rooms).selectOption('4');
  await page.getByLabel(f.floor, { exact: true }).fill('2');
  await page.getByLabel(f.size, { exact: true }).fill('90');
  await page.getByLabel(f.price).fill('3200');
  await page.getByLabel(f.availableFrom).fill(israelDay(30));
  await next.click();
  // The photos step (0010e), skipped.
  await expect(
    page.getByRole('heading', { level: 2, name: he.listings.stepTitle.photosRoom }),
  ).toBeVisible();
  await next.click();
  await page
    .getByRole('region', { name: he.listings.room.title })
    .getByLabel(he.listings.room.flatmatesCount)
    .selectOption('2');
  await next.click();
  await expect(page.getByText(he.listings.preview.hint)).toBeVisible();
  await page.getByRole('button', { name: he.listings.publish }).click();

  // On "שלי", with both panels; axe passes on it.
  await expect(page).toHaveURL('/market/mine');
  await expect(page.getByRole('article').filter({ hasText: street })).toHaveCount(1);
  const tabs = page.getByRole('tablist', { name: he.market.mine.tabs.label });
  await expect(tabs.getByRole('tab')).toHaveText([
    he.market.mine.tabs.listings,
    he.market.mine.tabs.applications,
  ]);
  await axeAtBothWidths(page, '/market/mine');

  // On the market, labelled as theirs; its page has no apply form.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/market');
  const card = page.getByRole('article').filter({ hasText: street });
  await expect(card.getByText(he.listings.card.mineRoom, { exact: true })).toBeVisible();
  await card.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/listings\/[0-9a-f-]+$/);
  const roomUrl = new URL(page.url()).pathname;
  const section = page.getByRole('region', { name: he.applications.headingOwner, exact: true });
  await expect(section.getByText(he.applications.own)).toBeVisible();
  await expect(section.getByRole('button', { name: he.applications.apply })).toHaveCount(0);
  await expect(section.getByRole('textbox')).toHaveCount(0);

  // An owner, in a second context, may apply to the room: the profile gate, not the owner's
  // empty section.
  const ownerContext = await newTileContext(browser);
  const ownerPage = await ownerContext.newPage();
  await signUp(ownerPage, 'owner');
  await ownerPage.goto(roomUrl);
  await expect(ownerPage.getByText(he.applications.profileRequired)).toBeVisible();
  await expect(
    ownerPage.getByRole('region', { name: he.applications.room.cta, exact: true }),
  ).toBeVisible();
  await ownerContext.close();
});
