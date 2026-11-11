import { fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { ChatListPage } from '../../chat/ChatListPage';
import { ChatThreadPage } from '../../chat/ChatThreadPage';
import { thread } from '../../chat/__tests__/fixtures';
import { owner, seeker } from '../../listings/__tests__/fixtures';
import { RequireUser } from '../RequireUser';
import { currentPath, deferred, json, mockApi, renderRoutes } from './harness';

afterEach(() => {
  vi.unstubAllGlobals();
});

const T = thread();
const routes = (
  <Routes>
    <Route path="/login" element={<p>login</p>} />
    <Route element={<RequireUser />}>
      <Route path="/chat" element={<ChatListPage />} />
      <Route path="/chat/:id" element={<ChatThreadPage />} />
    </Route>
  </Routes>
);
const pages = {
  [`/chat`]: he.chat.list.title,
  [`/chat/${T.id}`]: T.other_name,
};

describe('RequireUser', () => {
  it('ac2_require_user', async () => {
    // A visitor is sent to /login from both pages, and neither page's data is requested.
    for (const path of Object.keys(pages)) {
      const api = mockApi({ 'GET /me': [json({ detail: 'unauthenticated' }, 401)] });
      const view = renderRoutes(path, routes);
      await vi.waitFor(() => {
        expect(currentPath()).toBe('/login');
      });
      expect(api.calls('GET /me/conversations')).toHaveLength(0);
      expect(api.calls(`GET /conversations/${T.id}`)).toHaveLength(0);
      view.unmount();
      vi.unstubAllGlobals();
    }

    // An owner and a seeker both see both pages.
    for (const me of [owner, seeker]) {
      for (const [path, heading] of Object.entries(pages)) {
        mockApi({
          'GET /me': [json(me)],
          'GET /me/conversations': [json([])],
          [`GET /conversations/${T.id}`]: [json(T)],
        });
        const view = renderRoutes(path, routes);
        expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeVisible();
        expect(currentPath()).toBe(path);
        view.unmount();
        vi.unstubAllGlobals();
      }
    }

    // /me pending: one skeleton, no page, no redirect.
    const pending = deferred();
    mockApi({ 'GET /me': [pending.promise] });
    const view = renderRoutes('/chat', routes);
    expect(screen.getAllByTestId('skeleton')).toHaveLength(1);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(currentPath()).toBe('/chat');
    view.unmount();
    vi.unstubAllGlobals();

    // /me failing: ErrorState, no redirect; retry refetches /me.
    const api = mockApi({
      'GET /me': [json({ detail: 'boom' }, 500), json(seeker)],
      'GET /me/conversations': [json([])],
    });
    renderRoutes('/chat', routes);
    const retry = await screen.findByRole('button', { name: he.common.retry });
    expect(screen.getByRole('alert')).toHaveTextContent(he.common.error);
    expect(currentPath()).toBe('/chat');
    fireEvent.click(retry);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.chat.list.title }),
    ).toBeVisible();
    expect(api.calls('GET /me')).toHaveLength(2);
  });
});
