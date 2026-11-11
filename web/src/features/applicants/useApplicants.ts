import { useQuery } from '@tanstack/react-query';

import { fetchApplicants } from './api';

/** Under `['me', …]`: per-user data, removed from the cache on logout (`clearSession`). */
export const applicantsKey = (listingId: string) => ['me', 'applicants', listingId] as const;

/** The applicants of `listingId`. Pass `enabled = false` until the listing is known to be the
 * owner's, so an unknown id sends no request. */
export function useApplicants(listingId: string, enabled = true) {
  return useQuery({
    queryKey: applicantsKey(listingId),
    queryFn: () => fetchApplicants(listingId),
    enabled,
  });
}
