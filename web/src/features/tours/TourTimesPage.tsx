import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { usePageTitle } from '../../app/usePageTitle';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useConfirm } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Field } from '../../components/Field';
import { Loading } from '../../components/Loading';
import { PageContainer } from '../../components/PageContainer';
import { PageHeader } from '../../components/PageHeader';
import { Select } from '../../components/Select';
import { Skeleton } from '../../components/Skeleton';
import { TextInput } from '../../components/TextInput';
import { useOnline } from '../../components/useOnline';
import { hasStatus } from '../applications/api';
import { ApiError } from '../listings/api';
import { cardTitle } from '../listings/cardTitle';
import { addDays, todayInIsrael } from '../listings/format';
import { useMyListings } from '../listings/useMyListings';
import type { TourWindowOut } from './api';
import { tourErrorText } from './errors';
import { formatTourDay, formatTourTime, tourDay } from './format';
import { useCreateTourWindow, useDeleteTourWindow, useTourWindows } from './useTourWindows';

const section = 'flex flex-col gap-5';
const alert = 'text-body-sm font-semibold text-danger';
const SLOT_MINUTES = [15, 20, 30, 45] as const;
type SlotMinutes = (typeof SLOT_MINUTES)[number];

/** The window's slots, in order, each with its booking (if any). */
function slotsOf(window: TourWindowOut) {
  const end = new Date(window.ends_at).getTime();
  const booked = new Map(window.booked.map((b) => [new Date(b.starts_at).getTime(), b]));
  const slots: { startsAt: string; booked: TourWindowOut['booked'][number] | undefined }[] = [];
  for (
    let at = new Date(window.starts_at).getTime();
    at < end;
    at += window.slot_minutes * 60_000
  ) {
    slots.push({ startsAt: new Date(at).toISOString(), booked: booked.get(at) });
  }
  return slots;
}

