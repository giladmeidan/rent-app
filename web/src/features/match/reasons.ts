// The only place a criterion code becomes copy. Every line is built from the facts that made the
// criterion agree or differ (the listing and the seeker's own profile), never from the code alone:
// `0006b` puts a criterion in `agrees` whenever its partial score is at least 0.5, so e.g. `pets`
// agrees for a seeker without pets on a listing that refuses them.
//
// Keyed by criterion, so the owner's voice (`0006g`: `ownerShort` / `ownerReason`) sits beside it.
import type { TFunction } from 'i18next';

import type { ApplicantProfileOut } from '../applicants/api';
import type { ListingPublic } from '../listings/api';
import { formatDate, formatIls, todayInIsrael } from '../listings/format';
import type { ContractMonths, Household, SeekerProfileOut } from '../profile/api';
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

/** "זוג", as the profile form says it. */
export function householdName(household: Household, t: TFunction): string {
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

// The owner's voice (0006g): about the applicant, from their housing summary (no budget or areas
// are ever sent, so those lines are words only) and, for parking, the listing's spots.

type OwnerLine = (profile: ApplicantProfileOut, spots: number, t: TFunction) => string;
type OwnerShort = (profile: ApplicantProfileOut, t: TFunction) => string;

/** "שנתיים", as the profile form says it. */
export function contractName(months: ContractMonths, t: TFunction): string {
  return {
    6: t('profile.contract.6'),
    12: t('profile.contract.12'),
    24: t('profile.contract.24'),
    36: t('profile.contract.36'),
  }[months];
}

/** "חניה אחת" / "2 חניות", as the profile form says it (`parking_needed` is 0, 1 or 2). */
export function parkingName(needed: number, t: TFunction): string {
  if (needed <= 0) return t('profile.parking.0');
  return needed === 1 ? t('profile.parking.1') : t('profile.parking.2');
}

/** The applicant's move-in day as shown: a stored date that has passed means today (as `0006b`
 * scores it). */
export function applicantMoveIn(profile: ApplicantProfileOut): string {
  return formatDate(later(profile.move_in_date, todayInIsrael()));
}

/** The parking line whenever the listing has fewer spots than asked for (a differ, or a 0.5 agree:
 * two asked, one spot). */
function parkingShortfall(profile: ApplicantProfileOut, spots: number, t: TFunction): string {
  const parking = parkingName(profile.parking_needed, t);
  return spots === 0
    ? t('match.owner.parking.differNone', { parking })
    : t('match.owner.parking.differ', { parking, spots });
}

const OWNER: Record<Criterion, Record<ReasonKind, OwnerLine>> = {
  budget: {
    agree: (_p, _s, t) => t('match.owner.budget.agree'),
    differ: (_p, _s, t) => t('match.owner.budget.differ'),
  },
  move_in: {
    agree: (p, _s, t) => t('match.owner.move_in.agree', { date: applicantMoveIn(p) }),
    differ: (p, _s, t) => t('match.owner.move_in.differ', { date: applicantMoveIn(p) }),
  },
  area: {
    agree: (_p, _s, t) => t('match.owner.area.agree'),
    differ: (_p, _s, t) => t('match.owner.area.differ'),
  },
  household: {
    agree: (p, _s, t) =>
      t('match.owner.household.agree', { household: householdName(p.household, t) }),
    differ: (p, _s, t) =>
      t('match.owner.household.differ', { household: householdName(p.household, t) }),
  },
  contract: {
    agree: (p, _s, t) =>
      t('match.owner.contract.agree', { months: contractName(p.contract_months, t) }),
    differ: (p, _s, t) =>
      t('match.owner.contract.differ', { months: contractName(p.contract_months, t) }),
  },
  parking: {
    agree: (p, spots, t) => {
      if (p.parking_needed === 0) return t('match.owner.parking.agreeNone');
      if (spots < p.parking_needed) return parkingShortfall(p, spots, t);
      return t('match.owner.parking.agree', { parking: parkingName(p.parking_needed, t) });
    },
    differ: (p, spots, t) => parkingShortfall(p, spots, t),
  },
  smoking: {
    // Smoking agrees for a smoker too when the listing allows it.
    agree: (p, _s, t) =>
      p.smoker ? t('match.owner.smoking.agreeSmoker') : t('match.owner.smoking.agree'),
    differ: (_p, _s, t) => t('match.owner.smoking.differ'),
  },
  pets: {
    agree: (p, _s, t) =>
      p.has_pets ? t('match.owner.pets.agreePet') : t('match.owner.pets.agree'),
    differ: (_p, _s, t) => t('match.owner.pets.differ'),
  },
};

const OWNER_SHORT: Record<Criterion, Record<ReasonKind, OwnerShort>> = {
  budget: {
    agree: (_p, t) => t('match.owner.short.budget.agree'),
    differ: (_p, t) => t('match.owner.short.budget.differ'),
  },
  move_in: {
    agree: (_p, t) => t('match.owner.short.move_in.agree'),
    differ: (p, t) => t('match.owner.short.move_in.differ', { date: applicantMoveIn(p) }),
  },
  area: {
    agree: (_p, t) => t('match.owner.short.area.agree'),
    differ: (_p, t) => t('match.owner.short.area.differ'),
  },
  household: {
    agree: (_p, t) => t('match.owner.short.household.agree'),
    differ: (_p, t) => t('match.owner.short.household.differ'),
  },
  contract: {
    agree: (p, t) =>
      p.contract_months >= 24
        ? t('match.owner.short.contract.agreeLong')
        : t('match.owner.short.contract.agree'),
    differ: (_p, t) => t('match.owner.short.contract.differ'),
  },
  parking: {
    agree: (_p, t) => t('match.owner.short.parking.agree'),
    differ: (_p, t) => t('match.owner.short.parking.differ'),
  },
  smoking: {
    agree: (p, t) =>
      p.smoker ? t('match.owner.short.smoking.agreeSmoker') : t('match.owner.short.smoking.agree'),
    differ: (_p, t) => t('match.owner.short.smoking.differ'),
  },
  pets: {
    agree: (p, t) =>
      p.has_pets ? t('match.owner.short.pets.agreePet') : t('match.owner.short.pets.agree'),
    differ: (_p, t) => t('match.owner.short.pets.differ'),
  },
};

/** The inbox disclosure's line for `criterion` on the `kind` side, in the owner's voice, about
 * the applicant. `spots` is the listing's `parking_spots`. */
export function ownerReason(
  criterion: Criterion,
  kind: ReasonKind,
  profile: ApplicantProfileOut,
  spots: number,
  t: TFunction,
): string {
  return OWNER[criterion][kind](profile, spots, t);
}

/** An inbox card's chip for `criterion`, in the owner's voice. */
export function ownerShort(
  criterion: Criterion,
  kind: ReasonKind,
  profile: ApplicantProfileOut,
  t: TFunction,
): string {
  return OWNER_SHORT[criterion][kind](profile, t);
}
