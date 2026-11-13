// The search map's position in the URL (spec 0009w), as `filters.ts` is the filters': the centre
// `c=<lat>,<lng>`, the zoom `z` and the selected listing `pin`. They are not filters: never sent to
// the API, never part of a query key. The URL is user input, so anything invalid is dropped
// silently, never an error and never a request.
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, MAP_POSITION_BOUNDS } from '../../components/map/config';

export const MAP_PARAMS = ['c', 'z', 'pin'] as const;

export type MapPosition = {
  center?: [lng: number, lat: number] | undefined;
  zoom?: number | undefined;
  pin?: string | undefined;
};

/** The zoom of a centre given without one. */
const CENTRE_ZOOM = 14;

const COORD = /^-?\d{1,3}(\.\d{1,6})?$/;
const ZOOM = /^-?\d{1,3}(\.\d{1,2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `lat,lng` (latitude first, as people read coordinates) inside `MAP_POSITION_BOUNDS`. */
function parseCenter(value: string | null): [lng: number, lat: number] | undefined {
  if (value === null) return undefined;
  const parts = value.split(',');
  if (parts.length !== 2) return undefined;
  const [latText = '', lngText = ''] = parts;
  if (!COORD.test(latText) || !COORD.test(lngText)) return undefined;
  const lat = Number(latText);
  const lng = Number(lngText);
  const [west, south, east, north] = MAP_POSITION_BOUNDS;
  if (lng < west || lng > east || lat < south || lat > north) return undefined;
  return [lng, lat];
}

/**
 * The map position a URL holds. `z` is clamped to the map's zoom range and used only with a valid
 * `c` (a centre without a zoom uses zoom 14); `pin` is any UUID, with no version check, in lower
 * case.
 */
export function parseMapPosition(params: URLSearchParams): MapPosition {
  const position: MapPosition = {};
  const center = parseCenter(params.get('c'));
  if (center !== undefined) {
    position.center = center;
    const z = params.get('z');
    position.zoom =
      z !== null && ZOOM.test(z)
        ? Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, Number(z)))
        : CENTRE_ZOOM;
  }
  const pin = params.get('pin');
  // The API's ids are lower-case: an upper-case pin would never match its listing.
  if (pin !== null && UUID.test(pin)) position.pin = pin.toLowerCase();
  return position;
}

const round = (value: number, decimals: number) =>
  Math.round(value * 10 ** decimals) / 10 ** decimals;

/**
 * A copy of `params` where only the keys present in `position` are touched: `center` writes `c`
 * (4 decimals, ~11 m, as `roundBbox`), `zoom` writes `z` (2 decimals), and a key present with
 * `undefined` removes its param. So a move's `{ center, zoom }` keeps the selected pin. Every other
 * key keeps its value and order.
 */
export function writeMapPosition(params: URLSearchParams, position: MapPosition): URLSearchParams {
  const next = new URLSearchParams(params);
  if ('center' in position) {
    const { center } = position;
    if (center === undefined) next.delete('c');
    else next.set('c', `${String(round(center[1], 4))},${String(round(center[0], 4))}`);
  }
  if ('zoom' in position) {
    const { zoom } = position;
    if (zoom === undefined) next.delete('z');
    else next.set('z', String(round(zoom, 2)));
  }
  if ('pin' in position) {
    const { pin } = position;
    if (pin === undefined) next.delete('pin');
    else next.set('pin', pin);
  }
  return next;
}

/** Only the map params of `params`, as they are: carried across a filter change. */
export function pickMapParams(params: URLSearchParams): URLSearchParams {
  const picked = new URLSearchParams();
  for (const key of MAP_PARAMS) {
    const value = params.get(key);
    if (value !== null) picked.set(key, value);
  }
  return picked;
}
