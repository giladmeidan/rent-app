import { describe, expect, it } from 'vitest';

import { owner, seeker } from '../../listings/__tests__/fixtures';
import { canApply } from '../canApply';

describe('canApply', () => {
  it('ac13_can_apply', () => {
    // Spec 0010b: a room is open to any account, an apartment to a seeker; never one's own.
    const cases = [
      [seeker, 'room', false, true],
      [owner, 'room', false, true],
      [seeker, 'apartment', false, true],
      [owner, 'apartment', false, false],
      [seeker, 'room', true, false],
      [owner, 'room', true, false],
      [seeker, 'apartment', true, false],
      [owner, 'apartment', true, false],
    ] as const;
    for (const [me, listing_type, is_mine, expected] of cases) {
      expect(
        canApply(me, { listing_type, is_mine }),
        `${me.role} ${listing_type} ${String(is_mine)}`,
      ).toBe(expected);
    }
  });
});
