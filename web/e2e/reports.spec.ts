import { expect } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { expectNoAxeViolations } from './a11y';
import { newTileContext, test } from './fixtures';
import { postListing, signUp } from './helpers';

const R = he.report;

test('ac17_report_listing', async ({ page, browser }) => {
  // An owner posts an apartment; a seeker opens its page and reports it.
  const street = `e2e report ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await signUp(page, 'owner');
  const id = await postListing(page, street);
  await page.context().clearCookies();
  await signUp(page, 'seeker');
  await page.goto(`/listings/${id}`);

  const row = page.getByTestId('listing-report');
  const opener = row.getByRole('button', { name: R.listingButton });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: R.title.listing });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio')).toHaveCount(6);
  await expectNoAxeViolations(page, 'report dialog');
  await dialog.getByText(R.reasons.moneyBeforeViewing, { exact: true }).click();
  await dialog.getByLabel(R.note).fill('Asked for a deposit before any viewing');
  await dialog.getByRole('button', { name: R.submit }).click();
  await expect(dialog.getByRole('status')).toHaveText(R.sent);
  const close = dialog.getByRole('button', { name: R.close });
  await expect(close).toBeFocused();
  await close.click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  // Reopened empty; a second report of the same listing is already in.
  await opener.click();
  await expect(dialog.getByLabel(R.note)).toHaveValue('');
  await dialog.getByText(R.reasons.broker, { exact: true }).click();
  await dialog.getByRole('button', { name: R.submit }).click();
  await expect(dialog.getByRole('status')).toHaveText(R.already);

  // A signed-out visitor sees the control as a link to log in and come back.
  const visitor = await newTileContext(browser);
  try {
    const anonymous = await visitor.newPage();
    await anonymous.goto(`/listings/${id}`);
    const link = anonymous.getByTestId('listing-report').getByRole('link', {
      name: R.listingButton,
    });
    await expect(link).toHaveAttribute('href', `/login?next=%2Flistings%2F${id}`);
  } finally {
    await visitor.close();
  }
});
