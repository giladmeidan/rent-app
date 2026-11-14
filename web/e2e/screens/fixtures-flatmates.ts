// Fixtures for the flatmates screens (spec 0009qb, `flatmates.screens.ts`), shaped as
// features/flatmates/__tests__/fixtures.ts and features/listings/__tests__/fixtures.ts.
import type { FlatmateOut, InvitePreviewOut, MyFlatOut } from '../../src/features/flatmates/api';
import type { MyListingOut } from '../../src/features/listings/api';

export const OWNER = {
  id: '00000000-0000-0000-0000-0000000000aa',
  email: 'roni@example.com',
  display_name: 'רוני',
  role: 'owner',
  account_type: 'standard',
  created_at: '2026-11-10T10:00:00Z',
};

export const SEEKER = {
  id: '00000000-0000-0000-0000-0000000000bb',
  email: 'noa@example.com',
  display_name: 'נועה',
  role: 'seeker',
  account_type: 'standard',
  created_at: '2026-11-10T10:00:00Z',
};

/** A room in Ramat Gan, listed by רוני, with no invite link unless overridden. */
export function room(overrides: Partial<MyListingOut> = {}): MyListingOut {
  return {
    id: '00000000-0000-0000-0000-000000000002',
    owner_id: OWNER.id,
    status: 'active',
    listing_type: 'room',
    area_id: '00000000-0000-0000-0000-00000000a1a1',
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
    furnished: 'partial',
    pets_allowed: false,
    arnona_ils: null,
    vaad_ils: null,
    description: null,
    accepted_households: ['single', 'couple', 'family', 'roommates'],
    smoking_allowed: false,
    min_contract_months: null,
    gender_preference: 'any',
    flatmates_count: 2,
    flatmate_ages: [27, 30],
    lifestyle: { cleanliness: 1, guests: 2 },
    room_size_sqm: null, // spec 0010f: the flat facts
    private_bathroom: null,
    balcony: null,
    bills_included: null,
    poster: null,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    expires_at: '2099-01-01T10:00:00Z',
    photos: [], // spec 0010d
    applicant_count: 0,
    new_applicant_count: 0,
    flatmate_count: 0,
    flatmate_invite_active: false,
    ...overrides,
  };
}

const flatmate = (n: number, display_name: string, joined_at: string): FlatmateOut => ({
  id: `00000000-0000-0000-0000-${String(n).padStart(12, 'f')}`,
  display_name,
  photo_url: null,
  joined_at,
});

export const TWO_FLATMATES: FlatmateOut[] = [
  flatmate(1, 'דנה כהן', '2026-11-10T23:30:00Z'),
  flatmate(2, 'Yoni Levi', '2026-11-01T08:00:00Z'),
];

/** A third with a long name, to show the wrap. */
export const THREE_FLATMATES: FlatmateOut[] = [
  ...TWO_FLATMATES,
  flatmate(3, 'מיכל אברהמי-רוזנברג', '2026-10-20T08:00:00Z'),
];

/** A token of the API's shape (never rendered: the screens show the link only after a create). */
export const TOKEN = 'k3J9xQv2Lw8sYb7nZt4uPa1cRe6dHf0m';

export const PREVIEW: InvitePreviewOut = {
  listing: {
    id: '00000000-0000-0000-0000-000000000002',
    listing_type: 'room',
    city: 'רמת גן',
    street: 'ביאליק',
    rooms: 3,
    price_ils: 3100,
  },
  owner_name: 'רוני',
  member: false,
};

export const TWO_FLATS: MyFlatOut[] = [
  {
    listing: PREVIEW.listing,
    owner_name: 'רוני',
    joined_at: '2026-11-10T23:30:00Z',
    shown: true, // spec 0010f
  },
  {
    listing: {
      id: '00000000-0000-0000-0000-000000000003',
      listing_type: 'room',
      city: 'תל אביב-יפו',
      street: 'שדרות רוטשילד',
      rooms: 5,
      price_ils: 4800,
    },
    owner_name: 'Avi Mizrahi',
    joined_at: '2026-10-02T08:00:00Z',
    shown: false,
  },
];
