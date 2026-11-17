import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ClampedText } from '../../components/ClampedText';
import { useConfirm } from '../../components/Dialog';
import { Mascot } from '../../components/Mascot';
import { BackLink, PageHeader } from '../../components/PageHeader';
import { usePageTitle } from '../../app/usePageTitle';
import { clearDraft, readDraft } from '../../app/drafts';
import { DisclosureButton } from '../applicants/DisclosureButton';
import { hasStatus } from '../applications/api';
import { useMe } from '../auth/useMe';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { Skeleton } from '../../components/Skeleton';
import { formatDay } from '../flatmates/format';
import { tourLineText } from '../tours/tourLineText';
import { TourCard } from '../tours/TourCard';
import { cardTitle } from '../listings/cardTitle';
import { formatIls } from '../listings/format';
import { useRemoveMatch } from '../people/useMarketPeople';
import { LISTING_REASONS, PERSON_REASONS } from '../reports/reasons';
import { ReportButton } from '../reports/ReportButton';
import type { MessageOut, ThreadOut } from './api';
import { Composer } from './Composer';
import { formatMessageTime } from './format';
import { CONVERSATIONS_KEY } from './useConversations';
import { isThreadNotFound, useThread } from './useThread';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A system line (the joined and truncated notes), centred as messaging apps mark a date. */
const systemLine =
  'self-center rounded-md bg-surface-subtle px-3 py-1 text-center text-caption text-ink-muted';

/** The back link of every branch: to the list (on a desktop the list is beside it too). */
function useBack() {
  const { t } = useTranslation();
  return { to: '/chat', label: t('chat.thread.back') };
}

/** An outline warning mark (an exclamation), decorative: the note's words carry the meaning. */
function WarningMark() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className="mt-0.5 flex-none text-warning"
    >
      <path d="M12 6v7" />
      <path d="M12 17.5h.01" />
    </svg>
  );
}

function Bubble({ message }: { message: MessageOut }) {
  const { t } = useTranslation();
  const mine = message.mine;
  // null = a deleted account (spec 0013c)
  const sender = message.sender_name ?? t('account.deletedName');
  return (
    <>
      <span className="sr-only">
        {mine ? t('chat.thread.mine') : t('chat.thread.theirs', { name: sender })}{' '}
      </span>
      <span className="flex flex-wrap items-end gap-x-2 gap-y-1">
        {/* Another person's free text: a text node only, never HTML and never linkified. */}
        <span
          data-testid="message-body"
          dir="auto"
          className="min-w-0 max-w-full whitespace-pre-wrap break-words text-body leading-relaxed"
        >
          {message.body}
        </span>
        <time dateTime={message.created_at} className="ms-auto text-caption text-ink-muted">
          {formatMessageTime(message.created_at)}
        </time>
      </span>
    </>
  );
}

/** The member line of a group thread: the owner and flatmates with their role, the seeker by name,
 * the caller as "you". Two lines, with a "show all" toggle when it is longer (FOLLOWUPS 193). */
function MemberLine({ members }: { members: ThreadOut['members'] }) {
  const { t } = useTranslation();
  const id = useId();
  const parts = members.map((m) => {
    if (m.is_me) return t('chat.you');
    const name = m.name ?? t('account.deletedName');
    if (m.role === 'seeker') return name;
    return t('chat.memberWithRole', { name, role: t(`chat.roles.${m.role}`) });
  });
  const full = parts.join(' · ');
  return (
    <ClampedText
      lines={2}
      id={id}
      textProps={{
        role: 'group',
        'aria-label': t('chat.members'),
        className: 'text-caption text-ink-muted [overflow-wrap:anywhere]',
      }}
    >
      {full}
    </ClampedText>
  );
}

/** `id` is the route's: the thread's cache key, which the composer's send updates. `userId`: the
 * signed-in person, whose chat draft this is. */
