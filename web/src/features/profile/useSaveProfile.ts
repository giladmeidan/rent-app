import { useMutation, useQueryClient } from '@tanstack/react-query';

import { hasStatus } from '../applications/api';
import { clearSession } from '../auth/useLogout';
import { putProfile, type SeekerProfileIn, type SeekerProfileOut } from './api';
import { MARKET_PEOPLE_KEY, PEOPLE_LIKES_KEY } from '../people/useMarketPeople';
import { PROFILE_KEY } from './useProfile';

/**
 * Saves the profile (`PUT /me/profile`). On 200 the answer becomes the cached profile, so the
 * listing page's gate opens with no refetch. A 401 only forgets the session: `RequireUser` then
 * sends the person to `/login` (no return path, as `0004b`). Search results and the listing pages
 * are reset too: their `match` and `room_fit` depend on the profile, so a seeker who completes the
 * room section and returns via `next` must not see a stale apply button before the refetch.
 */
export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SeekerProfileIn) => putProfile(body),
    onSuccess: (saved) => {
      queryClient.setQueryData<SeekerProfileOut | null>(PROFILE_KEY, saved);
      for (const queryKey of [['search'], ['search-map'], ['listing']])
        queryClient.resetQueries({ queryKey });
      // A save can change the gender rule and the ticket (0010c): the people lists follow it.
      for (const queryKey of [MARKET_PEOPLE_KEY, PEOPLE_LIKES_KEY]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    onError: (error) => {
      if (hasStatus(error, 401)) clearSession(queryClient);
    },
  });
}
