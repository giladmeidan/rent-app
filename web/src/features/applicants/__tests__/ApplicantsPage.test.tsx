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
import { formatDate } from '../../listings/format';
import { listing, owner, seeker } from '../../listings/__tests__/fixtures';
import { inDays } from '../../profile/__tests__/fixtures';
import type { ApplicantOut, ApplicantRoom } from '../api';
import { ApplicantsPage } from '../ApplicantsPage';
import { applicant, applicantProfile, match } from './fixtures';

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
const names = () => cards().map((c) => within(c).getByRole('heading', { level: 2 }).textContent);
const sortGroup = () => screen.getByRole('group', { name: he.applicants.sort.label });
const sortButton = (key: 'match' | 'newest') =>
  within(sortGroup()).getByRole('button', { name: he.applicants.sort[key] });
const whyOf = (name: string) =>
  within(cardOf(name)).getByRole('button', { name: he.applicants.why });
/** The disclosure's panel, found through the button's `aria-controls`. */
const panelOf = (name: string) => {
  const id = whyOf(name).getAttribute('aria-controls') ?? '';
  const panel = document.getElementById(id);
  if (panel === null) throw new Error(`no panel #${id}`);
  return panel;
};
const badge = (score: number) => i18n.t('match.badge', { score });

// AC1's three applicants: A (94) applied newest-but-one, B (59) newest, C (before Slice 6) oldest.
// B's time has a fraction and A's has none (Pydantic drops zero microseconds): compared as strings
// A would sort first.
function abc(overrides: { a?: Partial<ApplicantOut>; b?: Partial<ApplicantOut> } = {}) {
  const a = applicant({
    applicant_name: 'A',
    created_at: '2026-11-10T10:00:00Z',
    match: match(94),
    profile: applicantProfile(),
    ...overrides.a,
  });
  const b = applicant({
    applicant_name: 'B',
    created_at: '2026-11-10T10:00:00.500000Z',
    match: match(59, ['move_in', 'area', 'household'], 'budget'),
    profile: applicantProfile(),
    ...overrides.b,
  });
  const c = applicant({ applicant_name: 'C', created_at: '2026-11-09T10:00:00Z' });
  return [a, b, c] as const;
}

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
        i18n.t('listings.card.title', { count: 3, rooms: '3', street: A.street, city: A.city }),
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
      expect(currentPath()).toBe(`/login?next=${encodeURIComponent(PATH)}`);
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
  it('ac10_chat_button_on_shortlisted', async () => {
    const shortlisted = applicant({ applicant_name: MICHAL, status: 'shortlisted' });
    const submitted = applicant({ status: 'submitted' });
    const declined = applicant({ status: 'declined' });
    renderPage([json([shortlisted, submitted, declined])]);
    await screen.findAllByRole('article');

    // Only the shortlisted card: an icon link to its chat, named after the applicant and
    // described by the card's heading.
    const name = i18n.t('chat.withName', { name: MICHAL });
    const link = within(cardOf(MICHAL)).getByRole('link', { name });
    expect(link).toHaveAttribute('href', `/chat/${shortlisted.id}`);
    expect(link).toHaveAccessibleDescription(MICHAL);
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByRole('link', { name: /^\u05e6'\u05d0\u05d8 / })).toEqual([link]);
    for (const other of [submitted, declined]) {
      expect(within(cardOf(other.applicant_name)).queryByRole('link')).toBeNull();
    }
  });

  it('ac1_sorted_by_match', async () => {
    const [a, b, c] = abc();
    const { api } = renderPage([json([a, b, c])]);
    await screen.findAllByRole('article');

    // The API's order as received, each card with its score or "no score".
    expect(names()).toEqual(['A', 'B', 'C']);
    expect(within(cardOf('A')).getByTestId('match-badge')).toHaveTextContent(badge(94));
    expect(within(cardOf('B')).getByTestId('match-badge')).toHaveTextContent(badge(59));
    expect(within(cardOf('C')).queryByTestId('match-badge')).toBeNull();
    expect(within(cardOf('C')).getByText(he.match.noScore)).toBeVisible();

    // The toggle: its own labelled group, outside the filters, "by match" pressed.
    expect(within(sortGroup()).getAllByRole('button')).toEqual([
      sortButton('match'),
      sortButton('newest'),
    ]);
    expect(sortButton('match')).toHaveAttribute('aria-pressed', 'true');
    expect(sortButton('newest')).toHaveAttribute('aria-pressed', 'false');
    expect(filters()).not.toContainElement(sortButton('match'));
    // No `sort` is sent: the API's default is match.
    expect(api.calls(APPS)).toHaveLength(1);
    expect(new URL(api.calls(APPS)[0]?.request.url ?? '').search).toBe('');
  });

  it('ac2_sort_toggle_is_client_side', async () => {
    const [a, b, c] = abc();
    const { api } = renderPage([json([a, b, c])]);
    await screen.findAllByRole('article');

    // "By date": newest first, from the one loaded list.
    fireEvent.click(sortButton('newest'));
    expect(sortButton('newest')).toHaveAttribute('aria-pressed', 'true');
    expect(sortButton('match')).toHaveAttribute('aria-pressed', 'false');
    expect(names()).toEqual(['B', 'A', 'C']);
    expect(api.calls(APPS)).toHaveLength(1);

    // "By match" again: the API's order (the cached list was never sorted in place).
    fireEvent.click(sortButton('match'));
    expect(names()).toEqual(['A', 'B', 'C']);
    expect(api.calls(APPS)).toHaveLength(1);
  });

  it('ac2_sort_toggle_is_client_side: with a filter, the totals unchanged', async () => {
    const [a, b, c] = abc({ a: { status: 'shortlisted' }, b: { status: 'shortlisted' } });
    const { api } = renderPage([json([a, b, c])]);
    await screen.findAllByRole('article');
    const before = totals();
    expect(before).toEqual([
      `3 ${he.applicants.stats.total}`,
      `2 ${he.applicants.stats.shortlisted}`,
      `1 ${he.applicants.stats.new}`,
    ]);

    fireEvent.click(filterButton('shortlisted', 2));
    expect(names()).toEqual(['A', 'B']);
    fireEvent.click(sortButton('newest'));
    expect(names()).toEqual(['B', 'A']);
    expect(filterButton('shortlisted', 2)).toHaveAttribute('aria-pressed', 'true');
    expect(totals()).toEqual(before);
    fireEvent.click(sortButton('match'));
    expect(names()).toEqual(['A', 'B']);
    expect(totals()).toEqual(before);
    expect(api.calls(APPS)).toHaveLength(1);
  });

  it('ac3_summary_line', async () => {
    const date = inDays(45);
    const [a, b, c] = abc({
      a: {
        profile: applicantProfile({
          household: 'couple',
          move_in_date: date,
          move_in_flexible: true,
        }),
      },
      b: { profile: applicantProfile({ household: 'family', move_in_flexible: false }) },
    });
    renderPage([json([a, b, c])]);
    await screen.findAllByRole('article');

    expect(
      within(cardOf('A')).getByText(
        `${he.profile.household.couple} · כניסה ${formatDate(date)} ${he.applicants.flexible}`,
      ),
    ).toBeVisible();
    // Not flexible: no suffix.
    expect(
      within(cardOf('B')).getByText(
        `${he.profile.household.family} · כניסה ${formatDate(inDays(30))}`,
      ),
    ).toBeVisible();
    expect(within(cardOf('A')).getByTestId('match-chips')).toBeVisible();

    // C (before Slice 6): no summary, no chips, no disclosure.
    const inC = within(cardOf('C'));
    expect(inC.queryByText(/ · /)).toBeNull();
    expect(inC.queryByTestId('match-chips')).toBeNull();
    expect(inC.queryByRole('button', { name: he.applicants.why })).toBeNull();
    expect(inC.queryByRole('term')).toBeNull();
  });

  it('ac3_summary_line: a past move-in shows as today', async () => {
    const past = applicant({
      applicant_name: 'P',
      match: match(80),
      profile: applicantProfile({ household: 'single', move_in_date: inDays(-10) }),
    });
    renderPage([json([past])]);
    await screen.findByRole('article');
    expect(
      within(cardOf('P')).getByText(
        `${he.profile.household.single} · כניסה ${formatDate(inDays(0))}`,
      ),
    ).toBeVisible();
  });

  it('ac4_why_disclosure', async () => {
    // 0006b AC1 row 10: 98, agreeing on budget, move-in and area, differing on parking (2 asked,
    // the listing has 1).
    const date = inDays(30);
    const a = applicant({
      applicant_name: 'A',
      status: 'declined',
      match: match(98, ['budget', 'move_in', 'area'], 'parking'),
      profile: applicantProfile({
        household: 'couple',
        move_in_date: date,
        move_in_flexible: true,
        has_pets: false,
        smoker: false,
        contract_months: 24,
        parking_needed: 2,
      }),
    });
    renderPage([json([a])], { mine: [json([{ ...A, parking_spots: 1 }])] });
    await screen.findByRole('article');

    // The chips in the owner's voice.
    expect(
      within(within(cardOf('A')).getByTestId('match-chips'))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([he.match.owner.short.budget.agree, he.match.owner.short.parking.differ]);

    // Closed at first (a declined card has it too); the button controls the panel.
    const why = whyOf('A');
    const heading = within(cardOf('A')).getByRole('heading', { level: 2 });
    expect(why).toHaveAttribute('aria-expanded', 'false');
    expect(why).toHaveAttribute('aria-controls', `${heading.id}-why`);
    expect(panelOf('A')).not.toBeVisible();
    expect(within(cardOf('A')).queryByRole('term')).toBeNull();

    fireEvent.click(why);
    expect(why).toHaveAttribute('aria-expanded', 'true');
    const panel = panelOf('A');
    expect(panel).toBeVisible();
    // Opening moves no focus.
    expect(heading).not.toHaveFocus();

    // Three agreeing lines with the tick, then the differing one with the "!".
    const items = within(within(panel).getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      he.match.owner.budget.agree,
      `תאריך הכניסה מתאים (${formatDate(date)})`,
      he.match.owner.area.agree,
      '\u05d1\u05d9\u05e7\u05e9\u05d5 2 \u05d7\u05e0\u05d9\u05d5\u05ea, \u05d1\u05d3\u05d9\u05e8\u05d4 \u05d9\u05e9 \u05de\u05e7\u05d5\u05dd \u05d0\u05d7\u05d3',
    ]);
    for (const li of items) {
      expect(li.querySelector('[aria-hidden="true"]')).not.toBeNull();
    }
    expect(items[0]?.querySelector('.bg-accent-tint')).not.toBeNull();
    expect(items[3]?.querySelector('.bg-warn')).not.toBeNull();

    // The six profile rows, with A's values.
    const terms = within(panel)
      .getAllByRole('term')
      .map((dt) => dt.textContent);
    const values = within(panel)
      .getAllByRole('definition')
      .map((dd) => dd.textContent);
    expect(terms).toEqual([
      he.applicants.profile.household,
      he.applicants.profile.moveIn,
      he.applicants.profile.contract,
      he.applicants.profile.pets,
      he.applicants.profile.smoker,
      he.applicants.profile.parking,
    ]);
    expect(values).toEqual([
      he.profile.household.couple,
      `${formatDate(date)} (${he.listings.fields.entryFlexible})`,
      he.profile.contract['24'],
      he.listing.no,
      he.applicants.profile.no,
      he.profile.parking['2'],
    ]);

    // Pressing again hides them.
    fireEvent.click(why);
    expect(why).toHaveAttribute('aria-expanded', 'false');
    expect(panelOf('A')).not.toBeVisible();
    expect(within(cardOf('A')).queryByRole('term')).toBeNull();
  });

  it('ac4_why_disclosure: the other profile values', async () => {
    const a = applicant({
      applicant_name: 'A',
      match: match(70, ['budget', 'area', 'smoking'], 'contract'),
      profile: applicantProfile({
        household: 'roommates',
        move_in_flexible: false,
        has_pets: true,
        smoker: true,
        contract_months: 6,
        parking_needed: 0,
      }),
    });
    renderPage([json([a])]);
    await screen.findByRole('article');
    fireEvent.click(whyOf('A'));
    const panel = panelOf('A');
    expect(
      within(panel)
        .getAllByRole('definition')
        .map((dd) => dd.textContent),
    ).toEqual([
      he.profile.household.roommates,
      formatDate(inDays(30)),
      he.profile.contract['6'],
      he.listing.yes,
      he.applicants.profile.yes,
      he.profile.parking['0'],
    ]);
    expect(
      within(within(panel).getByRole('list'))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      he.match.owner.budget.agree,
      he.match.owner.area.agree,
      he.match.owner.smoking.agreeSmoker,
      'מחפשים חוזה של חצי שנה בלבד',
    ]);
  });

  it('ac5_patch_keeps_place', async () => {
    const [a, b] = abc();
    const { api } = renderPage([json([a, b])], {
      extra: {
        [patchRoute(a)]: [json({ ...a, status: 'shortlisted', match: match(50) })],
      },
    });
    await screen.findAllByRole('article');
    expect(names()).toEqual(['A', 'B']);

    fireEvent.click(
      within(cardOf('A')).getByRole('button', { name: he.applicants.actions.shortlist }),
    );
    await vi.waitFor(() => {
      expect(within(cardOf('A')).getByTestId('match-badge')).toHaveTextContent(badge(50));
    });
    // Now below B's 59, but the list is not re-sorted: A keeps its place.
    expect(names()).toEqual(['A', 'B']);
    expect(chipOf('A')).toHaveTextContent(he.applicants.status.shortlisted);
    expect(sortButton('match')).toHaveAttribute('aria-pressed', 'true');
    await vi.waitFor(() => {
      expect(within(cardOf('A')).getByRole('heading', { level: 2 })).toHaveFocus();
    });
    expect(api.calls(APPS)).toHaveLength(1);
  });

  it('ac7_no_amount_in_cards', async () => {
    const [a, b, c] = abc({
      b: { match: match(40, ['move_in', 'area', 'household'], 'budget') },
    });
    renderPage([json([a, b, c])]);
    await screen.findAllByRole('article');
    for (const name of ['A', 'B']) fireEvent.click(whyOf(name));

    // The header's price is the page's only amount.
    expect(screen.getByText(/7,200[\s‎‏]*₪/)).toBeVisible();
    expect(within(cardOf('A')).getByText(he.match.owner.budget.agree)).toBeVisible();
    expect(within(cardOf('B')).getByText(he.match.owner.budget.differ)).toBeVisible();
    for (const card of cards()) {
      expect(card.textContent).not.toContain('₪');
    }
  });
});

