import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Rollup } from 'vite';
import type { HtmlTagDescriptor, IndexHtmlTransformContext, ResolvedConfig } from 'vite';
import { describe, expect, it, vi } from 'vitest';

import { htmlTags } from '../../html.config';
import he from '../../src/locales/he.json';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Runs the plugin's `transformIndexHtml.handler` directly, with base `/` and an optional bundle. */
async function headTags(
  bundleFiles?: string[],
  factory: typeof htmlTags = htmlTags,
): Promise<HtmlTagDescriptor[]> {
  const plugin = factory({ themeColor: '#ABCDEF' });
  const { configResolved, transformIndexHtml } = plugin;
  if (typeof configResolved !== 'function') throw new Error('configResolved is not a function');
  if (transformIndexHtml === undefined || typeof transformIndexHtml === 'function') {
    throw new Error('transformIndexHtml is not an { order, handler } object');
  }
  expect(transformIndexHtml.order).toBe('post');
  await configResolved.call({} as never, { base: '/' } as ResolvedConfig);
  const bundle =
    bundleFiles === undefined
      ? undefined
      : (Object.fromEntries(
          bundleFiles.map((fileName) => [fileName, { type: 'asset', fileName }]),
        ) as unknown as Rollup.OutputBundle);
  const ctx = { path: '/index.html', filename: 'index.html', bundle } as IndexHtmlTransformContext;
  return (await transformIndexHtml.handler.call(
    {} as never,
    '<html></html>',
    ctx,
  )) as HtmlTagDescriptor[];
}

describe('ac1_head_tags', () => {
  it('without a bundle returns title, description and theme-color in head, and no preload', async () => {
    const tags = await headTags();
    expect(tags).toEqual([
      { tag: 'title', children: he.app.title, injectTo: 'head' },
      {
        tag: 'meta',
        attrs: { name: 'description', content: he.app.tagline },
        injectTo: 'head',
      },
      { tag: 'meta', attrs: { name: 'theme-color', content: '#ABCDEF' }, injectTo: 'head' },
    ]);
  });

  it('with the Hebrew Rubik file in the bundle also returns its preload under base /', async () => {
    const tags = await headTags([
      'assets/index-abc.js',
      'assets/rubik-latin-wght-normal-abc.woff2',
      'assets/rubik-hebrew-wght-normal-abc.woff2',
    ]);
    expect(tags).toHaveLength(4);
    expect(tags[3]).toEqual({
      tag: 'link',
      attrs: {
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        crossorigin: true,
        href: '/assets/rubik-hebrew-wght-normal-abc.woff2',
      },
      injectTo: 'head',
    });
  });

  it('with a bundle holding no Hebrew Rubik file throws', async () => {
    await expect(
      headTags(['assets/index-abc.js', 'assets/rubik-latin-wght-normal-abc.woff2']),
    ).rejects.toThrow(/rubik-hebrew-wght-normal/);
  });

  it('escapes the title text but passes the description raw, since Vite escapes attributes', async () => {
    vi.resetModules();
    vi.doMock('../../src/locales/he.json', () => ({
      default: { app: { title: 'A & "B" <C>', tagline: 'D & "E" <F>' } },
    }));
    try {
      const { htmlTags: withCopy } = await import('../../html.config');
      const tags = await headTags(undefined, withCopy);
      expect(tags.slice(0, 2)).toEqual([
        { tag: 'title', children: 'A &amp; &quot;B&quot; &lt;C&gt;', injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'description', content: 'D & "E" <F>' }, injectTo: 'head' },
      ]);
    } finally {
      vi.doUnmock('../../src/locales/he.json');
      vi.resetModules();
    }
  });

  it('the vite, html and pwa configs hold no Hebrew letter', () => {
    for (const file of ['vite.config.ts', 'html.config.ts', 'pwa.config.ts']) {
      expect(readFileSync(join(webDir, file), 'utf8'), file).not.toMatch(/[֐-׿]/);
    }
  });
});
