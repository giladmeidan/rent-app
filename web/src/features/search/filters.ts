import type { ListingType } from '../listings/api';
import { AREAS_MAX } from '../profile/validate';

// The search's filter state lives in the URL only. The URL is user input: `parseFilters` keeps a
// value only when `0003a`'s `GET /listings` would accept it, so no URL can produce a 422, and an
// unset filter is absent (an empty value such as `pets=` is a 422 there, not "no filter").

// `match` (spec 0006b) orders by the caller's match score. With no `sort` the API decides: `match`
// for a seeker with a profile, else `newest`; an explicit one, `newest` included, stays in the URL.
export const SORTS = ['match', 'newest', 'price_asc', 'price_desc'] as const;
export type Sort = (typeof SORTS)[number];

export const PRICE_MAX = 100_000;
export const ROOMS_MIN = 1;
export const ROOMS_MAX = 10;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FEATURES = ['pets', 'furnished', 'elevator', 'parking', 'shelter'] as const;
export type Feature = (typeof FEATURES)[number];

export type Filters = {
  /** Cities and neighbourhoods (spec 0023a), in the order picked: lower-case ids, no repeats. */
  area_ids?: string[] | undefined;
  price_min?: number | undefined;
  price_max?: number | undefined;
  rooms_min?: number | undefined;
  rooms_max?: number | undefined;
  /** `YYYY-MM-DD`. */
  available_by?: string | undefined;
  /** The page's side (spec 0010a): set only by `SearchPage` from its `type`, never a URL key and
   * never counted as a filter. */
  listing_type?: ListingType | undefined;
  /** Only ever `true`: an unchecked feature is no filter, not `false`. */
  pets?: true | undefined;
  furnished?: true | undefined;
  elevator?: true | undefined;
  parking?: true | undefined;
  /** The flat has a protected space (spec 0015a): a ממ״ד, a ממ״ק or a מקלט in the building. */
  shelter?: true | undefined;
  sort?: Sort | undefined;
  /** `map`: the results as a map (spec 0003d). Not a filter: never sent to the API, never counted. */
  view?: 'map' | undefined;
};

/** The URL's key order, as `toSearchParams` writes it. */
const KEYS = [
  'area_ids',
  'price_min',
  'price_max',
  'rooms_min',
  'rooms_max',
  'available_by',
  ...FEATURES,
  'sort',
  'view',
] as const satisfies readonly (keyof Filters)[];

const PRICE = /^\d{1,6}$/;
const ROOMS = /^\d{1,2}(\.5)?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parsePrice(value: string | null): number | undefined {
  if (value === null || !PRICE.test(value)) return undefined;
  const price = Number(value);
  return price <= PRICE_MAX ? price : undefined;
}

function parseRooms(value: string | null): number | undefined {
  if (value === null || !ROOMS.test(value)) return undefined;
  const rooms = Number(value);
  return rooms >= ROOMS_MIN && rooms <= ROOMS_MAX ? rooms : undefined;
}

/** A real calendar day as `YYYY-MM-DD` (rejects `2027-02-30`, `2027-2-3`). */
export function isCalendarDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isSort(value: string | null): value is Sort {
  return (SORTS as readonly (string | null)[]).includes(value);
}

/** The filters a URL holds; anything invalid is dropped, and a max below its min is dropped. */
export function parseFilters(params: URLSearchParams): Filters {
  const filters: Filters = {};

  const areaIds = [
    ...new Set(
      params
        .getAll('area_ids')
        .filter((id) => UUID.test(id))
        .map((id) => id.toLowerCase()),
    ),
  ].slice(0, AREAS_MAX);
  if (areaIds.length > 0) filters.area_ids = areaIds;

  const priceMin = parsePrice(params.get('price_min'));
  let priceMax = parsePrice(params.get('price_max'));
  if (priceMin !== undefined && priceMax !== undefined && priceMin > priceMax) priceMax = undefined;
  if (priceMin !== undefined) filters.price_min = priceMin;
  if (priceMax !== undefined) filters.price_max = priceMax;

  const roomsMin = parseRooms(params.get('rooms_min'));
  let roomsMax = parseRooms(params.get('rooms_max'));
  if (roomsMin !== undefined && roomsMax !== undefined && roomsMin > roomsMax) roomsMax = undefined;
  if (roomsMin !== undefined) filters.rooms_min = roomsMin;
  if (roomsMax !== undefined) filters.rooms_max = roomsMax;

  const availableBy = params.get('available_by');
  if (availableBy !== null && isCalendarDay(availableBy)) filters.available_by = availableBy;

  for (const feature of FEATURES) {
    if (params.get(feature) === 'true') filters[feature] = true;
  }

  const sort = params.get('sort');
  if (isSort(sort)) filters.sort = sort;

  if (params.get('view') === 'map') filters.view = 'map';

  return filters;
}

/** The canonical URL for `filters`: fixed key order, no empty values. An explicit sort is kept:
 * `newest` is the only way to ask for that order when the API's default would be `match`. */
export function toSearchParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of KEYS) {
    const value = filters[key];
    if (value === undefined) continue;
    // One param per area, in order.
    if (Array.isArray(value)) for (const item of value) params.append(key, item);
    else params.set(key, String(value));
  }
  return params;
}

/** How many filters are set (`sort` and `view` are not filters, nor is the page's `listing_type`;
 * each area and each price and rooms bound counts). */
export function countActive(filters: Filters): number {
  const others = KEYS.filter(
    (key) => key !== 'area_ids' && key !== 'sort' && key !== 'view' && filters[key] !== undefined,
  );
  return others.length + (filters.area_ids?.length ?? 0);
}

/** The rooms quick choices: `n` is `n` to `n + 0.5` rooms, and the last, 5+, is 5 and up. */
export const ROOM_CHIPS = [1, 2, 3, 4, 5] as const;
export type RoomChip = (typeof ROOM_CHIPS)[number];
export type RoomRange = Pick<Filters, 'rooms_min' | 'rooms_max'>;

const LAST_ROOM_CHIP: RoomChip = 5;

/** The chips whose whole interval lies inside `range`, in order; none when no bound is set. */
export function roomChipsOn({ rooms_min: min, rooms_max: max }: RoomRange): RoomChip[] {
  if (min === undefined && max === undefined) return [];
  return ROOM_CHIPS.filter((chip) => {
    if (min !== undefined && chip < min) return false;
    if (max === undefined) return true;
    return chip !== LAST_ROOM_CHIP && chip + 0.5 <= max;
  });
}

const chipsRange = (from: number, to: number): RoomRange => ({
  rooms_min: from,
  rooms_max: to === LAST_ROOM_CHIP ? undefined : to + 0.5,
});

/**
 * `range` after a tap on `chip`. Nothing on: that chip alone. Outside the run of chips that are on:
 * the run grows to it. An end of a longer run: the run shrinks by it. The only chip on: no range.
 * The middle of a run: that chip alone.
 */
export function toggleRoomChip(range: RoomRange, chip: RoomChip): RoomRange {
  const on = roomChipsOn(range);
  const first = on[0];
  const last = on.at(-1);
  if (first === undefined || last === undefined) return chipsRange(chip, chip);
  if (chip < first) return chipsRange(chip, last);
  if (chip > last) return chipsRange(first, chip);
  if (first === last) return { rooms_min: undefined, rooms_max: undefined };
  if (chip === first) return chipsRange(first + 1, last);
  if (chip === last) return chipsRange(first, last - 1);
  return chipsRange(chip, chip);
}
