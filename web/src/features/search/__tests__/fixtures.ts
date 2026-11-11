// Fixtures for the search and public listing tests; the fetch mock and render helpers are the auth
// harness's.
import type { ListingDetail } from '../../listings/api';
import type { ListingPublic, ListingSearchOut } from '../api';

let n = 0;
/** A live apartment as `GET /listings` and `GET /listings/{id}` return it. */
export function publicListing(overrides: Partial<ListingPublic> = {}): ListingPublic {
  n += 1;
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
    listing_type: 'apartment',
    city: 'רמת גן',
    street: `ביאליק ${String(n)}`,
    rooms: 3,
    floor: 2,
    total_floors: 4,
    size_sqm: 80,
    price_ils: 6000,
    available_from: '2026-12-01',
    entry_flexible: false,
    elevator: false,
    parking_spots: 0,
    furnished: 'none',
    pets_allowed: false,
    arnona_ils: null,
    vaad_ils: null,
    description: null,
    accepted_households: ['single', 'couple', 'family', 'roommates'],
    smoking_allowed: true,
    min_contract_months: null,
    created_at: '2026-11-01T10:00:00Z',
    lat: null,
    lng: null,
    match: null,
    ...overrides,
  };
}

/** `GET /listings/{id}`'s shape: a public listing plus its applicant count. */
export function listingDetail(overrides: Partial<ListingDetail> = {}): ListingDetail {
  return { ...publicListing(), applicant_count: 0, ...overrides };
}

/** `count` fresh listings. */
export const listings = (count: number) => Array.from({ length: count }, () => publicListing());

export const page = (items: ListingPublic[], total = items.length): ListingSearchOut => ({
  items,
  total,
  sort: 'newest',
});

/** A request's query as sorted `[key, value]` pairs (a set comparison that still sees repeats). */
export function query(request: Request): [string, string][] {
  return [...new URL(request.url).searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** `query`'s form for an expected record. */
export const expected = (params: Record<string, string>): [string, string][] =>
  Object.entries(params).sort(([a], [b]) => a.localeCompare(b));

/** `items[i]`, failing the test when it is missing. */
export function at<T>(items: readonly T[], i: number): T {
  const item = items[i];
  if (item === undefined) throw new Error(`no item at ${String(i)}`);
  return item;
}
