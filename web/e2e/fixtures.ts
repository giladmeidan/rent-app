import { test as base } from '@playwright/test';

import { routeTiles } from './helpers';

/**
 * Playwright's `test` with every OSM tile answered locally (spec 0009x): the default 1280 px viewport
 * shows the side map on `/search`, so no test may fetch public tiles. A test that calls
 * `routeTiles(page, failing)` itself still wins, its route being the later one.
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
