import { afterEach, describe, expect, it, vi } from 'vitest';

import { json, mockApi } from '../../auth/__tests__/harness';
import { searchListings } from '../api';
import {
  countActive,
  parseFilters,
  roomChipsOn,
  toggleRoomChip,
  toSearchParams,
  type Filters,
  type RoomChip,
} from '../filters';
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

  it('ac9 shelter filter parse and serialise', () => {
    // Spec 0015a: only `true` is kept; it counts as one filter and is written after the other
    // features, before the sort.
    expect(parse('shelter=true')).toEqual({ shelter: true });
    expect(countActive(parse('shelter=true'))).toBe(1);
    expect(toSearchParams(parse('shelter=true')).toString()).toBe('shelter=true');
    for (const query of ['shelter=false', 'shelter=1', 'shelter=mamad', 'shelter=']) {
      expect(parse(query), query).toEqual({});
    }
    expect(toSearchParams(parse('sort=price_asc&shelter=true&parking=true')).toString()).toBe(
      'parking=true&shelter=true&sort=price_asc',
    );
    expect(countActive(parse('pets=true&shelter=true'))).toBe(2);
  });

  it('ac9 shelter filter is sent to the API, the list and the map box alike', async () => {
    const api = mockApi({ 'GET /listings': [json(page([])), json(page([]))] });
    await searchListings({ shelter: true, listing_type: 'room' }, 0);
    await searchListings({ shelter: true }, 0, {
      bbox: [34.7712, 32.0412, 34.8299, 32.1099],
      limit: 50,
    });
    expect(query(at(api.calls('GET /listings'), 0).request)).toEqual(
      expected({ listing_type: 'room', shelter: 'true', limit: '20', offset: '0' }),
    );
    expect(query(at(api.calls('GET /listings'), 1).request)).toContainEqual(['shelter', 'true']);
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
    // Spec 0010a: the type is the page's (`/search` or `/market`), never a URL filter.
    for (const query of ['listing_type=room', 'listing_type=apartment', 'listing_type=']) {
      expect(parse(query), query).toEqual({});
      expect(parse(query), query).not.toHaveProperty('listing_type');
    }
    // Never written, and never counted, even when the page sets it.
    expect(
      toSearchParams({
        ...parse('pets=true&available_by=2027-01-05'),
        listing_type: 'room',
      }).toString(),
    ).toBe('available_by=2027-01-05&pets=true');
    expect(countActive({ listing_type: 'room' })).toBe(0);
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

  it('ac6_area_ids_url', async () => {
    const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const [a, b] = [id(1), id(2)];

    // In the order given, lower-cased; invalid and repeated ids are dropped.
    const dirty = `area_ids=${b}&area_ids=nope&area_ids=${a.toUpperCase()}&area_ids=&area_ids=${b}`;
    expect(parse(`area_ids=${b}&area_ids=${a}`)).toEqual({ area_ids: [b, a] });
    expect(parse(dirty.replace('aaaaaaaa', 'AAAAAAAA'))).toEqual({ area_ids: [b, a] });
    // A repeat in another case is still a repeat.
    expect(parse(`area_ids=${a}&area_ids=${a.toUpperCase()}`)).toEqual({ area_ids: [a] });
    // None left: the key is not set at all.
    expect(parse('area_ids=nope&area_ids=')).not.toHaveProperty('area_ids');

    // The first 20, counted after the repeats are gone.
    const many = Array.from({ length: 25 }, (_, i) => id(i));
    const capped = [many[0], ...many].map((value) => `area_ids=${String(value)}`).join('&');
    expect(parse(capped).area_ids).toEqual(many.slice(0, 20));

    // Round trip: one param per id, first in the URL's key order.
    const url = `area_ids=${b}&area_ids=${a}&price_max=8000&pets=true`;
    expect(toSearchParams(parse(url)).toString()).toBe(url);
    expect(toSearchParams({ pets: true, area_ids: [a] }).toString()).toBe(
      `area_ids=${a}&pets=true`,
    );

    // Each area is one active filter.
    expect(countActive(parse(url))).toBe(4);
    expect(countActive({ area_ids: [a] })).toBe(1);
    expect(countActive({})).toBe(0);

    // The request repeats the param; without areas it is absent.
    const api = mockApi({ 'GET /listings': [json(page([])), json(page([]))] });
    await searchListings({ area_ids: [b, a] }, 0);
    await searchListings({}, 0);
    expect(
      new URL(at(api.calls('GET /listings'), 0).request.url).searchParams.getAll('area_ids'),
    ).toEqual([b, a]);
    expect(query(at(api.calls('GET /listings'), 1).request)).toEqual(
      expected({ limit: '20', offset: '0' }),
    );
  });

  it('ac17_room_chips', () => {
    const range = (rooms_min?: number, rooms_max?: number) => ({ rooms_min, rooms_max });
    const none = range();

    // On: the chip's whole interval is inside the range, and a bound is set.
    const on: [ReturnType<typeof range>, RoomChip[]][] = [
      [none, []],
      [range(3, 3.5), [3]],
      [range(2, 4.5), [2, 3, 4]],
      [range(5), [5]],
      [range(3), [3, 4, 5]],
      [range(undefined, 2.5), [1, 2]],
      // Inexact ranges: only what fits whole.
      [range(2.5), [3, 4, 5]],
      [range(3, 3), []],
      [range(2.5, 3), []],
      // 5+ has no maximum, so any upper bound leaves it off.
      [range(5, 10), []],
      [range(4, 10), [4]],
    ];
    for (const [value, chips] of on)
      expect(roomChipsOn(value), JSON.stringify(value)).toEqual(chips);

    // Nothing on: that chip alone; 5+ sets no maximum.
    expect(toggleRoomChip(none, 3)).toEqual(range(3, 3.5));
    expect(toggleRoomChip(none, 5)).toEqual(range(5));
    expect(toggleRoomChip(range(3, 3), 2)).toEqual(range(2, 2.5));
    // Outside the run: it grows to the chip, on either side, across a gap.
    expect(toggleRoomChip(range(3, 3.5), 4)).toEqual(range(3, 4.5));
    expect(toggleRoomChip(range(3, 3.5), 1)).toEqual(range(1, 3.5));
    expect(toggleRoomChip(range(2, 2.5), 5)).toEqual(range(2));
    // An end of a longer run: it shrinks by that end.
    expect(toggleRoomChip(range(2, 4.5), 2)).toEqual(range(3, 4.5));
    expect(toggleRoomChip(range(2, 4.5), 4)).toEqual(range(2, 3.5));
    expect(toggleRoomChip(range(4), 5)).toEqual(range(4, 4.5));
    expect(toggleRoomChip(range(4), 4)).toEqual(range(5));
    // The only chip on: cleared, both bounds present so they override the URL's.
    expect(toggleRoomChip(range(3, 3.5), 3)).toEqual(none);
    expect(toggleRoomChip(range(3, 3.5), 3)).toHaveProperty('rooms_min', undefined);
    expect(toggleRoomChip(range(5), 5)).toEqual(none);
    // The middle of a run: that chip alone.
    expect(toggleRoomChip(range(2, 4.5), 3)).toEqual(range(3, 3.5));
    // An inexact range is replaced by the first tap.
    expect(toggleRoomChip(range(2.5), 4)).toEqual(range(4, 4.5));
  });
});
