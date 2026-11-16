// Fixtures for the chat tests; the fetch mock and render helpers are the auth harness's, `owner` /
// `seeker` the listings tests'.
import type { ConversationOut, MessageOut, ThreadOut } from '../api';

let n = 0;
const uuid = (fill: string) => `00000000-0000-0000-0000-${String(n).padStart(12, fill)}`;

/** The listing line of an application chat (a direct chat has none, spec 0010g). */
type ListingSummary = NonNullable<ConversationOut['listing']>;

// The API types allow a null name for a deleted account (spec 0013c); these fixtures always name
// people, so tests can find them by name.
export type Conversation = ConversationOut & { other_name: string };
type Message = MessageOut & { sender_name: string };
type Member = ThreadOut['members'][number] & { name: string };
type Thread = ThreadOut & { other_name: string; members: Member[]; messages: Message[] };

const listingSummary = (): ListingSummary => ({
  id: '00000000-0000-0000-0000-0000000000a1',
  listing_type: 'apartment',
  city: 'רמת גן',
  street: `ביאליק ${String(n)}`,
  rooms: 3,
  price_ils: 6000,
});

/** An open, read application chat with no messages, as `GET /me/conversations` returns it. Its
 * `listing` is set unless an override (a plain `Partial<ConversationOut>`) says otherwise. */
export function conversation(
  overrides?: Partial<ConversationOut & { listing: ListingSummary }>,
): Conversation & { listing: ListingSummary };
export function conversation(overrides: Partial<ConversationOut>): Conversation;
export function conversation(overrides: Partial<ConversationOut> = {}): Conversation {
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
  } as Conversation;
}

/** A message from the other person. */
export function message(overrides: Partial<MessageOut> = {}): Message {
  n += 1;
  return {
    id: uuid('d'),
    body: `message ${String(n)}`,
    tour: null,
    mine: false,
    sender_name: 'מיכל',
    created_at: '2026-11-10T10:00:00Z',
    ...overrides,
  } as Message;
}

/** An open application thread with no messages, as `GET /conversations/{id}` returns it. Its
 * `listing` is set unless an override (a plain `Partial<ThreadOut>`) says otherwise. */
export function thread(
  overrides?: Partial<ThreadOut & { listing: ListingSummary }>,
): Thread & { listing: ListingSummary };
export function thread(overrides: Partial<ThreadOut>): Thread;
export function thread(overrides: Partial<ThreadOut> = {}): Thread {
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
    tour: null,
    ...overrides,
  } as Thread;
}

/** An open, read direct chat (two people, no listing, spec 0010g) with no messages. */
export function directConversation(overrides: Partial<ConversationOut> = {}): Conversation {
  n += 1;
  return {
    id: uuid('f'),
    listing: null,
    other_name: `Person ${String(n)}`,
    other_photo_url: null,
    my_role: 'person',
    member_count: 2,
    can_send: true,
    is_new: false,
    unread_count: 0,
    last_message: null,
    created_at: '2026-11-10T10:00:00Z',
    ...overrides,
  } as Conversation;
}

/** An open direct thread with no messages: the two people, both `person`. */
export function directThread(overrides: Partial<ThreadOut> = {}): Thread {
  n += 1;
  return {
    id: uuid('b'),
    listing: null,
    other_name: 'מיכל',
    other_photo_url: null,
    my_role: 'person',
    members: [
      { name: 'דנה', photo_url: null, role: 'person', is_me: true },
      { name: 'מיכל', photo_url: null, role: 'person', is_me: false },
    ],
    visible_from: null,
    can_send: true,
    messages: [],
    truncated: false,
    tour: null,
    ...overrides,
  } as Thread;
}
