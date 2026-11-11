import { createContext, useContext } from 'react';

/** Whether this tab's chat event stream is open (`ChatStreamProvider`); false outside it. */
export const ChatStreamContext = createContext(false);

/** True while the event stream is open: the chat queries then stop their fallback polling. */
export function useChatStreamConnected(): boolean {
  return useContext(ChatStreamContext);
}
