import { useQuery, useQueryClient } from '@tanstack/react-query';

import { hasStatus } from '../applications/api';
import { clearSession } from '../auth/useLogout';
import { fetchConversations } from './api';
import { useChatStreamConnected } from './streamContext';

/** Under `['me', …]`, so logout (`clearSession`) removes it with the other per-user data. */
export const CONVERSATIONS_KEY = ['me', 'conversations'] as const;

/** Polling only while the event stream is down; the stream's events refetch otherwise. */
const FALLBACK_POLL_MS = 60_000;

/**
 * The caller's chats. A 401 (the session ended) forgets the cached person at once, so every
 * per-user query stops and the header falls back to the login links.
 */
export function useConversations(enabled = true) {
  const queryClient = useQueryClient();
  const connected = useChatStreamConnected();
  return useQuery({
    queryKey: CONVERSATIONS_KEY,
    queryFn: async () => {
      try {
        return await fetchConversations();
      } catch (error) {
        if (hasStatus(error, 401)) clearSession(queryClient);
        throw error;
      }
    },
    enabled,
    refetchInterval: connected ? false : FALLBACK_POLL_MS,
  });
}
