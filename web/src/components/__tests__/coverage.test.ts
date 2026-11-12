import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The kit as of 0009d; 0009h widens this to every src/components/*.tsx.
const KIT = [
  'Button',
  'Card',
  'Tag',
  'Badge',
  'Field',
  'TextInput',
  'Textarea',
  'Select',
  'PageContainer',
  'PageHeader',
  'Tabs',
  'Dialog',
  'Logo',
  'Mascot',
] as const;

const tests = dirname(fileURLToPath(import.meta.url));

describe('kit test coverage', () => {
  it('ac10_every_kit_component_has_a_test', () => {
    for (const name of KIT) {
      expect(existsSync(join(tests, '..', `${name}.tsx`)), `${name}.tsx`).toBe(true);
      const test = join(tests, `${name}.test.tsx`);
      expect(existsSync(test), `__tests__/${name}.test.tsx`).toBe(true);
      expect(readFileSync(test, 'utf8'), `${name}.test.tsx has a test`).toMatch(/\b(it|test)\(/);
    }
  });
});
