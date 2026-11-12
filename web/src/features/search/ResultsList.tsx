import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { Mascot } from '../../components/Mascot';
import { Skeleton } from '../../components/Skeleton';
import { todayInIsrael } from '../listings/format';
import { ListingCard } from '../listings/ListingCard';
import { MatchBadge } from '../match/MatchBadge';
import { MatchChips } from '../match/MatchChips';
import type { SeekerProfileOut } from '../profile/api';
import type { ListingSearchOut } from './api';
import { flattenPages } from './useSearch';

type Props = {
  search: UseInfiniteQueryResult<InfiniteData<ListingSearchOut>>;
  /** Whether any filter is set: the empty state then offers to clear them. */
  hasFilters: boolean;
  onClear: () => void;
  /** The seeker's profile, which words the match chips (`undefined`: none, or not loaded). */
  profile: SeekerProfileOut | undefined;
  /** The count line, focused by the page after a filter change (spec 0009t). */
  countRef?: Ref<HTMLParagraphElement>;
};

/** The count line (always mounted, so its first announcement is heard) and the result states. */
export function ResultsList({ search, hasFilters, onClear, profile, countRef }: Props) {
  const { t } = useTranslation();
  const { data } = search;

  let count = '';
  let sortedByMatch = false;
  let body;
  // The first page's states branch on `data`, not `isError`: v5 also sets `isError` when a later
  // page fails, and the loaded cards must stay.
  if (data === undefined) {
    body = search.isPending ? (
      <Loading>
        <div className="flex flex-col gap-3">
          <div aria-hidden="true" className="flex justify-center">
            <Mascot pose="search" width={96} />
          </div>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 w-full lg:h-40" />
          ))}
        </div>
      </Loading>
    ) : (
      <ErrorState onRetry={() => void search.refetch()} />
    );
  } else {
    const total = data.pages[data.pages.length - 1]?.total ?? 0;
    count = t('search.count', { count: total });
    // Not on "0 מודעות": nothing is sorted.
    sortedByMatch = data.pages[0]?.sort === 'match' && total > 0;
    if (total === 0) {
      body = (
        <EmptyState
          pose="search"
          message={t('search.empty')}
          action={
            hasFilters && (
              <Button variant="secondary" onClick={onClear}>
                {t('search.clear')}
              </Button>
            )
          }
        />
      );
    } else {
      const today = todayInIsrael();
      const nextPageFailed = search.isFetchNextPageError && !search.isFetchingNextPage;
      body = (
        <div className="flex flex-col gap-4">
          {/* The grid: each row card at least the artboard's 440px list column. */}
          <ul className="grid gap-3 lg:grid-cols-[repeat(auto-fill,minmax(min(100%,27.5rem),1fr))]">
            {flattenPages(data).map((listing) => (
              <li key={listing.id}>
                <ListingCard
                  listing={listing}
                  today={today}
                  to={`/listings/${listing.id}`}
                  seekerBirthYear={profile?.birth_year}
                  layout="row"
                  badge={listing.match && <MatchBadge score={listing.match.score} />}
                >
                  {listing.match && (
                    <MatchChips match={listing.match} listing={listing} profile={profile} />
                  )}
                </ListingCard>
              </li>
            ))}
          </ul>
          {nextPageFailed ? (
            <ErrorState onRetry={() => void search.fetchNextPage()} />
          ) : (
            search.hasNextPage && (
              <Button
                variant="secondary"
                onClick={() => void search.fetchNextPage()}
                disabled={search.isFetchingNextPage}
                aria-busy={search.isFetchingNextPage}
                className="self-center"
              >
                {t('search.more')}
              </Button>
            )
          )}
        </div>
      );
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p
        ref={countRef}
        tabIndex={-1}
        aria-live="polite"
        className="min-h-6 text-label focus:outline-none lg:text-h3"
      >
        {count}
        {sortedByMatch && <span className="text-ink-muted">{t('search.sortedByMatch')}</span>}
      </p>
      {body}
    </div>
  );
}
