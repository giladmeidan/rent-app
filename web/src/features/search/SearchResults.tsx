import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FocusEvent, type Ref } from 'react';

import type { MapView } from '../../components/map/MapCanvas';
import { useIsWide } from '../../components/useMediaQuery';
import type { SeekerProfileOut } from '../profile/api';
import type { ListingPublic, ListingSearchOut } from './api';
import { ResultsList, type CardEvents } from './ResultsList';
import { SideMap } from './SideMap';
import { flattenPages } from './useSearch';

const NO_ITEMS: ListingPublic[] = [];

type Props = {
  search: UseInfiniteQueryResult<InfiniteData<ListingSearchOut>>;
  hasFilters: boolean;
  onClear: () => void;
  profile: SeekerProfileOut | undefined;
  countRef?: Ref<HTMLParagraphElement>;
  /** The filters part of the URL: a first page for another key refits the side map. */
  filtersKey: string;
  /** The side map's "open the full map" (spec 0009x). */
  onOpenFullMap: (position: MapView | undefined) => void;
};

/** Runs `run` once the browser is idle (at most 2 s later), else after 200 ms; returns a cancel. */
function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, { timeout: 2000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(run, 200);
  return () => window.clearTimeout(handle);
}

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The list view's results (spec 0009x): the list and, from 1280 px, the side map beside it. It holds
 * the highlighted listing, so a hover re-renders the list and the side map only, never the filters.
 */
export function SearchResults({
  search,
  hasFilters,
  onClear,
  profile,
  countRef,
  filtersKey,
  onOpenFullMap,
}: Props) {
  const wide = useIsWide();
  const { data } = search;
  // Rebuilt only when the data changes, so the pins are too.
  const items = useMemo(() => (data === undefined ? NO_ITEMS : flattenPages(data)), [data]);
  const total = data?.pages[data.pages.length - 1]?.total ?? 0;
  const listRef = useRef<HTMLDivElement>(null);

  // Mounted the first time results answer with a listing, once the browser is idle (the list never
  // waits for it), and kept until the width (or the view, which unmounts this) changes.
  const [mounted, setMounted] = useState(false);
  if (mounted && !wide) setMounted(false);
  const hasResults = total > 0;
  useEffect(() => {
    if (!wide || mounted || !hasResults) return;
    return whenIdle(() => setMounted(true));
  }, [wide, mounted, hasResults]);

  // The highlight: the pointer wins while over a card; leaving falls back to the card holding focus,
  // else clears. A pin press lasts until the next card pointer or focus event.
  const [highlightedId, setHighlightedId] = useState<string>();
  const pointerId = useRef<string | undefined>(undefined);
  const focusId = useRef<string | undefined>(undefined);
  const events: CardEvents = {
    onPointerEnter: (id) => {
      pointerId.current = id;
      setHighlightedId(id);
    },
    onPointerLeave: (id) => {
      if (pointerId.current === id) pointerId.current = undefined;
      setHighlightedId(focusId.current);
    },
    onFocus: (id) => {
      focusId.current = id;
      setHighlightedId(id);
    },
    onBlur: (id, event: FocusEvent<HTMLLIElement>) => {
      // Focus moving within the card keeps it.
      if (
        event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)
      ) {
        return;
      }
      if (focusId.current === id) focusId.current = undefined;
      setHighlightedId(pointerId.current ?? focusId.current);
    },
  };

  /** A pin press: highlights its card and scrolls it into view; focus stays where it is. */
  const pressPin = (id: string) => {
    setHighlightedId(id);
    const card = listRef.current
      ?.querySelector(`a[href="/listings/${id}"]`)
      ?.closest<HTMLLIElement>('li');
    card?.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };

  const list = (
    <ResultsList
      search={search}
      profile={profile}
      hasFilters={hasFilters}
      onClear={onClear}
      countRef={countRef}
      {...(wide && { sideMap: { ...events, highlightedId } })}
    />
  );
  if (!wide) return list;

  return (
    // The artboard's 440 px list column (27.5rem) and the map in the rest.
    <div className="grid grid-cols-[27.5rem_minmax(0,1fr)] items-start gap-4">
      <div ref={listRef} className="min-w-0">
        {list}
      </div>
      {/* Sticky beside the list; the header is not sticky, so no offset for it. */}
      <div className="sticky top-4 h-[calc(100vh-2rem)] min-h-[360px]">
        {mounted && (
          <SideMap
            items={items}
            firstPage={data?.pages[0]}
            filtersKey={filtersKey}
            highlightedId={highlightedId}
            onPinPress={pressPin}
            onOpenFullMap={onOpenFullMap}
          />
        )}
      </div>
    </div>
  );
}
