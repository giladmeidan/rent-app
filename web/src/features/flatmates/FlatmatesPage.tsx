import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { PageContainer } from '../../components/PageContainer';
import { usePageTitle } from '../../app/usePageTitle';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useConfirm, type ConfirmFn } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Field } from '../../components/Field';
import { Loading } from '../../components/Loading';
import { PageHeader } from '../../components/PageHeader';
import { Skeleton } from '../../components/Skeleton';
import { TextInput } from '../../components/TextInput';
import { cardTitle } from '../listings/cardTitle';
import { useMyListings } from '../listings/useMyListings';
import {
  useCreateInvite,
  useDisableInvite,
  useFlatmates,
  useRemoveFlatmate,
  type FlatmateOut,
} from './api';
import { formatDay } from './format';

const section = 'flex flex-col gap-5';
const fieldError = 'text-body-sm font-semibold text-danger';

/** The link, shown once after a create or rotate: a read-only LTR input and "copy". Keyed by
 * the token, so a rotate starts with "copied" off. It mounts only after a create or rotate in
 * this tab, and takes the focus then (the button pressed may be gone). */
function InviteUrl({ url }: { url: string }) {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard (an insecure context, a denied permission): select it for a manual copy.
      setCopied(false);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Full width below `lg`, a half-width column at `lg`: side by side only when there is room. */}
      <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
        <Field
          id={inputId}
          label={t('flatmates.invite.linkLabel')}
          labelHidden
          className="min-w-0 sm:flex-1 lg:flex-none"
        >
          {/* `text-start` is on the box; the `<input>` is `dir="ltr"`, so its `start` is the left. */}
          <TextInput
            ref={inputRef}
            type="text"
            readOnly
            dir="ltr"
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            className="text-start"
          />
        </Field>
        <Button variant="secondary" onClick={() => void copy()}>
          {t('flatmates.invite.copy')}
        </Button>
      </div>
      <p role="status" className="text-body-sm font-medium text-success">
        {copied ? t('flatmates.invite.copied') : ''}
      </p>
      <div className="flex items-start gap-2 rounded-md border border-border bg-surface-subtle px-3 py-2 text-body-sm text-ink">
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          className="mt-0.5 shrink-0 text-warning"
        >
          <path d="M12 6v7" />
          <path d="M12 17.5h.01" />
        </svg>
        <p>{t('flatmates.invite.onceWarning')}</p>
      </div>
    </div>
  );
}

/** Create, then (rotate | disable). The token lives in this component's state only: after a
 * reload the link is "active" and can be rotated, never shown again (0008d). */
function InviteBlock({
  listingId,
  active,
  confirm,
  onDisabled,
}: {
  listingId: string;
  active: boolean;
  /** The page's `useConfirm()`: its dialog outlives this block's remount after a removal. */
  confirm: ConfirmFn;
  onDisabled: () => void;
}) {
  const { t } = useTranslation();
  const create = useCreateInvite(listingId);
  const disable = useDisableInvite(listingId);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const busy = create.isPending || disable.isPending;
  // Same-tick guard: `busy` is render state, so a fast double click would send two POSTs, and the
  // second would rotate away the link just shown. Re-checked after the confirm's await.
  const inFlight = useRef(false);

  async function onCreate(rotate = false) {
    if (inFlight.current) return;
    if (rotate) {
      const ok = await confirm({
        title: t('flatmates.invite.rotateConfirm'),
        confirmLabel: t('flatmates.invite.rotate'),
        tone: 'primary',
      });
      if (!ok || inFlight.current) return;
    }
    inFlight.current = true;
    setFailed(false);
    create.mutate(undefined, {
      onSuccess: (result) => setToken(result.token),
      onError: () => setFailed(true),
      onSettled: () => {
        inFlight.current = false;
      },
    });
  }

  async function onDisable() {
    if (inFlight.current) return;
    const ok = await confirm({
      title: t('flatmates.invite.disableConfirm'),
      confirmLabel: t('flatmates.invite.disable'),
      tone: 'danger',
    });
    if (!ok || inFlight.current) return;
    inFlight.current = true;
    setFailed(false);
    disable.mutate(undefined, {
      onSuccess: () => {
        setToken(null);
        onDisabled();
      },
      onError: () => setFailed(true),
      onSettled: () => {
        inFlight.current = false;
      },
    });
  }

  const shown = token !== null;
  return (
    <Card padding="md" className="flex flex-col gap-3">
      {shown && <InviteUrl key={token} url={`${window.location.origin}/flatmates/join#${token}`} />}
      {!shown && !active && (
        <>
          <p className="text-body">{t('flatmates.invite.hint')}</p>
          <Button
            variant="primary"
            size="lg"
            onClick={() => void onCreate()}
            disabled={busy}
            aria-busy={create.isPending}
            className="self-start"
          >
            {t('flatmates.invite.create')}
          </Button>
        </>
      )}
      {!shown && active && (
        <p className="text-body font-semibold">{t('flatmates.invite.active')}</p>
      )}
      {(shown || active) && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void onCreate(true)}
            disabled={busy}
            aria-busy={create.isPending}
          >
            {t('flatmates.invite.rotate')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void onDisable()}
            disabled={busy}
            aria-busy={disable.isPending}
          >
            {t('flatmates.invite.disable')}
          </Button>
        </div>
      )}
      {failed && (
        <p role="alert" className={fieldError}>
          {t('common.error')}
        </p>
      )}
    </Card>
  );
}

