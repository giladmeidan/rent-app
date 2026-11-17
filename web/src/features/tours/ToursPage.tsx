import { useQueryClient } from '@tanstack/react-query';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { usePageTitle } from '../../app/usePageTitle';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { cx } from '../../components/cx';
import { useConfirm, type ConfirmFn } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { focusMainIfLost } from '../../components/focus';
import { focusRing } from '../../components/focusRing';
import { Loading } from '../../components/Loading';
import { PageContainer } from '../../components/PageContainer';
import { PageHeader } from '../../components/PageHeader';
import { Skeleton } from '../../components/Skeleton';
import { useOnline } from '../../components/useOnline';
import { hasStatus } from '../applications/api';
import { cardTitle } from '../listings/cardTitle';
import { todayInIsrael } from '../listings/format';
import type { TourAgendaItemOut } from './api';
import { CalendarFeedButton } from './CalendarFeedButton';
import { tourErrorText } from './errors';
import { formatTourDay, formatTourTime, tourDay } from './format';
import { AGENDA_KEY, useAgenda } from './useAgenda';
import { useCancelTour } from './useTourActions';

type Status = 'done' | 'gone' | null;

/** One tour. Cancel: confirm, then 0018a's cancel; the agenda part is in the per-call options. */
function TourRow({
  item,
  confirm,
  onStatus,
}: {
  item: TourAgendaItemOut;
  confirm: ConfirmFn;
  onStatus: (status: Status) => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const queryClient = useQueryClient();
  const cancel = useCancelTour(item.conversation_id);
  const [coverFailed, setCoverFailed] = useState(false);
  const cover = coverFailed ? null : item.listing.cover?.small_url;
  const timeId = useId();
  const titleId = useId();
  // Focus was on this row's button: when the row goes, it falls back to `#main` (spec 0009t).
  const removed = useRef(false);
  useLayoutEffect(
    () => () => {
      if (removed.current) focusMainIfLost();
    },
    [],
  );
  // A started tour answers 409 `tour_not_cancellable`: an in-progress row only has the chat link.
  const cancellable = new Date(item.starts_at) > new Date();
  const gone = cancel.isError && (hasStatus(cancel.error, 404) || hasStatus(cancel.error, 409));

  async function onCancel() {
    const ok = await confirm({
      title: t('tours.cancel.title'),
      body: t('tours.cancel.body', { name: item.other_name }),
      confirmLabel: t('tours.cancel.confirm'),
      cancelLabel: t('tours.cancel.keep'),
      tone: 'danger',
    });
    if (!ok) return;
    onStatus(null);
    cancel.mutate(item.id, {
      onSuccess: async () => {
        // An agenda refetch in flight would put the cancelled row back.
        await queryClient.cancelQueries({ queryKey: AGENDA_KEY });
        removed.current = true;
        queryClient.setQueryData<TourAgendaItemOut[]>(AGENDA_KEY, (old) =>
          old?.filter((tour) => tour.id !== item.id),
        );
        onStatus('done');
      },
      onError: (error) => {
        if (hasStatus(error, 404) || hasStatus(error, 409)) {
          onStatus('gone');
          removed.current = true;
          void queryClient.invalidateQueries({ queryKey: AGENDA_KEY, exact: true });
        }
      },
    });
  }

  return (
    <li>
      <Card padding="none" className="flex flex-row overflow-hidden">
        {cover && (
          // `alt=""`: the title link names the listing. 16:10, as the listing cards.
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setCoverFailed(true)}
            // `order-last`: the end side, the left in RTL. Edge to edge, the card's full height.
            className="order-last w-40 shrink-0 self-stretch bg-surface-subtle object-cover sm:w-56"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
          <p id={timeId} className="text-label font-semibold">
            <bdi dir="ltr">
              {t('tours.row.time', {
                start: formatTourTime(item.starts_at),
                end: formatTourTime(item.ends_at),
              })}
            </bdi>
          </p>
          <p className="text-body [overflow-wrap:anywhere]">
            <Link
              id={titleId}
              to={`/listings/${item.listing.id}`}
              className={cx(
                'inline-flex min-h-tap items-center rounded text-accent underline underline-offset-4',
                focusRing,
              )}
            >
              <span dir="auto">{cardTitle(t, item.listing)}</span>
            </Link>
          </p>
          <p className="text-body-sm text-ink-muted">
            <span dir="auto">{t('tours.row.with', { name: item.other_name })}</span>
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              to={`/chat/${item.conversation_id}`}
              aria-describedby={`${timeId} ${titleId}`}
            >
              {t('tours.row.chat')}
            </Button>
            {cancellable && (
              <Button
                variant="secondary"
                size="sm"
                busy={cancel.isPending}
                aria-describedby={`${timeId} ${titleId}`}
                onClick={() => void onCancel()}
              >
                {t('tours.row.cancel')}
              </Button>
            )}
          </div>
          {cancel.isError && !gone && (
            <p role="alert" className="text-body-sm font-semibold text-danger">
              {tourErrorText(t, cancel.error, online)}
            </p>
          )}
        </div>
      </Card>
    </li>
  );
}

/** A section's rows grouped by Israeli day, in the order received. */
function Section({
  title,
  items,
  today,
  confirm,
  onStatus,
}: {
  title: string;
  items: TourAgendaItemOut[];
  today: string;
  confirm: ConfirmFn;
  onStatus: (status: Status) => void;
}) {
  const days = new Map<string, TourAgendaItemOut[]>();
  for (const item of items) {
    const day = tourDay(item.starts_at);
    days.set(day, [...(days.get(day) ?? []), item]);
  }
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h2">{title}</h2>
      {[...days].map(([day, rows]) => (
        <div key={day} className="flex flex-col gap-2">
          <h3 className="text-h3">{formatTourDay(day, today)}</h3>
          <ul className="flex flex-col gap-2">
            {rows.map((item) => (
              <TourRow key={item.id} item={item} confirm={confirm} onStatus={onStatus} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** `/tours` (spec 0018b): the caller's upcoming tours by Israeli day, as lister and as seeker. */
export function ToursPage() {
  const { t } = useTranslation();
  usePageTitle(t('tours.title'));
  const agenda = useAgenda();
  const [confirm, confirmDialog] = useConfirm();
  const [status, setStatus] = useState<Status>(null);
  const today = todayInIsrael();

  let body;
  if (agenda.isPending) {
    body = (
      <Loading>
        <ul className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <Skeleton />
            </li>
          ))}
        </ul>
      </Loading>
    );
  } else if (agenda.data === undefined) {
    body = <ErrorState onRetry={() => agenda.refetch()} />;
  } else if (agenda.data.length === 0) {
    body = (
      <EmptyState
        message={t('tours.empty.title')}
        action={<p className="text-body-sm text-ink-muted">{t('tours.empty.body')}</p>}
      />
    );
  } else {
    const sections = [
      { role: 'lister', title: t('tours.sections.lister') },
      { role: 'seeker', title: t('tours.sections.seeker') },
    ] as const;
    body = sections.map(({ role, title }) => {
      const items = agenda.data.filter((item) => item.role === role);
      return items.length === 0 ? null : (
        <Section
          key={role}
          title={title}
          items={items}
          today={today}
          confirm={confirm}
          onStatus={setStatus}
        />
      );
    });
  }

  return (
    <PageContainer as="section" className="flex flex-col gap-4">
      <PageHeader title={t('tours.title')} actions={<CalendarFeedButton />} />
      {/* Always mounted, `sr-only` while empty: its text is announced when it lands. */}
      <p
        role="status"
        className={
          status === null
            ? 'sr-only'
            : 'rounded-md bg-accent-soft px-4 py-3 text-label text-accent-strong'
        }
      >
        {status === 'done' && t('tours.cancel.done')}
        {status === 'gone' && t('tours.cancel.gone')}
      </p>
      {body}
      {confirmDialog}
    </PageContainer>
  );
}
