import { expect, test } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };

test('ac8_shell_renders_rtl_with_areas', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html[dir=rtl][lang=he]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: he.areas.heading })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'גוש דן' })).toBeVisible();
});
