import { useQuery } from '@tanstack/react-query';

import { fetchPublicListing } from './api';

/**
 * Public data, but not the same for everyone: a seeker with a profile also gets their match
 * (`0006b`, `Cache-Control: private`), so `clearSession` resets it on logout and login and the page
 * refetches as the new viewer. No refetch on window focus: each `GET` counts a view (0004a).
 */
export function usePublicListing(id: string) {
  return useQuery({
    queryKey: ['listing', id],
    queryFn: () => fetchPublicListing(id),
    refetchOnWindowFocus: false,
  });
}
