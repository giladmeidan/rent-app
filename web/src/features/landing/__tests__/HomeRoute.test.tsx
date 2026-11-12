import { screen } from '@testing-library/react';
import { Route, Routes, useNavigationType } from 'react-router';
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
import { owner, seeker } from '../../listings/__tests__/fixtures';
import { homeFor } from '../home';
import { HomeRoute } from '../HomeRoute';

afterEach(() => {
  vi.unstubAllGlobals();
});

const TITLE = he.landing.title.replace('\n', ' ');
const byTitle = (name: string) => name.replace(/\s+/g, ' ') === TITLE;

/** A stand-in home that shows how it was reached (PUSH / REPLACE / POP). */
function Home({ label }: { label: string }) {
  return <p>{`${label} ${useNavigationType()}`}</p>;
}

const routes = (
  <Routes>
    <Route path="/" element={<HomeRoute />} />
    <Route path="/me/listings" element={<Home label="owner" />} />
    <Route path="/search" element={<Home label="seeker" />} />
  </Routes>
);

describe('HomeRoute', () => {
  it('ac5_home_states', async () => {
    expect(homeFor('owner')).toBe('/me/listings');
    expect(homeFor('seeker')).toBe('/search');

    // Pending: a busy skeleton, no landing content and no <h1>.
    const me = deferred();
    mockApi({ 'GET /me': [me.promise] });
    let view = renderRoutes('/', routes);
    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton.closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText(he.common.loading)).toHaveClass('sr-only');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByText(he.landing.badge)).toBeNull();
    me.resolve(json({ detail: 'unauthenticated' }, 401));
    expect(await screen.findByRole('heading', { level: 1, name: byTitle })).toBeVisible();
    expect(screen.queryByTestId('skeleton')).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // A 401, a 500 or a network error: the landing, on `/`.
    for (const reply of [
      () => json({ detail: 'unauthenticated' }, 401),
      () => json({ detail: 'boom' }, 500),
      networkError,
    ]) {
      mockApi({ 'GET /me': [reply] });
      view = renderRoutes('/', routes);
      expect(await screen.findByRole('heading', { level: 1, name: byTitle })).toBeVisible();
      expect(currentPath()).toBe('/');
      view.unmount();
      vi.unstubAllGlobals();
    }

    // Signed in: straight to the role's home, replacing `/` in the history.
    for (const [user, path, label] of [
      [owner, '/me/listings', 'owner'],
      [seeker, '/search', 'seeker'],
    ] as const) {
      mockApi({ 'GET /me': [json(user)] });
      view = renderRoutes('/', routes);
      expect(await screen.findByText(`${label} REPLACE`)).toBeVisible();
      expect(currentPath()).toBe(path);
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
      view.unmount();
      vi.unstubAllGlobals();
    }
  });
});
