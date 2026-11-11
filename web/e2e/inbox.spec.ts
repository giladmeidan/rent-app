import { expect, test } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { API, postListing, signUp } from './helpers';

const MESSAGE = 'Hi, we are a quiet couple';
const SEEKER_NAME = '\u05de\u05d9\u05db\u05dc';
// i18next's `{{count}}` interpolation, for the copy the page renders.
const withCount = (text: string, count: number) => text.replace('{{count}}', String(count));

test('ac8_owner_shortlists_and_declines', async ({ page, browser }) => {
  const street = `e2e ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // An owner (the default signUp name) posts a listing.
  await signUp(page, 'owner');
  const id = await postListing(page, street);

  // A seeker with another name, in a second context, applies through the API.
  const seekerContext = await browser.newContext();
  const seekerPage = await seekerContext.newPage();
  await signUp(seekerPage, 'seeker', { name: SEEKER_NAME });
  const applied = await seekerPage.request.post(`${API}/listings/${id}/applications`, {
    data: { message: MESSAGE },
  });
  expect(applied.status()).toBe(201);

  // "My listings": the card's link reads one applicant, one new.
  await page.goto('/me/listings');
  const card = page.getByRole('article').filter({ hasText: street });
  const link = card.getByRole('link', { name: withCount(he.applicants.link, 1) });
  await expect(link).toBeVisible();
  await expect(link.getByText(withCount(he.applicants.newBadge, 1))).toBeVisible();

  // The inbox: the seeker's name (not the owner's) and message.
  await link.click();
  await expect(page).toHaveURL(`/me/listings/${id}/applicants`);
  await expect(page.getByRole('heading', { level: 1, name: he.applicants.title })).toBeVisible();
  const applicant = page.getByRole('article', { name: SEEKER_NAME });
  await expect(applicant.getByRole('heading', { level: 2 })).toHaveText(SEEKER_NAME);
  await expect(applicant.getByText(MESSAGE)).toBeVisible();

  // Shortlist.
  await applicant.getByRole('button', { name: he.applicants.actions.shortlist }).click();
  await expect(
    applicant.getByText(he.applicants.status.shortlisted, { exact: true }),
  ).toBeVisible();

  // Decline, accepting the confirmation: no actions remain.
  page.once('dialog', (dialog) => void dialog.accept());
  await applicant.getByRole('button', { name: he.applicants.actions.decline }).click();
  await expect(applicant.getByText(he.applicants.status.declined, { exact: true })).toBeVisible();
  await expect(applicant.getByRole('button')).toHaveCount(0);

  // The seeker sees the decline.
  const mine = await seekerPage.request.get(`${API}/me/applications`);
  expect(mine.ok()).toBe(true);
  const items = (await mine.json()) as { status: string; listing: { id: string } }[];
  expect(items).toHaveLength(1);
  expect(items[0]?.listing.id).toBe(id);
  expect(items[0]?.status).toBe('declined');
  await seekerContext.close();
});
