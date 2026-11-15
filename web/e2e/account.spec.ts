import { expect } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { expectNoAxeViolations } from './a11y';
import { API, latestCode, signUp } from './helpers';
import { test } from './fixtures';

// Spec 0013f: a person deletes their account from the profile, and the legal pages are one click
// away in the footer. CI only (Speed rule 8): never run locally.
test('ac11_delete_account_and_legal_pages', async ({ page }) => {
  // A fresh sign-up: the session is under 15 minutes old, so no sign-in is asked first.
  const email = await signUp(page, 'seeker');
  const firstCode = await latestCode(email);

  await page.goto('/me/profile');
  await page.getByRole('button', { name: he.profile.delete.open }).click();
  const dialog = page.getByRole('dialog', { name: he.profile.delete.confirmTitle });
  await expect(dialog.getByRole('button', { name: he.common.cancel })).toBeFocused();
  await dialog.getByRole('button', { name: he.profile.delete.confirm }).click();

  await expect(page).toHaveURL('/account-deleted');
  await expect(
    page.getByRole('heading', { level: 1, name: he.accountDeleted.title }),
  ).toBeVisible();
  expect((await page.request.get(`${API}/me`)).status()).toBe(401);

  // The footer's links open the terms and the privacy policy, with no axe violations.
  const footer = page.getByRole('navigation', { name: he.footer.label });
  await footer.getByRole('link', { name: he.footer.terms }).click();
  await expect(page).toHaveURL('/terms');
  await expect(page.getByRole('heading', { level: 1, name: he.legal.terms.title })).toBeVisible();
  await expectNoAxeViolations(page, '/terms');
  await footer.getByRole('link', { name: he.footer.privacy }).click();
  await expect(page).toHaveURL('/privacy');
  await expect(page.getByRole('heading', { level: 1, name: he.legal.privacy.title })).toBeVisible();
  await expectNoAxeViolations(page, '/privacy');

  // The same email signs in as a stranger: the account is gone, so the form asks for a profile.
  await page.goto('/login');
  await page.getByLabel(he.auth.email.label).fill(email);
  await page.getByRole('button', { name: he.auth.sendCode }).click();
  const codeInput = page.getByLabel(he.auth.code.label);
  await expect(codeInput).toBeFocused();
  let code: string | null = null;
  await expect
    .poll(async () => (code = await latestCode(email)), { timeout: 10_000 })
    .not.toBe(firstCode);
  await codeInput.fill(code ?? '');
  await page.getByRole('button', { name: he.auth.verify }).click();
  await expect(page.getByText(he.auth.noAccountYet)).toBeVisible();
  await expect(page).toHaveURL('/login');
});
