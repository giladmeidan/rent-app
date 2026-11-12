import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useConversations } from './useConversations';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * The header's chat link, with an amber pill counting the chats that have something new (unread
 * messages, or never opened). Rendered for a logged-in person only. A pending or failed list shows
 * no pill and never blocks the header. The pill's number is hidden from assistive tech; the
 * sentence after it (a separate text node keeps the space) completes the link's name.
 */
export function ChatNavLink() {
  const { t } = useTranslation();
  const conversations = useConversations();
  const count = (conversations.data ?? []).filter((c) => c.unread_count > 0 || c.is_new).length;

  return (
    <Link
      to="/chat"
      className={`inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full px-[10px] text-[15px] font-semibold text-accent-strong ${focusRing}`}
    >
      {t('header.chat')}
      {count > 0 && (
        <>
          <span
            aria-hidden="true"
            className="min-w-[22px] rounded-full bg-surface-subtle px-[6px] py-[1px] text-center text-[12px] font-bold text-warning"
          >
            {count}
          </span>{' '}
          <span className="sr-only">{t('header.chatNew', { count })}</span>
        </>
      )}
    </Link>
  );
}
