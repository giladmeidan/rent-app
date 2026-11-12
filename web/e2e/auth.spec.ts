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

  await expect(page).toHaveURL('/me/listings');
  await expect(header.getByText(he.header.greeting.replace('{{name}}', name))).toBeVisible();
  await expect(header.getByRole('link', { name: he.header.login })).toHaveCount(0);

  await header.getByRole('button', { name: he.header.logout }).click();
  await expect(header.getByRole('link', { name: he.header.login })).toBeVisible();
  await expect(header.getByText(he.header.greeting.replace('{{name}}', name))).toHaveCount(0);
});

test('ac1_offline_request_fails_fast', async ({ page, context }) => {
  // 0009f Q9: offline, sending the code fails at once with the offline line (no paused request).
  const email = uniqueEmail();
  await page.goto('/login');
  await page.getByLabel(he.auth.email.label).fill(email);
  await context.setOffline(true);
  await page.getByRole('button', { name: he.auth.sendCode }).click();
  await expect(page.getByRole('alert')).toContainText(he.common.offline.split('.')[0] ?? '', {
    timeout: 5_000,
  });

  // Back online, the retry sends the code and step 2 opens.
  await context.setOffline(false);
  await page.getByRole('button', { name: he.common.retry }).click();
  await expect(page.getByLabel(he.auth.code.label)).toBeVisible();
});
