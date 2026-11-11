import { describe, expect, it } from 'vitest';

import { addDays } from '../../listings/format';
import { gushDan } from '../../listings/__tests__/fixtures';
import {
  birthYearRange,
  emptyProfileForm,
  firstInvalid,
  formFromProfile,
  MOVE_IN_MAX_DAYS,
  serverFieldErrors,
  toProfileIn,
  validate,
  type ProfileForm,
} from '../validate';
import { profile } from './fixtures';

const TODAY = '2026-11-11';
const areas = [gushDan, { ...gushDan, id: 'other', slug: 'sharon', name_he: 'שרון' }];
const valid: ProfileForm = {
  ...formFromProfile(profile({ move_in_date: addDays(TODAY, 30) })),
};

const required = { key: 'listings.errors.required' };
const range = { key: 'listings.errors.range', min: 500, max: 100_000 };
const moveIn = { key: 'profile.errors.moveIn' };

describe('validate', () => {
  it('ac4_rules', () => {
    expect(validate(valid, areas, TODAY)).toEqual({});
    expect(MOVE_IN_MAX_DAYS).toBe(364);

    const rows: [Partial<ProfileForm>, string, object][] = [
      [{ budget_max_ils: '' }, 'budget_max_ils', required],
      [{ budget_max_ils: '499' }, 'budget_max_ils', range],
      [{ budget_max_ils: '100001' }, 'budget_max_ils', range],
      [{ budget_max_ils: '7500.5' }, 'budget_max_ils', range],
      [{ budget_max_ils: '-600' }, 'budget_max_ils', range],
      [{ move_in_date: '' }, 'move_in_date', required],
      [{ move_in_date: addDays(TODAY, -1) }, 'move_in_date', moveIn],
      [{ move_in_date: addDays(TODAY, 365) }, 'move_in_date', moveIn],
      [{ move_in_date: 'not-a-day' }, 'move_in_date', moveIn],
      [{ area_ids: new Set() }, 'area_ids', { key: 'profile.errors.areas' }],
      // An id GET /areas does not list is not counted.
      [{ area_ids: new Set(['gone']) }, 'area_ids', { key: 'profile.errors.areas' }],
      [{ household: null }, 'household', required],
      [{ contract_months: null }, 'contract_months', required],
    ];
    for (const [patch, field, error] of rows) {
      expect(validate({ ...valid, ...patch }, areas, TODAY)).toEqual({ [field]: error });
    }

    // The bounds themselves pass: 500, 100000, today and today + 364.
    for (const patch of [
      { budget_max_ils: '500' },
      { budget_max_ils: '100000' },
      { move_in_date: TODAY },
      { move_in_date: addDays(TODAY, 364) },
    ]) {
      expect(validate({ ...valid, ...patch }, areas, TODAY)).toEqual({});
    }

    // The empty form: budget, date, areas, household and contract, budget first.
    const empty = validate(emptyProfileForm, areas, TODAY);
    expect(Object.keys(empty)).toEqual([
      'budget_max_ils',
      'move_in_date',
      'area_ids',
      'household',
      'contract_months',
    ]);
    expect(firstInvalid(empty)).toBe('budget_max_ils');

    // The body keeps GET /areas order and drops an id it does not list.
    const body = toProfileIn({ ...valid, area_ids: new Set(['gone', 'other', gushDan.id]) }, areas);
    expect(body.area_ids).toEqual([gushDan.id, 'other']);
    expect(body.budget_max_ils).toBe(7500);

    // A 422 list: `["body", field, …]` items mark their field; anything else marks nothing.
    expect(
      serverFieldErrors([
        { loc: ['body', 'area_ids', 0] },
        { loc: ['body', 'budget_max_ils'] },
        { loc: ['query', 'household'] },
        { loc: ['body', 'nope'] },
      ]),
    ).toEqual({
      area_ids: { key: 'listings.errors.invalid' },
      budget_max_ils: { key: 'listings.errors.invalid' },
    });
    expect(serverFieldErrors('unknown_area')).toEqual({});
    expect(serverFieldErrors([{ loc: ['body'] }])).toEqual({});
  });

  it('ac6_birth_year_range', () => {
    // Israel is already in 2027; UTC is still in 2026. The youngest bound uses UTC (age 18 in the
    // API's year), the oldest Israel's year (99), so the range is inside the API's.
    expect(birthYearRange(new Date('2026-12-31T22:30:00Z'))).toEqual({ min: 1928, max: 2008 });
    expect(birthYearRange(new Date('2026-06-15T12:00:00Z'))).toEqual({ min: 1927, max: 2008 });

    // The rules apply only while the room switch is on; the range is today's.
    const { min, max } = birthYearRange();
    const room: ProfileForm = { ...valid, room: true, gender: 'woman' };
    const rangeError = { birth_year: { key: 'listings.errors.range', min, max } };
    expect(validate(room, areas, TODAY)).toEqual({});
    for (const birth_year of ['', ' ', String(min), String(max), ` ${String(max)} `]) {
      expect(validate({ ...room, birth_year }, areas, TODAY), birth_year).toEqual({});
    }
    for (const birth_year of [
      'abcd',
      '19x5',
      String(min - 1),
      String(max + 1),
      '-1990',
      '1990.5',
    ]) {
      expect(validate({ ...room, birth_year }, areas, TODAY), birth_year).toEqual(rangeError);
    }
    expect(validate({ ...room, gender: null }, areas, TODAY)).toEqual({ gender: required });
    expect(
      validate({ ...valid, room: false, gender: null, birth_year: 'abcd' }, areas, TODAY),
    ).toEqual({});
    // Both room errors come after the housing fields, gender first.
    const both = validate({ ...room, gender: null, birth_year: 'abcd' }, areas, TODAY);
    expect(Object.keys(both)).toEqual(['gender', 'birth_year']);
    expect(firstInvalid({ ...both, ...validate(emptyProfileForm, areas, TODAY) })).toBe(
      'budget_max_ils',
    );
    expect(firstInvalid(both)).toBe('gender');

    // The body: off omits the four keys; on sends them, birth year trimmed, as a number, or not at all.
    const off = toProfileIn({ ...room, room: false, birth_year: '1990' }, areas);
    for (const key of ['gender', 'birth_year', 'flatmate_gender', 'lifestyle']) {
      expect(off).not.toHaveProperty(key);
    }
    expect(toProfileIn({ ...room, birth_year: ` ${String(max)} ` }, areas)).toMatchObject({
      gender: 'woman',
      birth_year: max,
      flatmate_gender: 'any',
      lifestyle: {},
    });
    expect(toProfileIn(room, areas)).not.toHaveProperty('birth_year');
    // A 422 naming a room field marks it.
    expect(
      serverFieldErrors([{ loc: ['body', 'birth_year'] }, { loc: ['body', 'gender'] }]),
    ).toEqual({
      gender: { key: 'listings.errors.invalid' },
      birth_year: { key: 'listings.errors.invalid' },
    });
  });
});
