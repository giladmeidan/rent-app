// Fixtures for the listings tests; the fetch mock and render helpers are the auth harness's.
import type { AreaOut, UserOut } from '../../../api/client';
import { noa } from '../../auth/__tests__/harness';
import type { ListingOut, MyListingOut } from '../api';

export const owner: UserOut = { ...noa, role: 'owner', display_name: 'דנה' };
export const seeker: UserOut = { ...noa, role: 'seeker' };

export const gushDan: AreaOut = {
  id: '00000000-0000-0000-0000-00000000a1a1',
  slug: 'gush_dan',
  name_he: 'גוש דן',
};

let n = 0;
/** A live listing (expires far in the future) with no applicants, as `GET /me/listings` returns
 * it, unless overridden. */
export function listing(overrides: Partial<MyListingOut> = {}): MyListingOut {
  n += 1;
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
    owner_id: owner.id,
    status: 'active',
    listing_type: 'apartment',
    area_id: gushDan.id,
    city: 'רמת גן',
    street: `ביאליק ${String(n)}`,
    rooms: 3,
    floor: 2,
    total_floors: 4,
    size_sqm: 80,
    price_ils: 6000,
    available_from: '2026-12-01',
    entry_flexible: false,
    elevator: false,
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

/** `l` as `POST` / `PATCH /listings` answer it: a `ListingOut`, without the applicant and flatmate
 * counts, the invite-link state and the closure answer (spec 0014b). */
export function withoutCounts(l: MyListingOut): ListingOut {
  const out: ListingOut &
    Partial<
      Pick<
        MyListingOut,
        | 'applicant_count'
        | 'new_applicant_count'
        | 'flatmate_count'
        | 'flatmate_invite_active'
        | 'close_reason'
        | 'final_rent_ils'
      >
    > = {
    ...l,
  };
  delete out.applicant_count;
  delete out.new_applicant_count;
  delete out.flatmate_count;
  delete out.flatmate_invite_active;
  delete out.close_reason;
  delete out.final_rent_ils;
  return out;
}
