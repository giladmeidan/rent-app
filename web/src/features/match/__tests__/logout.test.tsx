import { fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { empty, json, mockApi, noa, renderRoutes } from '../../auth/__tests__/harness';
import { AuthMenu } from '../../auth/AuthMenu';
import { profile } from '../../profile/__tests__/fixtures';
import { page, publicListing } from '../../search/__tests__/fixtures';
import { SearchPage } from '../../search/SearchPage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('logout drops the match scores', () => {
  it('ac11_logout_drops_scores', async () => {
    const listing = publicListing({
      match: { score: 87, agrees: ['budget', 'area', 'household'], differs: null },
    });
    const api = mockApi({
      'GET /me': [json(noa)],
      'GET /me/profile': [json(profile())],
      'GET /me/conversations': [json([])],
      'POST /auth/logout': [empty(204)],
      // The same search asked again as a visitor: no score.
      'GET /listings': [
        json(page([listing], 1, 'match')),
        json(page([{ ...listing, match: null }], 1, 'newest')),
      ],
    });
    renderRoutes(
      '/search',
      <>
        <AuthMenu />
        <Routes>
          <Route path="/search" element={<SearchPage type="apartment" />} />
        </Routes>
      </>,
    );
    expect(await screen.findByText('התאמה 87%')).toBeVisible();
    expect(await screen.findByText('בתקציב')).toBeVisible();

    fireEvent.click(await screen.findByRole('button', { name: he.header.logout }));
    expect(await screen.findByRole('link', { name: he.header.login })).toBeVisible();
    // The open page asks again, as the visitor it now is, and shows no score.
    await vi.waitFor(() => {
      expect(api.calls('GET /listings')).toHaveLength(2);
    });
    expect(await screen.findByRole('article')).toBeVisible();
    await vi.waitFor(() => {
      expect(screen.queryByText(/התאמה/)).toBeNull();
    });
    expect(screen.queryByTestId('match-chips')).toBeNull();
    expect(screen.queryByText('לפי התאמה', { exact: false })).toBeNull();
    expect(screen.getByLabelText(he.search.sort.label)).toHaveValue('newest');
  });
});
