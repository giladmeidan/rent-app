import { cleanup as unmount, fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { deferred, empty, json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import { RequireSeeker } from '../../auth/RequireSeeker';
import { seeker } from '../../listings/__tests__/fixtures';
import { profile } from '../../profile/__tests__/fixtures';
import { MyLikesPage } from '../MyLikesPage';
import { personCard } from '../../people/__tests__/fixtures';
import { likedRoom, myLikes } from './fixtures';

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

describe('MyLikesPage', () => {
  it('ac11_invites_without_mine_or_like_button', async () => {
    // Spec 0010l AC11: one room section, "rooms that liked me"; each card is a plain link to the
    // room's page (where the seeker applies); no "rooms I liked" and no like button.
    const a = likedRoom();
    const b = likedRoom();
    const api = render({ [LIKES]: [json(myLikes([a, b]))] });

    expect(await screen.findByRole('heading', { level: 1, name: he.likes.title })).toBeVisible();
    const likedMe = within(await screen.findByRole('region', { name: he.likes.likedMe }));
    expect(likedMe.getAllByRole('article')).toHaveLength(2);
    expect(likedMe.queryAllByRole('button')).toHaveLength(0);
    const links = screen
      .getAllByRole('link')
      .map((l) => l.getAttribute('href'))
      .filter((h) => h !== null && h.startsWith('/listings/'));
    expect(links).toEqual([a, b].map((r) => `/listings/${r.listing.id}`));
    expect(document.getElementById('likes-mine')).toBeNull();
    // The room headings: "liked me" and the three people sections only.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      he.likes.likedMe,
      he.likes.people.likedMe,
      he.likes.people.mine,
      he.likes.people.matches,
    ]);
    expect(screen.queryByText(he.likes.mutual)).toBeNull();
    expect(api.calls(LIKES)).toHaveLength(1);
  });

  it('ac5_empty_error_and_loading', async () => {
    const pending = deferred();
    render({ [LIKES]: [pending.promise] });
    expect(await screen.findAllByTestId('skeleton')).not.toHaveLength(0);
    pending.resolve(json(myLikes([])));
    expect(await screen.findByText(he.likes.likedMeEmpty)).toBeVisible();
    expect(
      within(section(he.likes.likedMe)).getByRole('link', { name: he.likes.toProfile }),
    ).toHaveAttribute('href', '/me/profile?section=about&section=looking&next=%2Fme%2Flikes');
    vi.unstubAllGlobals();

    // A 500 shows ErrorState, whose retry loads the list.
    const api = render({
      [LIKES]: [json({ detail: 'boom' }, 500), json(myLikes([likedRoom()]))],
    });
    const retry = await screen.findAllByRole('button', { name: he.common.retry });
    fireEvent.click(retry[retry.length - 1] as HTMLElement);
    expect(await screen.findAllByRole('article')).toHaveLength(1);
    expect(api.calls(LIKES).length).toBeGreaterThanOrEqual(2);
  });

  it('ac4_card_heading_level', async () => {
    const a = likedRoom();
    render({ [LIKES]: [json(myLikes([a]))] });
    const likedMe = await screen.findByRole('region', { name: he.likes.likedMe });
    // One <h1>; the section's <h2>; the cards' titles one level below, as <h3>.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(likedMe).getAllByRole('heading', { level: 2 })).toHaveLength(1);
    const card = within(within(likedMe).getByRole('article'));
    const title = card.getByRole('heading', { level: 3 });
    expect(within(title).getByRole('link')).toHaveAttribute('href', `/listings/${a.listing.id}`);
    expect(card.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('ac3_grid_and_match', async () => {
    const year = new Date().getUTCFullYear();
    const scored = likedRoom({
      flatmate_ages: [27, 29],
      match: { score: 82, agrees: ['budget', 'area'], differs: null },
    });
    const plain = likedRoom({ flatmate_ages: [60] });
    const api = render({
      [PROFILE]: [json(profile({ birth_year: year - 28 }))],
      [LIKES]: [json(myLikes([scored, plain]))],
    });

    const likedMe = within(await screen.findByRole('region', { name: he.likes.likedMe }));
    // A grid of cards, one column on a phone.
    const list = likedMe.getAllByRole('list')[0] as HTMLElement;
    expect(list).toHaveClass('grid', 'grid-cols-1', 'md:grid-cols-2', 'xl:grid-cols-3');
    expect(likedMe.getAllByRole('article')).toHaveLength(2);
    await vi.waitFor(() => {
      expect(api.calls(PROFILE)).toHaveLength(1);
    });

    // The scored card shows the badge and chips, and the age chip; the other card has none.
    const [first, second] = likedMe.getAllByRole('article') as [HTMLElement, HTMLElement];
    expect(await within(first).findByTestId('match-badge')).toHaveTextContent('82');
    expect(within(first).getByTestId('match-chips')).toBeVisible();
    expect(within(first).getByText(he.rooms.card.similarAge)).toBeVisible();
    expect(within(second).queryByTestId('match-badge')).toBeNull();
    expect(within(second).queryByTestId('match-chips')).toBeNull();
    expect(within(second).queryByText(he.rooms.card.similarAge)).toBeNull();
  });

  it('ac4_banner_and_one_mascot', async () => {
    // The banner (a person match, spec 0010i): a status on accent-soft, accent-strong text, an ink
    // button focused on mount.
    const a = personCard({ display_name: 'Ada', liked_me: true });
    const chatId = '00000000-0000-0000-0000-00000000ccc3';
    render({
      [LIKES]: [json(myLikes([]))],
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
    unmount();
    vi.unstubAllGlobals();

    // The room section empty: exactly one mascot, in "liked me".
    const mascots = () => document.querySelectorAll('img[src*="homie-turtle"]');
    render({ [LIKES]: [json(myLikes([]))] });
    await screen.findByText(he.likes.likedMeEmpty);
    expect(mascots()).toHaveLength(1);
    expect(
      section(he.likes.likedMe).querySelectorAll('img[src*="homie-turtle-sleep"]'),
    ).toHaveLength(1);
  });

  it('ac2_cover', async () => {
    const withCover = likedRoom({
      cover: { id: 'p1', small_url: 'https://media.test/a-s.webp', large_url: 'x-l.webp' },
    });
    const without = likedRoom({ cover: null });
    render({ [LIKES]: [json(myLikes([withCover, without]))] });

    const likedMe = await screen.findByRole('region', { name: he.likes.likedMe });
    const [first, second] = within(likedMe).getAllByRole('article');
    // The cover's small address, decorative; and the placeholder without one.
    const img = (first as HTMLElement).querySelector('img');
    expect(img).toHaveAttribute('src', 'https://media.test/a-s.webp');
    expect(img).toHaveAttribute('alt', '');
    expect((second as HTMLElement).querySelector('img')).toBeNull();
    expect((second as HTMLElement).querySelector('svg[aria-hidden="true"]')).not.toBeNull();
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
      [LIKES]: [json(myLikes([]))],
      [PEOPLE_LIKES]: [json({ liked_me: [a], mine: [b], matches: [match] })],
      [`PUT /people/${a.card_id}/like`]: [json({ liked: true, conversation_id: newChat })],
      [`DELETE /people/${b.card_id}/like`]: [empty()],
      'GET /conversations': [json([])],
    });
    const likedMe = within(await screen.findByRole('region', { name: he.likes.people.likedMe }));
    const mine = within(section(he.likes.people.mine));
    const matches = within(section(he.likes.people.matches));
    // The room sections keep their own names (`likes.spec.ts` selects "אהבו אותך").
    expect(section(he.likes.likedMe)).toBeVisible();
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
    expect(api.calls(LIKES)).toHaveLength(1);
  });

  it('ac17_people_empty_states', async () => {
    render({ [LIKES]: [json(myLikes([]))] });
    expect(await screen.findByText(he.likes.people.likedMeEmpty)).toBeVisible();
    expect(screen.getByText(he.likes.people.mineEmpty)).toBeVisible();
    expect(screen.getByText(he.likes.people.matchesEmpty)).toBeVisible();
    for (const name of [he.likes.people.likedMe, he.likes.people.mine, he.likes.people.matches]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    // The page's one mascot stays in the room section.
    expect(document.querySelectorAll('img[src*="homie-turtle"]')).toHaveLength(1);
  });

  it('ac17_people_card_required_is_one_nudge', async () => {
    const a = likedRoom();
    render({
      [LIKES]: [json(myLikes([a]))],
      [PEOPLE_LIKES]: [json({ detail: 'card_required' }, 403)],
    });
    expect(await screen.findByText(he.likes.people.cardRequired)).toBeVisible();
    expect(screen.getByRole('link', { name: he.market.people.toProfile })).toHaveAttribute(
      'href',
      '/me/profile?section=about&section=looking&next=%2Fme%2Flikes',
    );
    // In place of the three sections; the room sections are unchanged.
    for (const name of [he.likes.people.likedMe, he.likes.people.mine, he.likes.people.matches]) {
      expect(screen.queryByRole('heading', { name })).toBeNull();
    }
    expect(within(section(he.likes.likedMe)).getAllByRole('article')).toHaveLength(1);
  });

  it('ac17_people_error_has_its_own_retry', async () => {
    const api = render({
      [LIKES]: [json(myLikes([]))],
      [PEOPLE_LIKES]: [json({ detail: 'boom' }, 500), json(noPeople)],
    });
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await screen.findByText(he.likes.people.matchesEmpty)).toBeVisible();
    expect(api.calls(PEOPLE_LIKES)).toHaveLength(2);
    // The room lists were not asked again.
    expect(api.calls(LIKES)).toHaveLength(1);
  });
});
