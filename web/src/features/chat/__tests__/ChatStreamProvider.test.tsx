import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import {
  currentPath,
  empty,
  json,
  mockApi,
  renderRoutes,
  testQueryClient,
} from '../../auth/__tests__/harness';
import { clearSession } from '../../auth/useLogout';
import { ME_KEY } from '../../auth/useMe';
import { seeker } from '../../listings/__tests__/fixtures';
import { threadKey } from '../useThread';
import { conversation, message, thread } from './fixtures';
import { chatRoutes, connected, ES, openStream, settle } from './harness';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const X = conversation({ other_name: 'דנה' });
const LIST = 'GET /me/conversations';
const THREAD = `GET /conversations/${X.id}`;
const OTHER = '00000000-0000-0000-0000-00000000ffff';
const T = thread({ id: X.id, other_name: X.other_name, messages: [message()] });

describe('ChatStreamProvider', () => {
  it('ac13_one_stream_per_tab', async () => {
    // A visitor: no stream.
    mockApi({ 'GET /me': [json({ detail: 'unauthenticated' }, 401)] });
    const visitor = renderRoutes('/', chatRoutes);
    expect(await screen.findByRole('link', { name: he.header.login })).toBeVisible();
    expect(ES.instances).toHaveLength(0);
    visitor.unmount();
    vi.unstubAllGlobals();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = mockApi({
      'GET /me': [() => json(seeker)],
      [LIST]: [() => json([X])],
      [THREAD]: [() => json(T)],
      'POST /auth/logout': [empty(204)],
    });
    const client = testQueryClient();
    const view = renderRoutes('/', chatRoutes, client);
    const chatLink = await screen.findByRole('link', { name: he.header.chat });

    // Logged in: exactly one stream, to the API's events URL, with the session cookie.
    expect(ES.live()).toHaveLength(1);
    const source = ES.latest();
    expect(source.url).toBe('http://api.test/me/events');
    expect(source.withCredentials).toBe(true);
    expect(connected()).toBe('false');

    // Its first open refetches nothing.
    await settle();
    const listCalls = api.calls(LIST).length;
    openStream();
    expect(connected()).toBe('true');
    await settle();
    expect(api.calls(LIST)).toHaveLength(listCalls);

    // Navigating / → /chat → /chat/X keeps the one stream.
    fireEvent.click(chatLink);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.chat.list.title }),
    ).toBeVisible();
    fireEvent.click(await screen.findByRole('link', { name: new RegExp(X.other_name) }));
    expect(await screen.findByRole('heading', { level: 1, name: X.other_name })).toBeVisible();
    expect(currentPath()).toBe(`/chat/${X.id}`);
    expect(ES.instances).toEqual([source]);

    // So does a /me refetch.
    await act(() => client.invalidateQueries({ queryKey: ME_KEY, exact: true }));
    expect(api.calls('GET /me')).toHaveLength(2);
    expect(ES.instances).toEqual([source]);
    await settle();

    // A `chat` event refetches the list and that thread only.
    client.setQueryData(threadKey(OTHER), thread({ id: OTHER }));
    let lists = api.calls(LIST).length;
    let threads = api.calls(THREAD).length;
    act(() => {
      source.emit('chat', { conversation_id: X.id, kind: 'message' });
    });
    await vi.waitFor(() => {
      expect(api.calls(THREAD)).toHaveLength(threads + 1);
      expect(api.calls(LIST)).toHaveLength(lists + 1);
    });
    expect(client.getQueryState(threadKey(OTHER))?.isInvalidated).toBe(false);
    await settle();

    // `resync`: the list and every thread.
    lists = api.calls(LIST).length;
    threads = api.calls(THREAD).length;
    act(() => {
      source.emit('resync', {});
    });
    await vi.waitFor(() => {
      expect(api.calls(THREAD)).toHaveLength(threads + 1);
      expect(api.calls(LIST)).toHaveLength(lists + 1);
    });
    expect(client.getQueryState(threadKey(OTHER))?.isInvalidated).toBe(true);
    await settle();

    // An error (the browser retries by itself), then `open`: the same full refetch, connected again.
    act(() => {
      source.fail(false);
    });
    expect(connected()).toBe('false');
    lists = api.calls(LIST).length;
    threads = api.calls(THREAD).length;
    openStream();
    expect(connected()).toBe('true');
    await vi.waitFor(() => {
      expect(api.calls(THREAD)).toHaveLength(threads + 1);
      expect(api.calls(LIST)).toHaveLength(lists + 1);
    });
    expect(ES.instances).toEqual([source]);

    // Refused (CLOSED: EventSource never retries): /me is re-checked and a new stream opens after
    // 5 s, 10 s, 20 s, … at most 5 min, while still logged in.
    let latest = source;
    for (const seconds of [5, 10, 20, 40, 80, 160, 300, 300]) {
      const meCalls = api.calls('GET /me').length;
      const count = ES.instances.length;
      act(() => {
        latest.fail(true);
      });
      expect(connected()).toBe('false');
      await vi.waitFor(() => {
        expect(api.calls('GET /me')).toHaveLength(meCalls + 1);
      });
      await act(() => vi.advanceTimersByTimeAsync(seconds * 1000 - 500));
      expect(ES.instances).toHaveLength(count);
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(ES.instances).toHaveLength(count + 1);
      expect(ES.live()).toHaveLength(1);
      latest = ES.latest();
    }

    // An open resets the backoff to 5 s.
    openStream();
    act(() => {
      latest.fail(true);
    });
    let count = ES.instances.length;
    await act(() => vi.advanceTimersByTimeAsync(5500));
    expect(ES.instances).toHaveLength(count + 1);
    latest = openStream();

    // Logging out closes the stream and none is reopened.
    fireEvent.click(screen.getByRole('button', { name: he.header.logout }));
    expect(await screen.findByRole('link', { name: he.header.login })).toBeVisible();
    expect(latest.readyState).toBe(ES.CLOSED);
    expect(ES.live()).toHaveLength(0);
    count = ES.instances.length;
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(ES.instances).toHaveLength(count);
    view.unmount();
    vi.unstubAllGlobals();

    // A pending reopen is cancelled when the session ends.
    const again = mockApi({ 'GET /me': [() => json(seeker)], [LIST]: [() => json([])] });
    const second = testQueryClient();
    renderRoutes('/', chatRoutes, second);
    expect(await screen.findByRole('link', { name: he.header.chat })).toBeVisible();
    count = ES.instances.length;
    act(() => {
      ES.latest().fail(true);
    });
    // The /me re-check answers (still logged in) before the session ends.
    await vi.waitFor(() => {
      expect(again.calls('GET /me')).toHaveLength(2);
    });
    await settle();
    act(() => {
      clearSession(second);
    });
    expect(await screen.findByRole('link', { name: he.header.login })).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(ES.instances).toHaveLength(count);
    expect(ES.live()).toHaveLength(0);
  });
});
