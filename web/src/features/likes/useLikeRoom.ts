import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { hasStatus } from '../applications/api';
import { loginPath } from '../applications/useApply';
import { MY_APPLICATIONS_KEY } from '../applications/useMyApplications';
import { clearSession } from '../auth/useLogout';
import { CONVERSATIONS_KEY } from '../chat/useConversations';
import { ApiError, type ListingDetail } from '../listings/api';
import { likeRoom, unlikeRoom, type LikeStateOut } from './api';
import { MY_LIKES_KEY } from './useMyLikes';

/** What the control shows for a failed like or unlike; `null` shows nothing. */
export type LikeProblem = 'roomSection' | 'gone' | 'rateLimited' | 'failed';

/** The inline problem for `error`: `useLikeRoom` has already updated the caches. */
export function likeProblem(error: unknown): LikeProblem | null {
  if (!(error instanceof ApiError)) return error === null ? null : 'failed';
  if (error.status === 401) return null;
  if (error.status === 404) return 'gone';
  if (error.status === 429) return 'rateLimited';
  if (error.status === 409) {
    if (error.detail === 'room_section_required' || error.detail === 'seeker_profile_required') {
      return 'roomSection';
    }
    // `room_gender_mismatch` hides the button (RoomGate explains) and `already_applied` shows the
    // application: neither has an alert.
    if (error.detail === 'room_gender_mismatch' || error.detail === 'already_applied') return null;
  }
  return 'failed';
}

/** Writes `like` into the cached listing. Never a refetch: each `GET /listings/{id}` counts a view. */
function setCachedLike(
  queryClient: QueryClient,
  listingId: string,
  next: (old: LikeStateOut | null) => LikeStateOut | null,
) {
  queryClient.setQueryData<ListingDetail>(
    ['listing', listingId],
    (old) => old && { ...old, like: next(old.like) },
  );
}

function useLikeFailure(listingId: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (error: unknown) => {
    if (hasStatus(error, 401)) {
      clearSession(queryClient);
      void navigate(loginPath(listingId));
    } else if (error instanceof ApiError && error.status === 404) {
      void queryClient.invalidateQueries({ queryKey: MY_LIKES_KEY, exact: true });
    } else if (error instanceof ApiError && error.status === 409) {
      if (error.detail === 'room_gender_mismatch') {
        queryClient.setQueryData<ListingDetail>(
          ['listing', listingId],
          (old) => old && { ...old, room_fit: false },
        );
      } else if (error.detail === 'already_applied') {
        setCachedLike(queryClient, listingId, () => null);
        void queryClient.invalidateQueries({ queryKey: MY_APPLICATIONS_KEY, exact: true });
        void queryClient.invalidateQueries({ queryKey: MY_LIKES_KEY, exact: true });
      }
    }
  };
}

/**
 * Likes a room. On success the cached listing's `like` becomes `liked_by_me: true` (`liked_me` is
 * kept); a mutual result (`application_id`) sets it to `null` and refreshes the applications and
 * the chats. The caller's `onSuccess` gets the result.
 */
export function useLikeRoom(listingId: string) {
  const queryClient = useQueryClient();
  const onFailure = useLikeFailure(listingId);
  return useMutation({
    mutationFn: () => likeRoom(listingId),
    onSuccess: (result) => {
      if (result.application_id !== null) {
        setCachedLike(queryClient, listingId, () => null);
        void queryClient.invalidateQueries({ queryKey: MY_APPLICATIONS_KEY, exact: true });
        void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY, exact: true });
      } else {
        setCachedLike(queryClient, listingId, (old) => ({
          liked_me: old?.liked_me ?? false,
          liked_by_me: true,
        }));
      }
      void queryClient.invalidateQueries({ queryKey: MY_LIKES_KEY, exact: true });
    },
    onError: onFailure,
  });
}

/** Takes the like back; the cached listing's `liked_by_me` becomes `false`. */
export function useUnlikeRoom(listingId: string) {
  const queryClient = useQueryClient();
  const onFailure = useLikeFailure(listingId);
  return useMutation({
    mutationFn: () => unlikeRoom(listingId),
    onSuccess: () => {
      setCachedLike(queryClient, listingId, (old) => ({
        liked_me: old?.liked_me ?? false,
        liked_by_me: false,
      }));
      void queryClient.invalidateQueries({ queryKey: MY_LIKES_KEY, exact: true });
    },
    onError: onFailure,
  });
}
