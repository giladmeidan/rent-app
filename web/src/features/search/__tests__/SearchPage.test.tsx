import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as renderUi, screen, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import { lastProps, moveTo, resetFakeMap } from '../../../components/map/__tests__/fakeMapCanvas';
import he from '../../../locales/he.json';
import {
  currentPath,
  deferred,
  json,
  mockApi as mockRoutes,
  noa,
  renderRoutes,
  testQueryClient,
} from '../../auth/__tests__/harness';
import type { AreaOut } from '../../../api/client';
import { gushDan, owner } from '../../listings/__tests__/fixtures';
import { formatDate } from '../../listings/format';
import { inDays, profile } from '../../profile/__tests__/fixtures';
import { capture } from '../../../app/analytics';
import { SearchPage } from '../SearchPage';
import { at, expected, listings, page, publicListing, query } from './fixtures';

// No `importOriginal`: analytics → routePattern → routes → this page would load the real module.
vi.mock('../../../app/analytics', () => ({ capture: vi.fn() }));

vi.mock(
  '../../../components/map/MapCanvas',
  () => import('../../../components/map/__tests__/fakeMapCanvas'),
);

beforeEach(() => {
  resetFakeMap();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** `window.matchMedia` as a desktop browser answers it (`useIsDesktop`: `(min-width: 1024px)`). */
const stubDesktop = () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1024px)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
};
const mascots = () => document.querySelectorAll('img[src*="homie-turtle"]');

const SEARCH = 'GET /listings';
const AREAS = 'GET /areas';
const ME = 'GET /me';
const PROFILE = 'GET /me/profile';
const haifa: AreaOut = {
  ...gushDan,
  id: '00000000-0000-0000-0000-00000000a2a2',
  slug: 's-4000',
  name_he: 'חיפה',
  centre: [34.9896, 32.794],
};
const florentin: AreaOut = {
  ...gushDan,
  id: '00000000-0000-0000-0000-00000000a3a3',
  slug: 'n-florentin',
  name_he: 'פלורנטין',
  kind: 'neighbourhood',
  parent_id: gushDan.id,
  centre: [34.7686, 32.0578],
};
const CATALOGUE = [gushDan, haifa, florentin];
const FLORENTIN_LABEL = i18n.t('areas.neighbourhoodOf', {
  neighbourhood: florentin.name_he,
  city: gushDan.name_he,
});
/** The harness's mock, with the area catalogue every filter form asks for. */
const mockApi = (routes: Parameters<typeof mockRoutes>[0]) =>
  mockRoutes({ [AREAS]: [() => json(CATALOGUE)], ...routes });
const unauthenticated = () => json({ detail: 'unauthenticated' }, 401);
const noProfile = () => json({ detail: 'seeker_profile_not_found' }, 404);

/** The `i`th `GET /listings` request. */
const sent = (api: ReturnType<typeof mockApi>, i: number) => at(api.calls(SEARCH), i).request;

/** The probe of AC3: one step back in the router's history. */
function Back() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      history-back
    </button>
  );
}

const render = (path: string, client = testQueryClient()) =>
  renderRoutes(
    path,
    <>
      <Routes>
        <Route path="/search" element={<SearchPage type="apartment" />} />
        <Route path="/market" element={<SearchPage type="room" />} />
        <Route path="/listings/:id" element={<p>listing</p>} />
      </Routes>
      <Back />
    </>,
    client,
  );

const openPanel = () => {
  fireEvent.click(screen.getByRole('button', { name: /^מסננים/ }));
};
const group = (name: string) => within(screen.getByRole('group', { name }));
const priceFrom = () => group(he.search.price).getByLabelText(he.search.from);
const priceTo = () => group(he.search.price).getByLabelText(he.search.to);
const roomChip = (name: string) =>
  group(he.search.rooms).getByRole<HTMLInputElement>('checkbox', { name });
const roomChipsChecked = () =>
  group(he.search.rooms)
    .getAllByRole<HTMLInputElement>('checkbox')
    .filter((chip) => chip.checked)
    .map((chip) => chip.labels?.[0]?.textContent);
const sheet = () => screen.getByRole('dialog', { name: he.search.filters });
const expectSheetClosed = () => {
  expect(screen.queryByRole('dialog')).toBeNull();
};
const clearInSheet = () => {
  fireEvent.click(within(sheet()).getByRole('button', { name: he.search.clear }));
};
const feature = (name: string) => screen.getByRole('checkbox', { name });
const apply = () => {
  fireEvent.click(screen.getByRole('button', { name: he.search.apply }));
};
const liveRegion = () => document.querySelector('[aria-live="polite"]');
const settle = () => new Promise((r) => setTimeout(r, 20));
/** The current URL's query. */
const params = () => new URLSearchParams(currentPath()?.split('?')[1] ?? '');
const viewToggle = () => within(screen.getByRole('group', { name: he.search.view.label }));
const BOX: [number, number, number, number] = [34.7712345, 32.0412345, 34.8298765, 32.1098765];

