import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';

import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { useMe } from '../auth/useMe';
import { formatIls, formatRooms } from '../listings/format';
import type { MessageOut, ThreadOut } from './api';
import { Composer } from './Composer';
import { formatMessageTime } from './format';
import { Loading } from './Loading';
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

function Bubble({ message, otherName }: { message: MessageOut; otherName: string }) {
  const { t } = useTranslation();
  const mine = message.mine;
  return (
    <>
      <span className="sr-only">
        {mine ? t('chat.thread.mine') : t('chat.thread.theirs', { name: otherName })}{' '}
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

/** `id` is the route's: the thread's cache key, which the composer's send updates. */
function Thread({ id, thread }: { id: string; thread: ThreadOut }) {
  const { t } = useTranslation();
  const me = useMe();
  const { listing, messages } = thread;
  const lastRef = useRef<HTMLLIElement>(null);
  const scrolledFirst = useRef(false);
  // The caller's own sent message, scrolled to once it is the last bubble.
  const [sentId, setSentId] = useState<string | null>(null);
  const lastId = messages.at(-1)?.id;

  // On the first render of messages and after the caller's own send only: a pushed message does
  // not move the page.
  useEffect(() => {
    if (lastId === undefined) return;
    if (!scrolledFirst.current || lastId === sentId) {
      scrolledFirst.current = true;
      lastRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [lastId, sentId]);

  const owner = me.data?.role === 'owner';
  return (
    <>
      <h1 className="text-start text-2xl font-extrabold [overflow-wrap:anywhere]">
        {/* Its own direction: a Latin name in an RTL page stays in order. */}
        <span dir="auto">{thread.other_name}</span>
      </h1>
      <p className="flex flex-wrap items-center gap-x-2 text-start text-sm text-muted">
        <span>
          {t('listings.card.title', {
            rooms: formatRooms(listing.rooms),
            street: listing.street,
            city: listing.city,
          })}{' '}
          · {formatIls(listing.price_ils)} {t('listings.units.ils')}
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
      {thread.truncated && (
        <p className="text-start text-sm text-muted">{t('chat.thread.truncated')}</p>
      )}
      {messages.length === 0 ? (
        <p className="text-start text-[15px] text-muted">{t('chat.thread.empty')}</p>
      ) : (
        // A polite live region: messages pushed in are announced (keyed by id: only new ones).
        <div role="log" aria-label={t('chat.thread.log')}>
          <ol className="flex flex-col gap-2">
            {messages.map((message) => (
              <li
                key={message.id}
                ref={message.id === lastId ? lastRef : undefined}
                className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                  message.mine
                    ? 'self-end bg-accent text-white'
                    : 'self-start border border-line bg-white'
                }`}
              >
                <Bubble message={message} otherName={thread.other_name} />
              </li>
            ))}
          </ol>
        </div>
      )}
      {thread.can_send ? (
        <Composer conversationId={id} onSent={(message) => setSentId(message.id)} />
      ) : (
        <p
          role="status"
          className="rounded-2xl border border-line bg-white px-4 py-3 text-start text-[15px] text-muted"
        >
          {t('chat.thread.closed')}
        </p>
      )}
    </>
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

  if (valid && raw !== id) return <Navigate to={`/chat/${id}`} replace />;

  let body;
  // Not found first: a send's 404 then a 404 refetch leaves the old thread cached.
  if (!valid || isThreadNotFound(thread.error)) {
    body = <h1 className="text-start text-2xl font-extrabold">{t('chat.thread.notFound')}</h1>;
  } else if (thread.data === undefined) {
    body = thread.isError ? (
      <ErrorState onRetry={() => void thread.refetch()} />
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
