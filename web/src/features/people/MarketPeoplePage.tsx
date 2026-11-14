import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePageTitle } from '../../app/usePageTitle';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { PageContainer } from '../../components/PageContainer';
import { PageHeader } from '../../components/PageHeader';
import { Skeleton } from '../../components/Skeleton';
import { fetchAreas } from '../areas/api';
import { hasStatus } from '../applications/api';
import { ApiError } from '../listings/api';
import { MutualBanner } from '../likes/MutualBanner';
import { profileHref } from '../profile/links';
import { useProfile } from '../profile/useProfile';
import { MarketPersonCard } from './MarketPersonCard';
import { MarketViewSwitch } from './MarketViewSwitch';
import { flattenCards, useMarketPeople } from './useMarketPeople';

const PATH = '/market/people';
const grid = 'grid grid-cols-1 items-start gap-3 md:grid-cols-2 lg:grid-cols-3';

/**
 * `/market/people`, any account (`RequireUser`): the other people of שוק השותפים, their cards
 * beside the viewer's own answers (no score), with a like toggle (spec 0010i). The like edits the
 * loaded pages in place and never refetches them: the API counts every page against the browse
 * limit. A mutual like is page state, so its banner survives the card leaving the list.
 */
export function MarketPeoplePage() {
  const { t } = useTranslation();
  usePageTitle(t('market.people.title'));
  const people = useMarketPeople();
  const areas = useQuery({ queryKey: ['areas'], queryFn: fetchAreas });
  const viewer = useProfile().data;
  const [mutual, setMutual] = useState<{ conversationId: string } | null>(null);
  // The card a 404 took out of the list: page state, so it outlives the card. A count, so the
  // same message twice takes focus again.
  const [gone, setGone] = useState<number | null>(null);
  const goneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (gone === null) return;
    goneRef.current?.focus();
    goneRef.current?.scrollIntoView({ block: 'center' });
  }, [gone]);

  const items = useMemo(() => (people.data ? flattenCards(people.data) : []), [people.data]);
  const areaName = useMemo(
    () => new Map((areas.data ?? []).map((a) => [a.id, a.name_he])),
    [areas.data],
  );

  // "Load more" keeps focus on the first new card: the button may leave with the last page.
  const listRef = useRef<HTMLUListElement>(null);
  const focusFrom = useRef<number | null>(null);
  const loadingMore = people.isFetchingNextPage;
  useEffect(() => {
    const from = focusFrom.current;
    if (from === null || loadingMore) return;
    if (items.length > from) {
      listRef.current?.children[from]?.querySelector('article')?.focus();
    }
    focusFrom.current = null;
  }, [items.length, loadingMore]);

  let body;
  if (people.data === undefined) {
    if (!people.isError) {
      body = (
        <Loading>
          <div className={grid}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-64 w-full rounded-lg" />
            ))}
          </div>
        </Loading>
      );
    } else if (people.error instanceof ApiError && people.error.status === 403) {
      body = (
        <EmptyState
          pose="sleep"
          message={t('market.people.cardRequired')}
          action={
            <Button variant="primary" to={profileHref(PATH, 'about', 'looking')}>
              {t('market.people.toProfile')}
            </Button>
          }
        />
      );
    } else if (hasStatus(people.error, 429)) {
      // No retry: it would only make more counted calls.
      body = <EmptyState message={t('people.browseRateLimited')} />;
    } else {
      body = <ErrorState onRetry={() => void people.refetch()} />;
    }
  } else {
    const total = people.data.pages[people.data.pages.length - 1]?.total ?? 0;
    body =
      total === 0 && items.length === 0 ? (
        <EmptyState pose="search" message={t('market.people.empty')} />
      ) : (
        <>
          <p className="text-start text-caption text-ink-muted">
            {t('market.people.count', { count: total })}
          </p>
          <ul ref={listRef} className={grid}>
            {items.map((card) => (
              <MarketPersonCard
                key={card.card_id}
                card={card}
                areaNames={card.area_ids.flatMap((areaId) => areaName.get(areaId) ?? [])}
                viewerLifestyle={viewer?.lifestyle ?? {}}
                next={PATH}
                onMutual={(_card, conversationId) => {
                  setGone(null);
                  setMutual({ conversationId });
                }}
                onGone={() => {
                  setMutual(null);
                  setGone((old) => (old ?? 0) + 1);
                }}
              />
            ))}
          </ul>
          {people.isFetchNextPageError && hasStatus(people.error, 429) ? (
            // The browse limit: no retry, a click would only make another counted call.
            <p role="alert" className="text-start text-body-sm font-semibold text-danger">
              {t('people.browseRateLimited')}
            </p>
          ) : (
            people.hasNextPage && (
              <>
                {people.isFetchNextPageError && (
                  <p role="alert" className="text-start text-body-sm font-semibold text-danger">
                    {t('common.error')}
                  </p>
                )}
                <Button
                  variant="secondary"
                  onClick={() => {
                    focusFrom.current = items.length;
                    void people.fetchNextPage();
                  }}
                  disabled={people.isFetchingNextPage}
                  aria-busy={people.isFetchingNextPage}
                  className="self-center"
                >
                  {t('people.loadMore')}
                </Button>
              </>
            )
          )}
        </>
      );
  }

  return (
    <PageContainer as="section" width="wide" className="flex flex-col gap-4">
      <PageHeader title={t('market.people.title')} />
      <MarketViewSwitch current="people" />
      {/* Always in the DOM, so the text change is announced; it takes focus when set. Empty, it is
          `sr-only` (out of the flow). */}
      <div
        ref={goneRef}
        role="alert"
        tabIndex={-1}
        className={
          gone === null
            ? 'sr-only'
            : 'rounded-lg border border-border bg-surface px-4 py-3 text-start text-body font-semibold text-warning focus:outline-none'
        }
      >
        {gone !== null && <span>{t('market.people.gone')}</span>}
      </div>
      {mutual !== null && (
        <MutualBanner key={mutual.conversationId} applicationId={mutual.conversationId} />
      )}
      {body}
    </PageContainer>
  );
}
