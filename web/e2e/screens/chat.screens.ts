// The visual check for the chat screens (spec 0009s, AC12): one screenshot per state at each
// project's size, in web/screens/0009s/. Every API request is answered here, so it needs only the
// vite server: no sign-up, no OTP. An unmatched request fails the run.
import { expect, type Page, type Route } from '@playwright/test';

import he from '../../src/locales/he.json' with { type: 'json' };
import type { ConversationOut, ThreadOut } from '../../src/features/chat/api';
import { API } from '../helpers';
import {
  CLOSED_ID,
  EMPTY_ID,
  FLATMATE,
  GROUP_ID,
  MISSING_ID,
  ONE_TO_ONE_ID,
  OWNER,
  SIX_ROWS,
  closed,
  empty,
  group,
  oneToOne,
} from './fixtures-chat';
import { WEB_ORIGIN } from './origin';
import { test } from '../fixtures';

/** `pending`: held, never answers (a loading state); `error`: a 500. */
type Answer = 'pending' | 'error' | { status: number; body: unknown };
type Setup = {
  user: 'owner' | 'flatmate';
  /** The list's answers, in order; the last repeats. */
  list: Answer[];
  /** The thread's answers by id, in order; the last repeats. Unlisted ids answer 404. */
  threads?: Record<string, Answer[]>;
  /** The send's answer. */
  post?: Answer;
};

const CORS = {
  'Access-Control-Allow-Origin': WEB_ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
};

const ok = (body: unknown): Answer => ({ status: 200, body });
const NOT_FOUND: Answer = { status: 404, body: { detail: 'not_found' } };

const reply = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: CORS,
    body: JSON.stringify(body),
  });

function answer(route: Route, a: Answer) {
  if (a === 'pending') return new Promise<void>(() => {});
  if (a === 'error') return reply(route, { detail: 'boom' }, 500);
  return reply(route, a.body, a.status);
}

/** The next answer of a queue (the last one repeats). */
function next(queue: Answer[], used: { n: number }): Answer {
  const a = queue[Math.min(used.n, queue.length - 1)] ?? NOT_FOUND;
  used.n += 1;
  return a;
}

async function mockApi(page: Page, setup: Setup): Promise<string[]> {
  const unmatched: string[] = [];
  const listUsed = { n: 0 };
  const threadUsed: Record<string, { n: number }> = {};
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const key = `${method} ${pathname}`;
    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...CORS,
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'content-type',
        },
      });
    }
    if (pathname === '/me/events') return route.abort();
    if (key === 'GET /me') return reply(route, setup.user === 'owner' ? OWNER : FLATMATE);
    if (key === 'GET /me/conversations') return answer(route, next(setup.list, listUsed));
    // A flatmate's flat (the "my flats" link); an owner has none.
    if (key === 'GET /me/flats') {
      return reply(
        route,
        setup.user === 'owner'
          ? []
          : [
              {
                listing: SIX_ROWS[1]?.listing,
                owner_name: 'רוני',
                joined_at: '2026-11-09T12:00:00Z',
              },
            ],
      );
    }
    // The seeker's header counts the likes received.
    if (key === 'GET /me/likes') return reply(route, { liked_me: [], mine: [] });
    const thread = /^GET \/conversations\/([^/]+)$/.exec(key);
    if (thread !== null) {
      const id = thread[1] ?? '';
      const queue = setup.threads?.[id] ?? [NOT_FOUND];
      threadUsed[id] ??= { n: 0 };
      return answer(route, next(queue, threadUsed[id]));
    }
    if (/^POST \/conversations\/[^/]+\/messages$/.test(key)) {
      return answer(route, setup.post ?? 'error');
    }
    unmatched.push(key);
    return route.fulfill({ status: 500, headers: CORS, body: `unmatched ${key}` });
  });
  return unmatched;
}

type State = {
  name: string;
  setup: Setup;
  path: string;
  /** The person arrives from the join page (`location.state.joined`). */
  joined?: boolean;
  /** What to wait for, and do, before the shot. */
  act: (page: Page) => Promise<void>;
};

