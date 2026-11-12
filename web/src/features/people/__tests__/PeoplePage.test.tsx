import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import {
  empty,
  json,
  deferred,
  mockApi,
  renderRoutes,
  testQueryClient,
} from '../../auth/__tests__/harness';
import { RequireOwner } from '../../auth/RequireOwner';
import { ME_KEY } from '../../auth/useMe';
import { formatDate } from '../../listings/format';
import { gushDan, listing, owner } from '../../listings/__tests__/fixtures';
import { inDays } from '../../profile/__tests__/fixtures';
import { PeoplePage } from '../PeoplePage';
import { person } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Reply = Parameters<typeof mockApi>[0][string][number];

const ROOM = listing({ listing_type: 'room', lifestyle: { cleanliness: 2 } });
const APARTMENT = listing();
const PATH = `/me/listings/${ROOM.id}/people`;
const MINE = 'GET /me/listings';
const PEOPLE = `GET /listings/${ROOM.id}/people`;
const likeRoute = (method: 'PUT' | 'DELETE', p: { id: string }) =>
  `${method} /listings/${ROOM.id}/people/${p.id}/like`;
const GIVATAYIM = { id: '00000000-0000-0000-0000-00000000a2a2', slug: 'g', name_he: 'גבעתיים' };

const routes = (
  <Routes>
    <Route path="/" element={<p>home</p>} />
    <Route path="/login" element={<p>login</p>} />
    <Route element={<RequireOwner />}>
      <Route path="/me/listings" element={<p>mine</p>} />
      <Route path="/me/listings/:id/people" element={<PeoplePage />} />
    </Route>
    <Route path="/chat/:id" element={<p>chat thread</p>} />
  </Routes>
);

function renderPage(
  pages: Reply[],
  {
    extra = {},
    mine = [json([ROOM, APARTMENT])],
    path = PATH,
    client = testQueryClient(),
  }: {
    extra?: Record<string, Reply[]>;
    mine?: Reply[];
    path?: string;
    client?: QueryClient;
  } = {},
) {
  const api = mockApi({
    'GET /me': [json(owner)],
    'GET /areas': [json([gushDan, GIVATAYIM])],
    [MINE]: mine,
    [PEOPLE]: pages,
    ...extra,
  });
  const view = renderRoutes(path, routes, client);
  return { api, view, client };
}

const page = (items: ReturnType<typeof person>[], total = items.length) => json({ items, total });
// The harness's location probe is an `<output>` (role status): the banner is found by its text.
const banners = () =>
  screen.queryAllByRole('status').filter((el) => el.textContent.includes('התאמה הדדית עם'));
// The page's alert region is always in the DOM (empty until used): only non-empty ones count.
const alerts = () => screen.queryAllByRole('alert').filter((el) => el.textContent !== '');
const cards = () => screen.getAllByRole('article');
const cardOf = (name: string) => screen.getByRole('article', { name });
const likeButton = (name: string) => within(cardOf(name)).getByRole('button', { name: /^אהבתי/ });
const offsets = (api: ReturnType<typeof mockApi>) =>
  api.calls(PEOPLE).map((c) => new URL(c.request.url).searchParams.get('offset'));

