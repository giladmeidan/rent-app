// A stand-in for `MapCanvas` (jsdom has no WebGL). Use it with
//   vi.mock('<path>/components/map/MapCanvas', () => import('<path>/components/map/__tests__/fakeMapCanvas'));
// It renders the labelled region, a focusable canvas, one button per pin and per bubble, the
// `overlay` and the `panel`, records the last props and every distinct `camera` (`cameras()`), and
// lets the test fire the map's callbacks. A bubble press reads `separates` as the real one does: a
// zoom is recorded (`lastZoomedTo`), or `onBubbleOpen` is called.
import { act, useLayoutEffect, type ComponentProps } from 'react';

import type { Bbox } from '../config';
import type { Bubble, MapCamera, MapCanvas as RealMapCanvas, MapView, Pin } from '../MapCanvas';

export type { Bubble, MapCamera, Pin };
type Props = ComponentProps<typeof RealMapCanvas>;

const fakeMap: {
  props: Props | undefined;
  zoomedTo: string[] | undefined;
  cameras: MapCamera[];
} = {
  props: undefined,
  zoomedTo: undefined,
  cameras: [],
};

export function resetFakeMap() {
  fakeMap.props = undefined;
  fakeMap.zoomedTo = undefined;
  fakeMap.cameras = [];
}

/** Every distinct camera the map was given, in order (one per `seq`). */
export function cameras(): MapCamera[] {
  return fakeMap.cameras;
}

/** The members' ids of the last bubble press that zoomed in (`separates`), if any. */
export function lastZoomedTo(): string[] | undefined {
  return fakeMap.zoomedTo;
}

/** The last props, failing the test when the map has not rendered. */
export function lastProps(): Props {
  if (fakeMap.props === undefined) throw new Error('MapCanvas has not rendered');
  return fakeMap.props;
}

/** The map reports a visible box, as after a pan or zoom; with `view` only when given, so a test
 * that passes none keeps its pins unclustered. */
export function moveTo(bbox: Bbox, view?: MapView) {
  const { onMoveEnd } = lastProps();
  if (onMoveEnd === undefined) throw new Error('no onMoveEnd');
  act(() => {
    if (view === undefined) onMoveEnd(bbox);
    else onMoveEnd(bbox, view);
  });
}

/** The map cannot be shown (no WebGL, the library failed to load). */
export function failMap() {
  const { onError } = lastProps();
  if (onError === undefined) throw new Error('no onError');
  act(() => onError());
}

export function MapCanvas(props: Props) {
  // `keyboard={false}` (the side map, spec 0009x): no pin or bubble is a tab stop or exposed.
  const hidden =
    props.keyboard === false ? { tabIndex: -1, 'aria-hidden': true as const } : undefined;
  useLayoutEffect(() => {
    fakeMap.props = props;
    const { camera } = props;
    if (camera !== undefined && !fakeMap.cameras.some((c) => c.seq === camera.seq)) {
      fakeMap.cameras.push(camera);
    }
  });
  return (
    <div role="region" aria-label={props.label} aria-busy={props.busy ?? false}>
      {/* The pan surface: MapLibre's canvas is focusable when the map is interactive. */}
      <canvas tabIndex={props.interactive === false || props.keyboard === false ? -1 : 0} />
      {(props.pins ?? []).map((pin) => (
        <button
          key={pin.id}
          type="button"
          aria-label={pin.label}
          aria-pressed={pin.id === props.selectedId}
          data-pin-id={pin.id}
          data-tier={pin.tier}
          data-mark={pin.mark ?? undefined}
          data-seen={pin.seen}
          {...hidden}
          onClick={() => props.onPinClick?.(pin.id)}
        >
          {pin.text}
        </button>
      ))}
      {(props.bubbles ?? []).map((bubble: Bubble) => (
        <button
          key={bubble.id}
          type="button"
          aria-label={bubble.label}
          data-pin-id={bubble.id}
          data-tier={bubble.tier}
          {...hidden}
          onClick={() => {
            const ids = bubble.members.map((member) => member.id);
            if (bubble.separates) fakeMap.zoomedTo = ids;
            else props.onBubbleOpen?.(ids);
          }}
        >
          {bubble.count}
        </button>
      ))}
      {props.overlay}
      {props.panel}
    </div>
  );
}
