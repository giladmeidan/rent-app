import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { clusterPins } from '../../components/map/cluster';
import { ISRAEL_BOUNDS, MAP_MIN_ZOOM } from '../../components/map/config';
import {
  MapCanvas,
  type Bubble,
  type MapCamera,
  type MapView,
} from '../../components/map/MapCanvas';
import type { ListingPublic, ListingSearchOut } from './api';
import { bubbleLabel } from './pins';
import { extentOf, FIT_MAX_ZOOM } from './SearchMap';
import { useListingPins } from './useListingPins';

type Props = {
  /** The list's loaded listings, in its order; none while a new first page loads or failed. */
  items: readonly ListingPublic[];
  /** The list's first page as the query holds it: a new one (a new filter or sort, or a refetch)
   * refits the map; "load more" keeps it, so the map never jumps while the person reads. */
  firstPage: ListingSearchOut | undefined;
  /** The filters part of the URL; a first page for another key refits too. */
  filtersKey: string;
  /** The card under the pointer or focus, or the last pin pressed: drawn as the selected chip. */
  highlightedId: string | undefined;
  /** A pin, or a bubble whose members never separate (its best member), was pressed. */
  onPinPress: (id: string) => void;
  /** "Open the full map" with the map's last reported position (none before it loaded). */
  onOpenFullMap: (position: MapView | undefined) => void;
};

/**
 * The map beside the list from 1280 px (spec 0009x). It mirrors the list: its pins are the loaded
 * listings, and moving it never changes the list or sends a search. The cards are the keyboard and
 * screen-reader path, so its pins, bubbles, zoom buttons and canvas are neither (`keyboard={false}`).
 */
export function SideMap({
  items,
  firstPage,
  filtersKey,
  highlightedId,
  onPinPress,
  onOpenFullMap,
}: Props) {
  const { t } = useTranslation();
  const pins = useListingPins(items);
  // The last reported zoom, for clustering (until one arrives the pins are drawn unclustered), and
  // the last reported view, which the "open" button uses; a pan alone never regroups.
  const [zoom, setZoom] = useState<number>();
  const view = useRef<MapView | undefined>(undefined);
  const [unavailable, setUnavailable] = useState(false);
  const [camera, setCamera] = useState<MapCamera>();
  // The first page (and key) last seen; a different one with located pins sends one fit. Starts
  // empty, so the first mount fits too. Adjusted during render, as React's "state from data" pattern.
  const [seen, setSeen] = useState<{ page: ListingSearchOut | undefined; key: string }>({
    page: undefined,
    key: filtersKey,
  });
  if (seen.page !== firstPage || seen.key !== filtersKey) {
    setSeen({ page: firstPage, key: filtersKey });
    if (firstPage !== undefined && pins.length > 0) {
      setCamera((previous) => ({
        seq: (previous?.seq ?? 0) + 1,
        bounds: extentOf(pins),
        maxZoom: FIT_MAX_ZOOM,
      }));
    }
  }

  // Regrouped on a zoom, a data or a highlight change; the highlighted pin is always drawn alone.
  const clustered = useMemo(() => {
    if (zoom === undefined) return { pins, bubbles: [] as Bubble[] };
    const { pins: single, bubbles } = clusterPins(
      pins,
      zoom,
      new Set(highlightedId === undefined ? [] : [highlightedId]),
    );
    return {
      pins: single,
      bubbles: bubbles.map((bubble): Bubble => ({ ...bubble, label: bubbleLabel(t, bubble) })),
    };
  }, [pins, zoom, highlightedId, t]);

  if (unavailable) return <EmptyState message={t('search.sideMap.unavailable')} />;

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Above the map, never over it: it covers no pin and the map keeps no tab stop. */}
      <div className="flex justify-start">
        <Button variant="secondary" size="sm" onClick={() => onOpenFullMap(view.current)}>
          {t('search.sideMap.open')}
        </Button>
      </div>
      <MapCanvas
        label={t('search.sideMap.label')}
        bounds={ISRAEL_BOUNDS}
        minZoom={MAP_MIN_ZOOM}
        keyboard={false}
        camera={camera}
        pins={clustered.pins}
        bubbles={clustered.bubbles}
        selectedId={highlightedId}
        onPinClick={onPinPress}
        onBubbleOpen={(ids) => {
          const [best] = ids;
          if (best !== undefined) onPinPress(best);
        }}
        onMoveEnd={(_box, next) => {
          if (next === undefined) return;
          view.current = next;
          setZoom(next.zoom);
        }}
        onError={() => setUnavailable(true)}
        className="min-h-0 flex-1 rounded-lg border border-border"
      />
    </div>
  );
}
