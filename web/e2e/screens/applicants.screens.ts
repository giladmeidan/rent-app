// The visual check for the owner's applicant inbox (specs 0009l AC10 and 0009u AC7): one screenshot
// per state at each project's size, in web/screens/0009u/. The `d-*` states are the desktop layout
// (0009u) and run in the desktop project only; the 390 set shows the phone layout is unchanged. Every API request is answered here, so it needs only
// the vite server: no sign-up, no OTP. An unmatched request fails the run.
import { expect, type Page, type Route } from '@playwright/test';

import he from '../../src/locales/he.json' with { type: 'json' };
import type { MyListingOut } from '../../src/features/listings/api';
import type { ApplicantOut } from '../../src/features/applicants/api';
import { API } from '../helpers';
import { WEB_ORIGIN } from './origin';
import { test } from '../fixtures';

// --- fixtures, shaped as features/applicants/__tests__/fixtures.ts ---------------------------------

const OWNER = {
  id: '00000000-0000-0000-0000-0000000000aa',
  email: 'dana@example.com',
  display_name: 'דנה',
  role: 'owner',
  account_type: 'standard',
  created_at: '2026-11-10T10:00:00Z',
};

function listing(overrides: Partial<MyListingOut>): MyListingOut {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    owner_id: OWNER.id,
    status: 'active',
    listing_type: 'apartment',
    area_id: '00000000-0000-0000-0000-00000000a1a1',
    city: 'גבעתיים',
    street: 'כצנלסון',
    rooms: 4,
    floor: 2,
    total_floors: 4,
    size_sqm: 95,
    price_ils: 7200,
    available_from: '2027-01-01',
    entry_flexible: false,
    elevator: true,
    parking_spots: 1,
    furnished: 'none',
    pets_allowed: false,
    arnona_ils: null,
    vaad_ils: null,
    description: null,
    accepted_households: ['single', 'couple', 'family', 'roommates'],
    smoking_allowed: true,
    min_contract_months: null,
    gender_preference: 'any',
    flatmates_count: null,
    flatmate_ages: [],
    lifestyle: {},
    room_size_sqm: null, // spec 0010f: the flat facts
    private_bathroom: null,
    balcony: null,
    bills_included: null,
    poster: null,
    safe_room: null, // spec 0014b: the apartment facts
    air_conditioning: null,
    condition: null,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    expires_at: '2099-01-01T10:00:00Z',
    photos: [], // spec 0010d
    applicant_count: 5,
    new_applicant_count: 2,
    flatmate_count: 0,
    flatmate_invite_active: false,
    close_reason: null, // spec 0014b: the owner's closure answer
    final_rent_ils: null,
    ...overrides,
  };
}

const APARTMENT = listing({});
const ROOM = listing({
  id: '00000000-0000-0000-0000-000000000002',
  listing_type: 'room',
  rooms: 3,
  street: 'ביאליק',
  city: 'רמת גן',
  price_ils: 3100,
  flatmates_count: 2,
  lifestyle: { cleanliness: 1, guests: 2 },
});

let counter = 0;
function applicant(overrides: Partial<ApplicantOut>): ApplicantOut {
  counter += 1;
  return {
    id: `00000000-0000-0000-0000-${String(counter).padStart(12, 'b')}`,
    status: 'submitted',
    source: 'apply',
    message: 'שלום, אנחנו זוג שקט, לא מעשנים ועם חוזה ארוך.',
    applicant_name: `מועמד ${String(counter)}`,
    photo_url: null,
    created_at: '2026-11-10T10:00:00Z',
    updated_at: '2026-11-10T10:00:00Z',
    match: null,
    profile: null,
    room: null,
    ...overrides,
  };
}

const profile = (overrides: Partial<NonNullable<ApplicantOut['profile']>> = {}) => ({
  household: 'couple' as const,
  move_in_date: '2027-01-01',
  move_in_flexible: false,
  has_pets: false,
  smoker: false,
  contract_months: 24 as const,
  parking_needed: 1,
  ...overrides,
});

