import { describe, expect, it } from 'vitest';

import he from '../../../locales/he.json';
import { compareLifestyle, LIFESTYLE_KEYS, type LifestyleAnswers } from '../keys';

const nonEmpty = (value: unknown) => typeof value === 'string' && value.trim() !== '';

describe('lifestyle keys', () => {
  it('ac1_keys_and_catalogue', () => {
    // The contract's tuple, in its order (0007a).
    expect(LIFESTYLE_KEYS).toEqual([
      'cleanliness',
      'guests',
      'night',
      'social',
      'kosher',
      'shabbat',
      'work_from_home',
    ]);

    // `LifestyleFields` looks the labels up by template key, which `i18n-check` cannot see.
    const catalogue = he.lifestyle as unknown as Record<
      string,
      { topic: string; question: Record<string, string>; answer: Record<string, string> }
    >;
    for (const key of LIFESTYLE_KEYS) {
      const entry = catalogue[key];
      expect(entry, key).toBeDefined();
      expect(nonEmpty(entry?.topic), `${key}.topic`).toBe(true);
      expect(nonEmpty(entry?.question.seeker), `${key}.question.seeker`).toBe(true);
      expect(nonEmpty(entry?.question.flat), `${key}.question.flat`).toBe(true);
      expect(entry?.question.seeker, key).not.toBe(entry?.question.flat);
      for (const n of ['1', '2', '3']) {
        expect(nonEmpty(entry?.answer[n]), `${key}.answer.${n}`).toBe(true);
      }
    }
    for (const value of [
      he.lifestyle.title.seeker,
      he.lifestyle.title.flat,
      he.lifestyle.nudge,
      he.rooms.genderPreference.any,
      he.rooms.genderPreference.women,
      he.rooms.genderPreference.men,
      he.profile.room.gender.woman,
      he.profile.room.gender.man,
      he.profile.room.gender.other,
    ]) {
      expect(nonEmpty(value)).toBe(true);
    }
  });

  it('ac2_compare', () => {
    const empty = { shared: 0, same: 0, differing: [] };
    const full: LifestyleAnswers = {
      cleanliness: 1,
      guests: 2,
      night: 3,
      social: 1,
      kosher: 2,
      shabbat: 3,
      work_from_home: 1,
    };
    expect(compareLifestyle({}, {})).toEqual(empty);
    expect(compareLifestyle({}, full)).toEqual(empty);
    expect(compareLifestyle(full, {})).toEqual(empty);

    // Only the keys both answered count (cleanliness, guests); night and social are one-sided.
    const a: LifestyleAnswers = { cleanliness: 1, guests: 2, night: 3 };
    const b: LifestyleAnswers = { cleanliness: 1, guests: 3, social: 2 };
    const aBefore = structuredClone(a);
    const bBefore = structuredClone(b);
    expect(compareLifestyle(a, b)).toEqual({ shared: 2, same: 1, differing: ['guests'] });
    expect(a).toEqual(aBefore);
    expect(b).toEqual(bBefore);

    // `differing` follows LIFESTYLE_KEYS order, whatever the inputs' key order.
    const reversed: LifestyleAnswers = { work_from_home: 3, shabbat: 1, kosher: 3, cleanliness: 3 };
    expect(compareLifestyle(reversed, full)).toEqual({
      shared: 4,
      same: 0,
      differing: ['cleanliness', 'kosher', 'shabbat', 'work_from_home'],
    });
    expect(compareLifestyle(full, full)).toEqual({ shared: 7, same: 7, differing: [] });
  });
});
