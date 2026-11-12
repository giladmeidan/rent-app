import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useMatch } from 'react-router';

import { Card } from '../../components/Card';
import { PageContainer } from '../../components/PageContainer';
import { useIsDesktop } from '../../components/useMediaQuery';
import { ConversationsPane } from './ConversationsPane';
import { useConversations } from './useConversations';

/** Desktop `/chat` with chats: the panel beside the list. No chat opens by itself (the thread's
 * GET marks it read). */
function PickOne() {
  const { t } = useTranslation();
  return (
    <Card
      variant="muted"
      padding="lg"
      className="flex min-h-96 flex-col items-center justify-center gap-3 text-center"
    >
      <svg
        aria-hidden="true"
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-ink-muted"
      >
        <path d="M21 12a8 8 0 0 1-11.6 7.2L4 21l1.8-5A8 8 0 1 1 21 12z" />
      </svg>
      <p className="text-body text-ink-muted">{t('chat.pickOne')}</p>
    </Card>
  );
}

/** Below `lg`: today's two screens, the list page and the thread page, in the page column. */
function PhoneChatLayout() {
  return (
    <PageContainer width="default">
      <Outlet />
    </PageContainer>
  );
}

/**
 * At `lg` and up: the list pane at the inline start, beside the open thread or the "pick a chat"
 * panel. The tree is the same in every state, so the pane (its joined line, its scroll) is never
 * remounted when the chat changes. With no chats yet (loading, error, empty) the list sits alone
 * in the page column.
 */
function DesktopChatLayout() {
  const match = useMatch('/chat/:id');
  const activeId = match?.params.id?.toLowerCase();
  const paneHeadingId = useId();
  // The header's cached query: no new request.
  const conversations = useConversations();
  const twoPane = match !== null || (conversations.data?.length ?? 0) > 0;
  return (
    <PageContainer width="wide">
      <div className={twoPane ? 'flex items-start gap-6' : 'flex justify-center'}>
        <section
          aria-labelledby={paneHeadingId}
          className={
            twoPane
              ? 'sticky top-6 max-h-[calc(100dvh-3rem)] w-96 flex-none overflow-y-auto p-1'
              : 'w-full max-w-page'
          }
        >
          <ConversationsPane
            headingId={paneHeadingId}
            headingLevel={match ? 2 : 1}
            activeId={activeId}
          />
        </section>
        {twoPane && <div className="min-w-0 flex-1">{match ? <Outlet /> : <PickOne />}</div>}
      </div>
    </PageContainer>
  );
}

/**
 * `/chat` and `/chat/:id` (spec 0009s). Only `useIsDesktop()` here: a resize across 1024px swaps
 * the component, never the hook order.
 */
export function ChatLayout() {
  return useIsDesktop() ? <DesktopChatLayout /> : <PhoneChatLayout />;
}
