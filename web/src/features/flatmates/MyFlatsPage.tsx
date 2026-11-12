import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { cardTitle } from '../listings/cardTitle';
import { useLeaveFlat, useMyFlats, type MyFlatOut } from './api';
import { formatDay } from './format';

const section = 'mx-auto flex w-full max-w-[480px] flex-col gap-4';
const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const action = `inline-flex min-h-[44px] items-center justify-center self-start rounded-full border-[1.5px] border-border-strong bg-surface px-4 text-[15px] font-semibold disabled:opacity-60 ${focusRing}`;

function FlatRow({ flat }: { flat: MyFlatOut }) {
  const { t } = useTranslation();
  const leave = useLeaveFlat();
  const titleId = useId();
  // Same-tick guard: a double click sends one DELETE.
  const inFlight = useRef(false);

  function onLeave() {
    if (inFlight.current || !window.confirm(t('flatmates.mine.leaveConfirm'))) return;
    inFlight.current = true;
    leave.mutate(flat.listing.id, {
      onSettled: () => {
        inFlight.current = false;
      },
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
      <span id={titleId} dir="auto" className="text-start text-[17px] font-bold">
        {cardTitle(t, flat.listing)}
      </span>
      <span dir="auto" className="text-start text-sm text-ink-muted">
        {t('flatmates.mine.owner', { name: flat.owner_name })}
      </span>
      <span className="text-start text-sm text-ink-muted">
        {t('flatmates.mine.joinedAt', { date: formatDay(flat.joined_at) })}
      </span>
      <button
        type="button"
        onClick={onLeave}
        disabled={leave.isPending}
        aria-busy={leave.isPending}
        aria-describedby={titleId}
        className={action}
      >
        {t('flatmates.mine.leave')}
      </button>
      {leave.isError && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {t('common.error')}
        </p>
      )}
    </li>
  );
}

/** `/me/flats`, for any signed-in user (`RequireUser`): the flats they joined, and a way out. */
export function MyFlatsPage() {
  const { t } = useTranslation();
  const flats = useMyFlats();

  let body;
  if (flats.data === undefined) {
    body = flats.isError ? (
      <ErrorState onRetry={() => void flats.refetch()} />
    ) : (
      <div aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton />
      </div>
    );
  } else if (flats.data.length === 0) {
    body = <EmptyState message={t('flatmates.mine.empty')} />;
  } else {
    body = (
      <ul className="flex flex-col gap-3">
        {flats.data.map((flat) => (
          <FlatRow key={flat.listing.id} flat={flat} />
        ))}
      </ul>
    );
  }

  return (
    <section className={section}>
      <Link
        to="/chat"
        className={`inline-flex min-h-[44px] items-center self-start rounded-full pe-3 text-[15px] font-semibold text-accent-strong ${focusRing}`}
      >
        {t('flatmates.mine.back')}
      </Link>
      <h1 className="text-start text-2xl font-extrabold">{t('flatmates.mine.title')}</h1>
      {body}
    </section>
  );
}
