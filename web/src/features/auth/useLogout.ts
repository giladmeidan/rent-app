import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api, type UserOut } from '../../api/client';
import { ME_KEY } from './useMe';

async function logout(): Promise<void> {
  const { response } = await api.POST('/auth/logout');
  if (!response.ok) throw new Error(`POST /auth/logout: HTTP ${String(response.status)}`);
}

/**
 * Forgets the logged-in person on this device: `['me']` becomes `null` (logged out) and the
 * per-user queries under `['me', …]` and every mutation (with its variables) are removed. Run on logout and on a 401 from a seeker call,
 * so a stale cached person never sends `LoginPage` straight back to `next`.
 */
export function clearSession(queryClient: QueryClient): void {
  queryClient.setQueryData<UserOut | null>(ME_KEY, null);
  // Per-user data lives under ['me', …]; the next person on this device must not see it.
  queryClient.removeQueries({
    queryKey: ME_KEY,
    exact: false,
    predicate: (q) => q.queryKey.length > 1,
  });
  // Mutations keep their variables (e.g. the last chat message sent); forget those too.
  queryClient.getMutationCache().clear();
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      clearSession(queryClient);
    },
  });
}
