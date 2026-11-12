import type { HtmlTagDescriptor, Plugin } from 'vite';

import he from './src/locales/he.json';

// The emitted Hebrew Rubik subset (@fontsource-variable/rubik/wght.css, imported in src/app/main.tsx).
// Every page needs it first, so it is preloaded.
const HEBREW_FONT = /(?:^|\/)rubik-hebrew-wght-normal-[^/]+\.woff2$/;

// Vite escapes attribute values itself but inserts `children` as raw HTML, so only the title text
// is escaped here.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Head tags for every page (spec 0009e): the title and description (both from he.json, so this file
 * holds no product copy), the theme colour and, in a build, a preload for the Hebrew Rubik file.
 * The build throws when that file is missing, so a renamed font cannot silently lose its preload.
 */
export function htmlTags({ themeColor }: { themeColor: string }): Plugin {
  let base = '/';
  return {
    name: 'rent-app:html-tags',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const tags: HtmlTagDescriptor[] = [
          { tag: 'title', children: escapeHtml(he.app.title), injectTo: 'head' },
          {
            tag: 'meta',
            attrs: { name: 'description', content: he.app.tagline },
            injectTo: 'head',
          },
          { tag: 'meta', attrs: { name: 'theme-color', content: themeColor }, injectTo: 'head' },
        ];
        if (ctx.bundle === undefined) return tags;
        const font = Object.keys(ctx.bundle).find((fileName) => HEBREW_FONT.test(fileName));
        if (font === undefined) {
          throw new Error(
            'htmlTags: no rubik-hebrew-wght-normal-*.woff2 in the bundle; the font preload would be lost',
          );
        }
        tags.push({
          tag: 'link',
          attrs: {
            rel: 'preload',
            as: 'font',
            type: 'font/woff2',
            crossorigin: true,
            href: `${base.endsWith('/') ? base : `${base}/`}${font}`,
          },
          injectTo: 'head',
        });
        return tags;
      },
    },
  };
}
