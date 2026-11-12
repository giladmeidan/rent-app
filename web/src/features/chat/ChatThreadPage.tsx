import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';

import { usePageTitle } from '../../app/usePageTitle';
import { hasStatus } from '../applications/api';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { Skeleton } from '../../components/Skeleton';
import { formatDay } from '../flatmates/format';
import { cardTitle } from '../listings/cardTitle';
import { formatIls } from '../listings/format';
import type { MessageOut, ThreadOut } from './api';
import { Composer } from './Composer';
import { formatMessageTime } from './format';
import { isThreadNotFound, useThread } from './useThread';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

function BackToChats() {
  const { t } = useTranslation();
  return (
    <Link
      to="/chat"
      className={`inline-flex min-h-[44px] items-center gap-1 self-start rounded-full pe-3 text-[15px] font-semibold text-accent-text ${focusRing}`}
    >
      <svg
        aria-hidden="true"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
      {t('chat.thread.back')}
    </Link>
  );
}

function Bubble({ message }: { message: MessageOut }) {
  const { t } = useTranslation();
  const mine = message.mine;
  return (
    <>
      <span className="sr-only">
        {mine ? t('chat.thread.mine') : t('chat.thread.theirs', { name: message.sender_name })}{' '}
      </span>
      <span className="flex flex-wrap items-end gap-x-2 gap-y-1">
        {/* Another person's free text: a text node only, never HTML and never linkified. */}
        <span
          data-testid="message-body"
          dir="auto"
          className="min-w-0 max-w-full whitespace-pre-wrap break-words text-[15px] leading-relaxed"
        >
          {message.body}
        </span>
        <time
          dateTime={message.created_at}
          className={`ms-auto text-[12px] ${mine ? 'text-white' : 'text-muted'}`}
        >
          {formatMessageTime(message.created_at)}
        </time>
      </span>
    </>
  );
}

/** The member line of a group thread: the owner and flatmates with their role, the seeker by name,
 * the caller as "you". */
function MemberLine({ members }: { members: ThreadOut['members'] }) {
  const { t } = useTranslation();
  const parts = members.map((m) => {
    if (m.is_me) return t('chat.you');
    if (m.role === 'seeker') return m.name;
    return t('chat.memberWithRole', { name: m.name, role: t(`chat.roles.${m.role}`) });
  });
  const full = parts.join(' · ');
  return (
    <p
      role="group"
      aria-label={t('chat.members')}
      title={full}
      className="line-clamp-2 text-start text-sm text-muted [overflow-wrap:anywhere]"
    >
      {full}
    </p>
  );
}

