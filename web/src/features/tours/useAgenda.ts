import { useQuery } from '@tanstack/react-query';

import { fetchAgenda } from './api';

/** Under `['me', …]`: per-user data, removed from the cache on logout. */
export const AGENDA_KEY = ['me', 'tours'] as const;

/** The tours agenda (spec 0018b); the default focus refetch refreshes it on return to the page. */
export function useAgenda() {
  return useQuery({ queryKey: AGENDA_KEY, queryFn: fetchAgenda });
}
