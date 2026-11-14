import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { PageContainer } from '../../components/PageContainer';
import { usePageTitle } from '../../app/usePageTitle';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';
import { PageHeader } from '../../components/PageHeader';
import { Skeleton } from '../../components/Skeleton';
import { flattenPages } from '../search/useSearch';
import { DifferIcon } from '../match/icons';
import { fetchAreas } from '../areas/api';
import { hasStatus } from '../applications/api';
import { cardTitle } from '../listings/cardTitle';
import { useMyListings } from '../listings/useMyListings';
import { usePeople } from './usePeople';
import { PersonCard, type PageAlert } from './PersonCard';

const section = 'flex flex-col gap-4';
const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const bannerBase = 'rounded-lg px-4 py-3 text-start text-body font-semibold focus:outline-none';

/**
 * `/me/listings/:id/people`, any account (`RequireUser`, spec 0010b): the people who want a room, for one of
 * the caller's own rooms found in `GET /me/listings` (an id not in it, or an apartment, is "not
 * found" and its people are never requested). A like is an invite (spec 0010l): it flips the
 * card's button, and the person's application answers it in the inbox.
 */
export function PeoplePage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const listings = useMyListings();
  const listing = listings.data?.find((l) => l.id === id);
  const isRoom = listing?.listing_type === 'room';
  const people = usePeople(id, isRoom);
  const areas = useQuery({ queryKey: ['areas'], queryFn: fetchAreas });
  // The two outcomes after which the card leaves the refetched list: page state, so the message
  // survives the refetch that drops the card.
  const [alert, setAlert] = useState<PageAlert | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  // The card (and the focused button) is gone by now: move focus to the message and bring it into
  // view. The region is always in the DOM, so the text change is announced.
  useEffect(() => {
    if (alert === null) return;
    alertRef.current?.focus();
    alertRef.current?.scrollIntoView({ block: 'center' });
  }, [alert]);
  // People are a room's: back to the market's "שלי" (spec 0010a).
  const back = { to: '/market/mine', label: t('market.mine.back') };
  const items = useMemo(() => (people.data ? flattenPages(people.data) : []), [people.data]);

  const areaName = useMemo(
    () => new Map((areas.data ?? []).map((a) => [a.id, a.name_he])),
    [areas.data],
  );
  // The tab is named after the state's <h1> (a `Notice`, or the page title).
  const peopleGone = people.data === undefined && people.isError;
  usePageTitle(
    t(
      (listings.data !== undefined && !isRoom) || (peopleGone && hasStatus(people.error, 404))
        ? 'people.notFound'
        : peopleGone && hasStatus(people.error, 409)
          ? 'people.notLive'
          : 'people.title',
    ),
  );

  // Loading and a failed list keep the page's <h1>: its text needs no data.
  if (listings.data === undefined) {
    return (
      <PageContainer as="section" width="wide" className={section}>
        <PageHeader back={back} title={t('people.title')} />
        {listings.isPending ? (
          <Loading>
            <Skeleton />
          </Loading>
        ) : (
          <ErrorState onRetry={() => listings.refetch()} />
        )}
      </PageContainer>
    );
  }

  const notice = (title: string) => (
    <PageContainer as="section" width="wide" className={section}>
      <PageHeader back={back} title={title} />
    </PageContainer>
  );
  if (listing === undefined || !isRoom) return notice(t('people.notFound'));

  let body;
  if (people.data === undefined) {
    if (people.isError) {
      if (hasStatus(people.error, 404)) return notice(t('people.notFound'));
      if (hasStatus(people.error, 409)) return notice(t('people.notLive'));
      // The browse limit (0010h): a retry would only make more counted calls.
      body = hasStatus(people.error, 429) ? (
        <EmptyState message={t('people.browseRateLimited')} />
      ) : (
        <ErrorState onRetry={() => people.refetch()} />
      );
    } else {
      body = (
        <Loading>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} />
            ))}
          </div>
        </Loading>
      );
    }
  } else {
    // Cards already loaded stay (with their inline alert) even if a refetch now answers 404 / 409.
    const lastTotal = people.data.pages[people.data.pages.length - 1]?.total ?? 0;
    body =
      lastTotal === 0 && items.length === 0 ? (
        <EmptyState pose="search" message={t('people.empty')} />
      ) : (
        <>
          <p className="text-start text-caption text-ink-muted">
            {t('people.count', { count: lastTotal })}
          </p>
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start lg:gap-3">
            {items.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                listing={listing}
                areaNames={person.area_ids.flatMap((areaId) => areaName.get(areaId) ?? [])}
                onAlert={setAlert}
              />
            ))}
          </ul>
          {people.hasNextPage && (
            <Button
              variant="secondary"
              onClick={() => void people.fetchNextPage()}
              disabled={people.isFetchingNextPage}
              aria-busy={people.isFetchingNextPage}
              className="self-center"
            >
              {t('people.loadMore')}
            </Button>
          )}
        </>
      );
  }

  return (
    <PageContainer as="section" width="wide" className={section}>
      <PageHeader back={back} title={t('people.title')} subtitle={cardTitle(t, listing)} />
      <div
        ref={alertRef}
        role="alert"
        tabIndex={-1}
        className={
          alert === null ? 'sr-only' : `border border-border bg-surface text-warning ${bannerBase}`
        }
      >
        {alert !== null && (
          <span className="me-2 inline-flex align-middle">
            <DifferIcon />
          </span>
        )}
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
    </PageContainer>
  );
}
