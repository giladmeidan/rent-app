import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { focusRing } from '../focusRing';
import { Skeleton } from '../Skeleton';
import { MAP_MAX_ZOOM, MAP_STYLE_URL, mapLocale, type Bbox } from './config';

type MapLibre = typeof import('maplibre-gl');

/** The match tier the chip's colours say (spec 0009v); `none`: no match data. */
export type PinTier = 'high' | 'good' | 'partial' | 'none';

export type Pin = {
  id: string;
  lng: number;
  lat: number;
  /** The chip's visible text (the price). */
  text: string;
  /** The pin button's accessible name. */
  label: string;
  tier: PinTier;
  /** One outline icon before the text: a check for `applied`, a heart for `liked`. */
  mark: 'applied' | 'liked' | null;
  /** Opened on this device: normal weight and no shadow, never another colour. */
  seen: boolean;
  /** Stacking order, higher on top, at least 1. */
  z: number;
};

/**
 * Pins that would overlap, folded into one round count chip at the anchor's (best member's) point;
 * its id is `cluster:` + the anchor's id, never a pin's. `separates`: the members part at
 * `MAP_MAX_ZOOM` (pressing zooms in), else they never do (pressing lists them).
 */
export type Bubble = {
  id: string;
  lng: number;
  lat: number;
  count: number;
  tier: PinTier;
  z: number;
  label: string;
  members: Pin[];
  separates: boolean;
};

/** The camera after a move: what `onMoveEnd` reports next to the box. */
export type MapView = { center: [lng: number, lat: number]; zoom: number };

type Props = {
  /** The region's name. */
  label: string;
  /** The initial view, fitted (`[west, south, east, north]`); or `center` + `zoom`. */
  bounds?: Bbox;
  center?: [lng: number, lat: number];
  zoom?: number;
  /** The single pins (not folded into a bubble). */
  pins?: Pin[];
  /** Count bubbles, drawn as markers in the same diff as the pins. */
  bubbles?: Bubble[];
  selectedId?: string | undefined;
  onPinClick?: (id: string) => void;
  /** A bubble whose members never separate was pressed: their ids, best first. */
  onBubbleOpen?: (ids: string[]) => void;
  /** The visible box after every move, with the camera; the initial fit's is reported on `load`.
   * This component always passes `view`; it is optional for the tests' fake. */
  onMoveEnd?: (bbox: Bbox, view?: MapView) => void;
  interactive?: boolean;
  /** A ~56 px translucent circle at `center`: the listing's approximate area. */
  approximate?: boolean;
  /** Results are pending: the region is `aria-busy`. */
  busy?: boolean;
  minZoom?: number;
  /** Drawn over the map (inside the region) once it has loaded, e.g. the search map's "updating"
   * pill; it should be `pointer-events-none` so the pins and the pan surface stay usable. */
  overlay?: ReactNode;
  /** The map cannot be shown: the library failed to load, no WebGL, or an error before `load`. */
  onError?: () => void;
  className?: string;
};

// Chip classes per match tier (spec 0009v); the selected chip stays the one accent-filled element.
const chip =
  'pointer-events-none inline-flex items-center gap-1 whitespace-nowrap rounded-full border-[1.5px] px-3 py-[6px] text-[13px]';
const chipTier: Record<PinTier, string> = {
  high: 'border-accent bg-accent-soft text-accent-strong',
  good: 'border-border-strong bg-surface text-ink',
  partial: 'border-border bg-surface-subtle text-ink-muted',
  none: 'border-border-strong bg-surface text-ink',
};
const chipWeight: Record<PinTier, string> = {
  high: 'font-bold',
  good: 'font-bold',
  partial: 'font-medium',
  none: 'font-bold',
};
const chipSelected = `${chip} border-on-ink bg-accent text-on-ink font-bold shadow-pin`;
// A seen chip changes weight and depth only: normal weight, no shadow.
const chipClass = (pin: Pin) =>
  `${chip} ${chipTier[pin.tier]} ${pin.seen ? 'font-normal' : `${chipWeight[pin.tier]} shadow-pin`}`;
const bubbleChip =
  'pointer-events-none flex h-11 min-w-11 items-center justify-center rounded-full border-[1.5px] px-2 text-[13px] font-bold shadow-pin';
// The button is the >= 44 px hit area around the smaller chip.
const pinButton = `flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 ${focusRing}`;

const SVG_NS = 'http://www.w3.org/2000/svg';
// Outline icons (brand rule), 24 px grid drawn at 14 px with a 1.75 px stroke.
const MARK_PATHS: Record<'applied' | 'liked', string> = {
  // The app's own glyphs: Badge's check and the likes tab's heart.
  applied: 'M5 12l5 5 9-10',
  liked: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
};

/** The mark's icon: decorative, the pin's name says it. */
function markIcon(mark: 'applied' | 'liked'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'shrink-0');
  svg.dataset.mark = mark;
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', MARK_PATHS[mark]);
  // The stroke stays 1.75 screen px at the 14 px size.
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(path);
  return svg;
}

