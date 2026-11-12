import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
import { cardTitle } from '../../listings/cardTitle';
import { seeker } from '../../listings/__tests__/fixtures';
import { THREADS_KEY } from '../../chat/useThread';
import type { MyFlatOut } from '../api';
import { MyFlatsPage } from '../MyFlatsPage';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Reply = Parameters<typeof mockApi>[0][string][number];

const FLATS = 'GET /me/flats';
const flat = (id: string, street: string): MyFlatOut => ({
  listing: { id, listing_type: 'room', city: 'גבעתיים', street, rooms: 4, price_ils: 3200 },
  owner_name: 'רוני',
  joined_at: '2026-11-10T23:30:00Z',
});
const A = flat('00000000-0000-0000-0000-0000000000a1', 'כצנלסון');
const B = flat('00000000-0000-0000-0000-0000000000b2', 'ביאליק');
const leaveRoute = (f: MyFlatOut) => `DELETE /me/flats/${f.listing.id}`;

const routes = (
  <Routes>
    <Route element={<RequireUser />}>
      <Route path="/chat" element={<p>chats</p>} />
      <Route path="/me/flats" element={<MyFlatsPage />} />
    </Route>
  </Routes>
);

function renderPage(
  list: Reply[],
  extra: Record<string, Reply[]> = {},
  client = testQueryClient(),
) {
  const api = mockApi({ 'GET /me': [json(seeker)], [FLATS]: list, ...extra });
  const view = renderRoutes('/me/flats', routes, client);
  return { api, view };
}

function reset(view: { unmount: () => void }) {
  view.unmount();
  vi.unstubAllGlobals();
}

const title = () => screen.findByRole('heading', { level: 1, name: he.flatmates.mine.title });

describe('MyFlatsPage', () => {
  it('ac4_flats_and_leave', async () => {
    // Loading.
    const pending = deferred();
    let { view } = renderPage([pending.promise]);
    await title();
    expect(
      screen.getByText(he.common.loading).closest<HTMLElement>('[aria-busy="true"]'),
    ).toHaveAttribute('aria-busy', 'true');
    reset(view);

    // Error: retry refetches.
    ({ view } = renderPage([() => json({ detail: 'boom' }, 500), () => json([A])]));
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await screen.findByText(i18n.t('flatmates.mine.owner', { name: 'רוני' }))).toBeVisible();
    reset(view);

    // Empty, with the back link.
    ({ view } = renderPage([() => json([])]));
    expect(await screen.findByText(he.flatmates.mine.empty)).toBeVisible();
    expect(screen.getByRole('link', { name: he.flatmates.mine.back })).toHaveAttribute(
      'href',
      '/chat',
    );
    reset(view);

    // Success: title, owner and the Asia/Jerusalem join day.
    const confirm = vi.spyOn(window, 'confirm');
    const client = testQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const api = renderPage(
      [() => json([A, B]), () => json([B])],
      { [leaveRoute(A)]: [() => empty()] },
      client,
    );
    view = api.view;
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    const first = items[0] as HTMLElement;
    expect(first).toHaveTextContent(cardTitle(i18n.t.bind(i18n), A.listing));
    expect(first).toHaveTextContent(i18n.t('flatmates.mine.owner', { name: 'רוני' }));
    expect(first).toHaveTextContent(i18n.t('flatmates.mine.joinedAt', { date: '11.11.2026' }));

    // Declined confirm: nothing sent.
    confirm.mockReturnValueOnce(false);
    fireEvent.click(within(first).getByRole('button', { name: he.flatmates.mine.leave }));
    expect(confirm).toHaveBeenCalledWith(he.flatmates.mine.leaveConfirm);
    expect(api.api.calls(leaveRoute(A))).toHaveLength(0);

    // Confirmed: DELETE, then a refetch drops the flat.
    confirm.mockReturnValueOnce(true);
    fireEvent.click(within(first).getByRole('button', { name: he.flatmates.mine.leave }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(api.api.calls(leaveRoute(A))).toHaveLength(1);
    expect(api.api.calls(FLATS)).toHaveLength(2);
    // Open or cached threads of the flat refetch (to the removed state).
    expect(invalidate).toHaveBeenCalledWith({ queryKey: THREADS_KEY });
    reset(view);

    // A failed leave shows the error inline and keeps the flat.
    ({ view } = renderPage([() => json([A])], {
      [leaveRoute(A)]: [() => json({ detail: 'x' }, 500)],
    }));
    confirm.mockReturnValue(true);
    fireEvent.click(await screen.findByRole('button', { name: he.flatmates.mine.leave }));
    expect(await screen.findByRole('alert')).toHaveTextContent(he.common.error);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    reset(view);
  });

  it('ac3_focus_after_leave', async () => {
    // The left flat's row (and its button) is gone: focus is on the page's <h1>.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage([() => json([A, B]), () => json([B])], { [leaveRoute(A)]: [() => empty()] });
    const items = await screen.findAllByRole('listitem');
    const leave = within(items[0] as HTMLElement).getByRole('button', {
      name: he.flatmates.mine.leave,
    });
    act(() => leave.focus());
    fireEvent.click(leave);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: he.flatmates.mine.title }),
      ).toHaveFocus();
    });
  });

  it('ac3_failed_leave_keeps_the_row_and_no_heading_focus', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage([() => json([A])], { [leaveRoute(A)]: [() => json({ detail: 'x' }, 500)] });
    fireEvent.click(await screen.findByRole('button', { name: he.flatmates.mine.leave }));
    expect(await screen.findByRole('alert')).toHaveTextContent(he.common.error);
    expect(
      screen.getByRole('heading', { level: 1, name: he.flatmates.mine.title }),
    ).not.toHaveFocus();
  });
});
