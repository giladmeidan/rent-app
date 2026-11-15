import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation, useNavigate } from 'react-router';

import { usePageTitle } from '../../app/usePageTitle';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { cx } from '../../components/cx';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { focusRing } from '../../components/focusRing';
import { Loading } from '../../components/Loading';
import { Mascot } from '../../components/Mascot';
import { Skeleton } from '../../components/Skeleton';
import { Tag } from '../../components/Tag';
import { useMyFlats } from '../flatmates/api';
import { cardTitle } from '../listings/cardTitle';
import type { ConversationOut } from './api';
import { formatMessageTime } from './format';
import { useConversations } from './useConversations';

/** One chat: a card holding one link (its accessible name is the whole row). `selected`: the
 * chat open beside the list (desktop). */
function ConversationRow({
  conversation,
  selected,
}: {
  conversation: ConversationOut;
  selected: boolean;
}) {
  const { t } = useTranslation();
  const { listing, last_message: last } = conversation;

  let mark = null;
  if (conversation.unread_count > 0) {
    // Not `solid`: one accent-filled element per screen, and a list repeats it.
    mark = (
      <Badge
        tone="accent"
        srLabel={t('chat.list.unread', { count: conversation.unread_count })}
        className="flex-none"
      >
        {conversation.unread_count}
      </Badge>
    );
  } else if (conversation.is_new) {
    mark = (
      <Badge tone="accent" className="flex-none">
        {t('chat.list.new')}
      </Badge>
    );
  }

  const flatmate = conversation.my_role === 'flatmate';
  const group = conversation.member_count > 2;
  const closed = !conversation.can_send;

  return (
    <Card as="li" padding="none" variant={selected ? 'selected' : 'default'}>
      <NavLink
        to={`/chat/${conversation.id}`}
        className={() => cx('flex min-h-tap items-start gap-3 rounded-lg p-3.5', focusRing)}
      >
        <Avatar
          // null = a deleted account (spec 0013c); 0013f names it with the placeholder
          name={conversation.other_name ?? ''}
          photoUrl={conversation.other_photo_url}
          size="md"
          tone="accent"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span dir="auto" className="min-w-0 flex-1 truncate text-h3 font-medium">
              {conversation.other_name}
            </span>
            {mark}
          </span>
          {(flatmate || group || closed) && (
            <span className="flex flex-wrap gap-1">
              {flatmate && (
                <Tag tone="accent" size="sm">
                  {t('chat.flatmateChip')}
                </Tag>
              )}
              {group && (
                <Tag tone="neutral" size="sm">
                  {t('chat.group', { count: conversation.member_count })}
                </Tag>
              )}
              {closed && (
                <Tag tone="neutral" size="sm">
                  {t('chat.list.closed')}
                </Tag>
              )}
            </span>
          )}
          <span className="truncate text-caption text-ink-muted">
            {listing ? cardTitle(t, listing) : t('chat.list.direct')}
          </span>
          {last === null ? (
            <span className="text-body text-ink-muted">{t('chat.list.noMessages')}</span>
          ) : (
            <span className="flex min-w-0 items-baseline gap-2">
              {/* Another person's free text: a text node only, never HTML or a link. */}
              <span
                data-testid="last-message"
                dir="auto"
                className="min-w-0 flex-1 truncate text-body"
              >
                {last.mine ? t('chat.list.you', { body: last.body }) : last.body}
              </span>
              <time dateTime={last.created_at} className="flex-none text-caption text-ink-muted">
                {formatMessageTime(last.created_at)}
              </time>
            </span>
          )}
        </span>
      </NavLink>
    </Card>
  );
}

/** Set by the join page (`navigate('/chat', { state: { joined: true } })`, 0008e). */
function isJoined(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'joined' in state && state.joined === true;
}

export type ConversationsPaneProps = {
  /** The heading's id (the desktop pane's `section` is labelled by it). */
  headingId: string;
  /** 1 where the list is the page (`/chat`); 2 beside an open thread, whose name is the `<h1>`. */
  headingLevel: 1 | 2;
  /** The chat open beside the list (desktop `/chat/:id`): its row is selected. */
  activeId?: string;
};

/**
 * The caller's chats, in the API's order (spec 0009s): the phone's `/chat` page, and the desktop's
 * list pane at `/chat` and beside `/chat/:id`. After a join it confirms it; the history entry's
 * state is cleared at once, so the message lasts until the person leaves the page and a reload or
 * Back does not show it again.
 */
export function ConversationsPane({ headingId, headingLevel, activeId }: ConversationsPaneProps) {
  const { t } = useTranslation();
  // Beside a thread the thread names the tab (its effect runs after this one).
  usePageTitle(headingLevel === 1 ? t('chat.list.title') : undefined);
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
      <ErrorState onRetry={() => conversations.refetch()} />
    ) : (
      <Loading>
        {/* One row-high skeleton per row. */}
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      </Loading>
    );
  } else if (conversations.data.length === 0) {
    // One line for everyone (spec 0010b: any account lists rooms and applies to them); a flatmate
    // somewhere gets the flat's line, once the flats are in.
    let empty = t('chat.list.empty');
    if (flats.data !== undefined && flats.data.length > 0) empty = t('chat.list.emptyFlatmate');
    // One mascot per screen: the joined line's, while it shows.
    body = <EmptyState message={empty} pose={joined ? undefined : 'sleep'} />;
  } else {
    // A failed background refetch keeps the list on the page.
    body = (
      <ul className="flex flex-col gap-2">
        {conversations.data.map((conversation) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            selected={conversation.id === activeId}
          />
        ))}
      </ul>
    );
  }

  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Heading id={headingId} className="font-display text-h1 lg:text-h2">
          {t('chat.list.title')}
        </Heading>
        {flats.data !== undefined && flats.data.length > 0 && (
          <Button variant="ghost" size="sm" to="/me/flats">
            {t('chat.myFlats')}
          </Button>
        )}
      </div>
      {joined && (
        // Beside an open thread the line stays (the same node), without its mascot: the thread
        // may hold one.
        <div className="flex items-center gap-4">
          {headingLevel === 1 && <Mascot pose="celebrate" width={96} />}
          <p role="status" className="text-body-sm font-medium text-success">
            {joinedText ? t('flatmates.join.done') : ''}
          </p>
        </div>
      )}
      {body}
    </div>
  );
}
