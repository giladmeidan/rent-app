import { useMutation, useQueryClient } from '@tanstack/react-query';

import { hasStatus } from '../applications/api';
import { clearSession } from '../auth/useLogout';
import { sendMessage, type MessageOut, type ThreadOut } from './api';
import { refreshChat } from './refresh';
import { threadKey } from './useThread';

/**
 * Sends a message to chat `id`. On 201 the message joins the cached thread at once (once: the
 * stream's own refetch may already hold it), then the thread and the list are refetched; a refetch
 * begun before the commit is restarted, so none lands without the message. A 409 `chat_closed` or a
 * 404 means the thread is out of date: it is refetched. A 401 forgets the session (`RequireUser`
 * then redirects to `/login`).
 */
export function useSendMessage(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => sendMessage(id, body),
    onSuccess: (message: MessageOut) => {
      queryClient.setQueryData<ThreadOut>(threadKey(id), (old) =>
        old === undefined || old.messages.some((m) => m.id === message.id)
          ? old
          : { ...old, messages: [...old.messages, message] },
      );
      void refreshChat(queryClient, threadKey(id));
    },
    onError: (error) => {
      if (hasStatus(error, 401)) clearSession(queryClient);
      else if (hasStatus(error, 409) || hasStatus(error, 404)) {
        void queryClient.invalidateQueries({ queryKey: threadKey(id), exact: true });
      }
    },
  });
}
