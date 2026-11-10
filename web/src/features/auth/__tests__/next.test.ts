import { describe, expect, it } from 'vitest';

import { safeNext } from '../next';

describe('safeNext', () => {
  it('ac10_safe_next', () => {
    // Plain same-origin paths pass unchanged; a double-encoded `//` stays a path segment.
    for (const raw of ['/listings/abc', '/me/applications?x=1', '/%2F%2Fevil.example']) {
      expect(safeNext(raw), raw).toBe(raw);
    }
    // Missing, relative, scheme-relative, whitespace-smuggled, absolute, scripted, backslashed.
    for (const raw of [
      null,
      '',
      'listings/abc',
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/ x',
      'https://evil.example',
      'javascript:alert(1)',
      '/a\\b',
    ]) {
      expect(safeNext(raw), JSON.stringify(raw)).toBe('/');
    }
  });
});
