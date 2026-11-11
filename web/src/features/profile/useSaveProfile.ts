import { useMutation, useQueryClient } from '@tanstack/react-query';

import { hasStatus } from '../applications/api';
import { clearSession } from '../auth/useLogout';
import { putProfile, type SeekerProfileIn, type SeekerProfileOut } from './api';
import { PROFILE_KEY } from './useProfile';

/**
 * Saves the profile (`PUT /me/profile`). On 200 the answer becomes the cached profile, so the
 * listing page's gate opens with no refetch. A 401 only forgets the session: `RequireSeeker` then
 * sends the person to `/login` (no return path, as `0004b`).
 */
export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SeekerProfileIn) => putProfile(body),
    onSuccess: (saved) => {
      queryClient.setQueryData<SeekerProfileOut | null>(PROFILE_KEY, saved);
    },
    onError: (error) => {
      if (hasStatus(error, 401)) clearSession(queryClient);
    },
  });
}
