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

/** Israel (spec 0021d): the search map's whole-country box. */
export const ISRAEL_BOUNDS: Bbox = [34.2, 29.45, 35.9, 33.35];

/** Where a map centre read from the URL may lie: `ISRAEL_BOUNDS` widened by 0.5 deg on each side
 * (spec 0009w), so a hand-edited link never flies the map to another country. */
export const MAP_POSITION_BOUNDS: Bbox = [33.7, 28.95, 36.4, 33.85];

/** Where the search map opens without a URL position or a preferred area: Tel Aviv-Yafo. */
export const DEFAULT_VIEW: { center: [lng: number, lat: number]; zoom: number } = {
  center: [34.7818, 32.0853],
  zoom: 13,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** Whether a point lies inside `ISRAEL_BOUNDS` (spec 0021d). */
export function inIsrael(lng: number, lat: number): boolean {
  const [west, south, east, north] = ISRAEL_BOUNDS;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

/** The snapping grid: 0.002 deg (~200 m), the grid of the listings' own privacy offset (0003c). */
const GRID_DEG = 0.002;

/**
 * A point snapped to the ~200 m grid, then to 4 decimals (spec 0009y): the device's position moves
 * the map to its grid cell, so the URL and the box request never carry the exact fix.
 */
export function snapToGrid([lng, lat]: [lng: number, lat: number]): [lng: number, lat: number] {
  const snap = (value: number) => round4(Math.round(value / GRID_DEG) * GRID_DEG);
  return [snap(lng), snap(lat)];
}

/** The Earth's circumference at the equator in metres (Web Mercator). */
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

/**
 * `meters` on the ground as screen pixels at a latitude and zoom: MapLibre's world is 512 px wide
 * at zoom 0 and doubles per level, whatever the raster tiles' size.
 */
export function metersToPixels(meters: number, lat: number, zoom: number): number {
  const metersPerPixel =
    (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
  return meters / metersPerPixel;
}

/** The listing page's area radius: the stored point is the street's point plus a fixed per-listing
 * offset of up to ~220 m per axis (0003c), so a smaller circle would claim more precision than the
 * data has (Gilad, 2026-11-13, decision 6). */
export const APPROXIMATE_RADIUS_M = 300;

/** At most this many pins (`0003c`'s `limit` cap). */
export const MAP_RESULTS_LIMIT = 50;

/** The search map cannot zoom out past the whole country (~3.9 deg tall, about z6.5 at phone
 * height). */
export const MAP_MIN_ZOOM = 6;

/**
 * The raster source's `maxzoom`: above it tiles are only upscaled, and at z21-22 a phone-width
 * box rounds to zero width.
 */
export const MAP_MAX_ZOOM = 19;

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