function Thread({
  id,
  thread,
  userId,
}: {
  id: string;
  thread: ThreadOut;
  userId: string | undefined;
}) {
  const { t } = useTranslation();
  const back = useBack();
  const { messages } = thread;
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
  // "Remove the match" (a direct chat, spec 0010i): set when the person confirms, cleared on a
  // failure. The chat closing under it is theirs: the closed note takes focus, as the composer
  // that held it is gone.
  const removing = useRef(false);
  const [removeFailed, setRemoveFailed] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsId = useId();
  const [confirm, confirmDialog] = useConfirm();
  const removeMatch = useRemoveMatch();
  // A closed chat shows the text its composer held (spec 0009g), read on every render: the draft
  // is written after the mount, until the send's 409. "Discard" hides it until the chat reopens,
  // when the composer restores whatever is still stored.
  const [discarded, setDiscarded] = useState(false);
  if (thread.can_send && discarded) setDiscarded(false);
  const unsent = thread.can_send || discarded ? '' : readDraft('chat', id, userId);

  async function onRemoveMatch() {
    setRemoveFailed(false);
    const ok = await confirm({
      title: t('chat.thread.removeMatchTitle'),
      body: t('chat.thread.removeMatchBody'),
      confirmLabel: t('chat.thread.removeMatchConfirm'),
      tone: 'danger',
    });
    if (!ok) return;
    removing.current = true;
    try {
      await removeMatch.mutateAsync(id);
    } catch {
      removing.current = false;
      setRemoveFailed(true);
    }
  }

  function discard() {
    clearDraft('chat', id);
    setDiscarded(true);
    // The focused button is gone with the text: focus goes to the closed note (spec 0009t's
    // target).
    closedRef.current?.focus();
  }

  // The chat closed under the composer: the closed note replaces it and takes focus, only when
  // focus was lost with the composer (on <body>); focus the person moved elsewhere stays there.
  useEffect(() => {
    const closed = couldSend.current && !thread.can_send;
    couldSend.current = thread.can_send;
    if (closed && removing.current) {
      removing.current = false;
      composerHadFocus.current = false;
      closedRef.current?.focus();
      return;
    }
    if (!closed || !composerHadFocus.current) return;
    composerHadFocus.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) closedRef.current?.focus();
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
  // null = a deleted account (spec 0013c)
  const otherName = thread.other_name ?? t('account.deletedName');
  const reportTitle = t('report.title.person', { name: otherName });
  const reportButton = (
    <ReportButton
      target={{ type: 'chat', id }}
      title={reportTitle}
      ariaLabel={reportTitle}
      reasons={thread.listing ? LISTING_REASONS : PERSON_REASONS}
      hint={group ? t('report.groupHint', { name: otherName }) : undefined}
    />
  );
  return (
    <>
      <PageHeader
        back={back}
        // Its own direction: a Latin name in an RTL page stays in order.
        title={
          <span dir="auto" className="[overflow-wrap:anywhere]">
            {otherName}
          </span>
        }
        subtitle={
          thread.listing
            ? `${cardTitle(t, thread.listing)} · ${formatIls(thread.listing.price_ils)} ${t('listings.units.ils')}`
            : t('chat.thread.direct')
        }
        actions={
          <DisclosureButton
            open={actionsOpen}
            controls={actionsId}
            onToggle={() => setActionsOpen((o) => !o)}
          >
            {t('chat.thread.actions')}
          </DisclosureButton>
        }
      />
      {group && <MemberLine members={thread.members} />}
      <div
        id={actionsId}
        hidden={!actionsOpen}
        className={actionsOpen ? 'flex flex-wrap items-center gap-2' : undefined}
      >
        {thread.listing && (
          <Button
            variant="ghost"
            size="sm"
            to={
              owner
                ? `/me/listings/${thread.listing.id}/applicants`
                : `/listings/${thread.listing.id}`
            }
          >
            {owner ? t('chat.thread.toApplicants') : t('chat.thread.toListing')}
          </Button>
        )}
        {/* A direct chat (spec 0010i): while it can send, "remove the match". */}
        {!thread.listing && thread.can_send && (
          <Button
            variant="ghost"
            size="sm"
            busy={removeMatch.isPending}
            onClick={() => void onRemoveMatch()}
          >
            {t('chat.thread.removeMatch')}
          </Button>
        )}
        {reportButton}
      </div>
      {removeFailed && (
        <p role="alert" className="text-body-sm font-semibold text-danger">
          {t('chat.thread.removeMatchFailed')}
        </p>
      )}
      <TourCard id={id} thread={thread} />
      <p role="note" className={`${systemLine} flex items-start gap-1.5 text-start`}>
        <WarningMark />
        <span>{t('chat.thread.warning')}</span>
      </p>
      {thread.visible_from !== null && (
        <p className={systemLine}>
          {t('chat.joinedNote', { date: formatDay(thread.visible_from) })}
        </p>
      )}
      {thread.truncated && <p className={systemLine}>{t('chat.thread.truncated')}</p>}
      {/* One flex item: the log is mounted even with no messages (so a first pushed message is
          announced, spec 0009t), and an empty log adds no gap. It takes the spare height, so the
          composer sits at the bottom of the screen. */}
      <div className="flex flex-1 flex-col">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Mascot pose="sleep" width={96} />
            <p className="text-body text-ink-muted">{t('chat.thread.empty')}</p>
          </div>
        )}
        {/* A polite live region: messages pushed in are announced (keyed by id: only new ones). */}
        <div role="log" aria-label={t('chat.thread.log')}>
          <ol className="flex flex-col gap-2">
            {messages.map((message, i) => {
              const previous = messages[i - 1];
              if (message.tour !== null) {
                // A tour line: centred, no bubble and no sender name.
                return (
                  <li
                    key={message.id}
                    ref={message.id === lastId ? lastRef : undefined}
                    data-testid="tour-line"
                    className={`lg:scroll-mb-56 ${systemLine}`}
                  >
                    {tourLineText(t, message.tour, message.mine ? undefined : message.sender_name)}
                  </li>
                );
              }
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
                  // At lg the scroll-to-last leaves room for the sticky composer below it.
                  className={`flex max-w-[85%] flex-col gap-1 lg:max-w-xl lg:scroll-mb-56 ${
                    message.mine ? 'self-end' : 'self-start'
                  }`}
                >
                  {showName && (
                    <span
                      data-testid="sender-name"
                      dir="auto"
                      className="text-caption font-semibold text-ink-muted"
                    >
                      {message.sender_name ?? t('account.deletedName')}
                    </span>
                  )}
                  {/* The small corner is the tail, at the bottom inline end (mine) or start. Not
                      solid accent: one accent fill per screen, and a thread repeats it. */}
                  <div
                    className={
                      message.mine
                        ? 'rounded-lg rounded-ee-sm bg-accent-soft px-3.5 py-2 text-ink'
                        : 'rounded-lg rounded-es-sm border border-border bg-surface px-3.5 py-2'
                    }
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
          <Composer
            conversationId={id}
            userId={userId}
            onSent={(message) => setSentId(message.id)}
            viewing={thread.listing != null}
          />
        </div>
      ) : (
        <>
          <Card variant="muted" padding="md">
            <p
              ref={closedRef}
              role="status"
              tabIndex={-1}
              className="text-body text-ink-muted focus:outline-none"
            >
              {thread.other_name === null
                ? t('chat.thread.closedDeleted')
                : thread.listing
                  ? t('chat.thread.closed')
                  : t('chat.thread.closedDirect')}
            </p>
          </Card>
          {unsent !== '' && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-body-sm font-semibold text-ink-muted">{t('chat.thread.unsent')}</p>
              {/* The person's own text: a text node only, read-only. */}
              <p
                data-testid="unsent-draft"
                dir="auto"
                className="w-full whitespace-pre-wrap break-words rounded-md border border-border bg-surface-subtle px-3 py-2 text-body leading-relaxed"
              >
                {unsent}
              </p>
              <Button variant="secondary" shape="pill" onClick={discard}>
                {t('chat.thread.discardDraft')}
              </Button>
            </div>
          )}
        </>
      )}
      {confirmDialog}
    </>
  );
}

