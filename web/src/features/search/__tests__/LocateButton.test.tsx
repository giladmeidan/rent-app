import { act, fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  cameras,
  lastProps,
  moveTo,
  resetFakeMap,
} from '../../../components/map/__tests__/fakeMapCanvas';
import he from '../../../locales/he.json';
import { currentPath, json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import { parseMapPosition } from '../mapPosition';
import { SearchPage } from '../SearchPage';
import { at, page, publicListing } from './fixtures';

vi.mock(
  '../../../components/map/MapCanvas',
  () => import('../../../components/map/__tests__/fakeMapCanvas'),
);

const SEARCH = 'GET /listings';
// A fix in Tel Aviv that is not on the ~200 m grid, and its grid point.
const RAW: [number, number] = [34.78123, 32.08167];
const SNAPPED: [number, number] = [34.782, 32.082];
const HAIFA = { longitude: 34.99, latitude: 32.79 };

type Success = (position: GeolocationPosition) => void;
type Failure = (error: GeolocationPositionError) => void;

/** jsdom has no geolocation: a stub the test answers by hand. */
function stubGeolocation(): Mock {
  const getCurrentPosition = vi.fn();
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

/** The `i`th request's callbacks. */
function answer(getCurrentPosition: Mock, i: number) {
  const [ok, fail] = at(getCurrentPosition.mock.calls, i) as [Success, Failure];
  return {
    at: (coords: { longitude: number; latitude: number }) =>
      act(() => ok({ coords } as unknown as GeolocationPosition)),
    // Plain objects, as the stub sends: the component compares the code with literals.
    fails: (code: number) => act(() => fail({ code } as unknown as GeolocationPositionError)),
  };
}

beforeEach(() => {
  resetFakeMap();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation');
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const render = (path: string) =>
  renderRoutes(
    path,
    <Routes>
      <Route path="/search" element={<SearchPage />} />
    </Routes>,
  );

const locate = () => screen.getByRole('button', { name: he.search.map.locate });
/** The status line (the harness' `<output>` is a status too). */
function status(): HTMLElement {
  const line = document.querySelector<HTMLElement>('p[role="status"]');
  if (line === null) throw new Error('no status line');
  return line;
}
const params = () => new URLSearchParams(currentPath()?.split('?')[1] ?? '');
/** Every value in both storages, joined. */
const stored = () =>
  [window.localStorage, window.sessionStorage]
    .flatMap((storage) =>
      Array.from({ length: storage.length }, (_, i) => storage.getItem(storage.key(i) ?? '')),
    )
    .join(' ');

describe('LocateButton', () => {
  it('ac2_locate_outcomes_and_snapping', async () => {
    const getCurrentPosition = stubGeolocation();
    const api = mockApi({
      [SEARCH]: [() => json(page([publicListing({ lat: 32.08, lng: 34.8 })]))],
    });
    // Opened at a position, so no first-open fit camera is sent.
    const view = render('/search?view=map&c=32.07,34.8&z=13');
    moveTo([34.75, 32.05, 34.85, 32.09], { center: [34.8, 32.07], zoom: 13 });
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(1);
    });

    // The status line: mounted, empty, and not a second `aria-live` region.
    expect(status()).toHaveTextContent('');
    expect(status()).not.toHaveAttribute('aria-live');
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);

    // A press asks once, coarse and cached; while waiting the button is busy and keeps focus.
    locate().focus();
    fireEvent.click(locate());
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(at(getCurrentPosition.mock.calls, 0)[2]).toEqual({
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 60_000,
    });
    expect(locate()).toHaveAttribute('aria-busy', 'true');
    expect(locate()).toHaveAttribute('aria-disabled', 'true');
    expect(locate()).not.toBeDisabled();
    expect(document.activeElement).toBe(locate());
    // A busy press is not a second request.
    fireEvent.click(locate());
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    // Inside the launch area: the camera goes to the grid point, the dot to the raw fix.
    answer(getCurrentPosition, 0).at({ longitude: RAW[0], latitude: RAW[1] });
    expect(cameras()).toEqual([{ seq: 1, center: SNAPPED, zoom: 15 }]);
    expect(lastProps().userPosition).toEqual(RAW);
    expect(locate()).not.toHaveAttribute('aria-busy');
    expect(document.activeElement).toBe(locate());
    expect(status()).toHaveTextContent('');

    // The map reports that move: the URL's `c` and the next box are centred on the grid point.
    const [lng, lat] = SNAPPED;
    moveTo([lng - 0.01, lat - 0.008, lng + 0.01, lat + 0.008], { center: SNAPPED, zoom: 15 });
    expect(params().get('c')).toBe('32.082,34.782');
    expect(parseMapPosition(params()).center).toEqual(SNAPPED);
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(2);
    });
    const box = new URL(at(api.calls(SEARCH), 1).request.url).searchParams;
    const centre = (low: string, high: string) =>
      (Number(box.get(low)) + Number(box.get(high))) / 2;
    expect(centre('west', 'east')).toBeCloseTo(SNAPPED[0], 6);
    expect(centre('south', 'north')).toBeCloseTo(SNAPPED[1], 6);
    // The raw fix is nowhere: not in the URL, a request, or storage.
    const raw = ['34.78123', '32.08167', '34.7812', '32.0817'];
    for (const text of raw) {
      expect(currentPath()).not.toContain(text);
      for (const call of api.fetchMock.mock.calls) expect(call[0].url).not.toContain(text);
      expect(stored()).not.toContain(text);
    }

    // Outside (Haifa): no camera, the dot is gone, the status line says so.
    fireEvent.click(locate());
    answer(getCurrentPosition, 1).at(HAIFA);
    expect(cameras()).toHaveLength(1);
    expect(lastProps().userPosition).toBeUndefined();
    await vi.waitFor(() => {
      expect(status()).toHaveTextContent(he.search.map.locateOutside);
    });

    // Denied (code 1) and the others (3, a timeout): the plain messages; the map stays.
    fireEvent.click(locate());
    expect(status()).toHaveTextContent('');
    answer(getCurrentPosition, 2).fails(1);
    await vi.waitFor(() => {
      expect(status()).toHaveTextContent(he.search.map.locateDenied);
    });
    fireEvent.click(locate());
    answer(getCurrentPosition, 3).fails(3);
    await vi.waitFor(() => {
      expect(status()).toHaveTextContent(he.search.map.locateFailed);
    });
    // The same message again is emptied first, then filled, so it is announced again.
    fireEvent.click(locate());
    answer(getCurrentPosition, 4).fails(3);
    expect(status()).toHaveTextContent('');
    await vi.waitFor(() => {
      expect(status()).toHaveTextContent(he.search.map.locateFailed);
    });
    expect(cameras()).toHaveLength(1);
    // A map move empties it.
    moveTo([34.77, 32.07, 34.79, 32.09], { center: [34.78, 32.08], zoom: 15 });
    expect(status()).toHaveTextContent('');
    // Still one results region.
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    view.unmount();

    // Without geolocation the button is absent.
    Reflect.deleteProperty(navigator, 'geolocation');
    expect('geolocation' in navigator).toBe(false);
    resetFakeMap();
    render('/search?view=map');
    expect(screen.getByRole('region', { name: he.search.map.label })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: he.search.map.locate })).toBeNull();
  });
});
