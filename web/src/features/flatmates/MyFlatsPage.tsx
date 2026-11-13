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
import { Switch } from '../../components/Switch';
import { cardTitle } from '../listings/cardTitle';
import { useLeaveFlat, useMyFlats, useSetShown, type MyFlatOut } from './api';
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
  const show = useSetShown(flat.listing.id);
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

  // While the change is saved (until "my flats" has refetched) the switch shows the new value,
  // disabled; after a failure it shows the stored one again (0010f). Local state, set in the same
  // tick as the click: the mutation's own pending state arrives a render later, and the switch
  // would flash back meanwhile.
  const [saving, setSaving] = useState<boolean | null>(null);
  const shown = saving ?? flat.shown;

  function onShow(next: boolean) {
    if (saving !== null) return;
    setSaving(next);
    // A new toggle clears the card's last failure line: the toggle's (not pending: `saving` guards
    // that) and a failed leave's (an errored mutation is settled, so resetting it drops nothing).
    show.reset();
    if (leave.isError) leave.reset();
    show.mutate(next, { onSettled: () => setSaving(null) });
  }

  return (
    <Card
      as="li"
      padding="md"
      className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-1 lg:flex-1">
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
      <div className="rounded-md border border-border lg:basis-full">
        <Switch
          label={t('flatmates.join.show')}
          checked={shown}
          onChange={onShow}
          disabled={saving !== null}
        />
      </div>
      {(leave.isError || show.isError) && (
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
      <ErrorState onRetry={() => flats.refetch()} />
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
