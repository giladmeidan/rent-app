import { expect, test } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { latestCode, uniqueEmail } from './helpers';

test('ac7_signup_via_outbox_and_logout', async ({ page }) => {
  const name = 'נועה';
  const email = uniqueEmail();
  const header = page.getByRole('banner');

  await page.goto('/signup');
  await expect(page.getByRole('heading', { level: 1, name: he.auth.signup.title })).toBeVisible();
  await page.getByText(he.auth.role.owner, { exact: true }).click();
  await expect(page.getByRole('radio', { name: he.auth.role.owner })).toBeChecked();
  await page.getByLabel(he.auth.name.label).fill(name);
  await page.getByLabel(he.auth.email.label).fill(email);
  await page.getByRole('button', { name: he.auth.sendCode }).click();

  const codeInput = page.getByLabel(he.auth.code.label);
  await expect(codeInput).toBeFocused();
  let code: string | null = null;
  await expect
    .poll(async () => (code = await latestCode(email)), { timeout: 10_000 })
    .toMatch(/^\d{6}$/);
  await codeInput.fill(code ?? '');
  await page.getByRole('button', { name: he.auth.verify }).click();

  await expect(page).toHaveURL('/');
  await expect(header.getByText(he.header.greeting.replace('{{name}}', name))).toBeVisible();
  await expect(header.getByRole('link', { name: he.header.login })).toHaveCount(0);

  await header.getByRole('button', { name: he.header.logout }).click();
  await expect(header.getByRole('link', { name: he.header.login })).toBeVisible();
  await expect(header.getByText(he.header.greeting.replace('{{name}}', name))).toHaveCount(0);
});
