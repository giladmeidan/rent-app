// The three strings the card's facts line and the listing page's facts line both build.
import type { TFunction } from 'i18next';

import type { Condition, ListingOut, Shelter } from './api';
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

/** "משופצת" (0014b). A literal map, so `i18n-check` sees every key. */
export function conditionLabel(t: TFunction, condition: Condition): string {
  return {
    new: t('listings.condition.new'),
    renovated: t('listings.condition.renovated'),
    good: t('listings.condition.good'),
    needs_work: t('listings.condition.needsWork'),
  }[condition];
}

/** "ממ״ד בדירה" (0015a), the wizard's option and the listing page's fact. A literal map, so
 * `i18n-check` sees every key. */
export function shelterLabel(t: TFunction, shelter: Shelter): string {
  return {
    mamad: t('listings.shelter.mamad'),
    mamak: t('listings.shelter.mamak'),
    building: t('listings.shelter.building'),
    none: t('listings.shelter.none'),
  }[shelter];
}

/** The card's short "ממ״ד" / "ממ״ק" / "מקלט" (0015a); `null` for `none` or not said, which the card
 * does not show. */
export function shelterCardFact(t: TFunction, shelter: Shelter | null): string | null {
  switch (shelter) {
    case 'mamad':
      return t('listings.card.shelter.mamad');
    case 'mamak':
      return t('listings.card.shelter.mamak');
    case 'building':
      return t('listings.card.shelter.building');
    default:
      return null;
  }
}
