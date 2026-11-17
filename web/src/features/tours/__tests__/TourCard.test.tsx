import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import type { ThreadOut } from '../../chat/api';
import { chatRoutes } from '../../chat/__tests__/harness';
import { directThread, thread } from '../../chat/__tests__/fixtures';
import { owner, seeker } from '../../listings/__tests__/fixtures';
import type { TourOut, TourSlotsOut } from '../api';
import { formatTourWhen } from '../format';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime('2026-11-17T10:00:00Z');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Reply = Parameters<typeof mockApi>[0][string][number];

const c = he.tours.card;
const p = he.tours.picker;
const START = '2026-11-20T15:00:00Z';
const TOUR: TourOut = {
  id: '00000000-0000-0000-0000-0000000000b1',
  starts_at: START,
  ends_at: '2026-11-20T15:20:00Z',
  status: 'booked',
};
const slots = (list: string[], overrides: Partial<TourSlotsOut> = {}): TourSlotsOut => ({
  listing_live: true,
  slots: list.map((starts_at) => ({ starts_at, ends_at: starts_at })),
  tour: null,
  ...overrides,
});
const SLOT_A = '2026-11-20T15:00:00Z';
const SLOT_B = '2026-11-21T08:20:00Z';

/** The thread page, as `me`, with the thread answered by `replies` and the tour routes by `extra`. */
function renderCard(
  t: ThreadOut,
  replies: Reply[] = [json(t)],
  extra: Record<string, Reply[]> = {},
  me = seeker,
) {
  const api = mockApi({
    'GET /me': [() => json(me)],
    'GET /me/conversations': [() => json([])],
    [`GET /conversations/${t.id}`]: replies,
    ...extra,
  });
  const view = renderRoutes(`/chat/${t.id}`, chatRoutes);
  return { api, view };
}
const LIST = 'GET /me/conversations';
/** The chat list is fetched once on mount; a tour change refetches it (`CONVERSATIONS_KEY`). */
const listRefetched = (api: ReturnType<typeof renderCard>['api']) =>
  waitFor(() => {
    expect(api.calls(LIST).length).toBeGreaterThan(1);
  });
const slotsRoute = (t: ThreadOut) => `GET /applications/${t.id}/tour-slots`;
const bookRoute = (t: ThreadOut) => `POST /applications/${t.id}/tour`;
const rescheduleRoute = `POST /tours/${TOUR.id}/reschedule`;
const cancelRoute = `POST /tours/${TOUR.id}/cancel`;
const card = async () => screen.findByRole('heading', { level: 2, name: c.title });
const noCard = async (t: ThreadOut) => {
  await screen.findByRole('heading', { level: 1, name: t.other_name ?? '' });
  expect(screen.queryByRole('heading', { name: c.title })).toBeNull();
};
const dayButtonIn = (box: HTMLElement, n: number) =>
  within(box)
    .getAllByRole('button')
    .find((b) => b.hasAttribute('aria-pressed') && b.textContent === String(n)) as HTMLElement;
const picker = () => screen.findByRole('dialog', { name: p.title });
const noDialog = () =>
  waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });

