import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const tests = dirname(fileURLToPath(import.meta.url));
const components = join(tests, '..');

// Every top-level src/components/*.tsx (spec 0009h widened 0009d's list to all of them).
const KIT = readdirSync(components)
  .filter((name) => name.endsWith('.tsx'))
  .map((name) => name.slice(0, -'.tsx'.length));

describe('kit test coverage', () => {
  it('ac10_every_kit_component_has_a_test', () => {
    expect(KIT).toEqual(expect.arrayContaining(['Button', 'ChoiceGroup', 'Switch']));
    for (const name of KIT) {
      const test = join(tests, `${name}.test.tsx`);
      expect(existsSync(test), `__tests__/${name}.test.tsx`).toBe(true);
      expect(readFileSync(test, 'utf8'), `${name}.test.tsx has a test`).toMatch(/\b(it|test)\(/);
    }
  });
});
