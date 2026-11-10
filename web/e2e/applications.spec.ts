import { expect, test } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { API, postListing, signUp } from './helpers';

const MESSAGE = 'Hi, we are a quiet couple';

test('ac11_seeker_applies_and_withdraws', async ({ page }) => {
  const street = `e2e ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // An owner posts a listing.
  await signUp(page, 'owner');
  const id = await postListing(page, street);

  // A visitor sees the count and the log-in prompt inside the apply section (the logged-out
  // header has its own log-in and signup links).
  await page.context().clearCookies();
  await page.goto(`/listings/${id}`);
  const section = page.getByRole('region', { name: he.applications.heading });
  await expect(section.getByText(he.applications.count.zero)).toBeVisible();
  await expect(section.getByRole('link', { name: he.header.login })).toBeVisible();
  const signupHref = await section
    .getByRole('link', { name: he.header.signup })
    .getAttribute('href');
  expect(signupHref).not.toBeNull();

  // Signing up from the prompt lands back on the listing.
  await signUp(page, 'seeker', { start: signupHref ?? '', expectUrl: `/listings/${id}` });

  // Apply.
  await section.getByRole('button', { name: he.applications.apply }).click();
  await section.getByLabel(he.applications.form.label).fill(MESSAGE);
  await section.getByRole('button', { name: he.applications.form.submit }).click();
  await expect(section.getByText(he.applications.sent, { exact: true })).toBeVisible();
  await expect(section.getByText(he.applications.status.submitted, { exact: true })).toBeVisible();
  await expect(section.getByText(he.applications.count.one)).toBeVisible();

  // "My applications": one card for this listing; withdraw it.
  await page.getByRole('banner').getByRole('link', { name: he.header.myApplications }).click();
  await expect(page).toHaveURL('/me/applications');
  const card = page.getByRole('article');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(street);
  await expect(card.getByText(he.applications.status.submitted, { exact: true })).toBeVisible();
  await card.getByRole('button', { name: he.applications.withdraw }).click();
  await expect(card.getByText(he.applications.status.withdrawn, { exact: true })).toBeVisible();

  const mine = await page.request.get(API + '/me/applications');
  expect(mine.ok()).toBe(true);
  const items = (await mine.json()) as { status: string }[];
  expect(items).toHaveLength(1);
  expect(items[0]?.status).toBe('withdrawn');
});
