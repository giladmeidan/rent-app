import { hashKey, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError } from '../listings/api';
import { searchListings } from './api';
import type { Filters } from './filters';

/** How long the draft must stay unchanged before its count is asked for. */
export const COUNT_DELAY_MS = 400;

/**
 * How many listings `draft` (with its `listing_type`) gives, or `undefined` while no fresh count is
 * known: the draft is still changing, the answer is on its way, or the request failed. It reads the
 * `total` of a one-item search; `newest` keeps the match score out of the query. A 429 stops the
 * counts until the form remounts, because an address behind one NAT shares its read budget.
 */
export function useFilterCount(draft: Filters, enabled: boolean): number | undefined {
  const queryKey = ['search', 'count', draft];
  const key = hashKey(queryKey);
  // The draft that stayed unchanged for the delay. Any edit forgets it, so going back to an earlier
  // draft waits again.
  const [settled, setSettled] = useState<string>();
  const [rateLimited, setRateLimited] = useState(false);
  if (settled !== undefined && settled !== key) setSettled(undefined);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => setSettled(key), COUNT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key, enabled]);

  const ready = enabled && settled === key && !rateLimited;
  const count = useQuery({
    queryKey,
    enabled: ready,
    queryFn: async () => {
      try {
        return await searchListings({ ...draft, sort: 'newest' }, 0, { limit: 1 });
      } catch (error) {
        // Here, not from the query's state: the answer may belong to a draft already edited away.
        if (error instanceof ApiError && error.status === 429) setRateLimited(true);
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return ready && count.isSuccess && !count.isFetching ? count.data.total : undefined;
}
