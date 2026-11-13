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
import { personalOnlyProfile, profile } from './fixtures';

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

    // The rules apply only while the personal switch is on; the range is today's.
    const { min, max } = birthYearRange();
    const room: ProfileForm = { ...valid, personal: true, gender: 'woman' };
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
      validate({ ...valid, personal: false, gender: null, birth_year: 'abcd' }, areas, TODAY),
    ).toEqual({});
    // Both room errors come after the housing fields, gender first.
    const both = validate({ ...room, gender: null, birth_year: 'abcd' }, areas, TODAY);
    expect(Object.keys(both)).toEqual(['gender', 'birth_year']);
    expect(firstInvalid({ ...both, ...validate(emptyProfileForm, areas, TODAY) })).toBe(
      'budget_max_ils',
    );
    expect(firstInvalid(both)).toBe('gender');

    // The body: off sends the four empty (0010c: PUT clears them); on sends them, birth year
    // trimmed, as a number, or not at all.
    const off = toProfileIn({ ...room, personal: false, birth_year: '1990' }, areas);
    expect(off).toMatchObject({
      gender: null,
      birth_year: null,
      flatmate_gender: 'any',
      lifestyle: {},
    });
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

  it('ac1_about_me', () => {
    const room: ProfileForm = { ...valid, personal: true, gender: 'woman' };
    const tooLong = { about_me: { key: 'profile.errors.aboutMeTooLong' } };
    expect(validate({ ...room, about_me: 'א'.repeat(300) }, areas, TODAY)).toEqual({});
    expect(validate({ ...room, about_me: 'א'.repeat(301) }, areas, TODAY)).toEqual(tooLong);
    // Spaces around it do not count; a newline does.
    expect(validate({ ...room, about_me: ` ${'א'.repeat(300)} ` }, areas, TODAY)).toEqual({});
    expect(validate({ ...room, about_me: `${'א'.repeat(299)}\nא` }, areas, TODAY)).toEqual(tooLong);
    expect(validate({ ...room, about_me: '!!!' }, areas, TODAY)).toEqual({ about_me: required });
    expect(validate({ ...room, about_me: '   \n ' }, areas, TODAY)).toEqual({});
    // Checked only while the personal switch is on; after birth_year.
    expect(validate({ ...valid, about_me: '!!!' }, areas, TODAY)).toEqual({});
    const both = validate({ ...room, birth_year: 'abcd', about_me: '!!!' }, areas, TODAY);
    expect(Object.keys(both)).toEqual(['birth_year', 'about_me']);

    const body = (about_me: string, people_visible = true) =>
      toProfileIn({ ...room, people_visible, about_me }, areas);
    expect(body('  שלום  ')).toMatchObject({ people_visible: true, about_me: 'שלום' });
    expect(body('a\r\nb')).toMatchObject({ about_me: 'a\nb' });
    expect(body('   ')).toMatchObject({ about_me: null });
    expect(toProfileIn({ ...valid, people_visible: true, about_me: 'שלום' }, areas)).toMatchObject({
      people_visible: false,
      about_me: null,
    });
    expect(formFromProfile(profile({ people_visible: true, about_me: 'x' }))).toMatchObject({
      people_visible: true,
      about_me: 'x',
    });
    expect(formFromProfile(profile()).about_me).toBe('');
    expect(serverFieldErrors([{ loc: ['body', 'about_me'] }])).toEqual({
      about_me: { key: 'listings.errors.invalid' },
    });
  });
});

describe('ac10 the two parts', () => {
  const looking = {
    budget_max_ils: null,
    move_in_date: null,
    area_ids: null,
    household: null,
    has_pets: null,
    smoker: null,
    contract_months: null,
  };

  it('ac10 looking off: its fields raise nothing and go as null, with the looking defaults', () => {
    const form: ProfileForm = {
      ...valid,
      looking: false,
      personal: true,
      gender: 'woman',
      // What was typed stays in the form; none of it is checked or sent.
      budget_max_ils: '12',
      move_in_date: '',
      area_ids: new Set(),
      household: null,
      contract_months: null,
      move_in_flexible: true,
      parking_needed: 2,
      flatmate_gender: 'women',
      people_visible: true,
    };
    expect(validate(form, areas, TODAY)).toEqual({});
    expect(toProfileIn(form, areas)).toEqual({
      ...looking,
      move_in_flexible: false,
      parking_needed: 0,
      gender: 'woman',
      lifestyle: {},
      about_me: null,
      flatmate_gender: 'any',
      people_visible: false,
    });
  });

  it('ac10 personal off: gender, birth year and about me go as null, the answers empty', () => {
    const form: ProfileForm = {
      ...valid,
      personal: false,
      gender: 'man',
      birth_year: 'abcd',
      about_me: '!!!',
      lifestyle: { night: 3 },
      flatmate_gender: 'men',
      people_visible: true,
    };
    expect(validate(form, areas, TODAY)).toEqual({});
    expect(toProfileIn(form, areas)).toMatchObject({
      budget_max_ils: 7500,
      gender: null,
      birth_year: null,
      about_me: null,
      lifestyle: {},
      flatmate_gender: 'any',
      people_visible: false,
    });
  });

  it('ac10 both off: only the "fill one part" error', () => {
    const errors = validate({ ...emptyProfileForm, looking: false, personal: false }, areas, TODAY);
    expect(errors).toEqual({ form: { key: 'profile.errors.onePart' } });
    expect(firstInvalid(errors)).toBe('form');
  });

  it('ac10 both on: every field is sent as today', () => {
    const form: ProfileForm = {
      ...valid,
      personal: true,
      gender: 'woman',
      birth_year: '1996',
      about_me: 'שלום',
      lifestyle: { night: 2 },
      flatmate_gender: 'women',
      people_visible: true,
    };
    expect(validate(form, areas, TODAY)).toEqual({});
    expect(toProfileIn(form, areas)).toEqual({
      budget_max_ils: 7500,
      move_in_date: addDays(TODAY, 30),
      move_in_flexible: true,
      area_ids: [gushDan.id],
      household: 'couple',
      has_pets: true,
      smoker: false,
      contract_months: 24,
      parking_needed: 1,
      gender: 'woman',
      birth_year: 1996,
      flatmate_gender: 'women',
      lifestyle: { night: 2 },
      people_visible: true,
      about_me: 'שלום',
    });
  });

  it('ac10 the form from a stored profile: each switch from its part, no String(null)', () => {
    const personal = formFromProfile(personalOnlyProfile());
    expect(personal).toMatchObject({
      looking: false,
      personal: true,
      gender: 'woman',
      birth_year: '1996',
      budget_max_ils: '',
      move_in_date: '',
      household: null,
      contract_months: null,
      has_pets: false,
      smoker: false,
      parking_needed: 0,
    });
    expect(personal.area_ids.size).toBe(0);
    expect(formFromProfile(profile())).toMatchObject({ looking: true, personal: false });
    expect(emptyProfileForm).toMatchObject({ looking: true, personal: false });
  });
});
