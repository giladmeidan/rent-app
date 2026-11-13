import { expect, type Locator, type Page } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { expectNoAxeViolations } from './a11y';
import { API, likePerson, postListing, signUp } from './helpers';
import { newTileContext, test } from './fixtures';

const ROOM = he.profile.room;

/** `YYYY-MM-DD`, `days` from today in Israel (the profile form's calendar). */
function israelDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The card id of the person named `name` on the room's people pages (the owner's session). */
async function findPerson(page: Page, listingId: string, name: string): Promise<string> {
  for (let offset = 0; offset < 1000; offset += 20) {
    const response = await page.request.get(`${API}/listings/${listingId}/people?offset=${offset}`);
    expect(response.ok()).toBe(true);
    const { items } = (await response.json()) as {
      items: { id: string; display_name: string }[];
    };
    const found = items.find((p) => p.display_name === name);
    if (found !== undefined) return found.id;
    if (items.length < 20) break;
  }
  throw new Error(`no person named ${name} on the people pages`);
}

/** A locator's box and the page's layout width (`clientWidth` excludes a scrollbar). */
async function layoutOf(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const { clientWidth, scrollWidth } = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  return { box: box as NonNullable<typeof box>, clientWidth, scrollWidth };
}

test('ac9_seeker_likes_back_and_chats', async ({ page, browser }) => {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const name = `Liker${suffix}`;
  const street = `חדר ${suffix}`;

  // A seeker fills the profile with the room section, shows themselves, and saves.
  await signUp(page, 'seeker', { name });

  // Spec 0009a AC9: at 390x844 the seeker's nav is the bottom tab bar; at 1280x800 it is in the
  // top bar. The viewport is restored for the rest of the test.
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  const banner = page.getByRole('banner');
  const tabBar = page.getByRole('navigation', { name: he.nav.label });
  await expect(tabBar).toBeVisible();
  const tabs = tabBar.getByRole('link');
  await expect(tabs).toHaveCount(5);
  const tops = await Promise.all(
    (await tabs.all()).map(async (tab) => (await tab.boundingBox())?.y ?? -100),
  );
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
  const bar = (await tabBar.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  expect(Math.abs(bar.y + bar.height - 844)).toBeLessThan(1);
  const brand = (await banner
    .getByRole('link', { name: he.app.title, exact: true })
    .boundingBox()) ?? {
    y: 0,
    height: 0,
  };
  const logout = (await banner.getByRole('button', { name: he.header.logout }).boundingBox()) ?? {
    y: 1000,
    height: 0,
  };
  expect(brand.y < logout.y + logout.height && logout.y < brand.y + brand.height).toBe(true);
  const mainPadding = await page
    .locator('main')
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
  expect(mainPadding).toBeGreaterThanOrEqual(bar.height);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  const topNav = banner.getByRole('navigation', { name: he.nav.label });
  await expect(topNav).toBeVisible();
  expect((await topNav.boundingBox())?.y ?? 1000).toBeLessThan(100);
  if (viewport !== null) await page.setViewportSize(viewport);
  await page.goto('/me/profile');
  await expect(page.getByRole('heading', { level: 1, name: he.profile.title })).toBeVisible();
  await page.getByLabel(he.profile.fields.budget).fill('7500');
  await page.getByLabel(he.profile.fields.moveIn).fill(israelDay(30));
  const areas = page.getByRole('group', { name: he.profile.fields.areas });
  await areas.locator('label').first().click();
  await page.getByText(he.profile.household.couple, { exact: true }).click();
  await page.getByText(he.profile.contract['24'], { exact: true }).click();
  await page.getByText(he.profile.parking['1'], { exact: true }).click();
  await page.getByRole('switch', { name: ROOM.switch }).check();
  await page
    .getByRole('group', { name: ROOM.fields.gender, exact: true })
    .getByText(ROOM.gender.woman, { exact: true })
    .click();
  await page.getByRole('switch', { name: ROOM.peopleVisible }).check();
  await page.getByLabel(ROOM.aboutMe).fill('שלום, אני סטודנטית');
  await page.getByRole('button', { name: he.profile.save }).click();
  await expect(page.getByText(he.profile.saved)).toBeVisible();

  // An owner (a second browser context) posts a room and likes the seeker through the API.
  const ownerContext = await newTileContext(browser);
  const ownerPage = await ownerContext.newPage();
  await signUp(ownerPage, 'owner');
  const roomId = await postListing(ownerPage, street, {
    listing_type: 'room',
    gender_preference: 'any',
    flatmates_count: 2,
    flatmate_ages: [],
    lifestyle: {},
  });
  const personId = await findPerson(ownerPage, roomId, name);
  expect(await likePerson(ownerPage, roomId, personId)).toBeNull();
  await ownerContext.close();

  // The seeker's header shows "לייקים" with one room that liked them.
  await page.goto('/search');
  const nav = page
    .getByRole('navigation', { name: he.nav.label })
    .getByRole('link', { name: new RegExp(he.header.likes) });
  await expect(nav).toContainText(he.likes.badgeLabel_one);
  await nav.click();
  await expect(page).toHaveURL('/me/likes');

  // The room is under "אהבו אותך"; liking back opens the chat.
  const likedMe = page.getByRole('region', { name: he.likes.likedMe });
  await expect(likedMe.getByRole('link', { name: new RegExp(street) })).toBeVisible();
  await expectNoAxeViolations(page, '/me/likes');

  await test.step('0009qa lists at 1440 and 390', async () => {
    // Before liking back, the room is still under "אהבו אותך". Desktop: the section spans the wide
    // column, the card is one grid cell of three.
    const roomCard = page.getByRole('article').filter({ hasText: street });
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(async () => {
      const section = await layoutOf(page, likedMe);
      expect(section.box.width).toBeGreaterThanOrEqual(1200);
      const card = await layoutOf(page, roomCard);
      expect(card.box.width).toBeLessThanOrEqual(460);
    }).toPass();
    // Phone: the card fills the column between the 16px gutters, with no horizontal scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(async () => {
      const card = await layoutOf(page, roomCard);
      expect(Math.abs(card.box.width - (card.clientWidth - 32))).toBeLessThanOrEqual(2);
      expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
    }).toPass();
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  await likedMe.getByRole('button', { name: he.likes.like }).click();
  await expect(page.getByText(he.likes.mutual)).toBeVisible();
  const chat = page.getByRole('link', { name: he.likes.toChat });
  await expect(chat).toHaveAttribute('href', /^\/chat\/[0-9a-f-]{36}$/);
  await chat.click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);

  // "My applications" shows the room tagged as a mutual match, with no message block.
  await page.goto('/me/applications');
  const card = page.getByRole('article').filter({ hasText: street });
  await expect(card.getByTestId('application-mutual')).toHaveText(he.applications.mutual);
  await expect(card.getByTestId('application-message')).toHaveCount(0);

  await test.step('0009qa lists at 1440 and 390', async () => {
    // Desktop: a 720px list, centred. Phone: the card fills the column between the 16px gutters.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(async () => {
      const { box, clientWidth } = await layoutOf(page, card);
      expect(Math.abs(box.width - 720)).toBeLessThanOrEqual(2);
      expect(Math.abs(box.x - (clientWidth - (box.x + box.width)))).toBeLessThanOrEqual(2);
    }).toPass();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(async () => {
      const { box, clientWidth } = await layoutOf(page, card);
      expect(Math.abs(box.width - (clientWidth - 32))).toBeLessThanOrEqual(2);
    }).toPass();
    await page.setViewportSize({ width: 1280, height: 720 });
  });
});
