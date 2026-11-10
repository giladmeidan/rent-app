import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { MAP_RESULTS_LIMIT, type Bbox } from '../../components/map/config';
import { searchListings } from './api';
import type { Filters } from './filters';

/**
 * The map's results: the filters inside the visible box, up to `MAP_RESULTS_LIMIT`. Disabled until
 * the map reports its first box; the previous box's pins stay while the next one loads.
 */
export function useMapSearch(filters: Filters, bbox: Bbox | undefined) {
  return useQuery({
    queryKey: ['search-map', filters, bbox],
    queryFn: () => searchListings(filters, 0, { bbox, limit: MAP_RESULTS_LIMIT }),
    enabled: bbox !== undefined,
    placeholderData: keepPreviousData,
  });
}
