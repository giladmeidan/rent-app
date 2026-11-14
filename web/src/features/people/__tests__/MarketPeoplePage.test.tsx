import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import {
  deferred,
  empty,
  json,
  mockApi,
  renderRoutes,
  testQueryClient,
} from '../../auth/__tests__/harness';
import { RequireUser } from '../../auth/RequireUser';
import { clearSession } from '../../auth/useLogout';
import { gushDan, seeker } from '../../listings/__tests__/fixtures';
import { profile } from '../../profile/__tests__/fixtures';
import { MarketPeoplePage } from '../MarketPeoplePage';
import { MARKET_PEOPLE_KEY, PEOPLE_LIKES_KEY } from '../useMarketPeople';
import { personCard } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Reply = Parameters<typeof mockApi>[0][string][number];

const PEOPLE = 'GET /people';
const PROFILE = 'GET /me/profile';
const likeRoute = (method: 'PUT' | 'DELETE', c: { card_id: string }) =>
  `${method} /people/${c.card_id}/like`;
const GIVATAYIM = { id: '00000000-0000-0000-0000-00000000a2a2', slug: 'g', name_he: 'גבעתיים' };
const CHAT_ID = '00000000-0000-0000-0000-00000000cccc';

const routes = (
  <Routes>
    <Route path="/login" element={<p>login</p>} />
    <Route element={<RequireUser />}>
      <Route path="/market/people" element={<MarketPeoplePage />} />
    </Route>
    <Route path="/chat/:id" element={<p>chat thread</p>} />
  </Routes>
);

function renderPage(
  pages: Reply[],
  {
    extra = {},
    lifestyle = {},
    client = testQueryClient(),
  }: {
    extra?: Record<string, Reply[]>;
    /** The viewer's own answers. */
    lifestyle?: Record<string, 1 | 2 | 3>;
    client?: QueryClient;
  } = {},
) {
  const api = mockApi({
    'GET /me': [json(seeker)],
    'GET /areas': [json([gushDan, GIVATAYIM])],
    [PROFILE]: [json(profile({ lifestyle }))],
    [PEOPLE]: pages,
    'GET /conversations': [json([])],
    ...extra,
  });
  const view = renderRoutes('/market/people', routes, client);
  return { api, view, client };
}

const page = (items: ReturnType<typeof personCard>[], total = items.length) =>
  json({ items, total });
const cards = () => screen.getAllByRole('article');
const cardOf = (name: string) => screen.getByRole('article', { name });
const likeButton = (name: string) =>
  within(cardOf(name)).getByRole('button', { name: he.market.people.like });
const offsets = (api: ReturnType<typeof mockApi>) =>
  api.calls(PEOPLE).map((c) => new URL(c.request.url).searchParams.get('offset'));
const banner = () => screen.queryByRole('link', { name: he.likes.toChat });

