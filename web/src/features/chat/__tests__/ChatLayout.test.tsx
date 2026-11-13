import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
import { seeker } from '../../listings/__tests__/fixtures';
import type { ConversationOut, ThreadOut } from '../api';
import { conversation, message, thread } from './fixtures';
import { chatRoutes, openStream, settle } from './harness';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Reply = Parameters<typeof mockApi>[0][string][number];

const LIST = 'GET /me/conversations';
const FLATS = 'GET /me/flats';
const threadRoute = (id: string) => `GET /conversations/${id}`;
const postRoute = (id: string) => `POST /conversations/${id}/messages`;
const NOT_FOUND = () => json({ detail: 'not_found' }, 404);

/**
 * "Desktop": `matchMedia` reports `(min-width: 1024px)` as `matches` (every other query false);
 * `set()` flips it and fires `change`. Without it (jsdom has none) the layout is the phone's.
 */
function stubDesktop(initial = true) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query === '(min-width: 1024px)' && matches;
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  return {
    set(next: boolean) {
      matches = next;
      act(() => {
        for (const listener of listeners) listener();
      });
    },
  };
}

function renderChat(path: string, routes: Record<string, Reply[]>) {
  const api = mockApi({ 'GET /me': [() => json(seeker)], [FLATS]: [() => json([])], ...routes });
  const client = testQueryClient();
  const view = renderRoutes(path, chatRoutes, client);
  return { api, view, client };
}

/** The pair a desktop `/chat/:id` shows: a chat in the list and its thread. */
function pair(name: string, overrides: Partial<ThreadOut> = {}) {
  const c = conversation({ other_name: name });
  const t = thread({
    id: c.id,
    other_name: name,
    messages: [message({ body: 'hello' })],
    ...overrides,
  });
  return { c, t };
}

const h1 = (name: string) => screen.findByRole('heading', { level: 1, name });
const pane = () => screen.getByRole('region', { name: he.chat.list.title });
const rowLink = (c: ConversationOut) =>
  screen.queryByRole('link', { name: new RegExp(c.other_name) });
const paneHeading2 = () => screen.queryByRole('heading', { level: 2, name: he.chat.list.title });
const textarea = () => screen.getByRole('textbox', { name: he.chat.composer.label });
const sendButton = () => screen.getByRole('button', { name: he.chat.composer.send });
const conversationGets = (api: ReturnType<typeof mockApi>) =>
  api.fetchMock.mock.calls
    .map(([request]) => new URL(request.url).pathname)
    .filter((path) => path.startsWith('/conversations/'));

const XSS = '<img src=x onerror="alert(1)"><b>b</b>';

