import {
  test as base,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
} from '@playwright/test';

import { routeTiles, TILE } from './helpers';

/**
 * Playwright's `test` with every OSM tile answered locally (spec 0009x AC7): the default 1280 px
 * viewport shows the side map on `/search`, so no test may fetch public tiles. The auto fixture
 * covers the fixture `page`'s context; a test that opens another context must create it with
 * `newTileContext`. A test that calls `routeTiles(page, failing)` itself still wins, its route
 * being the later one.
 */
export const test = base.extend<{ tiles: undefined }>({
  tiles: [
    async ({ page }, use) => {
      await routeTiles(page);
      await use(undefined);
    },
    { auto: true },
  ],
});

/** `browser.newContext(options)` with every OSM tile answered locally, as the auto fixture does. */
export async function newTileContext(
  browser: Browser,
  options?: BrowserContextOptions,
): Promise<BrowserContext> {
  const context = await browser.newContext(options);
  await context.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE }),
  );
  return context;
}
