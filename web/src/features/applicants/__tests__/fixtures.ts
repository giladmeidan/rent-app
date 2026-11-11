// Fixtures for the applicants tests; the fetch mock and render helpers are the auth harness's,
// `listing()` / `owner` / `seeker` the listings tests'.
import type { ApplicantOut } from '../api';

let n = 0;
/** A submitted applicant as `GET /listings/{id}/applications` returns it, unless overridden. */
export function applicant(overrides: Partial<ApplicantOut> = {}): ApplicantOut {
  n += 1;
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, 'b')}`,
    status: 'submitted',
    message: 'Hi, we are a quiet couple',
    applicant_name: `Applicant ${String(n)}`,
    created_at: '2026-11-10T10:00:00Z',
    updated_at: '2026-11-10T10:00:00Z',
    match: null,
    profile: null,
    ...overrides,
  };
}
