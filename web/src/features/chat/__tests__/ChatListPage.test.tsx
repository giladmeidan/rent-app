import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { deferred, json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import { RequireUser } from '../../auth/RequireUser';
import { owner, seeker } from '../../listings/__tests__/fixtures';
import type { ConversationOut } from '../api';
import { ChatListPage } from '../ChatListPage';
import { conversation } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
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

const titleOf = (c: ConversationOut) =>
  i18n.t('listings.card.title', {
    rooms: String(c.listing.rooms),
    street: c.listing.street,
    city: c.listing.city,
  });
const heading = () => screen.findByRole('heading', { level: 1, name: he.chat.list.title });

describe('ChatListPage', () => {
  it('ac3_list_states', async () => {
    // Pending: a busy list of three skeletons.
    const pending = deferred();
    let { view } = renderPage([pending.promise]);
    await heading();
    const busy = screen.getByRole('list');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(busy).getAllByTestId('skeleton')).toHaveLength(3);
    expect(screen.getByText(he.common.loading)).toBeInTheDocument();
    reset(view);

    // 500: ErrorState; retry refetches.
    const failing = renderPage([json({ detail: 'boom' }, 500), json([])]);
    view = failing.view;
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await screen.findByText(he.chat.list.emptySeeker)).toBeVisible();
    expect(failing.api.calls(LIST)).toHaveLength(2);
    reset(view);

    // Empty: the copy depends on the role.
    ({ view } = renderPage([json([])], owner));
    expect(await screen.findByText(he.chat.list.emptyOwner)).toBeVisible();
    expect(screen.queryByText(he.chat.list.emptySeeker)).toBeNull();
    reset(view);
    ({ view } = renderPage([json([])], seeker));
    expect(await screen.findByText(he.chat.list.emptySeeker)).toBeVisible();
    reset(view);

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
      const c = all[i] as ConversationOut;
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

  it('ac3_flatmate_items', async () => {
    const flatmateItem = conversation({ my_role: 'flatmate', member_count: 3 });
    const plain = conversation();
    const flat = { listing: plain.listing, owner_name: 'רוני', joined_at: '2026-11-01T08:00:00Z' };
    const link = (c: ConversationOut) =>
      screen.getByRole('link', { name: new RegExp(c.other_name) });

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
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('link', { name: he.chat.myFlats })).toBeNull();
    reset(view);
  });
});
