import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../../api/client';
import { clearAllDrafts } from '../../app/drafts';
import { ApiError } from '../listings/api';
import { clearSession } from '../auth/useLogout';
import { clearSeen } from '../listings/seen';

/** `DELETE /me` (spec 0013c). 204 resolves; 403 `reauth_required` and every other failure throw. */
async function deleteAccount(): Promise<void> {
  const { error, response } = await api.DELETE('/me');
  if (response.status !== 204) throw new ApiError('DELETE', '/me', response.status, error);
}

/** True for the 403 that asks the person to sign in again (their session is over 15 minutes old). */
export function isReauthRequired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.detail === 'reauth_required';
}

/**
 * Deletes the signed-in account. On 204 it navigates to `/account-deleted` (`replace`: Back does
 * not return to the profile), and forgets the person on this device as a logout does once the
 * page that called this has unmounted. Not in `onSuccess`: the router commits a navigation in a
 * transition, but the query cache's store updates are synchronous, so clearing `['me']` there would
 * render `RequireUser` on `/me/profile` with no person first and bounce to the login page.
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const deleted = useRef(false);
  useEffect(
    () => () => {
      if (!deleted.current) return;
      clearAllDrafts();
      clearSeen();
      clearSession(queryClient);
    },
    [queryClient],
  );
  return useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      deleted.current = true;
      void navigate('/account-deleted', { replace: true });
    },
  });
}
