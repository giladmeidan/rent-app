// The only place a criterion code becomes copy. Every line is built from the facts that made the
// criterion agree or differ (the listing and the seeker's own profile), never from the code alone:
// `0006b` puts a criterion in `agrees` whenever its partial score is at least 0.5, so e.g. `pets`
// agrees for a seeker without pets on a listing that refuses them.
//
// Keyed by criterion, so the owner's voice (`0006g`: `ownerShort` / `ownerReason`) sits beside it.
import type { TFunction } from 'i18next';

import type { ListingPublic } from '../listings/api';
import { formatDate, formatIls, todayInIsrael } from '../listings/format';
import type { Household, SeekerProfileOut } from '../profile/api';
import type { Criterion, ReasonKind } from './types';

type Line = (listing: ListingPublic, profile: SeekerProfileOut, t: TFunction) => string;
type Short = (
  listing: ListingPublic,
  profile: SeekerProfileOut | undefined,
  t: TFunction,
) => string | null;

/** `YYYY-MM-DD` days compare as strings. */
const later = (a: string, b: string) => (a > b ? a : b);

/** Whether the listing's entry (a past date = now) is after the seeker's move-in (likewise). */
function entersLater(listing: ListingPublic, profile: SeekerProfileOut): boolean {
  const today = todayInIsrael();
  return later(listing.available_from, today) > later(profile.move_in_date, today);
}

function householdName(household: Household, t: TFunction): string {
  return {
    single: t('profile.household.single'),
    couple: t('profile.household.couple'),
    family: t('profile.household.family'),
    roommates: t('profile.household.roommates'),
  }[household];
}

// "זוג או משפחה", "יחיד/ה, זוג או שותפים": the conjunction comes from the locale, not from code.
const disjunction = new Intl.ListFormat('he', { type: 'disjunction' });

const SEEKER: Record<Criterion, Record<ReasonKind, Line>> = {
  budget: {
    agree: (_l, p, t) => t('match.seeker.budget.agree', { budget: formatIls(p.budget_max_ils) }),
    differ: (l, p, t) =>
      t('match.seeker.budget.differ', {
        price: formatIls(l.price_ils),
        budget: formatIls(p.budget_max_ils),
      }),
  },
  move_in: {
    // A stored move-in date may have passed: it then means today.
    agree: (_l, p, t) =>
      t('match.seeker.move_in.agree', {
        date: formatDate(later(p.move_in_date, todayInIsrael())),
      }),
    differ: (l, p, t) => {
      // A later listing date is always in the future, so it is shown as it is.
      if (entersLater(l, p)) {
        return t('match.seeker.move_in.differLate', { date: formatDate(l.available_from) });
      }
      // The page already says "כניסה מיידית" for a past date: no past date here.
      return l.available_from > todayInIsrael()
        ? t('match.seeker.move_in.differEarly', { date: formatDate(l.available_from) })
        : t('match.seeker.move_in.differNow');
    },
  },
  area: {
    agree: (_l, _p, t) => t('match.seeker.area.agree'),
    differ: (_l, _p, t) => t('match.seeker.area.differ'),
  },
  household: {
    agree: (_l, p, t) =>
      t('match.seeker.household.agree', { household: householdName(p.household, t) }),
    // The API returns the households in a fixed order; they are shown in it.
    differ: (l, _p, t) =>
      t('match.seeker.household.differ', {
        households: disjunction.format(l.accepted_households.map((h) => householdName(h, t))),
      }),
  },
  contract: {
    agree: (_l, _p, t) => t('match.seeker.contract.agree'),
    // Contract differs only against a minimum, so it is set.
    differ: (l, _p, t) => t('match.seeker.contract.differ', { months: l.min_contract_months ?? 0 }),
  },
  parking: {
    agree: (l, p, t) => {
      if (p.parking_needed === 0) return t('match.seeker.parking.agreeNotNeeded');
      if (l.parking_spots >= p.parking_needed) return t('match.seeker.parking.agree');
      // Half or more of the spots asked for: one of two.
      return t('match.seeker.parking.agreePartial');
    },
    differ: (l, p, t) => {
      if (l.parking_spots === 0) return t('match.seeker.parking.differNone');
      return t('match.seeker.parking.differ', {
        needed: p.parking_needed,
        spots:
          l.parking_spots === 1
            ? t('listing.parkingOne')
            : t('listing.parkingMany', { count: l.parking_spots }),
      });
    },
  },
  smoking: {
    agree: (l, _p, t) =>
      l.smoking_allowed
        ? t('match.seeker.smoking.agree')
        : t('match.seeker.smoking.agreeNoSmoking'),
    differ: (_l, _p, t) => t('match.seeker.smoking.differ'),
  },
  pets: {
    agree: (l, _p, t) =>
      l.pets_allowed ? t('match.seeker.pets.agree') : t('match.seeker.pets.agreeNoPets'),
    differ: (_l, _p, t) => t('match.seeker.pets.differ'),
  },
};

const SEEKER_SHORT: Record<Criterion, Record<ReasonKind, Short>> = {
  budget: {
    agree: (_l, _p, t) => t('match.short.budget.agree'),
    differ: (_l, _p, t) => t('match.short.budget.differ'),
  },
  move_in: {
    agree: (_l, _p, t) => t('match.short.move_in.agree'),
    // The direction needs the profile; without it the chip is left out.
    differ: (l, p, t) => {
      if (p === undefined) return null;
      return entersLater(l, p)
        ? t('match.short.move_in.differLate')
        : t('match.short.move_in.differEarly');
    },
  },
  area: {
    agree: (_l, _p, t) => t('match.short.area.agree'),
    differ: (_l, _p, t) => t('match.short.area.differ'),
  },
  household: {
    agree: (_l, _p, t) => t('match.short.household.agree'),
    differ: (_l, _p, t) => t('match.short.household.differ'),
  },
  contract: {
    agree: (_l, _p, t) => t('match.short.contract.agree'),
    differ: (_l, _p, t) => t('match.short.contract.differ'),
  },
  parking: {
    agree: (l, _p, t) =>
      l.parking_spots > 0
        ? t('match.short.parking.agree')
        : t('match.short.parking.agreeNotNeeded'),
    differ: (_l, _p, t) => t('match.short.parking.differ'),
  },
  smoking: {
    agree: (_l, _p, t) => t('match.short.smoking.agree'),
    differ: (_l, _p, t) => t('match.short.smoking.differ'),
  },
  pets: {
    agree: (l, _p, t) =>
      l.pets_allowed ? t('match.short.pets.agree') : t('match.short.pets.agreeNoPets'),
    differ: (_l, _p, t) => t('match.short.pets.differ'),
  },
};

/** The listing page's line for `criterion` on the `kind` side, in the seeker's voice. */
export function seekerReason(
  criterion: Criterion,
  kind: ReasonKind,
  listing: ListingPublic,
  profile: SeekerProfileOut,
  t: TFunction,
): string {
  return SEEKER[criterion][kind](listing, profile, t);
}

/** A search card's chip for `criterion`, or `null` to leave it out (only the `move_in` differ chip
 * needs the profile; the others are read from the listing). */
export function seekerShort(
  criterion: Criterion,
  kind: ReasonKind,
  listing: ListingPublic,
  profile: SeekerProfileOut | undefined,
  t: TFunction,
): string | null {
  return SEEKER_SHORT[criterion][kind](listing, profile, t);
}