// --- 0007c: room applicants -----------------------------------------------------------------

/** A room applicant (0007c): a profile and a match, plus `room`. */
function roomApplicant(room: Partial<ApplicantRoom>, overrides: Partial<ApplicantOut> = {}) {
  return applicant({
    match: match(88),
    profile: applicantProfile(),
    room: { gender: 'woman', age: 27, lifestyle: {}, ...room },
    ...overrides,
  });
}

/** Listing A as a room now, with the flat's answers. */
const roomListing = (lifestyle: (typeof A)['lifestyle'] = {}) => ({
  ...A,
  listing_type: 'room' as const,
  flatmates_count: 2,
  lifestyle,
});

const moreOf = (name: string) =>
  within(cardOf(name)).getByRole('button', { name: he.applicants.more });
/** The "עוד פרטים" panel, found through the button's `aria-controls`. */
const morePanelOf = (name: string) => {
  const id = moreOf(name).getAttribute('aria-controls') ?? '';
  const panel = document.getElementById(id);
  if (panel === null) throw new Error(`no panel #${id}`);
  return panel;
};
/** The line right after the "applied at" line. */
const lineAfterApplied = (p: ApplicantOut) =>
  within(cardOf(p.applicant_name)).getByText(appliedText(p)).nextElementSibling;
