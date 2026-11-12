import type { VitePWAOptions } from 'vite-plugin-pwa';

import he from './src/locales/he.json';
import tailwind from './tailwind.config';

const { colors } = tailwind.theme.extend;

/**
 * The installable app (spec 0009e). The name and description come from he.json, the colours from the
 * brand tokens: the page background (`surface`) is also the splash screen, and the header surface is
 * the installed app's status bar.
 *
 * Service-worker policy, the security rule of this spec: the worker precaches only the build's own
 * files and serves the app shell to navigations. It has no runtime route, so every API request
 * (another origin, carrying the `rent_session` cookie), the map tiles, the map style and the lazy map
 * chunk always go to the network and never enter Cache Storage. Do not add `runtimeCaching`,
 * `importScripts`, `inlineWorkboxRuntime`, `strategies` or `injectManifest`; `make build-check`
 * fails on them.
 *
 * Rollback lever: `selfDestroying: true` ships a worker that unregisters itself.
 */
export const pwaOptions: Partial<VitePWAOptions> = {
  // autoUpdate = skipWaiting + clientsClaim: a new deploy takes over on the next navigation, with no
  // prompt and no forced reload (a reload could lose a wizard step or a chat draft).
  registerType: 'autoUpdate',
  injectRegister: 'auto',
  manifest: {
    // A fixed id keeps an installed app's identity across a later rename.
    id: '/',
    name: he.app.title,
    short_name: he.app.title,
    description: he.app.tagline,
    lang: 'he',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: colors.surface.DEFAULT,
    theme_color: colors.surface.DEFAULT,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html}', 'assets/rubik-{hebrew,latin}-wght-normal-*.woff2'],
    // The lazy map library (~300 kB gzip) is fetched only when a map is shown, never precached.
    // workbox-build ignores sw.js and workbox-*.js itself.
    globIgnores: ['**/maplibre-gl-*'],
    // Navigations get the app shell: the same HTML for every visitor, with no personal data.
    navigateFallback: 'index.html',
    // A guard in case the API is ever proxied on the web origin.
    navigateFallbackDenylist: [/^\/api\//],
    cleanupOutdatedCaches: true,
  },
};
