import { useQuery, useQueryClient } from '@tanstack/react-query';

import { hasStatus } from '../applications/api';
import { clearSession } from '../auth/useLogout';
import { fetchThread, type ConversationOut } from './api';
import { useChatStreamConnected } from './streamContext';
import { CONVERSATIONS_KEY } from './useConversations';

/** The prefix of every thread's key (`resync` refetches them all). */
export const THREADS_KEY = ['me', 'conversation'] as const;
export const threadKey = (id: string) => [...THREADS_KEY, id] as const;

/** Polling only while the event stream is down; a 404 or a hidden tab stops it. */
const FALLBACK_POLL_MS = 15_000;

/**
 * One chat. The GET marks it read on the server, so its item in the chat list is marked read in
 * the cache too (the header count drops at once, without a refetch). No retries: the stream's
 * next event or the fallback poll is the retry. A 401 forgets the session.
 */
export function useThread(id: string) {
  const queryClient = useQueryClient();
  const connected = useChatStreamConnected();
  return useQuery({
    queryKey: threadKey(id),
    queryFn: async () => {
      try {
        const thread = await fetchThread(id);
        queryClient.setQueryData<ConversationOut[]>(CONVERSATIONS_KEY, (old) =>
          old?.map((c) => (c.id === thread.id ? { ...c, unread_count: 0, is_new: false } : c)),
        );
        // A list request still in flight may have been answered before this GET marked the chat
        // read; restart it, so its stale count never lands over the one just written.
        if (queryClient.getQueryState(CONVERSATIONS_KEY)?.fetchStatus === 'fetching') {
          void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY, exact: true });
        }
        return thread;
      } catch (error) {
        if (hasStatus(error, 401)) clearSession(queryClient);
        throw error;
      }
    },
    retry: false,
    refetchInterval: (query) =>
      hasStatus(query.state.error, 404) || connected ? false : FALLBACK_POLL_MS,
  });
}