function WindowCard({
  window,
  focus,
  onFocused,
  onDelete,
  busy,
}: {
  window: TourWindowOut;
  /** The window was just added: its heading takes focus. */
  focus: boolean;
  onFocused: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focus) return;
    headingRef.current?.focus();
    onFocused();
  }, [focus, onFocused]);
  return (
    <Card padding="md" className="flex flex-col gap-3">
      <h3 ref={headingRef} tabIndex={-1} className="text-h3 focus:outline-none">
        <bdi dir="ltr">
          <time dateTime={window.starts_at}>{formatTourTime(window.starts_at)}</time>–
          <time dateTime={window.ends_at}>{formatTourTime(window.ends_at)}</time>
        </bdi>
        {' · '}
        {t('tours.times.slotOption', { count: window.slot_minutes })}
      </h3>
      <ul className="flex flex-col gap-2">
        {slotsOf(window).map(({ startsAt, booked }) => (
          <li key={startsAt} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body">
            <time dateTime={startsAt}>
              <bdi dir="ltr">{formatTourTime(startsAt)}</bdi>
            </time>
            {booked === undefined ? (
              <span className="text-ink-muted">{t('tours.times.free')}</span>
            ) : (
              <>
                <span dir="auto" className="font-semibold">
                  {t('tours.times.booked', {
                    name: booked.seeker_name ?? t('account.deletedName'),
                  })}
                </span>
                <Button variant="ghost" size="sm" to={`/chat/${booked.conversation_id}`}>
                  {t('tours.times.toChat')}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <Button variant="ghost" size="sm" className="self-start" busy={busy} onClick={onDelete}>
        {t('tours.times.delete')}
      </Button>
    </Card>
  );
}

function AddForm({ listingId, onAdded }: { listingId: string; onAdded: (id: string) => void }) {
  const { t } = useTranslation();
  const online = useOnline();
  const create = useCreateTourWindow(listingId);
  const today = todayInIsrael();
  const [date, setDate] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [slot, setSlot] = useState<SlotMinutes>(30);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (date === '' || start === '' || end === '') return;
    if (end <= start) {
      setError(t('tours.times.errors.range'));
      return;
    }
    setError(null);
    create.mutate(
      { date, start, end, slot_minutes: slot },
      {
        onSuccess: (created) => {
          setDate('');
          setStart('');
          setEnd('');
          onAdded(created.id);
        },
        onError: (failure) => {
          const detail = failure instanceof ApiError ? failure.detail : undefined;
          if (detail === 'invalid_window') setError(t('tours.times.errors.invalidWindow'));
          else if (detail === 'window_overlap') setError(t('tours.times.errors.windowOverlap'));
          else if (detail === 'too_many_windows') setError(t('tours.times.errors.tooManyWindows'));
          else if (detail === 'listing_not_live') setError(t('tours.times.notLive'));
          else setError(tourErrorText(t, failure, online));
        },
      },
    );
  }

  return (
    <Card padding="md">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label={t('tours.times.date')}>
          <TextInput
            type="date"
            required
            min={today}
            max={addDays(today, 30)}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('tours.times.start')}>
            <TextInput
              type="time"
              step={300}
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label={t('tours.times.end')}>
            <TextInput
              type="time"
              step={300}
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t('tours.times.slot')}>
          <Select value={slot} onChange={(e) => setSlot(Number(e.target.value) as SlotMinutes)}>
            {SLOT_MINUTES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {t('tours.times.slotOption', { count: minutes })}
              </option>
            ))}
          </Select>
        </Field>
        {error !== null && (
          <p role="alert" className={alert}>
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="self-start" busy={create.isPending}>
          {t('tours.times.add')}
        </Button>
      </form>
    </Card>
  );
}

/** `/me/listings/:id/tours`: the lister's tour times of one listing (apartment or room). */
export function TourTimesPage() {
  const { t } = useTranslation();
  const online = useOnline();
  const { id = '' } = useParams();
  const [confirm, dialog] = useConfirm();
  const listings = useMyListings();
  const listing = listings.data?.find((l) => l.id === id);
  const windows = useTourWindows(id, listing !== undefined);
  const remove = useDeleteTourWindow(id);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const titleId = useId();
  const notFound =
    (listings.data !== undefined && listing === undefined) || hasStatus(windows.error, 404);
  usePageTitle(t(notFound ? 'listings.edit.notFound' : 'tours.times.title'));
  const back =
    listing?.listing_type === 'room'
      ? { to: '/market/mine', label: t('market.mine.back') }
      : { to: '/me/listings', label: t('listings.edit.backToMine') };

  const clearFocus = useCallback(() => setFocusId(null), []);

  async function onDelete(window: TourWindowOut) {
    const ok = await confirm({
      title: t('tours.times.deleteConfirm'),
      confirmLabel: t('tours.times.delete'),
      tone: 'danger',
    });
    if (!ok) return;
    setDeleteError(null);
    remove.mutate(window.id, {
      onError: (failure) =>
        setDeleteError(
          failure instanceof ApiError && failure.detail === 'window_has_tours'
            ? t('tours.times.errors.hasTours')
            : tourErrorText(t, failure, online),
        ),
    });
  }

  if (notFound) {
    return (
      <PageContainer as="section" width="default" className={section}>
        <PageHeader back={back} title={t('listings.edit.notFound')} />
      </PageContainer>
    );
  }

  let body;
  if (listing === undefined || windows.data === undefined) {
    const failed = listings.isError || windows.isError;
    body = failed ? (
      <ErrorState onRetry={() => (listings.isError ? listings.refetch() : windows.refetch())} />
    ) : (
      <Loading>
        <Skeleton />
      </Loading>
    );
  } else {
    const today = todayInIsrael();
    const days = new Map<string, TourWindowOut[]>();
    for (const w of windows.data.windows) {
      const day = tourDay(w.starts_at);
      days.set(day, [...(days.get(day) ?? []), w]);
    }
    body = (
      <>
        {windows.data.listing_live ? (
          <AddForm listingId={listing.id} onAdded={setFocusId} />
        ) : (
          <Card variant="muted" padding="md">
            <p className="text-body text-ink-muted">{t('tours.times.notLive')}</p>
          </Card>
        )}
        {deleteError !== null && (
          <p role="alert" className={alert}>
            {deleteError}
          </p>
        )}
        {windows.data.windows.length === 0 ? (
          <EmptyState pose="sleep" message={t('tours.times.empty')} />
        ) : (
          [...days].map(([day, list]) => (
            <section
              key={day}
              aria-labelledby={`${titleId}-${day}`}
              className="flex flex-col gap-3"
            >
              <h2 id={`${titleId}-${day}`} className="text-h3">
                {formatTourDay(day, today)}
              </h2>
              {list.map((w) => (
                <WindowCard
                  key={w.id}
                  window={w}
                  focus={w.id === focusId}
                  onFocused={clearFocus}
                  busy={remove.isPending && remove.variables === w.id}
                  onDelete={() => void onDelete(w)}
                />
              ))}
            </section>
          ))
        )}
      </>
    );
  }

  return (
    <PageContainer as="section" width="default" className={section}>
      <PageHeader
        back={back}
        title={t('tours.times.title')}
        subtitle={listing === undefined ? undefined : cardTitle(t, listing)}
      />
      {body}
      {dialog}
    </PageContainer>
  );
}
