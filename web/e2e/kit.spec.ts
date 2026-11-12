import { expect, test } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };

// The dev-only kit gallery (spec 0009d): the real <dialog> modal, the RTL tabs, the brand assets
// and fonts in Chromium. No sign-up, no API call.
const count0 = (label: string) => label.replace('{{count}}', '0');

test('ac11_dialog_tabs_brand_in_browser', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/dev/kit');
  const h1 = page.getByRole('heading', { level: 1, name: he.app.title });
  await expect(h1).toBeVisible();

  // ---- The dialog (useConfirm, tone danger) ----
  const leave = he.flatmates.mine.leave;
  const opener = page.getByRole('button', { name: leave, exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: he.flatmates.mine.leaveConfirm });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.matches(':modal'))).toBe(true);
  await expect(dialog.getByRole('button', { name: he.common.cancel, exact: true })).toBeFocused();

  // One Tab keeps focus inside the modal.
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  // Escape closes it, and focus is back on the opener.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  // Reopen; the confirm button closes it, and focus returns.
  await opener.click();
  await expect(dialog).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: leave }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  // ---- The tabs: in RTL, ArrowLeft is next; End is the last ----
  const tablist = page.getByRole('tablist', { name: he.applicants.filter.label });
  const tab = (label: string) => tablist.getByRole('tab', { name: count0(label), exact: true });
  await tab(he.applicants.filter.all).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tab(he.applicants.filter.new)).toHaveAttribute('aria-selected', 'true');
  await expect(tab(he.applicants.filter.new)).toBeFocused();
  await page.keyboard.press('End');
  await expect(tab(he.applicants.filter.declined)).toHaveAttribute('aria-selected', 'true');
  await expect(tab(he.applicants.filter.declined)).toBeFocused();

  // ---- The brand assets resolve ----
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.images].map((img) => ({
          src: img.getAttribute('src'),
          ok: img.complete && img.naturalWidth > 0,
        })),
      ),
    )
    .toEqual(expect.not.arrayContaining([expect.objectContaining({ ok: false })]));
  expect(await page.locator('img').count()).toBeGreaterThanOrEqual(11);

  // ---- The brand fonts, self-hosted ----
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const title = document.querySelector('h1') as HTMLElement;
    // The h1's own (Hebrew) text has been drawn in Fredoka 600.
    const titleLoaded = document.fonts.check('600 24px Fredoka', title.textContent ?? '');
    // `check` without text tests a space, which is in the Latin subset; a Hebrew-only page may
    // not have needed it yet, so ask for it first (a missing or broken file still fails `check`).
    await document.fonts.load('600 24px Fredoka');
    await document.fonts.ready;
    // The faces actually loaded from the app's own origin.
    const loaded = [...document.fonts]
      .filter((face) => face.status === 'loaded')
      .map((face) => face.family.replace(/["']/g, ''));
    return {
      loaded,
      h1: getComputedStyle(title).fontFamily,
      body: getComputedStyle(document.body).fontFamily,
      titleLoaded,
      fredoka: document.fonts.check('600 24px Fredoka'),
    };
  });
  expect(fonts.h1).toMatch(/^Fredoka\b/);
  expect(fonts.body).toMatch(/^"Rubik Variable"/);
  expect(fonts.titleLoaded).toBe(true);
  expect(fonts.fredoka).toBe(true);
  expect(fonts.loaded).toEqual(expect.arrayContaining(['Fredoka', 'Rubik Variable']));

  // ---- A phone: no horizontal scroll ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dev/kit');
  await expect(h1).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test('dialog_focus_not_stolen_after_close', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/dev/kit');
  const leave = he.flatmates.mine.leave;
  await page.getByRole('button', { name: leave, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: he.flatmates.mine.leaveConfirm });
  await expect(dialog).toBeVisible();

  // Confirm; the moment the dialog closes (before Chrome's `close` event, a task later), move
  // focus elsewhere, as an awaited `confirm()` caller would; 50 ms later it must still be there.
  const kept = await dialog.evaluate(async (el, label) => {
    const modal = el as HTMLDialogElement;
    const other = document.querySelector('[role="tab"]') as HTMLElement;
    const closed = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (modal.open) return;
        observer.disconnect();
        other.focus();
        resolve();
      });
      observer.observe(modal, { attributes: true, attributeFilter: ['open'] });
    });
    const confirmButton = [...modal.querySelectorAll('button')].find(
      (button) => button.textContent === label,
    ) as HTMLButtonElement;
    confirmButton.click();
    await closed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return document.activeElement === other;
  }, leave);
  await expect(dialog).toBeHidden();
  expect(kept).toBe(true);
});
