import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { BackLink } from '../../components/PageHeader';
import { PageContainer } from '../../components/PageContainer';
import { setSide, useSide } from '../../app/side';
import { usePageTitle } from '../../app/usePageTitle';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { focusRing } from '../../components/focusRing';
import { APPROXIMATE_RADIUS_M } from '../../components/map/config';
import { MapCanvas } from '../../components/map/MapCanvas';
import { Skeleton } from '../../components/Skeleton';
import { useMe } from '../auth/useMe';
import { ApplySection } from '../applications/ApplySection';
import { LikeRoomButton } from '../likes/LikeRoomButton';
import { MutualBanner } from '../likes/MutualBanner';
import { MatchBadge } from '../match/MatchBadge';
import { MatchCard } from '../match/MatchCard';
import { RoomFacts } from '../rooms/RoomFacts';
import { writeMapPosition } from '../search/mapPosition';
import { ApiError } from './api';
import { ApplyBar } from './ApplyBar';
import { cardTitle } from './cardTitle';
import { entryFact, floorFact, sizeFact } from './facts';
import { formatIls, todayInIsrael } from './format';
import { ListingFacts } from './ListingFacts';
import { OwnerPreferences } from './OwnerPreferences';
import { markSeen } from './seen';
import { usePublicListing } from './usePublicListing';

// The main column and the 24 rem action column, from `lg`: no scale step is a fixed 24 rem.
const TWO_COLUMNS = 'lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-x-10';

