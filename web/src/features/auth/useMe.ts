import { useQuery } from '@tanstack/react-query';

import { api, type UserOut } from '../../api/client';

export const ME_KEY = ['me'] as const;

/** The logged-in person, or `null` when the API answers 401 (no or expired session). */
async function fetchMe(): Promise<UserOut | null> {
  const { data, response } = await api.GET('/me');
  if (response.status === 401) return null;
  if (data === undefined) throw new Error(`GET /me: HTTP ${String(response.status)}`);
  return data;
}

export function useMe() {
  // No retries: a failing /me renders the logged-out header at once instead of blocking the shell.
  return useQuery({ queryKey: ME_KEY, queryFn: fetchMe, retry: false, staleTime: 60_000 });
}
