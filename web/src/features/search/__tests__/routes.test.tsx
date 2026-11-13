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
    // /search renders for a visitor, a seeker and an owner, with no redirect. The header leads to
    // it through the side switch's "דירות" for a visitor (spec 0010a) and the "חיפוש" tab when
    // signed in (spec 0009a).
    for (const [me, name] of [
      [loggedOut, he.side.apartments],
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

    // The switch is there on other pages too, its "דירות" not the current page; there is no
    // "חיפוש דירות" link any more.
    mockApi({ 'GET /me': [loggedOut()], 'GET /areas': [json([])] });
    let view = renderRoutes('/login', <AppRoutes />);
    const sides = within(screen.getByRole('banner')).getByRole('navigation', {
      name: he.side.label,
    });
    const link = within(sides).getByRole('link', { name: he.side.apartments });
    expect(link).toHaveAttribute('href', '/search');
    expect(link).not.toHaveAttribute('aria-current', 'page');
    expect(
      await within(screen.getByRole('banner')).findByRole('link', { name: he.header.login }),
    ).toBeVisible();
    expect(
      within(screen.getByRole('banner')).queryByRole('link', { name: he.header.search }),
    ).toBeNull();
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