const five: ApplicantOut[] = [
  applicant({
    applicant_name: 'דנה ושי',
    created_at: '2026-11-10T12:00:00Z',
    match: { score: 94, agrees: ['contract', 'smoking', 'budget'], differs: null },
    profile: profile({ move_in_flexible: true }),
  }),
  applicant({
    applicant_name: 'עומר לוי',
    status: 'shortlisted',
    created_at: '2026-11-09T12:00:00Z',
    message: 'שלום, אני רופא שיניים עם כלב קטן.',
    match: { score: 88, agrees: ['budget', 'move_in'], differs: null },
    profile: profile({ household: 'single', has_pets: true }),
  }),
  applicant({
    applicant_name: 'מאיה כהן',
    created_at: '2026-11-08T12:00:00Z',
    match: { score: 71, agrees: ['smoking', 'area'], differs: 'move_in' },
    profile: profile({ household: 'roommates', move_in_date: '2027-02-01' }),
  }),
  applicant({
    applicant_name: 'אלון בר',
    status: 'declined',
    created_at: '2026-11-07T12:00:00Z',
  }),
  applicant({
    applicant_name: 'רוני ושי מזרחי־כהן',
    status: 'shortlisted',
    source: 'like',
    message: null,
    created_at: '2026-11-06T12:00:00Z',
    match: { score: 86, agrees: ['budget', 'area'], differs: null },
    profile: profile({ household: 'family' }),
  }),
];

const LONG_MESSAGE = [
  'שלום, שמנו לב למודעה שלכם והיא נראית בדיוק מה שאנחנו מחפשים.',
  '',
  'אנחנו זוג, שנינו עובדים מהבית יומיים בשבוע,',
  'לא מעשנים ובלי חיות מחמד.',
  'יש לנו שלוש שנים של שכירות רציפה בדירה הנוכחית,',
  'ובעלת הבית תשמח לתת המלצה.',
  '',
  'חשוב לנו חוזה ארוך, כי אנחנו מתכננים להישאר באזור,',
  'ואנחנו גמישים לגבי מועד הכניסה בכמה שבועות.',
  'נשמח להגיע לראות את הדירה בכל זמן שנוח לכם,',
  'ואם צריך אפשר גם לשלוח תלושי שכר.',
  'תודה רבה ושיהיה שבוע טוב!',
].join('\n');

const roomApplicant = applicant({
  applicant_name: 'מיכל אברהם',
  created_at: '2026-11-10T12:00:00Z',
  match: { score: 82, agrees: ['budget', 'area', 'lifestyle'], differs: null },
  profile: profile({ household: 'single' }),
  room: { gender: 'woman', age: 27, lifestyle: { cleanliness: 3, guests: 2 } },
});

// --- the mocked API --------------------------------------------------------------------------------

type Mode = 'pending' | 'error' | 'ok';
type Setup = {
  mine?: Mode;
  listings?: MyListingOut[];
  applicants?: Mode;
  list?: ApplicantOut[];
  patch?: 'error' | 'ok';
};

const CORS = {
  'Access-Control-Allow-Origin': WEB_ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
};

const reply = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: CORS,
    body: JSON.stringify(body),
  });

async function mockApi(page: Page, setup: Setup): Promise<string[]> {
  const unmatched: string[] = [];
  const { mine = 'ok', listings = [APARTMENT], applicants = 'ok', list = [], patch = 'ok' } = setup;
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const key = `${request.method()} ${pathname}`;
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...CORS,
          'Access-Control-Allow-Methods': 'GET, PATCH',
          'Access-Control-Allow-Headers': 'content-type',
        },
      });
    }
    if (pathname === '/me/events') return route.abort();
    if (key === 'GET /me') return reply(route, OWNER);
    if (key === 'GET /me/conversations') return reply(route, []);
    if (key === 'GET /me/listings') {
      // A held request never answers: the page stays on its loading state.
      if (mine === 'pending') return new Promise<void>(() => {});
      return mine === 'error' ? reply(route, { detail: 'boom' }, 500) : reply(route, listings);
    }
    const applications = /^\/listings\/[^/]+\/applications$/.exec(pathname);
    if (request.method() === 'GET' && applications !== null) {
      if (applicants === 'pending') return new Promise<void>(() => {});
      return applicants === 'error' ? reply(route, { detail: 'boom' }, 500) : reply(route, list);
    }
    const one = /^\/listings\/[^/]+\/applications\/([^/]+)$/.exec(pathname);
    if (request.method() === 'PATCH' && one !== null) {
      if (patch === 'error') return reply(route, { detail: 'boom' }, 500);
      const found = list.find((a) => a.id === one[1]);
      const body = request.postDataJSON() as { status: ApplicantOut['status'] };
      return reply(route, { ...found, status: body.status });
    }
    unmatched.push(key);
    return route.fulfill({ status: 500, headers: CORS, body: `unmatched ${key}` });
  });
  return unmatched;
}

// --- the states ------------------------------------------------------------------------------------

