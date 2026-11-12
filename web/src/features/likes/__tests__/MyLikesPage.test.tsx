import { act, cleanup as unmount, fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { deferred, empty, json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import { RequireSeeker } from '../../auth/RequireSeeker';
import { seeker } from '../../listings/__tests__/fixtures';
import { MyLikesPage } from '../MyLikesPage';
import { likedRoom, myLikes } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const LIKES = 'GET /me/likes';
const routes = (
  <Routes>
    <Route path="/login" element={<p>login</p>} />
    <Route element={<RequireSeeker />}>
      <Route path="/me/likes" element={<MyLikesPage />} />
    </Route>
  </Routes>
);
const render = (replies: Parameters<typeof mockApi>[0]) => {
  const api = mockApi({ 'GET /me': [json(seeker)], ...replies });
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
    ).toHaveAttribute('href', '/me/profile?section=room');
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
});
