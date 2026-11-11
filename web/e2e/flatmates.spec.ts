import { expect, test, type BrowserContext } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { latestCode, postListing, signUp, uniqueEmail } from './helpers';

const withCount = (text: string, count: number) => text.replace('{{count}}', String(count));

/** Every request URL the context sends, without the fragment (which no browser sends). */
function recordRequests(context: BrowserContext): string[] {
  const urls: string[] = [];
  context.on('request', (request) => {
    urls.push(request.url().split('#')[0] ?? '');
  });
  return urls;
}

// A room's lister creates the invite link; a logged-out person opens it, signs up from the login
// it is sent to, comes back to the join page and joins. The token stays out of every URL.
test('ac6_invite_and_join', async ({ page, browser }) => {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const street = `e2e ${run}`;
  const FLATMATE = `שותפה ${run}`;
  const ownerRequests = recordRequests(page.context());

  // O posts a room and creates the link from the flatmates page.
  await signUp(page, 'owner');
  const roomId = await postListing(page, street, {
    listing_type: 'room',
    gender_preference: 'any',
    flatmates_count: 2,
    flatmate_ages: [27, 30],
    lifestyle: { cleanliness: 3 },
  });
  await page.goto('/me/listings');
  const card = page.getByRole('article').filter({ hasText: street });
  await card.getByRole('link', { name: withCount(he.listings.mine.flatmates, 0) }).click();
  await expect(page).toHaveURL(`/me/listings/${roomId}/flatmates`);
  await expect(page.getByRole('heading', { level: 1, name: he.flatmates.title })).toBeVisible();
  await page.getByRole('button', { name: he.flatmates.invite.create }).click();
  const input = page.getByRole('textbox', { name: he.flatmates.invite.linkLabel });
  await expect(input).toHaveValue(/\/flatmates\/join#[A-Za-z0-9_-]+$/);
  const link = await input.inputValue();
  const token = link.split('#')[1] ?? '';
  expect(token.length).toBeGreaterThan(20);
  await expect(page.getByText(he.flatmates.invite.onceWarning)).toBeVisible();

  // F, logged out, opens the link and is sent to the login with a bare `next`.
  const flatmateContext = await browser.newContext();
  const flatmateRequests = recordRequests(flatmateContext);
  const flatmatePage = await flatmateContext.newPage();
  const flatmateUrls: string[] = [];
  flatmatePage.on('framenavigated', (frame) => {
    if (frame === flatmatePage.mainFrame()) flatmateUrls.push(frame.url());
  });
  await flatmatePage.goto(link);
  await expect(flatmatePage).toHaveURL('/login?next=%2Fflatmates%2Fjoin');
  await expect(
    flatmatePage.getByRole('heading', { level: 1, name: he.auth.login.title }),
  ).toBeVisible();

  // F signs up from there: the login asks for a role and a name for a new email.
  const email = uniqueEmail();
  await flatmatePage.getByLabel(he.auth.email.label).fill(email);
  await flatmatePage.getByRole('button', { name: he.auth.sendCode }).click();
  const codeInput = flatmatePage.getByLabel(he.auth.code.label);
  await expect(codeInput).toBeFocused();
  let code: string | null = null;
  await expect
    .poll(async () => (code = await latestCode(email)), { timeout: 10_000 })
    .toMatch(/^\d{6}$/);
  await codeInput.fill(code ?? '');
  await flatmatePage.getByRole('button', { name: he.auth.verify }).click();
  await expect(flatmatePage.getByText(he.auth.noAccountYet)).toBeVisible();
  await flatmatePage.getByText(he.auth.role.seeker, { exact: true }).click();
  await flatmatePage.getByLabel(he.auth.name.label).fill(FLATMATE);
  await flatmatePage.getByRole('button', { name: he.auth.verify }).click();

  // Back on the join page: the invite, then the join, then the chat list's confirmation.
  await expect(flatmatePage).toHaveURL('/flatmates/join');
  await expect(
    flatmatePage.getByRole('heading', { level: 1, name: he.flatmates.join.title }),
  ).toBeVisible();
  await flatmatePage.getByRole('button', { name: he.flatmates.join.cta }).click();
  await expect(flatmatePage).toHaveURL('/chat');
  await expect(flatmatePage.getByText(he.flatmates.join.done)).toBeVisible();

  // O's flatmates page lists F.
  await page.reload();
  await expect(page.getByText(FLATMATE)).toBeVisible();

  // After F's first load the page URL never held the token, and no request URL did.
  const firstLoad = flatmateUrls.findIndex((url) => url.includes(token));
  for (const url of flatmateUrls.slice(firstLoad + 1)) expect(url).not.toContain(token);
  expect(flatmatePage.url()).not.toContain(token);
  for (const url of [...ownerRequests, ...flatmateRequests]) expect(url).not.toContain(token);
  expect(flatmateRequests.length).toBeGreaterThan(0);

  await flatmateContext.close();
});