const inbox = (l: MyListingOut) => `/me/listings/${l.id}/applicants`;
const title = new RegExp(`^${he.applicants.titleFor}`);
const tab = (page: Page, label: string) => page.getByRole('tab', { name: new RegExp(`^${label}`) });

type State = {
  name: string;
  setup: Setup;
  path: string;
  /** What to wait for, and do, before the shot. */
  act: (page: Page) => Promise<void>;
  /** The one project that runs it (the phone's disclosures do not exist on the desktop card). */
  only?: 'mobile' | 'desktop';
};

const STATES: State[] = [
  {
    name: 'listings-loading',
    setup: { mine: 'pending' },
    path: inbox(APARTMENT),
    act: async (page) => {
      await expect(page.getByText(he.common.loading)).toBeAttached();
    },
  },
  {
    name: 'listings-error',
    setup: { mine: 'error' },
    path: inbox(APARTMENT),
    act: async (page) => {
      await expect(page.getByRole('button', { name: he.common.retry })).toBeVisible();
    },
  },
  {
    name: 'not-found',
    setup: {},
    path: '/me/listings/00000000-0000-0000-0000-0000000000ff/applicants',
    act: async (page) => {
      await expect(
        page.getByRole('heading', { level: 1, name: he.applicants.notFound }),
      ).toBeVisible();
    },
  },
  {
    name: 'applicants-loading',
    setup: { applicants: 'pending' },
    path: inbox(APARTMENT),
    act: async (page) => {
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.getByTestId('skeleton')).toHaveCount(3);
    },
  },
  {
    name: 'applicants-error',
    setup: { applicants: 'error' },
    path: inbox(APARTMENT),
    act: async (page) => {
      await expect(page.getByRole('button', { name: he.common.retry })).toBeVisible();
    },
  },
  {
    name: 'empty',
    setup: { list: [] },
    path: inbox(APARTMENT),
    act: async (page) => {
      await expect(page.getByText(he.applicants.empty)).toBeVisible();
    },
  },
  {
    name: 'all',
    setup: { list: five },
    path: inbox(APARTMENT),
    act: async (page) => {
      await expect(page.getByRole('article')).toHaveCount(5);
    },
  },
  {
    name: 'room',
    setup: { listings: [ROOM], list: [roomApplicant] },
    path: inbox(ROOM),
    act: async (page) => {
      await expect(page.getByRole('article')).toHaveCount(1);
    },
  },
  {
    name: 'disclosures-open',
    only: 'mobile',
    setup: { listings: [ROOM], list: [roomApplicant] },
    path: inbox(ROOM),
    act: async (page) => {
      await page.getByRole('button', { name: he.applicants.why }).click();
      await page.getByRole('button', { name: he.applicants.more }).click();
      await expect(page.getByRole('button', { name: he.applicants.more })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    },
  },
  {
    name: 'filter-new-newest',
    setup: { list: five },
    path: inbox(APARTMENT),
    act: async (page) => {
      await tab(page, 'חדשות').click();
      await page.getByRole('button', { name: he.applicants.sort.newest }).click();
      await expect(page.getByRole('article')).toHaveCount(2);
    },
  },
  {
    name: 'filter-empty',
    setup: { list: five.filter((a) => a.status !== 'declined') },
    path: inbox(APARTMENT),
    act: async (page) => {
      await tab(page, 'נדחו').click();
      await expect(page.getByText(he.applicants.emptyFilter)).toBeVisible();
    },
  },
  {
    name: 'decline-dialog',
    setup: { list: five },
    path: inbox(APARTMENT),
    act: async (page) => {
      await page
        .getByRole('article')
        .first()
        .getByRole('button', { name: he.applicants.actions.decline })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
  {
    name: 'long-message',
    only: 'mobile',
    setup: { list: [applicant({ applicant_name: 'דנה ושי', message: LONG_MESSAGE })] },
    path: inbox(APARTMENT),
    act: async (page) => {
      await expect(page.getByRole('button', { name: he.common.showMore })).toBeVisible();
    },
  },
  {
    name: 'long-message-open',
    only: 'mobile',
    setup: { list: [applicant({ applicant_name: 'דנה ושי', message: LONG_MESSAGE })] },
    path: inbox(APARTMENT),
    act: async (page) => {
      await page.getByRole('button', { name: he.common.showMore }).click();
      await expect(page.getByRole('button', { name: he.common.showLess })).toBeVisible();
    },
  },
  {
    name: 'action-error',
    setup: { list: five, patch: 'error' },
    path: inbox(APARTMENT),
    act: async (page) => {
      await page
        .getByRole('article')
        .first()
        .getByRole('button', { name: he.applicants.actions.shortlist })
        .click();
      await expect(page.getByRole('alert')).toBeVisible();
    },
  },
];

// --- the desktop states (0009u) -------------------------------------------------------------------

const pane = (page: Page) => page.getByRole('complementary', { name: he.applicants.pane.label });
const select = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true }).click();

