import { defineConfig, devices } from '@playwright/test';

import { WEB_ORIGIN } from './e2e/screens/origin';

// The visual check of the 9b specs (`make screens`): a screenshot per UI state, at a phone and a
// desktop size, written to web/screens/<spec>/. Not part of `make e2e` (testMatch is `*.screens.ts`).
// It needs only the vite server (`make dev`): the scripts answer every API request themselves.
export default defineConfig({
  testDir: 'e2e/screens',
  testMatch: '*.screens.ts',
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { baseURL: WEB_ORIGIN },
  // Software WebGL for the map, as playwright.config.ts: otherwise the map renders "unavailable".
  projects: [
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
});
