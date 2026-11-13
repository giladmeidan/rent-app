import { act, fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import { emptyStateBox } from '../../../components/EmptyState';
import {
  failMap,
  lastProps,
  lastZoomedTo,
  moveTo,
  resetFakeMap,
} from '../../../components/map/__tests__/fakeMapCanvas';
import he from '../../../locales/he.json';
import {
  currentPath,
  deferred,
  json,
  mockApi,
  noa,
  renderRoutes,
} from '../../auth/__tests__/harness';
import { application } from '../../applications/__tests__/fixtures';
import { owner } from '../../listings/__tests__/fixtures';
import { formatIls, formatRooms } from '../../listings/format';
import { inDays, profile } from '../../profile/__tests__/fixtures';
import type { ListingPublic } from '../api';
import { SearchPage } from '../SearchPage';
import { at, expected, listings, page, publicListing, query } from './fixtures';

vi.mock(
  '../../../components/map/MapCanvas',
  () => import('../../../components/map/__tests__/fakeMapCanvas'),
);

beforeEach(() => {
  resetFakeMap();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const SEARCH = 'GET /listings';
const PRICE = /7,200[\s‎‏]*₪/;
const BOX: [number, number, number, number] = [34.7712345, 32.0412345, 34.8298765, 32.1098765];
const OTHER_BOX: [number, number, number, number] = [34.78, 32.05, 34.81, 32.08];

/** The `i`th `GET /listings` request. */
const sent = (api: ReturnType<typeof mockApi>, i: number) => at(api.calls(SEARCH), i).request;

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
        <Route path="/search" element={<SearchPage />} />
        <Route path="/listings/:id" element={<p>listing</p>} />
      </Routes>
      <Back />
    </>,
  );

const settle = () => new Promise((r) => setTimeout(r, 20));
const toggle = () => within(screen.getByRole('group', { name: he.search.view.label }));
const mapRegion = () => screen.getByRole('region', { name: he.search.map.label });
const liveRegion = () => document.querySelector('[aria-live="polite"]');
const pinLabel = (listing: ListingPublic) =>
  i18n.t('search.map.pin', {
    title: i18n.t('listings.card.title', {
      count: listing.rooms,
      rooms: formatRooms(listing.rooms),
      street: listing.street,
      city: listing.city,
    }),
    price: formatIls(listing.price_ils),
  });
const pins = () => lastProps().pins ?? [];
const pinIds = () => pins().map((pin) => pin.id);
const located = (overrides: Partial<ListingPublic> = {}) =>
  publicListing({ lat: 32.08, lng: 34.8, ...overrides });

describe('SearchMap', () => {
  it('ac1_view_toggle_lives_in_the_url', async () => {
    // The list is the default: "list" is pressed and the cards render.
    mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    let view = render('/search');
    expect(await screen.findByRole('article')).toBeVisible();
    expect(toggle().getByRole('button', { name: he.search.view.list })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(toggle().getByRole('button', { name: he.search.view.map })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // "Map": in the URL, the map region instead of the list; view is not a filter.
    fireEvent.click(toggle().getByRole('button', { name: he.search.view.map }));
    expect(currentPath()).toBe('/search?view=map');
    expect(mapRegion()).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull();
    expect(toggle().getByRole('button', { name: he.search.view.map })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: he.search.filters })).toBeVisible();
    view.unmount();
    vi.unstubAllGlobals();

    // Apply, clear and back keep the view.
    mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    view = render('/search?view=map&pets=true');
    expect(mapRegion()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^מסננים/ }));
    const price = within(screen.getByRole('group', { name: he.search.price }));
    fireEvent.change(price.getByLabelText(he.search.to), { target: { value: '8000' } });
    fireEvent.click(screen.getByRole('button', { name: he.search.apply }));
    expect(currentPath()).toBe('/search?price_max=8000&pets=true&view=map');
    fireEvent.click(screen.getByRole('button', { name: he.search.clear }));
    expect(currentPath()).toBe('/search?view=map');
    expect(mapRegion()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'history-back' }));
    expect(currentPath()).toBe('/search?price_max=8000&pets=true&view=map');
    expect(mapRegion()).toBeInTheDocument();

    // "List": view is gone and the list renders.
    fireEvent.click(toggle().getByRole('button', { name: he.search.view.list }));
    expect(currentPath()).toBe('/search?price_max=8000&pets=true');
    expect(screen.queryByRole('region', { name: he.search.map.label })).toBeNull();
    expect(await screen.findByRole('article')).toBeVisible();
  });

  it('ac3_map_searches_the_visible_box', async () => {
    const cheap = located({ price_ils: 7200 });
    const other = located({ price_ils: 5000 });
    const nowhere = publicListing({ lat: null, lng: null });
    const next = deferred();
    const api = mockApi({ [SEARCH]: [json(page([cheap, nowhere, other])), next.promise] });
    render('/search?view=map&price_max=8000');

    // Nothing is sent before the map reports a box: not the list, not the map.
    expect(mapRegion()).toBeInTheDocument();
    await settle();
    expect(api.calls(SEARCH)).toHaveLength(0);

    // The box, rounded, with the filters; no `view`.
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(1);
    });
    expect(query(sent(api, 0))).toEqual(
      expected({
        price_max: '8000',
        west: '34.7712',
        south: '32.0412',
        east: '34.8299',
        north: '32.1099',
        limit: '50',
        offset: '0',
      }),
    );

    // One pin per listing with a point, named by title and price.
    await vi.waitFor(() => {
      expect(pins()).toHaveLength(2);
    });
    expect(pinIds()).toEqual([cheap.id, other.id]);
    const [first, second] = pins();
    expect(first?.label).toBe(pinLabel(cheap));
    expect(second?.label).toBe(pinLabel(other));
    expect(first?.text).toMatch(PRICE);
    expect(first).toMatchObject({ lat: 32.08, lng: 34.8 });
    expect(screen.getByRole('button', { name: pinLabel(cheap) })).toHaveTextContent(PRICE);

    // Another box: its pins replace the old ones only when its answer lands.
    moveTo(OTHER_BOX);
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(2);
    });
    expect(query(sent(api, 1))).toEqual(
      expected({
        price_max: '8000',
        west: '34.78',
        south: '32.05',
        east: '34.81',
        north: '32.08',
        limit: '50',
        offset: '0',
      }),
    );
    await settle();
    expect(pinIds()).toEqual([cheap.id, other.id]);
    const fresh = [located(), located()];
    next.resolve(json(page(fresh)));
    await vi.waitFor(() => {
      expect(pinIds()).toEqual(fresh.map((l) => l.id));
    });
    expect(api.calls(SEARCH)).toHaveLength(2);
  });

  it('ac4_map_result_states', async () => {
    // Pending first answer: the region is busy; the count line is mounted and empty.
    const first = deferred();
    let api = mockApi({ [SEARCH]: [first.promise] });
    let view = render('/search?view=map');
    expect(mapRegion()).toHaveAttribute('aria-busy', 'true');
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(1);
    });
    expect(mapRegion()).toHaveAttribute('aria-busy', 'true');
    expect(liveRegion()).toHaveTextContent('');
    first.resolve(json(page([located()])));
    await vi.waitFor(() => {
      expect(mapRegion()).toHaveAttribute('aria-busy', 'false');
    });
    expect(liveRegion()).toHaveTextContent(i18n.t('search.count', { count: 1 }));
    view.unmount();
    vi.unstubAllGlobals();

    // Failure: ErrorState above the map; retry asks for the same box.
    api = mockApi({ [SEARCH]: [json({ detail: 'boom' }, 500), json(page([located()]))] });
    view = render('/search?view=map');
    moveTo(BOX);
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(2);
    });
    expect(query(sent(api, 1))).toEqual(query(sent(api, 0)));
    expect(await screen.findByText(i18n.t('search.count', { count: 1 }))).toBeVisible();
    expect(mapRegion()).toBeInTheDocument();
    view.unmount();
    vi.unstubAllGlobals();

    // Empty: the count line holds the map's empty state (spec 0009t).
    mockApi({ [SEARCH]: [json({ items: [], total: 0 })] });
    view = render('/search?view=map');
    moveTo(BOX);
    expect(await screen.findByText(he.search.map.empty)).toBeVisible();
    expect(liveRegion()).toHaveTextContent(he.search.map.empty);
    view.unmount();
    vi.unstubAllGlobals();

    // Three of three: the plain count in the live line.
    mockApi({ [SEARCH]: [json(page([located(), located(), located()], 3))] });
    view = render('/search?view=map');
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(liveRegion()).toHaveTextContent('3 מודעות');
    });
    view.unmount();
    vi.unstubAllGlobals();

    // 50 of 120: "showing 50 of 120".
    mockApi({ [SEARCH]: [json(page(listings(50), 120))] });
    view = render('/search?view=map');
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(liveRegion()).toHaveTextContent(
        i18n.t('search.map.tooMany', { shown: 50, total: 120 }),
      );
    });
    expect(liveRegion()?.textContent).toContain('50');
    expect(liveRegion()?.textContent).toContain('120');
    view.unmount();
    vi.unstubAllGlobals();

    // The map cannot be shown: the message and a way to the list.
    mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    render('/search?view=map');
    failMap();
    expect(screen.getByText(he.search.map.unavailable)).toBeVisible();
    expect(screen.queryByRole('region', { name: he.search.map.label })).toBeNull();
    fireEvent.click(
      within(screen.getByTestId('map-unavailable')).getByRole('button', {
        name: he.search.view.list,
      }),
    );
    expect(currentPath()).toBe('/search');
    expect(await screen.findByRole('article')).toBeVisible();
  });

  it('ac5_pin_opens_the_listing_card', async () => {
    const a = located({ street: 'אחד' });
    const b = located({ street: 'שתיים' });
    const c = located({ street: 'שלוש' });
    mockApi({ [SEARCH]: [json(page([a, b])), json(page([c]))] });
    render('/search?view=map');
    moveTo(BOX);
    const pinA = await screen.findByRole('button', { name: pinLabel(a) });
    expect(screen.queryByRole('article')).toBeNull();

    // The first pin: selected, its card under the map, focus on the card's title link.
    fireEvent.click(pinA);
    expect(lastProps().selectedId).toBe(a.id);
    expect(pinA).toHaveAttribute('aria-pressed', 'true');
    let card = screen.getByRole('article');
    let link = within(card).getByRole('link');
    expect(link).toHaveTextContent(a.street);
    expect(link).toHaveAttribute('href', `/listings/${a.id}`);
    expect(link).toHaveFocus();

    // The second pin replaces the card.
    fireEvent.click(screen.getByRole('button', { name: pinLabel(b) }));
    expect(lastProps().selectedId).toBe(b.id);
    expect(screen.getByRole('button', { name: pinLabel(a) })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getAllByRole('article')).toHaveLength(1);
    card = screen.getByRole('article');
    link = within(card).getByRole('link');
    expect(link).toHaveTextContent(b.street);
    expect(link).toHaveAttribute('href', `/listings/${b.id}`);
    expect(link).toHaveFocus();

    // A new answer without the selected listing: no card.
    moveTo(OTHER_BOX);
    await screen.findByRole('button', { name: pinLabel(c) });
    expect(screen.queryByRole('article')).toBeNull();
    expect(lastProps().selectedId).toBeUndefined();
  });

  it('ac6_pins_show_match', async () => {
    const scored = located({
      price_ils: 7200,
      available_from: inDays(90),
      match: { score: 87, agrees: ['budget', 'area', 'household'], differs: 'move_in' },
    });
    const unscored = located({ price_ils: 5000, match: null });
    const api = mockApi({
      'GET /me': [json(noa)],
      'GET /me/profile': [json(profile())],
      [SEARCH]: [json(page([scored, unscored], 2, 'match'))],
    });
    render('/search?view=map');
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(pins()).toHaveLength(2);
    });
    await vi.waitFor(() => {
      expect(api.calls('GET /me/profile')).toHaveLength(1);
    });
    await settle();

    // The scored pin: price and score; its name ends with the score.
    const [first, second] = pins();
    expect(first?.text).toBe('7,200 ₪ · 87%');
    expect(first?.label).toBe(`${pinLabel(scored)}, התאמה 87%`);
    expect(first?.label.endsWith(', התאמה 87%')).toBe(true);
    // `match: null` keeps today's pin.
    expect(second?.text).toBe(`${formatIls(5000)} ${he.listings.units.ils}`);
    expect(second?.label).toBe(pinLabel(unscored));
    // The map's count line never says how it is sorted.
    expect(liveRegion()?.textContent).toBe('2 מודעות');
    expect(liveRegion()).not.toHaveTextContent('לפי התאמה');

    // The selected pin's card has the badge and the chips.
    fireEvent.click(screen.getByRole('button', { name: `${pinLabel(scored)}, התאמה 87%` }));
    const card = screen.getByRole('article');
    expect(within(card).getByText('התאמה 87%')).toBeVisible();
    expect(
      within(within(card).getByTestId('match-chips'))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['בתקציב', 'כניסה מאוחרת מדי']);

    // The unscored one's card has neither.
    fireEvent.click(screen.getByRole('button', { name: pinLabel(unscored) }));
    const plain = screen.getByRole('article');
    expect(within(plain).queryByText(/התאמה/)).toBeNull();
    expect(within(plain).queryByTestId('match-chips')).toBeNull();
  });

  it('ac3_map_sends_type', async () => {
    const api = mockApi({ [SEARCH]: [json(page([located({ listing_type: 'room' })]))] });
    render('/search?listing_type=room&view=map');
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(1);
    });
    expect(query(sent(api, 0))).toEqual(
      expected({
        listing_type: 'room',
        west: '34.7712',
        south: '32.0412',
        east: '34.8299',
        north: '32.1099',
        limit: '50',
        offset: '0',
      }),
    );
  });

  it('ac4_room_pin_label', async () => {
    const room = located({
      listing_type: 'room',
      rooms: 3,
      street: 'הרצל',
      city: 'תל אביב',
      price_ils: 7200,
    });
    const flat = located({ price_ils: 5000 });
    mockApi({ [SEARCH]: [json(page([room, flat]))] });
    render('/search?view=map');
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(pins()).toHaveLength(2);
    });
    const [first, second] = pins();
    // The room's pin is named by the room title; its text is the plain price.
    expect(first?.label).toBe(
      i18n.t('search.map.pin', {
        title: 'חדר ב\u05be3 חדרים, רחוב הרצל, תל אביב',
        price: formatIls(room.price_ils),
      }),
    );
    expect(first?.text).toMatch(PRICE);
    expect(second?.label).toBe(pinLabel(flat));
  });

  it('ac5_similar_age_chip_on_the_pin_card', async () => {
    const year = new Date().getUTCFullYear();
    const room = located({ listing_type: 'room', flatmates_count: 2, flatmate_ages: [27, 30] });
    const api = mockApi({
      'GET /me': [json(noa)],
      'GET /me/profile': [json(profile({ gender: 'woman', birth_year: year - 28 }))],
      [SEARCH]: [json(page([room]))],
    });
    render('/search?view=map');
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(pins()).toHaveLength(1);
    });
    await vi.waitFor(() => {
      expect(api.calls('GET /me/profile')).toHaveLength(1);
    });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /^חדר ב/ }));
    const card = screen.getByRole('article');
    expect(
      within(within(card).getByTestId('listing-chips'))
        .getAllByRole('listitem')
        .map((li) => li.textContent)[0],
    ).toBe(he.rooms.card.similarAge);
  });

  it('ac5_states_above_map_and_updating_pill', async () => {
    /** Whether `a` comes before `b` in the document. */
    const before = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

    // Empty: the one live count line, above the map, holds the empty text in the empty box.
    mockApi({ [SEARCH]: [json({ items: [], total: 0 })] });
    let view = render('/search?view=map');
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(liveRegion()).toHaveTextContent(he.search.map.empty);
    });
    const line = liveRegion();
    if (line === null) throw new Error('no count line');
    expect(line.tagName).toBe('P');
    expect(line).toHaveClass(...emptyStateBox.split(' '));
    expect(screen.getAllByText(he.search.map.empty)).toEqual([line]);
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(before(line, mapRegion())).toBe(true);
    view.unmount();
    vi.unstubAllGlobals();

    // A count is not in the empty box.
    mockApi({ [SEARCH]: [json(page([located()]))] });
    view = render('/search?view=map');
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(liveRegion()).toHaveTextContent(i18n.t('search.count', { count: 1 }));
    });
    expect(liveRegion()).not.toHaveClass('border');
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    view.unmount();
    vi.unstubAllGlobals();

    // Error: ErrorState comes before the map region.
    mockApi({ [SEARCH]: [json({ detail: 'boom' }, 500)] });
    view = render('/search?view=map');
    moveTo(BOX);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(he.common.error)).toBeVisible();
    expect(before(alert, mapRegion())).toBe(true);
    view.unmount();
    vi.unstubAllGlobals();

    // Updating: the pill shows through the `overlay` prop while the first answer and a moved box's
    // answer (placeholder data) are pending, and is gone when each lands.
    const first = deferred();
    const next = deferred();
    mockApi({ [SEARCH]: [first.promise, next.promise] });
    render('/search?view=map');
    moveTo(BOX);
    const pill = await screen.findByTestId('map-updating');
    expect(pill).toHaveTextContent(he.search.map.updating);
    expect(pill).toHaveAttribute('aria-hidden', 'true');
    expect(lastProps().overlay).toBeTruthy();
    first.resolve(json(page([located()])));
    await vi.waitFor(() => {
      expect(screen.queryByTestId('map-updating')).toBeNull();
    });
    moveTo(OTHER_BOX);
    expect(await screen.findByTestId('map-updating')).toHaveTextContent(he.search.map.updating);
    // Meanwhile the count line keeps the previous count.
    expect(liveRegion()).toHaveTextContent(i18n.t('search.count', { count: 1 }));
    await act(async () => {
      next.resolve(json(page([located(), located()])));
      await settle();
    });
    expect(screen.queryByTestId('map-updating')).toBeNull();
    expect(liveRegion()).toHaveTextContent(i18n.t('search.count', { count: 2 }));
  });

  it('ac3_focus_after_show_list', async () => {
    // The map cannot be shown: "show the list" removes its own button, so focus moves to the
    // toggle's list button, now pressed.
    mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    render('/search?view=map');
    failMap();
    const show = within(screen.getByTestId('map-unavailable')).getByRole('button', {
      name: he.search.view.list,
    });
    act(() => show.focus());
    fireEvent.click(show);
    expect(currentPath()).toBe('/search');
    const list = toggle().getByRole('button', { name: he.search.view.list });
    await vi.waitFor(() => {
      expect(list).toHaveFocus();
    });
    expect(list).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('map-unavailable')).toBeNull();
  });

  it('ac3_focus_after_apply_in_map_view', async () => {
    // In map view, an Apply that changes the URL focuses the map's count line, which keeps the
    // previous count until the new answer lands.
    mockApi({ [SEARCH]: [json(page([located()])), json(page([located(), located()]))] });
    render('/search?view=map');
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(liveRegion()).toHaveTextContent(i18n.t('search.count', { count: 1 }));
    });
    fireEvent.click(screen.getByRole('button', { name: /^מסננים/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: he.search.feature.pets }));
    const apply = screen.getByRole('button', { name: he.search.apply });
    act(() => apply.focus());
    fireEvent.click(apply);
    expect(currentPath()).toBe('/search?pets=true&view=map');
    await vi.waitFor(() => {
      expect(liveRegion()).toHaveFocus();
    });
    await vi.waitFor(() => {
      expect(liveRegion()).toHaveTextContent(i18n.t('search.count', { count: 2 }));
    });
  });

  it('ac6_bubbles_zoom_or_list', async () => {
    const VIEW = { center: [34.8, 32.08] as [number, number], zoom: 8 };
    const bubbles = () => lastProps().bubbles ?? [];

    // Three results about 300 m apart, at zoom 8: one bubble of 3 with its plural name.
    const a = located({ lat: 32.08, street: 'אחד' });
    const b = located({ lat: 32.083, street: 'שתיים' });
    const c = located({ lat: 32.086, street: 'שלוש' });
    mockApi({ [SEARCH]: [json(page([a, b, c]))] });
    let view = render('/search?view=map');
    moveTo(BOX, VIEW);
    await vi.waitFor(() => {
      expect(bubbles()).toHaveLength(1);
    });
    expect(pins()).toEqual([]);
    const label = i18n.t('search.map.bubble', { count: 3 });
    expect(label).toBe('3 מודעות קרובות, לחיצה מקרבת את המפה');
    expect(bubbles()[0]).toMatchObject({ count: 3, label, separates: true });
    const bubble = screen.getByRole('button', { name: label });
    expect(bubble).toHaveTextContent('3');
    expect(bubble).not.toHaveAttribute('aria-pressed');

    // They separate at max zoom: pressing zooms to them, no card opens.
    fireEvent.click(bubble);
    expect(lastZoomedTo()).toEqual([a.id, b.id, c.id]);
    expect(screen.queryByRole('article')).toBeNull();
    expect(
      screen.queryByRole('heading', { name: i18n.t('search.map.samePlace', { count: 3 }) }),
    ).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();
    resetFakeMap();

    // Three results at one point (never separating) and one elsewhere.
    const x = located({ street: 'אלף' });
    const y = located({ street: 'בית' });
    const z = located({ street: 'גימל' });
    const away = located({ lat: 32.5, lng: 35.2, street: 'רחוק' });
    const next = deferred();
    mockApi({ [SEARCH]: [json(page([x, y, z, away])), next.promise] });
    view = render('/search?view=map');
    moveTo(BOX, VIEW);
    const samePlace = i18n.t('search.map.bubbleSamePlace', { count: 3 });
    const sameBubble = await screen.findByRole('button', { name: samePlace });
    expect(pinIds()).toEqual([away.id]);

    // A selected pin first; opening the list clears it.
    fireEvent.click(screen.getByRole('button', { name: pinLabel(away) }));
    expect(lastProps().selectedId).toBe(away.id);
    fireEvent.click(sameBubble);
    expect(lastProps().selectedId).toBeUndefined();
    const heading = screen.getByRole('heading', {
      name: i18n.t('search.map.samePlace', { count: 3 }),
    });
    expect(heading.tagName).toBe('H2');
    expect(heading).toHaveTextContent('3 מודעות בנקודה הזו');
    const section = screen.getByRole('region', { name: heading.textContent ?? '' });
    const cards = within(section).getAllByRole('article');
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => within(card).getByRole('link').getAttribute('href'))).toEqual(
      [x, y, z].map((l) => `/listings/${l.id}`),
    );
    expect(within(cards[0] as HTMLElement).getByRole('link')).toHaveFocus();
    // No pin stays pressed without its card.
    for (const button of screen.getAllByRole('button', { pressed: true })) {
      expect(button.dataset['pinId']).toBeUndefined();
    }
    expect(screen.getByRole('button', { name: pinLabel(away) })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    const listHeading = () =>
      screen.queryByRole('heading', { name: i18n.t('search.map.samePlace', { count: 3 }) });
    // A pin press replaces the list with its one card.
    fireEvent.click(screen.getByRole('button', { name: pinLabel(away) }));
    expect(listHeading()).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(1);

    // Opened again; a zoom in and back out removes it for good.
    fireEvent.click(screen.getByRole('button', { name: samePlace }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
    moveTo(BOX, { ...VIEW, zoom: 9 });
    expect(listHeading()).toBeNull();
    moveTo(BOX, VIEW);
    expect(listHeading()).toBeNull();
    expect(screen.queryByRole('article')).toBeNull();

    // Opened again; the members leaving the results remove the list.
    fireEvent.click(await screen.findByRole('button', { name: samePlace }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
    moveTo(OTHER_BOX, VIEW);
    next.resolve(json(page([away])));
    await vi.waitFor(() => {
      expect(listHeading()).toBeNull();
    });
    expect(screen.queryByRole('article')).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();
    resetFakeMap();

    // The fake reporting no view (`moveTo(bbox)`): pins unclustered, no bubble.
    mockApi({ [SEARCH]: [json(page([x, y, z]))] });
    render('/search?view=map');
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(pins()).toHaveLength(3);
    });
    expect(bubbles()).toEqual([]);
  });

  it('ac7_seeker_marks_only', async () => {
    const room = located({ listing_type: 'room' });
    const flat = located();
    const plain = located();
    const declined = located();
    const mark = (l: ListingPublic) =>
      document.querySelector(`[data-pin-id="${l.id}"]`)?.getAttribute('data-mark') ?? null;
    // Replies are built per request: a Response body is read once.
    const likes = () =>
      json({
        liked_me: [],
        mine: [{ listing: room, liked_at: '2026-11-10T10:00:00Z' }],
      });
    const applications = () =>
      json([
        application({ listing: { ...application().listing, id: flat.id } }),
        application({ status: 'declined', listing: { ...application().listing, id: declined.id } }),
      ]);

    // A signed-in seeker: likes and applications are each asked once; the marks join by id.
    let api = mockApi({
      'GET /me': [json(noa)],
      'GET /me/profile': [json(profile())],
      'GET /me/likes': [likes],
      'GET /me/applications': [applications],
      [SEARCH]: [json(page([room, flat, plain, declined]))],
    });
    let view = render('/search?view=map');
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(mark(room)).toBe('liked');
    });
    await vi.waitFor(() => {
      expect(mark(flat)).toBe('applied');
    });
    expect(mark(plain)).toBeNull();
    expect(mark(declined)).toBeNull();
    await settle();
    expect(api.calls('GET /me/likes')).toHaveLength(1);
    expect(api.calls('GET /me/applications')).toHaveLength(1);
    view.unmount();
    vi.unstubAllGlobals();

    // A visitor and an owner: neither request, no marks.
    for (const me of [json({ detail: 'unauthenticated' }, 401), json(owner)]) {
      api = mockApi({
        'GET /me': [me],
        'GET /me/likes': [likes],
        'GET /me/applications': [applications],
        [SEARCH]: [json(page([room, flat, plain]))],
      });
      view = render('/search?view=map');
      moveTo(BOX);
      await vi.waitFor(() => {
        expect(pins()).toHaveLength(3);
      });
      await vi.waitFor(() => {
        expect(api.calls('GET /me')).toHaveLength(1);
      });
      await settle();
      expect(api.calls('GET /me/likes')).toHaveLength(0);
      expect(api.calls('GET /me/applications')).toHaveLength(0);
      expect(pins().map((p) => p.mark)).toEqual([null, null, null]);
      expect(document.querySelectorAll('[data-mark]')).toHaveLength(0);
      view.unmount();
      vi.unstubAllGlobals();
    }

    // GET /me/likes failing with 500: the pins render without the liked mark.
    api = mockApi({
      'GET /me': [json(noa)],
      'GET /me/profile': [json(profile())],
      'GET /me/likes': [json({ detail: 'boom' }, 500)],
      'GET /me/applications': [applications],
      [SEARCH]: [json(page([room, flat, plain]))],
    });
    render('/search?view=map');
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(mark(flat)).toBe('applied');
    });
    await vi.waitFor(() => {
      expect(api.calls('GET /me/likes')).toHaveLength(1);
    });
    await settle();
    expect(mark(room)).toBeNull();
    expect(pins()).toHaveLength(3);
  });

  it('seen_pins_from_this_device', async () => {
    // A listing opened on this device draws its pin as seen.
    const opened = located();
    const fresh = located();
    window.localStorage.setItem('rent-app:seen', JSON.stringify([opened.id]));
    mockApi({ [SEARCH]: [json(page([opened, fresh]))] });
    render('/search?view=map');
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(pins()).toHaveLength(2);
    });
    expect(pins().map((p) => p.seen)).toEqual([true, false]);
    expect(pins()[0]?.label).toBe(`${pinLabel(opened)}${he.search.map.pinSeen}`);
  });
});
