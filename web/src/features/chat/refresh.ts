import type { QueryClient, QueryKey } from '@tanstack/react-query';

import { CONVERSATIONS_KEY } from './useConversations';

/**
 * Refetches the mounted threads under `threads` (one key or the prefix of all), then the chat
 * list. In that order: a thread's GET marks it read, so a list fetched after it carries the right
 * count. The default `cancelRefetch: true` restarts any refetch already running.
 */
export async function refreshChat(queryClient: QueryClient, threads: QueryKey): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: threads });
  await queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY, exact: true });
}
