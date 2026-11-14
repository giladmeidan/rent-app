import type { GenderPreference, Household, Poster } from './api';

/** Live listings per owner account (PRODUCT.md "Brokers"). Replaced by `GET /me`'s `listing_cap` in a
 * later slice; until then an admin-raised cap is not reflected in the client's copy. */
export const LISTING_CAP = 3;

/** The households an owner may accept, in the order the wizard and the listing page show them. */
export const HOUSEHOLDS: readonly Household[] = ['single', 'couple', 'family', 'roommates'];

/** Who a room is for, in the order the wizard shows them (display order). */
export const GENDER_PREFERENCES: readonly GenderPreference[] = ['women', 'men', 'any'];

/** Who is behind a room listing (0010f), in the order the wizard shows them (before "לא לציין"). */
export const POSTERS: readonly Poster[] = ['lives_here', 'leaving', 'landlord'];
