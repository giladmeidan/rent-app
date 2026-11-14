import { expect, type Page } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { expectNoAxeViolations } from './a11y';
import { newTileContext, test } from './fixtures';
import { putProfile, signUp } from './helpers';

/** Both parts of the profile and the card shown (0010c), through the API with the page's session. */
async function showCard(page: Page, gender: 'woman' | 'man', about: string): Promise<void> {
  await putProfile(page, {
    gender,
    birth_year: new Date().getUTCFullYear() - 27,
    lifestyle: { cleanliness: 3, guests: 2 },
    people_visible: true,
    about_me: about,
  });
}

/** The card named `name` on people browse, paging with "load more" while it is not on the page yet
 * (the database keeps the cards of earlier specs of the run). */
async function findCard(page: Page, name: string) {
  const card = page.getByRole('article', { name });
  const more = page.getByRole('button', { name: he.people.loadMore });
  await expect(page.getByRole('article').first()).toBeVisible();
  for (let i = 0; i < 20 && !(await card.isVisible()); i += 1) {
    if (!(await more.isVisible())) break;
    const before = await page.getByRole('article').count();
    await more.click();
    await expect(page.getByRole('article')).not.toHaveCount(before);
  }
  await expect(card).toBeVisible();
  return card;
}

// Two people show their cards. A likes B on people browse; B finds A under "אנשים שמתעניינים בך"
// and likes back; the banner leads to the direct chat, where B writes and A reads; A removes the
// match and the closed note shows for both. Two sign-ups (the e2e OTP budget).
test('ac19_people_like_match_chat_remove', async ({ page, browser }) => {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const A_NAME = `איה ${tag}`;
  const B_NAME = `בר ${tag}`;
  const MESSAGE = `hello ${tag}`;

  // A (the fixture page) and B (a second context) sign up from the market and show their cards.
  await signUp(page, 'seeker', { name: A_NAME, market: true });
  await showCard(page, 'woman', 'quiet and tidy');
  const bContext = await newTileContext(browser);
  const b = await bContext.newPage();
  await signUp(b, 'seeker', { name: B_NAME, market: true });
  await showCard(b, 'man', 'likes cooking');

  // A opens the people tab from the market's inner switch and finds B.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/market');
  await page
    .getByRole('navigation', { name: he.market.view.label })
    .getByRole('link', { name: he.market.view.people })
    .click();
  await expect(page).toHaveURL('/market/people');
  await expect(page.getByRole('heading', { level: 1, name: he.market.people.title })).toBeVisible();
  const cardOfB = await findCard(page, B_NAME);
  await expect(cardOfB.getByText('likes cooking')).toBeVisible();
  // Their answers beside A's own: cleanliness and guests are shared and the same.
  await expect(cardOfB.getByText('2 מתוך 2 תשובות דומות')).toBeVisible();
  await expectNoAxeViolations(page, '/market/people');

  // A likes B: one name for the button, the state in `aria-pressed`.
  const like = cardOfB.getByRole('button', { name: he.market.people.like });
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');

  // B sees A under "אנשים שמתעניינים בך" on the likes page, and likes back.
  await b.goto('/me/likes');
  const likedMe = b.getByRole('region', { name: he.likes.people.likedMe });
  const cardOfA = likedMe.getByRole('article', { name: A_NAME });
  await expect(cardOfA).toBeVisible();
  await expect(cardOfA.getByText(he.market.people.likedMe)).toBeVisible();
  await expectNoAxeViolations(b, '/me/likes');
  await cardOfA.getByRole('button', { name: he.market.people.like }).click();

  // The mutual banner leads to the direct chat.
  const banner = b.getByRole('status').filter({ hasText: he.likes.mutual });
  await expect(banner).toBeVisible();
  await banner.getByRole('link', { name: he.likes.toChat }).click();
  await expect(b).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  const chatUrl = b.url();
  await expect(b.getByRole('heading', { level: 1, name: A_NAME })).toBeVisible();

  // B writes, A reads.
  await b.getByRole('textbox', { name: he.chat.composer.label }).fill(MESSAGE);
  await b.getByRole('button', { name: he.chat.composer.send }).click();
  await expect(
    b.getByRole('log', { name: he.chat.thread.log }).getByText(MESSAGE, { exact: true }),
  ).toBeVisible();
  await page.goto(chatUrl);
  await expect(page.getByRole('heading', { level: 1, name: B_NAME })).toBeVisible();
  await expect(
    page.getByRole('log', { name: he.chat.thread.log }).getByText(MESSAGE, { exact: true }),
  ).toBeVisible();

  // A removes the match through the confirm: the closed note replaces the composer for A (and takes
  // focus), and shows for B too (the event stream).
  await page.getByRole('button', { name: he.chat.thread.removeMatch }).click();
  const dialog = page.getByRole('dialog', { name: he.chat.thread.removeMatchTitle });
  await dialog.getByRole('button', { name: he.chat.thread.removeMatchConfirm }).click();
  const closedForA = page.getByText(he.chat.thread.closedDirect);
  await expect(closedForA).toBeVisible();
  await expect(closedForA).toBeFocused();
  await expect(page.getByRole('textbox', { name: he.chat.composer.label })).toHaveCount(0);
  await expect(b.getByText(he.chat.thread.closedDirect)).toBeVisible({ timeout: 15_000 });
  await expect(b.getByRole('textbox', { name: he.chat.composer.label })).toHaveCount(0);

  await bContext.close();
});
