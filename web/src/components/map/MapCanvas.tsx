import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '../Skeleton';
import { MAP_MAX_ZOOM, MAP_STYLE_URL, mapLocale, type Bbox } from './config';

type MapLibre = typeof import('maplibre-gl');

export type Pin = {
  id: string;
  lng: number;
  lat: number;
  /** The chip's visible text (the price). */
  text: string;
  /** The pin button's accessible name. */
  label: string;
};

type Props = {
  /** The region's name. */
  label: string;
  /** The initial view, fitted (`[west, south, east, north]`); or `center` + `zoom`. */
  bounds?: Bbox;
  center?: [lng: number, lat: number];
  zoom?: number;
  pins?: Pin[];
  selectedId?: string | undefined;
  onPinClick?: (id: string) => void;
  /** The visible box after every move; the initial fit's box is reported on `load`. */
  onMoveEnd?: (bbox: Bbox) => void;
  interactive?: boolean;
  /** A ~56 px translucent circle at `center`: the listing's approximate area. */
  approximate?: boolean;
  /** Results are pending: the region is `aria-busy`. */
  busy?: boolean;
  minZoom?: number;
  /** The map cannot be shown: the library failed to load, no WebGL, or an error before `load`. */
  onError?: () => void;
  className?: string;
};

const chip =
  'pointer-events-none whitespace-nowrap rounded-full border-[1.5px] px-3 py-[6px] text-[13px] font-bold shadow-[0_3px_8px_rgba(0,0,0,0.12)]';
const chipIdle = `${chip} border-[#D6D3D1] bg-white text-ink`;
const chipSelected = `${chip} border-white bg-accent text-white`;
// The button is the >= 44 px hit area around the smaller chip.
const pinButton =
  'flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent';

type MarkerEntry = { marker: Marker; button: HTMLButtonElement; chip: HTMLSpanElement };

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
  selectedId,
  onPinClick,
  onMoveEnd,
  interactive = true,
  approximate = false,
  busy = false,
  minZoom,
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
  const callbacks = useRef({ onPinClick, onMoveEnd, onError });
  useEffect(() => {
    callbacks.current = { onPinClick, onMoveEnd, onError };
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

      const reportBounds = () => {
        const b = created.getBounds();
        callbacks.current.onMoveEnd?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
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

  // Markers, diffed by id: added, moved, restyled or removed, never rebuilt per render.
  useEffect(() => {
    const current = mapRef.current;
    if (!ready || current === null) return;
    const { map, lib } = current;
    const markers = markersRef.current;
    const wanted = new Map((pins ?? []).map((pin) => [pin.id, pin]));

    for (const [id, entry] of markers) {
      if (!wanted.has(id)) {
        entry.marker.remove();
        markers.delete(id);
      }
    }
    for (const pin of wanted.values()) {
      let entry = markers.get(pin.id);
      if (entry === undefined) {
        const element = document.createElement('div');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = pinButton;
        const text = document.createElement('span');
        button.append(text);
        element.append(button);
        const id = pin.id;
        button.addEventListener('click', () => callbacks.current.onPinClick?.(id));
        // A marker needs its position before it is added.
        const marker = new lib.Marker({ element }).setLngLat([pin.lng, pin.lat]).addTo(map);
        entry = { marker, button, chip: text };
        markers.set(pin.id, entry);
      }
      const selected = pin.id === selectedId;
      entry.marker.setLngLat([pin.lng, pin.lat]);
      entry.button.setAttribute('aria-label', pin.label);
      entry.button.setAttribute('aria-pressed', String(selected));
      entry.chip.textContent = pin.text;
      entry.chip.className = selected ? chipSelected : chipIdle;
      // The selected chip is drawn over its neighbours.
      entry.marker.getElement().style.zIndex = selected ? '1' : '';
    }
  }, [ready, pins, selectedId]);

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
      {!loaded && <Skeleton className="absolute inset-0 h-full w-full" />}
    </div>
  );
}
