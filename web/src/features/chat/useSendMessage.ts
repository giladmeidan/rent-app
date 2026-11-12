import { useMutation, useQueryClient } from '@tanstack/react-query';

import { clearDraft } from '../../app/drafts';
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
 * then redirects to `/login`). Offline, it fails at once like any network error. A 201 clears the
 * chat's draft (spec 0009g) here, not in the composer, which may have unmounted mid-send.
 */
export function useSendMessage(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => sendMessage(id, body),
    // Never paused while the browser reports offline: the send fails at once (`common.error`, the
    // text kept) instead of hanging and going out later, maybe after the person has left.
    networkMode: 'always',
    onSuccess: (message: MessageOut) => {
      clearDraft('chat', id);
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
