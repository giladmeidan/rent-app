import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Mascot } from '../../components/Mascot';
import { PageContainer } from '../../components/PageContainer';
import { PageHeader } from '../../components/PageHeader';
import { usePageTitle } from '../../app/usePageTitle';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { Skeleton } from '../../components/Skeleton';
import { ApiError, type MyListingOut } from './api';
import { LISTING_CAP } from './constants';
import { formatDate, todayInIsrael } from './format';
import { ListingCard } from './ListingCard';
import { isPastExpiry, listingState, StatusBadge } from './StatusBadge';
import { useMyListings } from './useMyListings';
import { usePatchListing } from './usePatchListing';

/** Set by the edit wizard's save (`navigate(…, { state: { saved: true } })`). */
function isSaved(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'saved' in state && state.saved === true;
}

/** Set by the wizard's publish (`navigate(…, { state: { published: true } })`). */
function isPublished(state: unknown): boolean {
  return (
    typeof state === 'object' && state !== null && 'published' in state && state.published === true
  );
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
  const past = isPastExpiry(listing, now);

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
        <div className="flex flex-col gap-3 pt-1">
          <p className="text-caption text-ink-muted">
            {t(past ? 'listings.mine.expiredOn' : 'listings.mine.expiresOn', {
              date: formatDate(todayInIsrael(new Date(listing.expires_at))),
            })}
          </p>
          {(next !== null || !past) && (
            <div className="flex flex-wrap gap-2">
              {next !== null && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => patch.mutate({ status: next }, { onSuccess: onChanged })}
                  disabled={patch.isPending}
                  aria-busy={patch.isPending}
                  aria-describedby={titleId}
                >
                  {next === 'paused' ? t('listings.actions.pause') : t('listings.actions.resume')}
                </Button>
              )}
              {!past && (
                <Button
                  variant="ghost"
                  size="sm"
                  to={`/me/listings/${listing.id}/edit`}
                  aria-describedby={titleId}
                >
                  {t('listings.actions.edit')}
                </Button>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {/* Every card, expired ones too: the applicants stay readable. The badge sits inside
                the link, so its accessible name carries both counts. */}
            <Button
              variant="secondary"
              size="sm"
              to={`/me/listings/${listing.id}/applicants`}
              aria-describedby={titleId}
            >
              {t('applicants.link', { count: listing.applicant_count })}
              {listing.new_applicant_count > 0 && (
                <>
                  {' '}
                  <Badge tone="accent">
                    {t('applicants.newBadge', { count: listing.new_applicant_count })}
                  </Badge>
                </>
              )}
            </Button>
            {/* Live rooms only: a paused or expired room has no people page (409). */}
            {listing.listing_type === 'room' && state === 'live' && (
              <Button
                variant="secondary"
                size="sm"
                to={`/me/listings/${listing.id}/people`}
                aria-describedby={titleId}
              >
                {t('listings.mine.people')}
                {listing.liked_me_count > 0 && (
                  <>
                    {' '}
                    <Badge tone="accent">
                      {t('listings.mine.peopleLiked', { count: listing.liked_me_count })}
                    </Badge>
                  </>
                )}
              </Button>
            )}
            {/* Every room card (live, paused, expired), after "people" when that is shown. */}
            {listing.listing_type === 'room' && (
              <Button
                variant="secondary"
                size="sm"
                to={`/me/listings/${listing.id}/flatmates`}
                aria-describedby={titleId}
              >
                {t('listings.mine.flatmates', { count: listing.flatmate_count })}
              </Button>
            )}
          </div>
          {patch.isError && (
            <p role="alert" className="text-label text-danger">
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
  const [publishedOnArrival] = useState(() => isPublished(location.state));
  const [saved, setSaved] = useState(false);
  const [published, setPublished] = useState(false);

  useEffect(() => {
    if (isSaved(location.state) || isPublished(location.state)) {
      void navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location.state, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!savedOnArrival && !publishedOnArrival) return;
    const frame = requestAnimationFrame(() => {
      if (savedOnArrival) setSaved(true);
      if (publishedOnArrival) setPublished(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [savedOnArrival, publishedOnArrival]);

  const now = new Date();
  const today = todayInIsrael(now);

  let body;
  if (listings.isPending) {
    body = (
      <Loading>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <Skeleton />
            </li>
          ))}
        </ul>
      </Loading>
    );
  } else if (listings.isError && listings.data === undefined) {
    body = <ErrorState onRetry={() => listings.refetch()} />;
  } else if (listings.data === undefined || listings.data.length === 0) {
    body = (
      <EmptyState
        message={t('listings.mine.empty')}
        // One turtle per screen: the publish line already has the celebrating one.
        pose={published ? undefined : 'sleep'}
        action={
          <Button variant="secondary" to="/listings/new">
            {t('listings.mine.emptyAction')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
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
    <PageContainer as="section" width="wide" className="flex flex-col gap-4">
      <PageHeader
        title={t('listings.mine.title')}
        subtitle={
          live === undefined ? undefined : t('listings.mine.count', { live, cap: LISTING_CAP })
        }
        actions={
          <Button variant="primary" to="/listings/new">
            {t('listings.mine.new')}
          </Button>
        }
      />
      {/* Visually hidden while empty (out of the flow, so no gap), never unmounted. */}
      <p
        role="status"
        className={
          saved ? 'rounded-md bg-accent-soft px-4 py-3 text-label text-accent-strong' : 'sr-only'
        }
      >
        {saved ? t('listings.edit.saved') : ''}
      </p>
      <div role="status" className={published ? undefined : 'sr-only'}>
        {published && (
          <Card className="flex items-center gap-4">
            <Mascot pose="celebrate" width={96} className="shrink-0" />
            <p className="text-body">{t('listings.mine.published')}</p>
          </Card>
        )}
      </div>
      {body}
    </PageContainer>
  );
}
