import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { htmlTags } from './html.config';
import { pwaOptions } from './pwa.config';
import tailwind from './tailwind.config';

const { colors } = tailwind.theme.extend;

export default defineConfig({
  plugins: [
    react(),
    // Title, description, theme colour and the Hebrew font preload on every page (spec 0009e).
    htmlTags({ themeColor: colors.surface.DEFAULT }),
    // The installable app and its service worker; the caching policy is in pwa.config.ts.
    VitePWA(pwaOptions),
  ],
  server: { host: '0.0.0.0', port: Number(process.env.WEB_PORT) || 5173, strictPort: true },
});
