// Fixtures for the applications tests; the fetch mock and render helpers are the auth harness's,
// `owner` / `seeker` the listings tests', `listingDetail` the search tests'.
import type { MyApplicationOut } from '../api';

let n = 0;
/** A submitted application to listing `A` as `GET /me/applications` returns it. */
export function application(overrides: Partial<MyApplicationOut> = {}): MyApplicationOut {
  n += 1;
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, 'a')}`,
    status: 'submitted',
    message: 'Hi, we are a quiet couple',
    created_at: '2026-11-10T10:00:00Z',
    updated_at: '2026-11-10T10:00:00Z',
    listing: {
      id: 'A',
      listing_type: 'apartment',
      city: 'רמת גן',
      street: `ביאליק ${String(n)}`,
      rooms: 3,
      price_ils: 6000,
    },
    ...overrides,
  };
}
