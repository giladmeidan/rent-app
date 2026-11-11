// Fixtures for the profile tests; the fetch mock and render helpers are the auth harness's,
// `gushDan` the listings tests'.
import { addDays, todayInIsrael } from '../../listings/format';
import { gushDan } from '../../listings/__tests__/fixtures';
import type { SeekerProfileOut } from '../api';

/** `YYYY-MM-DD`, `days` from today in Israel. */
export const inDays = (days: number) => addDays(todayInIsrael(), days);

/** A stored profile with AC2's values (move-in 30 days ahead), as `GET /me/profile` returns it. */
export function profile(overrides: Partial<SeekerProfileOut> = {}): SeekerProfileOut {
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
    updated_at: '2026-11-10T10:00:00Z',
    ...overrides,
  };
}