function FlatmateRow({
  listingId,
  flatmate,
  confirm,
  onRemoved,
}: {
  listingId: string;
  flatmate: FlatmateOut;
  confirm: ConfirmFn;
  onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const remove = useRemoveFlatmate(listingId);
  const name = flatmate.display_name;
  const nameId = useId();
  // Same-tick guard, as the invite block's.
  const inFlight = useRef(false);

  async function onRemove() {
    if (inFlight.current) return;
    const ok = await confirm({
      title: t('flatmates.list.removeConfirm', { name }),
      confirmLabel: t('flatmates.list.remove'),
      tone: 'danger',
    });
    if (!ok || inFlight.current) return;
    inFlight.current = true;
    remove.mutate(flatmate.id, {
      onSuccess: onRemoved,
      onSettled: () => {
        inFlight.current = false;
      },
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent-soft text-body font-semibold text-accent-strong"
      >
        {Array.from(name)[0] ?? ''}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span id={nameId} dir="auto" className="text-h3 [overflow-wrap:anywhere]">
          {name}
        </span>
        <span className="text-caption text-ink-muted">
          {t('flatmates.list.joinedAt', { date: formatDay(flatmate.joined_at) })}
        </span>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void onRemove()}
        disabled={remove.isPending}
        aria-busy={remove.isPending}
        aria-describedby={nameId}
      >
        {t('flatmates.list.remove')}
      </Button>
      {remove.isError && (
        <p role="alert" className={`basis-full ${fieldError}`}>
          {t('common.error')}
        </p>
      )}
    </li>
  );
}

/**
 * `/me/listings/:id/flatmates`, owners only (`RequireOwner`): the room's invite link and its
 * flatmates. The listing comes from `GET /me/listings` (an id not in it, or an apartment, is "not
 * found" and its flatmates are never requested).
 */
export function FlatmatesPage() {
  const { t } = useTranslation();
  // One dialog for the page: the invite block's and the rows' confirms (0009qb).
  const [confirm, dialog] = useConfirm();
  const { id = '' } = useParams();
  const listings = useMyListings();
  const listing = listings.data?.find((l) => l.id === id);
  const isRoom = listing?.listing_type === 'room';
  const flatmates = useFlatmates(id, isRoom);
  const listTitleId = useId();
  const inviteTitleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // A removal turns the link off (0008d): the invite block remounts and drops a shown link.
  const [removals, setRemovals] = useState(0);
  // A removal takes its row (and button) away: focus goes to the list's heading (spec 0009t).
  const listTitleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (removals > 0) listTitleRef.current?.focus();
  }, [removals]);
  const notFound = listings.data !== undefined && (listing === undefined || !isRoom);
  usePageTitle(t(notFound ? 'flatmates.notFound' : 'flatmates.title'));
  // Flatmates are a room's: back to the market's "שלי" (spec 0010a).
  const back = { to: '/market/mine', label: t('market.mine.back') };

  // Loading and a failed list keep the page's <h1>: its text needs no data.
  if (listings.data === undefined) {
    if (listings.isPending) {
      return (
        <PageContainer as="section" width="default" className={section}>
          <PageHeader title={t('flatmates.title')} />
          <Loading>
            <Skeleton />
          </Loading>
        </PageContainer>
      );
    }
    return (
      <PageContainer as="section" width="default" className={section}>
        <PageHeader back={back} title={t('flatmates.title')} />
        <ErrorState onRetry={() => listings.refetch()} />
      </PageContainer>
    );
  }

  if (listing === undefined || !isRoom) {
    return (
      <PageContainer as="section" width="default" className={section}>
        <PageHeader back={back} title={t('flatmates.notFound')} />
      </PageContainer>
    );
  }

  let list;
  if (flatmates.data === undefined) {
    list = flatmates.isError ? (
      <ErrorState onRetry={() => flatmates.refetch()} />
    ) : (
      <Loading>
        <Skeleton />
      </Loading>
    );
  } else if (flatmates.data.length === 0) {
    list = <EmptyState pose="sleep" message={t('flatmates.list.empty')} />;
  } else {
    list = (
      <Card padding="md">
        <ul aria-labelledby={listTitleId} className="flex flex-col gap-3">
          {flatmates.data.map((flatmate) => (
            <FlatmateRow
              key={flatmate.id}
              listingId={listing.id}
              flatmate={flatmate}
              confirm={confirm}
              onRemoved={() => setRemovals((n) => n + 1)}
            />
          ))}
        </ul>
      </Card>
    );
  }

  return (
    <PageContainer as="section" width="default" className={section}>
      <PageHeader
        back={back}
        title={t('flatmates.title')}
        titleRef={headingRef}
        subtitle={cardTitle(t, listing)}
      />
      {/* Stacked on a phone (the invite first); side by side from `lg`. */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
        <div className="flex min-w-0 flex-col gap-3">
          <h2 id={inviteTitleId} className="text-h3">
            {t('flatmates.invite.title')}
          </h2>
          <InviteBlock
            key={removals}
            listingId={listing.id}
            active={listing.flatmate_invite_active}
            confirm={confirm}
            onDisabled={() => headingRef.current?.focus()}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <h2
            ref={listTitleRef}
            id={listTitleId}
            tabIndex={-1}
            className="text-h3 focus:outline-none"
          >
            {t('flatmates.list.title')}
          </h2>
          {list}
        </div>
      </div>
      {dialog}
    </PageContainer>
  );
}
