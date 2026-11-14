import { expect, type Locator } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { expectNoAxeViolations } from './a11y';
import { test } from './fixtures';

// The title's line break (whitespace-pre-line) reads as a space.
const TITLE = he.landing.title.replace('\n', ' ');

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b ?? { x: 0, y: 0, width: 0, height: 0 };
}

const noHorizontalScroll = () =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth;

// Spec 0009a AC8: the landing for a visitor, with no sign-up. Replaces 0000's smoke check. Spec
// 0009z: reduced motion first, so axe never catches a card mid-fade (opacity counts in contrast);
// the CTA clicks are scoped to the hero, since their names repeat further down the page.
test('ac8_landing_smoke', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
  const hero = page.getByRole('main').getByRole('region', { name: TITLE });
  await hero.getByRole('link', { name: he.landing.cta.owner, exact: true }).click();
  await expect(page).toHaveURL('/signup?role=owner&next=%2Flistings%2Fnew');
  await expect(page.getByRole('radio', { name: he.auth.role.owner })).toBeChecked();

  // Back on `/`, the seeker CTA opens the public search.
  await page.goBack();
  await expect(page).toHaveURL('/');
  await hero.getByRole('link', { name: he.landing.cta.seeker, exact: true }).click();
  await expect(page).toHaveURL('/search');
  await expect(page.getByRole('heading', { level: 1, name: he.search.title })).toBeVisible();
});

/** A card's motion state: its opacity and any transform or translate on it. */
const motion = (locator: Locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { opacity: style.opacity, transform: style.transform, translate: style.translate };
  });

const still = { opacity: '1', transform: 'none', translate: 'none' };

// Spec 0009z AC10: a phone never scrolls sideways (the listings row scrolls inside itself), and the
// static sections are one column: the doors and both "how" sides stack, full width.
test('ac10_phone_no_overflow', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(noHorizontalScroll)).toBe(true);

  // The five static sections, top to bottom, each as wide as the first.
  const names = [
    TITLE,
    he.landing.doors.title,
    he.landing.how.title,
    he.landing.faq.title,
    he.landing.closing.title,
  ];
  const sections: Box[] = [];
  for (const name of names) sections.push(await box(main.getByRole('region', { name })));
  const first = sections[0] ?? { x: 0, y: 0, width: 0, height: 0 };
  sections.forEach((section, i) => {
    expect(Math.abs(section.x - first.x)).toBeLessThan(1);
    expect(Math.abs(section.width - first.width)).toBeLessThan(1);
    const before = sections[i - 1];
    if (before !== undefined)
      expect(section.y).toBeGreaterThanOrEqual(before.y + before.height - 1);
  });

  // Inside them, one column: each door and each side sits under the one before, at the same x.
  const stacked = async (cards: Locator) => {
    const boxes: Box[] = [];
    for (const card of await cards.all()) boxes.push(await box(card));
    expect(boxes.length).toBeGreaterThan(1);
    const top = boxes[0] ?? { x: 0, y: 0, width: 0, height: 0 };
    boxes.forEach((b, i) => {
      expect(Math.abs(b.x - top.x)).toBeLessThan(1);
      expect(Math.abs(b.width - top.width)).toBeLessThan(1);
      const before = boxes[i - 1];
      if (before !== undefined) expect(b.y).toBeGreaterThanOrEqual(before.y + before.height - 1);
    });
  };
  await stacked(main.locator('[data-door]'));
  await stacked(main.locator('[data-side]'));

  // Still no sideways scroll at the end of the page.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(noHorizontalScroll)).toBe(true);
});

// Spec 0009z AC11: with reduced motion, a door and a step card never fade or move: not on load,
// not after scrolling them into view, and the door does not lift on hover.
test('ac11_reduced_motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const door = page.locator('[data-door="map"]');
  const step = page.locator('[data-side="seeker"]');

  expect(await motion(door)).toEqual(still);
  expect(await motion(step)).toEqual(still);

  await door.scrollIntoViewIfNeeded();
  await door.hover();
  expect(await motion(door)).toEqual(still);
  await step.scrollIntoViewIfNeeded();
  expect(await motion(step)).toEqual(still);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await motion(door)).toEqual(still);
  expect(await motion(step)).toEqual(still);
});
