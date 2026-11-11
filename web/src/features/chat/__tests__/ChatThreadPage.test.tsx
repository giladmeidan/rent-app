import { act, fireEvent, screen, within } from '@testing-library/react';
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
import { owner, seeker } from '../../listings/__tests__/fixtures';
import type { ConversationOut, MessageOut, ThreadOut } from '../api';
import { CONVERSATIONS_KEY } from '../useConversations';
import { conversation, message, thread } from './fixtures';
import { chatRoutes, connected, ES, openStream, settle } from './harness';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
  }: { me?: typeof seeker; list?: Reply[]; extra?: Record<string, Reply[]> } = {},
) {
  const api = mockApi({
    'GET /me': [() => json(me)],
    [LIST]: list,
    [threadRoute(t)]: replies,
    ...extra,
  });
  const client = testQueryClient();
  const view = renderRoutes(`/chat/${t.id}`, chatRoutes, client);
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

    // An owner: the link goes to the listing's applicants.
    ({ view } = renderThread(T, [json(T)], { me: owner }));
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

    // No messages: the empty line, and the warning still.
    const none = thread();
    ({ view } = renderThread(none, [json(none)]));
    expect(await screen.findByText(he.chat.thread.empty)).toBeVisible();
    expect(screen.getByRole('note')).toHaveTextContent(he.chat.thread.warning);
    expect(screen.queryByRole('log')).toBeNull();
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
    const { api, client } = renderThread(T, [first.promise, () => replies.thread()], {
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

    // 401 on the POST: the session is gone; to /login.
    ({ view } = renderThread(T, [() => json(T)], {
      extra: { [postRoute(T)]: [json({ detail: 'unauthenticated' }, 401)] },
    }));
    expect(await h1(T.other_name)).toBeVisible();
    fireEvent.change(textarea(), { target: { value: 'hi' } });
    fireEvent.click(sendButton());
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/login');
    });
    reset(view);

    // 401 on the thread's own GET: to /login, no further GET, the stream closed.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ({ api, view } = renderThread(T, [() => json({ detail: 'unauthenticated' }, 401)]));
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/login');
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
      expect(currentPath()).toBe('/login');
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
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(api.calls(threadRoute(T))).toHaveLength(1);
    expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
    reset(view);
    vi.useRealTimers();

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
    expect(await h1(he.chat.thread.notFound)).toBeVisible();
    expect(screen.queryByRole('log')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.calls(threadRoute(loaded))).toHaveLength(2);
  });
});
