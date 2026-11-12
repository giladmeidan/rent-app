import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every `web/src/**\/*.{ts,tsx,css}` but tests, the test setup and the generated api client. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      if (path === join(src, 'api')) continue;
      out.push(...sources(path));
    } else if (/\.(ts|tsx|css)$/.test(entry.name) && path !== join(src, 'test-setup.ts')) {
      out.push(path);
    }
  }
  return out;
}

/** Spec 0009h §5: colour is a brand token (tailwind.config.ts), and the page widths are PageContainer's. */
const RULES: [string, RegExp][] = [
  ['hex colour', /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/],
  ['rgb/hsl colour', /\b(?:rgba?|hsla?)\(/],
  [
    'old token class',
    /(?:^|[\s"'`:])(?:[a-z-]+:)*(?:bg|text|border|divide|ring|outline|fill|stroke|placeholder|decoration|from|to|via)-(?:bg|muted|line|warn|warn-text|accent-tint|accent-text)\b/,
  ],
  ['page width literal', /max-w-\[(?:480|640)px\]/],
];

describe('colour literals', () => {
  it('ac1_no_colour_literals_in_src', () => {
    const files = sources(src);
    expect(files.length).toBeGreaterThan(50);
    const hits: string[] = [];
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const [name, rule] of RULES) {
            if (rule.test(line))
              hits.push(`${relative(src, file)}:${String(i + 1)} ${name}: ${line.trim()}`);
          }
        });
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });
});
