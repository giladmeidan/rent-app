import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
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
};

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const secondary = `inline-flex min-h-[44px] items-center justify-center rounded-full border-[1.5px] border-[#D6D3D1] bg-white px-5 text-[15px] font-semibold disabled:opacity-60 ${focusRing}`;

/** The count line (always mounted, so its first announcement is heard) and the result states. */
export function ResultsList({ search, hasFilters, onClear, profile }: Props) {
  const { t } = useTranslation();
  const { data } = search;

  let count = '';
  let sortedByMatch = false;
  let body;
  // The first page's states branch on `data`, not `isError`: v5 also sets `isError` when a later
  // page fails, and the loaded cards must stay.
  if (data === undefined) {
    body = search.isPending ? (
      <ul aria-busy="true" aria-label={t('common.loading')} className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <Skeleton />
          </li>
        ))}
      </ul>
    ) : (
      <ErrorState onRetry={() => void search.refetch()} />
    );
  } else {
    const total = data.pages[data.pages.length - 1]?.total ?? 0;
    count = total === 1 ? t('search.countOne') : t('search.count', { count: total });
    // Not on "0 דירות": nothing is sorted.
    sortedByMatch = data.pages[0]?.sort === 'match' && total > 0;
    if (total === 0) {
      body = (
        <div className="flex flex-col items-start gap-3">
          <EmptyState message={t('search.empty')} />
          {hasFilters && (
            <button type="button" onClick={onClear} className={secondary}>
              {t('search.clear')}
            </button>
          )}
        </div>
      );
    } else {
      const today = todayInIsrael();
      const nextPageFailed = search.isFetchNextPageError && !search.isFetchingNextPage;
      body = (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-4">
            {flattenPages(data).map((listing) => (
              <li key={listing.id}>
                <ListingCard
                  listing={listing}
                  today={today}
                  to={`/listings/${listing.id}`}
                  seekerBirthYear={profile?.birth_year}
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
              <button
                type="button"
                onClick={() => void search.fetchNextPage()}
                disabled={search.isFetchingNextPage}
                aria-busy={search.isFetchingNextPage}
                className={`self-center ${secondary}`}
              >
                {t('search.more')}
              </button>
            )
          )}
        </div>
      );
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p aria-live="polite" className="min-h-[1.5em] text-sm font-bold">
        {count}
        {sortedByMatch && (
          <span className="font-normal text-muted">{t('search.sortedByMatch')}</span>
        )}
      </p>
      {body}
    </div>
  );
}
