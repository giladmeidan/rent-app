import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../../api/client';
import { clearAllDrafts } from '../../app/drafts';
import { clearSession } from '../auth/useLogout';
import { clearInviteToken } from '../flatmates/inviteToken';
import { ApiError } from '../listings/api';
import { clearSeen } from '../listings/seen';

/** `DELETE /me` (spec 0013c). 204 resolves; 403 `reauth_required` and every other failure throw. */
async function deleteAccount(): Promise<void> {
  const { error, response } = await api.DELETE('/me');
  if (response.status !== 204) throw new ApiError('DELETE', '/me', response.status, error);
}

/** True when the person must sign in again: the 403 for a session over 15 minutes old, or a 401
 * (the session is already gone). */
export function isReauthRequired(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 401 || (error.status === 403 && error.detail === 'reauth_required');
}

/**
 * Deletes the signed-in account. On 204 it forgets the person on this device as a logout does and
 * navigates to `/account-deleted` (`replace`: Back does not return to the profile). The storage
 * (drafts, seen, the invite token) goes first, in `onSuccess`, where it always runs, even if the page
 * has unmounted meanwhile (Back, or a 401 bounce). The query cache (`['me']`) goes when the page that
 * called this unmounts: the router commits a navigation in a transition, but the cache's store
 * updates are synchronous, so clearing `['me']` before it would render `RequireUser` on `/me/profile`
 * with no person and bounce to the login page. If that page is already gone, it goes at once.
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mounted = useRef(true);
  const deleted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (deleted.current) clearSession(queryClient);
    };
  }, [queryClient]);
  return useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      clearAllDrafts();
      clearSeen();
      clearInviteToken();
      deleted.current = true;
      if (!mounted.current) clearSession(queryClient);
      void navigate('/account-deleted', { replace: true });
    },
  });
}