/** `/listings/:id`, public: Listing.dc.html without the parts later slices own. */
export function ListingPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const listing = usePublicListing(id);
  // "Seen" on this device means this page opened the listing (spec 0009v), not that a pin was pressed.
  const seenId = listing.isSuccess ? listing.data.id : undefined;
  useEffect(() => {
    if (seenId !== undefined) markSeen(seenId);
  }, [seenId]);
  // A room is the market's (spec 0010a): the header's side and bottom bar follow the listing. While
  // it loads, or on an error, the page follows the last side.
  const loadedType = listing.isSuccess ? listing.data.listing_type : undefined;
  useEffect(() => {
    if (loadedType !== undefined) setSide(loadedType === 'room' ? 'market' : 'apartments');
  }, [loadedType]);
  const market = useSide() === 'market';
  const backToMarket = loadedType === undefined ? market : loadedType === 'room';
  // The small map is dropped when it cannot be shown; the address text stays.
  const [mapFailed, setMapFailed] = useState(false);
  // Set by a like that made the pair mutual; it replaces the control and outlives the cache writes.
  const [mutualId, setMutualId] = useState<string | null>(null);
  // The phone's apply bar watches the action column and moves focus to the apply section's <h2>.
  const actionsRef = useRef<HTMLDivElement>(null);
  const applyHeadingRef = useRef<HTMLHeadingElement>(null);
  // The banner is a seeker's: a logout (or another account) never inherits it.
  const isSeeker = useMe().data?.role === 'seeker';
  const error = listing.error;
  // 404: not live or unknown; 422: a malformed id. Neither has anything to retry.
  const notFound = error instanceof ApiError && (error.status === 404 || error.status === 422);
  // The tab is named after the page's <h1>; while loading, the app alone.
  usePageTitle(
    listing.isSuccess
      ? cardTitle(t, listing.data)
      : listing.isError
        ? t(notFound ? 'listing.notFound' : 'common.error')
        : undefined,
  );

  let body;
  if (listing.isPending) {
    body = (
      <Loading>
        <div className={`flex flex-col gap-3 ${TWO_COLUMNS}`}>
          <Skeleton className="-mx-4 h-40 md:-mx-6 lg:col-span-2 lg:mx-0 lg:h-64 lg:rounded-lg" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="hidden h-48 w-full lg:block" />
        </div>
      </Loading>
    );
  } else if (listing.isError) {
    body = notFound ? (
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-start font-display text-h2">{t('listing.notFound')}</h1>
        <Button variant="primary" to={market ? '/market' : '/search'}>
          {market ? t('market.toSearch') : t('listing.toSearch')}
        </Button>
      </div>
    ) : (
      <ErrorState page onRetry={() => listing.refetch()} />
    );
  } else {
    const l = listing.data;
    const facts = [floorFact(l, t), sizeFact(l, t), entryFact(l, todayInIsrael(), t)];
    if (l.entry_flexible) facts.push(t('listings.fields.entryFlexible'));

    body = (
      <article className={`flex flex-col gap-5 lg:gap-y-6 ${TWO_COLUMNS}`}>
        {/* The neutral photo placeholder of the card, edge to edge on a phone (photos are 0002c). */}
        <div className="-mx-4 flex h-40 items-center justify-center bg-surface-subtle md:-mx-6 lg:col-span-2 lg:mx-0 lg:h-64 lg:rounded-lg">
          <svg
            aria-hidden="true"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className="text-ink-muted"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="M21 16l-5-5-8 8" />
          </svg>
        </div>

        <div data-testid="listing-main" className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-h2 font-bold">
                <span>
                  {formatIls(l.price_ils)} {t('listings.units.ils')}
                </span>{' '}
                <span className="text-body-sm font-normal text-ink-muted">
                  {t('listings.units.perMonth')}
                </span>
              </p>
              {l.match !== null && <MatchBadge score={l.match.score} />}
            </div>
            <h1 className="break-words font-display text-h2 lg:text-h1">{cardTitle(t, l)}</h1>
            <p className="flex flex-wrap gap-x-2.5 text-body-sm text-ink-muted">
              {facts.map((fact, i) => (
                <span key={fact} className="flex gap-x-2.5">
                  {i > 0 && <span aria-hidden="true">·</span>}
                  <span>{fact}</span>
                </span>
              ))}
            </p>
          </div>

          <ListingFacts listing={l} />

          {l.listing_type === 'room' && <RoomFacts listing={l} />}

          {l.description !== null && (
            <section className="flex flex-col gap-2">
              <h2 className="text-h3 font-semibold">{t('listings.fields.description')}</h2>
              <p
                data-testid="listing-description"
                className="max-w-prose whitespace-pre-line break-words text-body text-ink"
              >
                {l.description}
              </p>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <h2 className="text-h3 font-semibold">{t('listing.location')}</h2>
            {l.lat !== null && l.lng !== null && !mapFailed && (
              <MapCanvas
                label={t('listing.mapLabel')}
                center={[l.lng, l.lat]}
                zoom={13}
                interactive={false}
                approximateRadiusM={APPROXIMATE_RADIUS_M}
                onError={() => setMapFailed(true)}
                className="h-40 rounded-lg border border-border lg:h-60"
              />
            )}
            <p className="text-body font-medium">
              {t('listing.address', { street: l.street, city: l.city })}
            </p>
            {/* The search map at this spot, with this listing's card open (spec 0009y); also when
                the small map failed. */}
            {l.lat !== null && l.lng !== null && (
              <Link
                to={`${l.listing_type === 'room' ? '/market' : '/search'}?${writeMapPosition(
                  new URLSearchParams({ view: 'map' }),
                  { center: [l.lng, l.lat], zoom: 15, pin: l.id },
                ).toString()}`}
                className={`inline-flex min-h-tap items-center self-start rounded text-body-sm font-medium text-accent-strong underline underline-offset-4 ${focusRing}`}
              >
                {t('listing.showOnMap')}
              </Link>
            )}
            <p className="text-body-sm text-ink-muted">{t('listing.locationHint')}</p>
          </section>

          <OwnerPreferences listing={l} />

          {/* Nothing for `match: null`: the apply section already invites a seeker without a
              profile to fill one. */}
          {l.match !== null && <MatchCard match={l.match} listing={l} />}
        </div>

        <div
          ref={actionsRef}
          data-testid="listing-actions"
          // The action column stays in view while reading; `p-1` keeps focus rings inside its
          // scroll box (`-m-1` keeps the cards flush with the band's edge), and the max height
          // (viewport minus top and bottom 1.5 rem) lets it scroll when the open apply form is
          // taller than the screen.
          className="flex flex-col gap-5 lg:sticky lg:top-6 lg:-m-1 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:p-1"
        >
          {mutualId !== null && isSeeker ? (
            <MutualBanner applicationId={mutualId} />
          ) : (
            l.like !== null &&
            l.room_fit !== false && (
              <LikeRoomButton listingId={l.id} like={l.like} onMutual={setMutualId} showHint />
            )
          )}

          <Card padding="md">
            <ApplySection listing={l} headingRef={applyHeadingRef} />
          </Card>
        </div>
      </article>
    );
  }

  return (
    <PageContainer width="wide" className="flex flex-col gap-4">
      <BackLink
        to={backToMarket ? '/market' : '/search'}
        label={backToMarket ? t('listing.backToMarket') : t('listing.backToSearch')}
      />
      {body}
      {listing.isSuccess && (
        <ApplyBar listing={listing.data} target={actionsRef} headingRef={applyHeadingRef} />
      )}
    </PageContainer>
  );
}
