import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';

import { fetchPeople, peopleKey, type PeoplePageOut, type PersonOut } from './api';

/** The people of `listingId`, 20 a page. Pass `enabled = false` until the listing is known to be
 * the owner's room, so an unknown id sends no request. */
export function usePeople(listingId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: peopleKey(listingId),
    enabled,
    queryFn: ({ pageParam }) => fetchPeople(listingId, pageParam),
    initialPageParam: 0,
    // As `useSearch`: the next offset counts raw items, repeats included, so paging never stalls.
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length > 0 && loaded < last.total ? loaded : undefined;
    },
  });
}

/** The loaded pages as one list in API order. A like moves a person between pages, so a page can
 * repeat an earlier id: the repeat is dropped. */
export function flattenPeople(data: InfiniteData<PeoplePageOut>): PersonOut[] {
  const seen = new Set<string>();
  const items: PersonOut[] = [];
  for (const page of data.pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}
