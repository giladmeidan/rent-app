import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { currentPath, deferred, json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import { RequireUser } from '../../auth/RequireUser';
import { seeker } from '../../listings/__tests__/fixtures';
import type { TourAgendaItemOut } from '../api';
import { ToursPage } from '../ToursPage';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const AGENDA = 'GET /tours';
const t = he.tours;
const HOUR = 3_600_000;
const iso = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();
const cancelRoute = (id: string) => `POST /tours/${id}/cancel`;

let n = 0;
/** An agenda row starting in `hours` (negative: already started), 30 minutes long. */
function item(hours: number, overrides: Partial<TourAgendaItemOut> = {}): TourAgendaItemOut {
  n += 1;
  const id = `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  return {
    id,
    role: 'lister',
    starts_at: iso(hours),
    ends_at: iso(hours + 0.5),
    conversation_id: `00000000-0000-0000-0000-c${String(n).padStart(11, '0')}`,
    other_name: `אורח ${String(n)}`,
    listing: {
      id: `00000000-0000-0000-0000-a${String(n).padStart(11, '0')}`,
      listing_type: 'apartment',
      rooms: 3,
      street: `הרצל ${String(n)}`,
      city: 'גבעתיים',
      cover: null,
    },
    ...overrides,
  };
}

type Reply = Parameters<typeof mockApi>[0][string][number];

function renderPage(agenda: Reply[], extra: Record<string, Reply[]> = {}) {
  const api = mockApi({ 'GET /me': [json(seeker)], [AGENDA]: agenda, ...extra });
  const view = renderRoutes(
    '/tours',
    <Routes>
      <Route path="/login" element={<p>login</p>} />
      <Route element={<RequireUser />}>
        <Route path="/tours" element={<ToursPage />} />
      </Route>
    </Routes>,
  );
  return { api, view };
}

const rowOf = (it: TourAgendaItemOut) =>
  screen.getByText(t.row.with.replace('{{name}}', it.other_name)).closest('li') as HTMLElement;
const confirmDialog = () => screen.findByRole('dialog', { name: t.cancel.title });
const cancelButton = (row: HTMLElement) => within(row).getByRole('button', { name: t.row.cancel });

describe('ToursPage', () => {
  it('ac10_sections_and_days', async () => {
    // 22:00 on 17 November in Israel (UTC+2). The expected headings are literals, not the
    // page's own helpers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2026-11-17T20:00:00Z');
    const at = (start: string, end: string, overrides: Partial<TourAgendaItemOut> = {}) =>
      item(0, { starts_at: start, ends_at: end, ...overrides });
    const late = at('2026-11-17T21:00:00Z', '2026-11-17T21:30:00Z');
    const later = at('2026-11-17T21:30:00Z', '2026-11-17T22:00:00Z');
    const midnight = at('2026-11-17T22:30:00Z', '2026-11-17T23:00:00Z');
    const friday = at('2026-11-20T08:00:00Z', '2026-11-20T08:30:00Z');
    const mine = at('2026-11-17T21:00:00Z', '2026-11-17T21:30:00Z', { role: 'seeker' });
    renderPage([json([late, mine, later, midnight, friday])]);
    expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeVisible();
    await screen.findByRole('heading', { level: 2, name: 'מגיעים לראות' });
    const h2 = screen.getAllByRole('heading', { level: 2 });
    expect(h2.map((h) => h.textContent)).toEqual(['מגיעים לראות', 'סיורים שקבעתי']);
    const sections = h2.map((h) => within(h.closest('section') as HTMLElement));
    const days = (section: (typeof sections)[number]) =>
      section.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    // 23:00 and 23:30 share the 17th; 00:30 is already the 18th; Friday 20.11.
    expect(days(sections[0] as (typeof sections)[number])).toEqual([
      'היום',
      'מחר',
      'יום שישי, 20.11.26',
    ]);
    const today = (sections[0] as (typeof sections)[number]).getAllByRole('list')[0] as HTMLElement;
    expect(within(today).getAllByRole('listitem')).toHaveLength(2);
    expect(days(sections[1] as (typeof sections)[number])).toEqual(['היום']);
    expect(within(rowOf(midnight)).getByText('00:30–01:00')).toBeVisible();
    expect(within(rowOf(late)).getByText('23:00–23:30')).toBeVisible();
  });

  it('shows_the_listing_cover_photo', async () => {
    const base = item(1);
    const withCover = {
      ...base,
      listing: {
        ...base.listing,
        cover: { id: 'p1', small_url: '/media/s.jpg', large_url: '/media/l.jpg' },
      },
    };
    const without = item(2);
    renderPage([json([withCover, without])]);
    await screen.findByRole('heading', { level: 2, name: t.sections.lister });
    const img = rowOf(withCover).querySelector('img');
    expect(img?.getAttribute('src')).toBe('/media/s.jpg');
    expect(img?.getAttribute('alt')).toBe('');
    expect(rowOf(without).querySelector('img')).toBeNull();
  });

  it('ac10_lister_only_has_no_seeker_heading', async () => {
    renderPage([json([item(1)])]);
    await screen.findByRole('heading', { level: 2, name: t.sections.lister });
    expect(screen.queryByRole('heading', { name: t.sections.seeker })).toBeNull();
  });

  it('ac11_loading_error_empty', async () => {
    // Loading.
    const pending = deferred();
    renderPage([pending.promise]);
    await screen.findByRole('heading', { level: 1, name: t.title });
    expect(document.querySelector('[aria-busy="true"] ul')).not.toBeNull();
    cleanup();

    // Error with a working retry.
    const row = item(1);
    renderPage([json({ detail: 'x' }, 500), json([row])]);
    const retry = await screen.findByRole('button', { name: he.common.retry });
    fireEvent.click(retry);
    expect(await screen.findByRole('heading', { level: 2, name: t.sections.lister })).toBeVisible();
    cleanup();

    // Empty.
    renderPage([json([])]);
    expect(await screen.findByText(t.empty.title)).toBeVisible();
    expect(screen.getByText(t.empty.body)).toBeVisible();
    // No action in the empty state; the header's calendar-feed button (spec 0018d) is the only one.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([he.tours.feed.title]);
  });

  it('ac12_cancel_flow', async () => {
    const a = item(5);
    const b = item(6);
    const started = item(-0.1);
    const { api } = renderPage([json([started, a, b]), () => json([started, b])], {
      [cancelRoute(a.id)]: [
        json({ id: a.id, starts_at: a.starts_at, ends_at: a.ends_at, status: 'cancelled' }),
      ],
    });
    await screen.findByText(t.row.with.replace('{{name}}', a.other_name));
    // An in-progress row has the chat link only.
    expect(within(rowOf(started)).queryByRole('button', { name: t.row.cancel })).toBeNull();
    expect(within(rowOf(started)).getByRole('link', { name: t.row.chat })).toBeVisible();

    // "Keep" sends nothing.
    fireEvent.click(cancelButton(rowOf(a)));
    let box = await confirmDialog();
    expect(within(box).getByText(t.cancel.body.replace('{{name}}', a.other_name))).toBeVisible();
    fireEvent.click(within(box).getByRole('button', { name: t.cancel.keep }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.calls(cancelRoute(a.id))).toHaveLength(0);

    // Confirm: one POST, the row leaves, the status line says so.
    fireEvent.click(cancelButton(rowOf(a)));
    box = await confirmDialog();
    fireEvent.click(within(box).getByRole('button', { name: t.cancel.confirm }));
    await waitFor(() => {
      expect(screen.queryByText(t.row.with.replace('{{name}}', a.other_name))).toBeNull();
    });
    expect(api.calls(cancelRoute(a.id))).toHaveLength(1);
    expect(screen.getByText(t.cancel.done)).toHaveAttribute('role', 'status');
  });

  it('ac12_cancel_conflict_and_failure', async () => {
    const a = item(5);
    const b = item(6);
    const { api } = renderPage([json([a, b]), () => json([b])], {
      [cancelRoute(a.id)]: [json({ detail: 'tour_not_cancellable' }, 409)],
      [cancelRoute(b.id)]: [json({ detail: 'boom' }, 500)],
    });
    await screen.findByText(t.row.with.replace('{{name}}', a.other_name));

    // 409: "gone" and a refetch that drops the row.
    fireEvent.click(cancelButton(rowOf(a)));
    fireEvent.click(within(await confirmDialog()).getByRole('button', { name: t.cancel.confirm }));
    await waitFor(() => {
      expect(screen.queryByText(t.row.with.replace('{{name}}', a.other_name))).toBeNull();
    });
    expect(screen.getByText(t.cancel.gone)).toHaveAttribute('role', 'status');
    expect(api.calls(AGENDA).length).toBeGreaterThanOrEqual(2);

    // 500: an alert under the row, the row stays.
    fireEvent.click(cancelButton(rowOf(b)));
    fireEvent.click(within(await confirmDialog()).getByRole('button', { name: t.cancel.confirm }));
    const alert = await within(rowOf(b)).findByRole('alert');
    expect(alert).toHaveTextContent(t.errors.generic);
    expect(rowOf(b)).toBeVisible();
  });

  it('ac12_cancel_404_is_gone', async () => {
    const a = item(5);
    const b = item(6);
    const { api } = renderPage([json([a, b]), () => json([b])], {
      [cancelRoute(a.id)]: [json({ detail: 'not_found' }, 404)],
    });
    await screen.findByText(t.row.with.replace('{{name}}', a.other_name));
    fireEvent.click(cancelButton(rowOf(a)));
    fireEvent.click(within(await confirmDialog()).getByRole('button', { name: t.cancel.confirm }));
    await waitFor(() => {
      expect(screen.queryByText(t.row.with.replace('{{name}}', a.other_name))).toBeNull();
    });
    expect(screen.getByText(t.cancel.gone)).toHaveAttribute('role', 'status');
    expect(api.calls(AGENDA).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ac12_last_row_leaves_day_and_page', async () => {
    const a = item(1);
    const b = item(72);
    let rest = [a, b];
    const done = (x: TourAgendaItemOut) => () => {
      rest = rest.filter((r) => r.id !== x.id);
      return json({ id: x.id, starts_at: x.starts_at, ends_at: x.ends_at, status: 'cancelled' });
    };
    renderPage([() => json(rest)], {
      [cancelRoute(a.id)]: [done(a)],
      [cancelRoute(b.id)]: [done(b)],
    });
    await screen.findByText(t.row.with.replace('{{name}}', a.other_name));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);

    // A's day is emptied: its heading goes, B's stays.
    fireEvent.click(cancelButton(rowOf(a)));
    fireEvent.click(within(await confirmDialog()).getByRole('button', { name: t.cancel.confirm }));
    await waitFor(() => {
      expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
    });
    expect(screen.getByText(t.row.with.replace('{{name}}', b.other_name))).toBeVisible();

    // The last row: no sections, the empty state.
    fireEvent.click(cancelButton(rowOf(b)));
    fireEvent.click(within(await confirmDialog()).getByRole('button', { name: t.cancel.confirm }));
    expect(await screen.findByText(t.empty.title)).toBeVisible();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('ac12_pending_cancel_is_busy', async () => {
    const a = item(5);
    const pending = deferred();
    renderPage([json([a]), () => json([])], { [cancelRoute(a.id)]: [pending.promise] });
    await screen.findByText(t.row.with.replace('{{name}}', a.other_name));
    fireEvent.click(cancelButton(rowOf(a)));
    fireEvent.click(within(await confirmDialog()).getByRole('button', { name: t.cancel.confirm }));
    await waitFor(() => {
      expect(cancelButton(rowOf(a))).toHaveAttribute('aria-busy', 'true');
    });
    expect(cancelButton(rowOf(a))).toHaveAttribute('aria-disabled', 'true');
    pending.resolve(
      json({ id: a.id, starts_at: a.starts_at, ends_at: a.ends_at, status: 'cancelled' }),
    );
    expect(await screen.findByText(t.empty.title)).toBeVisible();
  });

  it('ac13_links', async () => {
    const it1 = item(5);
    renderPage([json([it1])]);
    const row = await screen.findByText(t.row.with.replace('{{name}}', it1.other_name));
    const li = row.closest('li') as HTMLElement;
    expect(within(li).getByRole('link', { name: t.row.chat })).toHaveAttribute(
      'href',
      `/chat/${it1.conversation_id}`,
    );
    const links = within(li).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toContain(`/listings/${it1.listing.id}`);
  });

  it('ac14_requires_login', async () => {
    mockApi({ 'GET /me': [json({ detail: 'unauthenticated' }, 401)] });
    renderRoutes(
      '/tours',
      <Routes>
        <Route path="/login" element={<p>login</p>} />
        <Route element={<RequireUser />}>
          <Route path="/tours" element={<ToursPage />} />
        </Route>
      </Routes>,
    );
    expect(await screen.findByText('login')).toBeVisible();
    expect(currentPath()).toBe('/login?next=%2Ftours');
  });
});
