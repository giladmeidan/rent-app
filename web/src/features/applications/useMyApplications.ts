import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { clearSession } from '../auth/useLogout';
import { fetchMyApplications, hasStatus } from './api';

/** Under `['me', …]`, so logout (`clearSession`) removes it with the other per-user data. */
export const MY_APPLICATIONS_KEY = ['me', 'applications'] as const;

/**
 * The seeker's own applications. Pass `enabled = false` for a visitor or an owner, who never
 * request it. A 401 (the session ended) forgets the cached person, so the page shows the logged-out
 * state.
 */
export function useMyApplications(enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: MY_APPLICATIONS_KEY, queryFn: fetchMyApplications, enabled });
  const expired = hasStatus(query.error, 401);
  useEffect(() => {
    if (expired) clearSession(queryClient);
  }, [expired, queryClient]);
  return query;
}
