import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { hasStatus } from '../applications/api';
import { clearSession } from '../auth/useLogout';
import { fetchProfile } from './api';

/** Under `['me', …]`, so logout (`clearSession`) removes it with the other per-user data. */
export const PROFILE_KEY = ['me', 'profile'] as const;

/**
 * The seeker's housing profile: `null` when there is none yet. Pass `enabled = false` for a
 * visitor or an owner, who never request it. A 401 (the session ended) forgets the cached person,
 * so the page shows the logged-out state (or `RequireUser` sends them to `/login`).
 */
export function useProfile(enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: PROFILE_KEY, queryFn: fetchProfile, enabled });
  const expired = hasStatus(query.error, 401);
  useEffect(() => {
    if (expired) clearSession(queryClient);
  }, [expired, queryClient]);
  return query;
}
