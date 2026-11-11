import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { ErrorState } from '../../components/ErrorState';
import { MapCanvas } from '../../components/map/MapCanvas';
import { Skeleton } from '../../components/Skeleton';
import { ApplySection } from '../applications/ApplySection';
import { LikeRoomButton } from '../likes/LikeRoomButton';
import { MutualBanner } from '../likes/MutualBanner';
import { MatchBadge } from '../match/MatchBadge';
import { MatchCard } from '../match/MatchCard';
import { RoomFacts } from '../rooms/RoomFacts';
import { ApiError } from './api';
import { cardTitle } from './cardTitle';
import { formatDate, formatIls, todayInIsrael } from './format';
import { ListingFacts } from './ListingFacts';
import { OwnerPreferences } from './OwnerPreferences';
import { usePublicListing } from './usePublicListing';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** `/listings/:id`, public: Listing.dc.html without the parts later slices own. */
export function ListingPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const listing = usePublicListing(id);
  // The small map is dropped when it cannot be shown; the address text stays.
  const [mapFailed, setMapFailed] = useState(false);
  // Set by a like that made the pair mutual; it replaces the control and outlives the cache writes.
  const [mutualId, setMutualId] = useState<string | null>(null);

  let body;
  if (listing.isPending) {
    body = (
      <div aria-busy="true" aria-label={t('common.loading')} className="flex flex-col gap-3">
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  } else if (listing.isError) {
    const error = listing.error;
    // 404: not live or unknown; 422: a malformed id. Neither has anything to retry.
    const notFound = error instanceof ApiError && (error.status === 404 || error.status === 422);
    body = notFound ? (
      <h1 className="text-start text-2xl font-extrabold">{t('listing.notFound')}</h1>
    ) : (
      <ErrorState onRetry={() => void listing.refetch()} />
    );
  } else {
    const l = listing.data;
    const facts = [
      l.total_floors === null
        ? t('listings.card.floor', { floor: l.floor })
        : t('listings.card.floorOf', { floor: l.floor, total: l.total_floors }),
      `${String(l.size_sqm)} ${t('listings.units.sqm')}`,
      l.available_from <= todayInIsrael()
        ? t('listings.card.immediate')
        : t('listings.card.availableFrom', { date: formatDate(l.available_from) }),
    ];
    if (l.entry_flexible) facts.push(t('listings.fields.entryFlexible'));

    body = (
      <article className="flex flex-col gap-5">
        {/* The neutral photo placeholder of the card (photos are 0002c). */}
        <div className="flex h-[200px] items-center justify-center rounded-2xl bg-[#DDD6CE]">
          <svg
            aria-hidden="true"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#A8A29E"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="M21 16l-5-5-8 8" />
          </svg>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[30px] font-extrabold tracking-[-0.3px]">
              <span>
                {formatIls(l.price_ils)} {t('listings.units.ils')}
              </span>{' '}
              <span className="text-sm font-medium tracking-normal text-muted">
                {t('listings.units.perMonth')}
              </span>
            </p>
            {l.match !== null && <MatchBadge score={l.match.score} />}
          </div>
          <h1 className="break-words text-xl font-bold leading-snug">{cardTitle(t, l)}</h1>
          <p className="flex flex-wrap gap-x-[10px] text-sm text-muted">
            {facts.map((fact, i) => (
              <span key={fact} className="flex gap-x-[10px]">
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
            <h2 className="text-[17px] font-extrabold">{t('listings.fields.description')}</h2>
            <p
              data-testid="listing-description"
              className="whitespace-pre-line break-words text-[15px] leading-relaxed text-[#44403C]"
            >
              {l.description}
            </p>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-extrabold">{t('listing.location')}</h2>
          {l.lat !== null && l.lng !== null && !mapFailed && (
            <MapCanvas
              label={t('listing.mapLabel')}
              center={[l.lng, l.lat]}
              zoom={14}
              interactive={false}
              approximate
              onError={() => setMapFailed(true)}
              className="h-[150px] rounded-2xl border border-line"
            />
          )}
          <p className="text-[15px] font-semibold">
            {t('listing.address', { street: l.street, city: l.city })}
          </p>
          <p className="text-sm text-muted">{t('listing.locationHint')}</p>
        </section>

        <OwnerPreferences listing={l} />

        {/* Nothing for `match: null`: the apply section already invites a seeker without a
            profile to fill one. */}
        {l.match !== null && <MatchCard match={l.match} listing={l} />}

        {mutualId !== null ? (
          <MutualBanner applicationId={mutualId} />
        ) : (
          l.like !== null &&
          l.room_fit !== false && (
            <LikeRoomButton listingId={l.id} like={l.like} onMutual={setMutualId} />
          )
        )}

        <ApplySection listing={l} />
      </article>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
      <Link
        to="/search"
        className={`inline-flex min-h-[44px] items-center gap-1 self-start rounded-full pe-3 text-[15px] font-semibold text-accent-text ${focusRing}`}
      >
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        {t('listing.backToSearch')}
      </Link>
      {body}
    </div>
  );
}
