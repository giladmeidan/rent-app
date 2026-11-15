// Fixtures for the seeker's list screens (spec 0009qa, `seeker-lists.screens.ts`), shaped as
// features/applications/__tests__/fixtures.ts, features/likes/__tests__/fixtures.ts and
// features/profile/__tests__/fixtures.ts.
import type { UserOut } from '../../src/api/client';
import type { MyApplicationOut } from '../../src/features/applications/api';
import type { LikedRoomOut, MyLikesOut } from '../../src/features/likes/api';
import type { ListingPublic } from '../../src/features/listings/api';
import type { SeekerProfileOut } from '../../src/features/profile/api';

export const SEEKER: UserOut = {
  id: '00000000-0000-0000-0000-0000000000bb',
  email: 'noa@example.com',
  display_name: 'נועה',
  role: 'seeker',
  account_type: 'standard',
  created_at: '2026-11-10T10:00:00Z',
  photo_url: null,
  listing_cap: 3,
};

const year = new Date().getUTCFullYear();

export const PROFILE: SeekerProfileOut = {
  budget_max_ils: 7500,
  move_in_date: '2027-01-01',
  move_in_flexible: true,
  area_ids: ['00000000-0000-0000-0000-00000000a1a1'],
  household: 'couple',
  has_pets: false,
  smoker: false,
  contract_months: 24,
  parking_needed: 0,
  gender: 'woman',
  birth_year: year - 28,
  flatmate_gender: 'any',
  lifestyle: {},
  people_visible: false,
  about_me: null,
  updated_at: '2026-11-10T10:00:00Z',
};

// --- applications ----------------------------------------------------------------------------------

let appCounter = 0;
function application(
  overrides: Partial<Omit<MyApplicationOut, 'listing'>> & {
    listing?: Partial<MyApplicationOut['listing']>;
  },
): MyApplicationOut {
  appCounter += 1;
  const { listing, ...rest } = overrides;
  return {
    id: `00000000-0000-0000-0000-${String(appCounter).padStart(12, 'a')}`,
    status: 'submitted',
    source: 'apply',
    message: 'שלום, אנחנו זוג שקט, לא מעשנים ועם חוזה ארוך.',
    created_at: '2026-11-10T10:00:00Z',
    updated_at: '2026-11-10T10:00:00Z',
    listing: {
      id: `00000000-0000-0000-0000-${String(appCounter).padStart(12, 'c')}`,
      listing_type: 'apartment',
      city: 'גבעתיים',
      street: 'כצנלסון',
      rooms: 4,
      price_ils: 7200,
      ...listing,
    },
    ...rest,
  };
}

/** AC1's five apartments (`/me/applications` lists apartments only since 0010a; ROOM_APPLICATIONS
 * maps them to rooms): a submitted one with a three-line message, shortlisted, declined, withdrawn,
 * mutual. */
export const FIVE_APPLICATIONS: MyApplicationOut[] = [
  application({
    message:
      'שלום, ראינו את המודעה והיא מתאימה לנו בדיוק.\nאנחנו זוג, שנינו עובדים מהבית.\nנשמח לראות את הדירה.',
    created_at: '2026-11-12T08:00:00Z',
  }),
  application({
    status: 'shortlisted',
    created_at: '2026-11-11T08:00:00Z',
    listing: { street: 'ביאליק', city: 'רמת גן', rooms: 3, price_ils: 6400 },
  }),
  application({
    status: 'declined',
    created_at: '2026-11-09T08:00:00Z',
    listing: { street: 'הרצל', city: 'תל אביב', rooms: 2, price_ils: 5900 },
  }),
  application({
    status: 'withdrawn',
    created_at: '2026-11-08T08:00:00Z',
    listing: { street: 'ויצמן', city: 'גבעתיים', rooms: 3, price_ils: 6100 },
  }),
  application({
    status: 'shortlisted',
    source: 'like',
    message: null,
    created_at: '2026-11-07T08:00:00Z',
    listing: { street: 'אלנבי', city: 'תל אביב', rooms: 4, price_ils: 3100 },
  }),
];

// --- likes -----------------------------------------------------------------------------------------

let roomCounter = 0;
function room(overrides: Partial<ListingPublic> = {}): LikedRoomOut {
  roomCounter += 1;
  return {
    listing: {
      id: `00000000-0000-0000-0000-${String(roomCounter).padStart(12, 'd')}`,
      listing_type: 'room',
      city: 'רמת גן',
      street: 'ביאליק',
      rooms: 3,
      floor: 2,
      total_floors: 4,
      size_sqm: 80,
      price_ils: 3100,
      available_from: '2027-01-01',
      entry_flexible: false,
      elevator: true,
      parking_spots: 0,
      furnished: 'none',
      pets_allowed: false,
      arnona_ils: null,
      vaad_ils: null,
      description: null,
      accepted_households: ['single', 'couple', 'family', 'roommates'],
      smoking_allowed: true,
      min_contract_months: null,
      gender_preference: 'any',
      flatmates_count: 2,
      flatmate_ages: [27, 29],
      lifestyle: {},
      room_size_sqm: null, // spec 0010f: the flat facts
      private_bathroom: null,
      balcony: null,
      bills_included: null,
      poster: null,
      shelter: null, // spec 0015a: the flat's protected space
      air_conditioning: null, // spec 0014b: the apartment facts
      condition: null,
      created_at: '2026-11-01T10:00:00Z',
      lat: null,
      lng: null,
      match: null,
      cover: null, // spec 0010d
      is_mine: false,
      ...overrides,
    },
    liked_at: '2026-11-11T09:00:00Z',
  };
}

export const LIKED_ME = room({
  street: 'דיזנגוף',
  city: 'תל אביב',
  price_ils: 3400,
  match: { score: 82, agrees: ['budget', 'area'], differs: null },
});

/** Six rooms that liked the seeker, three of them with a match (spec 0010l: no "mine"). */
export const LIKES: MyLikesOut = {
  liked_me: [
    LIKED_ME,
    room({ street: 'ארלוזורוב', city: 'רמת גן', flatmate_ages: [45, 52] }),
    room({
      street: 'הנביאים',
      city: 'גבעתיים',
      match: { score: 91, agrees: ['budget', 'move_in'], differs: null },
    }),
    room({ street: 'רוטשילד', city: 'תל אביב', price_ils: 3900 }),
    room({
      street: 'סוקולוב',
      city: 'רמת גן',
      price_ils: 2900,
      match: { score: 64, agrees: ['area'], differs: 'move_in' },
    }),
    room({ street: 'ויצמן', city: 'גבעתיים', price_ils: 3300 }),
  ],
};
