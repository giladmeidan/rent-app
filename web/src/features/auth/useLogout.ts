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
    },
  });
}
