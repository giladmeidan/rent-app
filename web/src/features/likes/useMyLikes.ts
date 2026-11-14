import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { hasStatus } from '../applications/api';
import { clearSession } from '../auth/useLogout';
import { fetchMyLikes } from './api';

/** Under `['me', …]`, so logout (`clearSession`) removes it with the other per-user data. */
export const MY_LIKES_KEY = ['me', 'likes'] as const;

/**
 * The rooms that invited the caller (any account, spec 0010b; `GET /me/likes` keeps its name, spec
 * 0010m). Pass `enabled = false` for whoever must not request it (the search map, spec 0009v); the
 * market's "הפעילות שלי" tab and the invites section of the room applications pass nothing. A 401 forgets the cached person.
 */
export function useMyLikes(enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: MY_LIKES_KEY, queryFn: fetchMyLikes, enabled });
  const expired = hasStatus(query.error, 401);
  useEffect(() => {
    if (expired) clearSession(queryClient);
  }, [expired, queryClient]);
  return query;
}
