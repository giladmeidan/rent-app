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
import { ApplicantsPage } from '../../applicants/ApplicantsPage';
import { RequireOwner } from '../../auth/RequireOwner';
import { PeoplePage } from '../../people/PeoplePage';
import { EditListingPage } from '../EditListingPage';
import { MyListingsPage } from '../MyListingsPage';
import { NewListingPage } from '../NewListingPage';
import { gushDan, listing, owner, seeker } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const A = listing({ listing_type: 'room' });
const EDIT = `/me/listings/${A.id}/edit` as const;
const APPLICANTS = `/me/listings/${A.id}/applicants` as const;
const PEOPLE = `/me/listings/${A.id}/people` as const;
const PATHS = ['/listings/new', '/me/listings', EDIT, APPLICANTS, PEOPLE] as const;
const TITLES = {
  '/listings/new': he.listings.new.title,
  '/me/listings': he.listings.mine.title,
  [EDIT]: he.listings.edit.title,
  [APPLICANTS]: he.applicants.title,
  [PEOPLE]: he.people.title,
};

const routes = (
  <Routes>
    <Route path="/" element={<p>home</p>} />
    <Route path="/login" element={<p>login</p>} />
    <Route element={<RequireOwner />}>
      <Route path="/listings/new" element={<NewListingPage />} />
      <Route path="/me/listings" element={<MyListingsPage />} />
      <Route path="/me/listings/:id/edit" element={<EditListingPage />} />
      <Route path="/me/listings/:id/applicants" element={<ApplicantsPage />} />
      <Route path="/me/listings/:id/people" element={<PeoplePage />} />
    </Route>
  </Routes>
);

describe('RequireOwner', () => {
  it('ac1_owner_only_routes', async () => {
    // An owner sees each page.
    for (const path of PATHS) {
      mockApi({
        'GET /me': [json(owner)],
        'GET /areas': [json([gushDan])],
        'GET /me/listings': [json([A])],
        [`GET /listings/${A.id}/applications`]: [json([])],
        [`GET /listings/${A.id}/people`]: [json({ items: [], total: 0 })],
      });
      const view = renderRoutes(path, routes);
      expect(await screen.findByRole('heading', { level: 1, name: TITLES[path] })).toBeVisible();
      expect(currentPath()).toBe(path);
      view.unmount();
      vi.unstubAllGlobals();
    }

    // Logged out → /login?next=<the page>; a seeker → /.
    for (const [me, target] of [
      [
        json({ detail: 'unauthenticated' }, 401),
        (path: string) => `/login?next=${encodeURIComponent(path)}`,
      ],
      [json(seeker), () => '/'],
    ] as const) {
      for (const path of PATHS) {
        mockApi({
          'GET /me': [me.clone()],
          'GET /areas': [json([gushDan])],
          'GET /me/listings': [json([A])],
          [`GET /listings/${A.id}/applications`]: [json([])],
          [`GET /listings/${A.id}/people`]: [json({ items: [], total: 0 })],
        });
        const view = renderRoutes(path, routes);
        await vi.waitFor(() => {
          expect(currentPath()).toBe(target(path));
        });
        expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
        view.unmount();
        vi.unstubAllGlobals();
      }
    }

    // Pending → one skeleton, no redirect, no page.
    for (const path of PATHS) {
      const me = deferred();
      mockApi({ 'GET /me': [me.promise] });
      const view = renderRoutes(path, routes);
      expect(screen.getAllByTestId('skeleton')).toHaveLength(1);
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
      expect(currentPath()).toBe(path);
      view.unmount();
      vi.unstubAllGlobals();
    }

    // A network failure → ErrorState with retry, no redirect; retry refetches /me.
    for (const path of PATHS) {
      const api = mockApi({
        'GET /me': [networkError, json(owner)],
        'GET /areas': [json([gushDan])],
        'GET /me/listings': [json([A])],
        [`GET /listings/${A.id}/applications`]: [json([])],
        [`GET /listings/${A.id}/people`]: [json({ items: [], total: 0 })],
      });
      const view = renderRoutes(path, routes);
      const retry = await screen.findByRole('button', { name: he.common.retry });
      expect(screen.getByRole('alert')).toHaveTextContent(he.common.error);
      expect(currentPath()).toBe(path);
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull();

      fireEvent.click(retry);
      expect(await screen.findByRole('heading', { level: 1, name: TITLES[path] })).toBeVisible();
      expect(api.calls('GET /me')).toHaveLength(2);
      expect(currentPath()).toBe(path);
      view.unmount();
      vi.unstubAllGlobals();
    }
  });
});
