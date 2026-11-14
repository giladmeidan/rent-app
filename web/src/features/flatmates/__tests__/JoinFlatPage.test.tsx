import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import {
  currentPath,
  deferred,
  json,
  mockApi,
  renderRoutes,
  testQueryClient,
} from '../../auth/__tests__/harness';
import { LoginPage } from '../../auth/LoginPage';
import { RequireUser } from '../../auth/RequireUser';
import { clearSession } from '../../auth/useLogout';
import { ME_KEY } from '../../auth/useMe';
import { ChatListPage } from '../../chat/ChatListPage';
import { cardTitle } from '../../listings/cardTitle';
import { seeker } from '../../listings/__tests__/fixtures';
import { clearInviteToken, readInviteToken, stashInviteToken } from '../inviteToken';
import { JoinFlatPage } from '../JoinFlatPage';
import { invitePreview } from './fixtures';

type Reply = Parameters<typeof mockApi>[0][string][number];

const T = 'Tk-secret_42';
const STORAGE_KEY = 'flatmates.inviteToken';
const PREVIEW = 'POST /flatmate-invites/preview';
const JOIN = 'POST /flatmate-invites/join';
const P = invitePreview();
const LOGGED_OUT = () => json({ detail: 'unauthenticated' }, 401);

const routes = (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/flatmates/join" element={<JoinFlatPage />} />
    <Route element={<RequireUser />}>
      <Route path="/chat" element={<ChatListPage />} />
    </Route>
  </Routes>
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearInviteToken();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

function renderJoin(api: Record<string, Reply[]>, path = `/flatmates/join#${T}`) {
  const calls = mockApi({
    'GET /me': [json(seeker)],
    'GET /me/conversations': [json([])],
    ...api,
  });
  const view = renderRoutes(path, routes);
  return { api: calls, view };
}

function reset(view: { unmount: () => void }) {
  view.unmount();
  vi.unstubAllGlobals();
  clearInviteToken();
}

const err = (status: number, detail: string) => json({ detail }, status);
const cta = () => screen.findByRole('button', { name: he.flatmates.join.cta });

describe('JoinFlatPage', () => {
  it('ac3_states', async () => {
    // A preview: the title, who invites, the CTA. The CTA is disabled while the join runs, POSTs
    // the token in the body, then the chat list confirms the join.
    const joining = deferred();
    let { api, view } = renderJoin({
      [PREVIEW]: [json(P)],
      [JOIN]: [joining.promise],
    });
    const button = await cta();
    expect(screen.getByRole('heading', { level: 1, name: he.flatmates.join.title })).toBeVisible();
    expect(screen.getByText(cardTitle(i18n.t, P.listing))).toBeVisible();
    expect(screen.getByText('הוזמנת על ידי רוני')).toBeVisible();
    expect(api.calls(PREVIEW)[0]?.body).toEqual({ token: T });
    expect(currentPath()).toBe('/flatmates/join');
    // Two clicks in the same tick send one join.
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    fireEvent.click(button);
    await waitFor(() => {
      expect(api.calls(JOIN)).toHaveLength(1);
    });
    expect(
      api.fetchMock.mock.calls.filter(
        ([r]) => new URL(r.url).pathname === '/flatmate-invites/join',
      ),
    ).toHaveLength(1);
    expect(api.calls(JOIN)[0]?.body).toEqual({ token: T, shown: false });
    expect(readInviteToken()).toBe(T);
    joining.resolve(json({ listing_id: P.listing.id }));
    expect(await screen.findByText(he.flatmates.join.done)).toHaveAttribute('role', 'status');
    expect(currentPath()).toBe('/chat');
    expect(readInviteToken()).toBeNull();
    for (const call of [...api.calls(PREVIEW), ...api.calls(JOIN)]) {
      expect(call.request.url).not.toContain(T);
    }
    reset(view);

    // Already a member: the text and the way to the chats; the token is cleared.
    ({ view } = renderJoin({ [PREVIEW]: [json(invitePreview({ member: true }))] }));
    expect(await screen.findByText(he.flatmates.join.member)).toBeVisible();
    expect(screen.getByRole('link', { name: he.flatmates.join.toChats })).toHaveAttribute(
      'href',
      '/chat',
    );
    expect(screen.queryByRole('button', { name: he.flatmates.join.cta })).toBeNull();
    await waitFor(() => {
      expect(readInviteToken()).toBeNull();
    });
    reset(view);

    // Preview errors: 404, 422 and 409 `own_listing` are final (cleared); 429 keeps the token.
    for (const [reply, text, kept] of [
      [err(404, 'not_found'), he.flatmates.join.invalid, false],
      [json({ detail: [{ msg: 'bad' }] }, 422), he.flatmates.join.invalid, false],
      [err(409, 'own_listing'), he.flatmates.join.own, false],
      [err(429, 'rate_limited'), he.flatmates.join.rateLimited, true],
    ] as const) {
      ({ api, view } = renderJoin({ [PREVIEW]: [reply] }));
      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      expect(screen.queryByRole('button', { name: he.flatmates.join.cta })).toBeNull();
      await waitFor(() => {
        expect(readInviteToken()).toBe(kept ? T : null);
      });
      expect(api.calls(PREVIEW)).toHaveLength(1); // no retry
      reset(view);
    }

    // A 401 on the preview: the session is cleared and the page goes to the login with a bare
    // `next`, the token still stored for the way back.
    ({ api, view } = renderJoin({ [PREVIEW]: [err(401, 'unauthenticated')] }));
    await waitFor(() => {
      expect(currentPath()).toBe('/login?next=%2Fflatmates%2Fjoin');
    });
    expect(readInviteToken()).toBe(T);
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe(T);
    expect(api.calls(PREVIEW)).toHaveLength(1);
    reset(view);

    // A failing preview (5xx): ErrorState, the token kept; retry previews again.
    ({ api, view } = renderJoin({ [PREVIEW]: [err(500, 'boom'), json(P)] }));
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await cta()).toBeEnabled();
    expect(api.calls(PREVIEW)).toHaveLength(2);
    expect(readInviteToken()).toBe(T);
    reset(view);

    // Join errors: each its own text. Final ones clear the token and drop the CTA; 429 keeps both.
    for (const [reply, text, kept] of [
      [err(404, 'not_found'), he.flatmates.join.invalid, false],
      [err(409, 'own_listing'), he.flatmates.join.own, false],
      [err(409, 'already_applied'), he.flatmates.join.applied, false],
      [err(409, 'declined'), he.flatmates.join.declined, false],
      [err(409, 'flatmates_full'), he.flatmates.join.full, false],
      [err(429, 'rate_limited'), he.flatmates.join.rateLimited, true],
    ] as const) {
      ({ view } = renderJoin({ [PREVIEW]: [json(P)], [JOIN]: [reply] }));
      fireEvent.click(await cta());
      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      expect(currentPath()).toBe('/flatmates/join');
      expect(readInviteToken()).toBe(kept ? T : null);
      if (kept) expect(screen.getByRole('button', { name: he.flatmates.join.cta })).toBeEnabled();
      else expect(screen.queryByRole('button', { name: he.flatmates.join.cta })).toBeNull();
      reset(view);
    }
    // The declined copy has no "withdraw" hint (A2).
    expect(he.flatmates.join.declined).not.toContain('ביטול');

    // A failing join (5xx): ErrorState, the token kept; retry joins again.
    ({ api, view } = renderJoin({
      [PREVIEW]: [json(P)],
      [JOIN]: [err(500, 'boom'), json({ listing_id: P.listing.id })],
    }));
    fireEvent.click(await cta());
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await screen.findByText(he.flatmates.join.done)).toBeVisible();
    expect(api.calls(JOIN)).toHaveLength(2);
    reset(view);
  });

  it('ac9_show_switch_off_by_default_and_sent', async () => {
    // Spec 0010f AC9: "להציג אותי בעמוד החדר" is off by default and its value goes in the body;
    // it shows only while the person can join.
    let { api, view } = renderJoin({
      [PREVIEW]: [json(P)],
      [JOIN]: [json({ listing_id: P.listing.id })],
    });
    const button = await cta();
    const show = screen.getByRole('switch', { name: he.flatmates.join.show });
    expect(show).not.toBeChecked();
    expect(show).toHaveAccessibleDescription(he.flatmates.join.showHint);
    fireEvent.click(show);
    expect(show).toBeChecked();
    fireEvent.click(button);
    await waitFor(() => {
      expect(api.calls(JOIN)).toHaveLength(1);
    });
    expect(api.calls(JOIN)[0]?.body).toEqual({ token: T, shown: true });
    expect(await screen.findByText(he.flatmates.join.done)).toBeVisible();
    reset(view);

    // A member, and a final answer, show no switch.
    ({ view } = renderJoin({ [PREVIEW]: [json(invitePreview({ member: true }))] }));
    expect(await screen.findByText(he.flatmates.join.member)).toBeVisible();
    expect(screen.queryByRole('switch')).toBeNull();
    reset(view);
    ({ view } = renderJoin({ [PREVIEW]: [err(404, 'not_found')] }));
    expect(await screen.findByText(he.flatmates.join.invalid)).toBeVisible();
    expect(screen.queryByRole('switch')).toBeNull();
    reset(view);
    ({ api, view } = renderJoin({
      [PREVIEW]: [json(P)],
      [JOIN]: [err(409, 'flatmates_full')],
    }));
    fireEvent.click(await cta());
    expect(await screen.findByText(he.flatmates.join.full)).toBeVisible();
    expect(api.calls(JOIN)[0]?.body).toEqual({ token: T, shown: false });
    expect(screen.queryByRole('switch')).toBeNull();
    reset(view);
  });

  it('ac3_focus_after_final_error', async () => {
    // A final 4xx removes the join button: its failure line takes focus.
    for (const [reply, text] of [
      [err(404, 'not_found'), he.flatmates.join.invalid],
      [err(409, 'flatmates_full'), he.flatmates.join.full],
    ] as const) {
      const { view } = renderJoin({ [PREVIEW]: [json(P)], [JOIN]: [reply] });
      const button = await cta();
      act(() => button.focus());
      fireEvent.click(button);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(text);
      await waitFor(() => {
        expect(alert).toHaveFocus();
      });
      reset(view);
    }

    // An unknown 409 ("other") has no line: focus falls back to <main>.
    mockApi({
      'GET /me': [json(seeker)],
      [PREVIEW]: [json(P)],
      [JOIN]: [err(409, 'something_new')],
    });
    renderRoutes(
      `/flatmates/join#${T}`,
      <main id="main" tabIndex={-1}>
        {routes}
      </main>,
    );
    const button = await cta();
    act(() => button.focus());
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: he.flatmates.join.cta })).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByRole('main')).toHaveFocus();
    });
  });

  it('ac9_final_states_have_a_way_out', async () => {
    // "למודעות שלי", "למועמדויות שלי", "לשוק השותפים" (spec 0010a: a flat is the market's)
    const toMyListings = '\u05dc\u05de\u05d5\u05d3\u05e2\u05d5\u05ea \u05e9\u05dc\u05d9';
    const toApplications =
      '\u05dc\u05de\u05d5\u05e2\u05de\u05d3\u05d5\u05d9\u05d5\u05ea \u05e9\u05dc\u05d9';
    const toSearch = he.flatmates.join.toSearch;
    const wayOut = async (name: string, href: string) => {
      const link = await screen.findByRole('link', { name });
      expect(link).toHaveAttribute('href', href);
      expect(screen.getByRole('alert').contains(link)).toBe(false);
    };
    const noLinks = () => {
      for (const name of [toMyListings, toApplications, toSearch]) {
        expect(screen.queryByRole('link', { name })).toBeNull();
      }
    };

    // The preview's final answers.
    for (const [reply, name, href] of [
      [err(409, 'own_listing'), toMyListings, '/market/mine'],
      [err(404, 'not_found'), toSearch, '/market'],
    ] as const) {
      const { view } = renderJoin({ [PREVIEW]: [reply] });
      await screen.findByRole('alert');
      await wayOut(name, href);
      reset(view);
    }

    // The join's final answers.
    for (const [reply, name, href] of [
      [err(409, 'already_applied'), toApplications, '/market/mine?tab=applications'],
      [err(409, 'declined'), toSearch, '/market'],
      [err(409, 'flatmates_full'), toSearch, '/market'],
      [err(404, 'not_found'), toSearch, '/market'],
    ] as const) {
      const { view } = renderJoin({ [PREVIEW]: [json(P)], [JOIN]: [reply] });
      fireEvent.click(await cta());
      await screen.findByRole('alert');
      await wayOut(name, href);
      reset(view);
    }

    // No token at all.
    let { view } = renderJoin({}, '/flatmates/join');
    await screen.findByRole('alert');
    await wayOut(toSearch, '/market');
    reset(view);

    // A 429, on the preview and on the join: no link.
    ({ view } = renderJoin({ [PREVIEW]: [err(429, 'rate_limited')] }));
    expect(await screen.findByRole('alert')).toHaveTextContent(he.flatmates.join.rateLimited);
    noLinks();
    reset(view);
    ({ view } = renderJoin({ [PREVIEW]: [json(P)], [JOIN]: [err(429, 'rate_limited')] }));
    fireEvent.click(await cta());
    expect(await screen.findByRole('alert')).toHaveTextContent(he.flatmates.join.rateLimited);
    noLinks();
    reset(view);
  });

  it('ac12_outcomes_to_market', async () => {
    // Spec 0010a: declined, full and invalid lead to the market ("לשוק השותפים"), own and applied
    // to the market's "שלי".
    const cases: [Record<string, Reply[]>, string][] = [
      [{ [PREVIEW]: [json(P)], [JOIN]: [err(409, 'declined')] }, '/market'],
      [{ [PREVIEW]: [json(P)], [JOIN]: [err(409, 'flatmates_full')] }, '/market'],
      [{ [PREVIEW]: [err(404, 'not_found')] }, '/market'],
      [{ [PREVIEW]: [err(409, 'own_listing')] }, '/market/mine'],
      // Spec 0010b: straight to the room applications' panel.
      [
        { [PREVIEW]: [json(P)], [JOIN]: [err(409, 'already_applied')] },
        '/market/mine?tab=applications',
      ],
    ];
    for (const [replies, href] of cases) {
      const { view } = renderJoin(replies);
      if (JOIN in replies) fireEvent.click(await cta());
      await screen.findByRole('alert');
      const links = screen
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'))
        .filter((h) => h === '/search' || (h?.startsWith('/market') ?? false));
      expect(links).toEqual([href]);
      if (href === '/market') {
        expect(screen.getByRole('link', { name: he.flatmates.join.toSearch })).toHaveAttribute(
          'href',
          '/market',
        );
      }
      reset(view);
    }
  });

  it('ac4_token_never_in_url', async () => {
    for (const storage of ['works', 'throws'] as const) {
      if (storage === 'throws') {
        for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
          vi.spyOn(Storage.prototype, method).mockImplementation(() => {
            throw new DOMException('denied', 'SecurityError');
          });
        }
      }
      // A logged-out visit to the link, in a browser router.
      window.history.replaceState(null, '', `/flatmates/join#${T}`);
      const length = window.history.length;
      const client = testQueryClient();
      const api = mockApi({
        'GET /me': [LOGGED_OUT()],
        [PREVIEW]: [json(P)],
        [JOIN]: [json({ listing_id: P.listing.id })],
        'GET /me/conversations': [json([])],
      });
      const view = render(
        <QueryClientProvider client={client}>
          <BrowserRouter>{routes}</BrowserRouter>
        </QueryClientProvider>,
      );

      // The login page, with a bare `next`: no token and no hash in the URL, the entry replaced.
      expect(
        await screen.findByRole('heading', { level: 1, name: he.auth.login.title }),
      ).toBeVisible();
      expect(window.location.href).toBe(`${window.location.origin}/login?next=%2Fflatmates%2Fjoin`);
      expect(window.location.href).not.toContain(T);
      expect(window.location.href).not.toContain('#');
      expect(window.history.length).toBe(length);
      if (storage === 'works') expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe(T);
      expect(readInviteToken()).toBe(T);
      expect(api.calls(PREVIEW)).toHaveLength(0);

      // The login succeeds: back on the join page, which previews and joins with the stored token.
      act(() => {
        client.setQueryData(ME_KEY, seeker);
      });
      const button = await cta();
      expect(window.location.pathname).toBe('/flatmates/join');
      expect(window.location.hash).toBe('');
      fireEvent.click(button);
      expect(await screen.findByText(he.flatmates.join.done)).toBeVisible();
      expect(window.location.pathname).toBe('/chat');
      // Every step replaced the entry: Back does not return to the spent join page.
      expect(window.history.length).toBe(length);
      // The chat list clears the entry's `joined` state: a reload or Back does not repeat it.
      await waitFor(() => {
        expect((window.history.state as { usr?: unknown } | null)?.usr ?? null).toBeNull();
      });
      expect(screen.getByText(he.flatmates.join.done)).toBeVisible();
      expect(api.calls(PREVIEW)[0]?.body).toEqual({ token: T });
      expect(api.calls(JOIN)[0]?.body).toEqual({ token: T, shown: false });
      expect(readInviteToken()).toBeNull();
      for (const call of api.fetchMock.mock.calls) {
        expect(call[0].url).not.toContain(T);
      }
      view.unmount();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }

    // No hash and nothing stored: the invalid text, without a login redirect or a request.
    let { api, view } = renderJoin({ 'GET /me': [LOGGED_OUT()] }, '/flatmates/join');
    expect(await screen.findByText(he.flatmates.join.invalid)).toBeVisible();
    expect(currentPath()).toBe('/flatmates/join');
    expect(api.calls(PREVIEW)).toHaveLength(0);
    reset(view);

    // A hash that is not a token: dropped from the URL, not stored, the invalid text.
    stashInviteToken(T);
    ({ api, view } = renderJoin({}, '/flatmates/join#not%20a%20token'));
    expect(await screen.findByText(he.flatmates.join.invalid)).toBeVisible();
    expect(currentPath()).toBe('/flatmates/join');
    expect(readInviteToken()).toBeNull();
    expect(api.calls(PREVIEW)).toHaveLength(0);
    reset(view);

    // The hash is decoded and trimmed, as the API trims: `#<token>%20` works.
    ({ api, view } = renderJoin({ [PREVIEW]: [json(P)] }, `/flatmates/join#${T}%20`));
    await cta();
    expect(api.calls(PREVIEW)[0]?.body).toEqual({ token: T });
    expect(currentPath()).toBe('/flatmates/join');
    reset(view);

    // A hash wins over a stored token.
    stashInviteToken('older-token');
    ({ api, view } = renderJoin({ [PREVIEW]: [json(P)] }));
    await cta();
    expect(api.calls(PREVIEW)[0]?.body).toEqual({ token: T });
    reset(view);
  });
  it('ac4_logout_forgets_the_stashed_token', () => {
    // Logout (and any other session clear) forgets a stashed invite, so the next person on this
    // tab never sees it; the login itself keeps it, as its way back to the join page.
    const client = testQueryClient();
    stashInviteToken(T);
    clearSession(client, { keepInviteToken: true });
    expect(readInviteToken()).toBe(T);
    clearSession(client);
    expect(readInviteToken()).toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('ac3_states_layout', async () => {
    // Every state: one <h1>, in the narrow (480px) column.
    const frame = () => {
      const h1s = screen.getAllByRole('heading', { level: 1 });
      expect(h1s).toHaveLength(1);
      expect(h1s[0]).toHaveTextContent(he.flatmates.join.title);
      expect(h1s[0]?.closest('section')).toHaveClass('max-w-narrow');
    };

    // Loading (the session check pending).
    const me = deferred();
    let { view } = renderJoin({ 'GET /me': [me.promise] });
    await waitFor(() => {
      expect(screen.getByText(he.common.loading).closest('[aria-busy="true"]')).not.toBeNull();
    });
    frame();
    reset(view);

    // The preview: the room's title, who invites, a full-width join button, the hello mascot.
    ({ view } = renderJoin({ [PREVIEW]: [json(P)] }));
    const button = await cta();
    frame();
    expect(screen.getByText(cardTitle(i18n.t, P.listing))).toBeVisible();
    expect(screen.getByText(i18n.t('flatmates.join.invitedBy', { owner: 'רוני' }))).toHaveAttribute(
      'dir',
      'auto',
    );
    expect(button).toHaveClass('w-full');
    const hello = document.querySelector('section img');
    expect(hello).toHaveAttribute('alt', '');
    expect(hello?.getAttribute('src')).toContain('hello');
    reset(view);

    // Member: the message and "to the chats" to /chat, the celebrating mascot.
    ({ view } = renderJoin({ [PREVIEW]: [json(invitePreview({ member: true }))] }));
    expect(await screen.findByText(he.flatmates.join.member)).toBeVisible();
    frame();
    expect(screen.getByRole('link', { name: he.flatmates.join.toChats })).toHaveAttribute(
      'href',
      '/chat',
    );
    expect(document.querySelector('section img')?.getAttribute('src')).toContain('celebrate');
    reset(view);

    // No token: the invalid alert, no mascot (a failure is not an empty state).
    ({ view } = renderJoin({}, '/flatmates/join'));
    expect(await screen.findByRole('alert')).toHaveTextContent(he.flatmates.join.invalid);
    frame();
    expect(document.querySelector('section img')).toBeNull();
    reset(view);

    // The preview's final answers and its rate limit.
    for (const [reply, text] of [
      [err(404, 'not_found'), he.flatmates.join.invalid],
      [err(409, 'own_listing'), he.flatmates.join.own],
      [err(429, 'rate_limited'), he.flatmates.join.rateLimited],
    ] as const) {
      ({ view } = renderJoin({ [PREVIEW]: [reply] }));
      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      frame();
      reset(view);
    }

    // The join's final answers and its rate limit: the alert under the card's title.
    for (const [reply, text] of [
      [err(404, 'not_found'), he.flatmates.join.invalid],
      [err(409, 'own_listing'), he.flatmates.join.own],
      [err(409, 'already_applied'), he.flatmates.join.applied],
      [err(409, 'declined'), he.flatmates.join.declined],
      [err(409, 'flatmates_full'), he.flatmates.join.full],
      [err(429, 'rate_limited'), he.flatmates.join.rateLimited],
    ] as const) {
      ({ view } = renderJoin({ [PREVIEW]: [json(P)], [JOIN]: [reply] }));
      fireEvent.click(await cta());
      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      frame();
      reset(view);
    }

    // `other` (a 5xx), on the preview and on the join: ErrorState.
    ({ view } = renderJoin({ [PREVIEW]: [err(500, 'boom')] }));
    expect(await screen.findByRole('button', { name: he.common.retry })).toBeVisible();
    frame();
    reset(view);
    ({ view } = renderJoin({ [PREVIEW]: [json(P)], [JOIN]: [err(500, 'boom')] }));
    fireEvent.click(await cta());
    expect(await screen.findByRole('button', { name: he.common.retry })).toBeVisible();
    frame();
    reset(view);
  });

  it('ac5_token_never_rendered', async () => {
    // The token must never reach the page: not its text, not an `href`, not any attribute. Every
    // DOM mutation is checked as well as each named checkpoint.
    const leaks: string[] = [];
    const check = (where: string) => {
      if (document.body.textContent?.includes(T) === true) leaks.push(`${where}: text`);
      for (const el of document.querySelectorAll('[href]')) {
        if (el.getAttribute('href')?.includes(T) === true) leaks.push(`${where}: href`);
      }
      if (document.body.innerHTML.includes(T)) leaks.push(`${where}: markup`);
      if (document.title.includes(T)) leaks.push(`${where}: title`);
    };
    const observer = new MutationObserver(() => check('a mutation'));
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });

    window.history.replaceState(null, '', `/flatmates/join#${T}`);
    const me = deferred();
    const api = mockApi({
      'GET /me': [me.promise],
      [PREVIEW]: [json(P)],
      [JOIN]: [err(429, 'rate_limited'), err(409, 'flatmates_full')],
    });
    const view = render(
      <QueryClientProvider client={testQueryClient()}>
        <BrowserRouter>{routes}</BrowserRouter>
      </QueryClientProvider>,
    );
    check('the first render');

    // The hash effect: the hash is gone from the URL.
    await waitFor(() => {
      expect(window.location.hash).toBe('');
    });
    expect(window.location.pathname).toBe('/flatmates/join');
    check('after the hash effect');

    // The preview.
    me.resolve(json(seeker));
    const button = await cta();
    check('the preview');

    // A 429 join: the alert and the button.
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(he.flatmates.join.rateLimited);
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    check('after a 429 join');

    // A final 409 join.
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(he.flatmates.join.full);
    });
    check('after a final 409 join');

    // The token went in the POST bodies only.
    expect(api.calls(PREVIEW)[0]?.body).toEqual({ token: T });
    expect(api.calls(JOIN).map((call) => call.body)).toEqual([
      { token: T, shown: false },
      { token: T, shown: false },
    ]);
    for (const call of api.fetchMock.mock.calls) {
      expect(call[0].url).not.toContain(T);
    }
    observer.disconnect();
    expect(leaks).toEqual([]);
    view.unmount();
  });
});
