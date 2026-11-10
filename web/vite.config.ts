import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Minimal manifest + service-worker registration (installability is Slice 9).
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        // The product name is the only hardcoded Hebrew allowed outside he.json (spec 0000b);
        // i18n-check whitelists this file. Final branding is Slice 9.
        name: 'דירה',
        short_name: 'דירה',
        lang: 'he',
        dir: 'rtl',
        start_url: '/',
        display: 'standalone',
        background_color: '#F7F5F2',
        theme_color: '#0E7C6B',
      },
    }),
  ],
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
});
