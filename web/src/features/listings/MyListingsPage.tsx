import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { ApiError, type MyListingOut } from './api';
import { LISTING_CAP } from './constants';
import { todayInIsrael } from './format';
import { ListingCard } from './ListingCard';
import { isPastExpiry, listingState, StatusBadge } from './StatusBadge';
import { useMyListings } from './useMyListings';
import { usePatchListing } from './usePatchListing';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const fieldError = 'text-sm font-semibold text-[#B91C1C]';
const action = `inline-flex min-h-[44px] items-center rounded-full border-[1.5px] border-[#D6D3D1] bg-white px-4 text-[15px] font-semibold disabled:opacity-60 ${focusRing}`;

function ListingRow({ listing, now, today }: { listing: MyListingOut; now: Date; today: string }) {
  const { t } = useTranslation();
  const patch = usePatchListing(listing.id);
  const state = listingState(listing, now);
  const titleId = useId();

  // Expired listings cannot be paused or resumed (renewal is Slice 10); a listing past its expiry cannot be edited either (0002f).
  const next = state === 'live' ? 'paused' : state === 'paused' ? 'active' : null;
  const capReached = patch.error instanceof ApiError && patch.error.status === 409;

  return (
    <li>
      <ListingCard
        listing={listing}
        today={today}
        badge={<StatusBadge state={state} />}
        titleId={titleId}
      >
        <div className="flex flex-col items-start gap-2 pt-1">
          <div className="flex flex-wrap gap-2">
            {next !== null && (
              <button
                type="button"
                onClick={() => patch.mutate({ status: next })}
                disabled={patch.isPending}
                aria-busy={patch.isPending}
                aria-describedby={titleId}
                className={action}
              >
                {next === 'paused' ? t('listings.actions.pause') : t('listings.actions.resume')}
              </button>
            )}
            {!isPastExpiry(listing, now) && (
              <Link
                to={`/me/listings/${listing.id}/edit`}
                aria-describedby={titleId}
                className={action}
              >
                {t('listings.actions.edit')}
              </Link>
            )}
            {/* Every card, expired ones too: the applicants stay readable. The badge sits inside
                the link, so its accessible name carries both counts. */}
            <Link
              to={`/me/listings/${listing.id}/applicants`}
              aria-describedby={titleId}
              className={`${action} gap-2`}
            >
              {t('applicants.link', { count: listing.applicant_count })}
              {listing.new_applicant_count > 0 && (
                <>
                  {' '}
                  <span className="rounded-full bg-warn px-2 py-[2px] text-[12px] font-bold text-warn-text">
                    {t('applicants.newBadge', { count: listing.new_applicant_count })}
                  </span>
                </>
              )}
            </Link>
          </div>
          {patch.isError && (
            <p role="alert" className={fieldError}>
              {capReached
                ? t('listings.errors.capReached', { cap: LISTING_CAP })
                : t('common.error')}
            </p>
          )}
        </div>
      </ListingCard>
    </li>
  );
}

export function MyListingsPage() {
  const { t } = useTranslation();
  const listings = useMyListings();
  const location = useLocation();
  // Set by the edit wizard's save (`navigate(…, { state: { saved: true } })`).
  const state: unknown = location.state;
  const saved =
    typeof state === 'object' && state !== null && 'saved' in state && state.saved === true;
  const now = new Date();
  const today = todayInIsrael(now);

  let body;
  if (listings.isPending) {
    body = (
      <ul aria-busy="true" aria-label={t('common.loading')} className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <Skeleton />
          </li>
        ))}
      </ul>
    );
  } else if (listings.isError) {
    body = <ErrorState onRetry={() => void listings.refetch()} />;
  } else if (listings.data.length === 0) {
    body = <EmptyState message={t('listings.mine.empty')} />;
  } else {
    body = (
      <ul className="flex flex-col gap-4">
        {listings.data.map((listing) => (
          <ListingRow key={listing.id} listing={listing} now={now} today={today} />
        ))}
      </ul>
    );
  }

  const live = listings.data?.filter((l) => listingState(l, now) === 'live').length;

  return (
    <section className="mx-auto flex w-full max-w-[480px] flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-start text-2xl font-extrabold">{t('listings.mine.title')}</h1>
          <Link
            to="/listings/new"
            className={`inline-flex min-h-[44px] shrink-0 items-center rounded-full bg-accent px-4 text-[15px] font-semibold text-white ${focusRing}`}
          >
            {t('listings.mine.new')}
          </Link>
        </div>
        {live !== undefined && (
          <p className="text-sm text-muted">
            {t('listings.mine.count', { live, cap: LISTING_CAP })}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm font-semibold text-accent-text">
            {t('listings.edit.saved')}
          </p>
        )}
      </div>
      {body}
    </section>
  );
}