/** `id` is the route's: the thread's cache key, which the composer's send updates. */
function Thread({ id, thread }: { id: string; thread: ThreadOut }) {
  const { t } = useTranslation();
  const { listing, messages } = thread;
  const lastRef = useRef<HTMLLIElement>(null);
  const scrolledFirst = useRef(false);
  // The caller's own sent message, scrolled to once it is the last bubble.
  const [sentId, setSentId] = useState<string | null>(null);
  const lastId = messages.at(-1)?.id;
  // The composer had focus (spec 0009t): set on focus inside it, cleared only when focus moves to
  // an element outside it. A click on "send" disables the button while pending, so focus is on
  // <body> already when the chat closes; a ref cleared on every blur would miss that.
  const composerHadFocus = useRef(false);
  const closedRef = useRef<HTMLParagraphElement>(null);
  const couldSend = useRef(thread.can_send);

  // The chat closed under the composer: the closed note replaces it and takes focus.
  useEffect(() => {
    const closed = couldSend.current && !thread.can_send;
    couldSend.current = thread.can_send;
    if (closed && composerHadFocus.current) {
      composerHadFocus.current = false;
      closedRef.current?.focus();
    }
  }, [thread.can_send]);

  const onComposerBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Element && !event.currentTarget.contains(next)) {
      composerHadFocus.current = false;
    }
  };

  // On the first render of messages and after the caller's own send only: a pushed message does
  // not move the page.
  useEffect(() => {
    if (lastId === undefined) return;
    if (!scrolledFirst.current || lastId === sentId) {
      scrolledFirst.current = true;
      lastRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [lastId, sentId]);

  const owner = thread.my_role === 'owner';
  const group = thread.members.length > 2;
  return (
    <>
      <h1 className="text-start text-2xl font-extrabold [overflow-wrap:anywhere]">
        {/* Its own direction: a Latin name in an RTL page stays in order. */}
        <span dir="auto">{thread.other_name}</span>
      </h1>
      {group && <MemberLine members={thread.members} />}
      <p className="flex flex-wrap items-center gap-x-2 text-start text-sm text-muted">
        <span>
          {cardTitle(t, listing)} · {formatIls(listing.price_ils)} {t('listings.units.ils')}
        </span>
        <Link
          to={owner ? `/me/listings/${listing.id}/applicants` : `/listings/${listing.id}`}
          className={`inline-flex min-h-[44px] items-center rounded font-semibold text-accent-text underline underline-offset-4 ${focusRing}`}
        >
          {owner ? t('chat.thread.toApplicants') : t('chat.thread.toListing')}
        </Link>
      </p>
      <p
        role="note"
        className="rounded-2xl bg-warn px-4 py-3 text-start text-[15px] font-semibold leading-relaxed text-warn-text"
      >
        {t('chat.thread.warning')}
      </p>
      {thread.visible_from !== null && (
        <p className="text-start text-sm text-muted">
          {t('chat.joinedNote', { date: formatDay(thread.visible_from) })}
        </p>
      )}
      {thread.truncated && (
        <p className="text-start text-sm text-muted">{t('chat.thread.truncated')}</p>
      )}
      {/* One flex item: the log is mounted even with no messages (so a first pushed message is
          announced, spec 0009t), and an empty log adds no gap. */}
      <div className="flex flex-col">
        {messages.length === 0 && (
          <p className="text-start text-[15px] text-muted">{t('chat.thread.empty')}</p>
        )}
        {/* A polite live region: messages pushed in are announced (keyed by id: only new ones). */}
        <div role="log" aria-label={t('chat.thread.log')}>
          <ol className="flex flex-col gap-2">
            {messages.map((message, i) => {
              const previous = messages[i - 1];
              const showName =
                group &&
                !message.mine &&
                (previous === undefined ||
                  previous.mine ||
                  previous.sender_name !== message.sender_name);
              return (
                <li
                  key={message.id}
                  ref={message.id === lastId ? lastRef : undefined}
                  className={`flex max-w-[85%] flex-col gap-1 ${
                    message.mine ? 'self-end' : 'self-start'
                  }`}
                >
                  {showName && (
                    <span
                      data-testid="sender-name"
                      dir="auto"
                      className="text-start text-sm text-muted"
                    >
                      {message.sender_name}
                    </span>
                  )}
                  <div
                    className={`rounded-2xl px-3 py-2 ${
                      message.mine ? 'bg-accent text-white' : 'border border-line bg-white'
                    }`}
                  >
                    <Bubble message={message} />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      {thread.can_send ? (
        <div
          className="contents"
          onFocus={() => {
            composerHadFocus.current = true;
          }}
          onBlur={onComposerBlur}
        >
          <Composer conversationId={id} onSent={(message) => setSentId(message.id)} />
        </div>
      ) : (
        <p
          ref={closedRef}
          role="status"
          tabIndex={-1}
          className="rounded-2xl border border-line bg-white px-4 py-3 text-start text-[15px] text-muted focus:outline-none"
        >
          {t('chat.thread.closed')}
        </p>
      )}
    </>
  );
}

/** The thread was on screen and is now refused: the person left the flat or was removed. The
 * composer that had focus is gone, so the heading takes it. */
function Removed() {
  const { t } = useTranslation();
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} className="text-start text-2xl font-extrabold focus:outline-none">
      {t('chat.removed')}
    </h1>
  );
}

/** `/chat/:id`, for an owner or a seeker in that chat (`RequireUser`). */
export function ChatThreadPage() {
  const { t } = useTranslation();
  const { id: raw = '' } = useParams();
  // A malformed id is not found without asking the API; a valid one is used in its canonical
  // (lowercase) form, the one the event stream names, so its events reach this cache key.
  const valid = UUID.test(raw);
  const id = raw.toLowerCase();
  const thread = useThread(id, valid);
  // Removed first: a send's 404 then a 404 refetch leaves the old thread cached, and that cached
  // thread then means "no longer in this chat"; with nothing cached a 404 is plain not found.
  const removed = valid && thread.data !== undefined && hasStatus(thread.error, 404);
  const notFound = !removed && (!valid || isThreadNotFound(thread.error));
  // The tab is named after the state's <h1>; while the thread loads, the app alone.
  usePageTitle(
    removed
      ? t('chat.removed')
      : notFound
        ? t('chat.thread.notFound')
        : thread.data !== undefined
          ? thread.data.other_name
          : thread.isError
            ? t('common.error')
            : undefined,
  );

  if (valid && raw !== id) return <Navigate to={`/chat/${id}`} replace />;

  let body;
  if (removed) {
    body = <Removed />;
  } else if (notFound) {
    body = <h1 className="text-start text-2xl font-extrabold">{t('chat.thread.notFound')}</h1>;
  } else if (thread.data === undefined) {
    body = thread.isError ? (
      <ErrorState page onRetry={() => void thread.refetch()} />
    ) : (
      <Loading>
        <Skeleton />
      </Loading>
    );
  } else {
    // A failed background refetch keeps the thread on the page.
    // Keyed: another chat starts with its own scroll state and an empty composer.
    body = <Thread key={id} id={id} thread={thread.data} />;
  }

  return (
    <section className="flex flex-col gap-4">
      <BackToChats />
      {body}
    </section>
  );
}
