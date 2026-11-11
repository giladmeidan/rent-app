import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import type { ListingDetail } from '../listings/api';
import { clearSession } from '../auth/useLogout';
import { PROFILE_KEY } from '../profile/useProfile';
import { ApiError } from '../listings/api';
import { applyToListing, hasStatus, type MyApplicationOut } from './api';
import { MY_APPLICATIONS_KEY } from './useMyApplications';

/** `/login?next=…` back to this listing (the visitor prompt's link too). */
export const loginPath = (listingId: string) =>
  `/login?next=${encodeURIComponent(`/listings/${listingId}`)}`;

/**
 * Applies to `listingId`. On 201 the new (or reopened) application tops the seeker's list and the
 * listing's count goes up by one in the cache: no refetch, so no extra counted view. The 409s:
 * - `seeker_profile_required` refetches the profile (the section then shows the profile gate);
 * - `seeker_gender_required` (a women- or men-only room, no room section) refetches the profile and
 *   the listing: the owner may have made an `any` room gendered after the page loaded, and the
 *   cached `any` would keep a button whose every submit is refused (one extra counted view, rare);
 * - `room_gender_mismatch` marks the cached listing `room_fit: false` (the misfit line, at once,
 *   no extra view);
 * - any other (`already_applied`) refetches the list (it then holds the application).
 * A 401 forgets the session and sends the person to log in and come back.
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
      } else if (error instanceof ApiError && error.status === 409) {
        const code = error.detail;
        if (code === 'seeker_profile_required' || code === 'seeker_gender_required') {
          void queryClient.invalidateQueries({ queryKey: PROFILE_KEY, exact: true });
          if (code === 'seeker_gender_required') {
            void queryClient.invalidateQueries({ queryKey: ['listing', listingId], exact: true });
          }
        } else if (code === 'room_gender_mismatch') {
          queryClient.setQueryData<ListingDetail>(
            ['listing', listingId],
            (old) => old && { ...old, room_fit: false },
          );
        } else {
          void queryClient.invalidateQueries({ queryKey: MY_APPLICATIONS_KEY, exact: true });
        }
      }
    },
  });
}
