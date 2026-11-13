import { describe, expect, it } from 'vitest';

import { addDays } from '../format';
import { listing } from './fixtures';
import {
  changedFields,
  cleanText,
  emptyForm,
  formFromListing,
  toListingIn,
  validate,
  validatePreferences,
  type FieldName,
  type ListingForm,
} from '../validate';

const today = '2026-11-10';

/** A form that passes every rule; each row below changes one field. */
const valid: ListingForm = {
  ...emptyForm,
  listing_type: 'apartment',
  area_id: '00000000-0000-0000-0000-00000000a1a1',
  city: 'גבעתיים',
  street: 'כצנלסון',
  rooms: '3.5',
  floor: '3',
  total_floors: '5',
  size_sqm: '95',
  price_ils: '7200',
  available_from: addDays(today, 30),
};

const required = { key: 'listings.errors.required' };
const range = (min: number, max: number) => ({ key: 'listings.errors.range', min, max });
const tooLong = (max: number) => ({ key: 'listings.errors.tooLong', max });
const dateRange = { key: 'listings.errors.dateRange' };

type Row = [string, Partial<ListingForm>, FieldName, object | undefined];

const rows: Row[] = [
  ['rooms 0.5', { rooms: '0.5' }, 'rooms', range(1, 20)],
  ['rooms 1', { rooms: '1' }, 'rooms', undefined],
  ['rooms 20', { rooms: '20' }, 'rooms', undefined],
  ['rooms 20.5', { rooms: '20.5' }, 'rooms', range(1, 20)],
  ['rooms 2.3', { rooms: '2.3' }, 'rooms', range(1, 20)],
  ['price 499', { price_ils: '499' }, 'price_ils', range(500, 100_000)],
  ['price 500', { price_ils: '500' }, 'price_ils', undefined],
  ['price 100000', { price_ils: '100000' }, 'price_ils', undefined],
  ['price 100001', { price_ils: '100001' }, 'price_ils', range(500, 100_000)],
  ['size 4', { size_sqm: '4' }, 'size_sqm', range(5, 1000)],
  ['size 5', { size_sqm: '5' }, 'size_sqm', undefined],
  ['size 1000', { size_sqm: '1000' }, 'size_sqm', undefined],
  ['size 1001', { size_sqm: '1001' }, 'size_sqm', range(5, 1000)],
  ['floor -3', { floor: '-3', total_floors: '' }, 'floor', range(-2, 100)],
  ['floor -2', { floor: '-2', total_floors: '' }, 'floor', undefined],
  ['floor 100', { floor: '100', total_floors: '' }, 'floor', undefined],
  ['floor 101', { floor: '101', total_floors: '' }, 'floor', range(-2, 100)],
  [
    'floor 3 of 2',
    { floor: '3', total_floors: '2' },
    'total_floors',
    { key: 'listings.errors.floors' },
  ],
  ['parking 5', { parking_spots: '5' }, 'parking_spots', undefined],
  ['parking 6', { parking_spots: '6' }, 'parking_spots', range(0, 5)],
  ['arnona empty (optional)', { arnona_ils: '' }, 'arnona_ils', undefined],
  ['arnona 20000', { arnona_ils: '20000' }, 'arnona_ils', undefined],
  ['arnona 20001', { arnona_ils: '20001' }, 'arnona_ils', range(0, 20_000)],
  ['vaad 5000', { vaad_ils: '5000' }, 'vaad_ils', undefined],
  ['vaad 5001', { vaad_ils: '5001' }, 'vaad_ils', range(0, 5000)],
  ['description 2000', { description: 'א'.repeat(2000) }, 'description', undefined],
  ['description 2001', { description: 'א'.repeat(2001) }, 'description', tooLong(2000)],
  // An emoji is two UTF-16 units but one code point, as Postgres counts it.
  ['description 2000 emoji', { description: '🏠'.repeat(2000) }, 'description', undefined],
  ['description 2001 emoji', { description: '🏠'.repeat(2001) }, 'description', tooLong(2000)],
  ['description padded', { description: `  ${'א'.repeat(2000)}  ` }, 'description', undefined],
  ['city " "', { city: ' ' }, 'city', required],
  ['city " גבעתיים "', { city: ' גבעתיים ' }, 'city', undefined],
  ['city 40', { city: 'א'.repeat(40) }, 'city', undefined],
  ['city 41', { city: 'א'.repeat(41) }, 'city', tooLong(40)],
  // The API's visible-characters rule: invisible characters are removed before counting (an RLM
  // alone is empty), a tab is a space, ZWJ stays and counts.
  ['city RLM only', { city: '\u200f' }, 'city', required],
  ['city RLM + LRE + NUL only', { city: '\u200f\u202a\u0000 ' }, 'city', required],
  ['city 40 + RLM', { city: `${'א'.repeat(40)}\u200f` }, 'city', undefined],
  [
    'city 41 with an RLM inside',
    { city: `${'א'.repeat(20)}\u200f${'א'.repeat(21)}` },
    'city',
    tooLong(40),
  ],
  ['street tab only', { street: '\t' }, 'street', required],
  ['street 80 with a tab', { street: `${'א'.repeat(40)}\t${'א'.repeat(39)}` }, 'street', undefined],
  [
    'street 81 with a tab',
    { street: `${'א'.repeat(40)}\t${'א'.repeat(40)}` },
    'street',
    tooLong(80),
  ],
  [
    'description 2000 + RLMs',
    { description: `${'א'.repeat(2000)}\u200f\u2028\u200b` },
    'description',
    undefined,
  ],
  [
    'description 2001 with a tab',
    { description: `${'א'.repeat(1000)}\t${'א'.repeat(1000)}` },
    'description',
    tooLong(2000),
  ],
  [
    'description 2001 with a ZWJ',
    { description: `${'א'.repeat(2000)}\u200d` },
    'description',
    tooLong(2000),
  ],
  ['street 80', { street: 'א'.repeat(80) }, 'street', undefined],
  ['street 81', { street: 'א'.repeat(81) }, 'street', tooLong(80)],
  ['date empty', { available_from: '' }, 'available_from', required],
  ['date today-1 (immediate)', { available_from: addDays(today, -1) }, 'available_from', undefined],
  ['date today+729', { available_from: addDays(today, 729) }, 'available_from', undefined],
  ['date today+730', { available_from: addDays(today, 730) }, 'available_from', dateRange],
];

