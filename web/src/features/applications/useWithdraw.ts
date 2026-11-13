import { useMutation, useQueryClient } from '@tanstack/react-query';

import { clearSession } from '../auth/useLogout';
import { hasStatus, withdrawApplication, type MyApplicationOut } from './api';
import { MY_APPLICATIONS_KEY } from './useMyApplications';

/**
 * Withdraws application `id`. On 200 it is replaced in the seeker's list. A 409 `not_withdrawable`
 * or a 404 means the list is out of date: it is refetched. A 401 forgets the session
 * (`RequireSeeker` on `/me/applications`, `RequireUser` on the market panel, then redirects to `/login`).
 */
export function useWithdraw(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => withdrawApplication(id),
    onSuccess: (app) => {
      queryClient.setQueryData<MyApplicationOut[]>(
        MY_APPLICATIONS_KEY,
        (old) => old && old.map((a) => (a.id === app.id ? app : a)),
      );
    },
    onError: (error) => {
      if (hasStatus(error, 401)) clearSession(queryClient);
      else if (hasStatus(error, 409) || hasStatus(error, 404)) {
        void queryClient.invalidateQueries({ queryKey: MY_APPLICATIONS_KEY, exact: true });
      }
    },
  });
}
