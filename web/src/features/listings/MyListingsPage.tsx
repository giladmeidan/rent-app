import { useEffect, useId, useRef, useState } from 'react';
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
import { ApiError, type ListingType, type MyListingOut } from './api';
import { ClosureDialog, closeReasonLabel } from './ClosureDialog';
import { LISTING_CAP } from './constants';
import { formatDate, todayInIsrael } from './format';
import { ListingCard } from './ListingCard';
import { isPastExpiry, listingState, StatusBadge } from './StatusBadge';
import { useMyListings } from './useMyListings';
import { usePatchListing } from './usePatchListing';

/** Set by the edit wizard's save (`navigate(…, { state: { saved: true, photosFailed } })`). */
function isSaved(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'saved' in state && state.saved === true;
}

/** Set by the wizard's publish (`navigate(…, { state: { published: true, photosFailed } })`). */
function isPublished(state: unknown): boolean {
  return (
    typeof state === 'object' && state !== null && 'published' in state && state.published === true
  );
}

/** How many photos the wizard's publish or save could not upload (spec 0010e); 0 when none. */
function photosFailed(state: unknown): number {
  if (typeof state !== 'object' || state === null || !('photosFailed' in state)) return 0;
  const failed = state.photosFailed;
  return typeof failed === 'number' && Number.isInteger(failed) && failed > 0 ? failed : 0;
}

function ListingRow({
  listing,
  now,
  today,
  onChanged,
  onClosureSaved,
}: {
  listing: MyListingOut;
  now: Date;
  today: string;
  /** A pause or resume succeeded. */
  onChanged: () => void;
  /** The closure answer was stored (0014b). */
  onClosureSaved: () => void;
}) {
  const { t } = useTranslation();
  const patch = usePatchListing(listing.id);
  const state = listingState(listing, now);
  const titleId = useId();
  const past = isPastExpiry(listing, now);
  // The closure question (0014b): apartments only. Each opening mounts a fresh dialog (`key`), so it
  // starts from the stored answer.
  const asksClosure = listing.listing_type === 'apartment';
  const [closure, setClosure] = useState({ open: false, key: 0 });
  const openClosure = () => setClosure((c) => ({ open: true, key: c.key + 1 }));
  const closeClosure = () => setClosure((c) => ({ ...c, open: false }));
  const toggleRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  // Runs after the dialog's own focus return (child effects first): the pause button was disabled
  // while pending, which can drop focus to the page, so the dialog had no opener to return to.
  useEffect(() => {
    if (!closure.open && closure.key > 0 && document.activeElement === document.body) {
      toggleRef.current?.focus();
    }
  }, [closure]);

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
        coverUrl={listing.photos[0]?.small_url}
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
                  ref={toggleRef}
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    patch.mutate(
                      { status: next },
                      {
                        onSuccess: () => {
                          onChanged();
                          if (asksClosure && next === 'paused') openClosure();
                        },
                      },
                    )
                  }
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
          {asksClosure && state !== 'live' && (
            <div className="flex flex-wrap items-center gap-2">
              {listing.close_reason !== null && (
                <p className="text-caption text-ink-muted">
                  {closeReasonLabel(t, listing.close_reason)}
                </p>
              )}
              {/* One button in both states, so focus stays on it after an answer is saved. */}
              <Button variant="ghost" size="sm" onClick={openClosure} aria-describedby={titleId}>
                {listing.close_reason === null
                  ? t('listings.closure.title')
                  : t('listings.closure.change')}
              </Button>
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
      {asksClosure && closure.key > 0 && (
        <ClosureDialog
          key={closure.key}
          listing={listing}
          open={closure.open}
          onClose={closeClosure}
          onSaved={() => {
            closeClosure();
            onClosureSaved();
          }}
        />
      )}
    </li>
  );
}

type Props = {
  /** The side's type (spec 0010a): `/me/listings` shows apartments, the market's "שלי" rooms. */
  type?: ListingType;
  /** A tab panel inside a page that owns the `<h1>`, the container and the tab's title
   * (`MarketMinePage`); the tab labels it, so it has no heading of its own. */
  panel?: boolean;
};

/**
 * The owner's listings of one type. The count line counts the live listings of **both** types:
 * the cap is shared (MARKET-PLAN Q5).
 */
export function MyListingsPage({ type = 'apartment', panel = false }: Props) {
  if (panel) {
    return (
      <div className="flex flex-col gap-4">
        <MyListings type={type} panel />
      </div>
    );
  }
  return <MyListingsRoute type={type} />;
}

