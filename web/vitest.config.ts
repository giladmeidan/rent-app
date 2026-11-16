import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/__tests__/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    // No Google button unless a test stubs the client id (spec 0016b), locally and in CI alike.
    env: { VITE_API_URL: 'http://api.test', VITE_GOOGLE_CLIENT_ID: '' },
  },
});