describe('validate', () => {
  it('ac8_field_rules', () => {
    expect(validate(valid, today)).toEqual({});
    for (const [name, patch, field, expected] of rows) {
      const errors = validate({ ...valid, ...patch }, today);
      expect(errors[field], name).toEqual(expected);
      // Only the changed field is reported.
      expect(Object.keys(errors), name).toEqual(expected === undefined ? [] : [field]);
    }
  });

  it('ac8_body_is_trimmed_and_typed', () => {
    expect(
      toListingIn({
        ...valid,
        city: ' \u200fגבעתיים\u202e ',
        street: 'כצנלסון\tהגדול\n',
        description: ' a\r\nb\u200f\u2028\tc\u200d\rd\u0000 ',
        vaad_ils: '150',
      }),
    ).toEqual({
      listing_type: 'apartment',
      area_id: valid.area_id,
      city: 'גבעתיים',
      street: 'כצנלסון הגדול',
      rooms: 3.5,
      floor: 3,
      total_floors: 5,
      size_sqm: 95,
      price_ils: 7200,
      available_from: valid.available_from,
      entry_flexible: false,
      elevator: false,
      parking_spots: 0,
      furnished: 'none',
      pets_allowed: false,
      arnona_ils: null,
      vaad_ils: 150,
      // `\n` stays in the description; a lone `\r`, U+2028 and bidi marks go; ZWJ stays.
      description: 'a\nb c\u200dd',
      accepted_households: ['single', 'couple', 'family', 'roommates'],
      smoking_allowed: true,
      min_contract_months: null,
      gender_preference: 'any',
      flatmates_count: null,
      flatmate_ages: [],
      lifestyle: {},
    });
  });

  it('ac8_clean_text_strips_blank_and_private_use', () => {
    // Hangul filler, braille blank, private use, a non-character and a lone surrogate go.
    for (const ch of ['\u3164', '\u2800', '\ue000', '\uffff', '\ud800']) {
      expect(cleanText(`\u05d0${ch}\u05d1`), `U+${ch.charCodeAt(0).toString(16)}`).toBe(
        '\u05d0\u05d1',
      );
      expect(cleanText(ch), `U+${ch.charCodeAt(0).toString(16)} alone`).toBe('');
    }
    // The rest of the new set: the other blank letters, plane-15/16 private use, every kind of
    // non-character, a lone low surrogate.
    for (const ch of [
      '\u115f',
      '\u1160',
      '\uffa0',
      '\uf8ff',
      '\u{f0000}',
      '\u{10fffd}',
      '\ufdd0',
      '\ufdef',
      '\ufffe',
      '\u{1fffe}',
      '\u{1ffff}',
      '\u{10ffff}',
      '\udfff',
    ]) {
      expect(cleanText(`a${ch}b`), `U+${ch.codePointAt(0)?.toString(16)}`).toBe('ab');
    }
    // Kept: ZWJ (emoji sequences), Hebrew niqqud, a valid surrogate pair, a Unicode 16 emoji,
    // and `\n` in multiline text.
    const family = '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}';
    expect(cleanText(family)).toBe(family);
    const shalom = '\u05e9\u05c1\u05b8\u05dc\u05d5\u05b9\u05dd';
    expect(cleanText(shalom)).toBe(shalom);
    expect(cleanText('\u{1f642} \u{1fae9}')).toBe('\u{1f642} \u{1fae9}');
    expect(cleanText('a\nb\u3164', { multiline: true })).toBe('a\nb');
    expect(cleanText('a\nb')).toBe('ab');
  });

  it('ac8_clean_text_strips_unassigned_default_ignorables', () => {
    // Review B1: unassigned in the API's Unicode tables, rendered as nothing by browsers.
    for (const ch of [
      '\u{e0080}',
      '\u2065',
      '\ufff0',
      '\ufff8',
      '\u{e0000}',
      '\u{e00ff}',
      '\u{e01f0}',
      '\u{e0fff}',
    ]) {
      const name = `U+${ch.codePointAt(0)?.toString(16)}`;
      expect(cleanText(`a${ch}b`), name).toBe('ab');
      expect(cleanText(ch), `${name} alone`).toBe('');
    }
    // A variation selector between the ranges stays.
    expect(cleanText('\u05d0\u{e0100}')).toBe('\u05d0\u{e0100}');
  });

  it('ac8_clean_text_strips_all_66_noncharacters', () => {
    const nonCharacters = [
      ...Array.from({ length: 32 }, (_, i) => 0xfdd0 + i),
      ...Array.from({ length: 17 }, (_, plane) => [
        plane * 0x10000 + 0xfffe,
        plane * 0x10000 + 0xffff,
      ]).flat(),
    ];
    expect(nonCharacters).toHaveLength(66);
    for (const cp of nonCharacters) {
      expect(cleanText(`a${String.fromCodePoint(cp)}b`), `U+${cp.toString(16)}`).toBe('ab');
    }
    // Their neighbours stay: U+FDCF, U+FDF0, U+FFFD (the replacement character).
    for (const cp of [0xfdcf, 0xfdf0, 0xfffd]) {
      const kept = `a${String.fromCodePoint(cp)}b`;
      expect(cleanText(kept), `U+${cp.toString(16)}`).toBe(kept);
    }
  });

  it('ac8_city_without_letter_or_digit_is_required', () => {
    const cases: [string, Partial<ListingForm>, FieldName, object | undefined][] = [
      ['city "..."', { city: '...' }, 'city', required],
      ['city "-"', { city: '-' }, 'city', required],
      ['city emoji only', { city: '\u{1f642}' }, 'city', required],
      ['city Hangul filler only', { city: '\u3164' }, 'city', required],
      ['city braille blank + dots', { city: '\u2800...' }, 'city', required],
      ['street "..."', { street: '...' }, 'street', required],
      ['street private use only', { street: '\ue000\ue000' }, 'street', required],
      ['city digits', { city: '12' }, 'city', undefined],
      ['city with a hyphen', { city: '\u05e8\u05de\u05ea-\u05d2\u05df' }, 'city', undefined],
      ['street "3"', { street: '3' }, 'street', undefined],
      ['41 dots is required, not too long', { city: '.'.repeat(41) }, 'city', required],
      // The description has no letter-or-digit rule.
      ['description "..."', { description: '...' }, 'description', undefined],
    ];
    for (const [name, patch, field, expected] of cases) {
      const errors = validate({ ...valid, ...patch }, today);
      expect(errors[field], name).toEqual(expected);
      expect(Object.keys(errors), name).toEqual(expected === undefined ? [] : [field]);
    }
    // The body the wizard sends drops the stripped characters.
    expect(
      toListingIn({ ...valid, city: '\u05d0\u3164\u05d1', street: '\u2800\u05d2' }),
    ).toMatchObject({
      city: '\u05d0\u05d1',
      street: '\u05d2',
    });
  });

  it('ac11_form_from_listing_and_changed_fields', () => {
    const nulls = { total_floors: null, arnona_ils: null, vaad_ils: null, description: null };
    const stored = [
      listing({ ...nulls, rooms: 3 }),
      listing({ ...nulls, rooms: 3.5 }),
      listing({ ...nulls, rooms: 12 }),
      listing({
        rooms: 3.5,
        total_floors: 5,
        arnona_ils: 480,
        vaad_ils: 0,
        parking_spots: 2,
        furnished: 'partial',
        elevator: true,
        pets_allowed: true,
        entry_flexible: true,
        description: '\u05e9\u05d5\u05e8\u05d4\n\u05e9\u05e0\u05d9\u05d9\u05d4',
        available_from: addDays(today, -40),
      }),
      listing({ listing_type: 'room', available_from: addDays(today, -1) }),
    ];
    for (const l of stored) {
      const form = formFromListing(l);
      expect(changedFields(l, toListingIn(form)), l.id).toEqual({});
      expect(validate(form, today), l.id).toEqual({});
    }

    const l = listing({
      rooms: 3.5,
      total_floors: 5,
      city: '\u05d2\u05d1\u05e2\u05ea\u05d9\u05d9\u05dd',
    });
    const form = formFromListing(l);
    expect(form).toMatchObject({
      rooms: '3.5',
      floor: String(l.floor),
      total_floors: '5',
      price_ils: String(l.price_ils),
      parking_spots: '0',
      arnona_ils: '',
      vaad_ils: '',
      description: '',
    });
    const diff = (patch: Partial<ListingForm>) =>
      changedFields(l, toListingIn({ ...form, ...patch }));

    expect(diff({ total_floors: '' })).toEqual({ total_floors: null });
    expect(diff({ description: '  ' })).toEqual({});
    expect(
      changedFields({ ...l, description: 'x' }, toListingIn({ ...form, description: '  ' })),
    ).toEqual({ description: null });
    expect(diff({ rooms: '4' })).toEqual({ rooms: 4 });
    // Cleaned before the compare: surrounding spaces are no change.
    expect(diff({ city: ' \u05d2\u05d1\u05e2\u05ea\u05d9\u05d9\u05dd ' })).toEqual({});
    const other = '00000000-0000-0000-0000-00000000b2b2';
    expect(diff({ area_id: other })).toEqual({ area_id: other });
    expect(diff({ price_ils: '7500', arnona_ils: '480' })).toEqual({
      price_ils: 7500,
      arnona_ils: 480,
    });
    // `status` is never a key, whatever changes.
    const everything = diff({
      listing_type: 'room',
      rooms: '5',
      floor: '9',
      price_ils: '9000',
      elevator: true,
      furnished: 'full',
    });
    expect(Object.keys(everything)).not.toContain('status');
    expect(Object.keys(changedFields({ ...l, status: 'paused' }, toListingIn(form)))).toEqual([]);
  });

  it('ac9_preference_helpers', () => {
    // toListingIn: canonical order, whatever order they were checked in.
    expect(
      toListingIn({ ...valid, accepted_households: ['roommates', 'couple', 'single'] })
        .accepted_households,
    ).toEqual(['single', 'couple', 'roommates']);
    expect(
      toListingIn({ ...valid, smoking_allowed: false, min_contract_months: 24 }),
    ).toMatchObject({ smoking_allowed: false, min_contract_months: 24 });

    // A legacy room (no count) with the type changed in the form diffs to nothing: the type is
    // never sent (spec 0010a), and an apartment body carries no room key.
    const legacy = listing({ listing_type: 'room', flatmates_count: null });
    expect(
      changedFields(legacy, toListingIn({ ...formFromListing(legacy), listing_type: 'apartment' })),
    ).toStrictEqual({});

    // formFromListing → toListingIn round-trips the three fields.
    const l = listing({
      accepted_households: ['couple', 'single'],
      smoking_allowed: false,
      min_contract_months: 12,
    });
    const form = formFromListing(l);
    expect(form).toMatchObject({
      accepted_households: ['couple', 'single'],
      smoking_allowed: false,
      min_contract_months: 12,
    });
    expect(toListingIn(form)).toMatchObject({
      accepted_households: ['single', 'couple'],
      smoking_allowed: false,
      min_contract_months: 12,
    });

    // changedFields: households as a set.
    expect(changedFields(l, toListingIn(form))).toEqual({});
    const diff = (patch: Partial<ListingForm>) =>
      changedFields(l, toListingIn({ ...form, ...patch }));
    expect(diff({ accepted_households: ['single', 'couple'] })).toEqual({});
    expect(diff({ accepted_households: ['single'] })).toEqual({ accepted_households: ['single'] });
    expect(diff({ accepted_households: ['single', 'family'] })).toEqual({
      accepted_households: ['single', 'family'],
    });
    expect(diff({ accepted_households: ['family', 'couple', 'single'] })).toEqual({
      accepted_households: ['single', 'couple', 'family'],
    });
    expect(diff({ smoking_allowed: true })).toEqual({ smoking_allowed: true });
    expect(diff({ min_contract_months: null })).toEqual({ min_contract_months: null });
    expect(diff({ min_contract_months: 36 })).toEqual({ min_contract_months: 36 });

    // emptyForm: every household, smokers welcome, no minimum; validatePreferences needs one.
    expect(emptyForm).toMatchObject({
      accepted_households: ['single', 'couple', 'family', 'roommates'],
      smoking_allowed: true,
      min_contract_months: null,
    });
    expect(validatePreferences(valid)).toEqual({});
    expect(validatePreferences({ ...valid, accepted_households: [] })).toEqual({
      accepted_households: { key: 'listings.errors.households' },
    });
    // validate() is the details step's only.
    expect(validate({ ...valid, accepted_households: [] }, today)).toEqual({});
  });

  it('ac9_room_helpers', () => {
    const room: ListingForm = { ...valid, listing_type: 'room', flatmates_count: 2 };
    const roomKeys = (form: ListingForm) => {
      const { gender_preference, flatmates_count, flatmate_ages, lifestyle } = toListingIn(form);
      return { gender_preference, flatmates_count, flatmate_ages, lifestyle };
    };

    // toListingIn: ages sorted numerically, never lexicographically.
    expect(toListingIn({ ...room, flatmate_ages: ['30', '27'] }).flatmate_ages).toEqual([27, 30]);
    expect(toListingIn({ ...room, flatmate_ages: ['100', '27'] }).flatmate_ages).toEqual([27, 100]);
    // Empty slots and slots beyond the count dropped, the rest trimmed.
    expect(
      toListingIn({ ...room, flatmates_count: 3, flatmate_ages: [' 40 ', '', '22', '50'] })
        .flatmate_ages,
    ).toEqual([22, 40]);
    expect(toListingIn({ ...room, flatmate_ages: ['', '  '] }).flatmate_ages).toEqual([]);
    // Only the answered keys, in LIFESTYLE_KEYS order.
    const answered = toListingIn({
      ...room,
      lifestyle: { work_from_home: 1, night: 2, guests: undefined, cleanliness: 3 },
    }).lifestyle;
    expect(answered).toStrictEqual({ cleanliness: 3, night: 2, work_from_home: 1 });
    expect(Object.keys(answered)).toEqual(['cleanliness', 'night', 'work_from_home']);
    expect(roomKeys({ ...room, gender_preference: 'men', flatmate_ages: ['33'] })).toStrictEqual({
      gender_preference: 'men',
      flatmates_count: 2,
      flatmate_ages: [33],
      lifestyle: {},
    });
    // An apartment sends the defaults, whatever the form still holds from a room.
    const stale: ListingForm = {
      ...room,
      gender_preference: 'women',
      flatmate_ages: ['30'],
      lifestyle: { guests: 1 },
    };
    expect(roomKeys({ ...stale, listing_type: 'apartment' })).toStrictEqual({
      gender_preference: 'any',
      flatmates_count: null,
      flatmate_ages: [],
      lifestyle: {},
    });

    // formFromListing → toListingIn round-trips the four fields, from copies.
    const l = listing({
      listing_type: 'room',
      gender_preference: 'women',
      flatmates_count: 3,
      flatmate_ages: [30, 27],
      lifestyle: { night: 1, guests: 2 },
    });
    const form = formFromListing(l);
    expect(form).toMatchObject({
      gender_preference: 'women',
      flatmates_count: 3,
      flatmate_ages: ['27', '30'],
    });
    expect(form.lifestyle).toStrictEqual({ night: 1, guests: 2 });
    expect(form.lifestyle).not.toBe(l.lifestyle);
    expect(l.flatmate_ages).toEqual([30, 27]);
    expect(roomKeys(form)).toStrictEqual({
      gender_preference: 'women',
      flatmates_count: 3,
      flatmate_ages: [27, 30],
      lifestyle: { guests: 2, night: 1 },
    });

    // changedFields: the ages as a set, the questionnaire by its entries; nothing sorted in place.
    expect(changedFields(l, toListingIn(form))).toEqual({});
    expect(l.flatmate_ages).toEqual([30, 27]);
    const body = toListingIn(form);
    expect(changedFields({ ...l, flatmate_ages: [27, 30] }, body)).toEqual({});
    expect(body.flatmate_ages).toEqual([27, 30]);
    const diff = (patch: Partial<ListingForm>) =>
      changedFields(l, toListingIn({ ...form, ...patch }));
    expect(diff({ flatmate_ages: ['30', '27'] })).toEqual({});
    expect(diff({ flatmate_ages: ['27', '31'] })).toEqual({ flatmate_ages: [27, 31] });
    expect(diff({ flatmate_ages: ['27'] })).toEqual({ flatmate_ages: [27] });
    expect(diff({ flatmate_ages: ['27', '30', '30'] })).toEqual({ flatmate_ages: [27, 30, 30] });
    expect(diff({ lifestyle: { guests: 2, night: 1 } })).toEqual({});
    expect(diff({ lifestyle: { guests: 3, night: 1 } })).toEqual({
      lifestyle: { guests: 3, night: 1 },
    });
    expect(diff({ lifestyle: { guests: 2 } })).toEqual({ lifestyle: { guests: 2 } });
    expect(diff({ lifestyle: { guests: 2, social: 1 } })).toEqual({
      lifestyle: { guests: 2, social: 1 },
    });
    expect(diff({ lifestyle: { guests: 2, night: 1, social: 3 } })).toEqual({
      lifestyle: { guests: 2, night: 1, social: 3 },
    });
    expect(diff({ lifestyle: {} })).toEqual({ lifestyle: {} });
    expect(diff({ gender_preference: 'any' })).toEqual({ gender_preference: 'any' });
    // Fewer flatmates: the ages that still fit go along only when the list changes.
    expect(diff({ flatmates_count: 2 })).toEqual({ flatmates_count: 2 });
    expect(diff({ flatmates_count: 1 })).toEqual({ flatmates_count: 1, flatmate_ages: [27] });
    // A type change in the form is never sent (spec 0010a); an apartment body sends no room key.
    expect(diff({ listing_type: 'apartment' })).toStrictEqual({});
    expect(diff({ listing_type: 'apartment', gender_preference: 'men' })).toStrictEqual({});
    // An apartment body with room values: the room fields only, never the type.
    const flat = listing();
    expect(
      changedFields(
        flat,
        toListingIn({
          ...formFromListing(flat),
          listing_type: 'room',
          flatmates_count: 2,
          flatmate_ages: ['', '29'],
        }),
      ),
    ).toStrictEqual({ flatmates_count: 2, flatmate_ages: [29] });

    // validatePreferences: the count and the age range, for rooms only.
    const required = { key: 'listings.errors.required' };
    expect(validatePreferences({ ...valid, listing_type: 'room' })).toEqual({
      flatmates_count: required,
    });
    expect(validatePreferences(room)).toEqual({});
    for (const ok of ['', '  ', '18', '99', ' 30 ']) {
      expect(validatePreferences({ ...room, flatmate_ages: [ok, ok] }), ok).toEqual({});
    }
    for (const bad of ['17', '100', '2x', '-20', '30.5']) {
      expect(validatePreferences({ ...room, flatmate_ages: ['30', bad] }), bad).toEqual({
        flatmate_ages: range(18, 99),
      });
    }
    // A slot beyond the count is ignored.
    expect(validatePreferences({ ...room, flatmate_ages: ['30', '27', '17'] })).toEqual({});
    expect(validatePreferences({ ...room, flatmates_count: null, flatmate_ages: ['17'] })).toEqual({
      flatmates_count: required,
    });
    expect(
      validatePreferences({ ...stale, flatmates_count: null, listing_type: 'apartment' }),
    ).toEqual({});
    expect(
      validatePreferences({ ...room, flatmate_ages: ['17'], accepted_households: [] }),
    ).toEqual({
      accepted_households: { key: 'listings.errors.households' },
      flatmate_ages: range(18, 99),
    });
    // validate() is the details step's only.
    expect(validate({ ...room, flatmates_count: null, flatmate_ages: ['17'] }, today)).toEqual({});
    // emptyForm: a room's defaults.
    expect(emptyForm).toMatchObject({
      gender_preference: 'any',
      flatmates_count: null,
      flatmate_ages: [],
    });
    expect(emptyForm.lifestyle).toStrictEqual({});
  });

  it('ac7 flat facts: room size rule, body mapping, edit form and changed fields', () => {
    // Spec 0010f AC7.
    const room: ListingForm = {
      ...valid,
      listing_type: 'room',
      flatmates_count: 2,
      size_sqm: '60',
    };
    const sizeError = (room_size_sqm: string, size_sqm = '60') =>
      validatePreferences({ ...room, size_sqm, room_size_sqm }).room_size_sqm;
    expect(sizeError('')).toBeUndefined();
    expect(sizeError('4')).toBeUndefined();
    expect(sizeError(' 60 ')).toBeUndefined();
    for (const bad of ['3', '61', '12.5', 'abc', '-5'])
      expect(sizeError(bad)).toEqual(range(4, 60));
    // Never above the API's 100, whatever the flat; a flat size that is not a number yet: 100.
    expect(sizeError('101', '200')).toEqual(range(4, 100));
    expect(sizeError('100', '200')).toBeUndefined();
    expect(sizeError('101', '')).toEqual(range(4, 100));
    // An apartment's (kept) room size is never checked.
    expect(
      validatePreferences({ ...room, listing_type: 'apartment', room_size_sqm: '999' }),
    ).toEqual({});

    // `''` is `null`; a room always sends the five, an apartment never.
    const facts = {
      room_size_sqm: null,
      private_bathroom: null,
      balcony: null,
      bills_included: null,
      poster: null,
    };
    expect(toListingIn(room)).toMatchObject(facts);
    const said: ListingForm = {
      ...room,
      room_size_sqm: '12',
      private_bathroom: 'yes',
      balcony: 'no',
      bills_included: 'yes',
      poster: 'landlord',
    };
    const saidBody = {
      room_size_sqm: 12,
      private_bathroom: true,
      balcony: false,
      bills_included: true,
      poster: 'landlord',
    };
    expect(toListingIn(said)).toMatchObject(saidBody);
    const apartment = toListingIn({ ...said, listing_type: 'apartment' });
    for (const key of Object.keys(facts)) expect(apartment).not.toHaveProperty(key);

    // The edit form starts from the stored facts, and only a changed one is sent.
    const stored = listing({
      listing_type: 'room',
      flatmates_count: 2,
      size_sqm: 60,
      ...saidBody,
      poster: 'landlord',
    });
    const form = formFromListing(stored);
    expect(form).toMatchObject({
      room_size_sqm: '12',
      private_bathroom: 'yes',
      balcony: 'no',
      bills_included: 'yes',
      poster: 'landlord',
    });
    expect(formFromListing(listing({ listing_type: 'room', flatmates_count: 2 }))).toMatchObject({
      room_size_sqm: '',
      private_bathroom: '',
      balcony: '',
      bills_included: '',
      poster: '',
    });
    expect(changedFields(stored, toListingIn(form))).toEqual({});
    expect(changedFields(stored, toListingIn({ ...form, balcony: '', room_size_sqm: '' }))).toEqual(
      { balcony: null, room_size_sqm: null },
    );
    expect(changedFields(stored, toListingIn({ ...form, poster: 'lives_here' }))).toEqual({
      poster: 'lives_here',
    });
  });

  it('ac10_changed_fields_never_type', () => {
    // Spec 0010a: `listing_type` is never in a PATCH, whatever the form holds.
    for (const stored of [
      listing(),
      listing({ listing_type: 'room', flatmates_count: 2, flatmate_ages: [27] }),
      listing({ listing_type: 'room', flatmates_count: null }),
    ]) {
      for (const type of ['apartment', 'room'] as const) {
        const base = formFromListing(stored);
        const form = {
          ...base,
          listing_type: type,
          price_ils: '5100',
          flatmates_count: base.flatmates_count ?? 2,
        };
        const patch = changedFields(stored, toListingIn(form));
        expect(Object.keys(patch), `${stored.listing_type} -> ${type}`).not.toContain(
          'listing_type',
        );
        expect(patch, `${stored.listing_type} -> ${type}`).toMatchObject({ price_ils: 5100 });
      }
    }
  });
});
