import { expect, type Locator } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { expectNoAxeViolations } from './a11y';
import { test } from './fixtures';

// The title's line break (whitespace-pre-line) reads as a space.
const TITLE = he.landing.title.replace('\n', ' ');

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b ?? { x: 0, y: 0, width: 0, height: 0 };
}

const noHorizontalScroll = () =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth;

// Spec 0009a AC8: the landing for a visitor, with no sign-up. Replaces 0000's smoke check.
test('ac8_landing_smoke', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('html[dir=rtl][lang=he]')).toHaveCount(1);
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveCount(1);
  await expect(h1).toBeVisible();
  expect((await h1.innerText()).replace(/\s+/g, ' ').trim()).toBe(TITLE);

  // The brand fonts, self-hosted: Fredoka for the <h1>, Rubik for the body.
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const title = document.querySelector('h1') as HTMLElement;
    await document.fonts.load('600 32px "Fredoka Variable"', title.textContent ?? '');
    await document.fonts.load('400 16px "Rubik Variable"', document.body.innerText.slice(0, 200));
    await document.fonts.ready;
    return {
      loaded: [...document.fonts]
        .filter((face) => face.status === 'loaded')
        .map((face) => face.family.replace(/["']/g, '')),
      h1: getComputedStyle(title).fontFamily,
      body: getComputedStyle(document.body).fontFamily,
    };
  });
  expect(fonts.loaded).toEqual(expect.arrayContaining(['Fredoka Variable', 'Rubik Variable']));
  expect(fonts.h1).toMatch(/^"Fredoka Variable"/);
  expect(fonts.body).toMatch(/^"Rubik Variable"/);

  // The banner: "כניסה" in the nav, no "הרשמה".
  const banner = page.getByRole('banner');
  const nav = banner.getByRole('navigation', { name: he.nav.label });
  await expect(nav.getByRole('link', { name: he.header.login, exact: true })).toBeVisible();
  await expect(banner.getByRole('link', { name: he.header.signup })).toHaveCount(0);

  // A phone: one column, no horizontal scroll, no axe violation.
  expect(await page.evaluate(noHorizontalScroll)).toBe(true);
  await expectNoAxeViolations(page, '/ at 390');

  // A desktop: the <h1> and the example figure side by side (the figure in the inline-end
  // column, the left in RTL).
  await page.setViewportSize({ width: 1280, height: 800 });
  const figure = page.getByRole('figure');
  await expect(figure).toBeVisible();
  const title = await box(h1);
  const example = await box(figure);
  expect(title.y < example.y + example.height && example.y < title.y + title.height).toBe(true);
  expect(example.x + example.width).toBeLessThanOrEqual(title.x);
  expect(await page.evaluate(noHorizontalScroll)).toBe(true);
  await expectNoAxeViolations(page, '/ at 1280');

  // The owner CTA opens signup with the owner role chosen (not submitted).
  const main = page.getByRole('main');
  await main.getByRole('link', { name: he.landing.cta.owner, exact: true }).click();
  await expect(page).toHaveURL('/signup?role=owner&next=%2Flistings%2Fnew');
  await expect(page.getByRole('radio', { name: he.auth.role.owner })).toBeChecked();

  // Back on `/`, the seeker CTA opens the public search.
  await page.goBack();
  await expect(page).toHaveURL('/');
  await main.getByRole('link', { name: he.landing.cta.seeker, exact: true }).click();
  await expect(page).toHaveURL('/search');
  await expect(page.getByRole('heading', { level: 1, name: he.search.title })).toBeVisible();
});
