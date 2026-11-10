import { fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import {
  currentPath,
  deferred,
  json,
  mockApi,
  networkError,
  renderRoutes,
} from '../../auth/__tests__/harness';
import { RequireSeeker } from '../../auth/RequireSeeker';
import { seeker } from '../../listings/__tests__/fixtures';
import type { MyApplicationOut } from '../api';
import { MyApplicationsPage } from '../MyApplicationsPage';
import { application } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PATH = '/me/applications';
const MINE = 'GET /me/applications';
const withdrawRoute = (app: MyApplicationOut) => `POST /me/applications/${app.id}/withdraw`;

type Reply = Parameters<typeof mockApi>[0][string][number];

const routes = (
  <Routes>
    <Route path="/login" element={<p>login</p>} />
    <Route path="/listings/:id" element={<p>listing</p>} />
    <Route element={<RequireSeeker />}>
      <Route path={PATH} element={<MyApplicationsPage />} />
    </Route>
  </Routes>
);

/** A seeker on "my applications" whose list answers `mine`. */
function renderPage(mine: Reply[], extra: Record<string, Reply[]> = {}) {
  const api = mockApi({ 'GET /me': [json(seeker)], [MINE]: mine, ...extra });
  const view = renderRoutes(PATH, routes);
  return { api, view };
}

/** An application to listing `listingId`. */
function to(listingId: string, overrides: Partial<MyApplicationOut> = {}): MyApplicationOut {
  const app = application(overrides);
  return { ...app, listing: { ...app.listing, id: listingId } };
}

const titleOf = (app: MyApplicationOut) =>
  i18n.t('listings.card.title', {
    rooms: String(app.listing.rooms),
    street: app.listing.street,
    city: app.listing.city,
  });
const appliedText = (app: MyApplicationOut) =>
  i18n.t('applications.applied', {
    date: new Intl.DateTimeFormat('he-IL', {
      day: 'numeric',
      month: 'numeric',
      year: '2-digit',
      timeZone: 'Asia/Jerusalem',
    }).format(new Date(app.created_at)),
  });

const cards = () => screen.getAllByRole('article');

describe('MyApplicationsPage', () => {
  it('ac7_my_applications_states', async () => {
    // Pending: three skeleton rows in a busy list.
    const pending = deferred();
    let { view } = renderPage([pending.promise]);
    await screen.findByRole('heading', { level: 1, name: he.applications.mine.title });
    const busy = screen.getByRole('list', { name: he.common.loading });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(busy).getAllByTestId('skeleton')).toHaveLength(3);
    view.unmount();
    vi.unstubAllGlobals();

    // Failing: ErrorState; retry refetches.
    const failing = renderPage([json({ detail: 'boom' }, 500), json([])]);
    view = failing.view;
    const api = failing.api;
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await screen.findByText(he.applications.mine.empty)).toBeVisible();
    expect(api.calls(MINE)).toHaveLength(2);
    view.unmount();
    vi.unstubAllGlobals();

    // Empty: the message and a way to search.
    ({ view } = renderPage([json([])]));
    expect(await screen.findByText(he.applications.mine.empty)).toBeVisible();
    expect(screen.getByRole('link', { name: he.applications.mine.search })).toHaveAttribute(
      'href',
      '/search',
    );
    view.unmount();
    vi.unstubAllGlobals();

    // Three applications, in API order.
    const message = 'line one\nline two';
    const apps = [
      to('L1', { status: 'submitted', message }),
      to('L2', { status: 'declined', message }),
      to('L3', { status: 'withdrawn', message }),
    ];
    renderPage([json(apps)]);
    await screen.findAllByRole('article');
    expect(cards()).toHaveLength(3);
    apps.forEach((app, i) => {
      const card = within(cards()[i] as HTMLElement);
      const heading = card.getByRole('heading', { level: 2 });
      const link = within(heading).getByRole('link');
      expect(link).toHaveTextContent(titleOf(app));
      expect(link).toHaveAttribute('href', `/listings/${app.listing.id}`);
      expect(card.getByText(/6,000[\s‎‏]*₪/)).toBeVisible();
      expect(card.getByTestId('application-status')).toHaveTextContent(
        he.applications.status[app.status as 'submitted'],
      );
      expect(card.getByText(appliedText(app))).toBeVisible();
      expect(card.getByText(he.applications.yourMessage)).toBeVisible();
      const body = card.getByTestId('application-message');
      expect(body.textContent).toBe(message);
      expect(body).toHaveClass('whitespace-pre-line');
      if (app.status === 'declined')
        expect(card.getByText(he.applications.declinedHint)).toBeVisible();
      else expect(card.queryByText(he.applications.declinedHint)).toBeNull();
      const withdraw = card.queryByRole('button', { name: he.applications.withdraw });
      if (app.status === 'submitted') {
        expect(withdraw).not.toBeNull();
        const describedBy = withdraw?.getAttribute('aria-describedby') ?? '';
        expect(document.getElementById(describedBy)).toHaveTextContent(titleOf(app));
      } else {
        expect(withdraw).toBeNull();
      }
    });
  });

  it('ac8_withdraw', async () => {
    // 200: the chip reads withdrawn and the button is gone.
    const app = to('L1', { status: 'submitted' });
    const post = deferred();
    let { api, view } = renderPage([json([app])], { [withdrawRoute(app)]: [post.promise] });
    const button = await screen.findByRole('button', { name: he.applications.withdraw });
    fireEvent.click(button);
    fireEvent.click(button);
    await vi.waitFor(() => {
      expect(api.calls(withdrawRoute(app))).toHaveLength(1);
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    post.resolve(json({ ...app, status: 'withdrawn' }));
    await vi.waitFor(() => {
      expect(screen.getByTestId('application-status')).toHaveTextContent(
        he.applications.status.withdrawn,
      );
    });
    expect(screen.queryByRole('button', { name: he.applications.withdraw })).toBeNull();
    expect(api.calls(withdrawRoute(app))).toHaveLength(1);
    view.unmount();
    vi.unstubAllGlobals();

    // 409 not_withdrawable: the list is refetched and the card shows the error.
    const other = to('L2', { status: 'submitted' });
    ({ api, view } = renderPage(
      [json([app, other]), json([{ ...app, status: 'declined' }, other])],
      {
        [withdrawRoute(app)]: [json({ detail: 'not_withdrawable' }, 409)],
      },
    ));
    await screen.findAllByRole('button', { name: he.applications.withdraw });
    fireEvent.click(within(cards()[0] as HTMLElement).getByRole('button'));
    await vi.waitFor(() => {
      expect(api.calls(MINE)).toHaveLength(2);
    });
    const first = within(cards()[0] as HTMLElement);
    expect(await first.findByRole('alert')).toHaveTextContent(he.common.error);
    expect(within(cards()[1] as HTMLElement).queryByRole('alert')).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // 401: the session is gone; RequireSeeker sends the person to /login.
    ({ view } = renderPage([json([app])], {
      [withdrawRoute(app)]: [json({ detail: 'unauthenticated' }, 401)],
    }));
    fireEvent.click(await screen.findByRole('button', { name: he.applications.withdraw }));
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/login');
    });
    view.unmount();
    vi.unstubAllGlobals();

    // 403 and a network error: the generic error in the card.
    for (const reply of [() => json({ detail: 'seeker_only' }, 403), networkError]) {
      ({ view } = renderPage([json([app])], { [withdrawRoute(app)]: [reply] }));
      fireEvent.click(await screen.findByRole('button', { name: he.applications.withdraw }));
      const card = within(cards()[0] as HTMLElement);
      expect(await card.findByRole('alert')).toHaveTextContent(he.common.error);
      expect(currentPath()).toBe(PATH);
      view.unmount();
      vi.unstubAllGlobals();
    }
  });
});
