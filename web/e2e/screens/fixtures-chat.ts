// Fixtures for the chat screens (spec 0009s, `chat.screens.ts`), shaped as
// features/chat/__tests__/fixtures.ts.
import type { UserOut } from '../../src/api/client';
import type { ConversationOut, MessageOut, ThreadOut } from '../../src/features/chat/api';

export const OWNER: UserOut = {
  id: '00000000-0000-0000-0000-0000000000aa',
  email: 'roni@example.com',
  display_name: 'רוני',
  role: 'owner',
  account_type: 'standard',
  created_at: '2026-11-10T10:00:00Z',
  photo_url: null,
  listing_cap: 3,
};

/** A seeker who is also a flatmate in רוני's room. */
export const FLATMATE: UserOut = {
  id: '00000000-0000-0000-0000-0000000000bb',
  email: 'dana@example.com',
  display_name: 'דנה',
  role: 'seeker',
  account_type: 'standard',
  created_at: '2026-11-10T10:00:00Z',
  photo_url: null,
  listing_cap: 3,
};

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const ROOM: ConversationOut['listing'] = {
  id: id(901),
  listing_type: 'room',
  city: 'רמת גן',
  street: 'ביאליק',
  rooms: 3,
  price_ils: 3100,
};

const APARTMENT: ConversationOut['listing'] = {
  id: id(902),
  listing_type: 'apartment',
  city: 'תל אביב-יפו',
  street: 'שדרות רוטשילד',
  rooms: 4,
  price_ils: 8200,
};

export const ONE_TO_ONE_ID = id(1);
export const GROUP_ID = id(2);
export const CLOSED_ID = id(5);
export const EMPTY_ID = id(6);
/** An id the list does not hold: the thread answers 404. */
export const MISSING_ID = id(99);

