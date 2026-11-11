import { expect, test } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { API, postListing, signUp } from './helpers';

const MESSAGE = 'Hi, we are a quiet couple';
const ROOM = he.profile.room;

/** `YYYY-MM-DD`, `days` from today in Israel (the profile form's calendar). */
function israelDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('ac9_fill_profile_apply_withdraw', async ({ page }) => {
  const street = `e2e ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const overBudgetStreet = `${street} over`;

  // An owner posts a listing, and one above the seeker's budget (0006f AC10).
  await signUp(page, 'owner');
  const id = await postListing(page, street);
  const overBudgetId = await postListing(page, overBudgetStreet, { price_ils: 7600 });

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

  // Fill the profile (0006a `P`: budget 7500, move-in in 30 days, the listing's area, a couple,
  // no pets, a non-smoker, 24 months, one parking spot) and come back to the listing.
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
  await page.getByText(he.profile.contract['24'], { exact: true }).click();
  await page.getByText(he.profile.parking['1'], { exact: true }).click();
  // The room section (0007d): a woman born 30 years ago, women as flatmates, one answer. Labels
  // are found inside their group: "גבר" is a substring of "גברים".
  const roomGroup = (legend: string) => page.getByRole('group', { name: legend, exact: true });
  const roomRadio = (legend: string, name: string) =>
    roomGroup(legend).getByRole('radio', { name, exact: true });
  const cleanliness = he.lifestyle.cleanliness.question.seeker;
  const birthYear = String(new Date().getUTCFullYear() - 30);
  await page.getByRole('switch', { name: ROOM.switch }).check();
  await expect(page.getByText(ROOM.privacy)).toBeVisible();
  await roomGroup(ROOM.fields.gender).getByText(ROOM.gender.woman, { exact: true }).click();
  await page.getByLabel(ROOM.fields.birthYear).fill(birthYear);
  await roomGroup(ROOM.fields.flatmates)
    .getByText(he.rooms.genderPreference.women, { exact: true })
    .click();
  await roomGroup(cleanliness)
    .getByText(he.lifestyle.cleanliness.answer['3'], { exact: true })
    .click();
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
  await expect(page.getByRole('switch', { name: he.profile.fields.pets })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: he.profile.fields.smoker })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: he.profile.contract['24'] })).toBeChecked();
  await expect(page.getByRole('radio', { name: he.profile.parking['1'] })).toBeChecked();
  await expect(page.getByRole('switch', { name: ROOM.switch })).toBeChecked();
  await expect(roomRadio(ROOM.fields.gender, ROOM.gender.woman)).toBeChecked();
  await expect(page.getByLabel(ROOM.fields.birthYear)).toHaveValue(birthYear);
  await expect(roomRadio(ROOM.fields.flatmates, he.rooms.genderPreference.women)).toBeChecked();
  await expect(roomRadio(cleanliness, he.lifestyle.cleanliness.answer['3'])).toBeChecked();
  await expect(page.getByRole('region', { name: he.lifestyle.title.seeker })).toBeVisible();

  // The gate's entry point lands on the room heading; switching off and saving clears the section.
  await page.goto('/me/profile?section=room');
  await expect(page.getByRole('heading', { level: 2, name: ROOM.title })).toBeFocused();
  await page.getByRole('switch', { name: ROOM.switch }).uncheck();
  await page.getByRole('button', { name: he.profile.save }).click();
  await expect(page.getByText(he.profile.saved, { exact: true })).toBeVisible();
  // `goto`, not `reload`: `section=room` would open the switch again.
  await page.goto('/me/profile');
  await expect(page.getByLabel(he.profile.fields.budget)).toHaveValue('7500');
  await expect(page.getByRole('switch', { name: ROOM.switch })).not.toBeChecked();
  await expect(page.getByRole('group', { name: ROOM.fields.gender, exact: true })).toHaveCount(0);
  await expect(page.getByLabel(ROOM.fields.birthYear)).toHaveCount(0);
  await expect(page.getByRole('region', { name: he.lifestyle.title.seeker })).toHaveCount(0);
  const stored = await page.request.get(API + '/me/profile');
  expect(stored.ok()).toBe(true);
  expect(await stored.json()).toMatchObject({
    gender: null,
    birth_year: null,
    flatmate_gender: 'any',
    lifestyle: {},
  });

  await test.step('ac10 search and the listing pages show the match', async () => {
    // Sorted by match (the default for a seeker with a profile); the fitting listing scores 100.
    // No overall order is asserted: the shared e2e database holds other 100s (0006b AC2 proves it).
    await page.goto('/search');
    await expect(page.locator('p[aria-live="polite"]')).toContainText(
      he.search.sortedByMatch.trim(),
    );
    const fitting = page.getByRole('article').filter({ hasText: street }).filter({
      hasNotText: overBudgetStreet,
    });
    await expect(fitting).toHaveCount(1);
    await expect(fitting).toContainText(he.match.badge.replace('{{score}}', '100'));

    // Over budget: capped at 59, the budget is what differs.
    await page.goto(`/listings/${overBudgetId}`);
    const overBudget = page.getByRole('region', { name: he.match.card.title });
    await expect(page.getByText(he.match.badge.replace('{{score}}', '59'))).toBeVisible();
    await expect(overBudget).toContainText(
      he.match.seeker.budget.differ.replace('{{price}}', '7,600').replace('{{budget}}', '7,500'),
    );

    // The fitting listing's page has the card.
    await page.goto(`/listings/${id}`);
    await expect(page.getByRole('region', { name: he.match.card.title })).toBeVisible();
    await expect(page.getByText(he.match.badge.replace('{{score}}', '100'))).toBeVisible();
  });
});
