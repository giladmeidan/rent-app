import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', '..', 'assets', 'brand');
const brandKit = join(here, '..', '..', '..', '..', 'design', 'brand');

const EXPECTED = {
  logos: [
    'homie-lockup-en.svg',
    'homie-lockup-he.svg',
    'homie-wordmark-en-white.svg',
    'homie-wordmark-en.svg',
    'homie-wordmark-he-white.svg',
    'homie-wordmark-he.svg',
  ],
  mascot: [
    'homie-turtle-celebrate.svg',
    'homie-turtle-hello.svg',
    'homie-turtle-search.svg',
    'homie-turtle-sleep.svg',
    'homie-turtle.svg',
  ],
};

describe('web/src/assets/brand', () => {
  it('ac8_assets_match_brand_kit', () => {
    expect(readdirSync(assets).sort()).toEqual(['logos', 'mascot']);
    for (const [dir, files] of Object.entries(EXPECTED)) {
      expect(readdirSync(join(assets, dir)).sort()).toEqual(files);
      for (const file of files) {
        const copy = readFileSync(join(assets, dir, file));
        const source = readFileSync(join(brandKit, dir, file));
        expect(copy.equals(source), `${dir}/${file}`).toBe(true);
      }
    }
  });
});
