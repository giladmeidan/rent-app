import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/__tests__/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    env: { VITE_API_URL: 'http://api.test' },
  },
});
