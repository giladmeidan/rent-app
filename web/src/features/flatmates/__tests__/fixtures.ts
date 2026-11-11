// Fixtures for the flatmates tests; the fetch mock and render helpers are the auth harness's.
import type { FlatmateOut, InvitePreviewOut } from '../api';

let n = 0;
/** A flatmate as `GET /listings/{id}/flatmates` returns it, unless overridden. */
export function flatmate(overrides: Partial<FlatmateOut> = {}): FlatmateOut {
  n += 1;
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, 'f')}`,
    display_name: `Flatmate ${String(n)}`,
    joined_at: '2026-11-01T08:00:00Z',
    ...overrides,
  };
}

/** The preview of an invite to a 4-room room in Givatayim by רוני, unless overridden. */
export function invitePreview(overrides: Partial<InvitePreviewOut> = {}): InvitePreviewOut {
  return {
    listing: {
      id: '00000000-0000-0000-0000-0000000000d1',
      listing_type: 'room',
      city: 'גבעתיים',
      street: 'כצנלסון',
      rooms: 4,
      price_ils: 3200,
    },
    owner_name: 'רוני',
    member: false,
    ...overrides,
  };
}
