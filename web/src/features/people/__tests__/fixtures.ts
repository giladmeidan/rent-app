// Fixtures for the people tests; the fetch mock and render helpers are the auth harness's.
import { match } from '../../applicants/__tests__/fixtures';
import { inDays } from '../../profile/__tests__/fixtures';
import type { PersonCardOut, PersonOut } from '../api';

let n = 0;
/** A person as `GET /listings/{id}/people` returns it, unless overridden: a 27-year-old woman,
 * liked by nobody, matching on budget and differing on pets. */
export function person(overrides: Partial<PersonOut> = {}): PersonOut {
  n += 1;
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, 'c')}`,
    display_name: `Person ${String(n)}`,
    photo_url: null,
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

let cardN = 0;
/** A person's card as `GET /people` returns it, unless overridden: a 27-year-old woman who has
 * answered nothing, liked by nobody. */
export function personCard(overrides: Partial<PersonCardOut> = {}): PersonCardOut {
  cardN += 1;
  return {
    card_id: `00000000-0000-0000-0000-${String(cardN).padStart(12, 'd')}`,
    display_name: `Card ${String(cardN)}`,
    gender: 'woman',
    age: 27,
    area_ids: [],
    move_in_date: inDays(30),
    move_in_flexible: false,
    lifestyle: {},
    about_me: null,
    photo_url: null,
    liked_by_me: false,
    liked_me: false,
    ...overrides,
  };
}
