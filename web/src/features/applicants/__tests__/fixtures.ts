// Fixtures for the applicants tests; the fetch mock and render helpers are the auth harness's,
// `listing()` / `owner` / `seeker` the listings tests'.
import type { MatchOut } from '../../match/types';
import { inDays } from '../../profile/__tests__/fixtures';
import type { ApplicantOut, ApplicantProfileOut } from '../api';

let n = 0;
/** A submitted applicant as `GET /listings/{id}/applications` returns it, unless overridden. No
 * match, no profile (an applicant from before Slice 6) and no room section (0007c) unless given. */
export function applicant(overrides: Partial<ApplicantOut> = {}): ApplicantOut {
  n += 1;
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, 'b')}`,
    status: 'submitted',
    source: 'apply',
    message: 'Hi, we are a quiet couple',
    applicant_name: `Applicant ${String(n)}`,
    created_at: '2026-11-10T10:00:00Z',
    updated_at: '2026-11-10T10:00:00Z',
    match: null,
    profile: null,
    room: null,
    ...overrides,
  };
}

/** An applicant's housing summary (0006a's `P` without budget or areas: a couple moving in 30 days
 * ahead, no pets, non-smoker, 24 months, one parking spot), unless overridden. */
export function applicantProfile(
  overrides: Partial<ApplicantProfileOut> = {},
): ApplicantProfileOut {
  return {
    household: 'couple',
    move_in_date: inDays(30),
    move_in_flexible: false,
    has_pets: false,
    smoker: false,
    contract_months: 24,
    parking_needed: 1,
    ...overrides,
  };
}

/** A match as `0006b` explains it: `score`, up to three agreeing criteria and one differing. */
export function match(
  score: number,
  agrees: MatchOut['agrees'] = ['budget', 'move_in', 'area'],
  differs: MatchOut['differs'] = null,
): MatchOut {
  return { score, agrees, differs };
}
