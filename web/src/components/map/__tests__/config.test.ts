import { afterEach, describe, expect, it, vi } from 'vitest';

import style from '../../../../public/map/osm-raster.json';
import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { mapLocale, roundBbox } from '../config';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** `config.ts` as a fresh import, so it reads the current env. */
async function freshConfig() {
  vi.resetModules();
  return import('../config');
}

describe('map config', () => {
  it('ac7_style_url_bbox_rounding_locale_and_osm_style', async () => {
    // The style URL comes from the env, with the bundled OSM style as the default.
    vi.stubEnv('VITE_MAP_STYLE_URL', 'https://tiles.example/style.json');
    expect((await freshConfig()).MAP_STYLE_URL).toBe('https://tiles.example/style.json');
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_MAP_STYLE_URL', undefined);
    expect((await freshConfig()).MAP_STYLE_URL).toBe('/map/osm-raster.json');

    // Rounded to 4 decimals; world copies clamped to the valid range.
    expect(roundBbox([34.77123, 32.04126, 34.82999, 32.10994])).toEqual([
      34.7712, 32.0413, 34.83, 32.1099,
    ]);
    expect(roundBbox([-200.1, 31.9, 200.2, 32.2])).toEqual([-180, 31.9, 180, 32.2]);
    expect(roundBbox([10, -95, 20, 95])).toEqual([10, -90, 20, 90]);

    // The controls' labels are he.json's (compared with the JSON: i18next returns a missing key).
    const locale = mapLocale(i18n.t);
    const expected: Record<string, string> = {
      'Map.Title': he.map.title,
      'NavigationControl.ZoomIn': he.map.zoomIn,
      'NavigationControl.ZoomOut': he.map.zoomOut,
      'NavigationControl.ResetBearing': he.map.resetBearing,
      'AttributionControl.ToggleAttribution': he.map.toggleAttribution,
      'Marker.Title': he.map.marker,
    };
    for (const [key, value] of Object.entries(expected)) {
      expect(locale[key], key).toBe(value);
    }

    // The OSM style: one raster source, the public tile URL, maxzoom 19, the legal attribution.
    expect(style.version).toBe(8);
    const sources = Object.values(style.sources);
    expect(sources).toHaveLength(1);
    const [osm] = sources;
    expect(osm?.type).toBe('raster');
    expect(osm?.tiles).toEqual(['https://tile.openstreetmap.org/{z}/{x}/{y}.png']);
    expect(osm?.maxzoom).toBe(19);
    expect(osm?.attribution).toContain('https://www.openstreetmap.org/copyright');
    expect(osm?.attribution).toContain('OpenStreetMap');
    expect(style.layers.map((layer) => layer.type)).toEqual(['raster']);
  });

  it('roundBbox_never_returns_an_empty_box', () => {
    // A phone-width box at a high zoom rounds to zero width and height.
    const [west, south, east, north] = roundBbox([34.84502, 32.06, 34.84508, 32.06004]);
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);
    // At the edge of the world the box grows inward.
    const [w, s, e, n] = roundBbox([180, 90, 200, 95]);
    expect(w).toBeLessThan(e);
    expect(e).toBeLessThanOrEqual(180);
    expect(s).toBeLessThan(n);
    expect(n).toBeLessThanOrEqual(90);
  });
});
