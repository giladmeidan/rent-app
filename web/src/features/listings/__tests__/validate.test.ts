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
});
