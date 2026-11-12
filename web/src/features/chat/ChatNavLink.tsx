import { useTranslation } from 'react-i18next';

import { NavIcon, NavTab } from '../../components/NavTab';
import { useConversations } from './useConversations';

/**
 * The signed-in navigation's chat tab, with a count of the chats that have something new (unread
 * messages, or never opened). Rendered for a logged-in person only. A pending or failed list shows
 * no count and never blocks the header. The count's number is hidden from assistive tech; the
 * sentence after it (a separate text node keeps the space) completes the tab's name.
 */
export function ChatNavLink() {
  const { t } = useTranslation();
  const conversations = useConversations();
  const count = (conversations.data ?? []).filter((c) => c.unread_count > 0 || c.is_new).length;

  return (
    <NavTab
      to="/chat"
      icon={
        <NavIcon>
          <path d="M21 12a8 8 0 0 1-11.6 7.2L4 21l1.8-5A8 8 0 1 1 21 12z" />
        </NavIcon>
      }
      label={t('header.chat')}
      count={count}
      countLabel={t('header.chatNew', { count })}
    />
  );
}
