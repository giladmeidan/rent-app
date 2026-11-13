// Fixtures for the profile tests; the fetch mock and render helpers are the auth harness's,
// `gushDan` the listings tests'.
import { addDays, todayInIsrael } from '../../listings/format';
import { gushDan } from '../../listings/__tests__/fixtures';
import type { LookingProfile, SeekerProfileOut } from '../api';

/** `YYYY-MM-DD`, `days` from today in Israel. */
export const inDays = (days: number) => addDays(todayInIsrael(), days);

/** A stored profile with AC2's values (move-in 30 days ahead), as `GET /me/profile` returns it: the
 * looking part filled, no personal part. */
export function profile(overrides: Partial<LookingProfile> = {}): LookingProfile {
  return {
    budget_max_ils: 7500,
    move_in_date: inDays(30),
    move_in_flexible: true,
    area_ids: [gushDan.id],
    household: 'couple',
    has_pets: true,
    smoker: false,
    contract_months: 24,
    parking_needed: 1,
    gender: null,
    birth_year: null,
    flatmate_gender: 'any',
    lifestyle: {},
    people_visible: false,
    about_me: null,
    updated_at: '2026-11-10T10:00:00Z',
    ...overrides,
  };
}

/** A stored profile with only the personal part ("עליי", 0010c): the 7 looking fields `null` and
 * the looking defaults, as `GET /me/profile` returns it. */
export function personalOnlyProfile(overrides: Partial<SeekerProfileOut> = {}): SeekerProfileOut {
  return {
    budget_max_ils: null,
    move_in_date: null,
    move_in_flexible: false,
    area_ids: null,
    household: null,
    has_pets: null,
    smoker: null,
    contract_months: null,
    parking_needed: 0,
    gender: 'woman',
    birth_year: 1996,
    flatmate_gender: 'any',
    lifestyle: { night: 2 },
    people_visible: false,
    about_me: 'Quiet and tidy',
    updated_at: '2026-11-10T10:00:00Z',
    ...overrides,
  };
}
