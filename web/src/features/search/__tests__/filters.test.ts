import { afterEach, describe, expect, it, vi } from 'vitest';

import { json, mockApi } from '../../auth/__tests__/harness';
import { searchListings } from '../api';
import { countActive, parseFilters, toSearchParams, type Filters } from '../filters';
import { at, expected, page, query } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

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
      'sort=foo',
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
      parse('price_max=abc&rooms_min=2.3&pets=maybe&sort=foo&available_by=2027-02-30&colour=red'),
    ).toEqual({});

    // A min above its max drops the max.
    expect(parse('price_min=9000&price_max=8000')).toEqual({ price_min: 9000 });
    expect(parse('rooms_min=4&rooms_max=3')).toEqual({ rooms_min: 4 });
    expect(toSearchParams(parse('price_min=9000&price_max=8000')).toString()).toBe(
      'price_min=9000',
    );

    // Output order is canonical, whatever the input order; empty and undefined values are omitted.
    expect(toSearchParams(parse('sort=price_asc&pets=true&price_max=8000')).toString()).toBe(
      'price_max=8000&pets=true&sort=price_asc',
    );
    expect(
      toSearchParams({ price_min: undefined, pets: undefined, sort: undefined }).toString(),
    ).toBe('');
  });

  it('ac5_match_sort_in_url', () => {
    expect(parse('sort=match')).toEqual({ sort: 'match' });
    expect(toSearchParams(parse('sort=match')).toString()).toBe('sort=match');
    expect(countActive(parse('sort=match'))).toBe(0);
    // `newest` parses and, as an explicit choice (0006f), stays on output.
    expect(parse('sort=newest')).toEqual({ sort: 'newest' });
    expect(toSearchParams(parse('sort=newest&pets=true')).toString()).toBe('pets=true&sort=newest');
  });

  it('ac2_view_param_and_bbox_query', async () => {
    // Only the exact `map` is kept.
    expect(parse('view=map')).toEqual({ view: 'map' });
    for (const query of ['view=list', 'view=MAP', 'view=']) {
      expect(parse(query), query).toEqual({});
    }
    // Written last, after `sort`; not counted as a filter.
    const withView = parse('view=map&sort=price_asc&pets=true');
    expect(toSearchParams(withView).toString()).toBe('pets=true&sort=price_asc&view=map');
    expect(countActive(withView)).toBe(1);
    expect(countActive(parse('view=map'))).toBe(0);

    // Never sent; the bbox and limit are sent when given.
    const api = mockApi({ 'GET /listings': [json(page([])), json(page([]))] });
    const filters: Filters = { price_max: 8000, pets: true };
    await searchListings({ ...filters, view: 'map' }, 0);
    await searchListings(filters, 0, { bbox: [34.7712, 32.0412, 34.8299, 32.1099], limit: 50 });
    const plain = at(api.calls('GET /listings'), 0).request;
    const boxed = at(api.calls('GET /listings'), 1).request;
    expect(query(plain)).toEqual(
      expected({ price_max: '8000', pets: 'true', limit: '20', offset: '0' }),
    );
    expect(query(boxed)).toEqual(
      expected({
        price_max: '8000',
        pets: 'true',
        west: '34.7712',
        south: '32.0412',
        east: '34.8299',
        north: '32.1099',
        limit: '50',
        offset: '0',
      }),
    );
  });

  it('ac1_listing_type_in_url', async () => {
    // Only the exact `apartment` and `room` are kept, so no URL can 422.
    expect(parse('listing_type=room')).toEqual({ listing_type: 'room' });
    expect(parse('listing_type=apartment')).toEqual({ listing_type: 'apartment' });
    for (const query of ['listing_type=both', 'listing_type=', 'listing_type=Room']) {
      expect(parse(query), query).toEqual({});
    }
    // Written right after `available_by`, before the features.
    expect(
      toSearchParams(parse('pets=true&listing_type=room&available_by=2027-01-05')).toString(),
    ).toBe('available_by=2027-01-05&listing_type=room&pets=true');
    // One type is one active filter; none is none.
    expect(countActive(parse('listing_type=room'))).toBe(1);
    expect(countActive(parse(''))).toBe(0);

    // Sent when set, absent otherwise.
    const api = mockApi({ 'GET /listings': [json(page([])), json(page([]))] });
    await searchListings({ listing_type: 'room' }, 0);
    await searchListings({}, 0);
    expect(query(at(api.calls('GET /listings'), 0).request)).toEqual(
      expected({ listing_type: 'room', limit: '20', offset: '0' }),
    );
    expect(query(at(api.calls('GET /listings'), 1).request)).toEqual(
      expected({ limit: '20', offset: '0' }),
    );
  });
});
