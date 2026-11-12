// A room's flatmates and who it is for, as words (spec 0007f): the search card, the listing page's
// room block and the apply gate say them the same way.
import type { TFunction } from 'i18next';

import type { ListingPublic } from '../listings/api';

export type GenderPreference = ListingPublic['gender_preference'];

type Flatmates = {
  /** `null` / missing: a room from before 0007a, or the wizard's body before 0007e. */
  flatmates_count?: number | null | undefined;
  /** Optional, possibly fewer than the count, and empty for a visitor or an owner (room privacy). */
  flatmate_ages?: readonly number[] | undefined;
};

/** "2 שותפים (27, 30)", "שותף/ה אחד/ת", "2 שותפים", and "2 שותפים (30, ?)" when fewer ages than
 * flatmates are given (spec 0009b); `null` when the count is not known. Ages keep the API's order. */
export function flatmatesText(t: TFunction, { flatmates_count, flatmate_ages }: Flatmates) {
  if (flatmates_count === null || flatmates_count === undefined) return null;
  const flatmates = t('rooms.flatmates', { count: flatmates_count });
  const ages = withUnknownAges(t, flatmate_ages ?? [], flatmates_count);
  if (ages.length === 0) return flatmates;
  // Punctuation, not copy: European digits and "?" keep the paragraph's RTL order (UAX 9 N1).
  return t('rooms.flatmatesWithAges', { flatmates, ages: ages.join(', ') });
}

/** The known ages followed by one `rooms.flatmateAgeUnknown` per flatmate without an age; empty
 * when no age is known (a visitor gets none, and the line then has no parentheses). */
export function withUnknownAges(t: TFunction, ages: readonly number[], count: number): string[] {
  if (ages.length === 0) return [];
  const missing = Math.max(0, count - ages.length);
  return [
    ...ages.map(String),
    ...Array.from({ length: missing }, () => t('rooms.flatmateAgeUnknown')),
  ];
}

/** "נשים" / "גברים" / "לא משנה". A literal map, so `i18n-check` sees every key. */
export function genderPreferenceLabel(t: TFunction, value: GenderPreference): string {
  return {
    any: t('rooms.genderPreference.any'),
    women: t('rooms.genderPreference.women'),
    men: t('rooms.genderPreference.men'),
  }[value];
}