describe('TourCard', () => {
  it('ac2_seeker_books_a_slot', async () => {
    const T = thread();
    const booked = { ...T, tour: TOUR };
    const { api } = renderCard(T, [json(T), json(booked)], {
      [slotsRoute(T)]: [json(slots([SLOT_A, SLOT_B]))],
      [bookRoute(T)]: [json(TOUR, 201)],
    });
    expect(await card()).toBeVisible();
    // No slots are asked for until the picker opens.
    expect(api.calls(slotsRoute(T))).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: c.book }));
    const box = await picker();
    // The calendar opens on the first slot day (20 Nov): its one time, 17:00.
    let radios = await within(box).findAllByRole('radio');
    expect(radios.map((r) => r.nextElementSibling?.textContent)).toEqual(['17:00']);
    fireEvent.click(dayButtonIn(box, 21));
    radios = within(box).getAllByRole('radio');
    expect(radios.map((r) => r.nextElementSibling?.textContent)).toEqual(['10:20']);
    fireEvent.click(dayButtonIn(box, 20));
    radios = within(box).getAllByRole('radio');
    const confirm = within(box).getByRole('button', { name: p.confirm });
    expect(confirm).toBeDisabled();
    fireEvent.click(radios[0] as HTMLElement);
    fireEvent.click(confirm);
    await noDialog();
    expect(api.calls(bookRoute(T))[0]?.body).toEqual({ starts_at: SLOT_A });
    // The thread is refetched: the card shows the tour, and the heading has focus.
    expect(await screen.findByText(bookedLine())).toBeVisible();
    expect(screen.getByRole('button', { name: c.reschedule })).toBeVisible();
    expect(screen.queryByRole('button', { name: c.book })).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: c.title })).toHaveFocus();
    });
    await listRefetched(api);
    expect(api.calls(`GET /conversations/${T.id}`)).toHaveLength(2);
  });

  it('ac2_slot_unavailable_shows_message_and_refetches_slots', async () => {
    const T = thread();
    const { api } = renderCard(T, [json(T)], {
      [slotsRoute(T)]: [json(slots([SLOT_A, SLOT_B])), json(slots([SLOT_B]))],
      [bookRoute(T)]: [json({ detail: 'slot_unavailable' }, 409)],
    });
    await card();
    fireEvent.click(screen.getByRole('button', { name: c.book }));
    const box = await picker();
    fireEvent.click((await within(box).findAllByRole('radio'))[0] as HTMLElement);
    fireEvent.click(within(box).getByRole('button', { name: p.confirm }));
    expect(await within(box).findByRole('alert')).toHaveTextContent(
      he.tours.errors.slotUnavailable,
    );
    // The dialog stays, the taken slot is gone and nothing is selected.
    await waitFor(() => {
      expect(dayButtonIn(box, 21)).toHaveAttribute('aria-pressed', 'true');
    });
    expect(within(box).getAllByRole('radio')).toHaveLength(1);
    expect(api.calls(slotsRoute(T))).toHaveLength(2);
    expect(within(box).getByRole('button', { name: p.confirm })).toBeDisabled();
  });

  it('ac6_picker_calendar_shows_every_day_with_slots', async () => {
    const T = thread();
    renderCard(T, [json(T)], { [slotsRoute(T)]: [json(slots([SLOT_A, SLOT_B]))] });
    await card();
    fireEvent.click(screen.getByRole('button', { name: c.book }));
    const box = await picker();
    await within(box).findByRole('grid', { name: he.tours.calendar.seekerLabel });
    expect(box).toHaveClass('max-w-dialog-wide');
    expect(dayButtonIn(box, 20)).toBeEnabled();
    expect(dayButtonIn(box, 21)).toBeEnabled();
    expect(dayButtonIn(box, 19)).toBeDisabled();
    expect(dayButtonIn(box, 20)).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(dayButtonIn(box, 21));
    expect(within(box).getAllByRole('radio')).toHaveLength(1);
    expect(within(box).getByRole('button', { name: p.confirm })).toBeDisabled();
  });

  it('ac2_tour_exists_closes_the_picker_and_refetches_the_thread', async () => {
    const T = thread();
    const { api } = renderCard(T, [json(T), json({ ...T, tour: TOUR })], {
      [slotsRoute(T)]: [json(slots([SLOT_A]))],
      [bookRoute(T)]: [json({ detail: 'tour_exists' }, 409)],
    });
    await card();
    fireEvent.click(screen.getByRole('button', { name: c.book }));
    const box = await picker();
    fireEvent.click((await within(box).findAllByRole('radio'))[0] as HTMLElement);
    fireEvent.click(within(box).getByRole('button', { name: p.confirm }));
    await noDialog();
    expect(await screen.findByText(bookedLine())).toBeVisible();
    expect(api.calls(`GET /conversations/${T.id}`)).toHaveLength(2);
  });

  it('ac2_empty_picker', async () => {
    const T = thread();
    renderCard(T, [json(T)], {
      [slotsRoute(T)]: [json(slots([], { listing_live: false }))],
    });
    await card();
    fireEvent.click(screen.getByRole('button', { name: c.book }));
    const box = await picker();
    expect(await within(box).findByText(p.empty)).toBeVisible();
    expect(within(box).queryByRole('grid')).toBeNull();
    expect(within(box).getByRole('button', { name: p.confirm })).toBeDisabled();
  });

  it('ac2_seeker_reschedules', async () => {
    const T = { ...thread(), tour: TOUR };
    const moved = { ...TOUR, starts_at: SLOT_B };
    const { api } = renderCard(T, [json(T), json({ ...T, tour: moved })], {
      [slotsRoute(T)]: [json(slots([SLOT_B], { tour: TOUR }))],
      [rescheduleRoute]: [json(moved)],
    });
    await card();
    expect(screen.getByText(bookedLine())).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: c.reschedule }));
    const box = await picker();
    fireEvent.click((await within(box).findAllByRole('radio'))[0] as HTMLElement);
    fireEvent.click(within(box).getByRole('button', { name: p.move }));
    await noDialog();
    expect(api.calls(rescheduleRoute)[0]?.body).toEqual({ starts_at: SLOT_B });
    expect(await screen.findByText(bookedLine(SLOT_B))).toBeVisible();
  });

  it('ac2_seeker_cancels_with_confirm', async () => {
    const T = { ...thread(), tour: TOUR };
    const { api } = renderCard(T, [json(T), json({ ...T, tour: null })], {
      [cancelRoute]: [json({ ...TOUR, status: 'cancelled' })],
    });
    await card();
    fireEvent.click(screen.getByRole('button', { name: c.cancel }));
    let box = await screen.findByRole('dialog', { name: c.cancelConfirm });
    // Dismissing the confirm sends nothing.
    fireEvent.click(within(box).getByRole('button', { name: he.common.cancel }));
    await noDialog();
    expect(api.calls(cancelRoute)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: c.cancel }));
    box = await screen.findByRole('dialog', { name: c.cancelConfirm });
    fireEvent.click(within(box).getByRole('button', { name: c.cancel }));
    await noDialog();
    expect(await screen.findByRole('button', { name: c.book })).toBeVisible();
    expect(api.calls(cancelRoute)).toHaveLength(1);
    await listRefetched(api);
  });

  it('ac2_tour_not_cancellable_closes_and_refetches', async () => {
    // Moving a tour that is no longer cancellable (cleanup cancelled it): the picker closes and
    // the thread is refetched, so the card shows no tour.
    const T = { ...thread(), tour: TOUR };
    const { api } = renderCard(T, [json(T), json({ ...T, tour: null })], {
      [slotsRoute(T)]: [json(slots([SLOT_B], { tour: TOUR }))],
      [rescheduleRoute]: [json({ detail: 'tour_not_cancellable' }, 409)],
    });
    await card();
    fireEvent.click(screen.getByRole('button', { name: c.reschedule }));
    const box = await picker();
    fireEvent.click((await within(box).findAllByRole('radio'))[0] as HTMLElement);
    fireEvent.click(within(box).getByRole('button', { name: p.move }));
    await noDialog();
    expect(await screen.findByRole('button', { name: c.book })).toBeVisible();
    expect(api.calls(`GET /conversations/${T.id}`)).toHaveLength(2);
    await listRefetched(api);
  });

  it('ac2_cancel_409_flips_the_card_without_an_alert', async () => {
    const T = { ...thread(), tour: TOUR };
    const { api } = renderCard(T, [json(T), json({ ...T, tour: null })], {
      [cancelRoute]: [json({ detail: 'tour_not_cancellable' }, 409)],
    });
    await card();
    fireEvent.click(screen.getByRole('button', { name: c.cancel }));
    const box = await screen.findByRole('dialog', { name: c.cancelConfirm });
    fireEvent.click(within(box).getByRole('button', { name: c.cancel }));
    await noDialog();
    expect(await screen.findByRole('button', { name: c.book })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.calls(`GET /conversations/${T.id}`)).toHaveLength(2);
  });

  it('ac2_cancel_failure_shows_the_error_text', async () => {
    const T = { ...thread(), tour: TOUR };
    renderCard(T, [json(T)], {
      [cancelRoute]: [json({ detail: 'rate_limited' }, 429), json({ detail: 'boom' }, 500)],
    });
    await card();
    for (const text of [he.tours.errors.rateLimited, he.tours.errors.generic]) {
      fireEvent.click(screen.getByRole('button', { name: c.cancel }));
      const box = await screen.findByRole('dialog', { name: c.cancelConfirm });
      fireEvent.click(within(box).getByRole('button', { name: c.cancel }));
      await noDialog();
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(text);
      });
    }
  });

  it('ac2_owner_sees_the_hint_link_or_the_cancel', async () => {
    const own = { ...thread(), my_role: 'owner' as const };
    const { view } = renderCard(own, [json(own)], {}, owner);
    expect(await screen.findByText(c.ownerHint)).toBeVisible();
    const link = screen.getByRole('link', { name: he.listings.mine.tours });
    expect(link).toHaveAttribute('href', `/me/listings/${own.listing.id}/tours`);
    expect(screen.queryByRole('button', { name: c.book })).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // With a tour: the time and the cancel, no reschedule (the seeker's), no hint.
    const withTour = { ...own, tour: TOUR };
    const { api } = renderCard(
      withTour,
      [json(withTour), json(own)],
      {
        [cancelRoute]: [json({ ...TOUR, status: 'cancelled' })],
      },
      owner,
    );
    expect(await screen.findByText(bookedLine())).toBeVisible();
    expect(screen.queryByRole('button', { name: c.reschedule })).toBeNull();
    expect(screen.queryByText(c.ownerHint)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: c.cancel }));
    const box = await screen.findByRole('dialog', { name: c.cancelConfirm });
    fireEvent.click(within(box).getByRole('button', { name: c.cancel }));
    expect(await screen.findByText(c.ownerHint)).toBeVisible();
    expect(api.calls(cancelRoute)).toHaveLength(1);
  });

  it('ac2_nothing_for_a_flatmate_a_direct_chat_or_a_closed_chat_without_a_tour', async () => {
    const flatmate = { ...thread(), my_role: 'flatmate' as const };
    let { view } = renderCard(flatmate);
    await noCard(flatmate);
    view.unmount();
    vi.unstubAllGlobals();

    const direct = directThread();
    ({ view } = renderCard(direct));
    await noCard(direct);
    view.unmount();
    vi.unstubAllGlobals();

    const closed = { ...thread(), can_send: false };
    ({ view } = renderCard(closed));
    await noCard(closed);
    view.unmount();
    vi.unstubAllGlobals();

    // A closed chat that still holds a tour keeps its card, so the tour can be cancelled.
    const closedWithTour = { ...closed, tour: TOUR };
    renderCard(closedWithTour);
    expect(await card()).toBeVisible();
    expect(screen.getByRole('button', { name: c.cancel })).toBeVisible();
  });
});

/** The card's booked line (its time sits in a `<time>`, so match the paragraph's whole text). */
function bookedLine(startsAt: string = START) {
  const text = `נקבע סיור: ${formatTourWhen(startsAt)}`;
  return (_: string, el: Element | null) => el?.tagName === 'P' && el.textContent === text;
}
