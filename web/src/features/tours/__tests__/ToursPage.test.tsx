import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { currentPath, deferred, json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import { RequireUser } from '../../auth/RequireUser';
import { seeker } from '../../listings/__tests__/fixtures';
import { todayInIsrael } from '../../listings/format';
import type { TourAgendaItemOut } from '../api';
import { formatTourDay, formatTourTime, tourDay } from '../format';
import { ToursPage } from '../ToursPage';

afterEach(() => {
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
    const soon = item(1);
    const later = item(72);
    const mine = item(2, { role: 'seeker' });
    renderPage([json([soon, mine, later])]);
    expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeVisible();
    await screen.findByRole('heading', { level: 2, name: t.sections.lister });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      t.sections.lister,
      t.sections.seeker,
    ]);
    const today = todayInIsrael();
    const sections = screen.getAllByRole('heading', { level: 2 }).map((h) => h.closest('section'));
    const days = (section: HTMLElement | null) =>
      within(section as HTMLElement)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent);
    expect(days(sections[0] ?? null)).toEqual([
      formatTourDay(tourDay(soon.starts_at), today),
      formatTourDay(tourDay(later.starts_at), today),
    ]);
    expect(days(sections[1] ?? null)).toEqual([formatTourDay(tourDay(mine.starts_at), today)]);
    // The row: time range, the listing, who.
    const row = rowOf(soon);
    expect(
      within(row).getByText(
        t.row.time
          .replace('{{start}}', formatTourTime(soon.starts_at))
          .replace('{{end}}', formatTourTime(soon.ends_at)),
      ),
    ).toBeVisible();
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
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
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
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('ac12_cancel_flow', async () => {
    const a = item(5);
    const b = item(6);
    const started = item(-0.1);
    const { api } = renderPage([json([started, a, b])], {
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
    const { api } = renderPage([json([a, b]), json([b])], {
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
    expect(api.calls(AGENDA)).toHaveLength(2);

    // 500: an alert under the row, the row stays.
    fireEvent.click(cancelButton(rowOf(b)));
    fireEvent.click(within(await confirmDialog()).getByRole('button', { name: t.cancel.confirm }));
    const alert = await within(rowOf(b)).findByRole('alert');
    expect(alert).toHaveTextContent(t.errors.generic);
    expect(rowOf(b)).toBeVisible();
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
