import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';

import { PageContainer } from '../../components/PageContainer';
import { usePageTitle } from '../../app/usePageTitle';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
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
const fieldError = 'text-sm font-semibold text-danger';
const action = `inline-flex min-h-[44px] items-center rounded-full border-[1.5px] border-border-strong bg-surface px-4 text-[15px] font-semibold disabled:opacity-60 ${focusRing}`;

/** Set by the edit wizard's save (`navigate(…, { state: { saved: true } })`). */
function isSaved(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'saved' in state && state.saved === true;
}

function ListingRow({
  listing,
  now,
  today,
  onChanged,
}: {
  listing: MyListingOut;
  now: Date;
  today: string;
  /** A pause or resume succeeded. */
  onChanged: () => void;
}) {
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
                onClick={() => patch.mutate({ status: next }, { onSuccess: onChanged })}
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
                  <span className="rounded-full bg-surface-subtle px-2 py-[2px] text-[12px] font-bold text-warning">
                    {t('applicants.newBadge', { count: listing.new_applicant_count })}
                  </span>
                </>
              )}
            </Link>
            {/* Live rooms only: a paused or expired room has no people page (409). */}
            {listing.listing_type === 'room' && state === 'live' && (
              <Link
                to={`/me/listings/${listing.id}/people`}
                aria-describedby={titleId}
                className={`${action} gap-2`}
              >
                {t('listings.mine.people')}
                {listing.liked_me_count > 0 && (
                  <>
                    {' '}
                    <span className="rounded-full bg-surface-subtle px-2 py-[2px] text-[12px] font-bold text-warning">
                      {t('listings.mine.peopleLiked', { count: listing.liked_me_count })}
                    </span>
                  </>
                )}
              </Link>
            )}
            {/* Every room card (live, paused, expired), after "people" when that is shown. */}
            {listing.listing_type === 'room' && (
              <Link
                to={`/me/listings/${listing.id}/flatmates`}
                aria-describedby={titleId}
                className={action}
              >
                {t('listings.mine.flatmates', { count: listing.flatmate_count })}
              </Link>
            )}
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
  usePageTitle(t('listings.mine.title'));
  const listings = useMyListings();
  const location = useLocation();
  const navigate = useNavigate();
  // "Saved" is read once from the history entry, which is then cleared, so a reload or Back does
  // not show it again (spec 0009t). The status line is always mounted, empty, and its text lands a
  // frame later, so it is announced; a pause or resume clears it.
  const [savedOnArrival] = useState(() => isSaved(location.state));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isSaved(location.state)) {
      void navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location.state, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!savedOnArrival) return;
    const frame = requestAnimationFrame(() => setSaved(true));
    return () => cancelAnimationFrame(frame);
  }, [savedOnArrival]);

  const now = new Date();
  const today = todayInIsrael(now);

  let body;
  if (listings.isPending) {
    body = (
      <Loading>
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} />
          ))}
        </div>
      </Loading>
    );
  } else if (listings.isError) {
    body = <ErrorState onRetry={() => listings.refetch()} />;
  } else if (listings.data.length === 0) {
    body = <EmptyState message={t('listings.mine.empty')} />;
  } else {
    body = (
      <ul className="flex flex-col gap-4">
        {listings.data.map((listing) => (
          <ListingRow
            key={listing.id}
            listing={listing}
            now={now}
            today={today}
            onChanged={() => setSaved(false)}
          />
        ))}
      </ul>
    );
  }

  const live = listings.data?.filter((l) => listingState(l, now) === 'live').length;

  return (
    <PageContainer as="section" width="narrow" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-start text-2xl font-extrabold">{t('listings.mine.title')}</h1>
          <Link
            to="/listings/new"
            className={`inline-flex min-h-[44px] shrink-0 items-center rounded-full bg-accent px-4 text-[15px] font-semibold text-on-ink ${focusRing}`}
          >
            {t('listings.mine.new')}
          </Link>
        </div>
        {live !== undefined && (
          <p className="text-sm text-ink-muted">
            {t('listings.mine.count', { live, cap: LISTING_CAP })}
          </p>
        )}
        {/* Visually hidden while empty (out of the flow, so no gap), never unmounted. */}
        <p role="status" className={saved ? 'text-sm font-semibold text-accent-strong' : 'sr-only'}>
          {saved ? t('listings.edit.saved') : ''}
        </p>
      </div>
      {body}
    </PageContainer>
  );
}
