import { focusManager, onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
import { owner, seeker } from '../../listings/__tests__/fixtures';
import type { ConversationOut, MessageOut, ThreadOut } from '../api';
import { readDraft, writeDraft } from '../../../app/drafts';
import { CONVERSATIONS_KEY } from '../useConversations';
import { conversation, message, thread } from './fixtures';
import { chatRoutes, connected, ES, openStream, settle } from './harness';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
});

type Reply = Parameters<typeof mockApi>[0][string][number];

const LIST = 'GET /me/conversations';
const NAME = 'מיכל';
const threadRoute = (t: ThreadOut) => `GET /conversations/${t.id}`;
const postRoute = (t: ThreadOut) => `POST /conversations/${t.id}/messages`;

/** `me` on `/chat/{t.id}` inside the app's layout; the header's list answers `list`. */
function renderThread(
  t: ThreadOut,
  replies: Reply[],
  {
    me = seeker,
    list = [() => json([])],
    extra = {},
    path = `/chat/${t.id}`,
  }: {
    me?: typeof seeker;
    list?: Reply[];
    extra?: Record<string, Reply[]>;
    path?: string;
  } = {},
) {
  const api = mockApi({
    'GET /me': [() => json(me)],
    [LIST]: list,
    [threadRoute(t)]: replies,
    ...extra,
  });
  const client = testQueryClient();
  const view = renderRoutes(path, chatRoutes, client);
  return { api, view, client };
}

function reset(view: { unmount: () => void }) {
  view.unmount();
  vi.unstubAllGlobals();
}

const h1 = (name: string) => screen.findByRole('heading', { level: 1, name });
const log = () => screen.getByRole('log', { name: he.chat.thread.log });
const bubbles = () => within(log()).getAllByRole('listitem');
const textarea = () => screen.getByRole('textbox', { name: he.chat.composer.label });
const sendButton = () => screen.getByRole('button', { name: he.chat.composer.send });
const sent = (body: string): MessageOut =>
  message({ body, mine: true, created_at: new Date().toISOString() });
const withMessages = (t: ThreadOut, ...messages: MessageOut[]): ThreadOut => ({
  ...t,
  messages: [...t.messages, ...messages],
});

