import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { ChatStreamProvider } from '../../chat/ChatStreamProvider';
import { conversation } from '../../chat/__tests__/fixtures';
import { ES } from '../../chat/__tests__/harness';
import { owner } from '../../listings/__tests__/fixtures';
import { AuthMenu } from '../AuthMenu';
import {
  deferred,
  empty,
  json,
  mockApi,
  networkError,
  noa,
  renderRoutes,
  testQueryClient,
} from './harness';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const LIST = 'GET /me/conversations';
// The header as `Layout` renders it: inside the chat event stream's provider.
const menu = (
  <ChatStreamProvider>
    <AuthMenu />
  </ChatStreamProvider>
);

describe('AuthMenu', () => {
  it('ac1_skeleton_then_name_then_logout', async () => {
    const me = deferred();
    const logout = deferred();
    const api = mockApi({
      'GET /me': [me.promise],
      'POST /auth/logout': [logout.promise],
      [LIST]: [json([])],
    });
    renderRoutes('/', menu);

    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();

    me.resolve(json(noa));
    expect(await screen.findByText(i18n.t('header.greeting', { name: 'נועה' }))).toBeVisible();
    expect(screen.queryByTestId('skeleton')).toBeNull();
    expect(screen.queryByRole('link', { name: he.header.login })).toBeNull();
    const button = screen.getByRole('button', { name: he.header.logout });

    fireEvent.click(button);
    await vi.waitFor(() => {
      expect(button).toBeDisabled();
    });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(api.calls('POST /auth/logout')).toHaveLength(1);

    logout.resolve(empty(204));
    expect(await screen.findByRole('link', { name: he.header.login })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.queryByRole('button', { name: he.header.logout })).toBeNull();

    // The session cookie travels with every call.
    for (const call of [...api.calls('GET /me'), ...api.calls('POST /auth/logout')]) {
      expect(call.request.credentials).toBe('include');
    }
  });

  it('refetch_error_keeps_signed_in_nav', async () => {
    mockApi({
      'GET /me': [json(noa), json({ detail: 'boom' }, 500)],
      [LIST]: [json([])],
    });
    const client = testQueryClient();
    renderRoutes('/', menu, client);
    expect(await screen.findByRole('button', { name: he.header.logout })).toBeVisible();

    await act(async () => {
      await client.invalidateQueries({ queryKey: ['me'] });
    });
    await vi.waitFor(() => {
      expect(client.getQueryState(['me'])?.status).toBe('error');
    });
    expect(screen.getByRole('button', { name: he.header.logout })).toBeVisible();
    expect(screen.queryByRole('link', { name: he.header.login })).toBeNull();
  });

  it('ac2_logged_out_on_401_and_on_error', async () => {
    mockApi({ 'GET /me': [json({ detail: 'unauthenticated' }, 401)] });
    const first = renderRoutes('/', menu);

    expect(await screen.findByRole('link', { name: he.header.login })).toHaveAttribute(
      'href',
      '/login',
    );
    // No "הרשמה" in the header (spec 0009a Q5): the login form signs up an unknown email.
    expect(screen.queryByRole('link', { name: he.header.signup })).toBeNull();
    first.unmount();
    vi.unstubAllGlobals();

    // The app's own client retries queries once; useMe must override that, so the logged-out
    // header shows within 100 ms of a network failure, after a single call.
    const api = mockApi({ 'GET /me': [networkError] });
    renderRoutes('/', menu, testQueryClient(1));

    expect(
      await screen.findByRole('link', { name: he.header.login }, { timeout: 100 }),
    ).toBeVisible();
    expect(api.calls('GET /me')).toHaveLength(1);
  });

  it('ac9_my_applications_link', async () => {
    // A seeker: "מועמדויות", not "my listings".
    mockApi({ 'GET /me': [json(noa)], [LIST]: [json([])] });
    let view = renderRoutes('/', menu);
    expect(await screen.findByRole('link', { name: he.nav.applications })).toHaveAttribute(
      'href',
      '/me/applications',
    );
    expect(screen.queryByRole('link', { name: he.header.myListings })).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // An owner: "my listings" only.
    mockApi({ 'GET /me': [json({ ...noa, role: 'owner' })], [LIST]: [json([])] });
    view = renderRoutes('/', menu);
    expect(await screen.findByRole('link', { name: he.header.myListings })).toHaveAttribute(
      'href',
      '/me/listings',
    );
    expect(screen.queryByRole('link', { name: he.nav.applications })).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // A visitor: neither.
    mockApi({ 'GET /me': [json({ detail: 'unauthenticated' }, 401)] });
    renderRoutes('/', menu);
    expect(await screen.findByRole('link', { name: he.header.login })).toBeVisible();
    expect(screen.queryByRole('link', { name: he.header.myListings })).toBeNull();
    expect(screen.queryByRole('link', { name: he.nav.applications })).toBeNull();
  });
  it('ac1_chat_link_and_count', async () => {
    const chatLink = () => screen.findByRole('link', { name: new RegExp(`^${he.header.chat}`) });
    const newCount = (count: number) => i18n.t('header.chatNew', { count });

    // An owner with chats [unread 2, never opened, read]: the link and a pill "2", whose
    // sentence is part of the link's name.
    let api = mockApi({
      'GET /me': [json(owner)],
      [LIST]: [
        json([conversation({ unread_count: 2 }), conversation({ is_new: true }), conversation()]),
      ],
    });
    let view = renderRoutes('/', menu);
    let link = await chatLink();
    expect(link).toHaveAttribute('href', '/chat');
    expect(await within(link).findByText('2')).toHaveAttribute('aria-hidden', 'true');
    expect(link).toHaveAccessibleName(`${he.header.chat} ${newCount(2)}`);
    // After the owner's first tab, "המודעות שלי" (spec 0009a).
    const links = screen.getAllByRole('link');
    expect(links.indexOf(link)).toBeGreaterThan(
      links.indexOf(screen.getByRole('link', { name: he.header.myListings })),
    );
    view.unmount();
    vi.unstubAllGlobals();

    // A seeker with none, and a failing list: the link with no pill, the rest of the header.
    for (const reply of [json([]), json({ detail: 'boom' }, 500)]) {
      api = mockApi({ 'GET /me': [json(noa)], [LIST]: [reply] });
      view = renderRoutes('/', menu);
      link = await chatLink();
      await vi.waitFor(() => {
        expect(api.calls(LIST)).toHaveLength(1);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(link).toHaveAccessibleName(he.header.chat);
      expect(screen.getByRole('link', { name: he.nav.applications })).toBeVisible();
      expect(screen.getByRole('button', { name: he.header.logout })).toBeVisible();
      view.unmount();
      vi.unstubAllGlobals();
    }

    // A visitor: no chat link, no list request.
    api = mockApi({ 'GET /me': [json({ detail: 'unauthenticated' }, 401)] });
    view = renderRoutes('/', menu);
    expect(await screen.findByRole('link', { name: he.header.login })).toBeVisible();
    expect(screen.queryByRole('link', { name: new RegExp(he.header.chat) })).toBeNull();
    expect(api.calls(LIST)).toHaveLength(0);
    view.unmount();
    vi.unstubAllGlobals();

    vi.useFakeTimers({ shouldAdvanceTime: true });

    // A 401 on the list: the session is gone; the login links, and no more list requests.
    api = mockApi({ 'GET /me': [json(noa)], [LIST]: [json({ detail: 'unauthenticated' }, 401)] });
    view = renderRoutes('/', menu);
    expect(await screen.findByRole('link', { name: he.header.login })).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(api.calls(LIST)).toHaveLength(1);
    view.unmount();
    vi.unstubAllGlobals();

    // Stream connected: no polling. Not connected: the list again after 60 s.
    for (const open of [true, false]) {
      api = mockApi({ 'GET /me': [() => json(noa)], [LIST]: [() => json([])] });
      view = renderRoutes('/', menu);
      await chatLink();
      if (open) {
        act(() => {
          ES.latest().open();
        });
      }
      await vi.waitFor(() => {
        expect(api.calls(LIST)).toHaveLength(1);
      });
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(api.calls(LIST)).toHaveLength(open ? 1 : 2);
      view.unmount();
      vi.unstubAllGlobals();
    }
  });
  it('ac10_profile_link', async () => {
    // A seeker: "פרופיל" links to /me/profile, last: after "מועמדויות" and "צ'אט".
    mockApi({
      'GET /me': [json(noa)],
      [LIST]: [json([])],
      'GET /me/likes': [json({ liked_me: [], mine: [] })],
    });
    let view = renderRoutes('/', menu);
    const profile = await screen.findByRole('link', { name: he.nav.profile });
    expect(profile).toHaveAttribute('href', '/me/profile');
    const links = screen.getAllByRole('link');
    const applications = screen.getByRole('link', { name: he.nav.applications });
    expect(links.indexOf(profile)).toBe(links.indexOf(applications) + 2);
    view.unmount();
    vi.unstubAllGlobals();

    // An owner and a visitor: no profile link.
    for (const me of [json({ ...noa, role: 'owner' }), json({ detail: 'unauthenticated' }, 401)]) {
      mockApi({ 'GET /me': [me], [LIST]: [json([])] });
      view = renderRoutes('/', menu);
      expect(await screen.findAllByRole('link')).not.toHaveLength(0);
      expect(screen.queryByRole('link', { name: he.nav.profile })).toBeNull();
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac3_likes_badge_forms', async () => {
    const room = () => ({ listing: {}, liked_at: '2026-11-11T09:00:00Z' });
    const forms: [number, string][] = [
      [1, '\u05d7\u05d3\u05e8 \u05d0\u05d7\u05d3 \u05d0\u05d4\u05d1 \u05d0\u05d5\u05ea\u05da'],
      [2, '2 \u05d7\u05d3\u05e8\u05d9\u05dd \u05d0\u05d4\u05d1\u05d5 \u05d0\u05d5\u05ea\u05da'],
    ];
    for (const [count, text] of forms) {
      mockApi({
        'GET /me': [json(noa)],
        [LIST]: [json([])],
        'GET /me/likes': [json({ liked_me: Array.from({ length: count }, room), mine: [] })],
      });
      const view = renderRoutes('/', menu);
      const link = await screen.findByRole('link', { name: new RegExp(he.header.likes) });
      expect(await within(link).findByText(text)).toHaveClass('sr-only');
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac6_likes_link', async () => {
    const room = () => ({ listing: {}, liked_at: '2026-11-11T09:00:00Z' });
    // Two rooms liked the seeker: the link, the badge number, and the sr-only sentence.
    let api = mockApi({
      'GET /me': [json(noa)],
      [LIST]: [json([])],
      'GET /me/likes': [json({ liked_me: [room(), room()], mine: [room()] })],
    });
    let view = renderRoutes('/', menu);
    const link = await screen.findByRole('link', { name: new RegExp(he.header.likes) });
    expect(link).toHaveAttribute('href', '/me/likes');
    expect(await within(link).findByText('2')).toHaveAttribute('aria-hidden', 'true');
    expect(within(link).getByText(i18n.t('likes.badgeLabel', { count: 2 }))).toHaveClass('sr-only');
    expect(api.calls('GET /me/likes')).toHaveLength(1);
    view.unmount();
    vi.unstubAllGlobals();

    // One room: the singular sentence.
    mockApi({
      'GET /me': [json(noa)],
      [LIST]: [json([])],
      'GET /me/likes': [json({ liked_me: [room()], mine: [] })],
    });
    view = renderRoutes('/', menu);
    expect(await screen.findByText(i18n.t('likes.badgeLabel', { count: 1 }))).toBeInTheDocument();
    view.unmount();
    vi.unstubAllGlobals();

    // None: the link without a badge.
    mockApi({
      'GET /me': [json(noa)],
      [LIST]: [json([])],
      'GET /me/likes': [json({ liked_me: [], mine: [room()] })],
    });
    const client = testQueryClient();
    view = renderRoutes('/', menu, client);
    const plain = await screen.findByRole('link', { name: he.header.likes });
    // The list has loaded (one room of `mine`, none of `liked_me`) before "no badge" is asserted.
    await vi.waitFor(() => {
      expect(client.getQueryState(['me', 'likes'])?.status).toBe('success');
    });
    expect(within(plain).queryByText(/\d/)).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // An owner: no link and no request.
    api = mockApi({
      'GET /me': [json({ ...noa, role: 'owner' })],
      [LIST]: [json([])],
      'GET /me/likes': [json({ liked_me: [], mine: [] })],
    });
    renderRoutes('/', menu);
    expect(await screen.findByRole('link', { name: he.header.myListings })).toBeVisible();
    expect(screen.queryByRole('link', { name: he.header.likes })).toBeNull();
    expect(api.calls('GET /me/likes')).toHaveLength(0);
  });
});
