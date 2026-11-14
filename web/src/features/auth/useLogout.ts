import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api, type UserOut } from '../../api/client';
import { clearAllDrafts } from '../../app/drafts';
import { clearInviteToken } from '../flatmates/inviteToken';
import { clearSeen } from '../listings/seen';
import { ME_KEY } from './useMe';

async function logout(): Promise<void> {
  const { response } = await api.POST('/auth/logout');
  if (!response.ok) throw new Error(`POST /auth/logout: HTTP ${String(response.status)}`);
}

/**
 * Forgets the logged-in person on this device: `['me']` becomes `null` (logged out), the
 * per-user queries under `['me', …]` and every mutation (with its variables) are removed, and the
 * scored search and listing queries are reset. Run on logout, on login and on a 401 from a seeker
 * call, so a stale cached person never sends `LoginPage` straight back to `next`. A stashed
 * flatmates invite token (0008e) goes too, so the next person on this tab never sees it, unless
 * `keepInviteToken`: the login itself (the token was stashed for whoever logs in next, the trip
 * through login that A1 is built for) and the join page's own 401 (back to login, token kept).
 *
 * Unsent drafts (spec 0009g) are not cleared here: a 401 runs this too, and a draft must survive
 * that trip. Only an explicit logout (`useLogout`) clears them.
 */
export function clearSession(
  queryClient: QueryClient,
  { keepInviteToken = false }: { keepInviteToken?: boolean } = {},
): void {
  if (!keepInviteToken) clearInviteToken();
  queryClient.setQueryData<UserOut | null>(ME_KEY, null);
  // Per-user data lives under ['me', …]; the next person on this device must not see it.
  queryClient.removeQueries({
    queryKey: ME_KEY,
    exact: false,
    predicate: (q) => q.queryKey.length > 1,
  });
  // Mutations keep their variables (e.g. the last chat message sent); forget those too.
  queryClient.getMutationCache().clear();
  // Search results and listing pages carry the caller's match scores (0006b): reset, not remove,
  // so an open page refetches as the new viewer instead of keeping the last person's scores.
  for (const queryKey of [['search'], ['search-map'], ['listing'], ['market-people']]) {
    void queryClient.resetQueries({ queryKey });
  }
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      clearAllDrafts();
      clearSeen();
      clearSession(queryClient);
    },
  });
}
