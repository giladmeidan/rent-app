// Fixtures for the seeker profile screens (spec 0009r, `profile.screens.ts`), shaped as
// features/profile/__tests__/fixtures.ts. Obviously fake data only.
import type { AreaOut, UserOut } from '../../src/api/client';
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
  has_password: false, // spec 0016a
};

export const AREAS: AreaOut[] = [
  {
    id: '00000000-0000-0000-0000-00000000a1a1',
    slug: 's-5000',
    name_he: 'תל אביב-יפו',
    kind: 'settlement',
    parent_id: null,
    centre: [34.7894, 32.07645],
  },
  {
    id: '00000000-0000-0000-0000-00000000a2a2',
    slug: 's-6900',
    name_he: 'כפר סבא',
    kind: 'settlement',
    parent_id: null,
    centre: [34.90724, 32.17521],
  },
  {
    id: '00000000-0000-0000-0000-00000000a3a3',
    slug: 's-3000',
    name_he: 'ירושלים',
    kind: 'settlement',
    parent_id: null,
    centre: [35.20494, 31.77589],
  },
];

const year = new Date().getUTCFullYear();

/** A stored profile with the room section off. */
export const PROFILE: SeekerProfileOut = {
  budget_max_ils: 7500,
  move_in_date: '2027-01-01',
  move_in_flexible: true,
  area_ids: [AREAS[0]?.id ?? '', AREAS[1]?.id ?? ''],
  household: 'couple',
  has_pets: false,
  smoker: false,
  contract_months: 24,
  parking_needed: 1,
  shelter_needed: 'any',
  gender: null,
  birth_year: null,
  flatmate_gender: 'any',
  lifestyle: {},
  people_visible: false,
  about_me: null,
  updated_at: '2026-11-10T10:00:00Z',
};

/** The room section on, every field filled, two questions answered. */
export const PROFILE_ROOM: SeekerProfileOut = {
  ...PROFILE,
  has_pets: true,
  gender: 'woman',
  birth_year: year - 28,
  flatmate_gender: 'women',
  lifestyle: { cleanliness: 3, guests: 2 },
  people_visible: true,
  about_me: 'סטודנטית לעיצוב, אוהבת בישול וערבי משחקים. שקטה בימי חול.',
};
