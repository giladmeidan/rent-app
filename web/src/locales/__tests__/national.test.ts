import { describe, expect, it } from 'vitest';

import he from '../he.json';

describe('national copy (spec 0021b)', () => {
  it('ac5', () => {
    expect(JSON.stringify(he)).not.toContain('גוש דן');
  });
});
