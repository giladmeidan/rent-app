import { expect } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { expectNoAxeViolations } from './a11y';
import { API, postListing, putProfile, signUpApi } from './helpers';
import { newTileContext, test } from './fixtures';

const MESSAGE = 'Hi, we are a quiet couple';
const SEEKER_NAME = '\u05de\u05d9\u05db\u05dc';
// signUp's default display name: the owner's.
const OWNER_NAME = '\u05d3\u05e0\u05d4';
// i18next's `{{count}}` / `{{name}}` interpolation, for the copy the page renders.
const withCount = (text: string, count: number) => text.replace('{{count}}', String(count));
const withName = (text: string, name: string) => text.replace('{{name}}', name);
const withScore = (text: string, score: number) => text.replace('{{score}}', String(score));
// The room line (0007c) for a woman of 27: the age is this UTC year's, as the API computes it.
const ROOM_LINE = he.applicants.room.line
  .replace('{{gender}}', he.profile.room.gender.woman)
  .replace('{{age}}', '27');

// Extends 0004d's inbox flow with the chat (0005b AC12): no new signup (the e2e OTP budget).
test('ac12_shortlist_chat_decline', async ({ page, browser }) => {
  const street = `e2e ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // An owner (the default signUp name) posts a listing.
  await signUpApi(page, 'owner');
  const id = await postListing(page, street);

  // A seeker with another name, in a second context, applies through the API.
  const seekerContext = await newTileContext(browser);
  const seekerPage = await seekerContext.newPage();
  await signUpApi(seekerPage, 'seeker', { name: SEEKER_NAME });
  await putProfile(seekerPage); // applying needs a housing profile (0006a)
  const applied = await seekerPage.request.post(`${API}/listings/${id}/applications`, {
    data: { message: MESSAGE },
  });
  expect(applied.status()).toBe(201);
  const { id: applicationId } = (await applied.json()) as { id: string };

  // "My listings": the card's link reads one applicant, one new.
  await page.goto('/me/listings');
  const card = page.getByRole('article').filter({ hasText: street });
  const link = card.getByRole('link', { name: withCount(he.applicants.link, 1) });
  await expect(link).toBeVisible();
  await expect(link.getByText(he.applicants.newBadge_one)).toBeVisible();

  // The inbox steps below run the stacked (phone) layout, with today's selectors; the desktop
  // layout (0009u) has its own step at the end, and `flatmates.spec.ts` / `people.spec.ts` cover
  // it at the default 1280x720.
  await page.setViewportSize({ width: 390, height: 844 });

  // The inbox: the seeker's name (not the owner's) and message.
  await link.click();
  await expect(page).toHaveURL(`/me/listings/${id}/applicants`);
  await expect(
    page.getByRole('heading', { level: 1, name: new RegExp(`^${he.applicants.titleFor}`) }),
  ).toBeVisible();
  const applicant = page.getByRole('article', { name: SEEKER_NAME });
  await expect(applicant.getByRole('heading', { level: 2 })).toHaveText(SEEKER_NAME);
  await expect(applicant.getByText(MESSAGE)).toBeVisible();

  // The match (0006g AC8): the listing (7,200 ₪, entry in 30 days, one parking spot) against the
  // seeker's profile `P` (budget 7,500, the same day and area, one spot) scores 100; the
  // disclosure lists the reasons, budget first.
  await expect(applicant.getByTestId('match-ring')).toContainText(withScore(he.match.badge, 100));
  const why = applicant.getByRole('button', { name: he.applicants.why });
  await expect(why).toHaveAttribute('aria-expanded', 'false');
  await why.click();
  await expect(why).toHaveAttribute('aria-expanded', 'true');
  const panel = page.locator(`[id="${(await why.getAttribute('aria-controls')) ?? ''}"]`);
  await expect(panel.getByRole('list').getByRole('listitem').first()).toBeVisible();
  await expect(panel.getByText(he.match.owner.budget.agree, { exact: true })).toBeVisible();
  await expectNoAxeViolations(page, 'applicants inbox');

  // Shortlist.
  await applicant.getByRole('button', { name: he.applicants.actions.shortlist }).click();
  await expect(
    applicant.getByText(he.applicants.status.shortlisted, { exact: true }),
  ).toBeVisible();

  // The shortlisted card links to the chat; the owner opens it and writes first.
  const chatLink = applicant.getByRole('link', { name: withName(he.chat.withName, SEEKER_NAME) });
  await expect(chatLink).toBeVisible();
  await chatLink.click();
  await expect(page).toHaveURL(`/chat/${applicationId}`);
  await expect(page.getByRole('heading', { level: 1, name: SEEKER_NAME })).toBeVisible();
  await expect(page.getByRole('note')).toHaveText(he.chat.thread.warning);
  await page.getByLabel(he.chat.composer.label).fill('Hello');
  await page.getByRole('button', { name: he.chat.composer.send }).click();
  const ownerLog = page.getByRole('log', { name: he.chat.thread.log });
  await expect(ownerLog.getByText('Hello', { exact: true })).toBeVisible();
  await expect(page.getByLabel(he.chat.composer.label)).toHaveValue('');

  // The seeker, on a fresh load of their home (signUpApi does not navigate): the header's pill, the
  // owner's name in the list, the message.
  await seekerPage.goto('/search');
  const seekerChat = seekerPage
    .getByRole('navigation', { name: he.nav.label })
    .getByRole('link', { name: new RegExp(`^${he.header.chat}`) });
  await expect(seekerChat).toHaveAccessibleName(
    `${he.header.chat} ${withCount(he.header.chatNew, 1)}`,
  );
  await seekerChat.click();
  await expect(seekerPage).toHaveURL('/chat');
  const row = seekerPage.getByRole('link', { name: new RegExp(OWNER_NAME) });
  await expect(row).toBeVisible();
  await row.click();
  await expect(seekerPage).toHaveURL(`/chat/${applicationId}`);
  const seekerLog = seekerPage.getByRole('log', { name: he.chat.thread.log });
  await expect(seekerLog.getByText('Hello', { exact: true })).toBeVisible();

  // The seeker reports the other side of the chat (0011d), from behind "actions".
  await seekerPage.getByRole('button', { name: he.chat.thread.actions }).click();
  await seekerPage
    .getByRole('button', { name: withName(he.report.title.person, OWNER_NAME) })
    .click();
  const reportDialog = seekerPage.getByRole('dialog', {
    name: withName(he.report.title.person, OWNER_NAME),
  });
  await expectNoAxeViolations(seekerPage, 'chat report dialog');
  await reportDialog.getByText(he.report.reasons.moneyBeforeViewing, { exact: true }).click();
  await reportDialog.getByRole('button', { name: he.report.submit }).click();
  await expect(reportDialog.getByRole('status')).toHaveText(he.report.sent);
  await reportDialog.getByRole('button', { name: he.report.close }).click();
  await expect(reportDialog).toBeHidden();

  // The seeker replies; the owner's open thread shows it without a reload (the event stream).
  await seekerPage.getByLabel(he.chat.composer.label).fill('Hi');
  await seekerPage.getByRole('button', { name: he.chat.composer.send }).click();
  await expect(seekerLog.getByText('Hi', { exact: true })).toBeVisible();
  await expect(ownerLog.getByText('Hi', { exact: true })).toBeVisible({ timeout: 3_000 });

  // Back to the inbox for the decline.
  await page.getByRole('button', { name: he.chat.thread.actions }).click();
  await page.getByRole('link', { name: he.chat.thread.toApplicants }).click();
  await expect(page).toHaveURL(`/me/listings/${id}/applicants`);
  await expect(applicant.getByRole('heading', { level: 2 })).toHaveText(SEEKER_NAME);

  // Decline, confirming in the kit's dialog (which names the seeker): no actions remain (the
  // disclosure button stays).
  await applicant.getByRole('button', { name: he.applicants.actions.decline }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(SEEKER_NAME);
  await dialog.getByRole('button', { name: he.applicants.actions.decline }).click();
  await expect(applicant.getByText(he.applicants.status.declined, { exact: true })).toBeVisible();
  for (const action of Object.values(he.applicants.actions)) {
    await expect(applicant.getByRole('button', { name: action, exact: true })).toHaveCount(0);
  }
  await expect(applicant.getByRole('button', { name: he.applicants.why })).toBeVisible();
  await expect(applicant.getByRole('link')).toHaveCount(0);

  // The seeker's thread, after a reload: still readable, closed for sending.
  await seekerPage.reload();
  await expect(seekerLog.getByText('Hello', { exact: true })).toBeVisible();
  await expect(
    seekerPage.getByRole('status').filter({ hasText: he.chat.thread.closed }),
  ).toBeVisible();
  await expect(seekerPage.getByRole('textbox')).toHaveCount(0);

  // The seeker sees the decline.
  const mine = await seekerPage.request.get(`${API}/me/applications`);
  expect(mine.ok()).toBe(true);
  const items = (await mine.json()) as { status: string; listing: { id: string } }[];
  expect(items).toHaveLength(1);
  expect(items[0]?.listing.id).toBe(id);
  expect(items[0]?.status).toBe('declined');

  // Rooms in the inbox (0007c AC14). The owner posts a room; the same seeker adds a room section
  // to the profile and applies to it.
  const roomId = await postListing(page, `${street} room`, {
    listing_type: 'room',
    flatmates_count: 2,
    lifestyle: { cleanliness: 1 },
  });
  await putProfile(seekerPage, {
    gender: 'woman',
    birth_year: new Date().getUTCFullYear() - 27,
    lifestyle: { cleanliness: 3 },
  });
  const roomApplied = await seekerPage.request.post(`${API}/listings/${roomId}/applications`, {
    data: { message: MESSAGE },
  });
  expect(roomApplied.status()).toBe(201);

  // The room's inbox: the gender / age line, and the answers behind "עוד פרטים" (3 against 1).
  await page.goto(`/me/listings/${roomId}/applicants`);
  await expect(applicant.getByRole('heading', { level: 2 })).toHaveText(SEEKER_NAME);
  await expect(applicant.getByText(ROOM_LINE, { exact: true })).toBeVisible();
  const more = applicant.getByRole('button', { name: he.applicants.more });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const morePanel = page.locator(`[id="${(await more.getAttribute('aria-controls')) ?? ''}"]`);
  await expect(morePanel.getByText(he.applicants.room.differs, { exact: true })).toBeVisible();

  // The apartment's inbox: the declined card, applied to an apartment, shows none of it, though
  // the seeker now has a room section (the snapshot gate).
  await page.goto(`/me/listings/${id}/applicants`);
  await expect(applicant.getByRole('heading', { level: 2 })).toHaveText(SEEKER_NAME);
  await expect(applicant.getByText(he.applicants.status.declined, { exact: true })).toBeVisible();
  await expect(applicant.getByRole('button', { name: he.applicants.why })).toBeVisible();
  await expect(applicant.getByRole('button', { name: he.applicants.more })).toHaveCount(0);
  await expect(applicant.getByText(ROOM_LINE, { exact: true })).toHaveCount(0);

  // The same layout on a phone (390x844): the four tabs stay on one row, nothing scrolls the page
  // sideways, and the score ring sits in the card's top row.
  await test.step('phone 390x844', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/me/listings/${roomId}/applicants`);
    await expect(applicant.getByRole('heading', { level: 2 })).toHaveText(SEEKER_NAME);
    const tops = await page
      .getByRole('tablist', { name: he.applicants.filter.label })
      .getByRole('tab')
      .evaluateAll((tabs) => tabs.map((tab) => (tab as HTMLElement).offsetTop));
    expect(tops).toHaveLength(4);
    expect(new Set(tops).size).toBe(1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(overflow).toBe(true);
    const ring = applicant.getByTestId('match-ring');
    await expect(ring).toBeVisible();
    // The ring is a child of the card's top row (the avatar, the text column and the ring).
    const inTopRow = await ring.evaluate(
      (el) => el.parentElement?.parentElement?.querySelector('h2') !== null,
    );
    expect(inTopRow).toBe(true);
  });

  // The desktop layout (0009u): a card grid beside the selected applicant's pane.
  await test.step('desktop 1440x900', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/me/listings/${roomId}/applicants`);
    const pane = page.getByRole('complementary', { name: he.applicants.pane.label });
    await expect(pane.getByRole('heading', { level: 2 })).toHaveText(SEEKER_NAME);
    await expect(pane.getByText(ROOM_LINE, { exact: true })).toBeVisible();
    await expect(pane.getByTestId('pane-message')).toHaveText(MESSAGE);
    await expect(pane.getByText(he.match.owner.budget.agree, { exact: true })).toBeVisible();

    // The questionnaire answers stay behind "עוד פרטים".
    const paneMore = pane.getByRole('button', { name: he.applicants.more });
    await expect(paneMore).toHaveAttribute('aria-expanded', 'false');
    await paneMore.click();
    await expect(paneMore).toHaveAttribute('aria-expanded', 'true');
    await expect(pane.getByText(he.applicants.room.differs, { exact: true })).toBeVisible();

    // The compact card has no disclosures; its name button is the selected one.
    await expect(applicant.getByRole('button', { name: he.applicants.why })).toHaveCount(0);
    await expect(applicant.getByRole('button', { name: he.applicants.more })).toHaveCount(0);
    await expect(applicant.getByRole('button', { name: SEEKER_NAME })).toHaveAttribute(
      'aria-current',
      'true',
    );
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits).toBe(true);

    // The apartment's inbox: the declined applicant, and no link in the pane.
    await page.goto(`/me/listings/${id}/applicants`);
    await expect(pane.getByTestId('pane-status')).toHaveText(he.applicants.status.declined);
    await expect(pane.getByRole('link')).toHaveCount(0);
  });
  await seekerContext.close();
});
