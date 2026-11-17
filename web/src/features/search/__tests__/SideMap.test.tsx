import { act, fireEvent, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { Route, Routes, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cameras,
  failMap,
  lastProps,
  moveTo,
  resetFakeMap,
} from '../../../components/map/__tests__/fakeMapCanvas';
import { ISRAEL_BOUNDS } from '../../../components/map/config';
import he from '../../../locales/he.json';
import { currentPath, deferred, json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import type { ListingPublic } from '../api';
import { parseMapPosition } from '../mapPosition';
import { SearchPage } from '../SearchPage';
import { at, page, publicListing } from './fixtures';

vi.mock(
  '../../../components/map/MapCanvas',
  () => import('../../../components/map/__tests__/fakeMapCanvas'),
);

// Counts the filter form's renders: a hover must never re-render it (spec 0009x Scope 5).
const filtersForm = vi.hoisted(() => ({ renders: 0 }));
vi.mock('../FiltersForm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../FiltersForm')>();
  return {
    ...actual,
    FiltersForm: (props: ComponentProps<typeof actual.FiltersForm>) => {
      filtersForm.renders += 1;
      return <actual.FiltersForm {...props} />;
    },
  };
});

const SEARCH = 'GET /listings';
const ME = 'GET /me';
const unauthenticated = () => json({ detail: 'unauthenticated' }, 401);

/** `window.matchMedia` at 1280 px or wider: both `useIsDesktop` and `useIsWide` match. */
const stubWide = () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1024px)' || query === '(min-width: 1280px)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
};
/** A desktop below 1280 px: the list, no side map. */
const stubDesktop = () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1024px)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
};

const scrollIntoView = vi.fn();

beforeEach(() => {
  resetFakeMap();
  filtersForm.renders = 0;
  scrollIntoView.mockClear();
  // jsdom has no scrolling.
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/** The probe of 0003b AC3: one step back in the router's history. */
function Back() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      history-back
    </button>
  );
}

const render = (path: string) =>
  renderRoutes(
    path,
    <>
      <Routes>
        <Route path="/search" element={<SearchPage type="apartment" />} />
      </Routes>
      <Back />
    </>,
  );

/** Longer than the idle fallback (200 ms) the side map waits for. */
const pastIdle = () => new Promise((r) => setTimeout(r, 400));
const sideMap = () => screen.queryByRole('region', { name: he.search.sideMap.label });
const findSideMap = () =>
  screen.findByRole('region', { name: he.search.sideMap.label }, { timeout: 3000 });
const pins = () => lastProps().pins ?? [];
const pinIds = () => pins().map((pin) => pin.id);
const bubbles = () => lastProps().bubbles ?? [];
/** `count` listings with a point each, spread north to south. */
const located = (count: number, from = 0) =>
  Array.from({ length: count }, (_, i) =>
    publicListing({ lat: 32.0 + (from + i) * 0.005, lng: 34.8 }),
  );
/** The `<li>` of a listing's card in the list. */
const cardItem = (listing: ListingPublic) => {
  const link = document.querySelector(`a[href="/listings/${listing.id}"]`);
  const item = link?.closest('li');
  if (item == null) throw new Error(`no card for ${listing.id}`);
  return item;
};
const cardLink = (listing: ListingPublic) =>
  within(cardItem(listing)).getAllByRole('link')[0] as HTMLElement;
const pinButton = (id: string) => document.querySelector<HTMLElement>(`[data-pin-id="${id}"]`);

