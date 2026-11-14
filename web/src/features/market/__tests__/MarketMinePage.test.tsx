import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import { AppRoutes } from '../../../app/routes';
import he from '../../../locales/he.json';
import { application } from '../../applications/__tests__/fixtures';
import { currentPath, json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
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

const tablist = () => screen.getByRole('tablist', { name: he.market.mine.tabs.label });
const tab = (name: string) => within(tablist()).getByRole('tab', { name });

describe('MarketMinePage', () => {
  it('ac11_mine_split_by_type', async () => {
    // An owner with a live apartment and a live room: the rooms panel holds the room only.
    const flat = listing({ street: 'דירה' });
    const room = listing({ street: 'חדר', listing_type: 'room', flatmates_count: 2 });
    let { view } = renderMine('/market/mine', owner, {
      'GET /me/listings': [json([flat, room])],
      'GET /me/applications': [json([])],
    });
    expect(
      await main().findByRole('heading', { level: 1, name: he.market.mine.title }),
    ).toBeVisible();
    expect(document.title).toContain(he.market.mine.title);
    const cards = await main().findAllByRole('article');
    expect(cards).toHaveLength(1);
    const hrefs = within(cards[0] as HTMLElement)
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
    expect(main().getAllByRole('heading', { level: 1 })).toHaveLength(1);
    view.unmount();
    vi.unstubAllGlobals();

    // No room: the market's own empty state.
    ({ view } = renderMine('/market/mine', owner, { 'GET /me/listings': [json([flat])] }));
    expect(await main().findByText(he.market.mine.empty)).toBeVisible();
    // One "new" action only: the empty state has no second button.
    expect(
      main()
        .getAllByRole('link')
        .filter((a) => a.getAttribute('href') === '/listings/new?type=room'),
    ).toHaveLength(1);
    view.unmount();
    vi.unstubAllGlobals();

    // The applications panel: the room application only.
    const toFlat = application();
    const roomApp = application();
    const toRoom = {
      ...roomApp,
      listing: { ...roomApp.listing, id: 'R1', listing_type: 'room' as const },
    };
    ({ view } = renderMine('/market/mine?tab=applications', seeker, {
      'GET /me/applications': [json([toFlat, toRoom])],
    }));
    const appCards = await main().findAllByRole('article');
    expect(appCards).toHaveLength(1);
    expect(within(appCards[0] as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      '/listings/R1',
    );
    view.unmount();
    vi.unstubAllGlobals();

    // No room application: the market's empty state, back to the market.
    renderMine('/market/mine?tab=applications', seeker, {
      'GET /me/applications': [json([toFlat])],
    });
    expect(await main().findByText(he.market.mine.applicationsEmpty)).toBeVisible();
    expect(main().getByRole('link', { name: he.market.toSearch })).toHaveAttribute(
      'href',
      '/market',
    );
  });

  it('ac12_two_panels_for_everyone', async () => {
    // Spec 0010b: no roles in the market; an owner and a seeker both get the two panels.
    const room = listing({ street: 'חדר', listing_type: 'room', flatmates_count: 2 });
    for (const me of [owner, seeker]) {
      const { view } = renderMine('/market/mine', me, {
        'GET /me/listings': [json([room])],
        'GET /me/applications': [json([])],
      });
      expect(
        await main().findByRole('heading', { level: 1, name: he.market.mine.title }),
      ).toBeVisible();
      expect(within(tablist()).getAllByRole('tab')).toHaveLength(2);
      // The first panel by default, labelled by its tab, with no heading of its own.
      expect(tab(he.market.mine.tabs.listings)).toHaveAttribute('aria-selected', 'true');
      const panel = screen.getByRole('tabpanel', { name: he.market.mine.tabs.listings });
      expect(await within(panel).findAllByRole('article')).toHaveLength(1);
      expect(main().queryByRole('heading', { name: he.market.mine.tabs.listings })).toBeNull();

      // The arrow keys follow RTL: ArrowLeft is the next tab.
      fireEvent.keyDown(tab(he.market.mine.tabs.listings), { key: 'ArrowLeft' });
      expect(tab(he.market.mine.tabs.applications)).toHaveAttribute('aria-selected', 'true');
      expect(tab(he.market.mine.tabs.applications)).toHaveFocus();
      expect(currentPath()).toBe('/market/mine?tab=applications');
      expect(
        await screen.findByRole('tabpanel', { name: he.market.mine.tabs.applications }),
      ).toBeVisible();
      expect(await main().findByText(he.market.mine.applicationsEmpty)).toBeVisible();
      fireEvent.keyDown(tab(he.market.mine.tabs.applications), { key: 'ArrowRight' });
      expect(tab(he.market.mine.tabs.listings)).toHaveAttribute('aria-selected', 'true');
      expect(currentPath()).toBe('/market/mine');
      view.unmount();
      vi.unstubAllGlobals();

      // `?tab=applications` deep-links the second panel.
      const deep = renderMine('/market/mine?tab=applications', me, {
        'GET /me/listings': [json([room])],
        'GET /me/applications': [json([])],
      });
      expect(await main().findByText(he.market.mine.applicationsEmpty)).toBeVisible();
      expect(tab(he.market.mine.tabs.applications)).toHaveAttribute('aria-selected', 'true');
      deep.view.unmount();
      vi.unstubAllGlobals();
    }
  });
});
