import { randomUUID } from 'node:crypto';

import { expect, type Page } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { expectNoAxeViolations } from './a11y';
import { GIS_STUB_BUTTON, routeTiles, uniqueEmail } from './helpers';
import { test } from './fixtures';

// No sign-up and no data (spec 0009c): every page here is public and renders the same on an empty
// or a shared database. The signed-in pages are checked inside the existing flows (Scope 7).

/** Nothing on the page is loading any more (the header's session check included). */
async function settled(page: Page) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
}

test('ac5_public_pages_pass_axe', async ({ page }) => {
  // The list view, below 1280 px: no side map, which mounts after idle and has its own axe run
  // (map.spec.ts ac6, spec 0009x).
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('/search');
  await expect(page.getByRole('heading', { level: 1, name: he.search.title })).toBeVisible();
  await settled(page);
  await expectNoAxeViolations(page, '/search');
  if (viewport !== null) await page.setViewportSize(viewport);

  // The map view, its tiles answered locally, once the map has loaded.
  await routeTiles(page);
  await page.goto('/search?view=map');
  const region = page.getByRole('region', { name: he.search.map.label });
  await expect(region).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await settled(page);
  // Pins that would overlap fold into count bubbles (spec 0009v): no exemption for the pins.
  await expectNoAxeViolations(page, '/search?view=map');

  // Log in and sign up.
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1, name: he.auth.login.title })).toBeVisible();
  await settled(page);
  await expectNoAxeViolations(page, '/login');
  // Password mode (spec 0016a AC16): the switch, the shown password and a 401's alert.
  await page.getByRole('tab', { name: he.auth.login.mode.password }).click();
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(he.auth.email.label).fill(`a11y-${randomUUID()}@example.com`);
  await panel.getByLabel(he.auth.password.label, { exact: true }).fill('not the password');
  await panel.getByRole('button', { name: he.auth.password.show }).click();
  await expect(panel.getByRole('button', { name: he.auth.password.hide })).toBeVisible();
  await panel.getByRole('button', { name: he.auth.password.submit, exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText(he.auth.password.invalid);
  await settled(page);
  await expectNoAxeViolations(page, '/login (password)');
  await page.goto('/signup');
  await expect(page.getByRole('heading', { level: 1, name: he.auth.signup.title })).toBeVisible();
  await settled(page);
  await expectNoAxeViolations(page, '/signup');
  // Spec 0016b NF2 (CI renders the stub Google button): the "one more step" panel of a new email.
  await page.addInitScript(
    (value) => Object.assign(window, { __GSI_CREDENTIAL__: value }),
    `fake:a11y-${randomUUID()}:${uniqueEmail()}`,
  );
  await page.goto('/signup');
  await page.getByRole('button', { name: GIS_STUB_BUTTON }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: he.auth.google.step.title }),
  ).toBeVisible();
  await settled(page);
  await expectNoAxeViolations(page, '/signup (Google panel)');

  // The join page without a token: its "invalid link" state.
  await page.goto('/flatmates/join');
  await expect(page.getByText(he.flatmates.join.invalid)).toBeVisible();
  await settled(page);
  await expectNoAxeViolations(page, '/flatmates/join');

  // An unknown listing: the not-found page.
  await page.goto(`/listings/${randomUUID()}`);
  await expect(page.getByRole('heading', { level: 1, name: he.listing.notFound })).toBeVisible();
  await settled(page);
  await expectNoAxeViolations(page, '/listings/<unknown>');
});

test('ac6_skip_link_and_route_focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/search');
  await expect(page.getByRole('heading', { level: 1, name: he.search.title })).toBeVisible();
  await settled(page);

  // A page long enough to scroll, scrolled to the bottom.
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '2000px';
    document.body.append(spacer);
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  // The first Tab shows the skip link; Enter moves focus to <main>.
  const skip = page.getByRole('link', { name: he.a11y.skipToMain });
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  const main = page.locator('main#main');
  await expect(main).toBeFocused();
  await expect(page).toHaveURL('/search');

  // An in-app navigation starts the new page at the top, with focus on <main> and its title. The
  // page is scrolled away from the header first, and the link is clicked from script: Playwright's
  // own click would scroll the link (at the top) into view and hide a missing scroll reset.
  await page.evaluate(() => window.scrollTo(0, 99999));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const login = page.getByRole('banner').getByRole('link', { name: he.header.login });
  await expect(login).toHaveAttribute('href', '/login');
  await login.evaluate((link: HTMLAnchorElement) => link.click());
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading', { level: 1, name: he.auth.login.title })).toBeVisible();
  await expect(main).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(async () => (await page.title()).endsWith(he.app.title)).toBe(true);
});

test('ac7_reduced_motion', async ({ page }) => {
  /** The computed `animation-duration` of a pulsing skeleton appended to the page, in seconds. */
  const pulseSeconds = () =>
    page.evaluate(() => {
      const pulse = document.createElement('div');
      pulse.className = 'animate-pulse';
      document.body.append(pulse);
      const duration = getComputedStyle(pulse).animationDuration;
      pulse.remove();
      return parseFloat(duration);
    });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/search');
  await expect(page.getByRole('heading', { level: 1, name: he.search.title })).toBeVisible();
  expect(await pulseSeconds()).toBeLessThanOrEqual(0.001);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await pulseSeconds()).toBe(2);
});
