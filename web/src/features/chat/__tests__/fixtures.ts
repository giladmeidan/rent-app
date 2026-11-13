// Fixtures for the chat tests; the fetch mock and render helpers are the auth harness's, `owner` /
// `seeker` the listings tests'.
import type { ConversationOut, MessageOut, ThreadOut } from '../api';

let n = 0;
const uuid = (fill: string) => `00000000-0000-0000-0000-${String(n).padStart(12, fill)}`;

const listingSummary = (): ConversationOut['listing'] => ({
  id: '00000000-0000-0000-0000-0000000000a1',
  listing_type: 'apartment',
  city: 'רמת גן',
  street: `ביאליק ${String(n)}`,
  rooms: 3,
  price_ils: 6000,
});

/** An open, read chat with no messages, as `GET /me/conversations` returns it. */
export function conversation(overrides: Partial<ConversationOut> = {}): ConversationOut {
  n += 1;
  return {
    id: uuid('c'),
    listing: listingSummary(),
    other_name: `Person ${String(n)}`,
    other_photo_url: null,
    my_role: 'seeker',
    member_count: 2,
    can_send: true,
    is_new: false,
    unread_count: 0,
    last_message: null,
    created_at: '2026-11-10T10:00:00Z',
    ...overrides,
  };
}

/** A message from the other person. */
export function message(overrides: Partial<MessageOut> = {}): MessageOut {
  n += 1;
  return {
    id: uuid('d'),
    body: `message ${String(n)}`,
    mine: false,
    sender_name: 'מיכל',
    created_at: '2026-11-10T10:00:00Z',
    ...overrides,
  };
}

/** An open thread with no messages, as `GET /conversations/{id}` returns it. */
export function thread(overrides: Partial<ThreadOut> = {}): ThreadOut {
  n += 1;
  return {
    id: uuid('e'),
    listing: listingSummary(),
    other_name: 'מיכל',
    other_photo_url: null,
    my_role: 'seeker',
    members: [
      { name: 'מיכל', photo_url: null, role: 'owner', is_me: false },
      { name: 'דנה', photo_url: null, role: 'seeker', is_me: true },
    ],
    visible_from: null,
    can_send: true,
    messages: [],
    truncated: false,
    ...overrides,
  };
}
