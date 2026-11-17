import { sentryVitePlugin } from '@sentry/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { htmlTags } from './html.config';
import { pwaOptions } from './pwa.config';
import tailwind from './tailwind.config';

const { colors } = tailwind.theme.extend;

// Source maps for Sentry (spec 0019a), only when SENTRY_AUTH_TOKEN is set (Gilad's local env for a
// deploy; never CI): built `hidden` (no sourceMappingURL), uploaded, then deleted from dist, so no
// map is ever served. Unset, the build is unchanged.
const sentryToken = process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  plugins: [
    react(),
    // Title, description, theme colour and the Hebrew font preload on every page (spec 0009e).
    htmlTags({ themeColor: colors.surface.DEFAULT }),
    // The installable app and its service worker; the caching policy is in pwa.config.ts.
    VitePWA(pwaOptions),
    sentryToken
      ? sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: sentryToken,
          telemetry: false,
          release: { name: process.env.VITE_SENTRY_RELEASE },
          sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        })
      : null,
  ],
  build: sentryToken ? { sourcemap: 'hidden' } : {},
  server: { host: '0.0.0.0', port: Number(process.env.WEB_PORT) || 5173, strictPort: true },
});
