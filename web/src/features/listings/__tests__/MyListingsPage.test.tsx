import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { deferred, json, mockApi, renderAt } from '../../auth/__tests__/harness';
import { MyListingsPage } from '../MyListingsPage';
import { listing } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const render = () => renderAt('/me/listings', <MyListingsPage />);
const badge = (card: HTMLElement) => within(card).getByTestId('status-badge');
const newLink = () => screen.getByRole('link', { name: he.listings.mine.new });

describe('MyListingsPage', () => {
  it('ac6_states_and_badges', async () => {
    // Pending: three skeleton rows in a busy list.
    const pending = deferred();
    mockApi({ 'GET /me/listings': [pending.promise] });
    let view = render();
    expect(screen.getByRole('heading', { level: 1, name: he.listings.mine.title })).toBeVisible();
    const busy = screen.getByRole('list', { name: he.common.loading });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(busy).getAllByTestId('skeleton')).toHaveLength(3);
    expect(newLink()).toHaveAttribute('href', '/listings/new');
    view.unmount();
    vi.unstubAllGlobals();

    // Failure: ErrorState; retry refetches.
    let api = mockApi({ 'GET /me/listings': [json({ detail: 'boom' }, 500), json([])] });
    view = render();
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await screen.findByText(he.listings.mine.empty)).toBeVisible();
    expect(api.calls('GET /me/listings')).toHaveLength(2);
    view.unmount();
    vi.unstubAllGlobals();

    // Empty: the empty state and the "new listing" link.
    mockApi({ 'GET /me/listings': [json([])] });
    view = render();
    expect(await screen.findByText(he.listings.mine.empty)).toBeVisible();
    expect(newLink()).toHaveAttribute('href', '/listings/new');
    expect(screen.getByText(i18n.t('listings.mine.count', { live: 0, cap: 3 }))).toBeVisible();
    view.unmount();
    vi.unstubAllGlobals();

    // Live, paused, expired, in API order.
    const live = listing({ street: 'אחד' });
    const paused = listing({ street: 'שתיים', status: 'paused' });
    const expired = listing({ street: 'שלוש', expires_at: '2020-01-01T00:00:00Z' });
    api = mockApi({ 'GET /me/listings': [json([live, paused, expired])] });
    render();
    await screen.findByText(i18n.t('listings.mine.count', { live: 1, cap: 3 }));
    const cards = screen.getAllByRole('article');
    expect(cards.map((card) => within(card).getByRole('heading').textContent)).toEqual(
      [live, paused, expired].map((l) =>
        i18n.t('listings.card.title', { rooms: '3', street: l.street, city: l.city }),
      ),
    );
    const [liveCard, pausedCard, expiredCard] = cards as [HTMLElement, HTMLElement, HTMLElement];
    expect(badge(liveCard)).toHaveTextContent(he.listings.status.live);
    expect(badge(pausedCard)).toHaveTextContent(he.listings.status.paused);
    expect(badge(expiredCard)).toHaveTextContent(he.listings.status.expired);
    expect(
      within(liveCard)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([he.listings.actions.pause]);
    expect(
      within(pausedCard)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([he.listings.actions.resume]);
    expect(within(expiredCard).queryAllByRole('button')).toHaveLength(0);
    expect(newLink()).toHaveAttribute('href', '/listings/new');
    expect(api.calls('GET /me/listings')[0]?.request.credentials).toBe('include');
  });

  it('ac7_pause_resume', async () => {
    const first = listing({ street: 'אחד' });
    const second = listing({ street: 'שתיים' });
    const pause = deferred();
    const api = mockApi({
      'GET /me/listings': [json([first, second])],
      [`PATCH /listings/${first.id}`]: [
        pause.promise,
        json({ detail: 'listing_cap_reached' }, 409),
      ],
      [`PATCH /listings/${second.id}`]: [json({ detail: 'boom' }, 500)],
    });
    render();
    const [firstCard, secondCard] = (await screen.findAllByRole('article')) as [
      HTMLElement,
      HTMLElement,
    ];

    // Pause: busy while pending, then the row re-renders from the response.
    const pauseButton = within(firstCard).getByRole('button', { name: he.listings.actions.pause });
    fireEvent.click(pauseButton);
    await vi.waitFor(() => {
      expect(pauseButton).toBeDisabled();
    });
    expect(pauseButton).toHaveAttribute('aria-busy', 'true');
    const [call] = api.calls(`PATCH /listings/${first.id}`);
    expect(call?.body).toEqual({ status: 'paused' });
    expect(call?.request.credentials).toBe('include');
    pause.resolve(json({ ...first, status: 'paused' }));
    expect(
      await within(firstCard).findByRole('button', { name: he.listings.actions.resume }),
    ).toBeEnabled();
    expect(badge(firstCard)).toHaveTextContent(he.listings.status.paused);
    expect(screen.getByText(i18n.t('listings.mine.count', { live: 1, cap: 3 }))).toBeVisible();

    // Resume answers 409: the cap message on that row; it stays paused.
    fireEvent.click(within(firstCard).getByRole('button', { name: he.listings.actions.resume }));
    expect(await within(firstCard).findByRole('alert')).toHaveTextContent(
      i18n.t('listings.errors.capReached', { cap: 3 }),
    );
    expect(api.calls(`PATCH /listings/${first.id}`)[1]?.body).toEqual({ status: 'active' });
    expect(badge(firstCard)).toHaveTextContent(he.listings.status.paused);
    expect(
      within(firstCard).getByRole('button', { name: he.listings.actions.resume }),
    ).toBeEnabled();

    // Pause answers 500: common.error on that row; it stays live; the other row is untouched.
    fireEvent.click(within(secondCard).getByRole('button', { name: he.listings.actions.pause }));
    expect(await within(secondCard).findByRole('alert')).toHaveTextContent(he.common.error);
    expect(badge(secondCard)).toHaveTextContent(he.listings.status.live);
    expect(
      within(secondCard).getByRole('button', { name: he.listings.actions.pause }),
    ).toBeEnabled();
    expect(within(firstCard).getByRole('alert')).toHaveTextContent(
      i18n.t('listings.errors.capReached', { cap: 3 }),
    );
  });
});
