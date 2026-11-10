import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { GUSH_DAN_BOUNDS, MAP_MIN_ZOOM, roundBbox, type Bbox } from '../../components/map/config';
import { MapCanvas, type Pin } from '../../components/map/MapCanvas';
import { formatIls, formatRooms, todayInIsrael } from '../listings/format';
import { ListingCard } from '../listings/ListingCard';
import type { Filters } from './filters';
import { useMapSearch } from './useMapSearch';

type Props = {
  /** The URL's filters, without `view`. */
  filters: Filters;
  /** Switches to the list view (the fallback when the map cannot be shown). */
  onShowList: () => void;
};

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const secondary = `inline-flex min-h-[44px] items-center justify-center rounded-full border-[1.5px] border-[#D6D3D1] bg-white px-5 text-[15px] font-semibold ${focusRing}`;

/**
 * The map view of `/search`: the filters' results inside the visible box as price pins. The box is
 * component state by design (spec 0003d amends 0003b NF3); the filters stay in the URL.
 */
export function SearchMap({ filters, onShowList }: Props) {
  const { t } = useTranslation();
  const [bbox, setBbox] = useState<Bbox>();
  const [selectedId, setSelectedId] = useState<string>();
  const [unavailable, setUnavailable] = useState(false);
  // Bumped on every pin press, so focus moves to the card even when the same pin is pressed again.
  const [focusRequest, setFocusRequest] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const search = useMapSearch(filters, bbox);
  const { data } = search;

  const pins = useMemo<Pin[]>(() => {
    const result: Pin[] = [];
    for (const item of data?.items ?? []) {
      if (item.lat === null || item.lng === null) continue;
      result.push({
        id: item.id,
        lng: item.lng,
        lat: item.lat,
        text: `${formatIls(item.price_ils)} ${t('listings.units.ils')}`,
        label: t('search.map.pin', {
          title: t('listings.card.title', {
            rooms: formatRooms(item.rooms),
            street: item.street,
            city: item.city,
          }),
          price: formatIls(item.price_ils),
        }),
      });
    }
    return result;
  }, [data, t]);

  // A new answer without the selected listing removes its card.
  const selected = data?.items.find((item) => item.id === selectedId);

  useEffect(() => {
    if (focusRequest > 0) cardRef.current?.querySelector('a')?.focus();
  }, [focusRequest]);

  let count = '';
  let below = null;
  if (search.isError) {
    below = <ErrorState onRetry={() => void search.refetch()} />;
  } else if (data !== undefined) {
    const { total, items } = data;
    if (total === 0) {
      below = <EmptyState message={t('search.map.empty')} />;
    } else if (total <= items.length) {
      count = total === 1 ? t('search.countOne') : t('search.count', { count: total });
    } else {
      count = t('search.map.tooMany', { shown: items.length, total });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p aria-live="polite" className="min-h-[1.5em] text-sm font-bold">
        {count}
      </p>
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
          busy={search.isPending || search.isPlaceholderData}
          pins={pins}
          selectedId={selected?.id}
          onPinClick={(id) => {
            setSelectedId(id);
            setFocusRequest((n) => n + 1);
          }}
          onMoveEnd={(box) => setBbox(roundBbox(box))}
          onError={() => setUnavailable(true)}
          className="h-[60vh] min-h-[360px] rounded-2xl border border-line"
        />
      )}
      {below}
      {selected !== undefined && (
        <div ref={cardRef}>
          <ListingCard listing={selected} today={todayInIsrael()} to={`/listings/${selected.id}`} />
        </div>
      )}
    </div>
  );
}
