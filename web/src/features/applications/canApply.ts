import type { UserOut } from '../../api/client';
import type { ListingDetail } from '../listings/api';

/**
 * Whether the signed-in `me` may apply to (or like) `listing` (spec 0010b): never their own; a
 * room is open to any account; an apartment only to a seeker (apartments keep the roles). The one
 * rule both apply surfaces read (`ApplySection`, `ApplyBar`).
 */
export function canApply(
  me: UserOut,
  listing: Pick<ListingDetail, 'listing_type' | 'is_mine'>,
): boolean {
  return !listing.is_mine && (listing.listing_type === 'room' || me.role === 'seeker');
}
