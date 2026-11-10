import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api, type UserOut } from '../../api/client';
import { ME_KEY } from './useMe';

async function logout(): Promise<void> {
  const { response } = await api.POST('/auth/logout');
  if (!response.ok) throw new Error(`POST /auth/logout: HTTP ${String(response.status)}`);
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData<UserOut | null>(ME_KEY, null);
      // Per-user data lives under ['me', …]; the next person on this device must not see it.
      queryClient.removeQueries({
        queryKey: ME_KEY,
        exact: false,
        predicate: (q) => q.queryKey.length > 1,
      });
    },
  });
}