/** The thread was on screen and is now refused: the person left the flat or was removed. The
 * composer that had focus is gone, so the heading takes it. */
function Removed({ id }: { id: string }) {
  const { t } = useTranslation();
  const back = useBack();
  const queryClient = useQueryClient();
  const ref = useRef<HTMLHeadingElement>(null);
  // Once per mount (StrictMode runs the effect twice).
  const listRefreshed = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    // Nothing more can be sent here: the unsent text goes (spec 0009g).
    clearDraft('chat', id);
  }, [id]);
  // A removal publishes no event, and on a desktop the list beside this never remounts: ask for
  // it again, so the chat leaves it (spec 0009s).
  useEffect(() => {
    if (listRefreshed.current) return;
    listRefreshed.current = true;
    void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY, exact: true });
  }, [queryClient]);
  return <PageHeader back={back} title={t('chat.removed')} titleRef={ref} />;
}

/** `/chat/:id`, for an owner or a seeker in that chat (`RequireUser`). */
export function ChatThreadPage() {
  const { t } = useTranslation();
  const back = useBack();
  const { id: raw = '' } = useParams();
  // A malformed id is not found without asking the API; a valid one is used in its canonical
  // (lowercase) form, the one the event stream names, so its events reach this cache key.
  const valid = UUID.test(raw);
  const id = raw.toLowerCase();
  const thread = useThread(id, valid);
  // `RequireUser` guarantees the person: their id binds the chat draft (spec 0009g).
  const userId = useMe().data?.id;
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
          ? // null = a deleted account (spec 0013c)
            (thread.data.other_name ?? t('account.deletedName'))
          : thread.isError
            ? t('common.error')
            : undefined,
  );

  // A chat that is not found keeps no draft.
  useEffect(() => {
    if (notFound && valid) clearDraft('chat', id);
  }, [notFound, valid, id]);

  if (valid && raw !== id) return <Navigate to={`/chat/${id}`} replace />;

  // `ChatLayout` holds the page column (spec 0009s). The thread, removed and not-found branches
  // open with their header; loading and error have no <h1> of their own, so the back link alone.
  let body;
  if (removed) {
    body = <Removed id={id} />;
  } else if (notFound) {
    body = <PageHeader back={back} title={t('chat.thread.notFound')} />;
  } else if (thread.data === undefined) {
    body = (
      <>
        <BackLink {...back} />
        {thread.isError ? (
          <ErrorState page onRetry={() => thread.refetch()} />
        ) : (
          <Loading>
            <Skeleton />
          </Loading>
        )}
      </>
    );
  } else {
    // A failed background refetch keeps the thread on the page.
    // Keyed: another chat starts with its own scroll state and an empty composer.
    body = <Thread key={id} id={id} thread={thread.data} userId={userId} />;
  }

  // At `lg` the column fills the screen below the header (min-h-16 + its 1px border) and <main>'s
  // pt-6/pb-8; below `lg` the header can wrap to two rows, so no fixed height.
  return (
    <section className="flex flex-col gap-4 lg:min-h-[calc(100dvh-7.5rem-1px)]">{body}</section>
  );
}
