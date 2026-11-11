import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
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

const section = 'mx-auto flex w-full max-w-[480px] flex-col gap-4';
const card = 'flex flex-col gap-3 rounded-2xl border border-line bg-white p-4';
const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const primary = `inline-flex min-h-[48px] items-center justify-center self-start rounded-[14px] bg-accent px-5 text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;
const action = `inline-flex min-h-[44px] items-center justify-center rounded-full border-[1.5px] border-[#D6D3D1] bg-white px-4 text-[15px] font-semibold disabled:opacity-60 ${focusRing}`;
const fieldError = 'text-sm font-semibold text-[#B91C1C]';

function Back() {
  const { t } = useTranslation();
  return (
    <Link
      to="/me/listings"
      className={`inline-flex min-h-[44px] items-center self-start rounded-full pe-3 text-[15px] font-semibold text-accent-text ${focusRing}`}
    >
      {t('flatmates.back')}
    </Link>
  );
}

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
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="sr-only">
        {t('flatmates.invite.linkLabel')}
      </label>
      <div className="flex flex-col gap-2 min-[400px]:flex-row">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          readOnly
          dir="ltr"
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="min-h-[44px] w-full min-w-0 flex-1 rounded-xl border-[1.5px] border-[#D6D3D1] bg-white px-3 text-start text-sm text-ink focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-tint"
        />
        <button type="button" onClick={() => void copy()} className={action}>
          {t('flatmates.invite.copy')}
        </button>
      </div>
      <p role="status" className="text-sm font-semibold text-accent-text">
        {copied ? t('flatmates.invite.copied') : ''}
      </p>
      <p className="rounded-xl bg-warn px-3 py-2 text-start text-sm font-semibold text-warn-text">
        {t('flatmates.invite.onceWarning')}
      </p>
    </div>
  );
}

/** Create, then (rotate | disable). The token lives in this component's state only: after a
 * reload the link is "active" and can be rotated, never shown again (0008d). */
function InviteBlock({
  listingId,
  active,
  onDisabled,
}: {
  listingId: string;
  active: boolean;
  onDisabled: () => void;
}) {
  const { t } = useTranslation();
  const create = useCreateInvite(listingId);
  const disable = useDisableInvite(listingId);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const busy = create.isPending || disable.isPending;
  // Same-tick guard: `busy` is render state, so a fast double click would send two POSTs, and the
  // second would rotate away the link just shown.
  const inFlight = useRef(false);

  function onCreate(confirmText?: string) {
    if (inFlight.current) return;
    if (confirmText !== undefined && !window.confirm(confirmText)) return;
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

  function onDisable() {
    if (inFlight.current || !window.confirm(t('flatmates.invite.disableConfirm'))) return;
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
    <div className={card}>
      {shown && <InviteUrl key={token} url={`${window.location.origin}/flatmates/join#${token}`} />}
      {!shown && !active && (
        <>
          <p className="text-start text-[15px]">{t('flatmates.invite.hint')}</p>
          <button
            type="button"
            onClick={() => onCreate()}
            disabled={busy}
            aria-busy={create.isPending}
            className={primary}
          >
            {t('flatmates.invite.create')}
          </button>
        </>
      )}
      {!shown && active && (
        <p className="text-start text-[15px] font-semibold">{t('flatmates.invite.active')}</p>
      )}
      {(shown || active) && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onCreate(t('flatmates.invite.rotateConfirm'))}
            disabled={busy}
            aria-busy={create.isPending}
            className={action}
          >
            {t('flatmates.invite.rotate')}
          </button>
          <button
            type="button"
            onClick={onDisable}
            disabled={busy}
            aria-busy={disable.isPending}
            className={action}
          >
            {t('flatmates.invite.disable')}
          </button>
        </div>
      )}
      {failed && (
        <p role="alert" className={fieldError}>
          {t('common.error')}
        </p>
      )}
    </div>
  );
}

function FlatmateRow({
  listingId,
  flatmate,
  onRemoved,
}: {
  listingId: string;
  flatmate: FlatmateOut;
  onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const remove = useRemoveFlatmate(listingId);
  const name = flatmate.display_name;
  const nameId = useId();
  // Same-tick guard, as the invite block's.
  const inFlight = useRef(false);

  function onRemove() {
    if (inFlight.current) return;
    if (!window.confirm(t('flatmates.list.removeConfirm', { name }))) return;
    inFlight.current = true;
    remove.mutate(flatmate.id, {
      onSuccess: onRemoved,
      onSettled: () => {
        inFlight.current = false;
      },
    });
  }

  return (
    <li className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span
            id={nameId}
            dir="auto"
            className="min-w-0 break-words text-start text-[17px] font-bold"
          >
            {name}
          </span>
          <span className="text-start text-sm text-muted">
            {t('flatmates.list.joinedAt', { date: formatDay(flatmate.joined_at) })}
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={remove.isPending}
          aria-busy={remove.isPending}
          aria-describedby={nameId}
          className={action}
        >
          {t('flatmates.list.remove')}
        </button>
      </div>
      {remove.isError && (
        <p role="alert" className={fieldError}>
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
  const { id = '' } = useParams();
  const listings = useMyListings();
  const listing = listings.data?.find((l) => l.id === id);
  const isRoom = listing?.listing_type === 'room';
  const flatmates = useFlatmates(id, isRoom);
  const listTitleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // A removal turns the link off (0008d): the invite block remounts and drops a shown link.
  const [removals, setRemovals] = useState(0);

  if (listings.data === undefined) {
    if (listings.isPending) {
      return (
        <section className={section}>
          <div aria-busy="true" aria-label={t('common.loading')}>
            <Skeleton />
          </div>
        </section>
      );
    }
    return (
      <section className={section}>
        <Back />
        <ErrorState onRetry={() => void listings.refetch()} />
      </section>
    );
  }

  if (listing === undefined || !isRoom) {
    return (
      <section className={section}>
        <Back />
        <h1 className="text-start text-2xl font-extrabold">{t('flatmates.notFound')}</h1>
      </section>
    );
  }

  let list;
  if (flatmates.data === undefined) {
    list = flatmates.isError ? (
      <ErrorState onRetry={() => void flatmates.refetch()} />
    ) : (
      <div aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton />
      </div>
    );
  } else if (flatmates.data.length === 0) {
    list = <EmptyState message={t('flatmates.list.empty')} />;
  } else {
    list = (
      <ul aria-labelledby={listTitleId} className={card}>
        {flatmates.data.map((flatmate) => (
          <FlatmateRow
            key={flatmate.id}
            listingId={listing.id}
            flatmate={flatmate}
            onRemoved={() => setRemovals((n) => n + 1)}
          />
        ))}
      </ul>
    );
  }

  return (
    <section className={section}>
      <Back />
      <div className="flex flex-col gap-1">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-start text-2xl font-extrabold focus:outline-none"
        >
          {t('flatmates.title')}
        </h1>
        <p className="text-start font-bold">{cardTitle(t, listing)}</p>
      </div>
      <InviteBlock
        key={removals}
        listingId={listing.id}
        active={listing.flatmate_invite_active}
        onDisabled={() => headingRef.current?.focus()}
      />
      <h2 id={listTitleId} className="text-start text-lg font-bold">
        {t('flatmates.list.title')}
      </h2>
      {list}
    </section>
  );
}
