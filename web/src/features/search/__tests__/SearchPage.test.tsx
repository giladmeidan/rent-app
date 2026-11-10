import { fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { currentPath, deferred, json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import { SearchPage } from '../SearchPage';
import { at, expected, listings, page, publicListing, query } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const SEARCH = 'GET /listings';

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

const openPanel = () => {
  fireEvent.click(screen.getByRole('button', { name: /^מסננים/ }));
};
const group = (name: string) => within(screen.getByRole('group', { name }));
const priceFrom = () => group(he.search.price).getByLabelText(he.search.from);
const priceTo = () => group(he.search.price).getByLabelText(he.search.to);
const roomsFrom = () => group(he.search.rooms).getByLabelText(he.search.from);
const roomsTo = () => group(he.search.rooms).getByLabelText(he.search.to);
const feature = (name: string) => screen.getByRole('checkbox', { name });
const apply = () => {
  fireEvent.click(screen.getByRole('button', { name: he.search.apply }));
};
const liveRegion = () => document.querySelector('[aria-live="polite"]');
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('SearchPage', () => {
  it('ac2_url_is_the_filter_state', async () => {
    // Valid filters: sent as they are, counted (sort is not a filter), shown in the form.
    let api = mockApi({ [SEARCH]: [json(page([]))] });
    let view = render('/search?price_max=8000&rooms_min=3&pets=true&sort=price_asc');
    expect(await screen.findByText(he.search.empty)).toBeVisible();
    await settle();
    expect(api.calls(SEARCH)).toHaveLength(1);
    expect(query(sent(api, 0))).toEqual(
      expected({
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
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(panel).not.toBeVisible();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toBeVisible();
    expect(priceFrom()).toHaveValue('');
    expect(priceTo()).toHaveValue('8000');
    expect(roomsFrom()).toHaveValue('3');
    expect(roomsTo()).toHaveValue('');
    expect(feature(he.search.feature.pets)).toBeChecked();
    expect(feature(he.search.feature.furnished)).not.toBeChecked();
    expect(screen.getByLabelText(he.search.sort.label)).toHaveValue('price_asc');
    view.unmount();
    vi.unstubAllGlobals();

    // Invalid values: dropped, so only paging is sent and nothing counts.
    api = mockApi({ [SEARCH]: [json(page([]))] });
    view = render(
      '/search?price_max=abc&rooms_min=2.3&pets=maybe&sort=match&available_by=2027-02-30&colour=red',
    );
    expect(await screen.findByText(he.search.empty)).toBeVisible();
    await settle();
    expect(api.calls(SEARCH)).toHaveLength(1);
    expect(query(sent(api, 0))).toEqual(expected({ limit: '20', offset: '0' }));
    expect(screen.getByRole('button', { name: he.search.filters })).toBeVisible();
    expect(screen.getByLabelText(he.search.sort.label)).toHaveValue('newest');
    view.unmount();
    vi.unstubAllGlobals();

    // A min above its max: the max is dropped.
    api = mockApi({ [SEARCH]: [json(page([]))] });
    render('/search?price_min=9000&price_max=8000');
    expect(await screen.findByText(he.search.empty)).toBeVisible();
    expect(api.calls(SEARCH)).toHaveLength(1);
    expect(query(sent(api, 0))).toEqual(expected({ price_min: '9000', limit: '20', offset: '0' }));
    expect(
      screen.getByRole('button', { name: i18n.t('search.filtersActive', { count: 1 }) }),
    ).toBeVisible();
  });

  it('ac3_apply_clear_back_and_validation', async () => {
    // Apply: the URL gets the filters (a new history entry) and a new request is sent.
    let api = mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    let view = render('/search');
    await screen.findByText(he.search.countOne);
    openPanel();
    fireEvent.change(priceTo(), { target: { value: '8000' } });
    fireEvent.click(feature(he.search.feature.pets));
    apply();
    expect(currentPath()).toBe('/search?price_max=8000&pets=true');
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(2);
    });
    expect(query(sent(api, 1))).toEqual(
      expected({ price_max: '8000', pets: 'true', limit: '20', offset: '0' }),
    );
    // The panel stays open across the URL change; the form shows the URL's values.
    expect(priceTo()).toHaveValue('8000');
    expect(feature(he.search.feature.pets)).toBeChecked();

    // Clear: an empty search, the form reset.
    fireEvent.click(screen.getByRole('button', { name: he.search.clear }));
    expect(currentPath()).toBe('/search');
    expect(priceTo()).toHaveValue('');
    expect(feature(he.search.feature.pets)).not.toBeChecked();

    // Back: the previous URL, and the form shows it again.
    fireEvent.click(screen.getByRole('button', { name: 'history-back' }));
    expect(currentPath()).toBe('/search?price_max=8000&pets=true');
    expect(priceTo()).toHaveValue('8000');
    expect(feature(he.search.feature.pets)).toBeChecked();

    // Unsaved edits are discarded by clear even when the URL is already clean.
    fireEvent.click(screen.getByRole('button', { name: he.search.clear }));
    fireEvent.change(priceFrom(), { target: { value: '12a3' } });
    expect(priceFrom()).toHaveValue('123');
    fireEvent.click(screen.getByRole('button', { name: he.search.clear }));
    expect(currentPath()).toBe('/search');
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

    // Rooms from > to: the error under the rooms "to" select.
    api = mockApi({ [SEARCH]: [json(page([]))] });
    view = render('/search');
    await screen.findByText(he.search.empty);
    openPanel();
    fireEvent.change(roomsFrom(), { target: { value: '4' } });
    fireEvent.change(roomsTo(), { target: { value: '3' } });
    apply();
    alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(he.search.errors.roomsOrder);
    expect(roomsTo()).toHaveAttribute('aria-describedby', alert.id);
    expect(roomsTo()).toHaveFocus();
    expect(currentPath()).toBe('/search');
    expect(api.calls(SEARCH)).toHaveLength(1);
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

  it('ac4_result_states', async () => {
    // Pending: three skeletons in a busy list; the live region is already mounted, empty.
    const pending = deferred();
    mockApi({ [SEARCH]: [pending.promise] });
    let view = render('/search');
    expect(screen.getByRole('heading', { level: 1, name: he.search.title })).toBeVisible();
    const busy = screen.getByRole('list', { name: he.common.loading });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(busy).getAllByTestId('skeleton')).toHaveLength(3);
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
    expect(await screen.findByText(he.search.countOne)).toBeVisible();
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
    expect((await screen.findByText('3 דירות')).closest('[aria-live="polite"]')).not.toBeNull();
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(3);
    cards.forEach((card, i) => {
      const item = at(three, i);
      const title = i18n.t('listings.card.title', {
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
    expect(query(sent(api, 1))).toEqual(expected({ pets: 'true', limit: '20', offset: '20' }));
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
    expect(query(sent(api, 2))).toEqual(expected({ pets: 'true', limit: '20', offset: '20' }));
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
    const api = mockApi({ [SEARCH]: [json(page([]))] });
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
      expected({ pets: 'true', sort: 'price_desc', limit: '20', offset: '0' }),
    );
    expect(select).toHaveValue('price_desc');
  });
});
