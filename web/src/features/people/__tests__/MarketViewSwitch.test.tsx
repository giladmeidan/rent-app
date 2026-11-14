import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import { seeker } from '../../listings/__tests__/fixtures';
import { MarketViewSwitch } from '../MarketViewSwitch';

afterEach(() => {
  vi.unstubAllGlobals();
});

const routes = (
  <Routes>
    <Route path="/market" element={<MarketViewSwitch current="rooms" />} />
    <Route path="/market/people" element={<MarketViewSwitch current="people" />} />
  </Routes>
);
const nav = () => screen.getByRole('navigation', { name: he.market.view.label });
const link = (name: string) => screen.getByRole('link', { name });

describe('MarketViewSwitch', () => {
  it('ac16_current_view_is_marked_on_each_page', async () => {
    for (const [path, current, other] of [
      ['/market', he.market.view.rooms, he.market.view.people],
      ['/market/people', he.market.view.people, he.market.view.rooms],
    ] as const) {
      mockApi({ 'GET /me': [json(seeker)] });
      const view = renderRoutes(path, routes);
      await screen.findByRole('navigation', { name: he.market.view.label });
      expect(link(current)).toHaveAttribute('aria-current', 'page');
      expect(link(other)).not.toHaveAttribute('aria-current');
      expect(screen.getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual([
        '/market',
        '/market/people',
      ]);
      expect(nav()).toBeVisible();
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac16_signed_out_people_goes_through_login', async () => {
    mockApi({ 'GET /me': [json({ detail: 'unauthorized' }, 401)] });
    renderRoutes('/market', routes);
    await screen.findByRole('navigation', { name: he.market.view.label });
    await vi.waitFor(() => {
      expect(link(he.market.view.people)).toHaveAttribute('href', '/login?next=%2Fmarket%2Fpeople');
    });
    expect(link(he.market.view.rooms)).toHaveAttribute('href', '/market');
    expect(link(he.market.view.rooms)).toHaveAttribute('aria-current', 'page');
  });
});
