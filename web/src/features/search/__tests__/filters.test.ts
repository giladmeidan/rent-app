import { describe, expect, it } from 'vitest';

import { countActive, parseFilters, toSearchParams, type Filters } from '../filters';

const parse = (query: string) => parseFilters(new URLSearchParams(query));

describe('filters', () => {
  it('ac8_filter_rules', () => {
    // Valid values are kept, typed. Each row is canonical: it round-trips unchanged.
    const valid: [string, Filters, number][] = [
      ['', {}, 0],
      ['price_min=0', { price_min: 0 }, 1],
      ['price_max=100000', { price_max: 100000 }, 1],
      ['price_min=4000&price_max=8000', { price_min: 4000, price_max: 8000 }, 2],
      ['price_min=8000&price_max=8000', { price_min: 8000, price_max: 8000 }, 2],
      ['rooms_min=1', { rooms_min: 1 }, 1],
      ['rooms_max=10', { rooms_max: 10 }, 1],
      ['rooms_min=3&rooms_max=4.5', { rooms_min: 3, rooms_max: 4.5 }, 2],
      ['available_by=2027-02-28', { available_by: '2027-02-28' }, 1],
      ['available_by=2028-02-29', { available_by: '2028-02-29' }, 1],
      ['pets=true', { pets: true }, 1],
      [
        'furnished=true&elevator=true&parking=true',
        { furnished: true, elevator: true, parking: true },
        3,
      ],
      ['sort=price_asc', { sort: 'price_asc' }, 0],
      ['sort=price_desc', { sort: 'price_desc' }, 0],
      [
        'price_min=0&price_max=8000&rooms_min=2.5&rooms_max=4&available_by=2027-01-01&pets=true&furnished=true&elevator=true&parking=true&sort=price_desc',
        {
          price_min: 0,
          price_max: 8000,
          rooms_min: 2.5,
          rooms_max: 4,
          available_by: '2027-01-01',
          pets: true,
          furnished: true,
          elevator: true,
          parking: true,
          sort: 'price_desc',
        },
        9,
      ],
    ];
    for (const [query, filters, active] of valid) {
      const parsed = parse(query);
      expect(parsed, query).toEqual(filters);
      expect(countActive(parsed), query).toBe(active);
      expect(toSearchParams(parsed).toString(), query).toBe(query);
    }

    // Each invalid value is dropped: not parsed, not written back.
    const invalid = [
      'price_max=abc',
      'rooms_min=2.3',
      'pets=maybe',
      'sort=match',
      'available_by=2027-02-30',
      'colour=red',
      'price_max=-1',
      'price_max=100001',
      'price_max=8000.5',
      'price_max=8e3',
      'price_max=%208000',
      'price_max=',
      'rooms_max=0.5',
      'rooms_max=10.5',
      'parking=1',
      'furnished=TRUE',
      'available_by=2027-2-3',
      'pets=',
      'sort=',
    ];
    for (const query of invalid) {
      const parsed = parse(query);
      expect(parsed, query).toEqual({});
      expect(countActive(parsed), query).toBe(0);
      expect(toSearchParams(parsed).toString(), query).toBe('');
    }
    // AC2's mixed URL keeps nothing.
    expect(
      parse('price_max=abc&rooms_min=2.3&pets=maybe&sort=match&available_by=2027-02-30&colour=red'),
    ).toEqual({});

    // A min above its max drops the max.
    expect(parse('price_min=9000&price_max=8000')).toEqual({ price_min: 9000 });
    expect(parse('rooms_min=4&rooms_max=3')).toEqual({ rooms_min: 4 });
    expect(toSearchParams(parse('price_min=9000&price_max=8000')).toString()).toBe(
      'price_min=9000',
    );

    // `newest` parses, but as the default it is omitted on output.
    expect(parse('sort=newest')).toEqual({ sort: 'newest' });
    expect(toSearchParams(parse('sort=newest&pets=true')).toString()).toBe('pets=true');

    // Output order is canonical, whatever the input order; empty and undefined values are omitted.
    expect(toSearchParams(parse('sort=price_asc&pets=true&price_max=8000')).toString()).toBe(
      'price_max=8000&pets=true&sort=price_asc',
    );
    expect(
      toSearchParams({ price_min: undefined, pets: undefined, sort: undefined }).toString(),
    ).toBe('');
  });
});
