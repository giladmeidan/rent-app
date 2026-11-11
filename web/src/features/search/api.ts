import { api } from '../../api/client';
import type { components, operations } from '../../api/schema';
import type { Bbox } from '../../components/map/config';
import { ApiError, type ListingPublic } from '../listings/api';
import { FEATURES, type Filters } from './filters';

export type { ListingPublic };
export type ListingSearchOut = components['schemas']['ListingSearchOut'];
type SearchQuery = NonNullable<operations['search_listings_listings_get']['parameters']['query']>;

export const PAGE_SIZE = 20;

export type SearchOptions = {
  /** Only listings inside this box (`0003c`'s `west` / `south` / `east` / `north`). */
  bbox?: Bbox | undefined;
  /** The page size instead of `PAGE_SIZE`. */
  limit?: number | undefined;
};

/**
 * One page of `GET /listings`. Only the filters that are set are sent: `0003a` answers an empty
 * value (`pets=`) with a 422, so an unset filter must be absent, never blank. `view` is not a
 * filter and is never sent.
 */
export async function searchListings(
  filters: Filters,
  offset: number,
  opts: SearchOptions = {},
): Promise<ListingSearchOut> {
  const query: SearchQuery = { limit: opts.limit ?? PAGE_SIZE, offset };
  if (opts.bbox !== undefined) {
    [query.west, query.south, query.east, query.north] = opts.bbox;
  }
  if (filters.price_min !== undefined) query.price_min = filters.price_min;
  if (filters.price_max !== undefined) query.price_max = filters.price_max;
  if (filters.rooms_min !== undefined) query.rooms_min = filters.rooms_min;
  if (filters.rooms_max !== undefined) query.rooms_max = filters.rooms_max;
  if (filters.available_by !== undefined) query.available_by = filters.available_by;
  if (filters.listing_type !== undefined) query.listing_type = filters.listing_type;
  for (const feature of FEATURES) {
    if (filters[feature] === true) query[feature] = true;
  }
  if (filters.sort !== undefined) query.sort = filters.sort;

  const { data, error, response } = await api.GET('/listings', { params: { query } });
  // A 422 (which `parseFilters` should make impossible) is a generic error: its English `msg` is
  // never shown.
  if (data === undefined) throw new ApiError('GET', '/listings', response.status, error);
  return data;
}
