import { expect, test } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { API, postListing, signUp } from './helpers';

const MESSAGE = 'Hi, we are a quiet couple';

/** `YYYY-MM-DD`, `days` from today in Israel (the profile form's calendar). */
function israelDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('ac9_fill_profile_apply_withdraw', async ({ page }) => {
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
  // No housing profile yet (0006a): the gate instead of the apply button.
  await expect(section.getByText(he.applications.profileRequired)).toBeVisible();
  await expect(section.getByRole('button', { name: he.applications.apply })).toHaveCount(0);

  // Fill the profile and come back to the listing.
  await section.getByRole('link', { name: he.applications.fillProfile }).click();
  await expect(page).toHaveURL(`/me/profile?next=${encodeURIComponent(`/listings/${id}`)}`);
  await expect(page.getByRole('heading', { level: 1, name: he.profile.title })).toBeVisible();
  const moveIn = israelDay(30);
  await page.getByLabel(he.profile.fields.budget).fill('7500');
  await page.getByLabel(he.profile.fields.moveIn).fill(moveIn);
  const areas = page.getByRole('group', { name: he.profile.fields.areas });
  const areaName = (await areas.locator('label').first().textContent()) ?? '';
  await areas.locator('label').first().click();
  await page.getByText(he.profile.household.couple, { exact: true }).click();
  await page.getByRole('switch', { name: he.profile.fields.pets }).check();
  await page.getByText(he.profile.contract['24'], { exact: true }).click();
  await page.getByText(he.profile.parking['1'], { exact: true }).click();
  await page.getByRole('button', { name: he.profile.save }).click();
  await expect(page).toHaveURL(`/listings/${id}`);
  await expect(section.getByRole('button', { name: he.applications.apply })).toBeVisible();
  await expect(section.getByText(he.applications.profileRequired)).toHaveCount(0);

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

  // The profile reopens with the saved values.
  await page.goto('/me/profile');
  await expect(page.getByLabel(he.profile.fields.budget)).toHaveValue('7500');
  await expect(page.getByLabel(he.profile.fields.moveIn)).toHaveValue(moveIn);
  await expect(page.getByRole('checkbox', { name: areaName })).toBeChecked();
  await expect(page.getByRole('radio', { name: he.profile.household.couple })).toBeChecked();
  await expect(page.getByRole('switch', { name: he.profile.fields.pets })).toBeChecked();
  await expect(page.getByRole('switch', { name: he.profile.fields.smoker })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: he.profile.contract['24'] })).toBeChecked();
  await expect(page.getByRole('radio', { name: he.profile.parking['1'] })).toBeChecked();
});
