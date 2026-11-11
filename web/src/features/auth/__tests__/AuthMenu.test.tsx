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

  it('ac2_logged_out_on_401_and_on_error', async () => {
    mockApi({ 'GET /me': [json({ detail: 'unauthenticated' }, 401)] });
    const first = renderRoutes('/', menu);

    expect(await screen.findByRole('link', { name: he.header.login })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.getByRole('link', { name: he.header.signup })).toHaveAttribute('href', '/signup');
    first.unmount();
    vi.unstubAllGlobals();

    // The app's own client retries queries once; useMe must override that, so the logged-out
    // header shows within 100 ms of a network failure, after a single call.
    const api = mockApi({ 'GET /me': [networkError] });
    renderRoutes('/', menu, testQueryClient(1));

    expect(
      await screen.findByRole('link', { name: he.header.login }, { timeout: 100 }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: he.header.signup })).toBeVisible();
    expect(api.calls('GET /me')).toHaveLength(1);
  });

  it('ac9_my_applications_link', async () => {
    // A seeker: "my applications", not "my listings".
    mockApi({ 'GET /me': [json(noa)], [LIST]: [json([])] });
    let view = renderRoutes('/', menu);
    expect(await screen.findByRole('link', { name: he.header.myApplications })).toHaveAttribute(
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
    expect(screen.queryByRole('link', { name: he.header.myApplications })).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // A visitor: neither.
    mockApi({ 'GET /me': [json({ detail: 'unauthenticated' }, 401)] });
    renderRoutes('/', menu);
    expect(await screen.findByRole('link', { name: he.header.login })).toBeVisible();
    expect(screen.queryByRole('link', { name: he.header.myListings })).toBeNull();
    expect(screen.queryByRole('link', { name: he.header.myApplications })).toBeNull();
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
    // Before the role link.
    const links = screen.getAllByRole('link');
    expect(links.indexOf(link)).toBeLessThan(
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
      expect(screen.getByRole('link', { name: he.header.myApplications })).toBeVisible();
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
    // A seeker: "my profile" links to /me/profile, right after "my applications".
    mockApi({ 'GET /me': [json(noa)], [LIST]: [json([])] });
    let view = renderRoutes('/', menu);
    const profile = await screen.findByRole('link', { name: he.header.myProfile });
    expect(profile).toHaveAttribute('href', '/me/profile');
    const links = screen.getAllByRole('link');
    const applications = screen.getByRole('link', { name: he.header.myApplications });
    expect(links.indexOf(profile)).toBe(links.indexOf(applications) + 1);
    view.unmount();
    vi.unstubAllGlobals();

    // An owner and a visitor: no profile link.
    for (const me of [json({ ...noa, role: 'owner' }), json({ detail: 'unauthenticated' }, 401)]) {
      mockApi({ 'GET /me': [me], [LIST]: [json([])] });
      view = renderRoutes('/', menu);
      expect(await screen.findAllByRole('link')).not.toHaveLength(0);
      expect(screen.queryByRole('link', { name: he.header.myProfile })).toBeNull();
      view.unmount();
      vi.unstubAllGlobals();
    }
  });
});
