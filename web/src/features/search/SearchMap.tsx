import { Fragment, useEffect, useId, useMemo, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { EmptyState, emptyStateBox } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { GUSH_DAN_BOUNDS, MAP_MIN_ZOOM, roundBbox, type Bbox } from '../../components/map/config';
import { clusterPins } from '../../components/map/cluster';
import { MapCanvas, type Bubble } from '../../components/map/MapCanvas';
import { todayInIsrael } from '../listings/format';
import { ListingCard } from '../listings/ListingCard';
import { MatchBadge } from '../match/MatchBadge';
import { MatchChips } from '../match/MatchChips';
import type { SeekerProfileOut } from '../profile/api';
import type { ListingPublic } from './api';
import type { Filters } from './filters';
import { bubbleLabel } from './pins';
import { useListingPins } from './useListingPins';
import { useMapSearch } from './useMapSearch';

const NO_ITEMS: ListingPublic[] = [];

type Props = {
  /** The URL's filters, without `view`. */
  filters: Filters;
  /** The seeker's profile, which words the match chips (`undefined`: none, or not loaded). */
  profile: SeekerProfileOut | undefined;
  /** Switches to the list view (the fallback when the map cannot be shown). */
  onShowList: () => void;
  /** The count line, focused by the page after a filter change (spec 0009t). */
  countRef?: Ref<HTMLParagraphElement>;
};

/**
 * The map view of `/search`: the filters' results inside the visible box as price pins. The box is
 * component state by design (spec 0003d amends 0003b NF3); the filters stay in the URL. Pins whose
 * hit areas would overlap fold into count bubbles at the map's zoom (spec 0009v); a bubble whose
 * members never separate lists their cards under the map.
 */
export function SearchMap({ filters, profile, onShowList, countRef }: Props) {
  const { t } = useTranslation();
  const [bbox, setBbox] = useState<Bbox>();
  // The zoom of the last reported view; until one arrives the pins are drawn unclustered.
  const [zoom, setZoom] = useState<number>();
  const [selectedId, setSelectedId] = useState<string>();
  // A pressed bubble whose members never separate: their ids, listed under the map.
  const [samePlace, setSamePlace] = useState<{ ids: string[]; zoom: number | undefined }>();
  const [unavailable, setUnavailable] = useState(false);
  // Bumped on every pin press, so focus moves to the card even when the same pin is pressed again.
  const [focusRequest, setFocusRequest] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const samePlaceHeadingId = useId();
  const search = useMapSearch(filters, bbox);
  const { data } = search;
  // The pill over the map while results update; visual only, the count line is the announcement.
  const updating = search.isPending || search.isPlaceholderData;

  const items = data?.items ?? NO_ITEMS;
  const pins = useListingPins(items);

  // A new answer without the selected listing removes its card.
  const selected = items.find((item) => item.id === selectedId);
  // The listed members still in the results; none left removes the list. A zoom (another bubble
  // pressed, or the map zoomed) regroups the map and removes it too.
  const listed =
    samePlace === undefined || samePlace.zoom !== zoom
      ? []
      : samePlace.ids.flatMap((id) => items.filter((item) => item.id === id));

  // Regrouped on a zoom, a data or a selection change only, never per pan frame (`moveend` is the
  // only zoom source).
  const clustered = useMemo(() => {
    if (zoom === undefined) return { pins, bubbles: [] as Bubble[] };
    const { pins: single, bubbles } = clusterPins(
      pins,
      zoom,
      // The selected pin is always drawn alone (an id no longer in the results matches no pin).
      new Set(selectedId === undefined ? [] : [selectedId]),
    );
    return {
      pins: single,
      bubbles: bubbles.map((bubble): Bubble => ({ ...bubble, label: bubbleLabel(t, bubble) })),
    };
  }, [pins, zoom, selectedId, t]);

  useEffect(() => {
    if (focusRequest > 0) cardRef.current?.querySelector('a')?.focus();
  }, [focusRequest]);

  // A listing's card under the map: as the list's, with the match badge and chips.
  const card = (listing: ListingPublic, titleAs: 'h2' | 'h3' = 'h2') => (
    <ListingCard
      listing={listing}
      titleAs={titleAs}
      today={todayInIsrael()}
      to={`/listings/${listing.id}`}
      seekerBirthYear={profile?.birth_year}
      badge={listing.match && <MatchBadge score={listing.match.score} />}
    >
      {listing.match && <MatchChips match={listing.match} listing={listing} profile={profile} />}
    </ListingCard>
  );

  // The states sit above the 60vh map (spec 0009t): the empty state is the count line itself (one
  // live region on the page, announced when it fills), and an error comes before the map.
  let count = '';
  let empty = false;
  let error = null;
  if (search.isError) {
    error = <ErrorState onRetry={() => search.refetch()} />;
  } else if (data !== undefined) {
    const { total, items } = data;
    if (total === 0) {
      empty = true;
      count = t('search.map.empty');
    } else if (total <= items.length) {
      count = t('search.count', { count: total });
    } else {
      count = t('search.map.tooMany', { shown: items.length, total });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p
        ref={countRef}
        tabIndex={-1}
        aria-live="polite"
        className={`focus:outline-none ${empty ? emptyStateBox : 'min-h-6 text-label lg:text-h3'}`}
      >
        {count}
      </p>
      {error}
      {unavailable ? (
        <div data-testid="map-unavailable" className="flex flex-col items-start gap-3">
          <EmptyState message={t('search.map.unavailable')} />
          <Button variant="secondary" onClick={onShowList}>
            {t('search.view.list')}
          </Button>
        </div>
      ) : (
        <MapCanvas
          label={t('search.map.label')}
          bounds={GUSH_DAN_BOUNDS}
          minZoom={MAP_MIN_ZOOM}
          busy={updating}
          overlay={
            updating && (
              <p
                aria-hidden="true"
                data-testid="map-updating"
                className="pointer-events-none absolute inset-x-0 top-3 z-10 mx-auto w-fit rounded-full border border-border bg-surface px-3 py-1.5 text-label text-ink"
              >
                {t('search.map.updating')}
              </p>
            )
          }
          pins={clustered.pins}
          bubbles={clustered.bubbles}
          selectedId={selected?.id}
          onPinClick={(id) => {
            setSelectedId(id);
            setSamePlace(undefined);
            setFocusRequest((n) => n + 1);
          }}
          onBubbleOpen={(ids) => {
            // No pin stays pressed without its card.
            setSelectedId(undefined);
            setSamePlace({ ids, zoom });
            setFocusRequest((n) => n + 1);
          }}
          onMoveEnd={(box, view) => {
            setBbox(roundBbox(box));
            if (view !== undefined) setZoom(view.zoom);
          }}
          onError={() => setUnavailable(true)}
          // The map keeps today's height at every width (no token fits a viewport-relative height).
          className="h-[60vh] min-h-[360px] rounded-lg border border-border"
        />
      )}
      {selected !== undefined && (
        <div ref={cardRef} className="max-w-md">
          {card(selected)}
        </div>
      )}
      {listed.length > 0 && (
        <div ref={cardRef} className="max-w-md">
          <section aria-labelledby={samePlaceHeadingId} className="flex flex-col gap-3">
            <h2 id={samePlaceHeadingId} className="text-start text-h3">
              {t('search.map.samePlace', { count: listed.length })}
            </h2>
            {listed.map((listing) => (
              <Fragment key={listing.id}>{card(listing, 'h3')}</Fragment>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
