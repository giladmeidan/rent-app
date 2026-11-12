import { defineConfig, devices } from '@playwright/test';

// Visual check (`make screens`): screenshot scripts, not tests. They live in e2e/screens as
// `*.screens.ts`, which `playwright.config.ts` (testMatch `*.spec.ts`) never picks up, so
// `make e2e` does not run them. Run against the compose stack's web (`make dev`); every API call
// is mocked in the script. Output: web/screens/<spec>/<state>-<project>.png (git-ignored).
export default defineConfig({
  testDir: 'e2e/screens',
  testMatch: '*.screens.ts',
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { baseURL: `http://localhost:${process.env.WEB_PORT || 5173}` },
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
