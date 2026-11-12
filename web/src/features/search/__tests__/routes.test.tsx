import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../../../app/routes';
import he from '../../../locales/he.json';
import { currentPath, json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import { gushDan, owner, seeker } from '../../listings/__tests__/fixtures';
import { listingDetail, page } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const loggedOut = () => json({ detail: 'unauthenticated' }, 401);

describe('routes', () => {
  it('ac1_public_routes_and_static_new_wins', async () => {
    // /search renders for a visitor, a seeker and an owner, with no redirect. The header's search
    // link is "חיפוש דירות" for a visitor and the "חיפוש" tab when signed in (spec 0009a).
    for (const [me, name] of [
      [loggedOut, he.header.search],
      [() => json(seeker), he.nav.search],
      [() => json(owner), he.nav.search],
    ] as const) {
      const api = mockApi({ 'GET /me': [me()], 'GET /listings': [json(page([]))] });
      const view = renderRoutes('/search', <AppRoutes />);
      expect(await screen.findByRole('heading', { level: 1, name: he.search.title })).toBeVisible();
      expect(await screen.findByText(he.search.empty)).toBeVisible();
      await vi.waitFor(() => {
        expect(api.calls('GET /me')).toHaveLength(1);
      });
      expect(currentPath()).toBe('/search');
      const link = await within(screen.getByRole('banner')).findByRole('link', { name });
      expect(link).toHaveAttribute('href', '/search');
      expect(link).toHaveAttribute('aria-current', 'page');
      view.unmount();
      vi.unstubAllGlobals();
    }

    // The header link is there on other pages too (not `/`, whose seeker CTA is the same link),
    // not marked current.
    mockApi({ 'GET /me': [loggedOut()], 'GET /areas': [json([])] });
    let view = renderRoutes('/login', <AppRoutes />);
    const link = await within(screen.getByRole('banner')).findByRole('link', {
      name: he.header.search,
    });
    expect(link).not.toHaveAttribute('aria-current');
    view.unmount();
    vi.unstubAllGlobals();

    // /listings/{uuid}, logged out: the public listing page asks for that listing.
    const item = listingDetail();
    let api = mockApi({ 'GET /me': [loggedOut()], [`GET /listings/${item.id}`]: [json(item)] });
    view = renderRoutes(`/listings/${item.id}`, <AppRoutes />);
    await vi.waitFor(() => {
      expect(api.calls(`GET /listings/${item.id}`)).toHaveLength(1);
    });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(item.street);
    expect(currentPath()).toBe(`/listings/${item.id}`);
    view.unmount();
    vi.unstubAllGlobals();

    // /listings/new, as an owner: 0002b's wizard, not ListingPage.
    api = mockApi({ 'GET /me': [json(owner)], 'GET /areas': [json([gushDan])] });
    renderRoutes('/listings/new', <AppRoutes />);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.listings.new.title }),
    ).toBeVisible();
    expect(api.calls('GET /listings/new')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: he.listing.backToSearch })).toBeNull();
  });
});
