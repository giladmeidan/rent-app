import { useQuery } from '@tanstack/react-query';

import { fetchPublicListing } from './api';

/** Public data, not under `['me', …]`: the same for every visitor, kept across logout. */
export function usePublicListing(id: string) {
  return useQuery({ queryKey: ['listing', id], queryFn: () => fetchPublicListing(id) });
}
