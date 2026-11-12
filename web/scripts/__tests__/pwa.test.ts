import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ManifestOptions } from 'vite-plugin-pwa';
import { describe, expect, it } from 'vitest';

import { pwaOptions } from '../../pwa.config';
import he from '../../src/locales/he.json';
import tailwind from '../../tailwind.config';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { colors } = tailwind.theme.extend;

function manifest(): Partial<ManifestOptions> {
  const { manifest } = pwaOptions;
  if (manifest === undefined || manifest === false) throw new Error('pwaOptions.manifest is unset');
  return manifest;
}

/** Width, height and colour type from a PNG's IHDR. */
function ihdr(path: string): { width: number; height: number; colorType: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString('latin1'), path).toBe('PNG');
  expect(bytes.subarray(12, 16).toString('latin1'), path).toBe('IHDR');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes.readUInt8(25),
  };
}

describe('pwa', () => {
  it('ac2_manifest', () => {
    const m = manifest();
    expect(m.name).toBe(he.app.title);
    expect(m.short_name).toBe(he.app.title);
    expect(m.description).toBe(he.app.tagline);
    expect(m).toMatchObject({
      lang: 'he',
      dir: 'rtl',
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
    // The page background (body is bg-surface) is the splash; the header surface is the status bar.
    expect(m.background_color).toBe(colors.surface.DEFAULT);
    expect(m.theme_color).toBe(colors.surface.DEFAULT);
    expect(
      (m.icons ?? []).map(({ src, sizes, type, purpose }) => ({ src, sizes, type, purpose })),
    ).toEqual([
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
    ]);
  });

  it('ac3_icons', () => {
    const files = [
      ...(manifest().icons ?? []).map(({ src, sizes, purpose }) => ({ src, sizes, purpose })),
      { src: '/icons/apple-touch-icon.png', sizes: '180x180', purpose: 'opaque' },
      { src: '/icons/favicon-32.png', sizes: '32x32', purpose: 'any' },
    ];
    for (const { src, sizes, purpose } of files) {
      const path = join(webDir, 'public', src);
      expect(existsSync(path), src).toBe(true);
      const { width, height, colorType } = ihdr(path);
      expect(`${width}x${height}`, src).toBe(sizes);
      // RGBA: the `any` icons and the favicon keep a transparent background.
      if (purpose === 'any') expect(colorType, src).toBe(6);
    }
    expect(existsSync(join(webDir, 'public', 'favicon.svg'))).toBe(true);
    expect(readFileSync(join(webDir, 'public', 'favicon.svg'), 'utf8')).toBe(
      readFileSync(join(webDir, 'icons', 'favicon.svg'), 'utf8'),
    );
    const sources = readdirSync(join(webDir, 'icons')).filter((name) => name.endsWith('.svg'));
    expect(sources.sort()).toEqual(['favicon.svg', 'icon-maskable.svg', 'icon.svg']);
    for (const name of sources) {
      expect(readFileSync(join(webDir, 'icons', name), 'utf8'), name).toContain(
        colors.accent.DEFAULT,
      );
    }
  });

  it('ac4_sw_policy', () => {
    const { workbox } = pwaOptions;
    if (workbox === undefined) throw new Error('pwaOptions.workbox is unset');
    expect(Object.keys(workbox).sort()).toEqual([
      'cleanupOutdatedCaches',
      'globIgnores',
      'globPatterns',
      'navigateFallback',
      'navigateFallbackDenylist',
    ]);
    expect(workbox.globPatterns).toEqual([
      '**/*.{js,css,html}',
      'assets/rubik-{hebrew,latin}-wght-normal-*.woff2',
      'assets/fredoka-{hebrew,latin}-wght-normal-*.woff2',
      'assets/homie-lockup-he-*.svg',
    ]);
    expect(workbox.globIgnores).toEqual(['**/maplibre-gl-*']);
    expect(workbox.navigateFallback).toBe('index.html');
    expect(workbox.navigateFallbackDenylist).toEqual([/^\/api\//]);
    expect(workbox.navigateFallbackDenylist?.some((re) => re.test('/api/x'))).toBe(true);
    expect(workbox.navigateFallbackDenylist?.some((re) => re.test('/search'))).toBe(false);
    expect(workbox.cleanupOutdatedCaches).toBe(true);
    for (const key of ['strategies', 'injectManifest', 'selfDestroying', 'devOptions'] as const) {
      expect(pwaOptions[key], key).toBeUndefined();
    }
    expect(pwaOptions.registerType).toBe('autoUpdate');
  });

  it('ac5_plugin_is_dev_only', () => {
    const pkg = JSON.parse(readFileSync(join(webDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies).toHaveProperty('vite-plugin-pwa');
    expect(pkg.dependencies).not.toHaveProperty('vite-plugin-pwa');
  });
});
