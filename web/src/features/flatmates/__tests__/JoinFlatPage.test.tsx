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
    expect(api.calls(JOIN)[0]?.body).toEqual({ token: T });
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
      expect(api.calls(JOIN)[0]?.body).toEqual({ token: T });
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
});