describe('MarketPeoplePage', () => {
  it('ac15_list_count_cards_and_badge', async () => {
    const c1 = personCard({
      display_name: 'C1',
      liked_me: true,
      age: 31,
      area_ids: [gushDan.id, GIVATAYIM.id],
      about_me: 'line one\nline two',
      move_in_flexible: true,
    });
    const c2 = personCard({ display_name: 'C2', gender: 'man', age: null, about_me: null });
    renderPage([page([c1, c2])]);
    await screen.findAllByRole('article');
    expect(screen.getByRole('heading', { level: 1, name: he.market.people.title })).toBeVisible();
    expect(screen.getByText(i18n.t('market.people.count', { count: 2 }))).toBeVisible();
    expect(cards().map((c) => within(c).getByRole('heading', { level: 2 }).textContent)).toEqual([
      'C1',
      'C2',
    ]);
    const one = within(cardOf('C1'));
    expect(one.getByText(he.market.people.likedMe)).toBeVisible();
    expect(one.getByText('אישה · גיל 31')).toBeVisible();
    expect(one.getByText('אזורים: גוש דן וגבעתיים')).toBeVisible();
    expect(one.getByText(new RegExp(he.applicants.flexible))).toBeVisible();
    // About me is plain text: line breaks kept, never a link.
    const about = one.getByTestId('market-person-about');
    expect(about.textContent).toBe('line one\nline two');
    expect(about).toHaveAttribute('dir', 'auto');
    expect(one.queryByRole('link')).toBeNull();
    const two = within(cardOf('C2'));
    expect(two.queryByText(he.market.people.likedMe)).toBeNull();
    expect(two.getByText('גבר')).toBeVisible();
    expect(two.queryByTestId('market-person-about')).toBeNull();
  });

  it('ac15_count_one', async () => {
    renderPage([page([personCard({ display_name: 'C1' })], 1)]);
    await screen.findAllByRole('article');
    expect(screen.getByText(he.market.people.count_one)).toBeVisible();
  });

  it('ac15_questionnaire_line_from_the_viewers_answers', async () => {
    // Three shared topics, two the same (cleanliness, guests), one different (night). Shabbat is
    // answered by the viewer only: not shared.
    const c1 = personCard({
      display_name: 'C1',
      lifestyle: { cleanliness: 2, guests: 1, night: 1 },
    });
    // Nothing shared: no line at all.
    const c2 = personCard({ display_name: 'C2', lifestyle: { kosher: 3 } });
    const c3 = personCard({ display_name: 'C3', lifestyle: {} });
    renderPage([page([c1, c2, c3])], {
      lifestyle: { cleanliness: 2, guests: 1, night: 3, shabbat: 2 },
    });
    await screen.findAllByRole('article');
    const line = within(cardOf('C1')).getByTestId('market-person-alike');
    expect(within(line).getByText('2 מתוך 3 תשובות דומות')).toBeVisible();
    expect(within(line).getByText(`שונה: ${he.lifestyle.night.topic}`)).toBeVisible();
    expect(within(cardOf('C2')).queryByTestId('market-person-alike')).toBeNull();
    expect(within(cardOf('C3')).queryByTestId('market-person-alike')).toBeNull();
  });

  it('ac15_all_alike_shows_no_differing_topics', async () => {
    renderPage([page([personCard({ display_name: 'C1', lifestyle: { guests: 2 } })])], {
      lifestyle: { guests: 2 },
    });
    await screen.findAllByRole('article');
    const line = within(cardOf('C1')).getByTestId('market-person-alike');
    expect(line).toHaveTextContent('1 מתוך 1 תשובות דומות');
    expect(line.textContent).not.toContain('שונה');
  });

  it('ac15_load_more', async () => {
    const first = Array.from({ length: 2 }, (_, i) =>
      personCard({ display_name: `A${String(i)}` }),
    );
    const second = [personCard({ display_name: 'B0' })];
    const { api } = renderPage([page(first, 3), page(second, 3)]);
    await screen.findAllByRole('article');
    expect(cards()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: he.people.loadMore }));
    await waitFor(() => {
      expect(cards()).toHaveLength(3);
    });
    expect(offsets(api)).toEqual(['0', '2']);
    // The last page: no more button; focus moved to the first new card.
    expect(screen.queryByRole('button', { name: he.people.loadMore })).toBeNull();
    await waitFor(() => {
      expect(cardOf('B0')).toHaveFocus();
    });
  });

  it('ac15_page_states', async () => {
    // Loading: a busy block of skeletons.
    const pending = deferred();
    let run = renderPage([pending.promise]);
    await screen.findByRole('heading', { level: 1, name: he.market.people.title });
    const busy = screen.getByText(he.common.loading).closest<HTMLElement>('[aria-busy="true"]');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(busy as HTMLElement).getAllByTestId('skeleton')).toHaveLength(3);
    run.view.unmount();
    vi.unstubAllGlobals();

    // Empty.
    run = renderPage([page([])]);
    expect(await screen.findByText(he.market.people.empty)).toBeVisible();
    run.view.unmount();
    vi.unstubAllGlobals();

    // 403 card_required: the nudge, with the profile link opening both parts.
    run = renderPage([json({ detail: 'card_required' }, 403)]);
    expect(await screen.findByText(he.market.people.cardRequired)).toBeVisible();
    expect(screen.getByRole('link', { name: he.market.people.toProfile })).toHaveAttribute(
      'href',
      '/me/profile?section=about&section=looking&next=%2Fmarket%2Fpeople',
    );
    expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
    run.view.unmount();
    vi.unstubAllGlobals();

    // 429: the text, and no retry button (a retry would only make more counted calls).
    run = renderPage([json({ detail: 'rate_limited' }, 429)]);
    expect(await screen.findByText(he.people.browseRateLimited)).toBeVisible();
    expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
    expect(run.api.calls(PEOPLE)).toHaveLength(1);
    run.view.unmount();
    vi.unstubAllGlobals();

    // A 500: ErrorState, and retry refetches.
    run = renderPage([json({ detail: 'boom' }, 500), page([personCard({ display_name: 'C1' })])]);
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await screen.findByRole('article', { name: 'C1' })).toBeVisible();
    expect(run.api.calls(PEOPLE)).toHaveLength(2);
  });

  it('ac15_like_toggle_edits_the_cache_and_sends_no_get', async () => {
    const c1 = personCard({ display_name: 'C1' });
    const c2 = personCard({ display_name: 'C2' });
    const pending = deferred();
    const { api, client } = renderPage([page([c1, c2])], {
      extra: {
        [likeRoute('PUT', c2)]: [pending.promise],
        [likeRoute('DELETE', c2)]: [empty()],
      },
    });
    await screen.findAllByRole('article');
    const button = () => likeButton('C2');
    expect(button()).toHaveAttribute('aria-pressed', 'false');
    button().focus();
    fireEvent.click(button());
    // In flight: aria-disabled (still focusable), a second click is a no-op.
    await waitFor(() => {
      expect(button()).toHaveAttribute('aria-disabled', 'true');
    });
    expect(button()).toHaveFocus();
    fireEvent.click(button());
    pending.resolve(json({ liked: true, conversation_id: null }));
    await waitFor(() => {
      expect(button()).toHaveAttribute('aria-pressed', 'true');
    });
    // One unchanged name: the tick is decoration, `aria-pressed` carries the state.
    expect(button()).toHaveAccessibleName(he.market.people.like);
    expect(api.calls(likeRoute('PUT', c2))).toHaveLength(1);
    expect(banner()).toBeNull();
    // The cache was edited in place: no new page request, the other card untouched.
    expect(api.calls(PEOPLE)).toHaveLength(1);
    expect(likeButton('C1')).toHaveAttribute('aria-pressed', 'false');
    const cached = client.getQueryData<{ pages: { items: { liked_by_me: boolean }[] }[] }>(
      MARKET_PEOPLE_KEY,
    );
    expect(cached?.pages[0]?.items.map((c) => c.liked_by_me)).toEqual([false, true]);

    fireEvent.click(button());
    await waitFor(() => {
      expect(button()).toHaveAttribute('aria-pressed', 'false');
    });
    expect(api.calls(likeRoute('DELETE', c2))).toHaveLength(1);
    expect(api.calls(PEOPLE)).toHaveLength(1);
    expect(screen.queryAllByRole('alert').filter((a) => a.textContent !== '')).toHaveLength(0);
  });

  it('ac15_mutual_banner_links_to_the_chat_and_takes_focus', async () => {
    const c1 = personCard({ display_name: 'C1', liked_me: true });
    const c2 = personCard({ display_name: 'C2' });
    const { api } = renderPage([page([c1, c2], 2)], {
      extra: { [likeRoute('PUT', c1)]: [json({ liked: true, conversation_id: CHAT_ID })] },
    });
    await screen.findAllByRole('article');
    fireEvent.click(likeButton('C1'));
    const link = await waitFor(() => {
      const found = banner();
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(link).toHaveAttribute('href', `/chat/${CHAT_ID}`);
    expect(screen.getByText(he.likes.mutual)).toBeVisible();
    expect(link).toHaveFocus();
    // The card is now a match: it leaves the list, and the count drops with it. The banner stays.
    expect(screen.queryByRole('article', { name: 'C1' })).toBeNull();
    expect(cards()).toHaveLength(1);
    expect(screen.getByText(he.market.people.count_one)).toBeVisible();
    expect(banner()).toBe(link);
    expect(api.calls(PEOPLE)).toHaveLength(1);
  });

  it('ac15_like_errors', async () => {
    const c1 = personCard({ display_name: 'C1' });
    const c2 = personCard({ display_name: 'C2' });
    const c3 = personCard({ display_name: 'C3' });
    const { api } = renderPage([page([c1, c2, c3])], {
      extra: {
        [likeRoute('PUT', c1)]: [json({ detail: 'rate_limited' }, 429)],
        [likeRoute('PUT', c2)]: [json({ detail: 'card_required' }, 403)],
        [likeRoute('PUT', c3)]: [json({ detail: 'not_found' }, 404)],
      },
    });
    await screen.findAllByRole('article');

    // 429: the room side's text, under the card; the button stays unpressed.
    fireEvent.click(likeButton('C1'));
    expect(await within(cardOf('C1')).findByRole('alert')).toHaveTextContent(
      he.people.errors.rateLimited,
    );
    expect(likeButton('C1')).toHaveAttribute('aria-pressed', 'false');

    // 403 card_required (a lister of a live room without a card): the nudge, with the profile link.
    fireEvent.click(likeButton('C2'));
    const alert = await within(cardOf('C2')).findByRole('alert');
    expect(alert).toHaveTextContent(he.market.people.likeNeedsCard);
    expect(within(alert).getByRole('link', { name: he.market.people.toProfile })).toHaveAttribute(
      'href',
      '/me/profile?section=about&section=looking&next=%2Fmarket%2Fpeople',
    );

    // 404: the card is gone: it leaves the list and the page says so, focused.
    fireEvent.click(likeButton('C3'));
    await waitFor(() => {
      expect(screen.queryByRole('article', { name: 'C3' })).toBeNull();
    });
    const gone = screen.getByText(he.market.people.gone).closest<HTMLElement>('[role="alert"]');
    expect(gone).toHaveFocus();
    expect(cards()).toHaveLength(2);
    expect(api.calls(PEOPLE)).toHaveLength(1);
  });

  it('ac15_logout_forgets_the_browse_pages_and_the_likes', () => {
    // The next person on this device must not see the last one's people.
    const client = testQueryClient();
    client.setQueryData(MARKET_PEOPLE_KEY, {
      pages: [{ items: [personCard()], total: 1 }],
      pageParams: [0],
    });
    client.setQueryData(PEOPLE_LIKES_KEY, { liked_me: [], mine: [], matches: [] });
    clearSession(client);
    expect(client.getQueryData(MARKET_PEOPLE_KEY)).toBeUndefined();
    expect(client.getQueryData(PEOPLE_LIKES_KEY)).toBeUndefined();
  });
});
