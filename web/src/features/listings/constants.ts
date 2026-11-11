import type { Household } from './api';

/** Live listings per owner account (PRODUCT.md "Brokers"). Replaced by `GET /me`'s `listing_cap` in a
 * later slice; until then an admin-raised cap is not reflected in the client's copy. */
export const LISTING_CAP = 3;

/** The households an owner may accept, in the order the wizard and the listing page show them. */
export const HOUSEHOLDS: readonly Household[] = ['single', 'couple', 'family', 'roommates'];