describe('ChatThreadPage', () => {
  it('ac4_thread_renders_plain_text', async () => {
    // A seeker: the name, the listing link, the warning and the three messages oldest first.
    const first = message({ body: 'first' });
    const second = message({ body: 'second', mine: true });
    const third = message({ body: 'third' });
    const T = thread({ other_name: NAME, messages: [first, second, third] });
    let { view } = renderThread(T, [json(T)]);
    expect(await h1(NAME)).toBeVisible();
    expect(screen.getByRole('link', { name: he.chat.thread.back })).toHaveAttribute(
      'href',
      '/chat',
    );
    expect(screen.getByRole('link', { name: he.chat.thread.toListing })).toHaveAttribute(
      'href',
      `/listings/${T.listing.id}`,
    );
    expect(screen.queryByRole('link', { name: he.chat.thread.toApplicants })).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent(he.chat.thread.warning);
    const items = bubbles();
    expect(items).toHaveLength(3);
    expect(items.map((li) => within(li).getByTestId('message-body').textContent)).toEqual([
      'first',
      'second',
      'third',
    ]);
    const theirs = i18n.t('chat.thread.theirs', { name: NAME });
    expect(items[0]).toHaveTextContent(theirs);
    expect(items[0]).toHaveClass('self-start');
    expect(items[1]).toHaveTextContent(he.chat.thread.mine);
    expect(items[1]).toHaveClass('self-end');
    expect(items[2]).toHaveTextContent(theirs);
    expect(items[2]).toHaveClass('self-start');
    expect(items[1]?.querySelector('time')).toHaveAttribute('datetime', second.created_at);
    expect(screen.queryByText(he.chat.thread.truncated)).toBeNull();
    reset(view);

    // An owner: the link goes to the listing's applicants (chosen by the thread's `my_role`).
    const asOwner = { ...T, my_role: 'owner' as const };
    ({ view } = renderThread(asOwner, [json(asOwner)], { me: owner }));
    expect(await h1(NAME)).toBeVisible();
    expect(screen.getByRole('link', { name: he.chat.thread.toApplicants })).toHaveAttribute(
      'href',
      `/me/listings/${T.listing.id}/applicants`,
    );
    expect(screen.queryByRole('link', { name: he.chat.thread.toListing })).toBeNull();
    reset(view);

    // A body is plain text: never HTML, never a link.
    const raw = '<b>x</b> https://example.com\nline2';
    const html = thread({ messages: [message({ body: raw })] });
    ({ view } = renderThread(html, [json(html)]));
    expect(await h1(html.other_name)).toBeVisible();
    const body = within(log()).getByTestId('message-body');
    expect(body.textContent).toBe(raw);
    expect(body).toHaveAttribute('dir', 'auto');
    expect(log().querySelector('a')).toBeNull();
    expect(log().querySelector('b')).toBeNull();
    reset(view);

    // No messages: the empty line, and the warning still; the log is mounted, empty (spec 0009t).
    const none = thread();
    ({ view } = renderThread(none, [json(none)]));
    expect(await screen.findByText(he.chat.thread.empty)).toBeVisible();
    expect(screen.getByRole('note')).toHaveTextContent(he.chat.thread.warning);
    expect(within(log()).queryAllByRole('listitem')).toHaveLength(0);
    reset(view);

    // Truncated: says only the newest 200 are shown.
    const long = thread({ truncated: true, messages: [message()] });
    renderThread(long, [json(long)]);
    expect(await screen.findByText(he.chat.thread.truncated)).toBeVisible();
  });

  it('ac5_refetch_on_event_and_marks_read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const T = thread({ messages: [message({ body: 'one' }), message({ body: 'two' })] });
    const listed = conversation({ id: T.id, unread_count: 2, is_new: true });
    const read = { ...listed, unread_count: 0, is_new: false };
    const first = deferred();
    const replies: { thread: () => Response } = { thread: () => json(T) };
    const { api, client, view } = renderThread(T, [first.promise, () => replies.thread()], {
      list: [json([listed]), () => json([read])],
      extra: { [postRoute(T)]: [() => json(sent('hi'), 201)] },
    });
    const item = () =>
      client.getQueryData<ConversationOut[]>(CONVERSATIONS_KEY)?.find((c) => c.id === T.id);

    // The header counts the chat until its thread has loaded …
    expect(
      await screen.findByRole('link', {
        name: new RegExp(i18n.t('header.chatNew', { count: 1 })),
      }),
    ).toBeVisible();
    expect(item()).toMatchObject({ unread_count: 2, is_new: true });

    // … then it is read, without asking for the list again.
    first.resolve(json(T));
    expect(await h1(T.other_name)).toBeVisible();
    expect(item()).toMatchObject({ unread_count: 0, is_new: false });
    expect(screen.getByRole('link', { name: he.header.chat })).toBeVisible();
    expect(api.calls(LIST)).toHaveLength(1);

    // It stays read after the caller sends a message.
    replies.thread = () => json(withMessages(T, sent('hi')));
    fireEvent.change(textarea(), { target: { value: 'hi' } });
    fireEvent.click(sendButton());
    expect(await within(log()).findByText('hi')).toBeVisible();
    await settle();
    expect(item()).toMatchObject({ unread_count: 0, is_new: false });

    // Stream connected: an event for this chat refetches it once; the new message shows; no
    // polling while connected.
    const source = openStream();
    expect(connected()).toBe('true');
    await settle();
    const withThree = withMessages(T, sent('hi'), message({ body: 'three' }));
    replies.thread = () => json(withThree);
    let gets = api.calls(threadRoute(T)).length;
    act(() => {
      source.emit('chat', { conversation_id: T.id, kind: 'message' });
    });
    expect(await within(log()).findByText('three')).toBeVisible();
    expect(api.calls(threadRoute(T))).toHaveLength(gets + 1);
    gets += 1;
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(api.calls(threadRoute(T))).toHaveLength(gets);

    // Stream down: a fallback poll after 15 s. Its 500 keeps the messages and shows no error.
    act(() => {
      source.fail(false);
    });
    replies.thread = () => json({ detail: 'boom' }, 500);
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    await vi.waitFor(() => {
      expect(api.calls(threadRoute(T))).toHaveLength(gets + 1);
    });
    await settle();
    expect(bubbles()).toHaveLength(4);
    expect(within(log()).getByText('three')).toBeVisible();
    expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
    expect(screen.queryByText(he.common.error)).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // A list request still in flight when the thread's GET marks the chat read (its answer may
    // predate that) is restarted: its stale count never lands.
    const R = thread({ messages: [message()] });
    const unreadR = conversation({ id: R.id, unread_count: 2, is_new: true });
    const staleList = deferred();
    let race = renderThread(R, [() => json(R)], {
      list: [staleList.promise, () => json([{ ...unreadR, unread_count: 0, is_new: false }])],
    });
    expect(await h1(R.other_name)).toBeVisible();
    await vi.waitFor(() => {
      expect(race.api.calls(LIST)).toHaveLength(2);
    });
    staleList.resolve(json([unreadR]));
    await settle();
    expect(
      race.client.getQueryData<ConversationOut[]>(CONVERSATIONS_KEY)?.find((c) => c.id === R.id),
    ).toMatchObject({ unread_count: 0, is_new: false });
    expect(screen.getByRole('link', { name: he.header.chat })).toBeVisible();
    reset(race.view);

    // An uppercase id: the canonical (lowercase) URL and cache key, so the stream's event for the
    // chat (which names the canonical id) refetches it.
    const U = thread({ messages: [message({ body: 'before' })] });
    const upper = { thread: () => json(U) };
    race = renderThread(U, [() => upper.thread()], { path: `/chat/${U.id.toUpperCase()}` });
    expect(await h1(U.other_name)).toBeVisible();
    expect(currentPath()).toBe(`/chat/${U.id}`);
    const stream = openStream();
    await settle();
    upper.thread = () => json(withMessages(U, message({ body: 'after' })));
    act(() => {
      stream.emit('chat', { conversation_id: U.id, kind: 'message' });
    });
    expect(await within(log()).findByText('after')).toBeVisible();
  });

  it('ac6_send_and_viewing_chip', async () => {
    let T = thread({ messages: [message({ body: 'hello' })] });
    let post = deferred();
    let hi = sent('hi');
    const refetch = deferred();
    let { api, view } = renderThread(T, [json(T), refetch.promise], {
      extra: { [postRoute(T)]: [post.promise] },
    });
    expect(await h1(T.other_name)).toBeVisible();

    // Empty or blank: nothing to send.
    expect(sendButton()).toBeDisabled();
    fireEvent.change(textarea(), { target: { value: '  \n ' } });
    expect(sendButton()).toBeDisabled();

    // "hi": one POST, even on a double click; busy while pending.
    fireEvent.change(textarea(), { target: { value: 'hi' } });
    expect(sendButton()).toBeEnabled();
    fireEvent.click(sendButton());
    fireEvent.click(sendButton());
    const busy = await screen.findByRole('button', { name: he.chat.composer.sending });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(api.calls(postRoute(T))).toHaveLength(1);
    expect(api.calls(postRoute(T))[0]?.body).toEqual({ body: 'hi' });

    // Sent: the bubble at once (before the refetch answers), the textarea empty and focused.
    post.resolve(json(hi, 201));
    expect(await within(log()).findByText('hi')).toBeVisible();
    expect(textarea()).toHaveValue('');
    expect(textarea()).toHaveFocus();
    expect(sendButton()).toBeDisabled();
    await vi.waitFor(() => {
      expect(api.calls(threadRoute(T))).toHaveLength(2);
    });
    refetch.resolve(json(withMessages(T, hi)));
    await settle();
    expect(within(log()).getAllByText('hi')).toHaveLength(1);
    expect(api.calls(postRoute(T))).toHaveLength(1);
    reset(view);

    // A `chat` event's refetch starts while the POST is pending and would answer without the new
    // message: it is restarted after the POST, and the bubble is there exactly once.
    T = thread({ messages: [message({ body: 'hello' })] });
    post = deferred();
    hi = sent('hi');
    const stale = deferred();
    ({ api, view } = renderThread(T, [json(T), stale.promise, () => json(withMessages(T, hi))], {
      extra: { [postRoute(T)]: [post.promise] },
    }));
    expect(await h1(T.other_name)).toBeVisible();
    const source = openStream();
    fireEvent.change(textarea(), { target: { value: 'hi' } });
    fireEvent.click(sendButton());
    act(() => {
      source.emit('chat', { conversation_id: T.id, kind: 'message' });
    });
    await vi.waitFor(() => {
      expect(api.calls(threadRoute(T))).toHaveLength(2);
    });
    post.resolve(json(hi, 201));
    expect(await within(log()).findByText('hi')).toBeVisible();
    await vi.waitFor(() => {
      expect(api.calls(threadRoute(T))).toHaveLength(3);
    });
    stale.resolve(json(T));
    await settle();
    expect(within(log()).getAllByText('hi')).toHaveLength(1);
    expect(bubbles()).toHaveLength(2);

    // The viewing chip: the template into an empty textarea, on a new line after text.
    const template = he.chat.composer.viewingTemplate;
    const chip = screen.getByRole('button', { name: he.chat.composer.viewing });
    fireEvent.click(chip);
    expect(textarea()).toHaveValue(template);
    expect(textarea()).toHaveFocus();
    fireEvent.change(textarea(), { target: { value: 'hi' } });
    fireEvent.click(chip);
    expect(textarea()).toHaveValue(`hi\n${template}`);
    expect(textarea()).toHaveFocus();
  });

  it('ac3_composer_remaining_forms', async () => {
    const T = thread({ messages: [message({ body: 'hello' })] });
    const { view } = renderThread(T, [json(T)]);
    expect(await h1(T.other_name)).toBeVisible();
    // The API's limit is 2000 characters.
    fireEvent.change(textarea(), { target: { value: 'a'.repeat(1999) } });
    expect(
      screen.getByText('\u05e0\u05d5\u05ea\u05e8 \u05ea\u05d5 \u05d0\u05d7\u05d3'),
    ).toBeVisible();
    fireEvent.change(textarea(), { target: { value: 'a'.repeat(2000) } });
    expect(
      screen.getByText(
        '\u05dc\u05d0 \u05e0\u05d5\u05ea\u05e8\u05d5 \u05ea\u05d5\u05d5\u05d9\u05dd',
      ),
    ).toBeVisible();
    reset(view);
  });

  it('ac7_send_errors', async () => {
    const T = thread({ messages: [message({ body: 'hello' })] });

    // 409 `chat_closed`: the thread is refetched and, closed now, the note replaces the composer.
    let { api, view } = renderThread(T, [json(T), () => json({ ...T, can_send: false })], {
      extra: { [postRoute(T)]: [json({ detail: 'chat_closed' }, 409)] },
    });
    expect(await h1(T.other_name)).toBeVisible();
    fireEvent.change(textarea(), { target: { value: 'hi' } });
    fireEvent.click(sendButton());
    expect(await screen.findByText(he.chat.thread.closed)).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(api.calls(threadRoute(T))).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
    reset(view);

    // 429, 422, 500: an alert, the text kept.
    for (const [reply, text] of [
      [json({ detail: 'rate_limited' }, 429), he.chat.errors.rateLimited],
      [json({ detail: [{ msg: 'bad' }] }, 422), he.chat.errors.invalid],
      [json({ detail: 'boom' }, 500), he.common.error],
    ] as const) {
      ({ view } = renderThread(T, [() => json(T)], { extra: { [postRoute(T)]: [reply] } }));
      expect(await h1(T.other_name)).toBeVisible();
      fireEvent.change(textarea(), { target: { value: 'hi' } });
      fireEvent.click(sendButton());
      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      expect(textarea()).toHaveValue('hi');
      expect(sendButton()).toBeEnabled();
      reset(view);
    }

    // Offline: the send is not paused until the browser is back; it fails at once, text kept.
    ({ view } = renderThread(T, [() => json(T)], { extra: { [postRoute(T)]: [networkError] } }));
    expect(await h1(T.other_name)).toBeVisible();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      onlineManager.setOnline(false);
    });
    fireEvent.change(textarea(), { target: { value: 'hi' } });
    fireEvent.click(sendButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(he.common.error);
    expect(textarea()).toHaveValue('hi');
    expect(textarea()).not.toHaveAttribute('readonly');
    expect(sendButton()).toBeEnabled();
    reset(view);
    vi.restoreAllMocks();
    onlineManager.setOnline(true);

    // 401 on the POST: the session is gone; to /login, and the sent text is not kept in the
    // mutation cache (the composer's draft is, spec 0009g).
    const expired = renderThread(T, [() => json(T)], {
      extra: { [postRoute(T)]: [json({ detail: 'unauthenticated' }, 401)] },
    });
    view = expired.view;
    expect(await h1(T.other_name)).toBeVisible();
    fireEvent.change(textarea(), { target: { value: 'hi' } });
    fireEvent.click(sendButton());
    await vi.waitFor(() => {
      expect(currentPath()).toBe(`/login?next=${encodeURIComponent(`/chat/${T.id}`)}`);
    });
    expect(expired.client.getMutationCache().getAll()).toHaveLength(0);
    reset(view);

    // 401 on the thread's own GET: to /login, no further GET, the stream closed.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ({ api, view } = renderThread(T, [() => json({ detail: 'unauthenticated' }, 401)]));
    await vi.waitFor(() => {
      expect(currentPath()).toBe(`/login?next=${encodeURIComponent(`/chat/${T.id}`)}`);
    });
    expect(await screen.findByRole('link', { name: he.header.login })).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(api.calls(threadRoute(T))).toHaveLength(1);
    expect(ES.live()).toHaveLength(0);
    expect(ES.instances.length).toBeGreaterThan(0);
    reset(view);

    // 401 on a later poll (stream down): the same.
    ({ api, view } = renderThread(T, [json(T), () => json({ detail: 'unauthenticated' }, 401)]));
    expect(await h1(T.other_name)).toBeVisible();
    expect(ES.live()).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    await vi.waitFor(() => {
      expect(currentPath()).toBe(`/login?next=${encodeURIComponent(`/chat/${T.id}`)}`);
    });
    expect(await screen.findByRole('link', { name: he.header.login })).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(api.calls(threadRoute(T))).toHaveLength(2);
    expect(ES.live()).toHaveLength(0);
  });

  it('ac8_closed_thread', async () => {
    const T = thread({
      can_send: false,
      messages: [message({ body: 'a' }), message({ body: 'b' })],
    });
    renderThread(T, [json(T)]);
    expect(await h1(T.other_name)).toBeVisible();
    expect(bubbles()).toHaveLength(2);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: he.chat.composer.send })).toBeNull();
    expect(screen.getByText(he.chat.thread.closed)).toHaveAttribute('role', 'status');
  });

  it('ac3_page_title', async () => {
    // Loading: the app's name alone; loaded: the other person's name, as the <h1>.
    const t = thread();
    const pending = deferred();
    let { view } = renderThread(t, [pending.promise]);
    await screen.findByText(he.common.loading);
    expect(document.title).toBe(he.app.title);
    pending.resolve(json(t));
    await h1(NAME);
    expect(document.title).toBe(i18n.t('app.pageTitle', { page: NAME, app: he.app.title }));
    reset(view);

    // Not found: its <h1>.
    ({ view } = renderThread(t, [json({ detail: 'conversation_not_found' }, 404)]));
    await h1(he.chat.thread.notFound);
    expect(document.title).toBe(
      i18n.t('app.pageTitle', { page: he.chat.thread.notFound, app: he.app.title }),
    );
    reset(view);

    // A failed load is the whole page: ErrorState's <h1>, the only one.
    renderThread(t, [json({ detail: 'boom' }, 500)]);
    await screen.findByRole('button', { name: he.common.retry });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(he.common.error);
  });

  it('ac9_not_found', async () => {
    // A 404: not found, the back link, one GET only (no retry, no poll).
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const T = thread();
    let { api, view } = renderThread(T, [() => json({ detail: 'not_found' }, 404)]);
    expect(await h1(he.chat.thread.notFound)).toBeVisible();
    expect(screen.getByRole('link', { name: he.chat.thread.back })).toHaveAttribute(
      'href',
      '/chat',
    );
    // Past the 15 s fallback poll (the stream is not connected here).
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(api.calls(threadRoute(T))).toHaveLength(1);
    expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
    reset(view);

    // A 422 (an id the API cannot parse) is not found too, and stops the poll.
    ({ api, view } = renderThread(T, [() => json({ detail: [{ msg: 'bad uuid' }] }, 422)]));
    expect(await h1(he.chat.thread.notFound)).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(api.calls(threadRoute(T))).toHaveLength(1);
    reset(view);
    vi.useRealTimers();

    // A malformed id: not found at once, nothing requested, no composer.
    for (const path of ['/chat/..', '/chat/not-a-uuid', `/chat/${T.id}x`]) {
      ({ api, view } = renderThread(T, [() => json(T)], { path }));
      expect(await h1(he.chat.thread.notFound)).toBeVisible();
      await settle();
      expect(api.fetchMock.mock.calls.map(([r]) => new URL(r.url).pathname)).not.toContainEqual(
        expect.stringMatching(/^\/conversations\//),
      );
      expect(screen.queryByRole('textbox')).toBeNull();
      reset(view);
    }

    // A loaded thread whose POST and then refetch answer 404: not found replaces it.
    const loaded = thread({ messages: [message({ body: 'hello' })] });
    ({ api, view } = renderThread(
      loaded,
      [json(loaded), () => json({ detail: 'not_found' }, 404)],
      {
        extra: { [postRoute(loaded)]: [json({ detail: 'not_found' }, 404)] },
      },
    ));
    expect(await h1(loaded.other_name)).toBeVisible();
    fireEvent.change(textarea(), { target: { value: 'hi' } });
    fireEvent.click(sendButton());
    // (0008f amendment: a thread that was on screen shows `chat.removed`, not `notFound`.)
    expect(await screen.findByText(he.chat.removed)).toBeVisible();
    expect(screen.queryByRole('log')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.calls(threadRoute(loaded))).toHaveLength(2);
  });

  const GROUP_MEMBERS: ThreadOut['members'] = [
    { name: 'רוני', role: 'owner', is_me: false },
    { name: 'דנה', role: 'flatmate', is_me: true },
    { name: 'נועה', role: 'seeker', is_me: false },
  ];
  const group = (overrides: Partial<ThreadOut> = {}) =>
    thread({
      my_role: 'flatmate',
      other_name: 'נועה',
      members: GROUP_MEMBERS,
      visible_from: '2026-11-10T23:30:00Z',
      ...overrides,
    });
  const memberLine = () => screen.getByRole('group', { name: he.chat.members });
  const NOT_FOUND = () => json({ detail: 'not_found' }, 404);

  it('ac1_group_header_and_senders', async () => {
    const T = group({
      messages: [
        message({ body: 'one', sender_name: 'רוני' }),
        message({ body: 'two', sender_name: 'רוני' }),
        message({ body: 'mine', mine: true, sender_name: 'דנה' }),
        message({ body: 'three', sender_name: 'רוני' }),
        message({ body: 'four', sender_name: 'נועה' }),
      ],
    });
    // Owner-role account: the link must follow `my_role`, not the account's role.
    const { view } = renderThread(T, [() => json(T)], { me: owner });
    expect(await h1('נועה')).toBeVisible();
    expect(memberLine()).toHaveTextContent('רוני (בעל/ת הדירה) · את/ה · נועה');
    // Asia/Jerusalem: 23:30Z on the 10th is the 11th.
    expect(screen.getByText(i18n.t('chat.joinedNote', { date: '11.11.2026' }))).toBeVisible();

    const items = bubbles();
    // A name once per run of consecutive messages from one sender; never above my own.
    const named = items.map((li) => within(li).queryByTestId('sender-name')?.textContent ?? null);
    expect(named).toEqual(['רוני', null, null, 'רוני', 'נועה']);
    // The sr-only label names the sender.
    expect(items[1]).toHaveTextContent(i18n.t('chat.thread.theirs', { name: 'רוני' }));
    expect(items[4]).toHaveTextContent(i18n.t('chat.thread.theirs', { name: 'נועה' }));
    expect(screen.queryByRole('link', { name: he.chat.thread.toApplicants })).toBeNull();
    reset(view);
  });

  it('ac2_one_to_one_unchanged_and_owner_link', async () => {
    const T = thread({ messages: [message({ body: 'a' }), message({ body: 'b' })] });
    let { view } = renderThread(T, [() => json(T)]);
    expect(await h1(T.other_name)).toBeVisible();
    expect(screen.queryByRole('group', { name: he.chat.members })).toBeNull();
    expect(screen.queryByText(/הצטרפת לשיחה/)).toBeNull();
    expect(screen.queryAllByTestId('sender-name')).toHaveLength(0);
    reset(view);

    // An owner-role account that is a flatmate elsewhere: no applicants link.
    const asFlatmate = thread({ my_role: 'flatmate' });
    ({ view } = renderThread(asFlatmate, [() => json(asFlatmate)], { me: owner }));
    expect(await h1(asFlatmate.other_name)).toBeVisible();
    expect(screen.queryByRole('link', { name: he.chat.thread.toApplicants })).toBeNull();
    reset(view);

    // my_role owner: the applicants link, as today.
    const asOwner = thread({ my_role: 'owner' });
    ({ view } = renderThread(asOwner, [() => json(asOwner)], { me: owner }));
    expect(await h1(asOwner.other_name)).toBeVisible();
    expect(screen.getByRole('link', { name: he.chat.thread.toApplicants })).toHaveAttribute(
      'href',
      `/me/listings/${asOwner.listing.id}/applicants`,
    );
    reset(view);
  });

  it('ac6_focus_refetch_and_removed', async () => {
    const focus = async () => {
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
    };
    const yael: ThreadOut['members'][number] = { name: 'יעל', role: 'flatmate', is_me: false };
    const T = group({
      members: [...GROUP_MEMBERS.slice(0, 2), yael, ...GROUP_MEMBERS.slice(2)],
      messages: [message({ body: 'hello', sender_name: 'רוני' })],
    });
    const fewer = { ...T, members: GROUP_MEMBERS };

    // Focus: the thread is fetched again and the member line shows the new members.
    let { api, view } = renderThread(T, [() => json(T), () => json(fewer)]);
    expect(await h1('נועה')).toBeVisible();
    expect(memberLine().textContent).toBe('רוני (בעל/ת הדירה) · את/ה · יעל (שותף/ה) · נועה');
    await focus();
    await waitFor(() => expect(memberLine().textContent).toBe('רוני (בעל/ת הדירה) · את/ה · נועה'));
    expect(api.calls(threadRoute(T))).toHaveLength(2);
    reset(view);

    // The refetch answers 404: removed, with the back link and no composer or messages.
    ({ view } = renderThread(T, [() => json(T), NOT_FOUND]));
    expect(await h1('נועה')).toBeVisible();
    await focus();
    const removed = await screen.findByRole('heading', { level: 1, name: he.chat.removed });
    expect(removed).toHaveFocus();
    expect(screen.getByRole('link', { name: he.chat.thread.back })).toHaveAttribute(
      'href',
      '/chat',
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('log')).toBeNull();
    expect(screen.queryByText(he.chat.thread.notFound)).toBeNull();
    reset(view);

    // A send answers 404 (and the thread refetch too): the same state.
    ({ api, view } = renderThread(T, [() => json(T), NOT_FOUND], {
      extra: { [postRoute(T)]: [NOT_FOUND] },
    }));
    expect(await h1('נועה')).toBeVisible();
    fireEvent.change(textarea(), { target: { value: 'hi' } });
    fireEvent.click(sendButton());
    expect(await screen.findByRole('heading', { level: 1, name: he.chat.removed })).toHaveFocus();
    expect(screen.getByRole('link', { name: he.chat.thread.back })).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('log')).toBeNull();
    expect(api.calls(postRoute(T))).toHaveLength(1);
    reset(view);

    // A first load that answers 404 (nothing cached) keeps notFound.
    ({ view } = renderThread(T, [NOT_FOUND]));
    expect(await h1(he.chat.thread.notFound)).toBeVisible();
    expect(screen.queryByText(he.chat.removed)).toBeNull();
    reset(view);
  });

  it('ac4_log_mounted_when_empty', async () => {
    // A group thread with no messages: the log is there, empty, and the empty line outside it.
    const T = group({ messages: [] });
    renderThread(T, [json(T)]);
    expect(await h1('נועה')).toBeVisible();
    const empty = screen.getByText(he.chat.thread.empty);
    expect(log()).toBeInTheDocument();
    expect(log().querySelector('ol')).not.toBeNull();
    expect(within(log()).queryAllByRole('listitem')).toHaveLength(0);
    expect(log()).not.toContainElement(empty);
  });

  it('ac3_focus_when_chat_closes', async () => {
    const refetch = async () => {
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
    };
    const closedNote = () => screen.findByText(he.chat.thread.closed);
    const T = thread({ messages: [message({ body: 'hello' })] });
    const closed = { ...T, can_send: false };

    // (a) The textarea has focus and a refetch answers `can_send: false`: the closed note.
    let { view } = renderThread(T, [() => json(T), () => json(closed)]);
    expect(await h1(T.other_name)).toBeVisible();
    act(() => textarea().focus());
    await refetch();
    let note = await closedNote();
    await waitFor(() => {
      expect(note).toHaveFocus();
    });
    expect(note).toHaveAttribute('role', 'status');
    reset(view);

    // (b) "Send" clicked, the POST answers 409 `chat_closed`, the refetch `can_send: false`.
    ({ view } = renderThread(T, [json(T), () => json(closed)], {
      extra: { [postRoute(T)]: [json({ detail: 'chat_closed' }, 409)] },
    }));
    expect(await h1(T.other_name)).toBeVisible();
    fireEvent.change(textarea(), { target: { value: 'hi' } });
    act(() => sendButton().focus());
    fireEvent.click(sendButton());
    // The pending send disables the button: the browser blurs it to <body> (no related target).
    fireEvent.blur(sendButton(), { relatedTarget: null });
    note = await closedNote();
    await waitFor(() => {
      expect(note).toHaveFocus();
    });
    reset(view);

    // Negative: focus moved on to the back link before the chat closed; the note takes none.
    ({ view } = renderThread(T, [() => json(T), () => json(closed)]));
    expect(await h1(T.other_name)).toBeVisible();
    act(() => textarea().focus());
    const back = screen.getByRole('link', { name: he.chat.thread.back });
    act(() => back.focus());
    await refetch();
    note = await closedNote();
    await settle();
    expect(note).not.toHaveFocus();
    expect(back).toHaveFocus();
    reset(view);

    // Negative: focus left the composer to nothing (a click on dead space), then the person
    // tabbed to the back link; the chat closing later leaves focus on the link.
    ({ view } = renderThread(T, [() => json(T), () => json(closed)]));
    expect(await h1(T.other_name)).toBeVisible();
    act(() => textarea().focus());
    act(() => textarea().blur());
    expect(document.activeElement).toBe(document.body);
    const link = screen.getByRole('link', { name: he.chat.thread.back });
    act(() => link.focus());
    await refetch();
    note = await closedNote();
    await settle();
    expect(note).not.toHaveFocus();
    expect(link).toHaveFocus();
  });

  it('ac7_chat_draft', async () => {
    const refetch = async () => {
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
    };
    // "אשמח לראות את הדירה\nמחר?"
    const TEXT =
      '\u05d0\u05e9\u05de\u05d7 \u05dc\u05e8\u05d0\u05d5\u05ea \u05d0\u05ea \u05d4\u05d3\u05d9\u05e8\u05d4\n\u05de\u05d7\u05e8?';
    const T = thread({ messages: [message({ body: 'hello' })] });
    const closed = { ...T, can_send: false };
    const draft = () => readDraft('chat', T.id, seeker.id);
    const unsentLabel = () => screen.queryByText(he.chat.thread.unsent);
    const discardButton = () => screen.queryByRole('button', { name: he.chat.thread.discardDraft });

    // Typed text survives a 401 (the send's: the session clears, to /login) and the way back.
    let { view } = renderThread(T, [() => json(T)], {
      extra: { [postRoute(T)]: [json({ detail: 'unauthenticated' }, 401)] },
    });
    expect(await h1(T.other_name)).toBeVisible();
    fireEvent.change(textarea(), { target: { value: TEXT } });
    expect(draft()).toBe(TEXT);
    fireEvent.click(sendButton());
    await vi.waitFor(() => {
      expect(currentPath()).toBe(`/login?next=${encodeURIComponent(`/chat/${T.id}`)}`);
    });
    reset(view);
    ({ view } = renderThread(T, [() => json(T)]));
    expect(await h1(T.other_name)).toBeVisible();
    expect(textarea()).toHaveValue(TEXT);
    reset(view);

    // The send answers 409 `chat_closed` and the refetch `can_send: false`: under the closed note,
    // the unsent text, read-only, with a discard button.
    ({ view } = renderThread(T, [json(T), () => json(closed)], {
      extra: { [postRoute(T)]: [json({ detail: 'chat_closed' }, 409)] },
    }));
    expect(await h1(T.other_name)).toBeVisible();
    expect(textarea()).toHaveValue(TEXT);
    fireEvent.click(sendButton());
    const note = await screen.findByText(he.chat.thread.closed);
    const label = await screen.findByText(he.chat.thread.unsent);
    const text = screen.getByTestId('unsent-draft');
    expect(text.textContent).toBe(TEXT);
    expect(text).toHaveAttribute('dir', 'auto');
    expect(text.tagName).toBe('P');
    expect(note.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(label.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    // Discard: the text and the stored draft go, and focus lands on the closed note.
    const discard = discardButton();
    expect(discard).not.toBeNull();
    act(() => discard?.focus());
    fireEvent.click(discard as HTMLElement);
    expect(unsentLabel()).toBeNull();
    expect(screen.queryByTestId('unsent-draft')).toBeNull();
    expect(discardButton()).toBeNull();
    expect(draft()).toBe('');
    expect(note).toHaveFocus();
    reset(view);

    // Not discarded: when the chat reopens, the composer holds the text again.
    writeDraft('chat', T.id, seeker.id, TEXT);
    ({ view } = renderThread(T, [json(closed), () => json(T)]));
    expect(await screen.findByText(he.chat.thread.closed)).toBeVisible();
    expect(screen.getByTestId('unsent-draft').textContent).toBe(TEXT);
    await refetch();
    await waitFor(() => {
      expect(textarea()).toHaveValue(TEXT);
    });
    expect(unsentLabel()).toBeNull();
    reset(view);

    // A 201 clears the draft.
    ({ view } = renderThread(T, [() => json(T)], {
      extra: { [postRoute(T)]: [() => json(sent(TEXT), 201)] },
    }));
    expect(await h1(T.other_name)).toBeVisible();
    expect(textarea()).toHaveValue(TEXT);
    fireEvent.click(sendButton());
    await waitFor(() => {
      expect(textarea()).toHaveValue('');
    });
    expect(draft()).toBe('');
    reset(view);

    // The `Removed` state (the refetch answers 404) clears it.
    ({ view } = renderThread(T, [() => json(T), () => json({ detail: 'not_found' }, 404)]));
    expect(await h1(T.other_name)).toBeVisible();
    fireEvent.change(textarea(), { target: { value: TEXT } });
    expect(draft()).toBe(TEXT);
    await refetch();
    expect(await screen.findByRole('heading', { level: 1, name: he.chat.removed })).toBeVisible();
    expect(draft()).toBe('');
    reset(view);
  });
});
