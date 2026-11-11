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
import { RequireOwner } from '../../auth/RequireOwner';
import { listing, owner, seeker } from '../../listings/__tests__/fixtures';
import type { ApplicantOut } from '../api';
import { ApplicantsPage } from '../ApplicantsPage';
import { applicant } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Reply = Parameters<typeof mockApi>[0][string][number];

const A = listing({ price_ils: 7200 });
const B = listing();
const PATH = `/me/listings/${A.id}/applicants`;
const MINE = 'GET /me/listings';
const APPS = `GET /listings/${A.id}/applications`;
const patchRoute = (p: ApplicantOut) => `PATCH /listings/${A.id}/applications/${p.id}`;
const MICHAL = '\u05de\u05d9\u05db\u05dc';

const routes = (
  <Routes>
    <Route path="/" element={<p>home</p>} />
    <Route path="/login" element={<p>login</p>} />
    <Route element={<RequireOwner />}>
      <Route path="/me/listings" element={<p>mine</p>} />
      <Route path="/me/listings/:id/applicants" element={<ApplicantsPage />} />
    </Route>
  </Routes>
);

/** An owner on listing A's applicants (or at `path`), with "my listings" answering `mine`. */
function renderPage(
  apps: Reply[],
  {
    mine = [json([A])],
    extra = {},
    path = PATH,
    client = testQueryClient(),
  }: {
    mine?: Reply[];
    extra?: Record<string, Reply[]>;
    path?: string;
    client?: ReturnType<typeof testQueryClient>;
  } = {},
) {
  const api = mockApi({ 'GET /me': [json(owner)], [MINE]: mine, [APPS]: apps, ...extra });
  const view = renderRoutes(path, routes, client);
  return { api, view, client };
}

function reset(view: { unmount: () => void }) {
  view.unmount();
  vi.unstubAllGlobals();
}

const cards = () => screen.getAllByRole('article');
const filters = () => screen.getByRole('group', { name: he.applicants.filter.label });
const filterButton = (key: 'all' | 'new' | 'shortlisted' | 'declined', count: number) =>
  within(filters()).getByRole('button', {
    name: i18n.t(`applicants.filter.${key}`, { count }),
  });
const totals = () =>
  within(screen.getByTestId('applicant-totals'))
    .getAllByRole('listitem')
    .map((item) => item.textContent);
const cardOf = (name: string) =>
  screen.getByRole('article', { name }) as HTMLElement & { tagName: 'ARTICLE' };
const chipOf = (name: string) => within(cardOf(name)).getByTestId('application-status');
const buttonsOf = (name: string) =>
  within(cardOf(name))
    .queryAllByRole('button')
    .map((b) => b.textContent);
const appliedText = (p: ApplicantOut) =>
  i18n.t('applicants.appliedAt', {
    date: new Intl.DateTimeFormat('he-IL', {
      day: 'numeric',
      month: 'numeric',
      year: '2-digit',
      timeZone: 'Asia/Jerusalem',
    }).format(new Date(p.created_at)),
  });