describe('ChatLayout', () => {
  it('ac1_resize_swaps_layout', async () => {
    const media = stubDesktop(true);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const X = pair('נועה');
    renderChat(`/chat/${X.c.id}`, {
      [LIST]: [() => json([X.c])],
      [threadRoute(X.c.id)]: [() => json(X.t)],
    });
    expect(await h1('נועה')).toBeVisible();
    expect(
      await screen.findByRole('heading', { level: 2, name: he.chat.list.title }),
    ).toBeVisible();
    expect(rowLink(X.c)).not.toBeNull();

    // Narrower than lg: the phone's thread page, the same URL.
    media.set(false);
    await waitFor(() => expect(paneHeading2()).toBeNull());
    expect(rowLink(X.c)).toBeNull();
    expect(await h1('נועה')).toBeVisible();
    expect(currentPath()).toBe(`/chat/${X.c.id}`);

    // And back: the pane again.
    media.set(true);
    expect(
      await screen.findByRole('heading', { level: 2, name: he.chat.list.title }),
    ).toBeVisible();
    expect(await screen.findByRole('link', { name: /נועה/ })).toBeVisible();
    expect(await h1('נועה')).toBeVisible();
    expect(errors).not.toHaveBeenCalled();
  });

  it('ac2_phone_unchanged', async () => {
    const X = pair('נועה');
    const Y = pair('יעל');
    let { view } = renderChat(`/chat/${X.c.id}`, {
      [LIST]: [() => json([X.c, Y.c])],
      [threadRoute(X.c.id)]: [() => json(X.t)],
    });
    // The thread alone: no row links, no list heading; the <h1> is the name.
    expect(await h1('נועה')).toBeVisible();
    await settle();
    expect(rowLink(X.c)).toBeNull();
    expect(rowLink(Y.c)).toBeNull();
    expect(paneHeading2()).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    view.unmount();
    vi.unstubAllGlobals();

    // The list page: its <h1> and the rows.
    ({ view } = renderChat('/chat', { [LIST]: [() => json([X.c, Y.c])] }));
    expect(await h1(he.chat.list.title)).toBeVisible();
    expect(await screen.findByRole('link', { name: /נועה/ })).toHaveAttribute(
      'href',
      `/chat/${X.c.id}`,
    );
    expect(screen.getByRole('link', { name: /יעל/ })).toHaveAttribute('href', `/chat/${Y.c.id}`);
    expect(screen.queryByText(he.chat.pickOne)).toBeNull();
    view.unmount();
  });

  it('ac3_two_panes_switch_without_remount', async () => {
    stubDesktop();
    const members: ThreadOut['members'] = [
      { name: 'רוני', photo_url: null, role: 'owner', is_me: false },
      { name: 'דנה', photo_url: null, role: 'flatmate', is_me: true },
      { name: 'נועה', photo_url: null, role: 'seeker', is_me: false },
    ];
    const X = pair('נועה', { members, my_role: 'flatmate' });
    const Y = pair('יעל');
    renderChat(`/chat/${X.c.id}`, {
      [LIST]: [() => json([X.c, Y.c])],
      [threadRoute(X.c.id)]: [() => json(X.t)],
      [threadRoute(Y.c.id)]: [() => json(Y.t)],
    });
    expect(await h1('נועה')).toBeVisible();
    expect(
      await screen.findByRole('heading', { level: 2, name: he.chat.list.title }),
    ).toBeVisible();
    const section = pane();
    const links = await within(section).findAllByRole('link');
    expect(links).toHaveLength(2);
    const [xLink, yLink] = links as [HTMLElement, HTMLElement];
    expect(xLink).toHaveAttribute('href', `/chat/${X.c.id}`);
    expect(xLink).toHaveAttribute('aria-current', 'page');
    expect(yLink).not.toHaveAttribute('aria-current');
    // The open row's card is the selected variant.
    expect(xLink.closest('li')).toHaveClass('border-accent');
    expect(yLink.closest('li')).not.toHaveClass('border-accent');
    expect(yLink.closest('li')).toHaveClass('border-border');

    // The thread is the page's main content: its <h1>, its log, one note, one member line, and
    // the composer's textbox only.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('log', { name: he.chat.thread.log })).toBeInTheDocument();
    expect(screen.getAllByRole('note')).toHaveLength(1);
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(screen.getAllByRole('textbox')).toEqual([textarea()]);
    await waitFor(() => {
      expect(document.title).toBe(i18n.t('app.pageTitle', { page: 'נועה', app: he.app.title }));
    });

    // Y: its thread beside the same pane, the mark moved.
    fireEvent.click(yLink);
    expect(await h1('יעל')).toBeVisible();
    expect(currentPath()).toBe(`/chat/${Y.c.id}`);
    expect(section.isConnected).toBe(true);
    expect(pane()).toBe(section);
    expect(yLink.isConnected).toBe(true);
    expect(yLink).toHaveAttribute('aria-current', 'page');
    expect(xLink).not.toHaveAttribute('aria-current');
    expect(yLink.closest('li')).toHaveClass('border-accent');
    expect(screen.queryByRole('group')).toBeNull();
    await waitFor(() => {
      expect(document.title).toBe(i18n.t('app.pageTitle', { page: 'יעל', app: he.app.title }));
    });
  });

  it('ac4_list_page_and_pick_one', async () => {
    stubDesktop();
    const X = pair('נועה');
    const Y = pair('יעל');

    // Two chats: the list's <h1>, the rows, none marked open, the panel; no thread requested.
    let { api, view } = renderChat('/chat', { [LIST]: [() => json([X.c, Y.c])] });
    expect(await h1(he.chat.list.title)).toBeVisible();
    expect(await screen.findByText(he.chat.pickOne)).toBeVisible();
    const links = within(pane()).getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    await waitFor(() => {
      expect(document.title).toBe(
        i18n.t('app.pageTitle', { page: he.chat.list.title, app: he.app.title }),
      );
    });
    await settle();
    expect(conversationGets(api)).toEqual([]);
    view.unmount();
    vi.unstubAllGlobals();

    // No chats: the empty state alone, without the panel.
    stubDesktop();
    ({ api, view } = renderChat('/chat', { [LIST]: [() => json([])] }));
    expect(await screen.findByText(he.chat.list.empty)).toBeVisible();
    await settle();
    expect(screen.queryByText(he.chat.pickOne)).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    view.unmount();
    vi.unstubAllGlobals();

    // After a join, while the list loads: the line shows, and stays (the same node) when the list
    // arrives and the page becomes two panes.
    stubDesktop();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));
    const list = deferred();
    mockApi({
      'GET /me': [() => json(seeker)],
      [LIST]: [list.promise, () => json([X.c, Y.c])],
      [FLATS]: [() => json([])],
    });
    view = renderRoutes({ pathname: '/chat', state: { joined: true } }, chatRoutes);
    const line = await screen.findByText(he.flatmates.join.done);
    expect(line).toBeVisible();
    expect(line).toHaveAttribute('role', 'status');
    expect(screen.queryByText(he.chat.pickOne)).toBeNull();
    list.resolve(json([X.c, Y.c]));
    expect(await screen.findByText(he.chat.pickOne)).toBeVisible();
    expect(screen.getByText(he.flatmates.join.done)).toBe(line);
    expect(line.isConnected).toBe(true);
    view.unmount();
  });

  it('ac5_stream_refetches_unchanged', async () => {
    stubDesktop();
    const X = pair('נועה');
    const Y = pair('יעל');
    const first = deferred();
    const { api } = renderChat(`/chat/${X.c.id}`, {
      [LIST]: [() => json([X.c, Y.c])],
      [threadRoute(X.c.id)]: [first.promise, () => json(X.t)],
      [threadRoute(Y.c.id)]: [() => json(Y.t)],
    });
    // The list first, then the thread's answer: no list fetch in flight to restart.
    expect(await screen.findByRole('link', { name: /יעל/ })).toBeVisible();
    first.resolve(json(X.t));
    expect(await h1('נועה')).toBeVisible();
    await settle();
    expect(api.calls(LIST)).toHaveLength(1);
    expect(api.calls(threadRoute(X.c.id))).toHaveLength(1);
    expect(api.calls(FLATS)).toHaveLength(1);

    // A `chat` event for X: the thread, then the list, once each.
    const source = openStream();
    await settle();
    expect(api.calls(LIST)).toHaveLength(1);
    act(() => {
      source.emit('chat', { conversation_id: X.c.id, kind: 'message' });
    });
    await waitFor(() => {
      expect(api.calls(LIST)).toHaveLength(2);
    });
    await settle();
    expect(api.calls(threadRoute(X.c.id))).toHaveLength(2);
    expect(api.calls(LIST)).toHaveLength(2);
    expect(api.calls(FLATS)).toHaveLength(1);

    // `resync`: the open thread and the list, once each.
    act(() => {
      source.emit('resync', {});
    });
    await waitFor(() => {
      expect(api.calls(LIST)).toHaveLength(3);
    });
    await settle();
    expect(api.calls(threadRoute(X.c.id))).toHaveLength(3);
    expect(api.calls(LIST)).toHaveLength(3);

    // Switching to Y: its thread only; the list stays mounted and is not asked again.
    fireEvent.click(screen.getByRole('link', { name: /יעל/ }));
    expect(await h1('יעל')).toBeVisible();
    await settle();
    expect(api.calls(threadRoute(Y.c.id))).toHaveLength(1);
    expect(api.calls(LIST)).toHaveLength(3);
    expect(api.calls(FLATS)).toHaveLength(1);
  });

  it('ac6_removed_refreshes_list', async () => {
    // Desktop: the send's 404 and the refetch's 404 show "removed"; the list is asked once more
    // and drops the chat.
    stubDesktop();
    const X = pair('נועה');
    const Y = pair('יעל');
    // The thread answers after the list (as in ac5), so no list fetch is restarted.
    let first = deferred();
    let { api, view } = renderChat(`/chat/${X.c.id}`, {
      [LIST]: [json([X.c, Y.c]), () => json([Y.c])],
      [threadRoute(X.c.id)]: [first.promise, NOT_FOUND],
      [postRoute(X.c.id)]: [NOT_FOUND],
    });
    expect(await screen.findByRole('link', { name: /נועה/ })).toBeVisible();
    first.resolve(json(X.t));
    expect(await h1('נועה')).toBeVisible();
    await settle();
    expect(api.calls(LIST)).toHaveLength(1);
    fireEvent.change(textarea(), { target: { value: 'hi' } });
    fireEvent.click(sendButton());
    const removed = await h1(he.chat.removed);
    expect(removed).toHaveFocus();
    await waitFor(() => {
      expect(rowLink(X.c)).toBeNull();
    });
    expect(api.calls(LIST)).toHaveLength(2);
    expect(screen.getByRole('link', { name: /יעל/ })).toBeVisible();
    expect(screen.getByRole('link', { name: he.chat.thread.back })).toHaveAttribute(
      'href',
      '/chat',
    );
    await settle();
    expect(api.calls(LIST)).toHaveLength(2);
    view.unmount();
    vi.unstubAllGlobals();

    // Phone: the same refetch (the header's list).
    first = deferred();
    const listed = deferred();
    ({ api, view } = renderChat(`/chat/${X.c.id}`, {
      [LIST]: [listed.promise, () => json([Y.c])],
      [threadRoute(X.c.id)]: [first.promise, NOT_FOUND],
      [postRoute(X.c.id)]: [NOT_FOUND],
    }));
    listed.resolve(json([X.c, Y.c]));
    await settle();
    first.resolve(json(X.t));
    expect(await h1('נועה')).toBeVisible();
    await settle();
    expect(api.calls(LIST)).toHaveLength(1);
    fireEvent.change(textarea(), { target: { value: 'hi' } });
    fireEvent.click(sendButton());
    expect(await h1(he.chat.removed)).toHaveFocus();
    await waitFor(() => {
      expect(api.calls(LIST)).toHaveLength(2);
    });
    await settle();
    expect(api.calls(LIST)).toHaveLength(2);
    view.unmount();
  });

  it('ac7_bodies_render_as_text', async () => {
    const members: ThreadOut['members'] = [
      { name: XSS, photo_url: null, role: 'owner', is_me: false },
      { name: 'דנה', photo_url: null, role: 'flatmate', is_me: true },
      { name: 'נועה', photo_url: null, role: 'seeker', is_me: false },
    ];
    const c = conversation({
      other_name: XSS,
      last_message: { body: XSS, mine: false, created_at: '2026-11-10T10:00:00Z' },
    });
    const t = thread({
      id: c.id,
      other_name: XSS,
      my_role: 'flatmate',
      members,
      messages: [message({ body: XSS, sender_name: XSS })],
    });
    const routes = { [LIST]: [() => json([c])], [threadRoute(c.id)]: [() => json(t)] };

    function expectRowIsText(row: HTMLElement) {
      expect(row.querySelector('img, b')).toBeNull();
      const preview = within(row).getByTestId('last-message');
      expect(preview.textContent).toBe(XSS);
      expect(preview).toHaveAttribute('dir', 'auto');
      const name = within(row).getByText(XSS, { selector: '[dir="auto"]:not([data-testid])' });
      expect(name.textContent).toBe(XSS);
    }
    function expectThreadIsText(heading: HTMLElement) {
      const threadSection = heading.closest('section') as HTMLElement;
      expect(threadSection.querySelector('img, b')).toBeNull();
      expect(heading.textContent).toBe(XSS);
      expect(heading.querySelector('[dir="auto"]')?.textContent).toBe(XSS);
      const body = within(threadSection).getByTestId('message-body');
      expect(body.textContent).toBe(XSS);
      expect(body).toHaveAttribute('dir', 'auto');
      const sender = within(threadSection).getByTestId('sender-name');
      expect(sender.textContent).toBe(XSS);
      expect(sender).toHaveAttribute('dir', 'auto');
      expect(within(threadSection).getByRole('group').querySelector('img, b')).toBeNull();
    }

    // Desktop: the row and the thread side by side.
    stubDesktop();
    let { view } = renderChat(`/chat/${c.id}`, routes);
    let heading = await screen.findByRole('heading', { level: 1 });
    await screen.findByTestId('message-body');
    const row = (await within(pane()).findAllByRole('link'))[0] as HTMLElement;
    expectRowIsText(row);
    heading = screen.getByRole('heading', { level: 1 });
    expectThreadIsText(heading);
    view.unmount();
    vi.unstubAllGlobals();

    // Phone: the list page, then the thread page.
    ({ view } = renderChat('/chat', routes));
    await h1(he.chat.list.title);
    expectRowIsText(await screen.findByRole('link', { name: /onerror/ }));
    view.unmount();
    vi.unstubAllGlobals();
    renderChat(`/chat/${c.id}`, routes);
    await screen.findByTestId('message-body');
    expectThreadIsText(screen.getByRole('heading', { level: 1 }));

    // Statically: no HTML injection in the chat's source or in ClampedText.
    const needle = ['dangerously', 'Set', 'Inner', 'HTML'].join('');
    const src = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walk(path);
        return path.endsWith('.tsx') ? [path] : [];
      });
    const files = [
      ...walk(join(src, 'features', 'chat')),
      join(src, 'components', 'ClampedText.tsx'),
    ];
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      expect(readFileSync(file, 'utf8').includes(needle), file).toBe(false);
    }
  });
});
