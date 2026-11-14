// Fixtures for the "my listings" screens (spec 0009o, `my-listings.screens.ts`), shaped as
// features/listings/__tests__/fixtures.ts. Obviously fake data only.
import type { MyListingOut } from '../../src/features/listings/api';
import { listing as base, OWNER } from './fixtures-listings';

export { OWNER };

const PAST = '2026-10-01T10:00:00Z';

const card = (id: number, overrides: Partial<MyListingOut>): MyListingOut =>
  base({ id: `00000000-0000-0000-0000-00000000000${String(id)}`, ...overrides });

/** The five cards of AC1: a live apartment, a paused one, an expired one, a live room, a paused room past expiry. */
export const FIVE: MyListingOut[] = [
  card(1, {
    applicant_count: 12,
    new_applicant_count: 5,
    expires_at: '2026-12-12T10:00:00Z',
  }),
  card(2, {
    status: 'paused',
    street: 'ביאליק',
    city: 'רמת גן',
    price_ils: 6400,
    applicant_count: 3,
    expires_at: '2027-01-20T10:00:00Z',
  }),
  card(3, {
    street: 'הרצל',
    price_ils: 5900,
    applicant_count: 1,
    expires_at: PAST,
  }),
  card(4, {
    listing_type: 'room',
    street: 'ויצמן',
    price_ils: 3100,
    rooms: 3,
    flatmates_count: 2,
    applicant_count: 4,
    new_applicant_count: 1,
    flatmate_count: 1,
    expires_at: '2027-01-05T10:00:00Z',
  }),
  card(5, {
    listing_type: 'room',
    status: 'paused',
    street: 'אלנבי',
    city: 'תל אביב',
    price_ils: 3400,
    rooms: 4,
    flatmates_count: 3,
    applicant_count: 0,
    flatmate_count: 2,
    expires_at: PAST,
  }),
];
