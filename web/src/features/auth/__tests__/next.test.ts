import { createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { safeNext } from '../next';

const ORIGIN = 'http://a.test';

/** Plain same-origin paths: they pass unchanged. */
const accepted = [
  '/listings/abc',
  '/me/applications?x=1',
  // Encoded `//` and `\\` stay one path segment; React Router does not decode them.
  '/%2F%2Fevil.example',
  '/%5C%5Cevil.example',
  // React Router resolves `..` at the root, so this lands on `/evil.example` (checked below).
  '/..//evil.example',
  // A fullwidth solidus (U+FF0F) is not a `/` to the URL parser.
  '/／evil.example',
];

/** Missing, relative, scheme-relative, whitespace-smuggled, absolute, scripted, backslashed. */
const rejected = [
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
];

describe('safeNext', () => {
  it('ac10_safe_next', async () => {
    for (const raw of accepted) {
      expect(safeNext(raw), raw).toBe(raw);
    }
    for (const raw of rejected) {
      expect(safeNext(raw), JSON.stringify(raw)).toBe('/');
    }

    // Every output stays on this origin, both as a URL and once React Router has navigated to it.
    for (const raw of [...accepted, ...rejected]) {
      const next = safeNext(raw);
      expect(new URL(next, ORIGIN).origin, JSON.stringify(raw)).toBe(ORIGIN);
      const router = createMemoryRouter([{ path: '*' }], { initialEntries: ['/login'] });
      await router.navigate(next, { replace: true });
      const { pathname, search } = router.state.location;
      expect(new URL(pathname + search, ORIGIN).origin, JSON.stringify(raw)).toBe(ORIGIN);
      router.dispose();
    }
  });
});
