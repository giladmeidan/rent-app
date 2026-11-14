import { act, cleanup as unmount, fireEvent, screen, within } from '@testing-library/react';
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
  it('ac5_lists_and_states', async () => {
    const a = likedRoom();
    const b = likedRoom();
    const c = likedRoom();
    const api = render({
      [LIKES]: [
        json(myLikes([a], [b, c])),
        json(myLikes([], [a, b, c])),
        json(myLikes([], [a, c])),
      ],
      [`PUT /listings/${a.listing.id}/like`]: [json({ liked: true, application_id: 'X' })],
      [`DELETE /listings/${b.listing.id}/like`]: [empty()],
    });

    expect(await screen.findByRole('heading', { level: 1, name: he.likes.title })).toBeVisible();
    const likedMe = within(await screen.findByRole('region', { name: he.likes.likedMe }));
    const mine = within(section(he.likes.mine));
    expect(likedMe.getAllByRole('article')).toHaveLength(1);
    expect(mine.getAllByRole('article')).toHaveLength(2);
    const links = screen
      .getAllByRole('link')
      .map((l) => l.getAttribute('href'))
      .filter((h) => h !== null && h.startsWith('/listings/'));
    expect(links).toEqual([a, b, c].map((r) => `/listings/${r.listing.id}`));
    expect(screen.queryByText(he.likes.mutual)).toBeNull();

    // Like back from the card's button (not its link): the PUT, then the banner above the lists.
    fireEvent.click(likedMe.getByRole('button', { name: he.likes.like }));
    const banner = (await screen.findByText(he.likes.mutual)).closest<HTMLElement>(
      '[role="status"]',
    ) as HTMLElement;
    expect(within(banner).getByRole('link', { name: he.likes.toChat })).toHaveAttribute(
      'href',
      '/chat/X',
    );
    expect(api.calls(`PUT /listings/${a.listing.id}/like`)).toHaveLength(1);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner.compareDocumentPosition(section(he.likes.likedMe))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // The refetch removes the card; the banner stays and the section shows its empty text.
    expect(await screen.findByText(he.likes.likedMeEmpty)).toBeVisible();
    expect(screen.getByText(he.likes.mutual)).toBeVisible();
    expect(
      within(section(he.likes.likedMe)).getByRole('link', { name: he.likes.toProfile }),
    ).toHaveAttribute('href', '/me/profile?section=about&section=looking&next=%2Fme%2Flikes');
    expect(within(section(he.likes.mine)).getAllByRole('article')).toHaveLength(3);

    // Unlike a room of "mine": the DELETE, then the refetch drops it.
    const first = within(within(section(he.likes.mine)).getAllByRole('article')[1] as HTMLElement);
    fireEvent.click(first.getByRole('button', { name: he.likes.liked, pressed: true }));
    await vi.waitFor(() => {
      expect(within(section(he.likes.mine)).getAllByRole('article')).toHaveLength(2);
    });
    expect(api.calls(`DELETE /listings/${b.listing.id}/like`)).toHaveLength(1);
    expect(api.calls(LIKES)).toHaveLength(3);
  });

  it('ac5_empty_error_and_loading', async () => {
    const pending = deferred();
    render({ [LIKES]: [pending.promise] });
    expect(await screen.findAllByTestId('skeleton')).not.toHaveLength(0);
    pending.resolve(json(myLikes([], [])));
    expect(await screen.findByText(he.likes.likedMeEmpty)).toBeVisible();
    expect(screen.getByText(he.likes.mineEmpty)).toBeVisible();
    vi.unstubAllGlobals();

    // A 500 shows ErrorState, whose retry loads the lists.
    const api = render({
      [LIKES]: [json({ detail: 'boom' }, 500), json(myLikes([likedRoom()], []))],
    });
    const retry = await screen.findAllByRole('button', { name: he.common.retry });
    fireEvent.click(retry[retry.length - 1] as HTMLElement);
    expect(await screen.findAllByRole('article')).toHaveLength(1);
    expect(api.calls(LIKES).length).toBeGreaterThanOrEqual(2);
  });

  it('ac4_card_heading_level', async () => {
    const a = likedRoom();
    const b = likedRoom();
    render({ [LIKES]: [json(myLikes([a], [b]))] });
    const likedMe = await screen.findByRole('region', { name: he.likes.likedMe });
    // One <h1>; each section's <h2>; the cards' titles one level below, as <h3>.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    for (const [region, room] of [
      [likedMe, a],
      [section(he.likes.mine), b],
    ] as const) {
      expect(within(region).getAllByRole('heading', { level: 2 })).toHaveLength(1);
      const card = within(within(region).getByRole('article'));
      const title = card.getByRole('heading', { level: 3 });
      expect(within(title).getByRole('link')).toHaveAttribute(
        'href',
        `/listings/${room.listing.id}`,
      );
      expect(card.queryByRole('heading', { level: 2 })).toBeNull();
    }
  });

  it('ac2_focus_after_unlike', async () => {
    const mineHeading = () => screen.getByRole('heading', { level: 2, name: he.likes.mine });

    // A successful unlike: the card leaves "mine", focus is on its heading.
    const a = likedRoom();
    const b = likedRoom();
    render({
      [LIKES]: [json(myLikes([], [a, b])), json(myLikes([], [b]))],
      [`DELETE /listings/${a.listing.id}/like`]: [empty()],
    });
    let mine = within(await screen.findByRole('region', { name: he.likes.mine }));
    let button = within(mine.getAllByRole('article')[0] as HTMLElement).getByRole('button', {
      name: he.likes.liked,
    });
    act(() => button.focus());
    fireEvent.click(button);
    await vi.waitFor(() => {
      expect(within(section(he.likes.mine)).getAllByRole('article')).toHaveLength(1);
    });
    await vi.waitFor(() => {
      expect(mineHeading()).toHaveFocus();
    });
    expect(mineHeading()).toHaveAttribute('id', 'likes-mine');
    unmount();
    vi.unstubAllGlobals();

    // A like back that comes back non-mutual moves the card to "mine": the same heading.
    const c = likedRoom();
    render({
      [LIKES]: [json(myLikes([c], [])), json(myLikes([], [c]))],
      [`PUT /listings/${c.listing.id}/like`]: [json({ liked: true, application_id: null })],
    });
    const likedMe = within(await screen.findByRole('region', { name: he.likes.likedMe }));
    button = likedMe.getByRole('button', { name: he.likes.like });
    act(() => button.focus());
    fireEvent.click(button);
    expect(await screen.findByText(he.likes.likedMeEmpty)).toBeVisible();
    await vi.waitFor(() => {
      expect(mineHeading()).toHaveFocus();
    });
    unmount();
    vi.unstubAllGlobals();

    // A 404 on unlike never focuses the heading.
    const d = likedRoom();
    render({
      [LIKES]: [json(myLikes([], [d])), json(myLikes([], []))],
      [`DELETE /listings/${d.listing.id}/like`]: [json({ detail: 'not_found' }, 404)],
    });
    mine = within(await screen.findByRole('region', { name: he.likes.mine }));
    button = mine.getByRole('button', { name: he.likes.liked });
    act(() => button.focus());
    fireEvent.click(button);
    expect(await screen.findByText(he.likes.mineEmpty)).toBeVisible();
    await new Promise((r) => setTimeout(r, 50));
    expect(mineHeading()).not.toHaveFocus();
  });

  it('ac3_grid_and_match', async () => {
    const year = new Date().getUTCFullYear();
    const scored = likedRoom({
      flatmate_ages: [27, 29],
      match: { score: 82, agrees: ['budget', 'area'], differs: null },
    });
    const plain = likedRoom({ flatmate_ages: [60] });
    const mine = likedRoom();
    const api = render({
      [PROFILE]: [json(profile({ birth_year: year - 28 }))],
      [LIKES]: [json(myLikes([scored, plain], [mine])), json(myLikes([plain], [mine, scored]))],
      [`PUT /listings/${scored.listing.id}/like`]: [json({ liked: true, application_id: 'X' })],
    });

    const likedMe = within(await screen.findByRole('region', { name: he.likes.likedMe }));
    const mineRegion = within(section(he.likes.mine));
    // Each list is a grid of cards, one column on a phone.
    for (const region of [likedMe, mineRegion]) {
      const list = region.getAllByRole('list')[0] as HTMLElement;
      expect(list).toHaveClass('grid', 'grid-cols-1', 'md:grid-cols-2', 'xl:grid-cols-3');
    }
    expect(likedMe.getAllByRole('article')).toHaveLength(2);
    expect(mineRegion.getAllByRole('article')).toHaveLength(1);
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
    expect(mineRegion.queryByTestId('match-badge')).toBeNull();

    // Liking back still shows the mutual banner with the chat link.
    fireEvent.click(within(first).getByRole('button', { name: he.likes.like }));
    const banner = (await screen.findByText(he.likes.mutual)).closest<HTMLElement>(
      '[role="status"]',
    ) as HTMLElement;
    expect(within(banner).getByRole('link', { name: he.likes.toChat })).toHaveAttribute(
      'href',
      '/chat/X',
    );
  });

  it('ac4_banner_and_one_mascot', async () => {
    // The banner: a status on accent-soft, accent-strong text, an ink button focused on mount.
    const a = likedRoom();
    render({
      [LIKES]: [json(myLikes([a], [])), json(myLikes([], [a]))],
      [`PUT /listings/${a.listing.id}/like`]: [json({ liked: true, application_id: 'X' })],
    });
    const likedMe = within(await screen.findByRole('region', { name: he.likes.likedMe }));
    fireEvent.click(likedMe.getByRole('button', { name: he.likes.like }));
    const text = await screen.findByText(he.likes.mutual);
    const banner = text.closest<HTMLElement>('[role="status"]') as HTMLElement;
    expect(banner).toHaveClass('bg-accent-soft', 'rounded-lg');
    expect(text).toHaveClass('text-accent-strong');
    const chat = within(banner).getByRole('link', { name: he.likes.toChat });
    expect(chat).toHaveClass('bg-ink', 'text-on-ink');
    expect(chat).not.toHaveClass('bg-accent');
    await vi.waitFor(() => {
      expect(chat).toHaveFocus();
    });
    unmount();
    vi.unstubAllGlobals();

    // Both sections empty: exactly one mascot, in "liked me".
    const mascots = () => document.querySelectorAll('img[src*="homie-turtle"]');
    render({ [LIKES]: [json(myLikes([], []))] });
    await screen.findByText(he.likes.mineEmpty);
    expect(mascots()).toHaveLength(1);
    expect(
      section(he.likes.likedMe).querySelectorAll('img[src*="homie-turtle-sleep"]'),
    ).toHaveLength(1);
    expect(
      within(section(he.likes.likedMe)).getByRole('link', { name: he.likes.toProfile }),
    ).toHaveAttribute('href', '/me/profile?section=about&section=looking&next=%2Fme%2Flikes');
    unmount();
    vi.unstubAllGlobals();

    // Only "mine" empty: the mascot is there.
    render({ [LIKES]: [json(myLikes([likedRoom()], []))] });
    await screen.findByText(he.likes.mineEmpty);
    expect(mascots()).toHaveLength(1);
    expect(section(he.likes.mine).querySelectorAll('img[src*="homie-turtle"]')).toHaveLength(1);
  });

  it('ac10_vanished_card_is_explained', async () => {
    const mineHeading = () => screen.getByRole('heading', { level: 2, name: he.likes.mine });
    const h1 = async () => screen.findByRole('heading', { level: 1, name: he.likes.title });
    const after = (a: Node, b: Node) =>
      expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // An unlike answering 404: the refetch drops the card, and one focused line under the <h1>
    // says why (the button shows no alert of its own).
    const a = likedRoom();
    render({
      [LIKES]: [json(myLikes([], [a])), json(myLikes([], []))],
      [`DELETE /listings/${a.listing.id}/like`]: [json({ detail: 'not_found' }, 404)],
    });
    const mine = within(await screen.findByRole('region', { name: he.likes.mine }));
    let button = mine.getByRole('button', { name: he.likes.liked });
    act(() => button.focus());
    fireEvent.click(button);
    expect(await screen.findByText(he.likes.mineEmpty)).toBeVisible();
    expect(screen.getAllByText(he.likes.errors.gone)).toHaveLength(1);
    let line = screen.getByRole('alert');
    expect(line).toHaveTextContent(he.likes.errors.gone);
    expect(line).toHaveFocus();
    after(await h1(), line);
    after(line, section(he.likes.likedMe));
    unmount();
    vi.unstubAllGlobals();

    // A like answering 409 `already_applied`: the line, with the way to "my applications".
    const b = likedRoom();
    render({
      [LIKES]: [json(myLikes([b], [])), json(myLikes([], []))],
      [`PUT /listings/${b.listing.id}/like`]: [json({ detail: 'already_applied' }, 409)],
    });
    const likedMe = within(await screen.findByRole('region', { name: he.likes.likedMe }));
    button = likedMe.getByRole('button', { name: he.likes.like });
    act(() => button.focus());
    fireEvent.click(button);
    expect(await screen.findByText(he.likes.errors.alreadyApplied)).toBeVisible();
    line = screen.getByRole('alert');
    expect(line).toHaveFocus();
    // A room application: the market's "שלי" (spec 0010a).
    expect(within(line).getByRole('link', { name: he.applications.viewMine })).toHaveAttribute(
      'href',
      '/market/mine',
    );
    after(await h1(), line);
    expect(await screen.findByText(he.likes.likedMeEmpty)).toBeVisible();
    expect(line).toHaveFocus();
    unmount();
    vi.unstubAllGlobals();

    // A successful unlike focuses the "mine" heading (spec 0009t), never this line.
    const c = likedRoom();
    const d = likedRoom();
    render({
      [LIKES]: [json(myLikes([], [c, d])), json(myLikes([], [d]))],
      [`DELETE /listings/${c.listing.id}/like`]: [empty()],
    });
    button = within(
      within(await screen.findByRole('region', { name: he.likes.mine })).getAllByRole(
        'article',
      )[0] as HTMLElement,
    ).getByRole('button', { name: he.likes.liked });
    act(() => button.focus());
    fireEvent.click(button);
    await vi.waitFor(() => {
      expect(mineHeading()).toHaveFocus();
    });
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('ac2_cover', async () => {
    const withCover = likedRoom({
      cover: { id: 'p1', small_url: 'https://media.test/a-s.webp', large_url: 'x-l.webp' },
    });
    const without = likedRoom({ cover: null });
    render({ [LIKES]: [json(myLikes([], [withCover, without]))] });

    const mine = await screen.findByRole('region', { name: he.likes.mine });
    const [first, second] = within(mine).getAllByRole('article');
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
      [LIKES]: [json(myLikes([], []))],
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
    render({ [LIKES]: [json(myLikes([], []))] });
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
      [LIKES]: [json(myLikes([a], []))],
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
    expect(section(he.likes.mine)).toBeVisible();
  });

  it('ac17_people_error_has_its_own_retry', async () => {
    const api = render({
      [LIKES]: [json(myLikes([], []))],
      [PEOPLE_LIKES]: [json({ detail: 'boom' }, 500), json(noPeople)],
    });
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await screen.findByText(he.likes.people.matchesEmpty)).toBeVisible();
    expect(api.calls(PEOPLE_LIKES)).toHaveLength(2);
    // The room lists were not asked again.
    expect(api.calls(LIKES)).toHaveLength(1);
  });
});
