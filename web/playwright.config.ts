import { defineConfig, devices } from '@playwright/test';

// Runs against the compose stack (`make dev`). The API's CORS allows exactly
// http://localhost:5173, so the base URL must be that origin, not 127.0.0.1.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Software WebGL for the map (spec 0003d): recent Chrome no longer falls back to it on its
        // own, and the GPU-less CI runner has no other WebGL.
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
});
