// Fixtures for the people tests; the fetch mock and render helpers are the auth harness's.
import { match } from '../../applicants/__tests__/fixtures';
import { inDays } from '../../profile/__tests__/fixtures';
import type { PersonOut } from '../api';

let n = 0;
/** A person as `GET /listings/{id}/people` returns it, unless overridden: a 27-year-old woman,
 * liked by nobody, matching on budget and differing on pets. */
export function person(overrides: Partial<PersonOut> = {}): PersonOut {
  n += 1;
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, 'c')}`,
    display_name: `Person ${String(n)}`,
    gender: 'woman',
    age: 27,
    area_ids: [],
    move_in_date: inDays(30),
    move_in_flexible: false,
    lifestyle: {},
    about_me: null,
    match: match(88, ['budget', 'area'], 'pets'),
    liked_by_me: false,
    liked_me: false,
    ...overrides,
  };
}
