import { focusManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { deferred, json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import { RequireUser } from '../../auth/RequireUser';
import { owner, seeker } from '../../listings/__tests__/fixtures';
import type { ConversationOut } from '../api';
import { ChatListPage } from '../ChatListPage';
import { formatMessageTime } from '../format';
import { type Conversation, conversation, directConversation } from './fixtures';
import { settle } from './harness';

afterEach(() => {
  vi.unstubAllGlobals();
  focusManager.setFocused(undefined);
});

const LIST = 'GET /me/conversations';
type Reply = Parameters<typeof mockApi>[0][string][number];

const routes = (
  <Routes>
    <Route element={<RequireUser />}>
      <Route path="/chat" element={<ChatListPage />} />
    </Route>
  </Routes>
);

function renderPage(list: Reply[], me = seeker, flats: Reply[] = [() => json([])]) {
  const api = mockApi({ 'GET /me': [json(me)], [LIST]: list, 'GET /me/flats': flats });
  const view = renderRoutes('/chat', routes);
  return { api, view };
}

function reset(view: { unmount: () => void }) {
  view.unmount();
  vi.unstubAllGlobals();
}

const titleOf = ({ listing }: ConversationOut) => {
  if (listing === null) throw new Error('titleOf: a direct chat has no listing');
  return i18n.t('listings.card.title', {
    count: listing.rooms,
    rooms: String(listing.rooms),
    street: listing.street,
    city: listing.city,
  });
};
const heading = () => screen.findByRole('heading', { level: 1, name: he.chat.list.title });

describe('ChatListPage', () => {
  it('ac3_list_states', async () => {
    // Pending: a busy block of three skeletons (not a list of empty items).
    const pending = deferred();
    let { view } = renderPage([pending.promise]);
    await heading();
    const busy = screen.getByText(he.common.loading).closest<HTMLElement>('[aria-busy="true"]');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(busy as HTMLElement).getAllByTestId('skeleton')).toHaveLength(3);
    expect(screen.queryByRole('list')).toBeNull();
    reset(view);

    // 500: ErrorState; retry refetches.
    const failing = renderPage([json({ detail: 'boom' }, 500), json([])]);
    view = failing.view;
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await screen.findByText(he.chat.list.empty)).toBeVisible();
    expect(failing.api.calls(LIST)).toHaveLength(2);
    reset(view);

    // Empty: one line for every role (`ac15_generic_empty`).

    // Four chats, in the API's order.
    const mine = conversation({
      last_message: { body: 'see you <b>soon</b>', mine: true, created_at: '2026-11-10T10:00:00Z' },
    });
    const fresh = conversation({ last_message: null, is_new: true });
    const unread = conversation({
      unread_count: 3,
      is_new: true,
      last_message: {
        body: '\u05e9\u05dc\u05d5\u05dd',
        mine: false,
        created_at: '2026-11-10T10:00:00Z',
      },
    });
    const closed = conversation({
      can_send: false,
      last_message: { body: 'bye', mine: false, created_at: '2026-11-10T10:00:00Z' },
    });
    const all = [mine, fresh, unread, closed];
    renderPage([json(all)]);
    const links = await screen.findAllByRole('link');
    expect(links).toHaveLength(4);
    links.forEach((link, i) => {
      const c = all[i] as Conversation;
      expect(link).toHaveAttribute('href', `/chat/${c.id}`);
      expect(link).toHaveTextContent(c.other_name);
      expect(link).toHaveTextContent(titleOf(c));
    });
    const [first, second, third, fourth] = links as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    // Mine: the "you" prefix, as plain text with its own direction.
    const preview = within(first).getByTestId('last-message');
    expect(preview).toHaveTextContent(i18n.t('chat.list.you', { body: 'see you <b>soon</b>' }));
    expect(preview.textContent?.startsWith(he.chat.list.you.replace('{{body}}', ''))).toBe(true);
    expect(preview).toHaveAttribute('dir', 'auto');
    expect(preview.querySelector('b')).toBeNull();
    expect(within(first).getByText(/\d\d\.\d\d \d\d:\d\d/)).toBeVisible();

    // No messages: the placeholder, no time, the "new" pill.
    expect(within(second).getByText(he.chat.list.noMessages)).toBeVisible();
    expect(second.querySelector('time')).toBeNull();
    expect(within(second).getByText(he.chat.list.new)).toBeVisible();

    // Unread: the count pill (the number hidden from assistive tech, the sentence not), and no
    // "new" pill beside it.
    expect(within(third).getByText('3')).toHaveAttribute('aria-hidden', 'true');
    expect(within(third).getByText(i18n.t('chat.list.unread', { count: 3 }))).toBeInTheDocument();
    expect(within(third).queryByText(he.chat.list.new)).toBeNull();

    // Closed: the tag; the others have none. Only the unread chat has a count pill.
    expect(within(fourth).getByText(he.chat.list.closed)).toBeVisible();
    for (const link of [first, second, third]) {
      expect(within(link).queryByText(he.chat.list.closed)).toBeNull();
    }
    for (const link of [first, second, fourth]) {
      expect(within(link).queryByText(/^\d+$/)).toBeNull();
    }
  });

  it('ac8_row_anatomy', async () => {
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const at = '2026-11-10T10:00:00Z';
    const unread = conversation({
      other_name: 'Noa',
      unread_count: 2,
      last_message: { body: 'hello there', mine: false, created_at: at },
    });
    const fresh = conversation({ other_name: 'Yael', is_new: true });
    // A flatmate in a group of 4, closed, unread: every mark and chip in one row.
    const full = conversation({
      other_name: 'Roni',
      my_role: 'flatmate',
      member_count: 4,
      can_send: false,
      unread_count: 2,
      last_message: { body: 'bye now', mine: false, created_at: at },
    });
    const { view } = renderPage([json([unread, fresh, full])]);
    const link = (c: Conversation) => screen.findByRole('link', { name: new RegExp(c.other_name) });
    const unreadSentence = i18n.t('chat.list.unread', { count: 2 });

    // Unread: an accent badge (not the solid count), its sentence the accessible text.
    const unreadRow = await link(unread);
    const badge = within(unreadRow).getByText('2').parentElement as HTMLElement;
    expect(badge).toHaveClass('rounded-full', 'bg-accent-soft', 'text-accent-strong');
    expect(badge).not.toHaveClass('bg-accent');
    expect(within(badge).getByText(unreadSentence)).toHaveClass('sr-only');
    expect(badge.textContent).toBe(`2${unreadSentence}`);
    expect(unreadRow).toHaveAccessibleName(new RegExp(escape(unreadSentence)));

    // New: the "new" badge.
    expect(within(await link(fresh)).getByText(he.chat.list.new)).toBeVisible();

    // The chips: the accent flatmate tag, the group, closed; on their own line after the name.
    const fullRow = await link(full);
    const flatmateTag = within(fullRow).getByText(he.chat.flatmateChip);
    expect(flatmateTag).toHaveClass('rounded-full', 'bg-accent-soft', 'text-accent-strong');
    const groupTag = within(fullRow).getByText(i18n.t('chat.group', { count: 4 }));
    expect(groupTag.textContent).toBe('קבוצה · 4');
    const closedTag = within(fullRow).getByText(he.chat.list.closed);
    expect(closedTag.textContent).toBe('סגורה');
    const nameLine = within(fullRow).getByText('Roni').parentElement as HTMLElement;
    const chipLine = flatmateTag.parentElement as HTMLElement;
    expect(chipLine).not.toBe(nameLine);
    expect(nameLine.contains(flatmateTag)).toBe(false);
    expect(nameLine.nextElementSibling).toBe(chipLine);
    expect([...chipLine.children]).toEqual([flatmateTag, groupTag, closedTag]);
    // The mark sits on the name line, at its inline end.
    expect(nameLine.lastElementChild).toHaveTextContent(unreadSentence);
    // Rows without chips have no chip line.
    const freshName = within(await link(fresh)).getByText('Yael').parentElement as HTMLElement;
    expect(freshName.nextElementSibling).toHaveTextContent(titleOf(fresh));

    // Still one link per row, named in reading order.
    expect(within(fullRow).queryAllByRole('link')).toHaveLength(0);
    expect(fullRow).toHaveAccessibleName(
      new RegExp(
        [
          'Roni',
          unreadSentence,
          he.chat.flatmateChip,
          i18n.t('chat.group', { count: 4 }),
          he.chat.list.closed,
          titleOf(full),
          'bye now',
          formatMessageTime(at),
        ]
          .map(escape)
          .join('.*'),
      ),
    );
    reset(view);
  });

  it('ac4_room_title', async () => {
    const c = conversation();
    const room = {
      ...c,
      listing: {
        ...c.listing,
        listing_type: 'room' as const,
        rooms: 4,
        street: '\u05d4\u05e8\u05e6\u05dc',
      },
    };
    const { view } = renderPage([json([room])]);
    expect(
      await screen.findByText(
        '\u05d7\u05d3\u05e8 \u05d1\u05be4 \u05d7\u05d3\u05e8\u05d9\u05dd, \u05e8\u05d7\u05d5\u05d1 \u05d4\u05e8\u05e6\u05dc, \u05e8\u05de\u05ea \u05d2\u05df',
      ),
    ).toBeVisible();
    reset(view);
  });

  it('ac10_empty_for_a_flatmate', async () => {
    // "אין עדיין שיחות על החדר. …"
    const flatmateLine =
      /^\u05d0\u05d9\u05df \u05e2\u05d3\u05d9\u05d9\u05df \u05e9\u05d9\u05d7\u05d5\u05ea \u05e2\u05dc \u05d4\u05d7\u05d3\u05e8\./;
    const plain = conversation();
    const flat = { listing: plain.listing, owner_name: 'Roni', joined_at: '2026-11-01T08:00:00Z' };

    // One flat: the flatmate line, for a seeker and for an owner.
    for (const me of [seeker, owner]) {
      const { view } = renderPage([json([])], me, [() => json([flat])]);
      expect(await screen.findByText(flatmateLine)).toBeVisible();
      expect(screen.getByText(flatmateLine).textContent).toBe(he.chat.list.emptyFlatmate);
      expect(screen.queryByText(he.chat.list.empty)).toBeNull();
      reset(view);
    }

    // No flats: the generic line (spec 0010b), for both roles.
    for (const me of [owner, seeker]) {
      const { api, view } = renderPage([json([])], me, [() => json([])]);
      expect(await screen.findByText(he.chat.list.empty)).toBeVisible();
      await waitFor(() => expect(api.calls('GET /me/flats')).toHaveLength(1));
      await settle();
      expect(screen.queryByText(flatmateLine)).toBeNull();
      reset(view);
    }

    // While /me/flats is pending: the generic line, then the flatmate line once the flats arrive.
    const flats = deferred();
    const { view } = renderPage([json([])], seeker, [flats.promise]);
    expect(await screen.findByText(he.chat.list.empty)).toBeVisible();
    expect(screen.queryByText(flatmateLine)).toBeNull();
    flats.resolve(json([flat]));
    expect(await screen.findByText(flatmateLine)).toBeVisible();
    expect(screen.queryByText(he.chat.list.empty)).toBeNull();
    reset(view);
  });

  it('ac15_generic_empty', async () => {
    // Spec 0010b: any account lists rooms and applies, so the empty list has one line for an owner
    // and a seeker; a flatmate keeps the flat's line.
    const plain = conversation();
    const flat = { listing: plain.listing, owner_name: 'Roni', joined_at: '2026-11-01T08:00:00Z' };
    for (const me of [owner, seeker]) {
      const { view } = renderPage([json([])], me, [() => json([])]);
      expect(await screen.findByText(he.chat.list.empty)).toBeVisible();
      expect(screen.queryByText(he.chat.list.emptyFlatmate)).toBeNull();
      await settle();
      reset(view);
    }
    const { view } = renderPage([json([])], seeker, [() => json([flat])]);
    expect(await screen.findByText(he.chat.list.emptyFlatmate)).toBeVisible();
    expect(screen.queryByText(he.chat.list.empty)).toBeNull();
    reset(view);
  });

  it('ac3_flatmate_items', async () => {
    const flatmateItem = conversation({ my_role: 'flatmate', member_count: 3 });
    const plain = conversation();
    const flat = { listing: plain.listing, owner_name: 'רוני', joined_at: '2026-11-01T08:00:00Z' };
    const link = (c: Conversation) => screen.getByRole('link', { name: new RegExp(c.other_name) });

    let { view } = renderPage([() => json([flatmateItem, plain])], undefined, [() => json([flat])]);
    await heading();
    expect(await screen.findByRole('link', { name: he.chat.myFlats })).toHaveAttribute(
      'href',
      '/me/flats',
    );
    const first = link(flatmateItem);
    const second = link(plain);
    expect(within(first).getByText(he.chat.flatmateChip)).toBeVisible();
    expect(within(first).getByText(i18n.t('chat.group', { count: 3 }))).toBeVisible();
    expect(within(second).queryByText(he.chat.flatmateChip)).toBeNull();
    expect(within(second).queryByText(/קבוצה/)).toBeNull();
    reset(view);

    // No flats: no link.
    const api = renderPage([() => json([plain])], undefined, [() => json([])]);
    view = api.view;
    await heading();
    await screen.findByText(titleOf(plain));
    await waitFor(() => expect(api.api.calls('GET /me/flats')).toHaveLength(1));
    await settle();
    expect(screen.queryByRole('link', { name: he.chat.myFlats })).toBeNull();
    reset(view);
  });

  it('ac6_list_refetches_on_focus', async () => {
    const stays = conversation();
    const goes = conversation();
    const { api, view } = renderPage([() => json([stays, goes]), () => json([stays])]);
    await heading();
    expect(await screen.findByRole('link', { name: new RegExp(goes.other_name) })).toBeVisible();
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: new RegExp(goes.other_name) })).toBeNull(),
    );
    expect(screen.getByRole('link', { name: new RegExp(stays.other_name) })).toBeVisible();
    expect(api.calls(LIST)).toHaveLength(2);
    reset(view);
  });

  it('ac4_joined_announced_once', async () => {
    mockApi({
      'GET /me': [() => json(seeker)],
      [LIST]: [() => json([])],
      'GET /me/flats': [() => json([])],
    });
    function Probe() {
      return <span data-testid="state">{JSON.stringify(useLocation().state)}</span>;
    }
    const tree = (
      <>
        {routes}
        <Probe />
      </>
    );
    /** The page's own status line (the harness's location probe is an <output>). */
    const statusLine = () => document.querySelector('p[role="status"]');
    // Animation frames run only when the test says so.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    // After a join: the line is mounted empty and filled a frame later; the entry's state is
    // cleared.
    let view = renderRoutes({ pathname: '/chat', state: { joined: true } }, tree);
    await heading();
    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('null');
    });
    expect(statusLine()).not.toBeNull();
    expect(statusLine()).toHaveTextContent('');
    expect(frames.length).toBeGreaterThan(0);
    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
    expect(statusLine()).toHaveTextContent(he.flatmates.join.done);
    expect(screen.getByTestId('state')).toHaveTextContent('null');
    view.unmount();

    // A visit without the state (a reload or Back): no line.
    view = renderRoutes({ pathname: '/chat', state: null }, tree);
    await heading();
    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
    expect(screen.queryByText(he.flatmates.join.done)).toBeNull();
    view.unmount();
  });

  it('ac10_direct_chat_row', async () => {
    // A direct chat (spec 0010g): the caption under the name reads "a match in the market", with
    // no listing title; an application chat beside it is as before.
    const direct = directConversation({ other_name: 'Avi', is_new: true });
    const closedDirect = directConversation({ other_name: 'Bat', can_send: false });
    const plain = conversation({ other_name: 'Dana' });
    const { view } = renderPage([json([direct, closedDirect, plain])]);
    await heading();
    const row = (name: string) => screen.getByRole('link', { name: new RegExp(name) });
    await screen.findByRole('link', { name: /Avi/ });

    const first = row('Avi');
    expect(first).toHaveAttribute('href', `/chat/${direct.id}`);
    expect(within(first).getByText(he.chat.list.direct)).toBeVisible();
    expect(within(first).getByText(he.chat.list.new)).toBeVisible();
    expect(within(first).queryByText(he.chat.flatmateChip)).toBeNull();
    expect(within(first).queryByText(he.chat.list.closed)).toBeNull();
    expect(first).not.toHaveTextContent(titleOf(plain));

    const second = row('Bat');
    expect(within(second).getByText(he.chat.list.direct)).toBeVisible();
    expect(within(second).getByText(he.chat.list.closed)).toBeVisible();

    const third = row('Dana');
    expect(third).toHaveTextContent(titleOf(plain));
    expect(within(third).queryByText(he.chat.list.direct)).toBeNull();
    view.unmount();
  });
});
