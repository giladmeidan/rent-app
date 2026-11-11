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
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    expires_at: '2099-01-01T10:00:00Z',
    applicant_count: 0,
    new_applicant_count: 0,
    ...overrides,
  };
}

/** `l` as `POST` / `PATCH /listings` answer it: a `ListingOut`, without the applicant counts. */
export function withoutCounts(l: MyListingOut): ListingOut {
  const out: ListingOut & Partial<Pick<MyListingOut, 'applicant_count' | 'new_applicant_count'>> = {
    ...l,
  };
  delete out.applicant_count;
  delete out.new_applicant_count;
  return out;
}
