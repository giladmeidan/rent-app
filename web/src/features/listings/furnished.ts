import type { TFunction } from 'i18next';

import type { Furnished, ListingType } from './api';

/**
 * "מרוהטת" for an apartment, "מרוהט" for a room (spec 0009b): a room is described as a room. `null`
 * (the wizard before a type is picked) reads the apartment forms. Two literal maps, so `i18n-check`
 * sees every key.
 */
export function furnishedLabel(
  t: TFunction,
  furnished: Furnished,
  listingType: ListingType | null,
): string {
  if (listingType === 'room') {
    return {
      none: t('listings.furnishedRoom.none'),
      partial: t('listings.furnishedRoom.partial'),
      full: t('listings.furnishedRoom.full'),
    }[furnished];
  }
  return {
    none: t('listings.furnished.none'),
    partial: t('listings.furnished.partial'),
    full: t('listings.furnished.full'),
  }[furnished];
}
