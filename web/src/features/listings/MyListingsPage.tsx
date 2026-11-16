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
import { useOnline } from '../../components/useOnline';
import { useMe } from '../auth/useMe';
import type { ListingType, MyListingOut } from './api';
import { ClosureDialog, closeReasonLabel } from './ClosureDialog';
import { formatDate, todayInIsrael } from './format';
import { ListingCard } from './ListingCard';
import { inRenewalWindow, isPastExpiry, listingState, StatusBadge } from './StatusBadge';
import { useMyListings } from './useMyListings';
import { usePatchListing } from './usePatchListing';
import { actionErrorText, useRenewListing } from './useRenewListing';

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

/** Set by the edit page's renewal (`navigate(…, { state: { renewed: expires_at } })`, 0011a). */
function renewedOn(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('renewed' in state)) return null;
  return typeof state.renewed === 'string' ? state.renewed : null;
}

/** How many photos the wizard's publish or save could not upload (spec 0010e); 0 when none. */
function photosFailed(state: unknown): number {
  if (typeof state !== 'object' || state === null || !('photosFailed' in state)) return 0;
  const failed = state.photosFailed;
  return typeof failed === 'number' && Number.isInteger(failed) && failed > 0 ? failed : 0;
}

function ListingRow({
  listing,
  today,
  onChanged,
  onClosureSaved,
  onRenewed,
}: {
  listing: MyListingOut;
  today: string;
  /** A pause or resume succeeded. */
  onChanged: () => void;
  /** The closure answer was stored (0014b). */
  onClosureSaved: () => void;
  /** The listing was renewed (0011a); its new `expires_at`. */
  onRenewed: (expiresAt: string) => void;
}) {
  const { t } = useTranslation();
  const patch = usePatchListing(listing.id);
  const renew = useRenewListing(listing.id);
  const online = useOnline();
  const me = useMe();
  // The row's own clock: a failed pause or renewal re-renders the row alone, and a listing that
  // expired meanwhile must then read expired (0011a).
  const now = new Date();
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
  // After a renewal the renew button is gone (90 days out): focus goes to the pause button, which
  // the merged row now shows.
  const focusToggle = useRef(false);
  useEffect(() => {
    if (focusToggle.current && toggleRef.current !== null) {
      focusToggle.current = false;
      toggleRef.current.focus();
    }
  });

  // A listing past its expiry cannot be paused, resumed (0011a) or edited (0002f): only renewed.
  // A removed one (0012a, `state` 'removed') cannot be resumed, renewed or edited at all.
  const removed = state === 'removed';
  const next = state === 'live' ? 'paused' : state === 'paused' && !past ? 'active' : null;
  const canRenew = !removed && inRenewalWindow(listing, now);
  const canEdit = !removed && !past;
  const failed = patch.isError ? patch.error : renew.isError ? renew.error : null;

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
            {removed
              ? t('listings.mine.removedHint')
              : t(past ? 'listings.mine.expiredOn' : 'listings.mine.expiresOn', {
                  date: formatDate(todayInIsrael(new Date(listing.expires_at))),
                })}
          </p>
          {(next !== null || canRenew || canEdit) && (
            <div className="flex flex-wrap gap-2">
              {next !== null && (
                <Button
                  ref={toggleRef}
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    renew.reset();
                    patch.mutate(
                      { status: next },
                      {
                        onSuccess: () => {
                          onChanged();
                          if (asksClosure && next === 'paused') openClosure();
                        },
                      },
                    );
                  }}
                  disabled={patch.isPending || renew.isPending}
                  aria-busy={patch.isPending}
                  aria-describedby={titleId}
                >
                  {next === 'paused' ? t('listings.actions.pause') : t('listings.actions.resume')}
                </Button>
              )}
              {canRenew && (
                <Button
                  variant="ghost"
                  size="sm"
                  busy={renew.isPending}
                  // One action at a time: each click resets the other mutation, which would drop its result.
                  disabled={patch.isPending}
                  onClick={() => {
                    patch.reset();
                    renew.mutate(undefined, {
                      onSuccess: (updated) => {
                        focusToggle.current = true;
                        onRenewed(updated.expires_at);
                      },
                    });
                  }}
                  aria-describedby={titleId}
                >
                  {t('listings.actions.renew')}
                </Button>
              )}
              {canEdit && (
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
            {/* Live cards of both types: tour times need a live listing. */}
            {state === 'live' && (
              <Button
                variant="secondary"
                size="sm"
                to={`/me/listings/${listing.id}/tours`}
                aria-describedby={titleId}
              >
                {t('listings.mine.tours')}
              </Button>
            )}
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
          {failed !== null && (
            <p role="alert" className="text-label text-danger">
              {actionErrorText(t, failed, online, me.data?.listing_cap)}
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
  const me = useMe();
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
  const [renewedOnArrival] = useState(() => renewedOn(location.state));
  // The status line: an edit's "saved", the closure answer's (0014b) or a renewal's new expiry
  // (0011a).
  const [saved, setSaved] = useState<'saved' | 'closureSaved' | { renewed: string } | null>(null);
  const [published, setPublished] = useState(false);
  const [failed, setFailed] = useState(0);

  useEffect(() => {
    if (isSaved(location.state) || isPublished(location.state) || renewedOn(location.state)) {
      void navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location.state, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!savedOnArrival && !publishedOnArrival && renewedOnArrival === null) return;
    const frame = requestAnimationFrame(() => {
      if (savedOnArrival) setSaved('saved');
      if (renewedOnArrival !== null) setSaved({ renewed: renewedOnArrival });
      if (publishedOnArrival) setPublished(true);
      setFailed(failedOnArrival);
    });
    return () => cancelAnimationFrame(frame);
  }, [savedOnArrival, publishedOnArrival, failedOnArrival, renewedOnArrival]);

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
            today={today}
            onChanged={() => setSaved(null)}
            onClosureSaved={() => setSaved('closureSaved')}
            onRenewed={(expiresAt) => setSaved({ renewed: expiresAt })}
          />
        ))}
      </ul>
    );
  }

  // Both types: the cap is shared.
  const live = listings.data?.filter((l) => listingState(l, now) === 'live').length;

  // No count until `GET /me` gives the account's cap (0012a): never a guessed one.
  const cap = me.data?.listing_cap;
  const count =
    live === undefined || cap === undefined ? undefined : t('listings.mine.count', { live, cap });
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
          actions={
            <>
              <Button variant="secondary" size="sm" to="/tours">
                {t('tours.link')}
              </Button>
              {newButton}
            </>
          }
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
        {typeof saved === 'object' &&
          saved !== null &&
          t('listings.renew.done', {
            date: formatDate(todayInIsrael(new Date(saved.renewed))),
          })}
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
