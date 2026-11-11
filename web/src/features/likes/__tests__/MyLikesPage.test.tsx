import { fireEvent, screen, within } from '@testing-library/react';
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
    fireEvent.click(first.getByRole('button', { name: he.likes.unlikeLabel }));
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
});
