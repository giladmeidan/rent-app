import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '../../components/PageContainer';
import { usePageTitle } from '../../app/usePageTitle';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useConfirm, type ConfirmFn } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { PageHeader } from '../../components/PageHeader';
import { Skeleton } from '../../components/Skeleton';
import { cardTitle } from '../listings/cardTitle';
import { useLeaveFlat, useMyFlats, type MyFlatOut } from './api';
import { formatDay } from './format';

const section = 'flex flex-col gap-4';

function FlatRow({
  flat,
  confirm,
  onLeft,
}: {
  flat: MyFlatOut;
  /** The page's `useConfirm()`. */
  confirm: ConfirmFn;
  onLeft: () => void;
}) {
  const { t } = useTranslation();
  const leave = useLeaveFlat();
  const titleId = useId();
  // Same-tick guard: a double click sends one DELETE. Re-checked after the confirm's await.
  const inFlight = useRef(false);
  // A row that unmounts after a leave that did not fail was dropped by the leave's refetch: it
  // reports it, so the page can move focus (spec 0009t).
  const leaving = useRef(false);
  const onLeftRef = useRef(onLeft);
  useEffect(() => {
    onLeftRef.current = onLeft;
  });
  useLayoutEffect(
    () => () => {
      if (leaving.current) onLeftRef.current();
    },
    [],
  );

  async function onLeave() {
    if (inFlight.current) return;
    const ok = await confirm({
      title: t('flatmates.mine.leaveConfirm'),
      confirmLabel: t('flatmates.mine.leave'),
      tone: 'danger',
    });
    if (!ok || inFlight.current) return;
    inFlight.current = true;
    leaving.current = true;
    leave.mutate(flat.listing.id, {
      onError: () => {
        leaving.current = false;
      },
      onSettled: () => {
        inFlight.current = false;
      },
    });
  }

  return (
    <Card
      as="li"
      padding="md"
      className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span id={titleId} dir="auto" className="text-h3">
          {cardTitle(t, flat.listing)}
        </span>
        <span dir="auto" className="text-caption text-ink-muted">
          {t('flatmates.mine.owner', { name: flat.owner_name })}
        </span>
        <span className="text-caption text-ink-muted">
          {t('flatmates.mine.joinedAt', { date: formatDay(flat.joined_at) })}
        </span>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void onLeave()}
        disabled={leave.isPending}
        aria-busy={leave.isPending}
        aria-describedby={titleId}
        className="self-start lg:self-center"
      >
        {t('flatmates.mine.leave')}
      </Button>
      {leave.isError && (
        <p role="alert" className="text-body-sm font-semibold text-danger lg:basis-full">
          {t('common.error')}
        </p>
      )}
    </Card>
  );
}

/** `/me/flats`, for any signed-in user (`RequireUser`): the flats they joined, and a way out. */
export function MyFlatsPage() {
  const { t } = useTranslation();
  // One dialog for the page, shared by every row's "leave" (0009qb).
  const [confirm, dialog] = useConfirm();
  const flats = useMyFlats();
  usePageTitle(t('flatmates.mine.title'));
  // After a leave removes its row (and button), focus goes to the page's <h1>.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left > 0) headingRef.current?.focus();
  }, [left]);

  let body;
  if (flats.data === undefined) {
    body = flats.isError ? (
      <ErrorState onRetry={() => void flats.refetch()} />
    ) : (
      <Loading>
        <Skeleton />
      </Loading>
    );
  } else if (flats.data.length === 0) {
    body = <EmptyState pose="sleep" message={t('flatmates.mine.empty')} />;
  } else {
    body = (
      <ul className="flex flex-col gap-3">
        {flats.data.map((flat) => (
          <FlatRow
            key={flat.listing.id}
            flat={flat}
            confirm={confirm}
            onLeft={() => setLeft((n) => n + 1)}
          />
        ))}
      </ul>
    );
  }

  return (
    <PageContainer as="section" width="default" className={section}>
      <PageHeader
        back={{ to: '/chat', label: t('flatmates.mine.back') }}
        title={t('flatmates.mine.title')}
        titleRef={headingRef}
      />
      {body}
      {dialog}
    </PageContainer>
  );
}
