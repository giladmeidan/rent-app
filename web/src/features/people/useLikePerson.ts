import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { UserOut } from '../../api/client';
import { hasStatus } from '../applications/api';
import { ME_KEY } from '../auth/useMe';
import { MY_LISTINGS_KEY } from '../listings/useMyListings';
import { likePerson, peopleKey, unlikePerson } from './api';

/** Shared by the like and the unlike: server-confirmed, then the page refetches (a like is an
 * invite, spec 0010l: it never creates an application). An error refetches the page and "my
 * listings" (the person may be gone or have applied, which moves its counts). 401 forgets the
 * person, so `RequireUser` leaves the page, with no alert; a 403 (none since spec 0010b: any
 * account browses its own room) re-checks `/me` (as `useSetApplicantStatus`). */
function useRefresh(listingId: string) {
  const queryClient = useQueryClient();
  return {
    settled: async () => {
      await queryClient.invalidateQueries({ queryKey: peopleKey(listingId), exact: true });
    },
    failed: async (error: unknown) => {
      if (hasStatus(error, 401)) queryClient.setQueryData<UserOut | null>(ME_KEY, null);
      else if (hasStatus(error, 403)) {
        void queryClient.invalidateQueries({ queryKey: ME_KEY, exact: true });
      } else {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: MY_LISTINGS_KEY }),
          queryClient.invalidateQueries({ queryKey: peopleKey(listingId), exact: true }),
        ]);
      }
    },
  };
}

/** Likes a person for the room. Settles once the refetch is back, so the card's button is
 * disabled until it shows the new state. */
export function useLikePerson(listingId: string) {
  const refresh = useRefresh(listingId);
  return useMutation({
    mutationFn: (personId: string) => likePerson(listingId, personId),
    onSuccess: refresh.settled,
    onError: refresh.failed,
  });
}

/** Takes a like back. No confirm: it is reversible. */
export function useUnlikePerson(listingId: string) {
  const refresh = useRefresh(listingId);
  return useMutation({
    mutationFn: (personId: string) => unlikePerson(listingId, personId),
    onSuccess: refresh.settled,
    onError: refresh.failed,
  });
}
