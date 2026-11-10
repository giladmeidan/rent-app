import { defineConfig, devices } from '@playwright/test';

// Runs against the compose stack (`make dev`). The API's CORS allows exactly
// http://localhost:5173, so the base URL must be that origin, not 127.0.0.1.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
