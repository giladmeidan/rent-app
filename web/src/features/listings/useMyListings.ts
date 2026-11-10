import { useQuery } from '@tanstack/react-query';

import { fetchMyListings } from './api';

/** Under `['me', …]`: per-user data, removed from the cache on logout. */
export const MY_LISTINGS_KEY = ['me', 'listings'] as const;

export function useMyListings() {
  return useQuery({ queryKey: MY_LISTINGS_KEY, queryFn: fetchMyListings });
}
