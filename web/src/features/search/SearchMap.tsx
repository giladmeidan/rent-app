import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { Button } from '../../components/Button';
import { EmptyState, emptyStateBox } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { GUSH_DAN_BOUNDS, MAP_MIN_ZOOM, roundBbox, type Bbox } from '../../components/map/config';
import { clusterPins } from '../../components/map/cluster';
import { MapCanvas, type Bubble, type MapCamera, type Pin } from '../../components/map/MapCanvas';
import { todayInIsrael } from '../listings/format';
import { ListingCard } from '../listings/ListingCard';
import { MatchBadge } from '../match/MatchBadge';
import { MatchChips } from '../match/MatchChips';
import type { SeekerProfileOut } from '../profile/api';
import type { ListingPublic } from './api';
import type { Filters } from './filters';
import { parseMapPosition, writeMapPosition } from './mapPosition';
import { bubbleLabel } from './pins';
import { useListingPins } from './useListingPins';
import { useMapSearch } from './useMapSearch';

const NO_ITEMS: ListingPublic[] = [];

/** The first-open fit never zooms past this, so a single pin does not land at street level. */
const FIT_MAX_ZOOM = 15;

/**
 * Where focus goes once the render reflects a press (react-router applies every URL change in a
 * transition, after the handler): the card's link, the same-place list's first link, or a listing's
 * pin (else the bubble holding it, else the canvas) once the panel is closed.
 */
type PendingFocus = { to: 'card'; id: string } | { to: 'list' } | { to: 'marker'; id: string };

/** The `[west, south, east, north]` extent of the pins. */
function extentOf(pins: readonly Pin[]): Bbox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const { lng, lat } of pins) {
    west = Math.min(west, lng);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}

// The docked panel (spec 0009w): along the bottom of a phone's map above the attribution line,
// 360 px in the bottom inline-end corner from `lg` (attribution at the bottom inline start, zoom at
// the top inline end).
const dock = 'absolute inset-x-3 bottom-8 z-10 lg:inset-x-auto lg:bottom-3 lg:end-3 lg:w-[22.5rem]';

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
 * component state by design (spec 0003d amends 0003b NF3); the filters stay in the URL, and so do
 * the map's centre, zoom and selected pin (`c`, `z`, `pin`, spec 0009w), so Back, a reload and a
 * link reopen the same view. Pins whose hit areas would overlap fold into count bubbles at the
 * map's zoom (spec 0009v). The selected listing's card, or the list of a bubble whose members never
 * separate, is docked inside the map.
 */
