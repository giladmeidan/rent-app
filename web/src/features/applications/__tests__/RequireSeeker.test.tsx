import { fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import {
  currentPath,
  deferred,
  json,
  mockApi,
  networkError,
  renderRoutes,
} from '../../auth/__tests__/harness';
import { RequireSeeker } from '../../auth/RequireSeeker';
import { owner, seeker } from '../../listings/__tests__/fixtures';
import { MyApplicationsPage } from '../MyApplicationsPage';

afterEach(() => {
  vi.unstubAllGlobals();
});

// The one seeker-only page (spec 0010b: apartment applications; likes and the profile are for any
// account, `routes.test.tsx::ac10_market_routes_for_any_account`).
const PATH = '/me/applications';
const routes = (
  <Routes>
    <Route path="/" element={<p>home</p>} />
    <Route path="/login" element={<p>login</p>} />
    <Route element={<RequireSeeker />}>
      <Route path={PATH} element={<MyApplicationsPage />} />
    </Route>
  </Routes>
);
const title = () => screen.queryByRole('heading', { level: 1, name: he.applications.mine.title });

describe('RequireSeeker', () => {
  it('ac6_seeker_only_route', async () => {
    // A seeker sees the page.
    mockApi({ 'GET /me': [json(seeker)], 'GET /me/applications': [json([])] });
    let view = renderRoutes(PATH, routes);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.applications.mine.title }),
    ).toBeVisible();
    expect(currentPath()).toBe(PATH);
    view.unmount();
    vi.unstubAllGlobals();

    // Logged out → /login?next=<the page>; an owner → /. Neither requests the list.
    for (const [me, target] of [
      [json({ detail: 'unauthenticated' }, 401), `/login?next=${encodeURIComponent(PATH)}`],
      [json(owner), '/'],
    ] as const) {
      const api = mockApi({ 'GET /me': [me], 'GET /me/applications': [json([])] });
      view = renderRoutes(PATH, routes);
      await vi.waitFor(() => {
        expect(currentPath()).toBe(target);
      });
      expect(title()).toBeNull();
      expect(api.calls('GET /me/applications')).toHaveLength(0);
      view.unmount();
      vi.unstubAllGlobals();
    }

    // Pending → one skeleton, no redirect, no page.
    const pending = deferred();
    mockApi({ 'GET /me': [pending.promise] });
    view = renderRoutes(PATH, routes);
    expect(screen.getAllByTestId('skeleton')).toHaveLength(1);
    expect(title()).toBeNull();
    expect(currentPath()).toBe(PATH);
    view.unmount();
    vi.unstubAllGlobals();

    // A failed /me → ErrorState with retry, no redirect; retry refetches /me.
    const api = mockApi({
      'GET /me': [networkError, json(seeker)],
      'GET /me/applications': [json([])],
    });
    renderRoutes(PATH, routes);
    const retry = await screen.findByRole('button', { name: he.common.retry });
    expect(screen.getByRole('alert')).toHaveTextContent(he.common.error);
    expect(currentPath()).toBe(PATH);
    expect(title()).toBeNull();
    fireEvent.click(retry);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.applications.mine.title }),
    ).toBeVisible();
    expect(api.calls('GET /me')).toHaveLength(2);
  });
});
