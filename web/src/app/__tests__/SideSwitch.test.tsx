import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../locales/he.json';
import { deferred, json, mockApi, renderRoutes } from '../../features/auth/__tests__/harness';
import { owner, seeker } from '../../features/listings/__tests__/fixtures';
import { listingDetail, page } from '../../features/search/__tests__/fixtures';
import { AppRoutes } from '../routes';

// jsdom has no WebGL: the map view renders the stand-in.
vi.mock(
  '../../components/map/MapCanvas',
  () => import('../../components/map/__tests__/fakeMapCanvas'),
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const unauthenticated = () => json({ detail: 'unauthenticated' }, 401);
const switchNav = () =>
  within(screen.getByRole('banner')).getByRole('navigation', { name: he.side.label });
const linksOf = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole('link')
    .map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')]);

function signedIn(me: typeof owner | null, extra: Record<string, (() => Response)[]> = {}) {
  return mockApi({
    'GET /me': [me === null ? unauthenticated : () => json(me)],
    'GET /me/conversations': [() => json([])],
    'GET /me/likes': [() => json({ liked_me: [], mine: [] })],
    'GET /me/listings': [() => json([])],
    'GET /me/applications': [() => json([])],
    'GET /listings': [() => json(page([]))],
    ...extra,
  });
}

describe('SideSwitch', () => {
  it('ac6_switch_links_and_current', async () => {
    // A visitor, an owner and a seeker: a `nav` named "בחירת אזור" with two links; דירות leads to
    // the person's apartments home (an owner's "המודעות שלי", else the search).
    for (const [name, me, home] of [
      ['visitor', null, '/search'],
      ['owner', owner, '/me/listings'],
      ['seeker', seeker, '/search'],
    ] as const) {
      signedIn(me);
      const view = renderRoutes('/market', <AppRoutes />);
      await screen.findByRole('heading', { level: 1, name: he.market.title });
      if (me !== null) {
        await within(screen.getByRole('banner')).findByRole('button', {
          name: he.header.logout,
        });
      }
      // On the market's home: שוק השותפים is the current page.
      expect(linksOf(switchNav()), name).toEqual([
        [he.side.apartments, home, null],
        [he.side.market, '/market', 'page'],
      ]);
      view.unmount();
      vi.unstubAllGlobals();
    }

    // On the apartments' home: דירות is the current page; elsewhere on a side, `true`.
    signedIn(seeker);
    let view = renderRoutes('/search', <AppRoutes />);
    await screen.findByRole('heading', { level: 1, name: he.search.title });
    expect(linksOf(switchNav())).toEqual([
      [he.side.apartments, '/search', 'page'],
      [he.side.market, '/market', null],
    ]);
    view.unmount();
    vi.unstubAllGlobals();

    signedIn(seeker);
    view = renderRoutes('/market/mine', <AppRoutes />);
    await screen.findByRole('heading', { level: 1, name: he.market.mine.title });
    expect(linksOf(switchNav())).toEqual([
      [he.side.apartments, '/search', null],
      [he.side.market, '/market', 'true'],
    ]);
    // A click records the side at once (the header follows before the next page loads).
    fireEvent.click(within(switchNav()).getByRole('link', { name: he.side.apartments }));
    expect(window.localStorage.getItem('homie.side')).toBe('apartments');
    view.unmount();
    vi.unstubAllGlobals();

    // While /me is pending, דירות leads to the search.
    const pending = deferred();
    mockApi({ 'GET /me': [pending.promise], 'GET /listings': [() => json(page([]))] });
    view = renderRoutes('/search', <AppRoutes />);
    expect(within(switchNav()).getByRole('link', { name: he.side.apartments })).toHaveAttribute(
      'href',
      '/search',
    );
    // Below `md` the switch is its own header row.
    const row = switchNav().closest('[data-side-switch-row]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('class')).toContain('w-full');
    expect(row?.getAttribute('class')).toContain('order-last');
    view.unmount();
    vi.unstubAllGlobals();

    // A room's page (a shared path): the market side is active once the listing loads.
    window.localStorage.setItem('homie.side', 'apartments');
    const room = listingDetail({ listing_type: 'room', flatmates_count: 2 });
    signedIn(null, { [`GET /listings/${room.id}`]: [() => json(room)] });
    renderRoutes(`/listings/${room.id}`, <AppRoutes />);
    await screen.findByRole('link', { name: he.listing.backToMarket });
    expect(linksOf(switchNav())).toEqual([
      [he.side.apartments, '/search', null],
      [he.side.market, '/market', 'true'],
    ]);
    expect(window.localStorage.getItem('homie.side')).toBe('market');
  });
});