type Item = { kind: 'pin'; pin: Pin } | { kind: 'bubble'; bubble: Bubble };

type MarkerEntry = {
  marker: Marker;
  button: HTMLButtonElement;
  chip: HTMLSpanElement;
  /** The latest pin or bubble drawn by this marker; its click handler reads it. */
  item: Item;
};

/**
 * A MapLibre map. The only module that loads `maplibre-gl` (and its CSS and worker), through
 * `import()` when a map is mounted, so the library is a separate chunk the list view never fetches.
 */
export function MapCanvas({
  label,
  bounds,
  center,
  zoom,
  pins,
  bubbles,
  selectedId,
  onPinClick,
  onBubbleOpen,
  onMoveEnd,
  interactive = true,
  approximate = false,
  busy = false,
  minZoom,
  overlay,
  onError,
  className = '',
}: Props) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ map: MapLibreMap; lib: MapLibre } | null>(null);
  const markersRef = useRef(new Map<string, MarkerEntry>());
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // The map is created once; it reads the initial view and options from here, and the latest
  // callbacks through refs, so a re-render never rebuilds it.
  const initial = useRef({ bounds, center, zoom, interactive, minZoom, t, dir: i18n.dir() });
  const callbacks = useRef({ onPinClick, onBubbleOpen, onMoveEnd, onError });
  useEffect(() => {
    callbacks.current = { onPinClick, onBubbleOpen, onMoveEnd, onError };
  });

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    const markers = markersRef.current;
    const fail = () => {
      if (!cancelled) callbacks.current.onError?.();
    };

    void (async () => {
      let lib: MapLibre;
      let workerUrl: string;
      try {
        const [mod, worker] = await Promise.all([
          import('maplibre-gl'),
          // The worker is a separate file the library cannot find from a bundled chunk.
          import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
          import('maplibre-gl/dist/maplibre-gl.css'),
        ]);
        lib = mod;
        workerUrl = worker.default;
      } catch {
        fail();
        return;
      }
      // StrictMode mounts twice in dev: the first mount's import resolves after its cleanup.
      const container = containerRef.current;
      if (cancelled || container === null) return;

      const { bounds, center, zoom, interactive, minZoom, t, dir } = initial.current;
      // MapLibre option strings, not CSS: zoom buttons at the inline end, attribution at the
      // bottom inline start.
      const rtl = dir === 'rtl';
      lib.setWorkerUrl(workerUrl);
      try {
        // Without WebGL the constructor throws (after the canvas' `webglcontextcreationerror`).
        map = new lib.Map({
          container,
          style: MAP_STYLE_URL,
          ...(center !== undefined ? { center, zoom: zoom ?? 14 } : {}),
          ...(bounds !== undefined ? { bounds } : {}),
          ...(minZoom !== undefined ? { minZoom } : {}),
          maxZoom: MAP_MAX_ZOOM,
          interactive,
          locale: mapLocale(t),
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          cooperativeGestures: false,
        });
      } catch {
        fail();
        return;
      }
      const created = map;
      // Markers' z-indices order them among themselves only: without its own stacking context the
      // canvas container lets a pin with z >= 3 paint over the zoom buttons and attribution (z 2)
      // and the "updating" pill.
      created.getCanvasContainer().style.isolation = 'isolate';

      // The wrapper's region is the map's only landmark (spec 0009t). MapLibre makes the canvas a
      // second `region` named "map": an interactive canvas becomes an `application` (not a
      // landmark; the pan and zoom keys keep working in a screen reader's focus mode), and a
      // static one is hidden from assistive tech, keeping its `tabindex="-1"` so no hidden element
      // is focusable.
      const canvas = created.getCanvas();
      if (interactive) {
        canvas.setAttribute('role', 'application');
      } else {
        canvas.removeAttribute('role');
        canvas.removeAttribute('aria-label');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.setAttribute('tabindex', '-1');
      }

      const reportBounds = () => {
        const b = created.getBounds();
        const c = created.getCenter();
        callbacks.current.onMoveEnd?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], {
          center: [c.lng, c.lat],
          zoom: created.getZoom(),
        });
      };
      let isLoaded = false;
      created.on('load', () => {
        isLoaded = true;
        setLoaded(true);
        // The first box: the constructor's fit happened before any listener, and reporting it
        // here keeps pins and the count off the skeleton.
        reportBounds();
      });
      // A tile or source error (an OSM 429 or 500, offline) carries `tile` / `sourceId` and never
      // replaces the map; any other error before `load` (the style failed) does. After `load`
      // every error is ignored.
      created.on('error', (event) => {
        if (isLoaded || 'tile' in event || 'sourceId' in event) return;
        fail();
      });
      created.on('moveend', reportBounds);

      created.addControl(
        new lib.AttributionControl({ compact: false }),
        rtl ? 'bottom-right' : 'bottom-left',
      );
      if (interactive) {
        created.addControl(
          new lib.NavigationControl({ showCompass: false }),
          rtl ? 'top-left' : 'top-right',
        );
      }

      mapRef.current = { map: created, lib };
      setReady(true);
    })();

    return () => {
      cancelled = true;
      for (const entry of markers.values()) entry.marker.remove();
      markers.clear();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Markers, diffed by id: added, moved, restyled or removed, never rebuilt per render. Bubbles are
  // markers too, keyed by their `cluster:` id.
  useEffect(() => {
    const current = mapRef.current;
    if (!ready || current === null) return;
    const { map, lib } = current;
    const markers = markersRef.current;
    const wanted = new Map<string, Item>();
    for (const pin of pins ?? []) wanted.set(pin.id, { kind: 'pin', pin });
    for (const bubble of bubbles ?? []) wanted.set(bubble.id, { kind: 'bubble', bubble });

    // A focused bubble that this diff removes (its members parted after a zoom): focus lands on
    // what replaced it (spec 0009t's rule), the anchor's pin or its new bubble, else the canvas.
    let refocus: string | undefined;
    for (const [id, entry] of markers) {
      if (wanted.has(id)) continue;
      if (entry.item.kind === 'bubble' && entry.button === document.activeElement) {
        refocus = entry.item.bubble.members[0]?.id ?? '';
      }
      entry.marker.remove();
      markers.delete(id);
    }

    const pressBubble = (bubble: Bubble) => {
      if (!bubble.separates) {
        callbacks.current.onBubbleOpen?.(bubble.members.map((member) => member.id));
        return;
      }
      // At least one level per press, so a bubble never gets stuck when its members span more
      // than the fit area; repeated presses end at MAP_MAX_ZOOM, where the members part. MapLibre
      // skips the animation under `prefers-reduced-motion`.
      const bounds = new lib.LngLatBounds();
      for (const member of bubble.members) bounds.extend([member.lng, member.lat]);
      const camera = map.cameraForBounds(bounds, { padding: 64 });
      const zoom = map.getZoom();
      map.easeTo({
        center: camera?.center ?? [bubble.lng, bubble.lat],
        zoom: Math.min(MAP_MAX_ZOOM, Math.max(camera?.zoom ?? zoom, zoom + 1)),
      });
    };

    let top = 0;
    for (const item of wanted.values()) {
      top = Math.max(top, item.kind === 'pin' ? item.pin.z : item.bubble.z);
    }

    for (const [id, item] of wanted) {
      const { lng, lat } = item.kind === 'pin' ? item.pin : item.bubble;
      let entry = markers.get(id);
      if (entry === undefined) {
        const element = document.createElement('div');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = pinButton;
        button.dataset.pinId = id;
        const text = document.createElement('span');
        button.append(text);
        element.append(button);
        // A marker needs its position before it is added.
        const marker = new lib.Marker({ element }).setLngLat([lng, lat]).addTo(map);
        const created: MarkerEntry = { marker, button, chip: text, item };
        button.addEventListener('click', () => {
          const latest = created.item;
          if (latest.kind === 'pin') callbacks.current.onPinClick?.(latest.pin.id);
          else pressBubble(latest.bubble);
        });
        entry = created;
        markers.set(id, entry);
      }
      entry.item = item;
      entry.marker.setLngLat([lng, lat]);
      const style = entry.marker.getElement().style;
      if (item.kind === 'pin') {
        const { pin } = item;
        const selected = pin.id === selectedId;
        entry.button.setAttribute('aria-label', pin.label);
        entry.button.setAttribute('aria-pressed', String(selected));
        entry.chip.className = selected ? chipSelected : chipClass(pin);
        entry.chip.replaceChildren(
          ...(pin.mark !== null ? [markIcon(pin.mark)] : []),
          document.createTextNode(pin.text),
        );
        // The best match is drawn over worse ones; the selected chip over every one.
        style.zIndex = String(selected ? top + 1 : pin.z);
      } else {
        const { bubble } = item;
        entry.button.setAttribute('aria-label', bubble.label);
        entry.button.removeAttribute('aria-pressed');
        entry.chip.className = `${bubbleChip} ${chipTier[bubble.tier]}`;
        entry.chip.textContent = String(bubble.count);
        style.zIndex = String(bubble.z);
      }
    }

    if (refocus !== undefined) {
      const target = markers.get(refocus) ?? markers.get(`cluster:${refocus}`);
      if (target !== undefined) target.button.focus();
      else map.getCanvas().focus();
    }
  }, [ready, pins, bubbles, selectedId]);

  return (
    <div
      role="region"
      aria-label={label}
      aria-busy={busy || !loaded}
      className={`relative overflow-hidden ${className}`}
    >
      <div ref={containerRef} className="h-full w-full" />
      {approximate && loaded && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 m-auto h-14 w-14 rounded-full border-2 border-accent bg-accent/25"
        />
      )}
      {loaded && overlay}
      {!loaded && <Skeleton className="absolute inset-0 h-full w-full" />}
    </div>
  );
}
