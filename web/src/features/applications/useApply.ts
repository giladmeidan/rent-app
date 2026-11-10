import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import type { ListingDetail } from '../listings/api';
import { clearSession } from '../auth/useLogout';
import { applyToListing, hasStatus, type MyApplicationOut } from './api';
import { MY_APPLICATIONS_KEY } from './useMyApplications';

/** `/login?next=…` back to this listing (the visitor prompt's link too). */
export const loginPath = (listingId: string) =>
  `/login?next=${encodeURIComponent(`/listings/${listingId}`)}`;

/**
 * Applies to `listingId`. On 201 the new (or reopened) application tops the seeker's list and the
 * listing's count goes up by one in the cache: no refetch, so no extra counted view. A 409
 * `already_applied` refetches the list (it then holds the application); a 401 forgets the session
 * and sends the person to log in and come back.
 */
export function useApply(listingId: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (message: string) => applyToListing(listingId, message),
    onSuccess: (app) => {
      queryClient.setQueryData<MyApplicationOut[]>(
        MY_APPLICATIONS_KEY,
        (old) => old && [app, ...old.filter((a) => a.id !== app.id)],
      );
      queryClient.setQueryData<ListingDetail>(
        ['listing', listingId],
        (old) => old && { ...old, applicant_count: old.applicant_count + 1 },
      );
    },
    onError: (error) => {
      if (hasStatus(error, 401)) {
        clearSession(queryClient);
        void navigate(loginPath(listingId));
      } else if (hasStatus(error, 409)) {
        void queryClient.invalidateQueries({ queryKey: MY_APPLICATIONS_KEY, exact: true });
      }
    },
  });
}