export function SearchMap({ filters, profile, onShowList, countRef }: Props) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  // The selected listing lives in the URL.
  const pinId = parseMapPosition(searchParams).pin;
  // The view the map opens at, read once: the URL's position (Back, a reload, a link), else none.
  // The `load` move writes `c`/`z` before the first answer, so the URL cannot tell this later.
  const [initialView] = useState(() => {
    const { center, zoom } = parseMapPosition(searchParams);
    return center === undefined ? undefined : { center, zoom };
  });
  const [bbox, setBbox] = useState<Bbox>();
  // The zoom of the last reported view; until one arrives the pins are drawn unclustered.
  const [zoom, setZoom] = useState<number>();
  // A pressed bubble whose members never separate: their ids, best first (the anchor first).
  const [samePlace, setSamePlace] = useState<string[]>();
  const [unavailable, setUnavailable] = useState(false);
  // The camera moves sent after mount, each with the next `seq`. Opened without a position, the map
  // fits the first answer with a located listing once; any other camera sent first (a later
  // spec's) sets `fitPending` false, so that fit never follows.
  const [camera, setCamera] = useState<MapCamera>();
  const [fitPending, setFitPending] = useState(initialView === undefined);
  // Bumped on every press, so focus moves even when the same pin is pressed again.
  const [focusRequest, setFocusRequest] = useState(0);
  const pendingFocus = useRef<PendingFocus | undefined>(undefined);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Set when the panel left the page while focus was inside it.
  const focusLeftWithPanel = useRef(false);
  const samePlaceHeadingId = useId();
  const search = useMapSearch(filters, bbox);
  const { data } = search;
  // The pill over the map while results update; visual only, the count line is the announcement.
  const updating = search.isPending || search.isPlaceholderData;

  const items = data?.items ?? NO_ITEMS;
  const pins = useListingPins(items);

  // The listed members still in the results; none left removes the list. A zoom (another bubble
  // pressed, or the map zoomed) regroups the map and removes it too.
  const listed =
    samePlace === undefined
      ? []
      : samePlace.flatMap((id) => items.filter((item) => item.id === id));
  const listOpen = listed.length > 0;
  // The selected listing's card shows while it is in the results, and never beside the list.
  const selectedId = listOpen || !items.some((item) => item.id === pinId) ? undefined : pinId;

  // Regrouped on a zoom, a data or a selection change only, never per pan frame (`moveend` is the
  // only zoom source).
  const clustered = useMemo(() => {
    if (zoom === undefined) return { pins, bubbles: [] as Bubble[] };
    const { pins: single, bubbles } = clusterPins(
      pins,
      zoom,
      // The selected pin is always drawn alone.
      new Set(selectedId === undefined ? [] : [selectedId]),
    );
    return {
      pins: single,
      bubbles: bubbles.map((bubble): Bubble => ({ ...bubble, label: bubbleLabel(t, bubble) })),
    };
  }, [pins, zoom, selectedId, t]);

  const selected = items.find((item) => item.id === selectedId);

  // The first answer with a located listing fits the map to them, once per mount (an answer with
  // none leaves the Gush Dan view). Adjusted during render, as React's "state from data" pattern.
  if (fitPending && data !== undefined && !search.isPlaceholderData && pins.length > 0) {
    setFitPending(false);
    setCamera((previous) => ({
      seq: (previous?.seq ?? 0) + 1,
      bounds: extentOf(pins),
      maxZoom: FIT_MAX_ZOOM,
    }));
  }

  /** Writes the selected pin (`undefined` removes it), with no history entry. */
  const writePin = (pin: string | undefined) => {
    if (pin === pinId) return;
    setSearchParams(writeMapPosition(searchParams, { pin }), { replace: true });
  };

  // A settled answer without the selected listing drops `pin`, so a later pan never reopens a card
  // nobody pressed.
  useEffect(() => {
    if (pinId === undefined || data === undefined || search.isPlaceholderData) return;
    if (data.items.some((item) => item.id === pinId)) return;
    setSearchParams((previous) => writeMapPosition(previous, { pin: undefined }), {
      replace: true,
    });
  }, [pinId, data, search.isPlaceholderData, setSearchParams]);

  // React detaches a ref before it removes the node, so focus can still be seen inside it here.
  const setPanelRef = useCallback((element: HTMLDivElement | null) => {
    if (element === null && panelRef.current?.contains(document.activeElement) === true) {
      focusLeftWithPanel.current = true;
    }
    panelRef.current = element;
  }, []);

  // Focus moves once the render shows what the press asked for.
  useEffect(() => {
    const root = wrapperRef.current;
    const pending = pendingFocus.current;
    const leftWithPanel = focusLeftWithPanel.current;
    focusLeftWithPanel.current = false;
    const focusCanvas = () => root?.querySelector<HTMLElement>('canvas')?.focus();
    if (pending === undefined) {
      // The panel left with focus inside (its listing left the results, or a zoom closed the list).
      if (leftWithPanel) focusCanvas();
      return;
    }
    if (pending.to === 'card') {
      if (selectedId !== pending.id) return;
      panelRef.current?.querySelector('a')?.focus();
    } else if (pending.to === 'list') {
      if (!listOpen) return;
      panelRef.current?.querySelector('a')?.focus();
    } else {
      if (selectedId !== undefined || listOpen) return;
      // The pin is no longer kept apart, so it may have folded into a bubble.
      const bubble = clustered.bubbles.find((b) => b.members.some((m) => m.id === pending.id));
      const target =
        root?.querySelector<HTMLElement>(`[data-pin-id="${pending.id}"]`) ??
        (bubble === undefined
          ? null
          : root?.querySelector<HTMLElement>(`[data-pin-id="${bubble.id}"]`));
      if (target != null) target.focus();
      else focusCanvas();
    }
    pendingFocus.current = undefined;
  }, [selectedId, listOpen, clustered, focusRequest]);

  /** The close button and Escape: the card or the list, whichever is open. */
  const closePanel = () => {
    if (listOpen) {
      // The list's first member still in the results: its bubble is the one that opened the list.
      pendingFocus.current = { to: 'marker', id: listed[0]?.id ?? '' };
      setSamePlace(undefined);
    } else if (selected !== undefined) {
      pendingFocus.current = { to: 'marker', id: selected.id };
      writePin(undefined);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || (!listOpen && selected === undefined)) return;
    event.preventDefault();
    closePanel();
  };

  // A listing's card in the map, compact, with the match badge and chips.
  const card = (listing: ListingPublic, titleAs: 'h2' | 'h3' = 'h2') => (
    <ListingCard
      listing={listing}
      titleAs={titleAs}
      today={todayInIsrael()}
      to={`/listings/${listing.id}`}
      seekerBirthYear={profile?.birth_year}
      layout="compact"
      badge={listing.match && <MatchBadge score={listing.match.score} />}
    >
      {listing.match && <MatchChips match={listing.match} listing={listing} profile={profile} />}
    </ListingCard>
  );

  // The card or the list, docked; the close button is the card's sibling, above its stretched link.
  const panel = (listOpen || selected !== undefined) && (
    <div
      ref={setPanelRef}
      data-map-card=""
      className={`${dock} ${listOpen ? 'flex max-h-[50%] flex-col rounded-lg border border-border bg-surface' : ''}`}
    >
      {listOpen ? (
        <section
          aria-labelledby={samePlaceHeadingId}
          // Rows at their content's height: the cards (overflow-hidden) would otherwise shrink to
          // fit the panel instead of scrolling in it.
          className="grid auto-rows-max gap-3 overflow-y-auto p-3"
        >
          <h2 id={samePlaceHeadingId} className="pe-12 text-start text-h3">
            {t('search.map.samePlace', { count: listed.length })}
          </h2>
          {listed.map((listing) => (
            <Fragment key={listing.id}>{card(listing, 'h3')}</Fragment>
          ))}
        </section>
      ) : (
        selected !== undefined && card(selected)
      )}
      <Button
        variant="secondary"
        size="sm"
        aria-label={t('search.map.closeCard')}
        onClick={closePanel}
        className="absolute end-2 top-2 z-10"
        icon={
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        }
      />
    </div>
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
        // Escape from anywhere in the map (a pin, the canvas, the panel) closes the panel.
        <div ref={wrapperRef} onKeyDown={onKeyDown}>
          <MapCanvas
            label={t('search.map.label')}
            {...(initialView === undefined
              ? { bounds: GUSH_DAN_BOUNDS }
              : { center: initialView.center, zoom: initialView.zoom })}
            minZoom={MAP_MIN_ZOOM}
            camera={camera}
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
            panel={panel}
            pins={clustered.pins}
            bubbles={clustered.bubbles}
            selectedId={selectedId}
            onPinClick={(id) => {
              setSamePlace(undefined);
              pendingFocus.current = { to: 'card', id };
              setFocusRequest((n) => n + 1);
              writePin(id);
            }}
            onBubbleOpen={(ids) => {
              // No pin stays pressed without its card.
              setSamePlace(ids);
              pendingFocus.current = { to: 'list' };
              setFocusRequest((n) => n + 1);
              writePin(undefined);
            }}
            onMoveEnd={(box, view) => {
              setBbox(roundBbox(box));
              if (view === undefined) return;
              if (view.zoom !== zoom) setSamePlace(undefined);
              setZoom(view.zoom);
              // The position, with no history entry per pan; the selected pin is kept.
              const next = writeMapPosition(searchParams, { center: view.center, zoom: view.zoom });
              if (next.toString() !== searchParams.toString()) {
                setSearchParams(next, { replace: true });
              }
            }}
            onError={() => setUnavailable(true)}
            // The map keeps today's height at every width (no token fits a viewport-relative height).
            className="h-[60vh] min-h-[360px] rounded-lg border border-border"
          />
        </div>
      )}
    </div>
  );
}
