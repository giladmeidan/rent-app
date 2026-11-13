import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import { AppRoutes } from '../../../app/routes';
import he from '../../../locales/he.json';
import { application } from '../../applications/__tests__/fixtures';
import { json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import { listing, owner, seeker } from '../../listings/__tests__/fixtures';
import { page } from '../../search/__tests__/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderMine(path: string, me: typeof owner, extra: Record<string, Response[]>) {
  const api = mockApi({
    'GET /me': [json(me)],
    'GET /me/conversations': [json([])],
    'GET /me/likes': [json({ liked_me: [], mine: [] })],
    'GET /listings': [json(page([]))],
    ...extra,
  });
  const view = renderRoutes(path, <AppRoutes />);
  return { api, view };
}

const main = () => within(screen.getByRole('main'));

describe('MarketMinePage', () => {
  it('ac11_mine_split_by_type', async () => {
    // An owner with a live apartment and a live room: "שלי" holds the room only, no tablist.
    const flat = listing({ street: 'דירה' });
    const room = listing({ street: 'חדר', listing_type: 'room', flatmates_count: 2 });
    let { view } = renderMine('/market/mine', owner, { 'GET /me/listings': [json([flat, room])] });
    expect(
      await main().findByRole('heading', { level: 1, name: he.market.mine.title }),
    ).toBeVisible();
    expect(document.title).toContain(he.market.mine.title);
    let hrefs: string[];
    let cards = await main().findAllByRole('article');
    expect(cards).toHaveLength(1);
    hrefs = within(cards[0] as HTMLElement)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.includes(room.id))).toBe(true);
    expect(hrefs.some((h) => h.includes(flat.id))).toBe(false);
    // The shared cap: both live listings count.
    expect(main().getByText(i18n.t('listings.mine.count', { live: 2, cap: 3 }))).toBeVisible();
    expect(main().getByRole('link', { name: he.market.mine.newRoom })).toHaveAttribute(
      'href',
      '/listings/new?type=room',
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(main().getAllByRole('heading', { level: 1 })).toHaveLength(1);
    view.unmount();
    vi.unstubAllGlobals();

    // `?tab=applications` is not an owner's panel (yet): the rooms.
    ({ view } = renderMine('/market/mine?tab=applications', owner, {
      'GET /me/listings': [json([flat, room])],
    }));
    cards = await main().findAllByRole('article');
    expect(cards).toHaveLength(1);
    hrefs = within(cards[0] as HTMLElement)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.includes(room.id))).toBe(true);
    expect(hrefs.some((h) => h.includes(flat.id))).toBe(false);
    expect(screen.queryByRole('tablist')).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // An owner with no room: the market's own empty state.
    ({ view } = renderMine('/market/mine', owner, { 'GET /me/listings': [json([flat])] }));
    expect(await main().findByText(he.market.mine.empty)).toBeVisible();
    expect(main().getByRole('link', { name: he.market.mine.emptyAction })).toHaveAttribute(
      'href',
      '/listings/new?type=room',
    );
    view.unmount();
    vi.unstubAllGlobals();

    // A seeker with one apartment and one room application: the room's only, no tablist; the
    // listings request is never made.
    const toFlat = application();
    const roomApp = application();
    const toRoom = {
      ...roomApp,
      listing: { ...roomApp.listing, id: 'R1', listing_type: 'room' as const },
    };
    const seekerView = renderMine('/market/mine', seeker, {
      'GET /me/applications': [json([toFlat, toRoom])],
    });
    const api = seekerView.api;
    view = seekerView.view;
    expect(
      await main().findByRole('heading', { level: 2, name: he.market.mine.tabs.applications }),
    ).toBeVisible();
    cards = await main().findAllByRole('article');
    expect(cards).toHaveLength(1);
    expect(within(cards[0] as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      '/listings/R1',
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(api.calls('GET /me/listings')).toHaveLength(0);
    view.unmount();
    vi.unstubAllGlobals();

    // A seeker with no room application: the market's empty state, back to the market.
    renderMine('/market/mine?tab=listings', seeker, { 'GET /me/applications': [json([toFlat])] });
    expect(await main().findByText(he.market.mine.applicationsEmpty)).toBeVisible();
    expect(main().getByRole('link', { name: he.market.toSearch })).toHaveAttribute(
      'href',
      '/market',
    );
  });
});