// The loading, error, not-found and empty states are the phone's, captured at the desktop size.
const SHARED = ['applicants-loading', 'applicants-error', 'not-found', 'empty'];
const DESKTOP: State[] = [
  {
    name: 'd-all',
    only: 'desktop',
    setup: { list: five },
    path: inbox(APARTMENT),
    act: async (page) => {
      await expect(page.getByRole('article')).toHaveCount(5);
      await expect(pane(page)).toBeVisible();
    },
  },
  {
    name: 'd-selected-shortlisted',
    only: 'desktop',
    setup: { list: five },
    path: inbox(APARTMENT),
    act: async (page) => {
      await select(page, 'עומר לוי');
      await expect(pane(page).getByRole('link', { name: he.applicants.pane.chat })).toBeVisible();
    },
  },
  {
    name: 'd-selected-noscore',
    only: 'desktop',
    setup: { list: five },
    path: inbox(APARTMENT),
    act: async (page) => {
      await select(page, 'אלון בר');
      await expect(pane(page).getByRole('heading', { level: 2, name: 'אלון בר' })).toBeVisible();
      await expect(pane(page).getByText(he.match.noScore)).toBeVisible();
    },
  },
  {
    name: 'd-room',
    only: 'desktop',
    setup: { listings: [ROOM], list: [roomApplicant] },
    path: inbox(ROOM),
    act: async (page) => {
      await pane(page).getByRole('button', { name: he.applicants.more }).click();
      await expect(pane(page).getByRole('button', { name: he.applicants.more })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    },
  },
  {
    name: 'd-mutual',
    only: 'desktop',
    setup: { list: five },
    path: inbox(APARTMENT),
    act: async (page) => {
      await select(page, 'רוני ושי מזרחי־כהן');
      await expect(pane(page).getByTestId('pane-mutual')).toBeVisible();
      await expect(pane(page).getByTestId('pane-message')).toHaveCount(0);
    },
  },
  {
    name: 'd-long-message',
    only: 'desktop',
    setup: { list: [applicant({ applicant_name: 'דנה ושי', message: LONG_MESSAGE })] },
    path: inbox(APARTMENT),
    act: async (page) => {
      await expect(pane(page).getByTestId('pane-message')).toBeVisible();
      // The pane scrolls inside itself when it is taller than the viewport: show the end.
      await pane(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
    },
  },
  {
    name: 'd-filter-empty',
    only: 'desktop',
    setup: { list: five.filter((a) => a.status !== 'declined') },
    path: inbox(APARTMENT),
    act: async (page) => {
      await tab(page, 'נדחו').click();
      await expect(page.getByText(he.applicants.emptyFilter)).toBeVisible();
      await expect(page.getByRole('complementary')).toHaveCount(0);
    },
  },
  {
    name: 'd-decline-dialog',
    only: 'desktop',
    setup: { list: five },
    path: inbox(APARTMENT),
    act: async (page) => {
      await page
        .getByRole('article')
        .first()
        .getByRole('button', { name: he.applicants.actions.decline })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
  ...STATES.filter((state) => SHARED.includes(state.name)).map((state): State => ({
    ...state,
    name: `d-${state.name.replace('applicants-', '')}`,
    only: 'desktop',
  })),
  {
    // One grid column next to the pane: a desktop project resized to the narrowest desktop width.
    name: 'd-1024',
    only: 'desktop',
    setup: { list: five },
    path: inbox(APARTMENT),
    act: async (page) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      await expect(page.getByRole('article')).toHaveCount(5);
      await expect(pane(page)).toBeVisible();
    },
  },
];

for (const state of [...STATES, ...DESKTOP]) {
  test(state.name, async ({ page }, testInfo) => {
    test.skip(
      state.only !== undefined && state.only !== testInfo.project.name,
      `${state.name} is a ${state.only ?? ''} state`,
    );
    const unmatched = await mockApi(page, state.setup);
    await page.goto(state.path);
    await state.act(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      // A modal is fixed to the viewport, so a full-page capture would misplace it and its backdrop.
      fullPage: !state.name.endsWith('decline-dialog'),
      animations: 'disabled',
      path: `screens/0009u/${state.name}-${testInfo.project.name}.png`,
    });
    expect(unmatched, 'unmatched API requests').toEqual([]);
  });
}
