import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';

import { searchListings } from './api';
import type { Filters } from './filters';

/** The list's pages; `enabled` is false in the map view, which sends its own query. */
export function useSearch(filters: Filters, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['search', filters],
    enabled,
    queryFn: ({ pageParam }) => searchListings(filters, pageParam),
    initialPageParam: 0,
    // The next offset counts raw items, repeats included, so paging never stalls on a repeat.
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length > 0 && loaded < last.total ? loaded : undefined;
    },
  });
}

/**
 * The loaded pages as one list in API order. A listing created while a visitor pages shifts the
 * later offsets by one, so a page can repeat the previous page's last id: the repeat is dropped.
 */
export function flattenPages<T extends { id: string }>(data: InfiniteData<{ items: T[] }>): T[] {
  const seen = new Set<string>();
  const items: T[] = [];
  for (const page of data.pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}
