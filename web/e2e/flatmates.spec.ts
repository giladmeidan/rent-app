import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { expectNoAxeViolations } from './a11y';
import {
  API,
  createInvite,
  latestCode,
  postListing,
  putProfile,
  signUp,
  uniqueEmail,
} from './helpers';

const withCount = (text: string, count: number) => text.replace('{{count}}', String(count));

/** A locator's box and the page's layout width (`clientWidth` excludes a scrollbar). */
async function layoutOf(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  return { box: box as NonNullable<typeof box>, clientWidth };
}

/** Every request URL the context sends, without the fragment (which no browser sends), and every
 * `Referer` it sends. */
function recordRequests(context: BrowserContext): string[] {
  const sent: string[] = [];
  context.on('request', (request) => {
    sent.push(request.url().split('#')[0] ?? '');
    const referer = request.headers()['referer'];
    if (referer !== undefined) sent.push(referer);
  });
  return sent;
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
  await test.step('0009qb join at 1440', async () => {
    // A centred 480px card: the full-width join button is at most 480px wide, centred.
    const join = flatmatePage.getByRole('button', { name: he.flatmates.join.cta });
    await expect(join).toBeVisible();
    await flatmatePage.setViewportSize({ width: 1440, height: 900 });
    await expect(async () => {
      const { box, clientWidth } = await layoutOf(flatmatePage, join);
      expect(box.width).toBeLessThanOrEqual(480);
      expect(Math.abs(box.x + box.width / 2 - clientWidth / 2)).toBeLessThanOrEqual(2);
    }).toPass();
    await flatmatePage.setViewportSize({ width: 1280, height: 720 });
  });
  await flatmatePage.getByRole('button', { name: he.flatmates.join.cta }).click();
  await expect(flatmatePage).toHaveURL('/chat');
  await expect(flatmatePage.getByText(he.flatmates.join.done)).toBeVisible();

  // O's flatmates page lists F.
  await page.reload();
  await expect(page.getByText(FLATMATE)).toBeVisible();
  await test.step('0009qb flatmates at 1440 and 390', async () => {
    // `exact`: the hint and the create button also contain "קישור הזמנה".
    const inviteTitle = page.getByRole('heading', {
      level: 2,
      name: he.flatmates.invite.title,
      exact: true,
    });
    const membersTitle = page.getByRole('heading', { level: 2, name: he.flatmates.list.title });
    // Desktop: the invite and the members side by side, the invite at the start (RTL: right).
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(async () => {
      const invite = await layoutOf(page, inviteTitle);
      const members = await layoutOf(page, membersTitle);
      expect(Math.abs(invite.box.y - members.box.y)).toBeLessThanOrEqual(2);
      expect(invite.box.x).toBeGreaterThan(members.box.x);
    }).toPass();
    // Phone: stacked, the members below the invite card.
    await page.setViewportSize({ width: 390, height: 844 });
    const inviteCard = inviteTitle.locator('xpath=following-sibling::*[1]');
    await expect(async () => {
      const card = await layoutOf(page, inviteCard);
      const members = await layoutOf(page, membersTitle);
      expect(members.box.y).toBeGreaterThan(card.box.y + card.box.height);
    }).toPass();
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  // After F's first load the page URL never held the token, and no request URL or Referer did.
  // The first load may report `#T` more than once: check from the first URL without it.
  const clean = flatmateUrls.findIndex((url) => !url.includes(token));
  expect(clean).not.toBe(-1);
  for (const url of flatmateUrls.slice(clean)) expect(url).not.toContain(token);
  expect(flatmatePage.url()).not.toContain(token);
  for (const url of [...ownerRequests, ...flatmateRequests]) expect(url).not.toContain(token);
  expect(flatmateRequests.length).toBeGreaterThan(0);

  await flatmateContext.close();
});

// A room's chat with a flatmate in it: the group header and the joined note, the sender's name for
// the others, then the owner removes the flatmate and the open thread says so on the next send.
test('ac5_group_chat_flow', async ({ page, browser }) => {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const street = `e2e ${run}`;
  const OWNER = '\u05e8\u05d5\u05e0\u05d9'; // רוני
  const FLATMATE = '\u05d3\u05e0\u05d4'; // דנה
  const SEEKER = '\u05e0\u05d5\u05e2\u05d4'; // נועה
  const HELLO = `\u05d4\u05d9\u05d9, \u05d0\u05e0\u05d9 ${FLATMATE}`; // היי, אני דנה
  const AFTER = 'still here?';
  const today = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem' }).format(new Date());

  // 1. O posts a room and creates the link.
  await signUp(page, 'owner', { name: OWNER });
  const roomId = await postListing(page, street, {
    listing_type: 'room',
    gender_preference: 'any',
    flatmates_count: 2,
    flatmate_ages: [27, 30],
    lifestyle: { cleanliness: 3 },
  });
  const token = await createInvite(page, roomId);

  // 2. F signs up and joins through the UI.
  const flatmateContext = await browser.newContext();
  const flatmatePage = await flatmateContext.newPage();
  await signUp(flatmatePage, 'seeker', { name: FLATMATE });
  await flatmatePage.goto(`/flatmates/join#${token}`);
  await flatmatePage.getByRole('button', { name: he.flatmates.join.cta }).click();
  await expect(flatmatePage).toHaveURL('/chat');
  await expect(flatmatePage.getByText(he.flatmates.join.done)).toBeVisible();

  // 3. S applies through the API; O shortlists in the inbox.
  const seekerContext = await browser.newContext();
  const seekerPage = await seekerContext.newPage();
  await signUp(seekerPage, 'seeker', { name: SEEKER });
  await putProfile(seekerPage);
  const applied = await seekerPage.request.post(`${API}/listings/${roomId}/applications`, {
    data: { message: 'Hi, we are a quiet couple' },
  });
  expect(applied.status()).toBe(201);
  const { id: applicationId } = (await applied.json()) as { id: string };
  await page.goto(`/me/listings/${roomId}/applicants`);
  const applicant = page.getByRole('article', { name: SEEKER });
  await applicant.getByRole('button', { name: he.applicants.actions.shortlist }).click();
  await expect(
    applicant.getByText(he.applicants.status.shortlisted, { exact: true }),
  ).toBeVisible();

  // 4. F opens the chat: the three members and the joined note.
  await flatmatePage.goto('/chat');
  await expect(flatmatePage.getByRole('link', { name: he.chat.myFlats })).toBeVisible();
  await expectNoAxeViolations(flatmatePage, '/chat');
  // "My flats" (0009c's axe check, already signed in), then back to the chats.
  await flatmatePage.goto('/me/flats');
  await expect(flatmatePage.getByRole('button', { name: he.flatmates.mine.leave })).toBeVisible();
  await expectNoAxeViolations(flatmatePage, '/me/flats');
  await flatmatePage.goto('/chat');
  await flatmatePage.getByRole('link', { name: new RegExp(SEEKER) }).click();
  await expect(flatmatePage).toHaveURL(`/chat/${applicationId}`);
  await expect(flatmatePage.getByRole('group', { name: he.chat.members })).toHaveText(
    `${OWNER} (${he.chat.roles.owner}) \u00b7 ${he.chat.you} \u00b7 ${SEEKER}`,
  );
  await expect(flatmatePage.getByText(he.chat.joinedNote.replace('{{date}}', today))).toBeVisible();
  await expectNoAxeViolations(flatmatePage, 'group thread');

  // 5. F sends a message.
  await flatmatePage.getByLabel(he.chat.composer.label).fill(HELLO);
  await flatmatePage.getByRole('button', { name: he.chat.composer.send }).click();
  const flatmateLog = flatmatePage.getByRole('log', { name: he.chat.thread.log });
  await expect(flatmateLog.getByText(HELLO, { exact: true })).toBeVisible();

  // 6. S's thread shows the message with F's name above it.
  await seekerPage.goto(`/chat/${applicationId}`);
  const seekerLog = seekerPage.getByRole('log', { name: he.chat.thread.log });
  await expect(seekerLog.getByText(HELLO, { exact: true })).toBeVisible();
  await expect(seekerLog.getByText(FLATMATE, { exact: true })).toBeVisible();

  // 7. O removes F. F's open thread is told on the next send (not on a focus event: focus across
  // contexts is not reliable), and the chat list no longer has the conversation.
  await page.goto(`/me/listings/${roomId}/flatmates`);
  await expect(page.getByRole('button', { name: he.flatmates.list.remove })).toBeVisible();
  await expectNoAxeViolations(page, '/me/listings/:id/flatmates');
  // The kit's confirm dialog (0009qb), not a native one.
  await page.getByRole('button', { name: he.flatmates.list.remove }).click();
  await page.getByRole('dialog').getByRole('button', { name: he.flatmates.list.remove }).click();
  await expect(page.getByText(he.flatmates.list.empty)).toBeVisible();
  await flatmatePage.getByLabel(he.chat.composer.label).fill(AFTER);
  await flatmatePage.getByRole('button', { name: he.chat.composer.send }).click();
  await expect(flatmatePage.getByText(he.chat.removed)).toBeVisible();
  await expect(flatmatePage.getByLabel(he.chat.composer.label)).toHaveCount(0);
  await flatmatePage.getByRole('link', { name: he.chat.thread.back }).click();
  await expect(flatmatePage).toHaveURL('/chat');
  await expect(flatmatePage.getByRole('link', { name: new RegExp(SEEKER) })).toHaveCount(0);

  await flatmateContext.close();
  await seekerContext.close();
});