const genderWords = Object.values(he.profile.room.gender);
const answer = (key: string, n: number) => i18n.t(`lifestyle.${key}.answer.${String(n)}`);

/** A key press on a native button as a browser handles it: jsdom has no activation behaviour, so
 * an Enter keydown or a Space keyup that no handler prevented clicks the button (as user-event
 * does). Focus is left where it is. */
function press(button: HTMLElement, key: 'Enter' | ' ') {
  expect(button.tagName).toBe('BUTTON');
  const down = fireEvent.keyDown(button, { key });
  if (key === 'Enter' && down) fireEvent.click(button);
  const up = fireEvent.keyUp(button, { key });
  if (key === ' ' && down && up) fireEvent.click(button);
}

describe('ApplicantsPage, room applicants (0007c)', () => {
  it('ac6_room_gender_age', async () => {
    const w = roomApplicant(
      { gender: 'woman', age: 27, lifestyle: {} },
      { applicant_name: 'W', match: match(88) },
    );
    const l = roomApplicant(
      { gender: 'man', age: 31, lifestyle: { night: 1 } },
      { applicant_name: 'L', match: match(80, ['budget', 'move_in', 'area'], 'lifestyle') },
    );
    renderPage([json([w, l])], { mine: [json([roomListing({ night: 3 })])] });
    await screen.findAllByRole('article');

    expect(within(cardOf('W')).getByTestId('match-badge')).toHaveTextContent('התאמה 88%');
    const line = lineAfterApplied(w);
    expect(line?.textContent).toBe('אישה · גיל 27');
    expect(line?.tagName).toBe('P');

    // The owner-voice lifestyle reason (0007g's copy) reaches a room applicant's card.
    const chips = within(within(cardOf('L')).getByTestId('match-chips')).getAllByRole('listitem');
    const amber = chips.filter((chip) => chip.className.includes('bg-warn'));
    expect(amber.map((chip) => chip.textContent)).toEqual([he.match.owner.short.lifestyle.differ]);
    fireEvent.click(whyOf('L'));
    expect(within(panelOf('L')).getByText(he.match.owner.lifestyle.differ)).toBeVisible();
  });

  it('ac7_age_omitted', async () => {
    const o = roomApplicant({ gender: 'other', age: null }, { applicant_name: 'O' });
    renderPage([json([o])], { mine: [json([roomListing()])] });
    await screen.findByRole('article');

    const line = lineAfterApplied(o);
    expect(line?.textContent).toBe(he.profile.room.gender.other);
    expect(line?.textContent).not.toContain('גיל');
    expect(line?.textContent).not.toContain('·');
  });

  it('ac8_non_room_cards_unchanged', async () => {
    const cases = [
      { mine: A, label: 'an apartment applicant' },
      { mine: roomListing({ night: 2 }), label: 'a room listing, room: null' },
    ];
    for (const { mine } of cases) {
      const p = applicant({ applicant_name: 'P', match: match(94), profile: applicantProfile() });
      const { view } = renderPage([json([p])], { mine: [json([mine])] });
      await screen.findByRole('article');

      expect(buttonsOf('P')).toEqual([
        he.applicants.why,
        he.applicants.actions.shortlist,
        he.applicants.actions.decline,
      ]);
      expect(within(cardOf('P')).queryByRole('button', { name: he.applicants.more })).toBeNull();
      // The summary line follows "applied at", as in 0006g; no gender word anywhere.
      expect(lineAfterApplied(p)?.textContent).toContain(he.profile.household.couple);
      for (const word of genderWords) {
        expect(within(cardOf('P')).queryByText(word, { exact: false })).toBeNull();
      }
      reset(view);
    }
  });

  it('ac9_more_disclosure_keyboard', async () => {
    const w = roomApplicant({ lifestyle: { cleanliness: 3 } }, { applicant_name: 'W' });
    renderPage([json([w])], { mine: [json([roomListing({ cleanliness: 3 })])] });
    await screen.findByRole('article');

    const more = moreOf('W');
    const heading = within(cardOf('W')).getByRole('heading', { level: 2 });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveAttribute('aria-controls', `${heading.id}-more`);
    expect(more).toHaveAttribute('aria-describedby', heading.id);
    expect(morePanelOf('W')).toHaveAttribute('hidden');
    expect(morePanelOf('W')).not.toBeVisible();

    more.focus();
    press(more, 'Enter');
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(more.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(panel).toBeVisible();
    expect(
      within(panel as HTMLElement).getByText(i18n.t('lifestyle.cleanliness.topic')),
    ).toBeVisible();
    expect(more).toHaveFocus();

    press(more, ' ');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(morePanelOf('W')).not.toBeVisible();
    expect(more).toHaveFocus();
  });

  it('ac10_answers_compared_with_flat', async () => {
    const w = roomApplicant(
      { lifestyle: { night: 1, guests: 2, cleanliness: 3 } },
      { applicant_name: 'W' },
    );
    renderPage([json([w])], { mine: [json([roomListing({ cleanliness: 1, guests: 2 })])] });
    await screen.findByRole('article');
    fireEvent.click(moreOf('W'));
    const panel = morePanelOf('W');

    const rows = within(within(panel).getByRole('list')).getAllByRole('listitem');
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual([
      he.lifestyle.cleanliness.topic,
      he.lifestyle.guests.topic,
      he.lifestyle.night.topic,
    ]);
    const [cleanliness, guests, night] = rows as [HTMLElement, HTMLElement, HTMLElement];
    const theirs = (key: string, n: number) =>
      i18n.t('applicants.room.theirs', { answer: answer(key, n) });
    const flat = (key: string, n: number) =>
      i18n.t('applicants.room.flat', { answer: answer(key, n) });

    expect(within(cleanliness).getByText(theirs('cleanliness', 3))).toBeVisible();
    expect(within(cleanliness).getByText(flat('cleanliness', 1))).toBeVisible();
    expect(within(cleanliness).getByText(he.applicants.room.differs)).toBeVisible();
    expect(cleanliness.querySelector('.bg-warn[aria-hidden="true"]')).not.toBeNull();

    expect(within(guests).getByText(theirs('guests', 2))).toBeVisible();
    expect(within(guests).getByText(flat('guests', 2))).toBeVisible();
    expect(within(guests).queryByText(he.applicants.room.differs)).toBeNull();
    expect(guests.querySelector('.bg-warn')).toBeNull();

    expect(within(night).getByText(theirs('night', 1))).toBeVisible();
    expect(night.textContent).not.toContain('בדירה');
    expect(within(night).queryByText(he.applicants.room.differs)).toBeNull();

    expect(within(panel).getByText('תשובות זהות לדירה: 1 מתוך 2')).toBeVisible();
    expect(within(panel).queryByText(he.applicants.room.noFlatAnswers)).toBeNull();
  });

  it('ac11_empty_answers', async () => {
    // The applicant answered nothing: the button is there, the panel says so, no list.
    const none = roomApplicant({ lifestyle: {} }, { applicant_name: 'W' });
    let { view } = renderPage([json([none])], {
      mine: [json([roomListing({ cleanliness: 2 })])],
    });
    await screen.findByRole('article');
    fireEvent.click(moreOf('W'));
    let panel = morePanelOf('W');
    expect(within(panel).getByText(he.applicants.room.noAnswers)).toBeVisible();
    expect(within(panel).queryByRole('list')).toBeNull();
    expect(within(panel).queryByText(/מתוך/)).toBeNull();
    reset(view);

    // The flat answered nothing, on a room: rows without "בדירה" or markers, the hint once.
    const answered = roomApplicant(
      { lifestyle: { cleanliness: 3, night: 1 } },
      { applicant_name: 'W' },
    );
    ({ view } = renderPage([json([answered])], { mine: [json([roomListing({})])] }));
    await screen.findByRole('article');
    fireEvent.click(moreOf('W'));
    panel = morePanelOf('W');
    expect(within(within(panel).getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
    expect(panel.textContent).not.toContain('בדירה:');
    expect(within(panel).queryByText(he.applicants.room.differs)).toBeNull();
    expect(panel.querySelector('.bg-warn')).toBeNull();
    expect(within(panel).getAllByText(he.applicants.room.noFlatAnswers)).toHaveLength(1);
    expect(within(panel).queryByText(/מתוך/)).toBeNull();
    reset(view);

    // The listing is an apartment now: the rows, no hint.
    ({ view } = renderPage([json([answered])], { mine: [json([{ ...A, lifestyle: {} }])] }));
    await screen.findByRole('article');
    fireEvent.click(moreOf('W'));
    panel = morePanelOf('W');
    expect(within(within(panel).getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
    expect(within(panel).queryByText(he.applicants.room.noFlatAnswers)).toBeNull();
  });

  it('ac12_patch_and_independent_disclosures', async () => {
    const w = roomApplicant(
      { lifestyle: { cleanliness: 3 } },
      { applicant_name: 'W', status: 'submitted' },
    );
    renderPage([json([w])], {
      mine: [json([roomListing({ cleanliness: 1 })]), json([roomListing({ cleanliness: 1 })])],
      extra: { [patchRoute(w)]: [json({ ...w, status: 'shortlisted' })] },
    });
    await screen.findByRole('article');
    fireEvent.click(moreOf('W'));
    expect(morePanelOf('W')).toBeVisible();

    fireEvent.click(
      within(cardOf('W')).getByRole('button', { name: he.applicants.actions.shortlist }),
    );
    await vi.waitFor(() => {
      expect(chipOf('W')).toHaveTextContent(he.applicants.status.shortlisted);
    });
    await vi.waitFor(() => {
      expect(within(cardOf('W')).getByRole('heading', { level: 2 })).toHaveFocus();
    });
    expect(lineAfterApplied(w)?.textContent).toBe('אישה · גיל 27');
    expect(moreOf('W')).toHaveAttribute('aria-expanded', 'true');
    expect(morePanelOf('W')).toBeVisible();
    expect(within(morePanelOf('W')).getByText(he.applicants.room.differs)).toBeVisible();

    // Independent: "why" opens beside it, and closing "more" leaves "why" open.
    expect(whyOf('W')).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(whyOf('W'));
    expect(whyOf('W')).toHaveAttribute('aria-expanded', 'true');
    expect(panelOf('W')).toBeVisible();
    expect(morePanelOf('W')).toBeVisible();
    fireEvent.click(moreOf('W'));
    expect(moreOf('W')).toHaveAttribute('aria-expanded', 'false');
    expect(morePanelOf('W')).not.toBeVisible();
    expect(whyOf('W')).toHaveAttribute('aria-expanded', 'true');
    expect(panelOf('W')).toBeVisible();
    fireEvent.click(whyOf('W'));
    fireEvent.click(moreOf('W'));
    expect(whyOf('W')).toHaveAttribute('aria-expanded', 'false');
    expect(moreOf('W')).toHaveAttribute('aria-expanded', 'true');
  });

  it('ac13_declined_room_card', async () => {
    const d = roomApplicant(
      { gender: 'man', age: 40, lifestyle: { cleanliness: 3, guests: 1, kosher: 2 } },
      { applicant_name: 'D', status: 'declined' },
    );
    renderPage([json([d])], {
      mine: [json([roomListing({ cleanliness: 3, guests: 3, kosher: 2 })])],
    });
    await screen.findByRole('article');

    const line = lineAfterApplied(d);
    expect(line?.textContent).toBe(
      i18n.t('applicants.room.line', { gender: he.profile.room.gender.man, age: 40 }),
    );
    expect(buttonsOf('D')).toEqual([he.applicants.why, he.applicants.more]);
    fireEvent.click(moreOf('D'));
    const panel = morePanelOf('D');
    expect(panel).toBeVisible();
    for (const part of [panel, line as HTMLElement]) {
      expect(part.textContent).not.toContain('₪');
      expect(part.textContent).not.toContain('@');
      expect(part.querySelector('a, [href]')).toBeNull();
    }
    expect(within(panel).getByText('תשובות זהות לדירה: 2 מתוך 3')).toBeVisible();
  });

  it('ac8_mutual_tag', async () => {
    const mutual = applicant({ applicant_name: 'L', source: 'like', message: null });
    const applied = applicant({ applicant_name: 'M', message: 'Hello there' });
    renderPage([json([mutual, applied])]);
    await screen.findAllByRole('article');
    const inMutual = within(cardOf('L'));
    expect(inMutual.getByTestId('applicant-mutual')).toHaveTextContent(he.applicants.mutual);
    expect(inMutual.queryByTestId('applicant-message')).toBeNull();
    const inApplied = within(cardOf('M'));
    expect(inApplied.getByTestId('applicant-message')).toHaveTextContent('Hello there');
    expect(inApplied.queryByTestId('applicant-mutual')).toBeNull();
  });
});