describe('PeoplePage', () => {
  it('ac3_people_count_one', async () => {
    renderPage([page([person({ display_name: 'P1' })], 1)]);
    await screen.findAllByRole('article');
    expect(
      screen.getByText('\u05e4\u05e8\u05d5\u05e4\u05d9\u05dc \u05d0\u05d7\u05d3'),
    ).toBeVisible();
  });

  it('ac1_cards', async () => {
    const p1 = person({
      display_name: 'P1',
      liked_me: true,
      age: 27,
      area_ids: [gushDan.id, GIVATAYIM.id],
      about_me: 'line one\nline two',
      move_in_flexible: true,
      lifestyle: { cleanliness: 3 },
    });
    const p2 = person({ display_name: 'P2', gender: 'man', age: null, about_me: null });
    renderPage([page([p1, p2])]);
    await screen.findAllByRole('article');
    expect(cards().map((c) => within(c).getByRole('heading', { level: 2 }).textContent)).toEqual([
      'P1',
      'P2',
    ]);
    expect(screen.getByText(i18n.t('people.count', { count: 2 }))).toBeVisible();

    const one = within(cardOf('P1'));
    expect(one.getByText(he.people.likedMe)).toBeVisible();
    expect(one.getByText('אישה · גיל 27')).toBeVisible();
    expect(one.getByText('אזורים: גוש דן וגבעתיים')).toBeVisible();
    expect(
      one.getByText(
        `${he.people.moveIn.replace('{{date}}', formatDate(inDays(30)))} ${he.applicants.flexible}`,
      ),
    ).toBeVisible();
    const about = one.getByTestId('person-about');
    expect(about.textContent).toBe('line one\nline two');
    expect(about).toHaveClass('whitespace-pre-line', 'break-words');
    expect(about).toHaveAttribute('dir', 'auto');
    expect(one.getByTestId('match-badge')).toBeVisible();
    expect(one.getByTestId('match-chips')).toHaveTextContent(he.match.owner.short.budget.agree);
    expect(one.getByTestId('match-chips')).toHaveTextContent(he.people.short.pets.differ);

    // "למה ההתאמה?" lists sentences, not the chips' words (0009f AC8).
    const why = one.getByRole('button', { name: he.applicants.why });
    fireEvent.click(why);
    const reasons = within(
      document.getElementById(why.getAttribute('aria-controls') ?? '') as HTMLElement,
    );
    expect(reasons.getByText(he.match.owner.budget.agree)).toBeVisible();
    expect(reasons.getByText(he.match.owner.area.agree)).toBeVisible();
    // "הם לא מתאימים לכללי חיות המחמד בדירה"
    expect(
      reasons.getByText(
        '\u05d4\u05dd \u05dc\u05d0 \u05de\u05ea\u05d0\u05d9\u05de\u05d9\u05dd \u05dc\u05db\u05dc\u05dc\u05d9 \u05d7\u05d9\u05d5\u05ea \u05d4\u05de\u05d7\u05de\u05d3 \u05d1\u05d3\u05d9\u05e8\u05d4',
      ),
    ).toBeVisible();
    expect(reasons.queryByText(he.people.short.pets.differ)).toBeNull();
    expect(reasons.queryByText(he.match.owner.short.budget.agree)).toBeNull();
    fireEvent.click(why);

    const two = within(cardOf('P2'));
    expect(two.queryByText(he.people.likedMe)).toBeNull();
    expect(two.getByText('גבר')).toBeVisible();
    expect(two.queryByTestId('person-about')).toBeNull();
    expect(
      two.getByText(he.people.moveIn.replace('{{date}}', formatDate(inDays(30)))),
    ).toBeVisible();
    expect(two.getByTestId('match-badge')).toBeVisible();
    expect(two.getByTestId('match-chips')).toHaveTextContent(he.match.owner.short.budget.agree);

    // Nothing the card hides: no household, pets, smoking, contract or parking fact, on any card.
    for (const card of cards()) {
      const text = card.textContent ?? '';
      for (const hidden of [
        he.match.owner.short.smoking.agreeSmoker,
        he.match.owner.short.pets.agreePet,
        he.match.owner.short.contract.agreeLong,
        'לא מעשנים',
        'עם חיית מחמד',
        'בלי חיות',
      ]) {
        expect(text).not.toContain(hidden);
      }
    }

    // "עוד פרטים" opens RoomDetails with the flat's answers.
    const more = one.getByRole('button', { name: he.people.moreDetails });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(more.getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(panel).toBeVisible();
    expect(within(panel).getByText(he.lifestyle.cleanliness.topic)).toBeVisible();
    expect(
      within(panel).getByText(
        he.applicants.room.flat.replace('{{answer}}', he.lifestyle.cleanliness.answer['2']),
      ),
    ).toBeVisible();
  });

  it('ac2_load_more_dedup', async () => {
    const first = Array.from({ length: 20 }, (_, i) => person({ display_name: `A${String(i)}` }));
    // The last person of page one comes back first on page two (a like moved the pages).
    const repeat = first[19] as ReturnType<typeof person>;
    const second = [
      repeat,
      ...Array.from({ length: 5 }, (_, i) => person({ display_name: `B${String(i)}` })),
    ];
    const { api } = renderPage([page(first, 25), page(second, 25)]);
    await screen.findAllByRole('article');
    expect(cards()).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: he.people.loadMore }));
    await waitFor(() => {
      expect(cards()).toHaveLength(25);
    });
    expect(offsets(api)).toEqual(['0', '20']);
    expect(screen.queryByRole('button', { name: he.people.loadMore })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 2, name: 'A19' })).toHaveLength(1);
  });

  it('ac3_like_unlike', async () => {
    const p1 = person({ display_name: 'P1' });
    const p2 = person({ display_name: 'P2' });
    const liked = { ...p2, liked_by_me: true };
    const pending = deferred();
    const { api } = renderPage([page([p1, p2]), page([p1, liked]), page([p1, p2])], {
      extra: {
        [likeRoute('PUT', p2)]: [pending.promise],
        [likeRoute('DELETE', p2)]: [empty()],
      },
    });
    await screen.findAllByRole('article');
    const button = () => within(cardOf('P2')).getByRole('button', { name: /^אהבתי/ });
    expect(button()).toHaveAttribute('aria-pressed', 'false');
    expect(button()).toHaveAccessibleName(he.people.like);
    button().focus();
    fireEvent.click(button());
    // In flight: aria-disabled (still focusable), a second click is a no-op.
    await waitFor(() => {
      expect(button()).toHaveAttribute('aria-disabled', 'true');
    });
    expect(button()).toHaveAttribute('aria-busy', 'true');
    expect(button()).not.toBeDisabled();
    expect(button()).toHaveFocus();
    fireEvent.click(button());
    pending.resolve(json({ liked: true, application_id: null }));
    await waitFor(() => {
      expect(button()).toHaveAttribute('aria-pressed', 'true');
    });
    // The name stays "אהבתי" (the tick is decoration); aria-pressed carries the state.
    expect(button()).toHaveAccessibleName(he.people.like);
    expect(button()).toHaveAttribute('aria-disabled', 'false');
    expect(banners()).toHaveLength(0);
    expect(api.calls(likeRoute('PUT', p2))).toHaveLength(1);
    expect(api.calls(MINE).length).toBeGreaterThan(1);

    fireEvent.click(button());
    await waitFor(() => {
      expect(button()).toHaveAttribute('aria-pressed', 'false');
    });
    expect(api.calls(likeRoute('DELETE', p2))).toHaveLength(1);
    expect(alerts()).toHaveLength(0);
  });

  it('ac4_mutual_banner', async () => {
    const p1 = person({ display_name: 'P1', liked_me: true });
    const p2 = person({ display_name: 'P2' });
    const applicationId = '00000000-0000-0000-0000-00000000dddd';
    const { api } = renderPage([page([p1, p2]), page([p2])], {
      extra: {
        [likeRoute('PUT', p1)]: [json({ liked: true, application_id: applicationId })],
        [`GET /listings/${ROOM.id}/applications`]: [json([])],
        'GET /conversations': [json([])],
      },
    });
    await screen.findAllByRole('article');
    fireEvent.click(likeButton('P1'));
    const banner = await waitFor(() => {
      const [found] = banners();
      expect(found).toBeDefined();
      return found as HTMLElement;
    });
    expect(banner).toHaveTextContent(he.people.mutual.replace('{{name}}', 'P1'));
    expect(banner).toHaveFocus();
    expect(within(banner).getByRole('link', { name: he.people.toChat })).toHaveAttribute(
      'href',
      `/chat/${applicationId}`,
    );
    // The refetch drops P1's card; the banner stays.
    await waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
    expect(screen.queryByRole('article', { name: 'P1' })).toBeNull();
    expect(banners()).toEqual([banner]);
    expect(api.calls(PEOPLE)).toHaveLength(2);
  });

  it('ac5_like_errors', async () => {
    // The refetch drops the person (an open application, or no longer a candidate): the outcome is
    // the page's, with the link, and it survives the refetch.
    const dropped: { reply: Response; unlike?: boolean; link?: string }[] = [
      {
        reply: json({ detail: 'already_applied' }, 409),
        link: `/me/listings/${ROOM.id}/applicants`,
      },
      { reply: json({ detail: 'not_found' }, 404) },
      { reply: json({ detail: 'not_found' }, 404), unlike: true },
    ];
    for (const { reply, unlike = false, link } of dropped) {
      const p = person({ display_name: 'P1', liked_by_me: unlike });
      const { api, view } = renderPage([page([p]), page([])], {
        extra: { [likeRoute(unlike ? 'DELETE' : 'PUT', p)]: [reply] },
      });
      await screen.findAllByRole('article');
      fireEvent.click(likeButton('P1'));
      await waitFor(() => {
        expect(screen.queryAllByRole('article')).toHaveLength(0);
      });
      const [alert] = alerts();
      expect(alert).toBeDefined();
      expect(alert).toHaveFocus();
      expect(screen.getByRole('alert')).toBe(alert);
      if (link !== undefined) {
        expect(alert).toHaveTextContent(he.people.errors.alreadyApplied);
        expect(
          within(alert as HTMLElement).getByRole('link', { name: he.people.errors.toApplicants }),
        ).toHaveAttribute('href', link);
      } else {
        expect(alert).toHaveTextContent(he.people.errors.gone);
      }
      expect(api.calls(PEOPLE)).toHaveLength(2);
      view.unmount();
      vi.unstubAllGlobals();
    }

    // The card survives these: the alert is inline.
    const inline: { reply: Response; text: string }[] = [
      { reply: json({ detail: 'rate_limited' }, 429), text: he.people.errors.rateLimited },
      { reply: json({ detail: 'listing_not_live' }, 409), text: he.people.notLive },
      { reply: json({ detail: 'boom' }, 500), text: he.common.error },
    ];
    for (const { reply, text } of inline) {
      const p = person({ display_name: 'P1' });
      const { api, view } = renderPage([page([p]), page([p])], {
        extra: { [likeRoute('PUT', p)]: [reply] },
      });
      await screen.findAllByRole('article');
      fireEvent.click(likeButton('P1'));
      expect(await within(cardOf('P1')).findByRole('alert')).toHaveTextContent(text);
      await waitFor(() => {
        expect(api.calls(PEOPLE)).toHaveLength(2);
      });
      expect(likeButton('P1')).toHaveAttribute('aria-pressed', 'false');
      view.unmount();
      vi.unstubAllGlobals();
    }

    // 401: no alert, and the person is forgotten.
    const p = person({ display_name: 'P1' });
    const run = renderPage([page([p])], {
      extra: { [likeRoute('PUT', p)]: [json({ detail: 'unauthenticated' }, 401)] },
    });
    await screen.findAllByRole('article');
    fireEvent.click(likeButton('P1'));
    await waitFor(() => {
      expect(run.client.getQueryData(ME_KEY)).toBeNull();
    });
    expect(alerts()).toHaveLength(0);
  });

  it('ac6_page_states', async () => {
    // 404, 409 listing_not_live: their texts and the back link.
    for (const [status, detail, text] of [
      [404, 'not_found', he.people.notFound],
      [409, 'listing_not_live', he.people.notLive],
    ] as const) {
      const { view } = renderPage([json({ detail }, status)]);
      expect(await screen.findByRole('heading', { level: 1, name: text })).toBeVisible();
      expect(screen.getByRole('link', { name: he.people.back })).toHaveAttribute(
        'href',
        '/me/listings',
      );
      view.unmount();
      vi.unstubAllGlobals();
    }

    // A 500: ErrorState, and retry refetches.
    let run = renderPage([json({ detail: 'boom' }, 500), page([person({ display_name: 'P1' })])]);
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await screen.findByRole('article', { name: 'P1' })).toBeVisible();
    expect(run.api.calls(PEOPLE)).toHaveLength(2);
    run.view.unmount();
    vi.unstubAllGlobals();

    // total 0: the empty state.
    run = renderPage([page([])]);
    expect(await screen.findByText(he.people.empty)).toBeVisible();
    run.view.unmount();
    vi.unstubAllGlobals();

    // Loading: a busy skeleton list.
    const pending = deferred();
    run = renderPage([pending.promise]);
    const busy = await screen.findByRole('list', { name: he.common.loading });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    run.view.unmount();
    vi.unstubAllGlobals();

    // An id missing from "my listings", and an apartment: not found, no people request.
    for (const id of [crypto.randomUUID(), APARTMENT.id]) {
      run = renderPage([page([])], { path: `/me/listings/${id}/people` });
      expect(
        await screen.findByRole('heading', { level: 1, name: he.people.notFound }),
      ).toBeVisible();
      expect(run.api.calls(`GET /listings/${id}/people`)).toHaveLength(0);
      expect(run.api.calls(PEOPLE)).toHaveLength(0);
      run.view.unmount();
      vi.unstubAllGlobals();
    }
  });
});
