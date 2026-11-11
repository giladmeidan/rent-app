import { describe, expect, it } from 'vitest';

import { flatmatesNearAge, seekerAge } from '../age';

describe('age', () => {
  it('ac5_flatmates_near_age', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    expect(seekerAge(1999, now)).toBe(27);
    expect(flatmatesNearAge(1999, [27, 30], now)).toBe(true);
    // 33 is 6 years from 27.
    expect(flatmatesNearAge(1999, [27, 33], now)).toBe(false);
    // Exactly 5 either way still counts.
    expect(flatmatesNearAge(1999, [22, 32], now)).toBe(true);
    expect(flatmatesNearAge(1999, [], now)).toBe(false);
    expect(flatmatesNearAge(null, [27, 30], now)).toBe(false);
    expect(flatmatesNearAge(undefined, [27, 30], now)).toBe(false);
  });
});
