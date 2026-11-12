import { expect, test, type Locator, type Page } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };

// The full-width shell (spec 0009h): public pages only, no sign-up. A screen spec that changes a
// measured page's width updates this test.
const MISSING_LISTING = '/listings/00000000-0000-4000-8000-000000000000';

type Box = {
  width: number;
  left: number;
  right: number;
  paddingLeft: number;
  paddingRight: number;
};

/** The computed width and padding, and the offsets of the border box from the viewport's sides. */
function box(locator: Locator): Promise<Box> {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      width: parseFloat(style.width),
      left: rect.left,
      right: document.documentElement.clientWidth - rect.right,
      paddingLeft: parseFloat(style.paddingLeft),
      paddingRight: parseFloat(style.paddingRight),
    };
  });
}

async function open(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

const header = (page: Page) => page.locator('header > .max-w-wide');
const narrow = (page: Page) => page.locator('main > .max-w-narrow');
const wide = (page: Page) => page.locator('main > .max-w-wide');

test('ac6_desktop_widths', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  // A form page: 480px of content, centred.
  await open(page, '/login', he.auth.login.title);
  await expect(narrow(page)).toHaveCount(1);
  let b = await box(narrow(page));
  expect(b.width).toBe(480);
  expect(Math.abs(b.left - b.right)).toBeLessThanOrEqual(1);

  // The page is surface white.
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(255, 255, 255)',
  );

  // The header's container: the viewport less the lg gutters, up to 1336px.
  await expect(header(page)).toHaveCount(1);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  b = await box(header(page));
  expect(b.width).toBe(Math.min(1336, clientWidth - 64));
  expect(Math.abs(b.left - b.right)).toBeLessThanOrEqual(1);

  // The listing page (public, not found here) is wide, for its two columns: the viewport less the
  // lg gutters, up to 1336px, centred.
  await open(page, MISSING_LISTING, he.listing.notFound);
  await expect(wide(page)).toHaveCount(1);
  b = await box(wide(page));
  expect(b.width).toBe(Math.min(1336, clientWidth - 64));
  expect(Math.abs(b.left - b.right)).toBeLessThanOrEqual(1);

  // A wide screen: the header stops at 1336px, centred.
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(header(page)).toHaveCount(1);
  b = await box(header(page));
  expect(b.width).toBe(1336);
  expect(Math.abs(b.left - b.right)).toBeLessThanOrEqual(1);
});

test('ac7_mobile_gutters', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pages: [string, string, (p: Page) => Locator][] = [
    ['/login', he.auth.login.title, narrow],
    ['/signup', he.auth.signup.title, narrow],
    [MISSING_LISTING, he.listing.notFound, wide],
  ];
  for (const [path, heading, container] of pages) {
    await open(page, path, heading);
    await expect(container(page)).toHaveCount(1);
    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scroll.scrollWidth, `${path} scrolls sideways`).toBeLessThanOrEqual(scroll.clientWidth);
    const b = await box(container(page));
    expect(b.paddingLeft, path).toBe(16);
    expect(b.paddingRight, path).toBe(16);
  }
});
