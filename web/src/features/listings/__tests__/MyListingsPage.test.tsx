import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import {
  deferred,
  json,
  mockApi,
  renderAt,
  renderRoutes,
  testQueryClient,
} from '../../auth/__tests__/harness';
import { MyListingsPage } from '../MyListingsPage';
import { listing, withoutCounts } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const render = () => renderAt('/me/listings', <MyListingsPage />);
const badge = (card: HTMLElement) => within(card).getByTestId('status-badge');
const newLink = () => screen.getByRole('link', { name: he.listings.mine.new });

describe('MyListingsPage', () => {
  it('ac6_states_and_badges', async () => {
    // Pending: three skeleton rows in a busy block.
    const pending = deferred();
    mockApi({ 'GET /me/listings': [pending.promise] });
    let view = render();
    expect(screen.getByRole('heading', { level: 1, name: he.listings.mine.title })).toBeVisible();
    const busy = screen.getByText(he.common.loading).closest<HTMLElement>('[aria-busy="true"]');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(busy as HTMLElement).getAllByTestId('skeleton')).toHaveLength(3);
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
        i18n.t('listings.card.title', { count: 3, rooms: '3', street: l.street, city: l.city }),
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

  it('ac1_edit_link_only_before_expiry', async () => {
    const live = listing({ street: '\u05d0\u05d7\u05d3' });
    const paused = listing({ street: '\u05e9\u05ea\u05d9\u05d9\u05dd', status: 'paused' });
    const expired = listing({
      street: '\u05e9\u05dc\u05d5\u05e9',
      expires_at: '2020-01-01T00:00:00Z',
    });
    const pausedExpired = listing({
      street: '\u05d0\u05e8\u05d1\u05e2',
      status: 'paused',
      expires_at: '2020-01-01T00:00:00Z',
    });
    mockApi({ 'GET /me/listings': [json([live, paused, expired, pausedExpired])] });
    let view = render();
    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(4);
    [live, paused, expired, pausedExpired].forEach((l, i) => {
      const card = cards[i] as HTMLElement;
      const title = i18n.t('listings.card.title', {
        count: 3,
        rooms: '3',
        street: l.street,
        city: l.city,
      });
      if (i < 2) {
        const link = within(card).getByRole('link', { name: he.listings.actions.edit });
        expect(link).toHaveAttribute('href', `/me/listings/${l.id}/edit`);
        expect(link).toHaveAccessibleDescription(title);
        const describedBy = document.getElementById(link.getAttribute('aria-describedby') ?? '');
        expect(describedBy).toHaveTextContent(title);
      } else {
        expect(within(card).queryByRole('link', { name: he.listings.actions.edit })).toBeNull();
      }
      for (const button of within(card).queryAllByRole('button')) {
        expect(button).toHaveAccessibleDescription(title);
      }
    });
    // The pause / resume buttons exist on the live and paused cards (and carry the description).
    expect(within(cards[0] as HTMLElement).getAllByRole('button')).toHaveLength(1);
    expect(within(cards[1] as HTMLElement).getAllByRole('button')).toHaveLength(1);
    // Expired: no button; paused past expiry keeps its resume button (pause / resume unchanged).
    expect(within(cards[2] as HTMLElement).queryAllByRole('button')).toHaveLength(0);
    expect(within(cards[3] as HTMLElement).getAllByRole('button')).toHaveLength(1);
    // (The harness's location probe is an <output>, which is also a status.)
    expect(screen.queryByText(he.listings.edit.saved)).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // After a save: the status line.
    mockApi({ 'GET /me/listings': [json([live])] });
    view = renderRoutes(
      { pathname: '/me/listings', state: { saved: true } },
      <Routes>
        <Route path="/me/listings" element={<MyListingsPage />} />
      </Routes>,
    );
    expect(await screen.findByText(he.listings.edit.saved)).toHaveAttribute('role', 'status');
    view.unmount();
  });
  it('ac4_saved_announced_once', async () => {
    const live = listing();
    mockApi({
      'GET /me/listings': [() => json([live])],
      [`PATCH /listings/${live.id}`]: [json({ ...live, status: 'paused' })],
    });
    /** The page's own status line (the location probe below is not a status). */
    const statusLine = () => {
      const line = document.querySelector('p[role="status"]');
      if (line === null) throw new Error('no status line');
      return line;
    };
    function Probe() {
      const location = useLocation();
      const navigate = useNavigate();
      return (
        <>
          <span data-testid="probe">
            {location.pathname} {JSON.stringify(location.state)}
          </span>
          <button type="button" onClick={() => void navigate(-1)}>
            history-back
          </button>
        </>
      );
    }
    const tree = (entries: Parameters<typeof MemoryRouter>[0]['initialEntries']) => (
      <QueryClientProvider client={testQueryClient()}>
        <MemoryRouter initialEntries={entries} initialIndex={(entries?.length ?? 1) - 1}>
          <Routes>
            <Route path="/me/listings" element={<MyListingsPage />} />
            <Route path="/edit" element={<p>edit</p>} />
          </Routes>
          <Probe />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Animation frames run only when the test says so.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const runFrames = () =>
      act(() => {
        for (const frame of frames.splice(0)) frame(0);
      });

    // Arriving with `state.saved`: the line is mounted empty, and filled a frame later.
    let view = rtlRender(tree(['/edit', { pathname: '/me/listings', state: { saved: true } }]));
    expect(statusLine()).toHaveTextContent('');
    expect(screen.queryByText(he.listings.edit.saved)).toBeNull();
    expect(frames.length).toBeGreaterThan(0);
    runFrames();
    expect(statusLine()).toHaveTextContent(he.listings.edit.saved);
    // The history entry was replaced with `state: null`: Back goes to the page before it.
    expect(screen.getByTestId('probe')).toHaveTextContent('/me/listings null');
    // A pause clears the line.
    fireEvent.click(await screen.findByRole('button', { name: he.listings.actions.pause }));
    await vi.waitFor(() => {
      expect(statusLine()).toHaveTextContent('');
    });
    fireEvent.click(screen.getByRole('button', { name: 'history-back' }));
    expect(screen.getByTestId('probe')).toHaveTextContent('/edit');
    view.unmount();

    // Mounting again at /me/listings with `state: null` (a reload): the line stays empty.
    view = rtlRender(tree([{ pathname: '/me/listings', state: null }]));
    expect(await screen.findByRole('article')).toBeVisible();
    runFrames();
    expect(statusLine()).toHaveTextContent('');
    view.unmount();
  });

  it('ac7_applicants_link', async () => {
    const first = listing({ applicant_count: 12, new_applicant_count: 5 });
    const second = listing({ status: 'paused', applicant_count: 3, new_applicant_count: 0 });
    const third = listing({ expires_at: '2020-01-01T00:00:00Z' });
    // PATCH /listings/{id} answers a `ListingOut`: no counts.
    const paused = { ...withoutCounts(first), status: 'paused' as const };
    expect(paused).not.toHaveProperty('applicant_count');
    mockApi({
      'GET /me/listings': [json([first, second, third])],
      [`PATCH /listings/${first.id}`]: [json(paused)],
    });
    render();
    const cards = await screen.findAllByRole('article');
    const linkOf = (card: HTMLElement, l: { id: string }) => {
      const link = within(card)
        .getAllByRole('link')
        .find((a) => a.getAttribute('href') === `/me/listings/${l.id}/applicants`);
      expect(link).toBeDefined();
      return link as HTMLElement;
    };
    const badgeText = i18n.t('applicants.newBadge', { count: 5 });

    [first, second, third].forEach((l, i) => {
      const card = cards[i] as HTMLElement;
      const link = linkOf(card, l);
      const name = link.textContent ?? '';
      expect(name).toContain(i18n.t('applicants.link', { count: l.applicant_count }));
      if (i === 0) {
        expect(within(link).getByText(badgeText)).toHaveClass('bg-warn', 'text-warn-text');
        expect(link).toHaveAccessibleName(
          `${i18n.t('applicants.link', { count: 12 })} ${badgeText}`,
        );
      } else {
        expect(link.querySelector('span')).toBeNull();
        expect(link).toHaveAccessibleName(i18n.t('applicants.link', { count: l.applicant_count }));
      }
      expect(link).toHaveClass('min-h-[44px]');
      const title = i18n.t('listings.card.title', {
        count: 3,
        rooms: '3',
        street: l.street,
        city: l.city,
      });
      const describedBy = document.getElementById(link.getAttribute('aria-describedby') ?? '');
      expect(describedBy).toHaveTextContent(title);
    });

    // Pausing merges the PATCH's `ListingOut` into the row: the counts stay.
    const firstCard = cards[0] as HTMLElement;
    fireEvent.click(within(firstCard).getByRole('button', { name: he.listings.actions.pause }));
    expect(
      await within(firstCard).findByRole('button', { name: he.listings.actions.resume }),
    ).toBeVisible();
    const link = linkOf(firstCard, first);
    expect(link.textContent).toContain(i18n.t('applicants.link', { count: 12 }));
    expect(within(link).getByText(badgeText)).toBeVisible();
  });

  it('ac7_people_link', async () => {
    const two = listing({ listing_type: 'room', liked_me_count: 2 });
    const one = listing({ listing_type: 'room', liked_me_count: 1 });
    const none = listing({ listing_type: 'room', liked_me_count: 0 });
    const paused = listing({ listing_type: 'room', status: 'paused', liked_me_count: 3 });
    const expired = listing({ listing_type: 'room', expires_at: '2020-01-01T00:00:00Z' });
    const apartment = listing({ liked_me_count: 4 });
    mockApi({ 'GET /me/listings': [json([two, one, none, paused, expired, apartment])] });
    render();
    const cards = await screen.findAllByRole('article');
    const peopleLink = (card: HTMLElement) =>
      within(card)
        .queryAllByRole('link')
        .find((a) => a.getAttribute('href')?.endsWith('/people'));
    const [cTwo, cOne, cNone, cPaused, cExpired, cApartment] = cards as HTMLElement[];

    const a = peopleLink(cTwo as HTMLElement);
    expect(a).toHaveAttribute('href', `/me/listings/${two.id}/people`);
    expect(a).toHaveTextContent(he.listings.mine.people);
    expect(
      within(a as HTMLElement).getByText(i18n.t('listings.mine.peopleLiked', { count: 2 })),
    ).toHaveClass('bg-warn', 'text-warn-text');
    const b = peopleLink(cOne as HTMLElement);
    expect(b).toHaveAttribute('href', `/me/listings/${one.id}/people`);
    expect(
      within(b as HTMLElement).getByText(i18n.t('listings.mine.peopleLiked', { count: 1 })),
    ).toBeVisible();
    const c = peopleLink(cNone as HTMLElement);
    expect(c).toHaveAttribute('href', `/me/listings/${none.id}/people`);
    expect((c as HTMLElement).querySelector('span')).toBeNull();
    expect(c).toHaveAccessibleName(he.listings.mine.people);

    for (const card of [cPaused, cExpired, cApartment]) {
      expect(peopleLink(card as HTMLElement)).toBeUndefined();
    }
  });

  it('ac3_badges_one_two_many', async () => {
    const one = listing({ listing_type: 'room', new_applicant_count: 1, liked_me_count: 1 });
    const two = listing({ listing_type: 'room', new_applicant_count: 2, liked_me_count: 3 });
    mockApi({ 'GET /me/listings': [json([one, two])] });
    render();
    const [cOne, cTwo] = (await screen.findAllByRole('article')) as HTMLElement[];
    expect(
      within(cOne as HTMLElement).getByText('\u05d7\u05d3\u05e9\u05d4 \u05d0\u05d7\u05ea'),
    ).toBeVisible();
    expect(within(cTwo as HTMLElement).getByText('2 \u05d7\u05d3\u05e9\u05d5\u05ea')).toBeVisible();
    expect(
      within(cOne as HTMLElement).getByText(
        '\u05d0\u05d3\u05dd \u05d0\u05d7\u05d3 \u05d0\u05d4\u05d1 \u05d0\u05ea \u05d4\u05d7\u05d3\u05e8',
      ),
    ).toBeVisible();
    expect(
      within(cTwo as HTMLElement).getByText(
        '3 \u05d0\u05d4\u05d1\u05d5 \u05d0\u05ea \u05d4\u05d7\u05d3\u05e8',
      ),
    ).toBeVisible();
  });

  it('ac5_flatmates_link', async () => {
    const live = listing({ listing_type: 'room', flatmate_count: 2 });
    const paused = listing({ listing_type: 'room', status: 'paused', flatmate_count: 0 });
    const expired = listing({ listing_type: 'room', expires_at: '2020-01-01T00:00:00Z' });
    const apartment = listing({ flatmate_count: 3 });
    mockApi({ 'GET /me/listings': [json([live, paused, expired, apartment])] });
    render();
    const cards = (await screen.findAllByRole('article')) as HTMLElement[];
    const hrefs = (card: HTMLElement) =>
      within(card)
        .queryAllByRole('link')
        .map((a) => a.getAttribute('href') ?? '');
    const [cLive, cPaused, cExpired, cApartment] = cards as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    // Every room card links to its flatmates page with the count, as the last link: after
    // "people" on a live room, after the applicants link on a paused or expired one.
    for (const [card, l, before] of [
      [cLive, live, 'people'],
      [cPaused, paused, 'applicants'],
      [cExpired, expired, 'applicants'],
    ] as const) {
      const link = within(card).getByRole('link', {
        name: i18n.t('listings.mine.flatmates', { count: l.flatmate_count }),
      });
      expect(link).toHaveAttribute('href', `/me/listings/${l.id}/flatmates`);
      expect(link).toHaveClass('min-h-[44px]');
      const list = hrefs(card);
      expect(list.at(-1)).toBe(`/me/listings/${l.id}/flatmates`);
      expect(list.at(-2)).toBe(`/me/listings/${l.id}/${before}`);
    }
    expect(within(cLive).getByRole('link', { name: 'שותפים בדירה (2)' })).toBeVisible();

    // Apartments have none.
    expect(hrefs(cApartment).some((h) => h.endsWith('/flatmates'))).toBe(false);
  });
});
