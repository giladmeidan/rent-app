import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { deferred, empty, json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import { cardTitle } from '../../listings/cardTitle';
import { listing } from '../../listings/__tests__/fixtures';
import type { TourWindowOut, TourWindowsOut } from '../api';
import { TourTimesPage } from '../TourTimesPage';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime('2026-11-17T10:00:00Z');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Reply = Parameters<typeof mockApi>[0][string][number];

const APARTMENT = listing();
const ROOM = listing({ listing_type: 'room' });
const MINE = 'GET /me/listings';
const windowsRoute = (l: { id: string }) => `GET /listings/${l.id}/tour-windows`;
const createRoute = (l: { id: string }) => `POST /listings/${l.id}/tour-windows`;
const deleteRoute = (w: { id: string }) => `DELETE /tour-windows/${w.id}`;
const t = he.tours.times;

const TOMORROW = '2026-11-18';
/** Picks a day of the shown month (the buttons end in their digits). */
const dayButton = (n: number) =>
  screen
    .getAllByRole('button')
    .find((b) => b.hasAttribute('aria-pressed') && b.textContent === String(n)) as HTMLElement;
// 12:00Z is 14:00 or 15:00 in Israel: always the same Israeli day as the UTC one.
const at = (time: string) => `${TOMORROW}T${time}:00Z`;
let n = 0;
/** A 12:00Z–13:00Z window with 20-minute slots (3 slots), unless overridden. */
function win(overrides: Partial<TourWindowOut> = {}): TourWindowOut {
  n += 1;
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, 'a')}`,
    starts_at: at('12:00'),
    ends_at: at('13:00'),
    slot_minutes: 20,
    booked: [],
    ...overrides,
  };
}
const out = (windows: TourWindowOut[], live = true): TourWindowsOut => ({
  listing_live: live,
  windows,
});

const routes = (
  <Routes>
    <Route path="/me/listings" element={<p>mine</p>} />
    <Route path="/market/mine" element={<p>market</p>} />
    <Route path="/me/listings/:id/tours" element={<TourTimesPage />} />
  </Routes>
);

function renderPage(
  l: { id: string } = APARTMENT,
  windows: Reply[] = [json(out([]))],
  extra: Record<string, Reply[]> = {},
) {
  const api = mockApi({
    [MINE]: [json([APARTMENT, ROOM])],
    [windowsRoute(l)]: windows,
    ...extra,
  });
  const view = renderRoutes(`/me/listings/${l.id}/tours`, routes);
  return { api, view };
}

/** The page with its form loaded. */
const heading = () => screen.findByLabelText(t.start);
const alertText = async (text: string) =>
  expect(await screen.findByRole('alert')).toHaveTextContent(text);

function fill(start: string, end: string) {
  fireEvent.change(screen.getByLabelText(t.start), { target: { value: start } });
  fireEvent.change(screen.getByLabelText(t.end), { target: { value: end } });
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: t.add }));

describe('TourTimesPage', () => {
  it('ac1_states_loading_error_empty_not_found', async () => {
    const pending = deferred();
    let { view } = renderPage(APARTMENT, [pending.promise]);
    expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeVisible();
    expect(await screen.findAllByTestId('skeleton')).not.toHaveLength(0);
    view.unmount();
    vi.unstubAllGlobals();

    // A failed load: ErrorState, retry refetches; then the empty state with the form.
    ({ view } = renderPage(APARTMENT, [json({ detail: 'boom' }, 500), json(out([]))]));
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await screen.findByText(t.empty)).toBeVisible();
    expect(screen.getByRole('button', { name: t.add })).toBeVisible();
    // Header: the title, the listing, the way back (an apartment: my listings).
    expect(screen.getByRole('link', { name: he.listings.edit.backToMine })).toHaveAttribute(
      'href',
      '/me/listings',
    );
    expect(screen.getByText(cardTitle(i18n.t.bind(i18n), APARTMENT))).toBeVisible();
    view.unmount();
    vi.unstubAllGlobals();

    // A room goes back to the market's "שלי".
    ({ view } = renderPage(ROOM, [json(out([]))]));
    expect(await screen.findByRole('link', { name: he.market.mine.back })).toHaveAttribute(
      'href',
      '/market/mine',
    );
    view.unmount();
    vi.unstubAllGlobals();

    // A listing that is not the caller's, and a windows 404: not found; no windows asked for the first.
    const ghost = { id: '00000000-0000-0000-0000-00000000ffff' };
    let rendered = renderPage(ghost);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.listings.edit.notFound }),
    ).toBeVisible();
    expect(rendered.api.calls(windowsRoute(ghost))).toHaveLength(0);
    rendered.view.unmount();
    vi.unstubAllGlobals();
    rendered = renderPage(APARTMENT, [json({ detail: 'not_found' }, 404)]);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.listings.edit.notFound }),
    ).toBeVisible();
  });

  it('ac1_add_window_sends_israeli_date_and_times', async () => {
    const created = win();
    const { api } = renderPage(APARTMENT, [json(out([])), json(out([created]))], {
      [createRoute(APARTMENT)]: [json(created, 201)],
    });
    await heading();
    fireEvent.click(dayButton(18));
    fill('14:00', '15:00');
    fireEvent.change(screen.getByLabelText(t.slot), { target: { value: '20' } });
    submit();
    await waitFor(() => {
      expect(api.calls(createRoute(APARTMENT))).toHaveLength(1);
    });
    expect(api.calls(createRoute(APARTMENT))[0]?.body).toEqual({
      date: TOMORROW,
      start: '14:00',
      end: '15:00',
      slot_minutes: 20,
    });
    // The list refetches, the new window's heading takes focus, the form is cleared.
    const card = await screen.findByRole('heading', { level: 3 });
    await waitFor(() => {
      expect(card).toHaveFocus();
    });
    expect(screen.getByRole('heading', { level: 2, name: he.tours.day.tomorrow })).toBeVisible();
  });

  it('ac1_slot_default_and_client_range_check', async () => {
    const { api } = renderPage();
    await heading();
    expect(screen.getByLabelText(t.slot)).toHaveValue('30');
    expect(dayButton(16)).toBeDisabled();
    expect(dayButton(17)).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: he.tours.calendar.nextMonth }));
    expect(dayButton(17)).toBeEnabled();
    expect(dayButton(18)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: he.tours.calendar.prevMonth }));
    fill('15:00', '15:00');
    submit();
    await alertText(t.errors.range);
    expect(api.calls(createRoute(APARTMENT))).toHaveLength(0);
  });

  it('ac1_server_errors', async () => {
    const cases: [number, string, string][] = [
      [422, 'invalid_window', t.errors.invalidWindow],
      [409, 'window_overlap', t.errors.windowOverlap],
      [409, 'too_many_windows', t.errors.tooManyWindows],
      [409, 'listing_not_live', t.notLive],
      [429, 'rate_limited', he.tours.errors.rateLimited],
      [500, 'boom', he.tours.errors.generic],
    ];
    for (const [status, detail, text] of cases) {
      const { view } = renderPage(APARTMENT, [json(out([]))], {
        [createRoute(APARTMENT)]: [json({ detail }, status)],
      });
      await heading();
      fill('14:00', '15:00');
      submit();
      await alertText(text);
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac1_lists_free_and_booked_slots_with_chat_link', async () => {
    const w = win({
      booked: [
        {
          tour_id: '00000000-0000-0000-0000-0000000000b1',
          starts_at: at('12:20'),
          seeker_name: 'מיכל',
          conversation_id: '00000000-0000-0000-0000-0000000000c1',
        },
      ],
    });
    renderPage(APARTMENT, [json(out([w]))]);
    const list = await screen.findByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(t.free);
    expect(items[1]).toHaveTextContent(i18n.t('tours.times.booked', { name: 'מיכל' }));
    expect(within(items[1] as HTMLElement).getByRole('link', { name: t.toChat })).toHaveAttribute(
      'href',
      '/chat/00000000-0000-0000-0000-0000000000c1',
    );
    expect(items[2]).toHaveTextContent(t.free);
    // Every time carries its UTC instant.
    expect(items[1]?.querySelector('time')).toHaveAttribute(
      'datetime',
      new Date(at('12:20')).toISOString(),
    );
    expect(screen.getByRole('heading', { level: 3 }).querySelector('bdi')).toHaveAttribute(
      'dir',
      'ltr',
    );
  });

  it('ac1_delete_with_confirm_and_has_tours', async () => {
    const w = win();
    const { api } = renderPage(APARTMENT, [json(out([w])), json(out([]))], {
      [deleteRoute(w)]: [json({ detail: 'window_has_tours' }, 409), empty()],
    });
    const del = await screen.findByRole('button', { name: t.delete });
    // Cancelling the confirm sends nothing.
    fireEvent.click(del);
    let box = await screen.findByRole('dialog', { name: t.deleteConfirm });
    fireEvent.click(within(box).getByRole('button', { name: he.common.cancel }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.calls(deleteRoute(w))).toHaveLength(0);

    // 409: the message, the window stays.
    fireEvent.click(del);
    box = await screen.findByRole('dialog', { name: t.deleteConfirm });
    fireEvent.click(within(box).getByRole('button', { name: t.delete }));
    await alertText(t.errors.hasTours);
    expect(screen.getByRole('button', { name: t.delete })).toBeVisible();

    // 204: the list refetches, now empty.
    fireEvent.click(screen.getByRole('button', { name: t.delete }));
    box = await screen.findByRole('dialog', { name: t.deleteConfirm });
    fireEvent.click(within(box).getByRole('button', { name: t.delete }));
    expect(await screen.findByText(t.empty)).toBeVisible();
    expect(api.calls(deleteRoute(w))).toHaveLength(2);
  });

  it('ac4_calendar_selects_day_and_lists_its_windows', async () => {
    const later = win({ starts_at: '2026-11-25T12:00:00Z', ends_at: '2026-11-25T13:00:00Z' });
    renderPage(APARTMENT, [json(out([later, win()]))]);
    // Opens on the first day with a window (tomorrow): one window, 25 Nov marked.
    expect(
      await screen.findByRole('heading', { level: 2, name: he.tours.day.tomorrow }),
    ).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
    expect(dayButton(18)).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(dayButton(25));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2 })).not.toHaveTextContent(he.tours.day.tomorrow);
    fireEvent.click(dayButton(20));
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
    expect(screen.getByText(t.dayEmpty)).toBeVisible();
  });

  it('ac5_add_uses_selected_day', async () => {
    const { api } = renderPage(APARTMENT, [json(out([])), json(out([win()]))], {
      [createRoute(APARTMENT)]: [json(win(), 201)],
    });
    await heading();
    fireEvent.click(dayButton(20));
    fill('14:00', '15:00');
    submit();
    await waitFor(() => {
      expect(api.calls(createRoute(APARTMENT))).toHaveLength(1);
    });
    expect(api.calls(createRoute(APARTMENT))[0]?.body).toMatchObject({ date: '2026-11-20' });
  });

  it('ac1_listing_not_live_note_without_form_but_windows_stay', async () => {
    renderPage(APARTMENT, [json(out([win()], false))]);
    expect(await screen.findByText(t.notLive)).toBeVisible();
    expect(screen.queryByRole('button', { name: t.add })).toBeNull();
    expect(screen.queryByLabelText(t.start)).toBeNull();
    expect(screen.getByRole('button', { name: t.delete })).toBeVisible();
  });
});
