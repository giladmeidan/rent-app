import { fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import {
  currentPath,
  deferred,
  json,
  mockApi,
  noa,
  renderRoutes,
} from '../../auth/__tests__/harness';
import { owner } from '../../listings/__tests__/fixtures';
import { inDays, profile } from '../../profile/__tests__/fixtures';
import { SearchPage } from '../SearchPage';
import { at, expected, listings, page, publicListing, query } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const SEARCH = 'GET /listings';
const ME = 'GET /me';
const PROFILE = 'GET /me/profile';
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
    let api = mockApi({ [SEARCH]: [json(page([], 0, 'price_asc'))] });
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
      '/search?price_max=abc&rooms_min=2.3&pets=maybe&sort=foo&available_by=2027-02-30&colour=red',
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
      expected({ pets: 'true', sort: 'price_desc', limit: '20', offset: '0' }),
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
    // The listing's own chips are a separate list.
    expect(within(first).getByTestId('listing-chips')).not.toHaveTextContent('בתקציב');
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
    expect(query(sent(api, 0))).toEqual(expected({ limit: '20', offset: '0' }));
    // Choosing newest: in the URL and the request.
    fireEvent.change(select(), { target: { value: 'newest' } });
    expect(currentPath()).toBe('/search?sort=newest');
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(2);
    });
    expect(query(sent(api, 1))).toEqual(expected({ sort: 'newest', limit: '20', offset: '0' }));
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
    expect(query(sent(api, 0))).toEqual(expected({ sort: 'match', limit: '20', offset: '0' }));
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
      `/me/profile?next=${encodeURIComponent('/search?price_max=8000&pets=true')}`,
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

    // A visitor and an owner: no nudge, and the profile is never requested.
    for (const me of [unauthenticated(), json(owner)]) {
      api = mockApi({ [ME]: [me], [PROFILE]: [noProfile()], [SEARCH]: [json(page([]))] });
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
    }
  });

  it('ac2_type_filter', async () => {
    const typeGroup = () => group(he.search.type.legend);
    const apartmentBox = () =>
      typeGroup().getByRole('checkbox', { name: he.search.type.apartment });
    const roomBox = () => typeGroup().getByRole('checkbox', { name: he.search.type.room });

    // Both on by default, and nothing is sent for them.
    let api = mockApi({ [SEARCH]: [json(page([publicListing()]))] });
    let view = render('/search');
    await screen.findByText(i18n.t('search.count', { count: 1 }));
    openPanel();
    expect(apartmentBox()).toBeChecked();
    expect(roomBox()).toBeChecked();
    expect(apartmentBox()).toBeEnabled();
    expect(roomBox()).toBeEnabled();
    expect(screen.queryByText(he.search.type.hint)).toBeNull();
    expect(apartmentBox()).not.toHaveAttribute('aria-describedby');
    expect(query(sent(api, 0))).toEqual(expected({ limit: '20', offset: '0' }));

    // Rooms only: in the URL and the request, one active filter, the last box locked and explained.
    fireEvent.click(apartmentBox());
    apply();
    expect(currentPath()).toBe('/search?listing_type=room');
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(2);
    });
    expect(query(sent(api, 1))).toEqual(
      expected({ listing_type: 'room', limit: '20', offset: '0' }),
    );
    expect(
      screen.getByRole('button', { name: i18n.t('search.filtersActive', { count: 1 }) }),
    ).toBeVisible();
    expect(apartmentBox()).not.toBeChecked();
    expect(roomBox()).toBeChecked();
    expect(roomBox()).toBeDisabled();
    expect(apartmentBox()).toBeEnabled();
    expect(screen.getByText(he.search.type.hint)).toBeVisible();
    expect(roomBox()).toHaveAccessibleDescription(he.search.type.hint);
    expect(apartmentBox()).toHaveAccessibleDescription(he.search.type.hint);

    // Both again: the key goes.
    fireEvent.click(apartmentBox());
    expect(screen.queryByText(he.search.type.hint)).toBeNull();
    expect(roomBox()).toBeEnabled();
    apply();
    expect(currentPath()).toBe('/search');
    await vi.waitFor(() => {
      expect(api.calls(SEARCH)).toHaveLength(3);
    });
    expect(query(sent(api, 2))).toEqual(expected({ limit: '20', offset: '0' }));
    view.unmount();
    vi.unstubAllGlobals();

    // From the URL: apartments only; a type with no results offers "ניקוי", which re-checks both.
    api = mockApi({ [SEARCH]: [json(page([], 0)), json(page([publicListing()]))] });
    view = render('/search?listing_type=apartment');
    expect(await screen.findByText(he.search.empty)).toBeVisible();
    expect(query(sent(api, 0))).toEqual(
      expected({ listing_type: 'apartment', limit: '20', offset: '0' }),
    );
    openPanel();
    expect(apartmentBox()).toBeChecked();
    expect(apartmentBox()).toBeDisabled();
    expect(roomBox()).not.toBeChecked();
    fireEvent.click(screen.getAllByRole('button', { name: he.search.clear })[0] as HTMLElement);
    expect(currentPath()).toBe('/search');
    expect(apartmentBox()).toBeChecked();
    expect(roomBox()).toBeChecked();
    expect(screen.queryByText(he.search.type.hint)).toBeNull();
    view.unmount();
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
    const listChips = (street: string) =>
      within(within(cardOf(street)).getByTestId('listing-chips'))
        .getAllByRole('listitem')
        .map((li) => li.textContent);
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
    let view = render('/search');
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
      view = render('/search');
      await screen.findByText(i18n.t('search.count', { count: 2 }));
      await vi.waitFor(() => {
        expect(api.calls(PROFILE)).toHaveLength(1);
      });
      await settle();
      expect(screen.queryByText(he.rooms.card.similarAge)).toBeNull();
      view.unmount();
      vi.unstubAllGlobals();
    }

    // A visitor and an owner: no chip, and no profile request.
    for (const me of [unauthenticated(), json(owner)]) {
      api = mockApi({
        [ME]: [me],
        [PROFILE]: [json(profile({ birth_year: year - 28 }))],
        [SEARCH]: [json(page([room, flat]))],
      });
      view = render('/search');
      await screen.findByText(i18n.t('search.count', { count: 2 }));
      await vi.waitFor(() => {
        expect(api.calls(ME)).toHaveLength(1);
      });
      await settle();
      expect(screen.queryByText(he.rooms.card.similarAge)).toBeNull();
      expect(api.calls(PROFILE)).toHaveLength(0);
      view.unmount();
      vi.unstubAllGlobals();
    }
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
    render('/search');
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
});
