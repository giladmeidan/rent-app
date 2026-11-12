import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';

import { usePageTitle } from '../../app/usePageTitle';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { Skeleton } from '../../components/Skeleton';
import { useMe } from '../auth/useMe';
import { useMyFlats } from '../flatmates/api';
import { cardTitle } from '../listings/cardTitle';
import type { ConversationOut } from './api';
import { formatMessageTime } from './format';
import { useConversations } from './useConversations';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const pill = 'flex-none rounded-full bg-warn px-2 py-[2px] text-[12px] font-bold text-warn-text';

function ConversationRow({ conversation }: { conversation: ConversationOut }) {
  const { t } = useTranslation();
  const { listing, last_message: last } = conversation;

  let mark = null;
  if (conversation.unread_count > 0) {
    mark = (
      <span className={pill}>
        <span aria-hidden="true">{conversation.unread_count}</span>
        <span className="sr-only">
          {t('chat.list.unread', { count: conversation.unread_count })}
        </span>
      </span>
    );
  } else if (conversation.is_new) {
    mark = <span className={pill}>{t('chat.list.new')}</span>;
  }

  return (
    <li>
      <Link
        to={`/chat/${conversation.id}`}
        className={`flex min-h-[44px] items-start gap-3 rounded-[20px] border border-line bg-white p-4 ${focusRing}`}
      >
        <span
          aria-hidden="true"
          className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-accent-tint text-[17px] font-extrabold text-accent-text"
        >
          {Array.from(conversation.other_name)[0] ?? ''}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span dir="auto" className="min-w-0 truncate text-[17px] font-extrabold">
              {conversation.other_name}
            </span>
            {conversation.my_role === 'flatmate' && (
              <span className="flex-none rounded-full bg-accent-tint px-2 py-[2px] text-[12px] font-semibold text-accent-text">
                {t('chat.flatmateChip')}
              </span>
            )}
            {conversation.member_count > 2 && (
              <span className="flex-none rounded-full bg-[#F5F5F4] px-2 py-[2px] text-[12px] font-semibold text-muted">
                {t('chat.group', { count: conversation.member_count })}
              </span>
            )}
            {mark}
            {!conversation.can_send && (
              <span className="flex-none rounded-full bg-[#F5F5F4] px-2 py-[2px] text-[12px] font-semibold text-muted">
                {t('chat.list.closed')}
              </span>
            )}
          </span>
          <span className="truncate text-[13px] text-muted">{cardTitle(t, listing)}</span>
          {last === null ? (
            <span className="text-[15px] text-muted">{t('chat.list.noMessages')}</span>
          ) : (
            <span className="flex min-w-0 items-baseline gap-2">
              {/* Another person's free text: a text node only, never HTML or a link. */}
              <span
                data-testid="last-message"
                dir="auto"
                className="min-w-0 flex-1 truncate text-[15px]"
              >
                {last.mine ? t('chat.list.you', { body: last.body }) : last.body}
              </span>
              <time dateTime={last.created_at} className="flex-none text-[13px] text-muted">
                {formatMessageTime(last.created_at)}
              </time>
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

/** Set by the join page (`navigate('/chat', { state: { joined: true } })`, 0008e). */
function isJoined(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'joined' in state && state.joined === true;
}

/** `/chat`, for an owner or a seeker (`RequireUser`): their chats, in the API's order. After a
 * join it confirms it; the history entry's state is cleared at once, so the message lasts until
 * the person leaves the page and a reload or Back does not show it again. */
export function ChatListPage() {
  const { t } = useTranslation();
  usePageTitle(t('chat.list.title'));
  const me = useMe();
  const conversations = useConversations();
  const flats = useMyFlats();
  const location = useLocation();
  const navigate = useNavigate();
  const [joined] = useState(() => isJoined(location.state));
  // The line mounts empty and its text lands a frame later, so it is announced (spec 0009t).
  const [joinedText, setJoinedText] = useState(false);
  useEffect(() => {
    if (!joined) return;
    const frame = requestAnimationFrame(() => setJoinedText(true));
    return () => cancelAnimationFrame(frame);
  }, [joined]);

  useEffect(() => {
    if (isJoined(location.state)) {
      void navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location.state, location.pathname, location.search, navigate]);

  let body;
  if (conversations.data === undefined) {
    body = conversations.isError ? (
      <ErrorState onRetry={() => void conversations.refetch()} />
    ) : (
      <Loading>
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} />
          ))}
        </div>
      </Loading>
    );
  } else if (conversations.data.length === 0) {
    body = (
      <EmptyState
        message={me.data?.role === 'owner' ? t('chat.list.emptyOwner') : t('chat.list.emptySeeker')}
      />
    );
  } else {
    // A failed background refetch keeps the list on the page.
    body = (
      <ul className="flex flex-col gap-3">
        {conversations.data.map((conversation) => (
          <ConversationRow key={conversation.id} conversation={conversation} />
        ))}
      </ul>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h1 className="text-start text-2xl font-extrabold">{t('chat.list.title')}</h1>
        {flats.data !== undefined && flats.data.length > 0 && (
          <Link
            to="/me/flats"
            className={`inline-flex min-h-[44px] items-center rounded font-semibold text-accent-text underline underline-offset-4 ${focusRing}`}
          >
            {t('chat.myFlats')}
          </Link>
        )}
      </div>
      {joined && (
        <p role="status" className="text-start text-sm font-semibold text-accent-text">
          {joinedText ? t('flatmates.join.done') : ''}
        </p>
      )}
      {body}
    </section>
  );
}
