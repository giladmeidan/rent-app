// The three strings the card's facts line and the listing page's facts line both build.
import type { TFunction } from 'i18next';

import type { ListingOut } from './api';
import { formatDate } from './format';

/** "קומה 3 מתוך 5", or "קומה 3" when the building's height is not known. */
export function floorFact(
  listing: Pick<ListingOut, 'floor' | 'total_floors'>,
  t: TFunction,
): string {
  return listing.total_floors === null
    ? t('listings.card.floor', { floor: listing.floor })
    : t('listings.card.floorOf', { floor: listing.floor, total: listing.total_floors });
}

/** "95 מ״ר". */
export function sizeFact(listing: Pick<ListingOut, 'size_sqm'>, t: TFunction): string {
  return `${String(listing.size_sqm)} ${t('listings.units.sqm')}`;
}

/** "כניסה מיידית" on or before `today` (Israel's calendar day), else "כניסה 1.1.27". */
export function entryFact(
  listing: Pick<ListingOut, 'available_from'>,
  today: string,
  t: TFunction,
): string {
  return listing.available_from <= today
    ? t('listings.card.immediate')
    : t('listings.card.availableFrom', { date: formatDate(listing.available_from) });
}
