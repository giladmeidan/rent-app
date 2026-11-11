import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { UserOut } from '../../api/client';
import { hasStatus } from '../applications/api';
import { ME_KEY } from '../auth/useMe';
import { MY_LISTINGS_KEY } from '../listings/useMyListings';
import { setApplicantStatus, type ApplicantOut, type ApplicantStatus } from './api';
import { applicantsKey } from './useApplicants';

/**
 * Sets one applicant's status. Server-confirmed, not optimistic: the cache changes only on a 200,
 * so an error has nothing to roll back. On 200 the applicant is replaced in the list and "my
 * listings" (its counts) is refetched. A 404 (withdrawn meanwhile) or 409 (declined meanwhile)
 * is not trusted on its own (0004c FOLLOWUPS): the list is refetched, and the mutation settles
 * only once it is back. 401 forgets the person and 403 re-checks `/me`, so `RequireOwner` leaves
 * the page (as `ListingWizard.onSaveError`).
 */
export function useSetApplicantStatus(listingId: string, applicationId: string) {
  const queryClient = useQueryClient();
  const key = applicantsKey(listingId);
  return useMutation({
    mutationFn: (status: ApplicantStatus) => setApplicantStatus(listingId, applicationId, status),
    onSuccess: (updated) => {
      queryClient.setQueryData<ApplicantOut[]>(key, (old) =>
        old?.map((a) => (a.id === updated.id ? updated : a)),
      );
      void queryClient.invalidateQueries({ queryKey: MY_LISTINGS_KEY });
    },
    onError: async (error) => {
      if (hasStatus(error, 401)) queryClient.setQueryData<UserOut | null>(ME_KEY, null);
      else if (hasStatus(error, 403)) {
        void queryClient.invalidateQueries({ queryKey: ME_KEY, exact: true });
      } else if (hasStatus(error, 404) || hasStatus(error, 409)) {
        void queryClient.invalidateQueries({ queryKey: MY_LISTINGS_KEY });
        await queryClient.invalidateQueries({ queryKey: key, exact: true });
      }
    },
  });
}