const SIX = ok(SIX_ROWS);
/** The list for the group states: the group row with its six members. */
const SIX_WITH_GROUP_OF_SIX = ok(
  SIX_ROWS.map((c): ConversationOut => (c.id === GROUP_ID ? { ...c, member_count: 6 } : c)),
);
const WITHOUT = (gone: string) => ok(SIX_ROWS.filter((c) => c.id !== gone));
const thread = (id: string, t: ThreadOut): Record<string, Answer[]> => ({ [id]: [ok(t)] });
const threadAnswer = (id: string, a: Answer): Record<string, Answer[]> => ({ [id]: [a] });

const busy = (page: Page) => expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
const h1 = (page: Page, name: string) =>
  expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
const composer = (page: Page) => page.getByRole('textbox', { name: he.chat.composer.label });
const send = (page: Page) => page.getByRole('button', { name: he.chat.composer.send });

const STATES: State[] = [
  {
    name: '01-list-loading',
    setup: { user: 'flatmate', list: ['pending'] },
    path: '/chat',
    act: async (page) => {
      await h1(page, he.chat.list.title);
      await busy(page);
    },
  },
  {
    name: '02-list-error',
    setup: { user: 'flatmate', list: ['error'] },
    path: '/chat',
    act: async (page) => {
      await expect(page.getByRole('button', { name: he.common.retry })).toBeVisible();
    },
  },
  {
    name: '03-list-empty-owner',
    setup: { user: 'owner', list: [ok([])] },
    path: '/chat',
    act: async (page) => {
      await expect(page.getByText(he.chat.list.emptyOwner)).toBeVisible();
    },
  },
  {
    name: '04-list-six-rows-joined',
    setup: { user: 'flatmate', list: [SIX] },
    path: '/chat',
    joined: true,
    act: async (page) => {
      await expect(page.getByText(he.flatmates.join.done)).toBeVisible();
      await expect(page.getByRole('link', { name: /Alexandra/ })).toBeVisible();
    },
  },
  {
    name: '05-list-pick-one',
    setup: { user: 'flatmate', list: [SIX] },
    path: '/chat',
    act: async (page) => {
      await expect(page.getByRole('link', { name: /Alexandra/ })).toBeVisible();
      if ((page.viewportSize()?.width ?? 0) >= 1024) {
        await expect(page.getByText(he.chat.pickOne)).toBeVisible();
      }
    },
  },
  {
    name: '06-thread-loading',
    setup: { user: 'flatmate', list: [SIX], threads: threadAnswer(ONE_TO_ONE_ID, 'pending') },
    path: `/chat/${ONE_TO_ONE_ID}`,
    act: async (page) => {
      await expect(page.getByRole('link', { name: he.chat.thread.back })).toBeVisible();
      await busy(page);
    },
  },
  {
    name: '07-thread-not-found',
    setup: { user: 'flatmate', list: [SIX] },
    path: `/chat/${MISSING_ID}`,
    act: async (page) => {
      await h1(page, he.chat.thread.notFound);
    },
  },
  {
    name: '08-thread-error',
    setup: { user: 'flatmate', list: [SIX], threads: threadAnswer(ONE_TO_ONE_ID, 'error') },
    path: `/chat/${ONE_TO_ONE_ID}`,
    act: async (page) => {
      await expect(page.getByRole('button', { name: he.common.retry })).toBeVisible();
    },
  },
  {
    name: '09-thread-one-to-one',
    setup: { user: 'flatmate', list: [SIX], threads: thread(ONE_TO_ONE_ID, oneToOne()) },
    path: `/chat/${ONE_TO_ONE_ID}`,
    act: async (page) => {
      await h1(page, 'מיכל');
      await expect(page.getByText('Great, thanks! Could we meet on Sunday?')).toBeVisible();
    },
  },
  {
    name: '10-thread-group',
    setup: { user: 'flatmate', list: [SIX_WITH_GROUP_OF_SIX], threads: thread(GROUP_ID, group()) },
    path: `/chat/${GROUP_ID}`,
    act: async (page) => {
      await expect(page.getByRole('group', { name: he.chat.members })).toBeVisible();
      await expect(page.getByText(he.chat.thread.truncated)).toBeVisible();
    },
  },
  {
    name: '11-thread-group-expanded',
    setup: { user: 'flatmate', list: [SIX_WITH_GROUP_OF_SIX], threads: thread(GROUP_ID, group()) },
    path: `/chat/${GROUP_ID}`,
    act: async (page) => {
      await expect(page.getByRole('group', { name: he.chat.members })).toBeVisible();
      // Six members of the longest names (40 characters) fill two lines at 1440, so the toggle shows
      // only where the line is cut (the phone).
      const more = page.getByRole('button', { name: he.common.showMore });
      if ((page.viewportSize()?.width ?? 0) < 1024) {
        await more.click();
        await expect(page.getByRole('button', { name: he.common.showLess })).toBeVisible();
      } else {
        await expect(more).toHaveCount(0);
      }
    },
  },
  {
    name: '12-thread-closed',
    setup: { user: 'flatmate', list: [SIX], threads: thread(CLOSED_ID, closed()) },
    path: `/chat/${CLOSED_ID}`,
    act: async (page) => {
      await expect(page.getByText(he.chat.thread.closed)).toBeVisible();
    },
  },
  {
    name: '13-thread-removed',
    setup: {
      user: 'flatmate',
      // The removal's refetch answers without the chat.
      list: [SIX, WITHOUT(ONE_TO_ONE_ID)],
      threads: { [ONE_TO_ONE_ID]: [ok(oneToOne()), NOT_FOUND] },
      post: NOT_FOUND,
    },
    path: `/chat/${ONE_TO_ONE_ID}`,
    act: async (page) => {
      await h1(page, 'מיכל');
      await composer(page).fill('עדיין כאן?');
      await send(page).click();
      await h1(page, he.chat.removed);
      if ((page.viewportSize()?.width ?? 0) >= 1024) {
        await expect(page.getByRole('link', { name: /אפשר לבוא לראות/ })).toHaveCount(0);
      }
    },
  },
  {
    name: '14-composer-remaining-429',
    setup: {
      user: 'flatmate',
      list: [SIX],
      threads: thread(ONE_TO_ONE_ID, oneToOne()),
      post: { status: 429, body: { detail: 'rate_limited' } },
    },
    path: `/chat/${ONE_TO_ONE_ID}`,
    act: async (page) => {
      await h1(page, 'מיכל');
      await composer(page).fill(`${'אשמח לתאם סיור בדירה. '.repeat(90)}`.slice(0, 1850));
      await send(page).click();
      await expect(page.getByRole('alert')).toHaveText(he.chat.errors.rateLimited);
      await expect(page.getByText(/נותרו 150 תווים/)).toBeVisible();
    },
  },
  {
    name: '15-thread-empty',
    setup: { user: 'flatmate', list: [SIX], threads: thread(EMPTY_ID, empty()) },
    path: `/chat/${EMPTY_ID}`,
    act: async (page) => {
      await expect(page.getByText(he.chat.thread.empty)).toBeVisible();
    },
  },
];

for (const state of STATES) {
  test(state.name, async ({ page }, testInfo) => {
    const unmatched = await mockApi(page, state.setup);
    if (state.joined === true) {
      // As the join page leaves it: React Router keeps `location.state` in `history.state.usr`.
      await page.goto(state.path);
      await page.evaluate(() => {
        window.history.replaceState({ usr: { joined: true }, key: 'join', idx: 0 }, '');
      });
      await page.reload();
    } else {
      await page.goto(state.path);
    }
    await state.act(page);
    await page.evaluate(() => document.fonts.ready);
    // At 1440 the list pane and the composer are sticky to the viewport: a full-page capture would
    // draw them over the thread, so the desktop shot is the viewport the person sees.
    await page.screenshot({
      fullPage: testInfo.project.name !== 'desktop',
      animations: 'disabled',
      path: `screens/0009s/${state.name}-${testInfo.project.name}.png`,
    });
    expect(unmatched, 'unmatched API requests').toEqual([]);
  });
}
