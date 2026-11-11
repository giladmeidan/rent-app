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

export const FEATURES = ['pets', 'furnished', 'elevator', 'parking'] as const;
export type Feature = (typeof FEATURES)[number];

export type Filters = {
  price_min?: number | undefined;
  price_max?: number | undefined;
  rooms_min?: number | undefined;
  rooms_max?: number | undefined;
  /** `YYYY-MM-DD`. */
  available_by?: string | undefined;
  /** Only ever `true`: an unchecked feature is no filter, not `false`. */
  pets?: true | undefined;
  furnished?: true | undefined;
  elevator?: true | undefined;
  parking?: true | undefined;
  sort?: Sort | undefined;
  /** `map`: the results as a map (spec 0003d). Not a filter: never sent to the API, never counted. */
  view?: 'map' | undefined;
};

/** The URL's key order, as `toSearchParams` writes it. */
const KEYS = [
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
    params.set(key, String(value));
  }
  return params;
}

/** How many filters are set (`sort` and `view` are not filters; each price and rooms bound counts). */
export function countActive(filters: Filters): number {
  return KEYS.filter((key) => key !== 'sort' && key !== 'view' && filters[key] !== undefined)
    .length;
}
