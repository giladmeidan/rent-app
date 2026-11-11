import { useQuery, useQueryClient } from '@tanstack/react-query';

import { hasStatus } from '../applications/api';
import { clearSession } from '../auth/useLogout';
import { fetchThread, type ConversationOut } from './api';
import { useChatStreamConnected } from './streamContext';
import { CONVERSATIONS_KEY } from './useConversations';

/** The prefix of every thread's key (`resync` refetches them all). */
export const THREADS_KEY = ['me', 'conversation'] as const;
export const threadKey = (id: string) => [...THREADS_KEY, id] as const;

/** Not found: 404, or 422 for an id the API cannot parse. */
export const isThreadNotFound = (error: unknown) => hasStatus(error, 404) || hasStatus(error, 422);

/** Polling only while the event stream is down; not found or a hidden tab stops it. */
const FALLBACK_POLL_MS = 15_000;

/**
 * One chat. The GET marks it read on the server, so its item in the chat list is marked read in
 * the cache too (the header count drops at once, without a refetch). No retries: the stream's
 * next event or the fallback poll is the retry. A 401 forgets the session. `id` must be the
 * canonical (lowercase) uuid, the one the event stream names; `enabled = false` sends nothing.
 */
export function useThread(id: string, enabled = true) {
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
        // read; restart it, so its stale count never lands over the one just written. Cancel
        // first: a refetch alone joins a first load (no data yet) instead of restarting it.
        if (queryClient.getQueryState(CONVERSATIONS_KEY)?.fetchStatus === 'fetching') {
          const list = { queryKey: CONVERSATIONS_KEY, exact: true };
          void queryClient.cancelQueries(list).then(() => queryClient.refetchQueries(list));
        }
        return thread;
      } catch (error) {
        if (hasStatus(error, 401)) clearSession(queryClient);
        throw error;
      }
    },
    enabled,
    retry: false,
    refetchInterval: (query) =>
      isThreadNotFound(query.state.error) || connected ? false : FALLBACK_POLL_MS,
  });
}
