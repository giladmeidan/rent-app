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

/** "2 שותפים (27, 30)", "שותף/ה אחד/ת", "2 שותפים"; `null` when the count is not known. */
export function flatmatesText(t: TFunction, { flatmates_count, flatmate_ages }: Flatmates) {
  if (flatmates_count === null || flatmates_count === undefined) return null;
  const flatmates =
    flatmates_count === 1
      ? t('rooms.flatmates.one')
      : t('rooms.flatmates.many', { count: flatmates_count });
  const ages = flatmate_ages ?? [];
  if (ages.length === 0) return flatmates;
  // Punctuation, not copy: European digits keep the paragraph's RTL order (UAX 9 N1).
  return t('rooms.flatmates.withAges', { flatmates, ages: ages.join(', ') });
}

/** "נשים" / "גברים" / "לא משנה". A literal map, so `i18n-check` sees every key. */
export function genderPreferenceLabel(t: TFunction, value: GenderPreference): string {
  return {
    any: t('rooms.genderPreference.any'),
    women: t('rooms.genderPreference.women'),
    men: t('rooms.genderPreference.men'),
  }[value];
}
