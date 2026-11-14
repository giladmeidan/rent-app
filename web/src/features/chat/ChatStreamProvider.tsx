import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';

import { ME_KEY, useMe } from '../auth/useMe';
import { refreshChat } from './refresh';
import { ChatStreamContext } from './streamContext';
import { THREADS_KEY, threadKey } from './useThread';

export { useChatStreamConnected } from './streamContext';

/** The first wait before reopening a stream the server refused; doubled per refusal. */
const BACKOFF_START_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;

/** The chat id of a `chat` event (`{conversation_id, kind}`), or null when malformed. */
function conversationIdOf(event: Event): string | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== 'string') return null;
  try {
    const data: unknown = JSON.parse(event.data);
    if (typeof data !== 'object' || data === null || !('conversation_id' in data)) return null;
    return typeof data.conversation_id === 'string' ? data.conversation_id : null;
  } catch {
    return null;
  }
}

/**
 * One chat event stream per tab (`GET /me/events`, spec 0005c), open while `/me` holds a person.
 * Its events refetch the chat queries; nothing is replayed, so a reconnect after an error refetches
 * them all. A refused stream (401 / 429 / 503: `EventSource` never retries those) re-checks `/me`
 * (a 401 there logs out) and is reopened after a growing backoff while still logged in.
 */
export function ChatStreamProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useMe();
  // Keyed on the id, so a `/me` refetch never reopens the stream; closed when logged out, when
  // `clearSession` removed the person or when `/me` failed.
  const userId = me.isError ? undefined : me.data?.id;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (userId === undefined) return;
    let source: EventSource | null = null;
    let reopen: ReturnType<typeof setTimeout> | undefined;
    let backoff = BACKOFF_START_MS;
    let hadError = false;

    const refreshAll = () => void refreshChat(queryClient, THREADS_KEY);

    function connect() {
      const es = new EventSource(`${import.meta.env.VITE_API_URL}/me/events`, {
        withCredentials: true,
      });
      source = es;
      es.addEventListener('open', () => {
        setConnected(true);
        // The first open of a page load refetches nothing; one after an error catches up on the
        // events missed while disconnected.
        if (hadError) {
          hadError = false;
          backoff = BACKOFF_START_MS;
          refreshAll();
        }
      });
      es.addEventListener('chat', (event) => {
        const id = conversationIdOf(event);
        if (id === null) refreshAll();
        else void refreshChat(queryClient, threadKey(id));
      });
      es.addEventListener('resync', refreshAll);
      es.addEventListener('error', () => {
        setConnected(false);
        hadError = true;
        // While open, an error leaves CONNECTING and the browser retries by itself (the server's
        // `retry: N`, 2–10 s per stream). CLOSED means the server refused the stream.
        if (es.readyState !== EventSource.CLOSED) return;
        void queryClient.invalidateQueries({ queryKey: ME_KEY, exact: true });
        const wait = backoff;
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
        reopen = setTimeout(() => {
          reopen = undefined;
          connect();
        }, wait);
      });
    }

    connect();
    return () => {
      clearTimeout(reopen);
      source?.close();
      setConnected(false);
    };
  }, [userId, queryClient]);

  return <ChatStreamContext.Provider value={connected}>{children}</ChatStreamContext.Provider>;
}