describe('SearchPage', () => {
  it('ac2_url_is_the_filter_state', async () => {
    // Valid filters: sent as they are, counted (sort is not a filter), shown in the form.
    let api = mockApi({ [SEARCH]: [json(page([], 0, 'price_asc'))] });
    let view = render('/search?price_max=8000&rooms_min=3&pets=true&sort=price_asc');
    expect(await screen.findByText(he.search.empty)).toBeVisible();
    await settle();
    expect(api.calls(SEARCH)).toHaveLength(1);
    expect(query(sent(api, 0))).toEqual(
      expected({
        listing_type: 'apartment',
        price_max: '8000',
        rooms_min: '3',
        pets: 'true',
        sort: 'price_asc',
        limit: '20',
        offset: '0',
      }),
    );
    const button = screen.getByRole('button', {
      name: i18n.t('search.filtersActive', { count: 3 }),
    });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expectSheetClosed();
    fireEvent.click(button);
    expect(sheet()).toBeVisible();
    expect(priceFrom()).toHaveValue('');
    expect(priceTo()).toHaveValue('8000');
    expect(roomChipsChecked()).toEqual(['3', '4', he.search.roomsFivePlus]);
    expect(feature(he.search.feature.pets)).toBeChecked();
    expect(feature(he.search.feature.furnished)).not.toBeChecked();
    expect(screen.getByLabelText(he.search.sort.label)).toHaveValue('price_asc');
    view.unmount();
    vi.unstubAllGlobals();

    // Invalid values: dropped, so only paging is sent and nothing counts.
    api = mockApi({ [SEARCH]: [json(page([]))] });
    view = render(
      '/search?price_max=abc&rooms_min=2.3&pets=maybe&sort=foo&available_by=2027-02-30&colour=red',
    );
    expect(await screen.findByText(he.search.empty)).toBeVisible();
    await settle();
    expect(api.calls(SEARCH)).toHaveLength(1);
    expect(query(sent(api, 0))).toEqual(
      expected({ listing_type: 'apartment', limit: '20', offset: '0' }),
    );
    expect(screen.getByRole('button', { name: he.search.filters })).toBeVisible();
    expect(screen.getByLabelText(he.search.sort.label)).toHaveValue('newest');
    view.unmount();
    vi.unstubAllGlobals();

    // A min above its max: the max is dropped.
    api = mockApi({ [SEARCH]: [json(page([]))] });
    render('/search?price_min=9000&price_max=8000');
    expect(await screen.findByText(he.search.empty)).toBeVisible();
    expect(api.calls(SEARCH)).toHaveLength(1);
    expect(query(sent(api, 0))).toEqual(
      expected({ listing_type: 'apartment', price_min: '9000', limit: '20', offset: '0' }),
    );
    expect(
      screen.getByRole('button', { name: i18n.t('search.filtersActive', { count: 1 }) }),
    ).toBeVisible();
  });

  it('ac3_filter_date_read_back', async () => {
    mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    render('/search');
    await screen.findByText(i18n.t('search.count', { count: 1 }));
    openPanel();
    const input = screen.getByLabelText(he.search.availableBy);
    const ids = () => (input.getAttribute('aria-describedby') ?? '').split(' ');
    const hintId = screen.getByText(he.search.availableByHint).id;
    expect(ids()).toEqual([hintId]);

    fireEvent.change(input, { target: { value: '2026-11-12' } });
    expect(ids()).toHaveLength(2);
    expect(ids()[0]).toBe(hintId);
    const readback = document.getElementById(ids()[1] ?? '');
    // "התאריך שנבחר: 12 בנובמבר 2026"
    expect(readback).toHaveTextContent(
      '\u05d4\u05ea\u05d0\u05e8\u05d9\u05da \u05e9\u05e0\u05d1\u05d7\u05e8: 12 \u05d1\u05e0\u05d5\u05d1\u05de\u05d1\u05e8 2026',
    );
  });

  it('ac12_search_run_event', async () => {
    mockApi({ [SEARCH]: [json(page([]))] });
    vi.mocked(capture).mockClear();
    render('/search?sort=newest');
    await screen.findByText(he.search.empty);
    openPanel();
    fireEvent.change(priceTo(), { target: { value: '8000' } });
    fireEvent.click(feature(he.search.feature.pets));
    apply();
    expect(currentPath()).toBe('/search?price_max=8000&pets=true&sort=newest');
    // The type and the number of filters set (sort excluded), never their values.
    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith('search_run', { type: 'apartment', filters: 2 });

    // Clear sends nothing.
    openPanel();
    clearInSheet();
    expect(currentPath()).toBe('/search');
    expect(capture).toHaveBeenCalledOnce();
  });

  it('ac3_apply_clear_back_and_validation', async () => {
    // Apply: the URL gets the filters (a new history entry) and a new request is sent.
    let api = mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    let view = render('/search');
    await screen.findByText(i18n.t('search.count', { count: 1 }));
    openPanel();
    fireEvent.change(priceTo(), { target: { value: '8000' } });
    fireEvent.click(feature(he.search.feature.pets));
    apply();
    expect(currentPath()).toBe('/search?price_max=8000&pets=true');
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(2);
    });
    expect(query(sent(api, 1))).toEqual(
      expected({
        listing_type: 'apartment',
        price_max: '8000',
        pets: 'true',
        limit: '20',
        offset: '0',
      }),
    );
    // The sheet closes; opened again, the form shows the URL's values.
    expectSheetClosed();
    openPanel();
    expect(priceTo()).toHaveValue('8000');
    expect(feature(he.search.feature.pets)).toBeChecked();

    // Clear: an empty search, the sheet closed, the form reset.
    clearInSheet();
    expect(currentPath()).toBe('/search');
    expectSheetClosed();
    openPanel();
    expect(priceTo()).toHaveValue('');
    expect(feature(he.search.feature.pets)).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: he.search.closeFilters }));

    // Back: the previous URL, and the form shows it again.
    fireEvent.click(screen.getByRole('button', { name: 'history-back' }));
    expect(currentPath()).toBe('/search?price_max=8000&pets=true');
    openPanel();
    expect(priceTo()).toHaveValue('8000');
    expect(feature(he.search.feature.pets)).toBeChecked();

    // Unsaved edits are discarded by clear even when the URL is already clean.
    clearInSheet();
    openPanel();
    fireEvent.change(priceFrom(), { target: { value: '12a3' } });
    expect(priceFrom()).toHaveValue('123');
    clearInSheet();
    expect(currentPath()).toBe('/search');
    openPanel();
    expect(priceFrom()).toHaveValue('');
    view.unmount();
    vi.unstubAllGlobals();

    // Price from > to: the error under "to", focused, the URL unchanged, no new request.
    api = mockApi({ [SEARCH]: [json(page([]))] });
    view = render('/search');
    await screen.findByText(he.search.empty);
    openPanel();
    fireEvent.change(priceFrom(), { target: { value: '9000' } });
    fireEvent.change(priceTo(), { target: { value: '8000' } });
    apply();
    let alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(he.search.errors.priceOrder);
    expect(priceTo()).toHaveAttribute('aria-describedby', alert.id);
    expect(priceTo()).toHaveAttribute('aria-invalid', 'true');
    expect(priceTo()).toHaveFocus();
    expect(currentPath()).toBe('/search');
    expect(api.calls(SEARCH)).toHaveLength(1);

    // Out of range: the range error on that field.
    fireEvent.change(priceFrom(), { target: { value: '100001' } });
    fireEvent.change(priceTo(), { target: { value: '' } });
    apply();
    alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(i18n.t('listings.errors.range', { min: 0, max: 100000 }));
    expect(priceFrom()).toHaveAttribute('aria-describedby', alert.id);
    expect(priceFrom()).toHaveFocus();
    expect(currentPath()).toBe('/search');
    view.unmount();
    vi.unstubAllGlobals();

    // The sort survives apply.
    mockApi({ [SEARCH]: [json(page([]))] });
    render('/search?sort=price_asc');
    await screen.findByText(he.search.empty);
    openPanel();
    fireEvent.click(feature(he.search.feature.pets));
    apply();
    expect(currentPath()).toBe('/search?pets=true&sort=price_asc');
  });

  it('ac3_focus_after_apply_and_clear', async () => {
    // An Apply that changes the URL closes the sheet, and focus moves to the count line.
    mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    let view = render('/search');
    await screen.findByText(i18n.t('search.count', { count: 1 }));
    openPanel();
    fireEvent.change(priceTo(), { target: { value: '8000' } });
    const applyButton = screen.getByRole('button', { name: he.search.apply });
    act(() => applyButton.focus());
    apply();
    expect(currentPath()).toBe('/search?price_max=8000');
    await vi.waitFor(() => {
      expect(liveRegion()).toHaveFocus();
    });
    expect(applyButton).not.toBeInTheDocument();

    // Apply with unchanged filters: the URL stays, and focus returns to the toggle.
    openPanel();
    apply();
    expect(currentPath()).toBe('/search?price_max=8000');
    await settle();
    expectSheetClosed();
    expect(screen.getByRole('button', { name: /^מסננים/ })).toHaveFocus();

    // Clear: the count line again.
    openPanel();
    clearInSheet();
    expect(currentPath()).toBe('/search');
    await vi.waitFor(() => {
      expect(liveRegion()).toHaveFocus();
    });
    view.unmount();
    vi.unstubAllGlobals();

    // The empty state's Clear does the same.
    mockApi({ [SEARCH]: [json(page([])), json(page([publicListing()]))] });
    view = render('/search?pets=true');
    await screen.findByText(he.search.empty);
    const emptyClear = screen.getByRole('button', { name: he.search.clear });
    act(() => emptyClear.focus());
    fireEvent.click(emptyClear);
    expect(currentPath()).toBe('/search');
    await vi.waitFor(() => {
      expect(liveRegion()).toHaveFocus();
    });
    expect(await screen.findByText(i18n.t('search.count', { count: 1 }))).toBe(liveRegion());
  });

  it('ac4_result_states', async () => {
    // Pending: three skeletons in a busy block; the live region is already mounted, empty.
    const pending = deferred();
    mockApi({ [SEARCH]: [pending.promise] });
    let view = render('/search');
    expect(screen.getByRole('heading', { level: 1, name: he.search.title })).toBeVisible();
    const busy = screen.getByText(he.common.loading).closest<HTMLElement>('[aria-busy="true"]');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(busy as HTMLElement).getAllByTestId('skeleton')).toHaveLength(3);
    expect(liveRegion()).not.toBeNull();
    expect(liveRegion()).toHaveTextContent('');
    view.unmount();
    vi.unstubAllGlobals();

    // Failure: ErrorState; retry re-requests.
    const api = mockApi({ [SEARCH]: [json({ detail: 'boom' }, 500), json(page([]))] });
    view = render('/search');
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await screen.findByText(he.search.empty)).toBeVisible();
    expect(api.calls(SEARCH)).toHaveLength(2);
    view.unmount();
    vi.unstubAllGlobals();

    // A 422 is the generic error too: its English `msg` is never shown.
    const msg = 'Input should be a valid integer';
    mockApi({
      [SEARCH]: [
        json({ detail: [{ type: 'int_parsing', loc: ['query', 'price_max'], msg }] }, 422),
      ],
    });
    view = render('/search');
    expect(await screen.findByRole('button', { name: he.common.retry })).toBeVisible();
    expect(screen.getByText(he.common.error)).toBeVisible();
    expect(screen.queryByText(msg, { exact: false })).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // Empty with filters: the empty state and a clear button that clears them.
    mockApi({ [SEARCH]: [json(page([]))] });
    view = render('/search?pets=true');
    expect(await screen.findByText(he.search.empty)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: he.search.clear }));
    expect(currentPath()).toBe('/search');
    view.unmount();
    vi.unstubAllGlobals();

    // Empty without filters: no clear button.
    mockApi({ [SEARCH]: [json(page([]))] });
    view = render('/search');
    expect(await screen.findByText(he.search.empty)).toBeVisible();
    expect(screen.queryByRole('button', { name: he.search.clear })).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // One result.
    mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    view = render('/search');
    expect(await screen.findByText(i18n.t('search.count', { count: 1 }))).toBeVisible();
    view.unmount();
    vi.unstubAllGlobals();

    // Three results: the count in the live region, cards in API order, each title a link.
    const three = [
      publicListing({ street: 'אחד', price_ils: 7000 }),
      publicListing({ street: 'שתיים', price_ils: 5000 }),
      publicListing({ street: 'שלוש', price_ils: 9000 }),
    ];
    mockApi({ [SEARCH]: [json(page(three, 3))] });
    render('/search');
    expect((await screen.findByText('3 מודעות')).closest('[aria-live="polite"]')).not.toBeNull();
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(3);
    cards.forEach((card, i) => {
      const item = at(three, i);
      const title = i18n.t('listings.card.title', {
        count: 3,
        rooms: '3',
        street: item.street,
        city: item.city,
      });
      const link = within(card).getByRole('link');
      expect(link).toHaveAccessibleName(title);
      expect(link).toHaveAttribute('href', `/listings/${item.id}`);
    });
    expect(screen.queryByRole('button', { name: he.search.more })).toBeNull();
    // A title opens the listing.
    fireEvent.click(within(at(cards, 1)).getByRole('link'));
    expect(currentPath()).toBe(`/listings/${at(three, 1).id}`);
  });

  it('ac3_result_count_forms', async () => {
    const forms: [number, string][] = [
      [1, '\u05de\u05d5\u05d3\u05e2\u05d4 \u05d0\u05d7\u05ea'],
      [2, '2 \u05de\u05d5\u05d3\u05e2\u05d5\u05ea'],
      [12, '12 \u05de\u05d5\u05d3\u05e2\u05d5\u05ea'],
    ];
    for (const [total, text] of forms) {
      mockApi({ [SEARCH]: [json(page([publicListing()], total))] });
      const view = render('/search');
      expect(await screen.findByText(text)).toBeVisible();
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac5_load_more', async () => {
    // 20 of 25, then the last 5.
    const first = listings(20);
    const second = deferred();
    let api = mockApi({ [SEARCH]: [json(page(first, 25)), second.promise] });
    let view = render('/search?pets=true');
    const more = await screen.findByRole('button', { name: he.search.more });
    expect(screen.getAllByRole('article')).toHaveLength(20);
    fireEvent.click(more);
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(2);
    });
    expect(query(sent(api, 1))).toEqual(
      expected({ listing_type: 'apartment', pets: 'true', limit: '20', offset: '20' }),
    );
    await vi.waitFor(() => {
      expect(more).toBeDisabled();
    });
    expect(more).toHaveAttribute('aria-busy', 'true');
    second.resolve(json(page(listings(5), 25)));
    await vi.waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(25);
    });
    expect(screen.queryByRole('button', { name: he.search.more })).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // The second page fails: an error and a retry under the 20 cards; retry asks for offset 20.
    api = mockApi({
      [SEARCH]: [json(page(first, 25)), json({ detail: 'boom' }, 500), json(page(listings(5), 25))],
    });
    view = render('/search?pets=true');
    fireEvent.click(await screen.findByRole('button', { name: he.search.more }));
    const retry = await screen.findByRole('button', { name: he.common.retry });
    expect(screen.getByText(he.common.error)).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(20);
    expect(screen.getByText(i18n.t('search.count', { count: 25 }))).toBeVisible();
    fireEvent.click(retry);
    await vi.waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(25);
    });
    expect(api.calls(SEARCH)).toHaveLength(3);
    expect(query(sent(api, 2))).toEqual(
      expected({ listing_type: 'apartment', pets: 'true', limit: '20', offset: '20' }),
    );
    expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // A listing created mid-paging shifts the offsets: the repeated id is shown once.
    const shifted = [at(first, 19), ...listings(4)];
    mockApi({ [SEARCH]: [json(page(first, 25)), json(page(shifted, 25))] });
    render('/search');
    fireEvent.click(await screen.findByRole('button', { name: he.search.more }));
    await vi.waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(24);
    });
    expect(screen.queryByRole('button', { name: he.search.more })).toBeNull();
  });

  it('ac6_sort_applies_at_once', async () => {
    // The API answers with the order it applied (0006b).
    const api = mockApi({ [SEARCH]: [json(page([])), json(page([], 0, 'price_desc'))] });
    render('/search?pets=true');
    await screen.findByText(he.search.empty);
    const select = screen.getByLabelText(he.search.sort.label);
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([he.search.sort.newest, he.search.sort.price_asc, he.search.sort.price_desc]);
    fireEvent.change(select, { target: { value: 'price_desc' } });
    expect(currentPath()).toBe('/search?pets=true&sort=price_desc');
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(2);
    });
    expect(query(sent(api, 1))).toEqual(
      expected({
        listing_type: 'apartment',
        pets: 'true',
        sort: 'price_desc',
        limit: '20',
        offset: '0',
      }),
    );
    expect(select).toHaveValue('price_desc');
    await settle();
    expect(select).toHaveValue('price_desc');
  });

  it('ac3_cards_show_match', async () => {
    // The seeker (`profile()`: budget 7500, move-in in 30 days) and two scored cards.
    const fits = publicListing({
      street: 'מתאימה',
      price_ils: 7200,
      available_from: inDays(30),
      match: { score: 100, agrees: ['budget', 'move_in', 'area'], differs: null },
    });
    const late = publicListing({
      street: 'מאוחרת',
      price_ils: 7000,
      available_from: inDays(90),
      match: { score: 59, agrees: ['budget', 'area', 'household'], differs: 'move_in' },
    });
    const answer = json(page([fits, late], 2, 'match'));
    let api = mockApi({ [ME]: [json(noa)], [PROFILE]: [json(profile())], [SEARCH]: [answer] });
    let view = render('/search');
    const chips = (card: HTMLElement) =>
      within(within(card).getByTestId('match-chips'))
        .getAllByRole('listitem')
        .map((li) => li.textContent);
    // Once the profile has resolved, the move-in chip has its direction.
    expect(await screen.findByText('כניסה מאוחרת מדי')).toBeVisible();
    expect(api.calls(PROFILE)).toHaveLength(1);
    expect(liveRegion()?.textContent).toBe('2 מודעות · לפי התאמה');
    let [first, second] = screen.getAllByRole('article');
    if (first === undefined || second === undefined) throw new Error('two cards expected');
    expect(within(first).getByText('התאמה 100%')).toBeVisible();
    expect(chips(first)).toEqual(['בתקציב']);
    expect(within(second).getByText('התאמה 59%')).toBeVisible();
    expect(chips(second)).toEqual(['בתקציב', 'כניסה מאוחרת מדי']);
    // The differing chip is amber, the agreeing one the accent tint.
    expect(within(second).getByText('כניסה מאוחרת מדי')).toHaveClass(
      'bg-surface-subtle',
      'text-warning',
    );
    expect(within(second).getByText('בתקציב')).toHaveClass('bg-accent-soft');
    // The listing's own facts are a separate line, and an apartment has no chip list.
    expect(within(first).queryByTestId('listing-chips')).toBeNull();
    expect(within(first).getByTestId('listing-facts')).not.toHaveTextContent('בתקציב');
    view.unmount();
    vi.unstubAllGlobals();

    // The profile cannot be read: the badges and the agreeing chip stay, no move-in chip.
    api = mockApi({
      [ME]: [json(noa)],
      [PROFILE]: [json({ detail: 'boom' }, 500)],
      [SEARCH]: [json(page([fits, late], 2, 'match'))],
    });
    view = render('/search');
    expect(await screen.findByText('התאמה 59%')).toBeVisible();
    await vi.waitFor(() => {
      expect(api.calls(PROFILE)).toHaveLength(1);
    });
    await settle();
    [first, second] = screen.getAllByRole('article');
    if (first === undefined || second === undefined) throw new Error('two cards expected');
    expect(within(first).getByText('התאמה 100%')).toBeVisible();
    expect(chips(first)).toEqual(['בתקציב']);
    expect(chips(second)).toEqual(['בתקציב']);
    expect(screen.queryByText('כניסה מאוחרת מדי')).toBeNull();
    expect(screen.queryByText('כניסה מוקדמת מדי')).toBeNull();
  });

  it('ac4_sort_select_and_url', async () => {
    const select = () => screen.getByLabelText(he.search.sort.label);
    const options = () =>
      within(select())
        .getAllByRole('option')
        .map((o) => o.textContent);
    const all = [
      he.search.sort.match,
      he.search.sort.newest,
      he.search.sort.price_asc,
      he.search.sort.price_desc,
    ];
    const withoutMatch = all.slice(1);

    // A seeker with a profile, no sort in the URL: "by match" is first and selected, and the
    // request leaves the order to the API.
    let api = mockApi({
      [ME]: [json(noa)],
      [PROFILE]: [json(profile())],
      [SEARCH]: [json(page([], 0, 'match')), json(page([], 0, 'newest'))],
    });
    let view = render('/search');
    await screen.findByText(he.search.empty);
    await vi.waitFor(() => {
      expect(options()).toEqual(all);
    });
    expect(select()).toHaveValue('match');
    expect(query(sent(api, 0))).toEqual(
      expected({ listing_type: 'apartment', limit: '20', offset: '0' }),
    );
    // Choosing newest: in the URL and the request.
    fireEvent.change(select(), { target: { value: 'newest' } });
    expect(currentPath()).toBe('/search?sort=newest');
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(2);
    });
    expect(query(sent(api, 1))).toEqual(
      expected({ listing_type: 'apartment', sort: 'newest', limit: '20', offset: '0' }),
    );
    await settle();
    expect(select()).toHaveValue('newest');
    // Still offered: the seeker has a profile.
    expect(options()).toEqual(all);
    view.unmount();
    vi.unstubAllGlobals();

    // A seeker without a profile: no match option, newest.
    api = mockApi({
      [ME]: [json(noa)],
      [PROFILE]: [noProfile()],
      [SEARCH]: [json(page([], 0, 'newest'))],
    });
    view = render('/search');
    await screen.findByText(he.search.empty);
    await vi.waitFor(() => {
      expect(api.calls(PROFILE)).toHaveLength(1);
    });
    await settle();
    expect(options()).toEqual(withoutMatch);
    expect(select()).toHaveValue('newest');
    view.unmount();
    vi.unstubAllGlobals();

    // The profile still loading, or failed, while the API answered in match order: the answer
    // decides, so the select shows match.
    const pendingProfile = deferred();
    for (const reply of [pendingProfile.promise, json({ detail: 'boom' }, 500)]) {
      api = mockApi({
        [ME]: [json(noa)],
        [PROFILE]: [reply],
        [SEARCH]: [json(page([publicListing()], 1, 'match'))],
      });
      view = render('/search');
      await screen.findByText(i18n.t('search.count', { count: 1 }));
      await vi.waitFor(() => {
        expect(api.calls(PROFILE)).toHaveLength(1);
      });
      await settle();
      expect(select()).toHaveValue('match');
      expect(options()).toEqual(all);
      view.unmount();
      vi.unstubAllGlobals();
    }

    // A visitor at `?sort=match`: the API answers newest, and so do the select and the count line.
    api = mockApi({
      [ME]: [unauthenticated()],
      [SEARCH]: [json(page([publicListing()], 1, 'newest'))],
    });
    render('/search?sort=match');
    await screen.findByText(i18n.t('search.count', { count: 1 }));
    expect(query(sent(api, 0))).toEqual(
      expected({ listing_type: 'apartment', sort: 'match', limit: '20', offset: '0' }),
    );
    expect(select()).toHaveValue('newest');
    expect(options()).toEqual(withoutMatch);
    expect(liveRegion()?.textContent).toBe(i18n.t('search.count', { count: 1 }));
    expect(liveRegion()).not.toHaveTextContent('לפי התאמה');
  });

  it('ac7_profile_nudge', async () => {
    // A seeker without a profile: the nudge, linking back to this exact search.
    let api = mockApi({
      [ME]: [json(noa)],
      [PROFILE]: [noProfile()],
      [SEARCH]: [json(page([publicListing()]))],
    });
    let view = render('/search?price_max=8000&pets=true');
    expect(await screen.findByText(he.match.nudge)).toBeVisible();
    const link = screen.getByRole('link', { name: he.match.fillProfile });
    expect(link).toHaveAttribute(
      'href',
      `/me/profile?section=looking&next=${encodeURIComponent('/search?price_max=8000&pets=true')}`,
    );
    view.unmount();
    vi.unstubAllGlobals();

    // A seeker with a profile: no nudge.
    api = mockApi({
      [ME]: [json(noa)],
      [PROFILE]: [json(profile())],
      [SEARCH]: [json(page([publicListing()]))],
    });
    view = render('/search');
    await screen.findByText(i18n.t('search.count', { count: 1 }));
    await vi.waitFor(() => {
      expect(api.calls(PROFILE)).toHaveLength(1);
    });
    await settle();
    expect(screen.queryByText(he.match.nudge)).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // A visitor: no nudge, and the profile is never requested.
    api = mockApi({
      [ME]: [unauthenticated()],
      [PROFILE]: [noProfile()],
      [SEARCH]: [json(page([]))],
    });
    view = render('/search');
    await screen.findByText(he.search.empty);
    await vi.waitFor(() => {
      expect(api.calls(ME)).toHaveLength(1);
    });
    await settle();
    expect(screen.queryByText(he.match.nudge)).toBeNull();
    expect(api.calls(PROFILE)).toHaveLength(0);
    view.unmount();
    vi.unstubAllGlobals();

    // An owner on the apartments search (spec 0010b, inverted): the profile is requested (any
    // account may have one), but the apartments' nudge stays a seeker's.
    api = mockApi({ [ME]: [json(owner)], [PROFILE]: [noProfile()], [SEARCH]: [json(page([]))] });
    view = render('/search');
    await screen.findByText(he.search.empty);
    await vi.waitFor(() => {
      expect(api.calls(PROFILE)).toHaveLength(1);
    });
    await settle();
    expect(screen.queryByText(he.match.nudge)).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();
  });

  it('ac5_similar_age_chip', async () => {
    const year = new Date().getUTCFullYear();
    const room = publicListing({
      street: 'חדר',
      listing_type: 'room',
      gender_preference: 'women',
      flatmates_count: 2,
      flatmate_ages: [27, 30],
    });
    const flat = publicListing({ street: 'דירה' });
    // The room chips of a card; `[]` when it has none (an apartment).
    const listChips = (street: string) => {
      const list = within(cardOf(street)).queryByTestId('listing-chips');
      return list === null
        ? []
        : within(list)
            .getAllByRole('listitem')
            .map((li) => li.textContent);
    };
    const cardOf = (street: string) => {
      const card = screen
        .getAllByRole('article')
        .find((article) => within(article).queryByRole('link', { name: new RegExp(street) }));
      if (card === undefined) throw new Error(`no card for ${street}`);
      return card;
    };

    // A seeker 28 years old: the chip leads the room's chips (teal), not the apartment's.
    let api = mockApi({
      [ME]: [json(noa)],
      [PROFILE]: [json(profile({ gender: 'woman', birth_year: year - 28 }))],
      [SEARCH]: [json(page([room, flat]))],
    });
    let view = render('/market');
    expect(await screen.findByText(he.rooms.card.similarAge)).toBeVisible();
    expect(listChips('חדר')[0]).toBe(he.rooms.card.similarAge);
    expect(within(cardOf('חדר')).getByText(he.rooms.card.similarAge)).toHaveClass(
      'bg-accent-soft',
      'text-accent-strong',
    );
    expect(listChips('דירה')).not.toContain(he.rooms.card.similarAge);
    expect(screen.getAllByText(he.rooms.card.similarAge)).toHaveLength(1);
    view.unmount();
    vi.unstubAllGlobals();

    // No chip: a seeker 40 years old, one without a birth year, one whose profile failed.
    for (const reply of [
      json(profile({ gender: 'woman', birth_year: year - 40 })),
      json(profile({ gender: 'woman', birth_year: null })),
      json({ detail: 'boom' }, 500),
    ]) {
      api = mockApi({
        [ME]: [json(noa)],
        [PROFILE]: [reply],
        [SEARCH]: [json(page([room, flat]))],
      });
      view = render('/market');
      await screen.findByText(i18n.t('search.count', { count: 2 }));
      await vi.waitFor(() => {
        expect(api.calls(PROFILE)).toHaveLength(1);
      });
      await settle();
      expect(screen.queryByText(he.rooms.card.similarAge)).toBeNull();
      view.unmount();
      vi.unstubAllGlobals();
    }

    // A visitor: no chip, and no profile request.
    api = mockApi({
      [ME]: [unauthenticated()],
      [PROFILE]: [json(profile({ birth_year: year - 28 }))],
      [SEARCH]: [json(page([room, flat]))],
    });
    view = render('/market');
    await screen.findByText(i18n.t('search.count', { count: 2 }));
    await vi.waitFor(() => {
      expect(api.calls(ME)).toHaveLength(1);
    });
    await settle();
    expect(screen.queryByText(he.rooms.card.similarAge)).toBeNull();
    expect(api.calls(PROFILE)).toHaveLength(0);
    view.unmount();
    vi.unstubAllGlobals();

    // An owner with a profile (spec 0010b, inverted): the profile is requested and the chip shows,
    // as for a seeker.
    api = mockApi({
      [ME]: [json(owner)],
      [PROFILE]: [json(profile({ birth_year: year - 28 }))],
      [SEARCH]: [json(page([room, flat]))],
    });
    view = render('/market');
    expect(await screen.findByText(he.rooms.card.similarAge)).toBeVisible();
    expect(api.calls(PROFILE)).toHaveLength(1);
    view.unmount();
    vi.unstubAllGlobals();
  });

  it('ac6_room_with_match_chips', async () => {
    const matchChips = (card: HTMLElement) =>
      within(within(card).getByTestId('match-chips'))
        .getAllByRole('listitem')
        .map((li) => li.textContent);
    const alike = publicListing({
      street: 'דומה',
      listing_type: 'room',
      flatmates_count: 2,
      lifestyle: { cleanliness: 3 },
      match: { score: 88, agrees: ['lifestyle', 'budget'], differs: null },
    });
    const unlike = publicListing({
      street: 'שונה',
      listing_type: 'room',
      flatmates_count: 2,
      lifestyle: { cleanliness: 1 },
      match: { score: 59, agrees: ['budget'], differs: 'lifestyle' },
    });
    const flat = publicListing({
      street: 'דירה',
      match: { score: 100, agrees: ['budget'], differs: null },
    });
    mockApi({
      [ME]: [json(noa)],
      [PROFILE]: [json(profile({ lifestyle: { cleanliness: 3 } }))],
      [SEARCH]: [json(page([alike, unlike, flat], 3, 'match'))],
    });
    render('/market');
    expect(await screen.findByText('התאמה 88%')).toBeVisible();
    const [first, second, third] = screen.getAllByRole('article');
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('three cards expected');
    }
    // The room cards keep 0006f's badge and chips; the lifestyle chips are worded.
    expect(within(first).getByText(he.listings.card.room)).toBeVisible();
    expect(matchChips(first)).toEqual([he.match.short.lifestyle.agree]);
    expect(within(first).getByText(he.match.short.lifestyle.agree)).toHaveClass('bg-accent-soft');
    expect(within(second).getByText('התאמה 59%')).toBeVisible();
    expect(matchChips(second)).toEqual([
      he.match.short.budget.agree,
      he.match.short.lifestyle.differ,
    ]);
    expect(within(second).getByText(he.match.short.lifestyle.differ)).toHaveClass(
      'bg-surface-subtle',
    );
    expect(within(third).getByText('התאמה 100%')).toBeVisible();
    expect(matchChips(third)).toEqual([he.match.short.budget.agree]);
    expect(within(third).queryByText(he.listings.card.room)).toBeNull();
  });

  it('ac1_phone_layout', async () => {
    // jsdom has no matchMedia: the phone layout. A seeker without a profile sees the nudge.
    mockApi({
      [ME]: [json(noa)],
      [PROFILE]: [noProfile()],
      [SEARCH]: [json(page([publicListing(), publicListing()]))],
    });
    render('/search');
    expect(await screen.findByText(he.match.nudge)).toBeVisible();
    await screen.findAllByRole('article');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(he.search.title);

    const toggle = screen.getByRole('button', { name: he.search.filters });
    expect(toggle).toHaveAttribute('aria-haspopup', 'dialog');
    expect(toggle).not.toHaveAttribute('aria-expanded');
    expect(toggle).not.toHaveAttribute('aria-controls');
    expectSheetClosed();
    // No inline panel on a phone: the filters are only in the sheet.
    expect(screen.queryByRole('region', { name: he.search.filters })).toBeNull();
    fireEvent.click(toggle);
    expect(sheet()).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: he.search.closeFilters }));
    expectSheetClosed();

    // The toolbar (the sort and the view toggle), then the nudge, then the count line.
    const sort = screen.getByLabelText(he.search.sort.label);
    const views = screen.getByRole('group', { name: he.search.view.label });
    const toolbar = views.parentElement?.parentElement;
    expect(toolbar).toContainElement(sort);
    const before = (a: Node, b: Node | null) =>
      b !== null && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const nudge = screen.getByText(he.match.nudge);
    expect(before(views, nudge)).toBe(true);
    expect(before(sort, liveRegion())).toBe(true);
    expect(before(nudge, liveRegion())).toBe(true);

    for (const card of screen.getAllByRole('article')) {
      expect(card).toHaveAttribute('data-layout', 'row');
    }
  });

  it('ac2_active_filter_tags', async () => {
    const tags = () =>
      within(screen.getByRole('list', { name: he.search.tags.label }))
        .getAllByRole('listitem')
        .map((li) => li.textContent);
    const url = '/search?price_max=8000&rooms_min=3&rooms_max=4&available_by=2027-01-01&pets=true';
    mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    let view = render(url);
    await screen.findAllByRole('article');
    expect(tags()).toEqual([
      'עד 8,000 ₪',
      'חדרים: 3–4',
      `כניסה עד ${formatDate('2027-01-01')}`,
      he.search.feature.pets,
    ]);
    // Each tag has its own remove button, named after it (spec 0023a).
    expect(
      within(screen.getByRole('list', { name: he.search.tags.label }))
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(
      [
        'עד 8,000 ₪',
        'חדרים: 3–4',
        `כניסה עד ${formatDate('2027-01-01')}`,
        he.search.feature.pets,
      ].map((name) => i18n.t('search.tags.remove', { name })),
    );
    view.unmount();
    vi.unstubAllGlobals();

    mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    view = render('/search?price_min=4000&price_max=8000&rooms_min=3');
    await screen.findAllByRole('article');
    expect(tags()).toEqual(['4,000–8,000 ₪', 'חדרים: 3 ומעלה']);
    view.unmount();
    vi.unstubAllGlobals();

    mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    view = render('/search?rooms_max=4');
    await screen.findAllByRole('article');
    expect(tags()).toEqual(['חדרים: עד 4']);
    view.unmount();
    vi.unstubAllGlobals();

    // One room chip (`n` to `n + 0.5`) reads as "n" (spec 0023a).
    mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    view = render('/search?rooms_min=3&rooms_max=3.5');
    await screen.findAllByRole('article');
    expect(tags()).toEqual(['חדרים: 3']);
    view.unmount();
    vi.unstubAllGlobals();

    // No filter: no list at all. The sort and the view are not filters.
    mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    view = render('/search?sort=price_asc&view=map');
    await screen.findByRole('group', { name: he.search.view.label });
    expect(screen.queryByRole('list', { name: he.search.tags.label })).toBeNull();
  });

  it('ac9 shelter filter: checkbox, URL, query, reload and tag', async () => {
    // Spec 0015a AC9: "מרחב מוגן" sets `shelter=true` in the URL and the query, survives a
    // reload, shows an active-filter tag, and clearing the filters drops both.
    const label = he.search.feature.shelter;
    const tagList = () => screen.queryByRole('list', { name: he.search.tags.label });
    let api = mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    let view = render('/search');
    await screen.findByText(i18n.t('search.count', { count: 1 }));
    openPanel();
    expect(feature(label)).not.toBeChecked();
    fireEvent.click(feature(label));
    apply();
    expect(currentPath()).toBe('/search?shelter=true');
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(2);
    });
    expect(query(sent(api, 1))).toEqual(
      expected({ listing_type: 'apartment', shelter: 'true', limit: '20', offset: '0' }),
    );
    expect(
      within(tagList() as HTMLElement)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([label]);
    // Clearing drops the param, the tag and the check.
    openPanel();
    clearInSheet();
    expect(currentPath()).toBe('/search');
    expect(tagList()).toBeNull();
    openPanel();
    expect(feature(label)).not.toBeChecked();
    view.unmount();
    vi.unstubAllGlobals();

    // A reload of the URL: the box is checked, the query carries it, the tag shows.
    for (const [path, type] of [
      ['/search', 'apartment'],
      ['/market', 'room'],
    ] as const) {
      api = mockApi({ [SEARCH]: [json(page([publicListing()]))] });
      view = render(`${path}?shelter=true`);
      await screen.findByText(i18n.t('search.count', { count: 1 }));
      expect(query(sent(api, 0))).toEqual(
        expected({ listing_type: type, shelter: 'true', limit: '20', offset: '0' }),
      );
      expect(within(tagList() as HTMLElement).getByText(label)).toBeVisible();
      openPanel();
      expect(feature(label)).toBeChecked();
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac3_desktop_side_panel', async () => {
    stubDesktop();
    const api = mockApi({ [SEARCH]: [json(page([publicListing(), publicListing()]))] });
    render('/search');
    await screen.findAllByRole('article');

    // No toggle: the panel is always open.
    expect(screen.queryByRole('button', { name: /^מסננים/ })).toBeNull();
    const panel = screen.getByRole('region', { name: he.search.filters });
    expect(panel).not.toHaveAttribute('hidden');
    expect(panel).toBeVisible();
    // It comes before the results.
    const [card] = screen.getAllByRole('article');
    expect(
      panel.compareDocumentPosition(card as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    // Its heading is the visible name.
    expect(within(panel).getByRole('heading', { level: 2, name: he.search.filters })).toBeVisible();

    fireEvent.change(priceTo(), { target: { value: '5000' } });
    apply();
    expect(currentPath()).toBe('/search?price_max=5000');
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(2);
    });
    // One count line.
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  });

  it('ac5_mascot_states', async () => {
    // Loading: the search turtle (decorative, aria-hidden) above three skeletons.
    const pending = deferred();
    mockApi({ [SEARCH]: [pending.promise] });
    let view = render('/search');
    expect(mascots()).toHaveLength(1);
    const turtle = mascots()[0] as HTMLElement;
    expect((turtle.getAttribute('src') ?? '').split('/').pop()).toBe('homie-turtle-search.svg');
    expect(turtle).toHaveAttribute('width', '96');
    expect(turtle.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getAllByTestId('skeleton')).toHaveLength(3);
    view.unmount();
    vi.unstubAllGlobals();

    // Empty with filters: the mascot, the message and a working clear button.
    mockApi({ [SEARCH]: [json(page([]))] });
    view = render('/search?pets=true');
    expect(await screen.findByText(he.search.empty)).toBeVisible();
    expect(mascots()).toHaveLength(1);
    expect((mascots()[0]?.getAttribute('src') ?? '').split('/').pop()).toBe(
      'homie-turtle-search.svg',
    );
    // The sheet's own "ניקוי" exists only while it is open; the empty state's is visible.
    const clears = screen.getAllByRole('button', { name: he.search.clear });
    expect(clears).toHaveLength(1);
    fireEvent.click(clears[0] as HTMLElement);
    expect(currentPath()).toBe('/search');
    view.unmount();
    vi.unstubAllGlobals();

    // Empty with no filter: the mascot, but no clear button in the empty state.
    mockApi({ [SEARCH]: [json(page([]))] });
    render('/search');
    expect(await screen.findByText(he.search.empty)).toBeVisible();
    expect(mascots()).toHaveLength(1);
    expect(screen.queryAllByRole('button', { name: he.search.clear })).toHaveLength(0);
  });

  it('ac2_map_move_keeps_the_form', async () => {
    // On a desktop, where the form stays on the page beside the map.
    stubDesktop();
    // Replies are built per request: a Response body is read once.
    mockApi({ [SEARCH]: [() => json(page([publicListing({ lat: 32.08, lng: 34.8 })]))] });
    render('/search?view=map');
    // The map mounts once `/me` has answered (a visitor's default view).
    await vi.waitFor(() => lastProps());
    // A filter Apply first: a pushed entry, so Back shows whether a move adds one.
    fireEvent.click(feature(he.search.feature.pets));
    apply();
    expect(currentPath()).toBe('/search?pets=true&view=map');
    await vi.waitFor(() => {
      expect(liveRegion()).toHaveFocus();
    });

    // A half-typed price, focused.
    const input = priceTo();
    fireEvent.change(input, { target: { value: '75' } });
    act(() => input.focus());

    // The map reports a move with its view: `c` and `z` join the URL, and nothing else changes.
    moveTo(BOX, { center: [34.8123456, 32.0712345], zoom: 13.456 });
    expect(params().get('c')).toBe('32.0712,34.8123');
    expect(params().get('z')).toBe('13.46');
    expect(params().get('pets')).toBe('true');
    // The form is the same element (no remount) and keeps the typed value and focus.
    expect(priceTo()).toBe(input);
    expect(input).toHaveValue('75');
    expect(input).toHaveFocus();
    await settle();
    expect(input).toHaveFocus();
    expect(input).toHaveValue('75');

    // A second move replaces the position again; Back returns to the URL before the Apply.
    moveTo(BOX, { center: [34.81, 32.07], zoom: 14 });
    expect(params().get('z')).toBe('14');
    expect(input).toHaveValue('75');
    fireEvent.click(screen.getByRole('button', { name: 'history-back' }));
    expect(currentPath()).toBe('/search?view=map');
  });

  it('ac3_map_params_ride_along_not_in_queries', async () => {
    const listing = publicListing({ lat: 32.0712, lng: 34.8123 });
    const C = '32.0712,34.8123';
    const client = testQueryClient();
    const api = mockApi({ [SEARCH]: [() => json(page([listing]))] });
    render(`/search?view=map&c=${C}&z=13.5&pin=${listing.id}`, client);
    moveTo(BOX, { center: [34.8123, 32.0712], zoom: 13.5 });
    await vi.waitFor(() => {
      expect(liveRegion()).toHaveTextContent(i18n.t('search.count', { count: 1 }));
    });
    /** `c` and `z` are where the map is. */
    const atTheSamePlace = () => {
      expect(params().get('c')).toBe(C);
      expect(params().get('z')).toBe('13.5');
    };
    atTheSamePlace();
    expect(params().get('pin')).toBe(listing.id);

    // Apply, a sort change and Clear each carry the map's position along.
    openPanel();
    fireEvent.click(feature(he.search.feature.pets));
    apply();
    expect(params().get('pets')).toBe('true');
    atTheSamePlace();
    fireEvent.change(screen.getByLabelText(he.search.sort.label), {
      target: { value: 'price_asc' },
    });
    expect(params().get('sort')).toBe('price_asc');
    atTheSamePlace();
    openPanel();
    clearInSheet();
    expect(params().get('pets')).toBeNull();
    expect(params().get('sort')).toBeNull();
    expect(params().get('view')).toBe('map');
    atTheSamePlace();
    await vi.waitFor(() => {
      expect(liveRegion()).toHaveFocus();
    });

    // No request and no query key ever holds the map's params.
    await vi.waitFor(() => {
      expect(api.calls(SEARCH).length).toBeGreaterThanOrEqual(3);
    });
    for (const { request } of api.calls(SEARCH)) {
      const sentParams = new URL(request.url).searchParams;
      for (const key of ['c', 'z', 'pin']) expect(sentParams.has(key)).toBe(false);
      expect(request.url).not.toContain(listing.id);
    }
    const keys = client
      .getQueryCache()
      .getAll()
      .map((q) => JSON.stringify(q.queryKey));
    expect(keys.some((key) => key.startsWith('["search-map"'))).toBe(true);
    for (const key of keys) {
      for (const name of ['"c"', '"z"', '"pin"', '32.0712', listing.id]) {
        expect(key).not.toContain(name);
      }
    }

    // An Apply that changes nothing returns focus to the toggle (no focus flag)...
    openPanel();
    apply();
    await settle();
    expectSheetClosed();
    expect(screen.getByRole('button', { name: /^מסננים/ })).toHaveFocus();
    atTheSamePlace();
    // ...so the next view toggle leaves focus on the toggle, not on the count line.
    const list = viewToggle().getByRole('button', { name: he.search.view.list });
    act(() => list.focus());
    fireEvent.click(list);
    expect(params().get('view')).toBeNull();
    atTheSamePlace();
    await settle();
    expect(list).toHaveFocus();

    // Back to the map: it opens at that `c` / `z`.
    resetFakeMap();
    fireEvent.click(viewToggle().getByRole('button', { name: he.search.view.map }));
    expect(params().get('view')).toBe('map');
    atTheSamePlace();
    expect(lastProps().center).toEqual([34.8123, 32.0712]);
    expect(lastProps().zoom).toBe(13.5);
    expect(lastProps().bounds).toBeUndefined();
  });
  it('ac8_type_per_side_and_redirect', async () => {
    // /search: apartments only, in the list and on the map; no type fieldset or tag.
    let api = mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    let view = render('/search?pets=true');
    await screen.findAllByRole('article');
    expect(query(sent(api, 0))).toEqual(
      expected({ listing_type: 'apartment', pets: 'true', limit: '20', offset: '0' }),
    );
    openPanel();
    expect(screen.queryByRole('group', { name: 'סוג' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'חדר בדירת שותפים' })).toBeNull();
    expect(screen.getByText(he.search.availableByHint)).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: he.search.tags.label }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([he.search.feature.pets]);
    fireEvent.click(viewToggle().getByRole('button', { name: he.search.view.map }));
    await vi.waitFor(() => lastProps());
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(2);
    });
    expect(new URL(sent(api, 1).url).searchParams.getAll('listing_type')).toEqual(['apartment']);
    view.unmount();
    vi.unstubAllGlobals();

    // /market: rooms, the market's title and date hint; the map asks for rooms too.
    resetFakeMap();
    api = mockApi({ [SEARCH]: [json(page([publicListing({ listing_type: 'room' })]))] });
    view = render('/market');
    expect(await screen.findByRole('heading', { level: 1, name: he.market.title })).toBeVisible();
    await screen.findAllByRole('article');
    expect(document.title).toContain(he.market.title);
    expect(query(sent(api, 0))).toEqual(
      expected({ listing_type: 'room', limit: '20', offset: '0' }),
    );
    openPanel();
    expect(screen.getByText(he.market.availableByHint)).toBeInTheDocument();
    expect(screen.queryByText(he.search.availableByHint)).toBeNull();
    fireEvent.click(viewToggle().getByRole('button', { name: he.search.view.map }));
    await vi.waitFor(() => lastProps());
    moveTo(BOX);
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(2);
    });
    expect(new URL(sent(api, 1).url).searchParams.getAll('listing_type')).toEqual(['room']);
    view.unmount();
    vi.unstubAllGlobals();

    // One cache, two sides: `/search`'s cached apartment is never shown on `/market`.
    const client = testQueryClient();
    const flat = publicListing({ street: 'דירה בלבד' });
    const rooms = deferred();
    api = mockApi({ [SEARCH]: [json(page([flat])), rooms.promise] });
    view = renderRoutes(
      '/search',
      <>
        <Routes>
          <Route path="/search" element={<SearchPage key="apartment" type="apartment" />} />
          <Route path="/market" element={<SearchPage key="room" type="room" />} />
        </Routes>
        <Link to="/market">to-market</Link>
      </>,
      client,
    );
    expect(await screen.findByRole('link', { name: /דירה בלבד/ })).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'to-market' }));
    expect(await screen.findByRole('heading', { level: 1, name: he.market.title })).toBeVisible();
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(2);
    });
    expect(screen.queryByRole('link', { name: /דירה בלבד/ })).toBeNull();
    expect(new URL(sent(api, 1).url).searchParams.get('listing_type')).toBe('room');
    rooms.resolve(json(page([])));
    expect(await screen.findByText(he.search.empty)).toBeVisible();
    view.unmount();
    vi.unstubAllGlobals();

    // An old rooms link lands on the market with its other params, replacing the entry: Back goes
    // to the page before it.
    api = mockApi({ [SEARCH]: [json(page([]))] });
    function Where() {
      const location = useLocation();
      return <output data-testid="where">{location.pathname + location.search}</output>;
    }
    view = renderUi(
      <QueryClientProvider client={testQueryClient()}>
        <MemoryRouter
          initialEntries={['/before', '/search?listing_type=room&price_max=5000&view=map']}
          initialIndex={1}
        >
          <Routes>
            <Route path="/before" element={<p>before</p>} />
            <Route path="/search" element={<SearchPage type="apartment" />} />
            <Route path="/market" element={<SearchPage type="room" />} />
          </Routes>
          <Back />
          <Where />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: he.market.title })).toBeVisible();
    expect(screen.getByTestId('where')).toHaveTextContent('/market?price_max=5000&view=map');
    fireEvent.click(screen.getByRole('button', { name: 'history-back' }));
    expect(await screen.findByText('before')).toBeVisible();
    view.unmount();
    vi.unstubAllGlobals();

    // `listing_type=apartment` (or anything else) stays on /search; requests carry the page's type
    // once.
    for (const value of ['apartment', 'house']) {
      api = mockApi({ [SEARCH]: [json(page([]))] });
      view = render(`/search?listing_type=${value}`);
      expect(await screen.findByText(he.search.empty)).toBeVisible();
      expect(currentPath()).toBe(`/search?listing_type=${value}`);
      expect(query(sent(api, 0))).toEqual(
        expected({ listing_type: 'apartment', limit: '20', offset: '0' }),
      );
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac16_market_view_switch_only_on_the_rooms_search', async () => {
    // /market: the inner חדרים / אנשים switch, rooms current. /search (apartments): none.
    mockApi({ [SEARCH]: [json(page([publicListing({ listing_type: 'room' })]))] });
    let view = render('/market');
    const nav = await screen.findByRole('navigation', { name: he.market.view.label });
    expect(within(nav).getByRole('link', { name: he.market.view.rooms })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: he.market.view.people })).toHaveAttribute(
      'href',
      '/market/people',
    );
    view.unmount();
    vi.unstubAllGlobals();

    mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    view = render('/search');
    await screen.findAllByRole('article');
    expect(screen.queryByRole('navigation', { name: he.market.view.label })).toBeNull();
  });
});