/** The page on its own route: its container and the tab's title. */
function MyListingsRoute({ type }: { type: ListingType }) {
  const { t } = useTranslation();
  usePageTitle(t('listings.mine.title'));
  return (
    <PageContainer as="section" width="wide" className="flex flex-col gap-4">
      <MyListings type={type} panel={false} />
    </PageContainer>
  );
}

function MyListings({ type, panel }: { type: ListingType; panel: boolean }) {
  const { t } = useTranslation();
  const listings = useMyListings();
  const room = type === 'room';
  const newPath = `/listings/new?type=${type}`;
  const location = useLocation();
  const navigate = useNavigate();
  // "Saved" is read once from the history entry, which is then cleared, so a reload or Back does
  // not show it again (spec 0009t). The status line is always mounted, empty, and its text lands a
  // frame later, so it is announced; a pause or resume clears it.
  const [savedOnArrival] = useState(() => isSaved(location.state));
  const [publishedOnArrival] = useState(() => isPublished(location.state));
  const [failedOnArrival] = useState(() => photosFailed(location.state));
  // The status line: an edit's "saved" or the closure answer's (0014b).
  const [saved, setSaved] = useState<'saved' | 'closureSaved' | null>(null);
  const [published, setPublished] = useState(false);
  const [failed, setFailed] = useState(0);

  useEffect(() => {
    if (isSaved(location.state) || isPublished(location.state)) {
      void navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location.state, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!savedOnArrival && !publishedOnArrival) return;
    const frame = requestAnimationFrame(() => {
      if (savedOnArrival) setSaved('saved');
      if (publishedOnArrival) setPublished(true);
      setFailed(failedOnArrival);
    });
    return () => cancelAnimationFrame(frame);
  }, [savedOnArrival, publishedOnArrival, failedOnArrival]);

  const now = new Date();
  const today = todayInIsrael(now);
  const shownListings = (listings.data ?? []).filter((l) => l.listing_type === type);

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
  } else if (shownListings.length === 0) {
    body = (
      <EmptyState
        message={room ? t('market.mine.empty') : t('listings.mine.empty')}
        // One turtle per screen: the publish line already has the celebrating one.
        pose={published ? undefined : 'sleep'}
      />
    );
  } else {
    body = (
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shownListings.map((listing) => (
          <ListingRow
            key={listing.id}
            listing={listing}
            now={now}
            today={today}
            onChanged={() => setSaved(null)}
            onClosureSaved={() => setSaved('closureSaved')}
          />
        ))}
      </ul>
    );
  }

  // Both types: the cap is shared.
  const live = listings.data?.filter((l) => listingState(l, now) === 'live').length;

  const count =
    live === undefined ? undefined : t('listings.mine.count', { live, cap: LISTING_CAP });
  // The only "new" action, empty state included: the empty state has no button of its own.
  const newButton = (
    <Button variant="primary" to={newPath}>
      {room ? t('market.mine.newRoom') : t('listings.mine.new')}
    </Button>
  );

  return (
    <>
      {panel ? (
        // In "שלי"'s tab panel the tab names it (spec 0010b): the count and the action, no heading.
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          {count !== undefined && <p className="text-body-sm text-ink-muted">{count}</p>}
          {newButton}
        </div>
      ) : (
        <PageHeader
          title={room ? t('market.mine.tabs.listings') : t('listings.mine.title')}
          subtitle={count}
          actions={newButton}
        />
      )}
      {/* Visually hidden while empty (out of the flow, so no gap), never unmounted. */}
      <p
        role="status"
        className={
          saved !== null
            ? 'rounded-md bg-accent-soft px-4 py-3 text-label text-accent-strong'
            : 'sr-only'
        }
      >
        {saved === 'saved' && t('listings.edit.saved')}
        {saved === 'closureSaved' && t('listings.closure.saved')}
      </p>
      <div role="status" className={published ? undefined : 'sr-only'}>
        {published && (
          <Card className="flex items-center gap-4">
            <Mascot pose="celebrate" width={96} className="shrink-0" />
            <p className="text-body">{t('listings.mine.published')}</p>
          </Card>
        )}
      </div>
      {/* Under the published or saved line: the photos that did not upload (spec 0010e). */}
      {failed > 0 && (
        <p role="alert" className="text-body-sm font-semibold text-danger">
          {t('listings.mine.photosFailed', { count: failed })}
        </p>
      )}
      {body}
    </>
  );
}