describe('ApplicantsPage', () => {
  it('ac2_states', async () => {
    // "My listings" pending: one busy skeleton.
    const pending = deferred();
    let { view } = renderPage([json([])], { mine: [pending.promise] });
    const busy = await screen.findByLabelText(he.common.loading);
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(busy).getAllByTestId('skeleton')).toHaveLength(1);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    reset(view);

    // "My listings" failing: ErrorState; retry refetches.
    let api;
    ({ api, view } = renderPage([json([])], { mine: [json({ detail: 'boom' }, 500), json([A])] }));
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(
      await screen.findByRole('heading', { level: 1, name: he.applicants.title }),
    ).toBeVisible();
    expect(api.calls(MINE)).toHaveLength(2);
    reset(view);

    // Not in the owner's list (another owner's, a random uuid, malformed): not found, and the
    // applicants are never requested.
    for (const id of [B.id, crypto.randomUUID(), 'abc']) {
      const opened = renderPage([json([])], { path: `/me/listings/${id}/applicants` });
      expect(
        await screen.findByRole('heading', { level: 1, name: he.applicants.notFound }),
      ).toBeVisible();
      expect(screen.getByRole('link', { name: he.listings.edit.backToMine })).toHaveAttribute(
        'href',
        '/me/listings',
      );
      expect(opened.api.fetchMock.mock.calls.map(([r]) => new URL(r.url).pathname)).not.toContain(
        `/listings/${id}/applications`,
      );
      expect(
        opened.api.fetchMock.mock.calls.filter(([r]) => r.url.includes('/applications')),
      ).toHaveLength(0);
      reset(opened.view);
    }

    // Found, applicants pending: three skeleton cards in a busy list, under the heading.
    const apps = deferred();
    ({ view } = renderPage([apps.promise]));
    expect(
      await screen.findByRole('heading', { level: 1, name: he.applicants.title }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: he.listings.edit.backToMine })).toHaveAttribute(
      'href',
      '/me/listings',
    );
    const list = screen.getByRole('list', { name: he.common.loading });
    expect(list).toHaveAttribute('aria-busy', 'true');
    expect(within(list).getAllByTestId('skeleton')).toHaveLength(3);
    reset(view);

    // Applicants failing: ErrorState; retry refetches.
    ({ api, view } = renderPage([json({ detail: 'boom' }, 500), json([])]));
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await screen.findByText(he.applicants.empty)).toBeVisible();
    expect(api.calls(APPS)).toHaveLength(2);
    expect(api.calls(APPS)[0]?.request.credentials).toBe('include');
    reset(view);

    // None: the empty state, no totals, no filters.
    ({ view } = renderPage([json([])]));
    expect(await screen.findByText(he.applicants.empty)).toBeVisible();
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByTestId('applicant-totals')).toBeNull();
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('ac3_header_totals_and_filters', async () => {
    const five = [
      applicant({ status: 'submitted' }),
      applicant({ status: 'shortlisted' }),
      applicant({ status: 'submitted' }),
      applicant({ status: 'declined' }),
      applicant({ status: 'shortlisted' }),
    ];
    const { view } = renderPage([json(five)]);
    await screen.findAllByRole('article');

    // The listing's title and price, no view count.
    expect(
      screen.getByText(
        i18n.t('listings.card.title', { rooms: '3', street: A.street, city: A.city }),
      ),
    ).toBeVisible();
    expect(screen.getByText(/7,200[\s‎‏]*₪/)).toBeVisible();
    expect(document.body.textContent).not.toContain('\u05e6\u05e4\u05d9\u05d5\u05ea');

    // Totals: applicants, shortlisted, new.
    expect(totals()).toEqual([
      `5 ${he.applicants.stats.total}`,
      `2 ${he.applicants.stats.shortlisted}`,
      `2 ${he.applicants.stats.new}`,
    ]);

    // Four filters with counts; "all" pressed; every card in API order.
    const all = filterButton('all', 5);
    const fresh = filterButton('new', 2);
    const short = filterButton('shortlisted', 2);
    const declined = filterButton('declined', 1);
    expect(within(filters()).getAllByRole('button')).toEqual([all, fresh, short, declined]);
    expect(all).toHaveAttribute('aria-pressed', 'true');
    for (const b of [fresh, short, declined]) expect(b).toHaveAttribute('aria-pressed', 'false');
    expect(cards().map((c) => within(c).getByRole('heading', { level: 2 }).textContent)).toEqual(
      five.map((p) => p.applicant_name),
    );

    // "New": the two submitted ones.
    fireEvent.click(fresh);
    expect(fresh).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(cards().map((c) => within(c).getByRole('heading', { level: 2 }).textContent)).toEqual([
      five[0]?.applicant_name,
      five[2]?.applicant_name,
    ]);

    // "Declined": one.
    fireEvent.click(declined);
    expect(declined).toHaveAttribute('aria-pressed', 'true');
    expect(cards()).toHaveLength(1);
    expect(within(cards()[0] as HTMLElement).getByRole('heading', { level: 2 })).toHaveTextContent(
      five[3]?.applicant_name ?? '',
    );
    reset(view);

    // No declined applicant: that filter shows the "nothing here" message.
    renderPage([json([applicant(), applicant({ status: 'shortlisted' })])]);
    await screen.findAllByRole('article');
    fireEvent.click(filterButton('declined', 0));
    expect(screen.getByText(he.applicants.emptyFilter)).toBeVisible();
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('ac4_applicant_card', async () => {
    const submitted = applicant({
      applicant_name: MICHAL,
      status: 'submitted',
      message: 'line one\nline two',
    });
    const shortlisted = applicant({ status: 'shortlisted' });
    const declined = applicant({ status: 'declined' });
    renderPage([json([submitted, shortlisted, declined])]);
    await screen.findAllByRole('article');

    const card = cardOf(MICHAL);
    const inCard = within(card);
    const avatar = inCard.getByText('\u05de', { exact: true });
    expect(avatar).toHaveAttribute('aria-hidden', 'true');
    const heading = inCard.getByRole('heading', { level: 2, name: MICHAL });
    expect(card).toHaveAttribute('aria-labelledby', heading.id);
    expect(chipOf(MICHAL)).toHaveTextContent(he.applicants.status.submitted);
    expect(inCard.getByText(appliedText(submitted))).toBeVisible();
    const message = inCard.getByTestId('applicant-message');
    expect(message.textContent).toBe('line one\nline two');
    expect(message).toHaveClass('whitespace-pre-line', 'break-words');
    expect(message).toHaveAttribute('dir', 'auto');
    expect(message.querySelector('a')).toBeNull();
    expect(buttonsOf(MICHAL)).toEqual([
      he.applicants.actions.shortlist,
      he.applicants.actions.decline,
    ]);
    for (const button of inCard.getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-describedby', heading.id);
      expect(button).toHaveAccessibleDescription(MICHAL);
    }

    expect(chipOf(shortlisted.applicant_name)).toHaveTextContent(he.applicants.status.shortlisted);
    expect(buttonsOf(shortlisted.applicant_name)).toEqual([
      he.applicants.actions.unshortlist,
      he.applicants.actions.decline,
    ]);

    expect(chipOf(declined.applicant_name)).toHaveTextContent(he.applicants.status.declined);
    expect(buttonsOf(declined.applicant_name)).toEqual([]);
  });

  it('ac5_shortlist_unshortlist_decline', async () => {
    // Shortlist: one PATCH, busy while pending; on 200 the card, totals and announcement update.
    const P = applicant({ applicant_name: MICHAL, status: 'submitted' });
    const Q = applicant({ status: 'shortlisted' });
    const patch = deferred();
    let { api, view } = renderPage([json([P, Q])], {
      mine: [json([A]), json([{ ...A, new_applicant_count: 0 }])],
      extra: { [patchRoute(P)]: [patch.promise] },
    });
    await screen.findAllByRole('article');
    expect(totals()).toEqual([
      `2 ${he.applicants.stats.total}`,
      `1 ${he.applicants.stats.shortlisted}`,
      `1 ${he.applicants.stats.new}`,
    ]);
    const shortlist = within(cardOf(MICHAL)).getByRole('button', {
      name: he.applicants.actions.shortlist,
    });
    const decline = within(cardOf(MICHAL)).getByRole('button', {
      name: he.applicants.actions.decline,
    });
    fireEvent.click(shortlist);
    fireEvent.click(shortlist);
    await vi.waitFor(() => {
      expect(shortlist).toBeDisabled();
    });
    expect(decline).toBeDisabled();
    expect(shortlist).toHaveAttribute('aria-busy', 'true');
    expect(decline).toHaveAttribute('aria-busy', 'false');
    expect(api.calls(patchRoute(P))).toHaveLength(1);
    const [call] = api.calls(patchRoute(P));
    expect(call?.body).toEqual({ status: 'shortlisted' });
    expect(call?.request.credentials).toBe('include');
    // Server-confirmed: the chip is unchanged while the PATCH runs.
    expect(chipOf(MICHAL)).toHaveTextContent(he.applicants.status.submitted);

    patch.resolve(json({ ...P, status: 'shortlisted' }));
    await vi.waitFor(() => {
      expect(chipOf(MICHAL)).toHaveTextContent(he.applicants.status.shortlisted);
    });
    expect(buttonsOf(MICHAL)).toEqual([
      he.applicants.actions.unshortlist,
      he.applicants.actions.decline,
    ]);
    expect(totals()).toEqual([
      `2 ${he.applicants.stats.total}`,
      `2 ${he.applicants.stats.shortlisted}`,
      `0 ${he.applicants.stats.new}`,
    ]);
    await vi.waitFor(() => {
      expect(within(cardOf(MICHAL)).getByRole('heading', { level: 2 })).toHaveFocus();
    });
    // The polite announcement (the harness's location probe is an <output>, also a status).
    const announced = screen.getByText(
      i18n.t('applicants.statusChanged', {
        name: MICHAL,
        status: he.applicants.status.shortlisted,
      }),
    );
    expect(announced).toHaveAttribute('role', 'status');
    expect(announced).toHaveTextContent(MICHAL);
    // "My listings" (the counts) is invalidated and refetched.
    await vi.waitFor(() => {
      expect(api.calls(MINE)).toHaveLength(2);
    });

    // Unshortlist sends `submitted`.
    const unshortlistRoute = patchRoute(Q);
    reset(view);
    ({ api, view } = renderPage([json([P, Q])], {
      extra: { [unshortlistRoute]: [json({ ...Q, status: 'submitted' })] },
    }));
    await screen.findAllByRole('article');
    fireEvent.click(
      within(cardOf(Q.applicant_name)).getByRole('button', {
        name: he.applicants.actions.unshortlist,
      }),
    );
    await vi.waitFor(() => {
      expect(chipOf(Q.applicant_name)).toHaveTextContent(he.applicants.status.submitted);
    });
    expect(api.calls(unshortlistRoute).map((c) => c.body)).toEqual([{ status: 'submitted' }]);
    reset(view);

    // Filter "new" pressed: a shortlisted card leaves the view; focus goes to that filter.
    ({ api, view } = renderPage([json([P, Q])], {
      extra: { [patchRoute(P)]: [json({ ...P, status: 'shortlisted' })] },
    }));
    await screen.findAllByRole('article');
    fireEvent.click(filterButton('new', 1));
    expect(cards()).toHaveLength(1);
    fireEvent.click(
      within(cardOf(MICHAL)).getByRole('button', { name: he.applicants.actions.shortlist }),
    );
    await vi.waitFor(() => {
      expect(screen.queryByRole('article', { name: MICHAL })).toBeNull();
    });
    await vi.waitFor(() => {
      expect(filterButton('new', 0)).toHaveFocus();
    });
    expect(filterButton('new', 0)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(he.applicants.emptyFilter)).toBeVisible();
    reset(view);

    // Decline asks first: cancel sends nothing.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    ({ api, view } = renderPage([json([P])], {
      extra: { [patchRoute(P)]: [json({ ...P, status: 'declined' })] },
    }));
    await screen.findByRole('article');
    const declineButton = () =>
      within(cardOf(MICHAL)).getByRole('button', { name: he.applicants.actions.decline });
    fireEvent.click(declineButton());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(i18n.t('applicants.declineConfirm', { name: MICHAL }));
    expect(confirm.mock.calls[0]?.[0]).toContain(MICHAL);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(api.calls(patchRoute(P))).toHaveLength(0);
    expect(chipOf(MICHAL)).toHaveTextContent(he.applicants.status.submitted);

    // Confirmed: `declined`, and the card has no buttons.
    confirm.mockReturnValue(true);
    fireEvent.click(declineButton());
    await vi.waitFor(() => {
      expect(chipOf(MICHAL)).toHaveTextContent(he.applicants.status.declined);
    });
    expect(api.calls(patchRoute(P)).map((c) => c.body)).toEqual([{ status: 'declined' }]);
    expect(buttonsOf(MICHAL)).toEqual([]);
    await vi.waitFor(() => {
      expect(within(cardOf(MICHAL)).getByRole('heading', { level: 2 })).toHaveFocus();
    });
  });

  it('ac6_action_errors', async () => {
    const P = applicant({ applicant_name: MICHAL, status: 'submitted' });
    const Q = applicant({ status: 'shortlisted' });
    const shortlistP = () =>
      fireEvent.click(
        within(cardOf(MICHAL)).getByRole('button', { name: he.applicants.actions.shortlist }),
      );

    // 404 (P withdrew): the list is requested again, the "gone" alert shows and focus is on the
    // pressed filter button.
    let { api, view } = renderPage([json([P, Q]), json([Q])], {
      extra: { [patchRoute(P)]: [json({ detail: 'not_found' }, 404)] },
    });
    await screen.findAllByRole('article');
    shortlistP();
    await vi.waitFor(() => {
      expect(api.calls(APPS)).toHaveLength(2);
    });
    expect(await screen.findByText(he.applicants.errors.gone)).toHaveAttribute('role', 'alert');
    expect(screen.queryByRole('article', { name: MICHAL })).toBeNull();
    await vi.waitFor(() => {
      expect(filterButton('all', 1)).toHaveFocus();
    });
    reset(view);

    // 404 for the only applicant: no filter group remains, so focus is on the <h1>.
    ({ api, view } = renderPage([json([P]), json([])], {
      extra: { [patchRoute(P)]: [json({ detail: 'not_found' }, 404)] },
    }));
    await screen.findByRole('article');
    shortlistP();
    expect(await screen.findByText(he.applicants.errors.gone)).toBeVisible();
    expect(screen.getByText(he.applicants.empty)).toBeVisible();
    await vi.waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: he.applicants.title })).toHaveFocus();
    });
    reset(view);

    // 409 (declined meanwhile): requested again, the error in the card, focus on its <h2>.
    ({ api, view } = renderPage([json([P, Q]), json([{ ...P, status: 'declined' }, Q])], {
      extra: { [patchRoute(P)]: [json({ detail: 'invalid_transition' }, 409)] },
    }));
    await screen.findAllByRole('article');
    shortlistP();
    await vi.waitFor(() => {
      expect(api.calls(APPS)).toHaveLength(2);
    });
    expect(await within(cardOf(MICHAL)).findByRole('alert')).toHaveTextContent(he.common.error);
    expect(chipOf(MICHAL)).toHaveTextContent(he.applicants.status.declined);
    expect(screen.queryByText(he.applicants.errors.gone)).toBeNull();
    await vi.waitFor(() => {
      expect(within(cardOf(MICHAL)).getByRole('heading', { level: 2 })).toHaveFocus();
    });
    reset(view);

    // 401: the session is gone; RequireOwner sends the owner to /login.
    ({ view } = renderPage([json([P])], {
      extra: { [patchRoute(P)]: [json({ detail: 'unauthenticated' }, 401)] },
    }));
    await screen.findByRole('article');
    shortlistP();
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/login');
    });
    reset(view);

    // 403: /me is re-checked and now answers a seeker; RequireOwner sends them to /.
    ({ api, view } = renderPage([json([P])], {
      extra: {
        'GET /me': [json(owner), json(seeker)],
        [patchRoute(P)]: [json({ detail: 'owner_only' }, 403)],
      },
    }));
    await screen.findByRole('article');
    shortlistP();
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/');
    });
    expect(api.calls('GET /me')).toHaveLength(2);
    reset(view);

    // A network error: the error in the card, the chip unchanged, the buttons enabled again.
    ({ view } = renderPage([json([P])], { extra: { [patchRoute(P)]: [networkError] } }));
    await screen.findByRole('article');
    shortlistP();
    expect(await within(cardOf(MICHAL)).findByRole('alert')).toHaveTextContent(he.common.error);
    expect(chipOf(MICHAL)).toHaveTextContent(he.applicants.status.submitted);
    for (const button of within(cardOf(MICHAL)).getAllByRole('button')) {
      expect(button).toBeEnabled();
    }
    await vi.waitFor(() => {
      expect(
        within(cardOf(MICHAL)).getByRole('button', { name: he.applicants.actions.shortlist }),
      ).toHaveFocus();
    });
    reset(view);

    // A successful action, then the "my listings" refetch fails: the inbox stays on screen.
    const client = testQueryClient();
    ({ api, view } = renderPage([json([P, Q])], {
      client,
      mine: [json([A]), networkError],
      extra: { [patchRoute(P)]: [json({ ...P, status: 'shortlisted' })] },
    }));
    await screen.findAllByRole('article');
    shortlistP();
    await vi.waitFor(() => {
      expect(api.calls(MINE)).toHaveLength(2);
    });
    await act(async () => {
      // TanStack notifies observers on a timeout; let the error reach the page.
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(client.getQueryState(['me', 'listings'])?.status).toBe('error');
    expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: he.applicants.title })).toBeVisible();
    expect(cards()).toHaveLength(2);
    expect(chipOf(MICHAL)).toHaveTextContent(he.applicants.status.shortlisted);
  });
});