function conversation(n: number, overrides: Partial<ConversationOut>): ConversationOut {
  return {
    id: id(n),
    listing: APARTMENT,
    other_name: 'מיכל',
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

const last = (body: string, mine = false, at = '2026-11-11T09:12:00Z') => ({
  body,
  mine,
  created_at: at,
});

/** Six rows: unread 3, new, a flatmate's group of 4, closed, no messages, one long Latin name. */
export const SIX_ROWS: ConversationOut[] = [
  conversation(1, {
    other_name: 'מיכל',
    unread_count: 3,
    last_message: last('אפשר לבוא לראות מחר בערב?'),
  }),
  conversation(2, {
    other_name: 'נועה',
    listing: ROOM,
    my_role: 'flatmate',
    member_count: 4,
    is_new: true,
    last_message: last('היי, אני דנה, גרה בדירה כבר שנה', true),
  }),
  conversation(3, {
    other_name: 'Alexandra Montgomery-Fitzgerald',
    last_message: last('Sounds great, see you on Sunday at the flat!'),
  }),
  conversation(4, { other_name: 'יוסי', is_new: true }),
  conversation(5, {
    other_name: 'עומר',
    can_send: false,
    last_message: last('תודה, מצאנו דירה אחרת', false, '2026-11-02T18:40:00Z'),
  }),
  conversation(6, { other_name: 'שירה' }),
];

let m = 0;
function message(body: string, mine: boolean, sender: string, at: string): MessageOut {
  m += 1;
  return { id: id(500 + m), body, mine, sender_name: sender, created_at: at };
}

const SIX_LINES = [
  'שלום! ראיתי את המודעה ויש לי כמה שאלות:',
  '1. האם הדירה פנויה מינואר?',
  '2. האם יש מקום לאופניים?',
  '3. האם החשבונות כלולים בשכר הדירה?',
  '4. כמה זמן החוזה?',
  'תודה מראש!',
].join('\n');

const MICHAL = 'מיכל';
const ME = 'דנה';

/** A 1:1 thread with eight messages (one of six lines, one Latin). */
export function oneToOne(overrides: Partial<ThreadOut> = {}): ThreadOut {
  return {
    id: ONE_TO_ONE_ID,
    listing: APARTMENT,
    other_name: MICHAL,
    other_photo_url: null,
    my_role: 'seeker',
    members: [
      { name: MICHAL, photo_url: null, role: 'owner', is_me: false },
      { name: ME, photo_url: null, role: 'seeker', is_me: true },
    ],
    visible_from: null,
    can_send: true,
    truncated: false,
    messages: [
      message('היי, הדירה עדיין פנויה?', true, ME, '2026-11-10T08:00:00Z'),
      message('כן! מתי נוח לך לבוא?', false, MICHAL, '2026-11-10T08:05:00Z'),
      message(SIX_LINES, true, ME, '2026-11-10T08:20:00Z'),
      message('ינואר כן, אופניים במחסן, חשבונות לא כלולים.', false, MICHAL, '2026-11-10T09:00:00Z'),
      message('החוזה לשנה עם אופציה.', false, MICHAL, '2026-11-10T09:01:00Z'),
      message('Great, thanks! Could we meet on Sunday?', true, ME, '2026-11-10T09:30:00Z'),
      message('ראשון ב־18:00 מתאים', false, MICHAL, '2026-11-10T10:00:00Z'),
      message('מעולה, נתראה', true, ME, '2026-11-10T10:02:00Z'),
    ],
    ...overrides,
  };
}

// Long names (the API allows 40 characters), so the line is cut at two lines on a phone.
const SIX_MEMBERS: ThreadOut['members'] = [
  { name: 'רוני שמואלי-בן חיים', photo_url: null, role: 'owner', is_me: false },
  { name: ME, photo_url: null, role: 'flatmate', is_me: true },
  { name: 'יעל אברהמי-רוזנברג', photo_url: null, role: 'flatmate', is_me: false },
  { name: 'Maya Rosenberg-Levi', photo_url: null, role: 'flatmate', is_me: false },
  { name: 'Alexandra Montgomery-Fitzgerald', photo_url: null, role: 'flatmate', is_me: false },
  { name: 'נועה', photo_url: null, role: 'seeker', is_me: false },
];

/** A flatmate's group thread: six members, sender names, the joined and truncated notes. */
export function group(): ThreadOut {
  return {
    id: GROUP_ID,
    listing: ROOM,
    other_name: 'נועה',
    other_photo_url: null,
    my_role: 'flatmate',
    members: SIX_MEMBERS,
    visible_from: '2026-11-09T12:00:00Z',
    can_send: true,
    truncated: true,
    messages: [
      message('נעים מאוד, אני נועה', false, 'נועה', '2026-11-10T08:00:00Z'),
      message('מחפשת חדר מינואר', false, 'נועה', '2026-11-10T08:01:00Z'),
      message(
        'ברוכה הבאה! אני רוני, בעל הדירה',
        false,
        'רוני שמואלי-בן חיים',
        '2026-11-10T08:10:00Z',
      ),
      message('היי, אני דנה, גרה בדירה כבר שנה', true, ME, '2026-11-10T08:30:00Z'),
      message(
        'Hi! Maya here, happy to show you around',
        false,
        'Maya Rosenberg-Levi',
        '2026-11-10T09:00:00Z',
      ),
    ],
  };
}

/** The group's list row, for the group states. */
export const GROUP_ROW = SIX_ROWS[1] as ConversationOut;

export function closed(): ThreadOut {
  return oneToOne({
    id: CLOSED_ID,
    other_name: 'עומר',
    can_send: false,
    messages: [
      message('הדירה עדיין פנויה?', true, ME, '2026-11-02T18:00:00Z'),
      message('תודה, מצאנו דירה אחרת', false, 'עומר', '2026-11-02T18:40:00Z'),
    ],
  });
}

export function empty(): ThreadOut {
  return oneToOne({ id: EMPTY_ID, other_name: 'שירה', messages: [] });
}
