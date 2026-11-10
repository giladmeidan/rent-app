import { describe, expect, it } from 'vitest';

import { addDays } from '../format';
import { emptyForm, toListingIn, validate, type FieldName, type ListingForm } from '../validate';

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
});
