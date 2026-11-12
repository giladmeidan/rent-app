import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, emptyStateBox } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { GUSH_DAN_BOUNDS, MAP_MIN_ZOOM, roundBbox, type Bbox } from '../../components/map/config';
import { MapCanvas, type Pin } from '../../components/map/MapCanvas';
import { cardTitle } from '../listings/cardTitle';
import { formatIls, todayInIsrael } from '../listings/format';
import { ListingCard } from '../listings/ListingCard';
import { MatchBadge } from '../match/MatchBadge';
import { MatchChips } from '../match/MatchChips';
import type { SeekerProfileOut } from '../profile/api';
import type { Filters } from './filters';
import { useMapSearch } from './useMapSearch';

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

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const secondary = `inline-flex min-h-[44px] items-center justify-center rounded-full border-[1.5px] border-border-strong bg-surface px-5 text-[15px] font-semibold ${focusRing}`;

/**
 * The map view of `/search`: the filters' results inside the visible box as price pins. The box is
 * component state by design (spec 0003d amends 0003b NF3); the filters stay in the URL.
 */
export function SearchMap({ filters, profile, onShowList, countRef }: Props) {
  const { t } = useTranslation();
  const [bbox, setBbox] = useState<Bbox>();
  const [selectedId, setSelectedId] = useState<string>();
  const [unavailable, setUnavailable] = useState(false);
  // Bumped on every pin press, so focus moves to the card even when the same pin is pressed again.
  const [focusRequest, setFocusRequest] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const search = useMapSearch(filters, bbox);
  const { data } = search;
  // The pill over the map while results update; visual only, the count line is the announcement.
  const updating = search.isPending || search.isPlaceholderData;

  const pins = useMemo<Pin[]>(() => {
    const result: Pin[] = [];
    for (const item of data?.items ?? []) {
      if (item.lat === null || item.lng === null) continue;
      const price = formatIls(item.price_ils);
      const label = t('search.map.pin', {
        title: cardTitle(t, item),
        price,
      });
      result.push({
        id: item.id,
        lng: item.lng,
        lat: item.lat,
        text:
          item.match === null
            ? `${price} ${t('listings.units.ils')}`
            : t('search.map.pinTextMatch', { price, score: item.match.score }),
        label:
          item.match === null
            ? label
            : label + t('search.map.pinMatch', { score: item.match.score }),
      });
    }
    return result;
  }, [data, t]);

  // A new answer without the selected listing removes its card.
  const selected = data?.items.find((item) => item.id === selectedId);

  useEffect(() => {
    if (focusRequest > 0) cardRef.current?.querySelector('a')?.focus();
  }, [focusRequest]);

  // The states sit above the 60vh map (spec 0009t): the empty state is the count line itself (one
  // live region on the page, announced when it fills), and an error comes before the map.
  let count = '';
  let empty = false;
  let error = null;
  if (search.isError) {
    error = <ErrorState onRetry={() => void search.refetch()} />;
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
        className={`focus:outline-none ${empty ? emptyStateBox : 'min-h-[1.5em] text-sm font-bold'}`}
      >
        {count}
      </p>
      {error}
      {unavailable ? (
        <div data-testid="map-unavailable" className="flex flex-col items-start gap-3">
          <EmptyState message={t('search.map.unavailable')} />
          <button type="button" onClick={onShowList} className={secondary}>
            {t('search.view.list')}
          </button>
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
          pins={pins}
          selectedId={selected?.id}
          onPinClick={(id) => {
            setSelectedId(id);
            setFocusRequest((n) => n + 1);
          }}
          onMoveEnd={(box) => setBbox(roundBbox(box))}
          onError={() => setUnavailable(true)}
          className="h-[60vh] min-h-[360px] rounded-2xl border border-border"
        />
      )}
      {selected !== undefined && (
        <div ref={cardRef}>
          <ListingCard
            listing={selected}
            today={todayInIsrael()}
            to={`/listings/${selected.id}`}
            seekerBirthYear={profile?.birth_year}
            badge={selected.match && <MatchBadge score={selected.match.score} />}
          >
            {selected.match && (
              <MatchChips match={selected.match} listing={selected} profile={profile} />
            )}
          </ListingCard>
        </div>
      )}
    </div>
  );
}
