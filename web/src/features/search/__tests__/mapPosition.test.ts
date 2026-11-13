import { describe, expect, it } from 'vitest';

import { MAP_POSITION_BOUNDS } from '../../../components/map/config';
import { MAP_PARAMS, parseMapPosition, pickMapParams, writeMapPosition } from '../mapPosition';

const UUID = '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f';
const FIXTURE_ID = '00000000-0000-0000-0000-000000000007';
const parse = (query: string) => parseMapPosition(new URLSearchParams(query));

describe('mapPosition', () => {
  it('ac1_parse_and_write', () => {
    expect(MAP_PARAMS).toEqual(['c', 'z', 'pin']);
    expect(MAP_POSITION_BOUNDS).toEqual([34.24, 31.45, 35.45, 32.67]);

    // Kept: the centre (latitude first in the URL, [lng, lat] out), the zoom and a UUID pin.
    expect(parse(`c=32.0712,34.8123&z=13.5&pin=${UUID}`)).toEqual({
      center: [34.8123, 32.0712],
      zoom: 13.5,
      pin: UUID,
    });
    // The comma as URLSearchParams serialises it, an upper-case UUID and a test fixture's id.
    expect(parse('c=32.0712%2C34.8123&z=13.5')).toEqual({ center: [34.8123, 32.0712], zoom: 13.5 });
    expect(parse(`pin=${UUID.toUpperCase()}`)).toEqual({ pin: UUID.toUpperCase() });
    expect(parse(`pin=${FIXTURE_ID}`)).toEqual({ pin: FIXTURE_ID });
    // A centre without a zoom uses zoom 14; an invalid zoom is the same as none.
    expect(parse('c=32.0712,34.8123')).toEqual({ center: [34.8123, 32.0712], zoom: 14 });
    expect(parse('c=32.0712,34.8123&z=13.555')).toEqual({ center: [34.8123, 32.0712], zoom: 14 });

    // Dropped: a centre outside MAP_POSITION_BOUNDS (New York), malformed centres, a non-UUID
    // pin, a lone zoom.
    expect(parse('c=40.7,-74.0&z=12')).toEqual({});
    for (const c of [
      'abc',
      '32.07',
      '32.07,',
      ',34.8',
      '32.07,34.8,1',
      '32.0712345,34.8',
      '1e1,34.8',
    ]) {
      expect(parse(`c=${encodeURIComponent(c)}&z=12`)).toEqual({});
    }
    for (const pin of ['abc', '3f2a9c1e7b4d4e8a9c2f1a2b3c4d5e6f', `${UUID}x`, `x${UUID}`, '']) {
      expect(parse(`pin=${pin}`)).toEqual({});
    }
    expect(parse('z=13')).toEqual({});
    // The bounds' edges are inside; just past them is not.
    expect(parse('c=31.45,34.24').center).toEqual([34.24, 31.45]);
    expect(parse('c=32.67,35.45').center).toEqual([35.45, 32.67]);
    expect(parse('c=31.449,34.8')).toEqual({});
    expect(parse('c=32.07,35.451')).toEqual({});

    // The zoom is clamped to [MAP_MIN_ZOOM, MAP_MAX_ZOOM].
    expect(parse('c=32.0712,34.8123&z=25').zoom).toBe(19);
    expect(parse('c=32.0712,34.8123&z=2').zoom).toBe(8);

    // Writing rounds the centre to 4 decimals (lat first) and the zoom to 2.
    const written = writeMapPosition(new URLSearchParams('price_max=8000&view=map'), {
      center: [34.812345678, 32.071249],
      zoom: 13.456,
    });
    expect(written.get('c')).toBe('32.0712,34.8123');
    expect(written.get('z')).toBe('13.46');
    expect([...written.keys()]).toEqual(['price_max', 'view', 'c', 'z']);
    expect(written.toString()).toBe('price_max=8000&view=map&c=32.0712%2C34.8123&z=13.46');
    // What is written parses back.
    expect(parseMapPosition(written)).toEqual({ center: [34.8123, 32.0712], zoom: 13.46 });

    // A move (`{ center, zoom }`) over a URL with a pin keeps it; every key keeps its order.
    const before = new URLSearchParams(`c=32.1,34.8&price_max=8000&z=12&pin=${UUID}&view=map`);
    const moved = writeMapPosition(before, { center: [34.9, 32.05], zoom: 15 });
    expect(moved.toString()).toBe(`c=32.05%2C34.9&price_max=8000&z=15&pin=${UUID}&view=map`);
    // `{ pin: undefined }` removes only the pin; `{ pin }` sets it.
    expect(writeMapPosition(moved, { pin: undefined }).toString()).toBe(
      'c=32.05%2C34.9&price_max=8000&z=15&view=map',
    );
    expect(writeMapPosition(new URLSearchParams('view=map'), { pin: FIXTURE_ID }).toString()).toBe(
      `view=map&pin=${FIXTURE_ID}`,
    );
    // The input is never changed.
    expect(before.get('z')).toBe('12');

    // Only the map params are picked, as they are.
    expect(pickMapParams(before).toString()).toBe(`c=32.1%2C34.8&z=12&pin=${UUID}`);
    expect(pickMapParams(new URLSearchParams('price_max=8000&view=map')).toString()).toBe('');
  });
});
