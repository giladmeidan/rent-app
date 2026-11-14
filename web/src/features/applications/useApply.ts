import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { clearDraft } from '../../app/drafts';
import type { ListingDetail } from '../listings/api';
import { clearSession } from '../auth/useLogout';
import { CONVERSATIONS_KEY } from '../chat/useConversations';
import { PROFILE_KEY } from '../profile/useProfile';
import { ApiError } from '../listings/api';
import { applyToListing, hasStatus, type MyApplicationOut } from './api';
import { MY_APPLICATIONS_KEY } from './useMyApplications';

/** `/login?next=…` back to this listing (the visitor prompt's link too). */
export const loginPath = (listingId: string) =>
  `/login?next=${encodeURIComponent(`/listings/${listingId}`)}`;

/**
 * Applies to `listingId` (`null`: no message, a room only, spec 0010l). On 201 the new (or
 * reopened) application tops the seeker's list and the listing's count goes up by one in the cache:
 * no refetch, so no extra counted view. A `shortlisted` 201 answered the lister's invite (spec
 * 0010l): its chat just opened, so the chat list is refetched. The 409s:
 * - `seeker_profile_required` refetches the profile (the section then shows the profile gate);
 * - `seeker_gender_required` (a women- or men-only room, no room section) refetches the profile and
 *   the listing: the owner may have made an `any` room gendered after the page loaded, and the
 *   cached `any` would keep a button whose every submit is refused (one extra counted view, rare);
 * - `room_gender_mismatch` marks the cached listing `room_fit: false` (the misfit line, at once,
 *   no extra view);
 * - any other (`already_applied`) refetches the list (it then holds the application).
 * A 401 forgets the session and sends the person to log in and come back.
 *
 * The typed message's draft (spec 0009g) is cleared by a 201, a 404 and the final 409s
 * (`already_applied`, `room_gender_mismatch`); a 401 and the profile 409s keep it, since the person
 * comes back to the form.
 */
export function useApply(listingId: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (message: string | null) => applyToListing(listingId, message),
    onSuccess: (app) => {
      clearDraft('apply', listingId);
      queryClient.setQueryData<MyApplicationOut[]>(
        MY_APPLICATIONS_KEY,
        (old) => old && [app, ...old.filter((a) => a.id !== app.id)],
      );
      queryClient.setQueryData<ListingDetail>(
        ['listing', listingId],
        // `like: null`: an open application ends the invite hint (as the API's `like` does).
        (old) => old && { ...old, applicant_count: old.applicant_count + 1, like: null },
      );
      if (app.status === 'shortlisted') {
        void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY, exact: true });
      }
    },
    onError: (error) => {
      if (hasStatus(error, 401)) {
        clearSession(queryClient);
        void navigate(loginPath(listingId));
      } else if (hasStatus(error, 404)) {
        clearDraft('apply', listingId);
      } else if (error instanceof ApiError && error.status === 409) {
        const code = error.detail;
        if (code === 'seeker_profile_required' || code === 'seeker_gender_required') {
          void queryClient.invalidateQueries({ queryKey: PROFILE_KEY, exact: true });
          if (code === 'seeker_gender_required') {
            void queryClient.invalidateQueries({ queryKey: ['listing', listingId], exact: true });
          }
        } else if (code === 'room_gender_mismatch') {
          clearDraft('apply', listingId);
          queryClient.setQueryData<ListingDetail>(
            ['listing', listingId],
            (old) => old && { ...old, room_fit: false },
          );
        } else {
          if (code === 'already_applied') clearDraft('apply', listingId);
          void queryClient.invalidateQueries({ queryKey: MY_APPLICATIONS_KEY, exact: true });
        }
      }
    },
  });
}
