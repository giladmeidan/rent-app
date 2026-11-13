import { act, fireEvent, screen, within } from '@testing-library/react';
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
  testQueryClient,
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
      {/* The rooms, as the market's "שלי" embeds them (spec 0010a). */}
      <Route path="/market/mine" element={<MyApplicationsPage type="room" panel />} />
    </Route>
  </Routes>
);

/** A seeker on "my applications" whose list answers `mine`. */
function renderPage(
  mine: Reply[],
  extra: Record<string, Reply[]> = {},
  client = testQueryClient(),
) {
  const api = mockApi({ 'GET /me': [json(seeker)], [MINE]: mine, ...extra });
  const view = renderRoutes(PATH, routes, client);
  return { api, view };
}

/** The same seeker's room applications panel. */
function renderRooms(mine: Reply[]) {
  const api = mockApi({ 'GET /me': [json(seeker)], [MINE]: mine });
  const view = renderRoutes('/market/mine', routes);
  return { api, view };
}

/** An application to listing `listingId`. */
function to(listingId: string, overrides: Partial<MyApplicationOut> = {}): MyApplicationOut {
  const app = application(overrides);
  return { ...app, listing: { ...app.listing, id: listingId } };
}

const titleOf = (app: MyApplicationOut) =>
  i18n.t('listings.card.title', {
    count: app.listing.rooms,
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
  it('ac3_page_title', async () => {
    renderPage([json([application()])]);
    await screen.findByRole('heading', { level: 1, name: he.applications.mine.title });
    expect(document.title).toBe(
      i18n.t('app.pageTitle', { page: he.applications.mine.title, app: he.app.title }),
    );
  });

  it('ac7_my_applications_states', async () => {
    // Pending: three skeleton rows in a busy block.
    const pending = deferred();
    let { view } = renderPage([pending.promise]);
    await screen.findByRole('heading', { level: 1, name: he.applications.mine.title });
    const busy = screen.getByText(he.common.loading).closest<HTMLElement>('[aria-busy="true"]');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(busy as HTMLElement).getAllByTestId('skeleton')).toHaveLength(3);
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

    // A background refetch fails: the cached list stays on the page (no ErrorState).
    const client = testQueryClient();
    const cached = to('L1', { status: 'submitted' });
    const refetching = renderPage([json([cached]), networkError], {}, client);
    view = refetching.view;
    await screen.findByRole('article');
    await act(async () => {
      await client.refetchQueries({ queryKey: ['me', 'applications'] });
      // TanStack notifies observers on a timeout; let the error reach the page.
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(refetching.api.calls(MINE)).toHaveLength(2);
    expect(client.getQueryState(['me', 'applications'])?.status).toBe('error');
    expect(cards()).toHaveLength(1);
    expect(screen.getByText(titleOf(cached))).toBeVisible();
    expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
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
      // A 44 px target that reads as a link.
      expect(link).toHaveClass('inline-flex', 'min-h-tap', 'underline', 'text-accent');
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

  it('ac4_room_title', async () => {
    const app = application();
    const room = {
      ...app,
      listing: {
        ...app.listing,
        listing_type: 'room' as const,
        rooms: 4,
        street: '\u05d4\u05e8\u05e6\u05dc',
      },
    };
    // A room application is the market's (spec 0010a).
    renderRooms([json([room])]);
    expect(
      await screen.findByRole('link', {
        name: '\u05d7\u05d3\u05e8 \u05d1\u05be4 \u05d7\u05d3\u05e8\u05d9\u05dd, \u05e8\u05d7\u05d5\u05d1 \u05d4\u05e8\u05e6\u05dc, \u05e8\u05de\u05ea \u05d2\u05df',
      }),
    ).toBeVisible();
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
    expect(await first.findByRole('alert')).toHaveTextContent(
      he.applications.errors.notWithdrawable,
    );
    expect(within(cards()[1] as HTMLElement).queryByRole('alert')).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // 404 (the application is gone): the list is requested again and the card shows the error.
    ({ api, view } = renderPage([() => json([app])], {
      [withdrawRoute(app)]: [json({ detail: 'not_found' }, 404)],
    }));
    fireEvent.click(await screen.findByRole('button', { name: he.applications.withdraw }));
    await vi.waitFor(() => {
      expect(api.calls(MINE)).toHaveLength(2);
    });
    expect(await within(cards()[0] as HTMLElement).findByRole('alert')).toHaveTextContent(
      he.common.error,
    );
    view.unmount();
    vi.unstubAllGlobals();

    // 401: the session is gone; RequireSeeker sends the person to /login.
    ({ view } = renderPage([json([app])], {
      [withdrawRoute(app)]: [json({ detail: 'unauthenticated' }, 401)],
    }));
    fireEvent.click(await screen.findByRole('button', { name: he.applications.withdraw }));
    await vi.waitFor(() => {
      expect(currentPath()).toBe(`/login?next=${encodeURIComponent(PATH)}`);
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

  it('ac2_focus_after_withdraw', async () => {
    // 200: the button is gone, focus is on that card's title link.
    const app = to('L1', { status: 'submitted' });
    const other = to('L2', { status: 'submitted' });
    let { view } = renderPage([json([app, other])], {
      [withdrawRoute(app)]: [json({ ...app, status: 'withdrawn' })],
    });
    await screen.findAllByRole('button', { name: he.applications.withdraw });
    let button = within(cards()[0] as HTMLElement).getByRole('button');
    act(() => button.focus());
    fireEvent.click(button);
    const title = within(cards()[0] as HTMLElement).getByRole('link', { name: titleOf(app) });
    await vi.waitFor(() => {
      expect(title).toHaveFocus();
    });
    expect(within(cards()[0] as HTMLElement).queryByRole('button')).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // 409 not_withdrawable, the refetch answering `declined`: the card's alert line.
    ({ view } = renderPage([json([app, other]), json([{ ...app, status: 'declined' }, other])], {
      [withdrawRoute(app)]: [json({ detail: 'not_withdrawable' }, 409)],
    }));
    await screen.findAllByRole('button', { name: he.applications.withdraw });
    button = within(cards()[0] as HTMLElement).getByRole('button');
    act(() => button.focus());
    fireEvent.click(button);
    const alert = await within(cards()[0] as HTMLElement).findByRole('alert');
    await vi.waitFor(() => {
      expect(alert).toHaveFocus();
    });
    expect(screen.getAllByTestId('application-status')[0]).toHaveTextContent(
      he.applications.status.declined,
    );
    view.unmount();
    vi.unstubAllGlobals();

    // 404, the refetch dropping the card: focus falls back to <main>.
    mockApi({
      'GET /me': [json(seeker)],
      [MINE]: [json([app, other]), json([other])],
      [withdrawRoute(app)]: [json({ detail: 'not_found' }, 404)],
    });
    renderRoutes(
      PATH,
      <main id="main" tabIndex={-1}>
        {routes}
      </main>,
    );
    await screen.findAllByRole('button', { name: he.applications.withdraw });
    button = within(cards()[0] as HTMLElement).getByRole('button');
    act(() => button.focus());
    fireEvent.click(button);
    await vi.waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
    await vi.waitFor(() => {
      expect(screen.getByRole('main')).toHaveFocus();
    });
  });

  it('ac4_not_withdrawable_copy', async () => {
    // "כבר אי אפשר לבטל את המועמדות הזו. הסטטוס שלה עודכן."
    const tooLate =
      '\u05db\u05d1\u05e8 \u05d0\u05d9 \u05d0\u05e4\u05e9\u05e8 \u05dc\u05d1\u05d8\u05dc \u05d0\u05ea \u05d4\u05de\u05d5\u05e2\u05de\u05d3\u05d5\u05ea \u05d4\u05d6\u05d5. \u05d4\u05e1\u05d8\u05d8\u05d5\u05e1 \u05e9\u05dc\u05d4 \u05e2\u05d5\u05d3\u05db\u05df.';
    const app = to('L1', { status: 'submitted' });
    let { api, view } = renderPage([json([app]), json([{ ...app, status: 'shortlisted' }])], {
      [withdrawRoute(app)]: [json({ detail: 'not_withdrawable' }, 409)],
    });
    fireEvent.click(await screen.findByRole('button', { name: he.applications.withdraw }));
    await vi.waitFor(() => {
      expect(api.calls(MINE)).toHaveLength(2);
    });
    const card = within(cards()[0] as HTMLElement);
    expect(await card.findByRole('alert')).toHaveTextContent(tooLate);
    // Next to the refetched status.
    await vi.waitFor(() => {
      expect(card.getByTestId('application-status')).toHaveTextContent(
        he.applications.status.shortlisted,
      );
    });
    view.unmount();
    vi.unstubAllGlobals();

    // A 500: the generic line ("משהו השתבש").
    ({ api, view } = renderPage([json([app])], {
      [withdrawRoute(app)]: [json({ detail: 'boom' }, 500)],
    }));
    fireEvent.click(await screen.findByRole('button', { name: he.applications.withdraw }));
    const alert = await within(cards()[0] as HTMLElement).findByRole('alert');
    expect(alert).toHaveTextContent('\u05de\u05e9\u05d4\u05d5 \u05d4\u05e9\u05ea\u05d1\u05e9');
    expect(alert).not.toHaveTextContent(tooLate);
    view.unmount();
  });

  it('ac1_offline_on_failed_withdraw', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const app = to('L1', { status: 'submitted' });
    const { view } = renderPage([json([app])], { [withdrawRoute(app)]: [networkError] });
    fireEvent.click(await screen.findByRole('button', { name: he.applications.withdraw }));
    const alert = await within(cards()[0] as HTMLElement).findByRole('alert');
    expect(alert.textContent).toBe(he.common.offline);
    view.unmount();
    onLine.mockRestore();
  });

  it('ac10_chat_link_on_shortlisted', async () => {
    const shortlisted = to('L1', { status: 'shortlisted' });
    const submitted = to('L2', { status: 'submitted' });
    renderPage([json([shortlisted, submitted])]);
    await screen.findAllByRole('article');
    const [first, second] = cards() as [HTMLElement, HTMLElement];

    // Only the shortlisted card links to its chat, before the withdraw button.
    const link = within(first).getByRole('link', { name: he.applications.chat });
    expect(link).toHaveAttribute('href', `/chat/${shortlisted.id}`);
    const withdraw = within(first).getByRole('button', { name: he.applications.withdraw });
    expect(link.compareDocumentPosition(withdraw) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(second).queryByRole('link', { name: he.applications.chat })).toBeNull();
    expect(screen.getAllByRole('link', { name: he.applications.chat })).toHaveLength(1);
  });

  it('ac7_mutual_tag', async () => {
    const mutual = to('L1', { source: 'like', message: null, status: 'shortlisted' });
    const applied = to('L2');
    renderPage([json([mutual, applied])]);
    await screen.findAllByRole('article');
    const [first, second] = cards() as [HTMLElement, HTMLElement];

    expect(within(first).getByTestId('application-mutual')).toHaveTextContent(
      he.applications.mutual,
    );
    expect(within(first).queryByText(he.applications.yourMessage)).toBeNull();
    expect(within(first).queryByTestId('application-message')).toBeNull();
    // An application made with a message is unchanged.
    expect(within(second).queryByTestId('application-mutual')).toBeNull();
    expect(within(second).getByText(he.applications.yourMessage)).toBeVisible();
    expect(within(second).getByTestId('application-message')).toHaveTextContent(
      applied.message ?? '',
    );
  });

  it('ac1_cards_kit_layout', async () => {
    const message = 'line one\nline two\nline three';
    const submitted = to('L1', { status: 'submitted', message });
    const shortlisted = to('L2', { status: 'shortlisted' });
    const declined = to('L3', { status: 'declined' });
    const withdrawn = to('L4', { status: 'withdrawn' });
    const mutual = to('L5', { source: 'like', message: null, status: 'shortlisted' });
    const apps = [submitted, shortlisted, declined, withdrawn, mutual];
    renderPage([json(apps)]);
    await screen.findAllByRole('article');
    expect(cards()).toHaveLength(5);

    const tones = {
      submitted: ['bg-surface-subtle', 'text-ink-muted'],
      shortlisted: ['bg-accent-soft', 'text-accent-strong'],
      declined: ['bg-surface-subtle', 'text-ink-muted'],
      withdrawn: ['bg-surface-subtle', 'text-ink-muted'],
    } as const;
    apps.forEach((app, i) => {
      const card = cards()[i] as HTMLElement;
      const inside = within(card);
      expect(card).toHaveClass('rounded-lg');
      // Every card is the default one (the spec's fallback, taken at the ux review).
      expect(card).toHaveClass('bg-surface', 'border', 'border-border');
      const badge = inside.getByTestId('application-status');
      expect(badge).toHaveTextContent(he.applications.status[app.status as 'submitted']);
      expect(badge).toHaveClass('rounded-full', ...tones[app.status as keyof typeof tones]);
      expect(badge).not.toHaveClass('bg-accent');
      // The chat link is only on the shortlisted cards, described by the title.
      const chat = inside.queryByRole('link', { name: he.applications.chat });
      if (app.status === 'shortlisted') {
        expect(chat).toHaveAttribute('href', `/chat/${app.id}`);
        const heading = inside.getByRole('heading', { level: 2 });
        expect(chat?.getAttribute('aria-describedby')).toBe(heading.id);
      } else {
        expect(chat).toBeNull();
      }
      const link = within(inside.getByRole('heading', { level: 2 })).getByRole('link');
      expect(link).toHaveClass('min-h-tap', 'underline');
    });

    // The message keeps its line breaks and renders as text.
    const body = within(cards()[0] as HTMLElement).getByTestId('application-message');
    expect(body.textContent).toBe(message);
    expect(body).toHaveClass('whitespace-pre-line', 'bg-surface-subtle');
    expect(body.children).toHaveLength(0);
    // The mutual card shows its tag and no message.
    const last = within(cards()[4] as HTMLElement);
    expect(last.getByTestId('application-mutual')).toHaveTextContent(he.applications.mutual);
    expect(last.queryByTestId('application-message')).toBeNull();
    // Only the shortlisted cards have a chat link.
    expect(screen.getAllByRole('link', { name: he.applications.chat })).toHaveLength(2);
  });

  it('ac2_empty_action_and_errors', async () => {
    // Empty: the way to search sits inside the EmptyState's card.
    let { view } = renderPage([json([])]);
    const message = await screen.findByText(he.applications.mine.empty);
    const search = screen.getByRole('link', { name: he.applications.mine.search });
    expect(search).toHaveAttribute('href', '/search');
    // Inside the same Card as the message (EmptyState wraps the action in a div).
    expect(search.closest('div')?.parentElement).toBe(message.parentElement);
    view.unmount();
    vi.unstubAllGlobals();

    // A withdraw answering 500 shows the card's alert.
    const app = to('L1', { status: 'submitted' });
    ({ view } = renderPage([json([app])], {
      [withdrawRoute(app)]: [json({ detail: 'boom' }, 500)],
    }));
    fireEvent.click(await screen.findByRole('button', { name: he.applications.withdraw }));
    const alert = await within(cards()[0] as HTMLElement).findByRole('alert');
    expect(alert).toHaveTextContent(he.common.error);
    expect(alert).toHaveClass('text-danger');
    view.unmount();
  });

  it('ac4_sleep_mascot_and_tones', async () => {
    // Empty: the sleep mascot.
    let { view } = renderPage([json([])]);
    await screen.findByText(he.applications.mine.empty);
    const images = document.querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(((images[0] as HTMLImageElement).getAttribute('src') ?? '').split('/').pop()).toBe(
      'homie-turtle-sleep.svg',
    );
    view.unmount();
    vi.unstubAllGlobals();

    // No status badge is solid, whatever the status.
    const statuses = ['submitted', 'shortlisted', 'declined', 'withdrawn'] as const;
    ({ view } = renderPage([json(statuses.map((status, i) => to(`L${String(i)}`, { status })))]));
    await screen.findAllByRole('article');
    const badges = screen.getAllByTestId('application-status');
    expect(badges).toHaveLength(4);
    for (const badge of badges) {
      expect(badge).not.toHaveClass('bg-accent');
      expect(badge).not.toHaveClass('tabular-nums');
    }
    view.unmount();
  });

  it('ac11_apartments_only', async () => {
    // Spec 0010a: one apartment and one room application; each side shows its own.
    const flat = to('L1');
    const roomApp = application();
    const room = {
      ...roomApp,
      listing: { ...roomApp.listing, id: 'R1', listing_type: 'room' as const },
    };
    let { view } = renderPage([json([flat, room])]);
    expect(await screen.findByRole('link', { name: titleOf(flat) })).toBeVisible();
    expect(cards()).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: he.applications.mine.title }),
    ).toBeVisible();
    view.unmount();
    vi.unstubAllGlobals();

    // The rooms panel: an <h2>, no page title of its own, the room only.
    ({ view } = renderRooms([json([flat, room])]));
    await vi.waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
    expect(within(cards()[0] as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      '/listings/R1',
    );
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(
      screen.getByRole('heading', { level: 2, name: he.market.mine.tabs.applications }),
    ).toBeVisible();
    view.unmount();
    vi.unstubAllGlobals();

    // Each side's empty state while the other side has applications.
    ({ view } = renderPage([json([room])]));
    expect(await screen.findByText(he.applications.mine.empty)).toBeVisible();
    expect(screen.getByRole('link', { name: he.applications.mine.search })).toHaveAttribute(
      'href',
      '/search',
    );
    view.unmount();
    vi.unstubAllGlobals();

    renderRooms([json([flat])]);
    expect(await screen.findByText(he.market.mine.applicationsEmpty)).toBeVisible();
    expect(screen.getByRole('link', { name: he.market.toSearch })).toHaveAttribute(
      'href',
      '/market',
    );
  });
});
