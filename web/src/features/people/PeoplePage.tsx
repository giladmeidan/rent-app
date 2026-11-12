import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { fetchAreas } from '../areas/api';
import { hasStatus } from '../applications/api';
import { cardTitle } from '../listings/cardTitle';
import { useMyListings } from '../listings/useMyListings';
import { flattenPeople, usePeople } from './usePeople';
import { PersonCard, type Mutual, type PageAlert } from './PersonCard';

const section = 'mx-auto flex w-full max-w-[640px] flex-col gap-4';
const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

function Back() {
  const { t } = useTranslation();
  return (
    <Link
      to="/me/listings"
      className={`inline-flex min-h-[44px] items-center self-start rounded-full pe-3 text-[15px] font-semibold text-accent-text ${focusRing}`}
    >
      {t('people.back')}
    </Link>
  );
}

function Notice({ message }: { message: string }) {
  return (
    <section className={section}>
      <Back />
      <h1 className="text-start text-2xl font-extrabold">{message}</h1>
    </section>
  );
}

/**
 * `/me/listings/:id/people`, owners only (`RequireOwner`): the people who want a room, for one of
 * the caller's own rooms found in `GET /me/listings` (an id not in it, or an apartment, is "not
 * found" and its people are never requested). The last mutual like is page state, so its banner
 * survives the refetch that drops the card.
 */
export function PeoplePage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const listings = useMyListings();
  const listing = listings.data?.find((l) => l.id === id);
  const isRoom = listing?.listing_type === 'room';
  const people = usePeople(id, isRoom);
  const areas = useQuery({ queryKey: ['areas'], queryFn: fetchAreas });
  const [mutual, setMutual] = useState<Mutual | null>(null);
  // The two outcomes after which the card leaves the refetched list: kept here, like `mutual`.
  const [alert, setAlert] = useState<PageAlert | null>(null);
  const mutualRef = useRef<HTMLDivElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  // The card (and the focused button) is gone by now: move focus to the message and bring it into
  // view. The regions are always in the DOM, so the text change is announced.
  useEffect(() => {
    if (mutual === null) return;
    mutualRef.current?.focus();
    mutualRef.current?.scrollIntoView({ block: 'center' });
  }, [mutual]);
  useEffect(() => {
    if (alert === null) return;
    alertRef.current?.focus();
    alertRef.current?.scrollIntoView({ block: 'center' });
  }, [alert]);
  const items = useMemo(() => (people.data ? flattenPeople(people.data) : []), [people.data]);

  const areaName = useMemo(
    () => new Map((areas.data ?? []).map((a) => [a.id, a.name_he])),
    [areas.data],
  );

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

  if (listing === undefined || !isRoom) return <Notice message={t('people.notFound')} />;

  let body;
  if (people.data === undefined) {
    if (people.isError) {
      if (hasStatus(people.error, 404)) return <Notice message={t('people.notFound')} />;
      if (hasStatus(people.error, 409)) return <Notice message={t('people.notLive')} />;
      body = <ErrorState onRetry={() => void people.refetch()} />;
    } else {
      body = (
        <ul aria-busy="true" aria-label={t('common.loading')} className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <Skeleton />
            </li>
          ))}
        </ul>
      );
    }
  } else {
    // Cards already loaded stay (with their inline alert) even if a refetch now answers 404 / 409.
    const lastTotal = people.data.pages[people.data.pages.length - 1]?.total ?? 0;
    body =
      lastTotal === 0 && items.length === 0 ? (
        <EmptyState message={t('people.empty')} />
      ) : (
        <>
          <p className="text-start text-sm text-muted">{t('people.count', { count: lastTotal })}</p>
          <ul className="flex flex-col gap-3">
            {items.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                listing={listing}
                areaNames={person.area_ids.flatMap((areaId) => areaName.get(areaId) ?? [])}
                onMutual={(m) => {
                  setAlert(null);
                  setMutual(m);
                }}
                onAlert={(a) => {
                  setMutual(null);
                  setAlert(a);
                }}
              />
            ))}
          </ul>
          {people.hasNextPage && (
            <button
              type="button"
              onClick={() => void people.fetchNextPage()}
              disabled={people.isFetchingNextPage}
              aria-busy={people.isFetchingNextPage}
              className={`inline-flex min-h-[44px] items-center justify-center self-center rounded-xl border-[1.5px] border-[#D6D3D1] bg-white px-4 text-[15px] font-semibold disabled:opacity-60 ${focusRing}`}
            >
              {t('people.loadMore')}
            </button>
          )}
        </>
      );
  }

  return (
    <section className={section}>
      <Back />
      <div className="flex flex-col gap-1">
        <h1 className="text-start text-2xl font-extrabold">{t('people.title')}</h1>
        <p className="text-start font-bold">{cardTitle(t, listing)}</p>
      </div>
      <div
        ref={mutualRef}
        role="status"
        tabIndex={-1}
        className={
          mutual === null
            ? undefined
            : 'flex flex-wrap items-center gap-3 rounded-2xl bg-accent-tint px-4 py-3 text-start text-[15px] font-semibold text-accent-text focus:outline-none'
        }
      >
        {mutual !== null && (
          <>
            <span>{t('people.mutual', { name: mutual.name })}</span>
            <Link to={`/chat/${mutual.applicationId}`} className={`underline ${focusRing}`}>
              {t('people.toChat')}
            </Link>
          </>
        )}
      </div>
      <div
        ref={alertRef}
        role="alert"
        tabIndex={-1}
        className={
          alert === null
            ? undefined
            : 'rounded-2xl bg-warn px-4 py-3 text-start text-[15px] font-semibold text-warn-text focus:outline-none'
        }
      >
        {alert?.kind === 'alreadyApplied' && (
          <>
            <strong>{alert.name}</strong> <span>{t('people.errors.alreadyApplied')}</span>{' '}
            <Link to={`/me/listings/${listing.id}/applicants`} className={`underline ${focusRing}`}>
              {t('people.errors.toApplicants')}
            </Link>
          </>
        )}
        {alert?.kind === 'gone' && <span>{t('people.errors.gone')}</span>}
      </div>
      {body}
    </section>
  );
}