describe('SideMap', () => {
  it('ac1_mounts_only_wide_list_with_results', async () => {
    // 18 of 20 have a point; the first page of 40.
    const withPoint = located(18);
    const first = [...withPoint, publicListing(), publicListing()];
    stubWide();
    let api = mockApi({ [ME]: [unauthenticated()], [SEARCH]: [json(page(first, 40))] });
    let view = render('/search');
    expect(await screen.findAllByRole('article')).toHaveLength(20);
    // The list does not wait for it: it mounts once the browser is idle.
    expect(sideMap()).toBeNull();
    const region = await findSideMap();
    expect(region).toBeInTheDocument();
    expect(pinIds()).toEqual(withPoint.map((l) => l.id));
    expect(lastProps().keyboard).toBe(false);
    // No pin is a tab stop or exposed to assistive tech.
    for (const listing of withPoint) {
      const button = pinButton(listing.id);
      expect(button).toHaveAttribute('tabindex', '-1');
      expect(button).toHaveAttribute('aria-hidden', 'true');
    }
    // The "open" button sits above the map, outside its region.
    const open = screen.getByRole('button', { name: he.search.sideMap.open });
    expect(region.contains(open)).toBe(false);
    // The side map sends no search of its own.
    await pastIdle();
    expect(api.calls(SEARCH)).toHaveLength(1);
    view.unmount();
    vi.unstubAllGlobals();

    // Below 1280 px: never.
    stubDesktop();
    mockApi({ [ME]: [unauthenticated()], [SEARCH]: [json(page(first, 40))] });
    view = render('/search');
    await screen.findAllByRole('article');
    await pastIdle();
    expect(sideMap()).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // The map view: never (the full map only).
    stubWide();
    mockApi({ [ME]: [unauthenticated()], [SEARCH]: [json(page(first, 40))] });
    view = render('/search?view=map');
    expect(screen.getByRole('region', { name: he.search.map.label })).toBeInTheDocument();
    await pastIdle();
    expect(sideMap()).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // A first answer with nothing: it does not mount (the list's empty state is the message).
    stubWide();
    api = mockApi({ [ME]: [unauthenticated()], [SEARCH]: [json(page([], 0))] });
    view = render('/search');
    expect(await screen.findByText(he.search.empty)).toBeVisible();
    await pastIdle();
    expect(sideMap()).toBeNull();
    expect(screen.queryByRole('button', { name: he.search.sideMap.open })).toBeNull();
    view.unmount();
  });

  it('ac2_mirror_fits_on_first_pages_not_on_more', async () => {
    const first = located(20);
    const second = located(20, 20);
    const filtered = located(3, 50);
    const answer = deferred();
    stubWide();
    const api = mockApi({
      [ME]: [unauthenticated()],
      [SEARCH]: [json(page(first, 40)), json(page(second, 40)), answer.promise],
    });
    render('/search');
    const region = await findSideMap();
    // It opens on the whole country (spec 0021d), then fits the list's pins.
    expect(lastProps().bounds).toEqual(ISRAEL_BOUNDS);
    // The first page fits the map once, to its pins, never past zoom 15.
    expect(cameras()).toHaveLength(1);
    expect(at(cameras(), 0)).toMatchObject({
      bounds: [34.8, 32.0, 34.8, 32.0 + 19 * 0.005],
      maxZoom: 15,
    });

    // "Load more": the new cards' pins, and no refit.
    fireEvent.click(screen.getByRole('button', { name: he.search.more }));
    await vi.waitFor(() => {
      expect(pins()).toHaveLength(40);
    });
    expect(pinIds()).toEqual([...first, ...second].map((l) => l.id));
    expect(cameras()).toHaveLength(1);

    // A hovered card's highlight does not outlive its card.
    fireEvent.pointerEnter(cardItem(at(first, 0)));
    expect(lastProps().selectedId).toBe(at(first, 0).id);

    // A filter: the same side map, with no pins while the first page loads, nothing highlighted.
    const price = within(screen.getByRole('group', { name: he.search.price }));
    fireEvent.change(price.getByLabelText(he.search.to), { target: { value: '8000' } });
    fireEvent.click(screen.getByRole('button', { name: he.search.apply }));
    expect(currentPath()).toBe('/search?price_max=8000');
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(3);
    });
    expect(pins()).toHaveLength(0);
    expect(lastProps().selectedId).toBeUndefined();
    expect(sideMap()).toBe(region);
    expect(cameras()).toHaveLength(1);
    // Its answer: exactly one camera fitting the new results.
    answer.resolve(json(page(filtered, 3)));
    await vi.waitFor(() => {
      expect(pins()).toHaveLength(3);
    });
    expect(sideMap()).toBe(region);
    expect(cameras()).toHaveLength(2);
    expect(at(cameras(), 1)).toMatchObject({
      bounds: [34.8, 32.0 + 50 * 0.005, 34.8, 32.0 + 52 * 0.005],
      maxZoom: 15,
    });

    // A move of the side map changes neither the list's requests nor the URL.
    moveTo([34.7, 31.9, 34.9, 32.2], { center: [34.8, 32.05], zoom: 11 });
    await pastIdle();
    expect(api.calls(SEARCH)).toHaveLength(3);
    expect(currentPath()).toBe('/search?price_max=8000');
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(cameras()).toHaveLength(2);
  });

  it('ac3_hover_focus_and_press_sync', async () => {
    // A, B and D share one point (a bubble that never separates); C stands apart.
    const [a, b, d] = [0, 1, 2].map(() => publicListing({ lat: 32.08, lng: 34.8 }));
    const c = publicListing({ lat: 32.0, lng: 34.9 });
    if (a === undefined || b === undefined || d === undefined) throw new Error('no listings');
    stubWide();
    mockApi({ [ME]: [unauthenticated()], [SEARCH]: [json(page([a, b, c, d]))] });
    render('/search');
    await findSideMap();
    moveTo([34.7, 31.9, 34.95, 32.2], { center: [34.85, 32.04], zoom: 13 });
    const rendersBefore = filtersForm.renders;

    // A touch on a card is a tap, not a hover.
    fireEvent.pointerEnter(cardItem(a), { pointerType: 'touch' });
    expect(lastProps().selectedId).toBeUndefined();
    expect(cardItem(a)).not.toHaveAttribute('data-highlighted');

    // Hover A: its pin is selected and drawn alone, out of the bubble.
    fireEvent.pointerEnter(cardItem(a), { pointerType: 'mouse' });
    expect(lastProps().selectedId).toBe(a.id);
    expect(pinIds()).toContain(a.id);
    expect(bubbles().flatMap((bubble) => bubble.members.map((m) => m.id))).not.toContain(a.id);
    expect(cardItem(a)).toHaveAttribute('data-highlighted');
    expect(cardItem(b)).not.toHaveAttribute('data-highlighted');
    fireEvent.pointerLeave(cardItem(a));
    expect(lastProps().selectedId).toBeUndefined();

    // Focus B, then hover A: the pointer wins; leaving A falls back to the focused B.
    act(() => cardLink(b).focus());
    expect(lastProps().selectedId).toBe(b.id);
    expect(cardItem(b)).toHaveAttribute('data-highlighted');
    fireEvent.pointerEnter(cardItem(a));
    expect(lastProps().selectedId).toBe(a.id);
    expect(document.querySelectorAll('li[data-highlighted]')).toHaveLength(1);
    fireEvent.pointerLeave(cardItem(a));
    expect(lastProps().selectedId).toBe(b.id);
    // Focus leaves the card: nothing holds focus or the pointer, so it clears.
    act(() => cardLink(b).blur());
    expect(lastProps().selectedId).toBeUndefined();
    expect(document.querySelectorAll('li[data-highlighted]')).toHaveLength(0);

    // A hover re-renders the list and the side map, never the filter form.
    expect(filtersForm.renders).toBe(rendersBefore);

    // Pressing C's pin: its card scrolls into view and is highlighted; focus does not move into it.
    const pin = pinButton(c.id);
    if (pin === null) throw new Error('no pin for C');
    fireEvent.click(pin);
    expect(lastProps().selectedId).toBe(c.id);
    expect(cardItem(c)).toHaveAttribute('data-highlighted');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(cardItem(c));
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }));
    expect(cardItem(c).contains(document.activeElement)).toBe(false);

    // The bubble of A, B and D never separates: pressing it scrolls to and highlights its best member.
    const bubble = bubbles().find((candidate) => !candidate.separates);
    if (bubble === undefined) throw new Error('no same-place bubble');
    expect(bubble.members.map((m) => m.id).sort()).toEqual([a.id, b.id, d.id].sort());
    const best = at(bubble.members, 0);
    const bubbleButton = pinButton(bubble.id);
    if (bubbleButton === null) throw new Error('no bubble button');
    fireEvent.click(bubbleButton);
    expect(lastProps().selectedId).toBe(best.id);
    const bestListing = [a, b, d].find((listing) => listing.id === best.id);
    if (bestListing === undefined) throw new Error('no best listing');
    expect(cardItem(bestListing)).toHaveAttribute('data-highlighted');
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView.mock.contexts[1]).toBe(cardItem(bestListing));
    expect(cardItem(bestListing).contains(document.activeElement)).toBe(false);
    expect(filtersForm.renders).toBe(rendersBefore);
  });

  it('ac4_open_full_map_here', async () => {
    stubWide();
    mockApi({ [ME]: [unauthenticated()], [SEARCH]: [json(page(located(3)))] });
    render('/search?price_max=8000&pets=true');
    await findSideMap();
    moveTo([34.7, 32.0, 34.9, 32.16], { center: [34.8, 32.08], zoom: 13.2 });

    fireEvent.click(screen.getByRole('button', { name: he.search.sideMap.open }));
    const params = new URLSearchParams(currentPath()?.split('?')[1] ?? '');
    expect(params.get('view')).toBe('map');
    expect(params.get('price_max')).toBe('8000');
    expect(params.get('pets')).toBe('true');
    expect([...params.keys()].sort()).toEqual(['c', 'pets', 'price_max', 'view', 'z']);
    const position = parseMapPosition(params);
    expect(position.center).toEqual([34.8, 32.08]);
    expect(position.zoom).toBe(13.2);
    // The full map, with focus on the toggle's pressed "map" button (the one used is gone).
    expect(screen.getByRole('region', { name: he.search.map.label })).toBeInTheDocument();
    const mapButton = within(screen.getByRole('group', { name: he.search.view.label })).getByRole(
      'button',
      { name: he.search.view.map },
    );
    expect(mapButton).toHaveAttribute('aria-pressed', 'true');
    expect(mapButton).toHaveFocus();
    // A new history entry: Back returns to the list.
    fireEvent.click(screen.getByRole('button', { name: 'history-back' }));
    expect(currentPath()).toBe('/search?price_max=8000&pets=true');
  });

  it('ac5_unavailable_keeps_the_list', async () => {
    stubWide();
    mockApi({
      [ME]: [unauthenticated()],
      [SEARCH]: [json(page(located(20), 25)), json(page(located(5, 20), 25))],
    });
    render('/search');
    await findSideMap();
    failMap();
    expect(screen.getByText(he.search.sideMap.unavailable)).toBeVisible();
    expect(sideMap()).toBeNull();
    // The list still renders and pages.
    expect(screen.getAllByRole('article')).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: he.search.more }));
    await vi.waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(25);
    });
    expect(screen.getByText(he.search.sideMap.unavailable)).toBeVisible();
  });
});
