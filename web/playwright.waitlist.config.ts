import { defineConfig, devices } from '@playwright/test';

import { WAITLIST_PORT } from './e2e/waitlist/port';

// The waitlist page test (spec 0017): waitlist/public served as static files, every API call stubbed
// with page.route. Not `make e2e` (testMatch is `*.waitlist.ts`): no compose stack, no API. It runs from
// `make test` (test-waitlist). A port taken by another worktree fails instead of serving other files;
// WAITLIST_PORT (default 4179) picks another one.

export default defineConfig({
  testDir: 'e2e/waitlist',
  testMatch: '*.waitlist.ts',
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  outputDir: 'test-results/waitlist',
  use: {
    baseURL: `http://127.0.0.1:${WAITLIST_PORT}`,
    locale: 'he-IL',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `python3 -m http.server ${WAITLIST_PORT} --bind 127.0.0.1 --directory ../waitlist/public`,
    url: `http://127.0.0.1:${WAITLIST_PORT}/index.html`,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'ignore',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
