// Renders the app icons and favicons from web/icons/*.svg with Playwright's Chromium (spec 0009e).
//
// Usage: make icons   (installs Chromium, then runs: node scripts/make-icons.mjs)
//
// Writes web/public/icons/{icon-192,icon-512,icon-maskable-192,icon-maskable-512,apple-touch-icon,
// favicon-32}.png and copies icons/favicon.svg to web/public/favicon.svg. The outputs are committed;
// CI never regenerates them. The "any" icons and the favicon keep a transparent background
// (omitBackground); the maskable icons and the apple-touch-icon are full bleed and opaque.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(webDir, 'icons');
const outDir = join(webDir, 'public', 'icons');

/** [source svg, output png, size in px, transparent background] */
const TARGETS = [
  ['icon.svg', 'icon-192.png', 192, true],
  ['icon.svg', 'icon-512.png', 512, true],
  ['icon-maskable.svg', 'icon-maskable-192.png', 192, false],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512, false],
  ['icon-maskable.svg', 'apple-touch-icon.png', 180, false],
  ['favicon.svg', 'favicon-32.png', 32, true],
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [source, output, size, transparent] of TARGETS) {
    const svg = readFileSync(join(srcDir, source)).toString('base64');
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      '<!doctype html><html><head><style>html,body{margin:0;background:transparent}' +
        'img{display:block}</style></head><body>' +
        `<img src="data:image/svg+xml;base64,${svg}" width="${size}" height="${size}" alt=""></body></html>`,
    );
    await page.locator('img').evaluate((img) => img.decode());
    await page.screenshot({ path: join(outDir, output), omitBackground: transparent });
    await page.close();
    console.log(`public/icons/${output} (${size}px)`);
  }
} finally {
  await browser.close();
}
copyFileSync(join(srcDir, 'favicon.svg'), join(webDir, 'public', 'favicon.svg'));
console.log('public/favicon.svg');
