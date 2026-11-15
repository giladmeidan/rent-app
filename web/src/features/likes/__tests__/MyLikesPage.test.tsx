import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { empty, json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import { RequireSeeker } from '../../auth/RequireSeeker';
import { seeker } from '../../listings/__tests__/fixtures';
import { MyLikesPage } from '../MyLikesPage';
import { personCard } from '../../people/__tests__/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const LIKES = 'GET /me/likes';
const PROFILE = 'GET /me/profile';
const routes = (
  <Routes>
    <Route path="/login" element={<p>login</p>} />
    <Route element={<RequireSeeker />}>
      <Route path="/me/likes" element={<MyLikesPage />} />
    </Route>
  </Routes>
);
const PEOPLE_LIKES = 'GET /me/people-likes';
const noPeople = { liked_me: [], mine: [], matches: [] };
const render = (replies: Parameters<typeof mockApi>[0]) => {
  // The seeker's profile words the match chips; none by default (a 404 would also do). The people
  // sections (spec 0010i) are empty unless a test says otherwise.
  const api = mockApi({
    'GET /me': [json(seeker)],
    [PROFILE]: [() => json(null)],
    [PEOPLE_LIKES]: [json(noPeople)],
    ...replies,
  });
  renderRoutes('/me/likes', routes);
  return api;
};
const section = (name: string) => screen.getByRole('region', { name });
const noRoomSections = () => {
  // Spec 0010m: people only. The page itself never asks for the room invites (they moved to the
  // room applications; the market nav's badge is the only other reader, and it is not mounted here).
  expect(screen.queryByRole('heading', { name: 'הזמנות לחדרים' })).toBeNull();
};

describe('MyLikesPage', () => {
  it('ac6_rate_limited_likes_page_says_when', async () => {
    render({
      [PEOPLE_LIKES]: [json({ detail: 'rate_limited' }, 429, { 'Retry-After': '60' })],
    });
    expect(
      await screen.findByText('צפיתם בהרבה כרטיסים בזמן קצר. אפשר לחזור לזה בעוד דקה.'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
    cleanup();

    render({ [PEOPLE_LIKES]: [json({ detail: 'rate_limited' }, 429)] });
    expect(await screen.findByText(he.people.browseRateLimited)).toBeVisible();
    cleanup();

    render({ [PEOPLE_LIKES]: [json({ detail: 'boom' }, 500)] });
    expect(await screen.findByRole('button', { name: he.common.retry })).toBeVisible();
  });

  it('ac4_banner_and_one_mascot', async () => {
    // The banner (a person match, spec 0010i): a status on accent-soft, accent-strong text, an ink
    // button focused on mount.
    const a = personCard({ display_name: 'Ada', liked_me: true });
    const chatId = '00000000-0000-0000-0000-00000000ccc3';
    render({
      [PEOPLE_LIKES]: [json({ liked_me: [a], mine: [], matches: [] })],
      [`PUT /people/${a.card_id}/like`]: [json({ liked: true, conversation_id: chatId })],
      'GET /conversations': [json([])],
    });
    const people = within(await screen.findByRole('region', { name: he.likes.people.likedMe }));
    fireEvent.click(people.getByRole('button', { name: he.market.people.like }));
    const text = await screen.findByText(he.likes.mutual);
    const banner = text.closest<HTMLElement>('[role="status"]') as HTMLElement;
    expect(banner).toHaveClass('bg-accent-soft', 'rounded-lg');
    expect(text).toHaveClass('text-accent-strong');
    const chat = within(banner).getByRole('link', { name: he.likes.toChat });
    expect(chat).toHaveAttribute('href', `/chat/${chatId}`);
    expect(chat).toHaveClass('bg-ink', 'text-on-ink');
    expect(chat).not.toHaveClass('bg-accent');
    await vi.waitFor(() => {
      expect(chat).toHaveFocus();
    });
  });

  it('ac17_people_sections_cards_and_matches', async () => {
    const a = personCard({ display_name: 'Ada', liked_me: true });
    const b = personCard({ display_name: 'Bo', liked_by_me: true });
    const match = {
      conversation_id: '00000000-0000-0000-0000-00000000ccc1',
      display_name: 'Cy',
      photo_url: null,
      matched_at: '2026-11-12T09:00:00Z',
    };
    const newChat = '00000000-0000-0000-0000-00000000ccc2';
    const api = render({
      [PEOPLE_LIKES]: [json({ liked_me: [a], mine: [b], matches: [match] })],
      [`PUT /people/${a.card_id}/like`]: [json({ liked: true, conversation_id: newChat })],
      [`DELETE /people/${b.card_id}/like`]: [empty()],
      'GET /conversations': [json([])],
    });
    const likedMe = within(await screen.findByRole('region', { name: he.likes.people.likedMe }));
    const mine = within(section(he.likes.people.mine));
    const matches = within(section(he.likes.people.matches));
    expect(likedMe.getByRole('heading', { level: 3, name: 'Ada' })).toBeVisible();
    expect(likedMe.getByText(he.market.people.likedMe)).toBeVisible();
    expect(mine.getByRole('heading', { level: 3, name: 'Bo' })).toBeVisible();
    expect(mine.getByRole('button', { name: he.market.people.like })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // A match: a compact row, avatar, name and a "לצ'אט" link.
    expect(matches.getByText('Cy')).toBeVisible();
    expect(matches.getByRole('link', { name: he.likes.toChat })).toHaveAttribute(
      'href',
      `/chat/${match.conversation_id}`,
    );
    expect(matches.queryByRole('article')).toBeNull();

    // Unlike from "mine": the DELETE, the card stays (the button shows the new state).
    fireEvent.click(mine.getByRole('button', { name: he.market.people.like }));
    await vi.waitFor(() => {
      expect(mine.getByRole('button', { name: he.market.people.like })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });
    expect(api.calls(`DELETE /people/${b.card_id}/like`)).toHaveLength(1);

    // Like back from "liked me": the banner, and the card becomes a match row.
    fireEvent.click(likedMe.getByRole('button', { name: he.market.people.like }));
    // The banner above the lists, then the new match (newest first), then the old one.
    await vi.waitFor(() => {
      const chat = screen.getAllByRole('link', { name: he.likes.toChat });
      expect(chat.map((l) => l.getAttribute('href'))).toEqual([
        `/chat/${newChat}`,
        `/chat/${newChat}`,
        `/chat/${match.conversation_id}`,
      ]);
    });
    expect(screen.getByText(he.likes.mutual)).toBeVisible();
    expect(await screen.findByText(he.likes.people.likedMeEmpty)).toBeVisible();
    expect(matches.getByText('Ada')).toBeVisible();
    // Edited in place: no refetch of either list.
    expect(api.calls(PEOPLE_LIKES)).toHaveLength(1);
    expect(api.calls(LIKES)).toHaveLength(0);
  });

  it('people_lists_scroll_in_a_row_with_arrows', async () => {
    const many = ['A', 'B', 'C', 'D'].map((n) =>
      personCard({ display_name: n, liked_by_me: true }),
    );
    const one = personCard({ display_name: 'Ada', liked_me: true });
    render({ [PEOPLE_LIKES]: [json({ liked_me: [one], mine: many, matches: [] })] });
    const mine = within(await screen.findByRole('region', { name: he.likes.people.mine }));
    expect(mine.getByRole('list')).toHaveClass('grid-flow-col', 'overflow-x-auto');
    const next = mine.getByRole('button', {
      name: he.likes.scrollNext.replace('{{section}}', he.likes.people.mine),
    });
    // 4 cards: the arrows show from md and at xl (more than 3).
    expect(next.parentElement).toHaveClass('hidden', 'md:flex');
    expect(next.parentElement).not.toHaveClass('xl:hidden');
    const scrollBy = vi.fn();
    mine.getByRole('list').scrollBy = scrollBy;
    fireEvent.click(next);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    // One card fits at every width: no arrows.
    const likedMe = within(section(he.likes.people.likedMe));
    const prev = likedMe.getByRole('button', {
      name: he.likes.scrollPrev.replace('{{section}}', he.likes.people.likedMe),
      hidden: true,
    });
    expect(prev.parentElement).not.toHaveClass('md:flex');
  });

  it('ac17_people_empty_states', async () => {
    const api = render({});
    expect(await screen.findByText(he.likes.people.likedMeEmpty)).toBeVisible();
    expect(screen.getByText(he.likes.people.mineEmpty)).toBeVisible();
    expect(screen.getByText(he.likes.people.matchesEmpty)).toBeVisible();
    for (const name of [he.likes.people.likedMe, he.likes.people.mine, he.likes.people.matches]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    // Spec 0010m AC8: people only; the page makes no `/me/likes` request of its own.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      he.likes.people.likedMe,
      he.likes.people.mine,
      he.likes.people.matches,
    ]);
    noRoomSections();
    expect(api.calls(LIKES)).toHaveLength(0);
  });

  it('ac17_people_card_required_is_one_nudge', async () => {
    render({
      [PEOPLE_LIKES]: [json({ detail: 'card_required' }, 403)],
    });
    expect(await screen.findByText(he.likes.people.cardRequired)).toBeVisible();
    expect(screen.getByRole('link', { name: he.market.people.toProfile })).toHaveAttribute(
      'href',
      '/me/profile?section=about&section=looking&next=%2Fme%2Flikes',
    );
    // In place of the three sections.
    for (const name of [he.likes.people.likedMe, he.likes.people.mine, he.likes.people.matches]) {
      expect(screen.queryByRole('heading', { name })).toBeNull();
    }
  });

  it('ac17_people_error_has_its_own_retry', async () => {
    const api = render({
      [PEOPLE_LIKES]: [json({ detail: 'boom' }, 500), json(noPeople)],
    });
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await screen.findByText(he.likes.people.matchesEmpty)).toBeVisible();
    expect(api.calls(PEOPLE_LIKES)).toHaveLength(2);
    expect(api.calls(LIKES)).toHaveLength(0);
  });

  it('ac16_report_person', async () => {
    const r = he.report;
    const a = personCard({ display_name: 'Ada', liked_me: true });
    const api = render({
      [PEOPLE_LIKES]: [json({ liked_me: [a], mine: [], matches: [] })],
      'POST /reports': [json({ already_reported: true }, 200)],
    });
    const people = within(await screen.findByRole('region', { name: he.likes.people.likedMe }));
    const card = people.getByRole('article', { name: 'Ada' });
    const report = within(card).getByRole('button', { name: r.button });
    expect(report).toHaveAccessibleDescription('Ada');
    fireEvent.click(report);
    const dialog = screen.getByRole('dialog', { name: 'דיווח על Ada' });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(5);
    fireEvent.click(within(dialog).getByRole('radio', { name: r.reasons.misleading }));
    fireEvent.click(within(dialog).getByRole('button', { name: r.submit }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent(r.already);
    expect(api.calls('POST /reports')[0]?.body).toEqual({
      target_type: 'person',
      target_id: a.card_id,
      reason: 'misleading',
      note: null,
    });
  });
});