describe('SearchPage filters (spec 0023a)', () => {
  const COUNT_TIMEOUT = { timeout: 2000 };
  /** Longer than the count's 400 ms wait. */
  const pastTheWait = () => new Promise((r) => setTimeout(r, 480));
  const picker = () => within(sheet()).getByLabelText(he.search.area);
  const pickerReady = () =>
    vi.waitFor(() => {
      expect(picker()).toBeEnabled();
    });
  const pick = (name: string) => {
    fireEvent.change(picker(), { target: { value: name } });
  };
  const submitButton = () => {
    const button = sheet().querySelector('button[type="submit"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error('no submit button');
    return button;
  };
  const submit = () => {
    fireEvent.click(submitButton());
  };
  const toggleButton = () => screen.getByRole('button', { name: /^מסננים/ });
  const closeSheet = () => {
    fireEvent.click(screen.getByRole('button', { name: he.search.closeFilters }));
  };
  const removeLabel = (name: string) => i18n.t('search.tags.remove', { name });
  const countRequests = (api: ReturnType<typeof mockApi>) =>
    api
      .calls(SEARCH)
      .filter(({ request }) => new URL(request.url).searchParams.get('limit') === '1');
  const expectLabel = (text: string) =>
    vi.waitFor(() => {
      expect(submitButton()).toHaveTextContent(text);
    }, COUNT_TIMEOUT);
  const countLabel = (count: number) => i18n.t('search.applyCount', { count });
  const results = () => json(page([publicListing()]));
  /** A count's answer: only its `total` is read. */
  const total = (count: number) => json(page([], count));

  it('ac7_area_filter_applies', async () => {
    for (const [path, type] of [
      ['/search', 'apartment'],
      ['/market', 'room'],
    ] as const) {
      const api = mockApi({ [SEARCH]: [results] });
      const view = render(path);
      await screen.findAllByRole('article');
      openPanel();
      await pickerReady();
      pick(haifa.name_he);
      pick(FLORENTIN_LABEL);
      // Each pick empties the input and becomes a chip, in the order picked.
      expect(picker()).toHaveValue('');
      expect(
        within(sheet())
          .getAllByRole('button', { name: /^הסרת/ })
          .map((button) => button.getAttribute('aria-label')),
      ).toEqual([removeLabel(haifa.name_he), removeLabel(FLORENTIN_LABEL)]);
      submit();

      expect(params().getAll('area_ids')).toEqual([haifa.id, florentin.id]);
      await vi.waitFor(() => {
        expect(api.calls(SEARCH)).toHaveLength(2);
      });
      const sentParams = new URL(sent(api, 1).url).searchParams;
      expect(sentParams.getAll('area_ids')).toEqual([haifa.id, florentin.id]);
      expect(sentParams.get('listing_type')).toBe(type);
      // Each area is one active filter.
      expect(
        screen.getByRole('button', { name: i18n.t('search.filtersActive', { count: 2 }) }),
      ).toBeVisible();
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac8_area_picker_rules', async () => {
    const cities: AreaOut[] = Array.from({ length: 21 }, (_, i) => ({
      ...gushDan,
      id: `00000000-0000-0000-0001-${String(i + 1).padStart(12, '0')}`,
      slug: `s-${String(i + 1)}`,
      name_he: `עיר ${String(i + 1)}`,
    }));
    mockApi({ [SEARCH]: [results], [AREAS]: [() => json([...CATALOGUE, ...cities])] });
    let view = render('/search');
    await screen.findAllByRole('article');
    openPanel();
    await pickerReady();
    const chips = () =>
      within(sheet())
        .queryAllByRole('button', { name: /^הסרת/ })
        .map((button) => button.getAttribute('aria-label'));

    // Enter on a full name picks it and does not submit. "פלורנטין" alone is the start of its own
    // label, so typing it waits for Enter.
    fireEvent.change(picker(), { target: { value: florentin.name_he } });
    expect(chips()).toEqual([]);
    expect(fireEvent.keyDown(picker(), { key: 'Enter' })).toBe(false);
    expect(chips()).toEqual([removeLabel(FLORENTIN_LABEL)]);
    expect(currentPath()).toBe('/search');

    // Enter on a name that matches nothing says so and does not submit.
    fireEvent.change(picker(), { target: { value: 'אין כזה' } });
    expect(fireEvent.keyDown(picker(), { key: 'Enter' })).toBe(false);
    expect(within(sheet()).getByRole('alert')).toHaveTextContent(he.areas.notFound);
    expect(currentPath()).toBe('/search');
    fireEvent.change(picker(), { target: { value: '' } });

    // A repeated pick does nothing.
    pick(FLORENTIN_LABEL);
    expect(chips()).toEqual([removeLabel(FLORENTIN_LABEL)]);

    // Backspace in the empty input removes the last chip.
    pick(haifa.name_he);
    fireEvent.keyDown(picker(), { key: 'Backspace' });
    expect(chips()).toEqual([removeLabel(FLORENTIN_LABEL)]);

    // A chip's button removes it and leaves focus in the picker.
    fireEvent.click(within(sheet()).getByRole('button', { name: removeLabel(FLORENTIN_LABEL) }));
    expect(chips()).toEqual([]);
    expect(picker()).toHaveFocus();

    // Enter on the empty input is left to the browser, which submits the form.
    pick(haifa.name_he);
    expect(fireEvent.keyDown(picker(), { key: 'Enter' })).toBe(true);
    fireEvent.submit(submitButton().form as HTMLFormElement);
    expect(params().getAll('area_ids')).toEqual([haifa.id]);
    view.unmount();
    vi.unstubAllGlobals();

    // A 21st area shows the limit and is not added; the next change clears the message.
    mockApi({ [SEARCH]: [results], [AREAS]: [() => json(cities)] });
    const twenty = cities.slice(0, 20);
    view = render(`/search?${twenty.map(({ id }) => `area_ids=${id}`).join('&')}`);
    await screen.findAllByRole('article');
    openPanel();
    await pickerReady();
    expect(chips()).toHaveLength(20);
    pick('עיר 21');
    expect(within(sheet()).getByRole('alert')).toHaveTextContent(he.profile.errors.areasMax);
    expect(chips()).toHaveLength(20);
    fireEvent.keyDown(picker(), { key: 'Backspace' });
    expect(chips()).toHaveLength(19);
    expect(within(sheet()).queryByRole('alert')).toBeNull();
  });

  it('ac8_areas_failure_leaves_the_other_filters_working', async () => {
    mockApi({ [SEARCH]: [results], [AREAS]: [json({ detail: 'boom' }, 500)] });
    render('/search');
    await screen.findAllByRole('article');
    openPanel();
    const alert = await within(sheet()).findByRole('alert');
    expect(within(alert).getByRole('button', { name: he.common.retry })).toBeVisible();
    fireEvent.click(feature(he.search.feature.pets));
    submit();
    expect(currentPath()).toBe('/search?pets=true');
  });

  it('ac9_sheet_apply_closes', async () => {
    mockApi({ [SEARCH]: [results] });
    render('/search');
    await screen.findAllByRole('article');
    openPanel();
    // A modal with its title, and no second heading from the form.
    expect(sheet()).toHaveAttribute('open');
    expect(
      within(sheet()).getAllByRole('heading', { level: 2, name: he.search.filters }),
    ).toHaveLength(1);
    fireEvent.click(feature(he.search.feature.pets));
    submit();
    expect(currentPath()).toBe('/search?pets=true');
    expectSheetClosed();
    await vi.waitFor(() => {
      expect(liveRegion()).toHaveFocus();
    });
  });

  it('ac9_rotating_to_desktop_leaves_one_form', async () => {
    let desktop = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: desktop && media === '(min-width: 1024px)',
      media,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }));
    mockApi({ [SEARCH]: [results] });
    render('/search');
    await screen.findAllByRole('article');
    openPanel();
    expect(screen.queryByRole('region', { name: he.search.filters })).toBeNull();
    act(() => {
      desktop = true;
      for (const listener of listeners) listener();
    });
    expectSheetClosed();
    expect(screen.getByRole('region', { name: he.search.filters })).toBeVisible();
    expect(screen.getAllByRole('group', { name: he.search.price })).toHaveLength(1);
  });

  it('ac10_sheet_discard', async () => {
    const api = mockApi({ [SEARCH]: [results] });
    render('/search?price_max=8000');
    await screen.findAllByRole('article');

    // The X.
    openPanel();
    fireEvent.change(priceTo(), { target: { value: '5000' } });
    fireEvent.click(feature(he.search.feature.pets));
    closeSheet();
    expectSheetClosed();
    expect(toggleButton()).toHaveFocus();
    expect(currentPath()).toBe('/search?price_max=8000');
    openPanel();
    expect(priceTo()).toHaveValue('8000');
    expect(feature(he.search.feature.pets)).not.toBeChecked();

    // Esc.
    fireEvent.change(priceTo(), { target: { value: '5000' } });
    act(() => {
      sheet().dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expectSheetClosed();
    expect(toggleButton()).toHaveFocus();
    openPanel();
    expect(priceTo()).toHaveValue('8000');
    expect(api.calls(SEARCH)).toHaveLength(1);
  });

  it('ac11_sheet_invalid_and_clear', async () => {
    mockApi({ [SEARCH]: [results] });
    render('/search?pets=true');
    await screen.findAllByRole('article');
    openPanel();
    fireEvent.change(priceFrom(), { target: { value: '200000' } });
    submit();
    // Stays open, with the error on the focused field.
    expect(sheet()).toBeVisible();
    expect(within(sheet()).getByRole('alert')).toHaveTextContent(
      i18n.t('listings.errors.range', { min: 0, max: 100000 }),
    );
    expect(priceFrom()).toHaveFocus();
    expect(currentPath()).toBe('/search?pets=true');

    clearInSheet();
    expect(currentPath()).toBe('/search');
    expectSheetClosed();
    await vi.waitFor(() => {
      expect(liveRegion()).toHaveFocus();
    });
  });

  it('ac12_live_count_labels', async () => {
    let api = mockApi({ [SEARCH]: [results(), total(1), total(2), total(7), total(0)] });
    let view = render('/search');
    await screen.findAllByRole('article');
    openPanel();
    expect(submitButton()).toHaveTextContent(he.search.apply);
    expect(within(sheet()).getByRole('status')).toBeEmptyDOMElement();

    fireEvent.click(feature(he.search.feature.pets));
    await expectLabel(he.search.applyCount_one);
    expect(query(at(countRequests(api), 0).request)).toEqual(
      expected({
        listing_type: 'apartment',
        pets: 'true',
        sort: 'newest',
        limit: '1',
        offset: '0',
      }),
    );
    // Repeated for a screen reader, in a status that is not the results' `aria-live` line.
    const status = within(sheet()).getByRole('status');
    expect(status).toHaveTextContent(he.search.applyCount_one);
    expect(status).not.toHaveAttribute('aria-live');
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);

    fireEvent.click(feature(he.search.feature.furnished));
    await expectLabel(he.search.applyCount_two);
    fireEvent.click(feature(he.search.feature.elevator));
    await expectLabel(countLabel(7));
    // At zero the button says so and still works.
    fireEvent.click(feature(he.search.feature.parking));
    await expectLabel(he.search.applyNone);
    expect(submitButton()).toBeEnabled();
    submit();
    expect(currentPath()).toBe('/search?pets=true&furnished=true&elevator=true&parking=true');
    view.unmount();
    vi.unstubAllGlobals();

    // The same draft on the two sides is two counts, never one shared answer.
    const client = testQueryClient();
    api = mockApi({ [SEARCH]: [results(), total(3), results(), total(4)] });
    view = render('/search', client);
    await screen.findAllByRole('article');
    openPanel();
    fireEvent.click(feature(he.search.feature.pets));
    await expectLabel(countLabel(3));
    view.unmount();
    render('/market', client);
    await screen.findAllByRole('article');
    openPanel();
    fireEvent.click(feature(he.search.feature.pets));
    await expectLabel(countLabel(4));
    expect(
      countRequests(api).map(({ request }) =>
        new URL(request.url).searchParams.get('listing_type'),
      ),
    ).toEqual(['apartment', 'room']);
  });

  it('ac13_live_count_requests', async () => {
    // On load, with the sheet open, and for a draft back at the URL's filters: nothing.
    let api = mockApi({ [SEARCH]: [results] });
    let view = render('/search?pets=true');
    await screen.findAllByRole('article');
    await pastTheWait();
    openPanel();
    await pastTheWait();
    fireEvent.click(feature(he.search.feature.pets));
    fireEvent.click(feature(he.search.feature.pets));
    await pastTheWait();
    expect(countRequests(api)).toHaveLength(0);
    expect(submitButton()).toHaveTextContent(he.search.apply);

    // An invalid draft: nothing, whichever rule it breaks.
    fireEvent.change(priceFrom(), { target: { value: '200000' } });
    await pastTheWait();
    fireEvent.change(priceFrom(), { target: { value: '9000' } });
    fireEvent.change(priceTo(), { target: { value: '8000' } });
    await pastTheWait();
    expect(countRequests(api)).toHaveLength(0);
    view.unmount();
    vi.unstubAllGlobals();

    // The map view: nothing.
    api = mockApi({ [SEARCH]: [results] });
    view = render('/search?view=map');
    await vi.waitFor(() => lastProps());
    openPanel();
    fireEvent.click(feature(he.search.feature.pets));
    await pastTheWait();
    expect(countRequests(api)).toHaveLength(0);
    expect(submitButton()).toHaveTextContent(he.search.apply);
    expect(within(sheet()).queryByRole('status')).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // Rapid edits: one request, for the last draft.
    api = mockApi({ [SEARCH]: [results(), total(2)] });
    render('/search');
    await screen.findAllByRole('article');
    openPanel();
    fireEvent.click(feature(he.search.feature.pets));
    fireEvent.click(feature(he.search.feature.furnished));
    fireEvent.click(feature(he.search.feature.elevator));
    await expectLabel(he.search.applyCount_two);
    await pastTheWait();
    expect(countRequests(api)).toHaveLength(1);
    const sentParams = new URL(at(countRequests(api), 0).request.url).searchParams;
    expect(sentParams.get('pets')).toBe('true');
    expect(sentParams.get('elevator')).toBe('true');
  });

  it('ac13_count_waits_400ms_after_the_last_edit', async () => {
    const api = mockApi({ [SEARCH]: [results(), total(2)] });
    render('/search');
    await screen.findAllByRole('article');
    openPanel();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const advance = (ms: number) =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });
      fireEvent.click(feature(he.search.feature.pets));
      await advance(399);
      // Each edit starts the wait again.
      fireEvent.click(feature(he.search.feature.furnished));
      await advance(399);
      expect(countRequests(api)).toHaveLength(0);
      await advance(1);
      await advance(50);
      expect(countRequests(api)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ac14_live_count_stale_and_error', async () => {
    const slow = deferred();
    const api = mockApi({
      [SEARCH]: [
        results(),
        total(5),
        slow.promise,
        json({ detail: 'boom' }, 500),
        json({ detail: 'rate_limited' }, 429),
        total(8),
      ],
    });
    render('/search');
    await screen.findAllByRole('article');
    openPanel();
    fireEvent.click(feature(he.search.feature.pets));
    await expectLabel(countLabel(5));

    // Back at a draft already counted: the plain words while it waits, then its number, unasked.
    fireEvent.click(feature(he.search.feature.furnished));
    fireEvent.click(feature(he.search.feature.furnished));
    expect(submitButton()).toHaveTextContent(he.search.apply);
    await expectLabel(countLabel(5));
    expect(countRequests(api)).toHaveLength(1);

    // A newer draft: the old number goes at once, while it waits and while it loads.
    fireEvent.click(feature(he.search.feature.furnished));
    expect(submitButton()).toHaveTextContent(he.search.apply);
    expect(within(sheet()).getByRole('status')).toBeEmptyDOMElement();
    await vi.waitFor(() => {
      expect(countRequests(api)).toHaveLength(2);
    }, COUNT_TIMEOUT);
    expect(submitButton()).toHaveTextContent(he.search.apply);
    slow.resolve(total(6));
    await expectLabel(countLabel(6));

    // A failed count: the plain label and no message.
    fireEvent.click(feature(he.search.feature.elevator));
    await vi.waitFor(() => {
      expect(countRequests(api)).toHaveLength(3);
    }, COUNT_TIMEOUT);
    await settle();
    expect(submitButton()).toHaveTextContent(he.search.apply);
    expect(within(sheet()).queryByRole('alert')).toBeNull();

    // A 429: the plain label, and no more counts from this form.
    fireEvent.click(feature(he.search.feature.parking));
    await vi.waitFor(() => {
      expect(countRequests(api)).toHaveLength(4);
    }, COUNT_TIMEOUT);
    await settle();
    expect(submitButton()).toHaveTextContent(he.search.apply);
    fireEvent.click(feature(he.search.feature.shelter));
    await pastTheWait();
    expect(countRequests(api)).toHaveLength(4);
    expect(submitButton()).toHaveTextContent(he.search.apply);

    // A new form counts again (a draft not asked before: a fresh answer would be reused).
    closeSheet();
    openPanel();
    fireEvent.click(feature(he.search.feature.shelter));
    await expectLabel(countLabel(8));
    expect(countRequests(api)).toHaveLength(5);

    // Apply works whatever the count did.
    submit();
    expect(currentPath()).toBe('/search?shelter=true');
  });

  it('ac14_apply_works_while_the_count_loads', async () => {
    const slow = deferred();
    const api = mockApi({ [SEARCH]: [results(), slow.promise, results()] });
    render('/search');
    await screen.findAllByRole('article');
    openPanel();
    fireEvent.click(feature(he.search.feature.pets));
    await vi.waitFor(() => {
      expect(countRequests(api)).toHaveLength(1);
    }, COUNT_TIMEOUT);
    expect(submitButton()).toHaveTextContent(he.search.apply);
    submit();
    expect(currentPath()).toBe('/search?pets=true');
    expectSheetClosed();
    slow.resolve(total(1));
  });

  it('ac15_remove_tags', async () => {
    mockApi({ [SEARCH]: [results] });
    vi.mocked(capture).mockClear();
    const area = (id: string) => `area_ids=${id}`;
    const url =
      `/search?${area(haifa.id)}&${area(florentin.id)}&price_min=4000&price_max=8000` +
      '&rooms_min=3&rooms_max=3.5&available_by=2027-01-01&pets=true&sort=price_asc' +
      '&c=32.08%2C34.8&z=14';
    let view = render(url);
    await screen.findAllByRole('article');
    const list = () => within(screen.getByRole('list', { name: he.search.tags.label }));
    await vi.waitFor(() => {
      expect(list().getAllByRole('listitem')[0]).toHaveTextContent(haifa.name_he);
    });
    expect(list().getAllByRole('listitem')[1]).toHaveTextContent(FLORENTIN_LABEL);

    const steps: [string, string[], number][] = [
      [haifa.name_he, ['area_ids'], 7],
      ['4,000–8,000 ₪', ['price_min', 'price_max'], 5],
      ['חדרים: 3', ['rooms_min', 'rooms_max'], 3],
      [`כניסה עד ${formatDate('2027-01-01')}`, ['available_by'], 2],
      [he.search.feature.pets, ['pets'], 1],
    ];
    for (const [name, gone, left] of steps) {
      act(() => {
        document.body.focus();
      });
      fireEvent.click(list().getByRole('button', { name: removeLabel(name) }));
      for (const key of gone) {
        if (key !== 'area_ids') expect(params().has(key), key).toBe(false);
      }
      // The sort and the map's position stay.
      expect(params().get('sort')).toBe('price_asc');
      expect(params().get('c')).toBe('32.08,34.8');
      expect(params().get('z')).toBe('14');
      await vi.waitFor(() => {
        expect(liveRegion()).toHaveFocus();
      });
      expect(capture).toHaveBeenLastCalledWith('search_run', { type: 'apartment', filters: left });
    }
    // One area was removed, the other stays until its own tag goes.
    expect(params().getAll('area_ids')).toEqual([florentin.id]);
    fireEvent.click(list().getByRole('button', { name: removeLabel(FLORENTIN_LABEL) }));
    expect(params().has('area_ids')).toBe(false);
    expect(screen.queryByRole('list', { name: he.search.tags.label })).toBeNull();
    expect(capture).toHaveBeenLastCalledWith('search_run', { type: 'apartment', filters: 0 });
    // NF3: counts only, never a value.
    const events = JSON.stringify(vi.mocked(capture).mock.calls);
    expect(events).not.toContain(haifa.id);
    expect(events).not.toContain(florentin.id);
    expect(events).not.toContain('4000');
    view.unmount();
    vi.unstubAllGlobals();

    // The map view stays the map view.
    mockApi({ [SEARCH]: [results] });
    view = render('/search?pets=true&view=map&c=32.08%2C34.8&z=14');
    await vi.waitFor(() => lastProps());
    fireEvent.click(screen.getByRole('button', { name: removeLabel(he.search.feature.pets) }));
    expect(params().has('pets')).toBe(false);
    expect(params().get('view')).toBe('map');
    expect(params().get('c')).toBe('32.08,34.8');
  });

  it('ac16_area_tag_fallback', async () => {
    const fallback = he.search.tags.areaFallback;
    const tagButton = () => screen.getByRole('button', { name: removeLabel(fallback) });

    // `/areas` failed: the tag still shows, and goes.
    let api = mockApi({ [SEARCH]: [results], [AREAS]: [json({ detail: 'boom' }, 500)] });
    let view = render(`/search?area_ids=${haifa.id}`);
    await screen.findAllByRole('article');
    await vi.waitFor(() => {
      expect(api.calls(AREAS).length).toBeGreaterThan(0);
    });
    expect(tagButton()).toBeVisible();
    fireEvent.click(tagButton());
    expect(currentPath()).toBe('/search');
    view.unmount();
    vi.unstubAllGlobals();

    // An id the catalogue does not hold.
    const unknown = '00000000-0000-0000-0000-0000000dead0';
    mockApi({ [SEARCH]: [results] });
    view = render(`/search?area_ids=${unknown}`);
    await screen.findAllByRole('article');
    await settle();
    expect(tagButton()).toBeVisible();
    fireEvent.click(tagButton());
    expect(currentPath()).toBe('/search');
    view.unmount();
    vi.unstubAllGlobals();

    // While `/areas` loads; its answer then names the tag.
    const areas = deferred();
    mockApi({ [SEARCH]: [results], [AREAS]: [areas.promise] });
    view = render(`/search?area_ids=${haifa.id}`);
    await screen.findAllByRole('article');
    expect(tagButton()).toBeVisible();
    areas.resolve(json(CATALOGUE));
    expect(await screen.findByRole('button', { name: removeLabel(haifa.name_he) })).toBeVisible();
    view.unmount();
    vi.unstubAllGlobals();

    // Without an area filter the tags never ask for `/areas`.
    api = mockApi({ [SEARCH]: [results] });
    render('/search?pets=true');
    await screen.findAllByRole('article');
    await settle();
    expect(api.calls(AREAS)).toHaveLength(0);
  });

  it('ac17_rooms_url_range_kept', async () => {
    mockApi({ [SEARCH]: [results] });
    render('/search?rooms_min=2.5');
    await screen.findAllByRole('article');
    openPanel();
    expect(roomChipsChecked()).toEqual(['3', '4', he.search.roomsFivePlus]);
    // RTL must not turn "5+" into "+5".
    expect(roomChip(he.search.roomsFivePlus).labels?.[0]).toHaveAttribute('dir', 'ltr');
    // Another edit keeps the range the chips cannot express.
    fireEvent.click(feature(he.search.feature.pets));
    submit();
    expect(params().get('rooms_min')).toBe('2.5');
    expect(params().has('rooms_max')).toBe(false);

    // The first tap replaces it.
    openPanel();
    fireEvent.click(roomChip('4'));
    expect(roomChipsChecked()).toEqual(['4']);
    submit();
    expect(params().get('rooms_min')).toBe('4');
    expect(params().get('rooms_max')).toBe('4.5');

    // 5+ has no maximum.
    openPanel();
    fireEvent.click(roomChip('4'));
    fireEvent.click(roomChip(he.search.roomsFivePlus));
    submit();
    expect(params().get('rooms_min')).toBe('5');
    expect(params().has('rooms_max')).toBe(false);
  });

  it('ac18_list_apply_drops_old_position', async () => {
    const pin = '00000000-0000-0000-0000-00000000beef';
    const position = `c=32.08%2C34.8&z=14&pin=${pin}`;
    mockApi({ [SEARCH]: [results] });
    let view = render(`/search?${position}`);
    await screen.findAllByRole('article');
    openPanel();
    await pickerReady();
    pick(haifa.name_he);
    submit();
    expect(params().getAll('area_ids')).toEqual([haifa.id]);
    for (const key of ['c', 'z', 'pin']) expect(params().has(key), key).toBe(false);
    view.unmount();
    vi.unstubAllGlobals();

    // No new area: the position stays, also when an area is taken away.
    mockApi({ [SEARCH]: [results] });
    view = render(`/search?area_ids=${haifa.id}&area_ids=${florentin.id}&${position}`);
    await screen.findAllByRole('article');
    openPanel();
    await pickerReady();
    fireEvent.click(within(sheet()).getByRole('button', { name: removeLabel(haifa.name_he) }));
    fireEvent.click(feature(he.search.feature.pets));
    submit();
    expect(params().getAll('area_ids')).toEqual([florentin.id]);
    expect(params().get('c')).toBe('32.08,34.8');
    expect(params().get('pin')).toBe(pin);
    view.unmount();
    vi.unstubAllGlobals();

    // In the map view the map itself moves, so Apply leaves the position to it.
    mockApi({ [SEARCH]: [results] });
    render(`/search?view=map&${position}`);
    await vi.waitFor(() => lastProps());
    openPanel();
    await pickerReady();
    pick(haifa.name_he);
    submit();
    expect(params().get('c')).toBe('32.08,34.8');
  });
});
