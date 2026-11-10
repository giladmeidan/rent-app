// A stand-in for `MapCanvas` (jsdom has no WebGL). Use it with
//   vi.mock('<path>/components/map/MapCanvas', () => import('<path>/components/map/__tests__/fakeMapCanvas'));
// It renders the labelled region and one button per pin, records the last props, and lets the test
// fire the map's callbacks.
import { act, useLayoutEffect, type ComponentProps } from 'react';

import type { Bbox } from '../config';
import type { MapCanvas as RealMapCanvas, Pin } from '../MapCanvas';

export type { Pin };
type Props = ComponentProps<typeof RealMapCanvas>;

const fakeMap: { props: Props | undefined } = { props: undefined };

export function resetFakeMap() {
  fakeMap.props = undefined;
}

/** The last props, failing the test when the map has not rendered. */
export function lastProps(): Props {
  if (fakeMap.props === undefined) throw new Error('MapCanvas has not rendered');
  return fakeMap.props;
}

/** The map reports a visible box, as after a pan or zoom. */
export function moveTo(bbox: Bbox) {
  const { onMoveEnd } = lastProps();
  if (onMoveEnd === undefined) throw new Error('no onMoveEnd');
  act(() => onMoveEnd(bbox));
}

/** The map cannot be shown (no WebGL, the library failed to load). */
export function failMap() {
  const { onError } = lastProps();
  if (onError === undefined) throw new Error('no onError');
  act(() => onError());
}

export function MapCanvas(props: Props) {
  useLayoutEffect(() => {
    fakeMap.props = props;
  });
  return (
    <div role="region" aria-label={props.label} aria-busy={props.busy ?? false}>
      {(props.pins ?? []).map((pin) => (
        <button
          key={pin.id}
          type="button"
          aria-label={pin.label}
          aria-pressed={pin.id === props.selectedId}
          onClick={() => props.onPinClick?.(pin.id)}
        >
          {pin.text}
        </button>
      ))}
    </div>
  );
}
