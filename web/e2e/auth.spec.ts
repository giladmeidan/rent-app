import { expect } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { expectNoAxeViolations } from './a11y';
import { API, GIS_STUB_BUTTON, latestCode, requestCode, uniqueEmail } from './helpers';
import { test } from './fixtures';

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
  const codeInput = await requestCode(page);
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

test('0016a_signup_with_password_then_password_login', async ({ page }) => {
  // Spec 0016a: one code at sign-up (with the optional password), then the password alone.
  const name = 'נועה';
  const email = uniqueEmail();
  const password = 'e2e password 0016a';
  const header = page.getByRole('banner');

  await page.goto('/signup');
  await page.getByText(he.auth.role.owner, { exact: true }).click();
  await page.getByLabel(he.auth.name.label).fill(name);
  await page.getByLabel(he.auth.password.optionalLabel).fill(password);
  await page.getByLabel(he.auth.email.label).fill(email);
  const codeInput = await requestCode(page);
  let code: string | null = null;
  await expect
    .poll(async () => (code = await latestCode(email)), { timeout: 10_000 })
    .toMatch(/^\d{6}$/);
  await codeInput.fill(code ?? '');
  await page.getByRole('button', { name: he.auth.verify }).click();
  await expect(page).toHaveURL('/me/listings');
  await header.getByRole('button', { name: he.header.logout }).click();
  await expect(header.getByRole('link', { name: he.header.login })).toBeVisible();

  await page.goto('/login');
  await page.getByRole('tab', { name: he.auth.login.mode.password }).click();
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(he.auth.email.label).fill(email);
  await panel.getByLabel(he.auth.password.label, { exact: true }).fill(password);
  await panel.getByRole('button', { name: he.auth.password.submit, exact: true }).click();

  await expect(page).toHaveURL('/me/listings');
  await expect(header.getByText(he.header.greeting.replace('{{name}}', name))).toBeVisible();
});

test('ac13_google_signup_then_login', async ({ page }) => {
  // Spec 0016b, CI only (its env renders the button): the GIS script is the stub, the API's
  // verifier is `fake`, so the credential is `fake:<sub>:<email>`.
  const name = 'גל';
  const email = uniqueEmail();
  // `uniqueEmail()`'s local part (`e2e-…`) is a valid fake `sub`.
  const credential = `fake:${email.split('@')[0] ?? 'e2e'}:${email}`;
  const header = page.getByRole('banner');
  await page.addInitScript(
    (value) => Object.assign(window, { __GSI_CREDENTIAL__: value }),
    credential,
  );

  await page.goto('/signup');
  await page.getByRole('button', { name: GIS_STUB_BUTTON }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: he.auth.google.step.title }),
  ).toBeVisible();
  await page.getByText(he.auth.role.owner, { exact: true }).click();
  await page.getByLabel(he.auth.name.label).fill(name);
  await page.getByRole('button', { name: he.auth.google.step.submit }).click();
  await expect(page).toHaveURL('/me/listings');
  await expect(header.getByText(he.header.greeting.replace('{{name}}', name))).toBeVisible();

  await header.getByRole('button', { name: he.header.logout }).click();
  await expect(header.getByRole('link', { name: he.header.login })).toBeVisible();
  await page.goto('/login');
  await page.getByRole('button', { name: GIS_STUB_BUTTON }).click();
  await expect(page).toHaveURL('/me/listings');
  await expect(header.getByText(he.header.greeting.replace('{{name}}', name))).toBeVisible();
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

test('ac5_auth_layout_desktop_and_mobile', async ({ page, baseURL }) => {
  // No sign-up and no email: the code request is answered here, for the web origin the API's CORS
  // allows (the config's base URL, from WEB_PORT).
  const cors = {
    'access-control-allow-origin': new URL(baseURL ?? 'http://localhost:5173').origin,
    'access-control-allow-credentials': 'true',
  };
  await page.route(`${API}/auth/otp/request`, (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({
          status: 204,
          headers: {
            ...cors,
            'access-control-allow-methods': 'POST',
            'access-control-allow-headers': 'content-type',
          },
        })
      : route.fulfill({ status: 204, headers: cors }),
  );
  const card = page.getByTestId('auth-card');

  // Desktop: one centred column, at most 480 px wide, with the cross-link under the card.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1, name: he.auth.login.title })).toBeVisible();
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(box.width).toBeLessThanOrEqual(480);
  expect(Math.abs(box.x - (clientWidth - (box.x + box.width)))).toBeLessThanOrEqual(2);
  const toSignup = await page.getByRole('link', { name: he.auth.login.toSignup }).boundingBox();
  expect(toSignup?.y ?? 0).toBeGreaterThanOrEqual(box.y + box.height);
  await expectNoAxeViolations(page, '/login step 1');

  // Sending the code reaches step 2.
  await page.getByLabel(he.auth.email.label).fill(uniqueEmail());
  await requestCode(page);
  await expect(page.getByRole('button', { name: he.auth.verify })).toBeVisible();
  await expectNoAxeViolations(page, '/login step 2');

  // Phone: no sideways scroll, the card fills the 16 px gutters, the primary button is 52 px.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/signup');
  await expect(page.getByRole('heading', { level: 1, name: he.auth.signup.title })).toBeVisible();
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  const phoneCard = await card.boundingBox();
  expect(Math.abs((phoneCard?.width ?? 0) - 358)).toBeLessThanOrEqual(1);
  const sendCode = await page.getByRole('button', { name: he.auth.sendCode }).boundingBox();
  expect(sendCode?.height ?? 0).toBeGreaterThanOrEqual(52);
});
