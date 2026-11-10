// Map settings shared by the map views. No `maplibre-gl` import here: this module is in the entry
// bundle, and the library is loaded only by `MapCanvas` when a map is shown.
import type { TFunction } from 'i18next';

/** `[west, south, east, north]` in degrees. */
export type Bbox = [west: number, south: number, east: number, north: number];

/**
 * The MapLibre style. Public OSM raster tiles by default; moving to self-hosted Protomaps is
 * pointing `VITE_MAP_STYLE_URL` at that style (plus the RTL text plugin, see spec 0003d).
 */
export const MAP_STYLE_URL: string = import.meta.env.VITE_MAP_STYLE_URL || '/map/osm-raster.json';

// shortcut: one launch area, read the area's box from the API when a second area is added.
/** Gush Dan, the same box as `api/scripts/seed.py`'s `GUSH_DAN_WKT`. */
export const GUSH_DAN_BOUNDS: Bbox = [34.74, 31.95, 34.95, 32.17];

/** At most this many pins (`0003c`'s `limit` cap). */
export const MAP_RESULTS_LIMIT = 50;

/** The search map cannot zoom out past central Israel. */
export const MAP_MIN_ZOOM = 8;

/**
 * The raster source's `maxzoom`: above it tiles are only upscaled, and at z21-22 a phone-width
 * box rounds to zero width.
 */
export const MAP_MAX_ZOOM = 19;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** The rounding step: 4 decimals. */
const STEP = 0.0001;

/**
 * One axis of a box, never empty: if rounding made `low >= high`, `high` is one step above `low`,
 * or `low` one step below `max` when that would pass it.
 */
function nonEmpty(low: number, high: number, max: number): [number, number] {
  if (low < high) return [low, high];
  if (round4(low + STEP) <= max) return [low, round4(low + STEP)];
  return [round4(max - STEP), max];
}

/**
 * A box `GET /listings` accepts: lng clamped to [-180, 180], lat to [-90, 90] (MapLibre's world
 * copies report longitudes beyond +-180 when zoomed out, which `0003c` answers with a 422), then
 * each value rounded to 4 decimals (~11 m), so small moves share a query key; never empty
 * (`west < east`, `south < north`), which `0003c` also answers with a 422.
 */
export function roundBbox([west, south, east, north]: Bbox): Bbox {
  const [w, e] = nonEmpty(round4(clamp(west, -180, 180)), round4(clamp(east, -180, 180)), 180);
  const [s, n] = nonEmpty(round4(clamp(south, -90, 90)), round4(clamp(north, -90, 90)), 90);
  return [w, s, e, n];
}

/**
 * MapLibre's `locale` for the controls this app shows (the canvas, zoom buttons, attribution and
 * markers), keyed as maplibre-gl 6.16's `defaultLocale`.
 */
export function mapLocale(t: TFunction): Record<string, string> {
  return {
    'Map.Title': t('map.title'),
    'NavigationControl.ZoomIn': t('map.zoomIn'),
    'NavigationControl.ZoomOut': t('map.zoomOut'),
    'NavigationControl.ResetBearing': t('map.resetBearing'),
    'AttributionControl.ToggleAttribution': t('map.toggleAttribution'),
    'Marker.Title': t('map.marker'),
  };
}
