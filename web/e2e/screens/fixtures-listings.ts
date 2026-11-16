// Fixtures for the listing wizard screens (spec 0009k, `listings.screens.ts`), shaped as
// features/listings/__tests__/fixtures.ts. Obviously fake data only.
import type { AreaOut, UserOut } from '../../src/api/client';
import type { MyListingOut } from '../../src/features/listings/api';

export const OWNER: UserOut = {
  id: '00000000-0000-0000-0000-0000000000aa',
  email: 'roni@example.com',
  display_name: 'רוני',
  role: 'owner',
  account_type: 'standard',
  created_at: '2026-11-10T10:00:00Z',
  photo_url: null,
  listing_cap: 3,
  has_password: false, // spec 0016a
};

export const AREA: AreaOut = {
  id: '00000000-0000-0000-0000-00000000a1a1',
  slug: 'gush_dan',
  name_he: 'גוש דן',
};

export const LISTING_ID = '00000000-0000-0000-0000-000000000001';
export const UNKNOWN_ID = '00000000-0000-0000-0000-0000000000ff';

/** An apartment in Givatayim as the artboard shows it (4 rooms, floor 3 of 5, 95 m2, 7,200 NIS). */
export function listing(overrides: Partial<MyListingOut> = {}): MyListingOut {
  return {
    id: LISTING_ID,
    owner_id: OWNER.id,
    status: 'active',
    listing_type: 'apartment',
    area_id: AREA.id,
    city: 'גבעתיים',
    street: 'כצנלסון',
    rooms: 4,
    floor: 3,
    total_floors: 5,
    size_sqm: 95,
    price_ils: 7200,
    available_from: '2027-01-01',
    entry_flexible: false,
    elevator: true,
    parking_spots: 1,
    furnished: 'partial',
    pets_allowed: true,
    arnona_ils: 480,
    vaad_ils: null,
    description: 'דירה מוארת',
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
    shelter: null, // spec 0015a: the flat's protected space
    air_conditioning: null, // spec 0014b: the apartment facts
    condition: null,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    expires_at: '2099-01-01T10:00:00Z',
    removed: false, // spec 0012a
    photos: [], // spec 0010d
    applicant_count: 0,
    new_applicant_count: 0,
    flatmate_count: 0,
    flatmate_invite_active: false,
    close_reason: null, // spec 0014b: the owner's closure answer
    final_rent_ils: null,
    ...overrides,
  };
}

/** Past its expiry: the edit page refuses it. */
export const EXPIRED = listing({ expires_at: '2026-10-01T10:00:00Z' });
