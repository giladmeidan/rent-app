import { describe, expect, it } from 'vitest';

import i18n from '../../../app/i18n';
import type { ApplicantProfileOut } from '../../applicants/api';
import { applicantProfile } from '../../applicants/__tests__/fixtures';
import { formatDate, todayInIsrael } from '../../listings/format';
import type { ListingPublic } from '../../listings/api';
import type { SeekerProfileOut } from '../../profile/api';
import { inDays, profile } from '../../profile/__tests__/fixtures';
import { publicListing } from '../../search/__tests__/fixtures';
import he from '../../../locales/he.json';
import {
  ownerReason,
  ownerShort,
  personReason,
  personShort,
  seekerReason,
  seekerShort,
} from '../reasons';
import type { Criterion, ReasonKind } from '../types';

type Row = {
  name: string;
  criterion: Criterion;
  kind: ReasonKind;
  listing?: Partial<ListingPublic>;
  profile?: Partial<SeekerProfileOut>;
  /** The listing page's line. */
  reason?: string;
  /** The search card's chip; `null` = left out. */
  short?: string | null;
};

// The rendered Hebrew, not keys: `i18n-check` scans neither `.ts` files nor dynamic keys.
const rows: Row[] = [
  {
    name: 'budget agree',
    criterion: 'budget',
    kind: 'agree',
    listing: { price_ils: 7200 },
    profile: { budget_max_ils: 7500 },
    reason: 'התקציב שלך (עד 7,500 ₪) מתאים למחיר',
    short: 'בתקציב',
  },
  {
    name: 'budget differ',
    criterion: 'budget',
    kind: 'differ',
    listing: { price_ils: 7600 },
    profile: { budget_max_ils: 7500 },
    reason: 'המחיר (7,600 ₪) מעל התקציב שלך (7,500 ₪)',
    short: 'מעל התקציב',
  },
  {
    name: 'move_in agree',
    criterion: 'move_in',
    kind: 'agree',
    listing: { available_from: inDays(30) },
    profile: { move_in_date: inDays(30) },
    reason: `תאריך הכניסה שלך (${formatDate(inDays(30))}) תואם`,
    short: 'מועד כניסה תואם',
  },
  {
    name: 'move_in agree, a past stored move-in shown as today',
    criterion: 'move_in',
    kind: 'agree',
    listing: { available_from: inDays(-10) },
    profile: { move_in_date: inDays(-5) },
    reason: `תאריך הכניסה שלך (${formatDate(todayInIsrael())}) תואם`,
    short: 'מועד כניסה תואם',
  },
  {
    name: 'move_in differLate: the listing enters after the seeker',
    criterion: 'move_in',
    kind: 'differ',
    listing: { available_from: inDays(70) },
    profile: { move_in_date: inDays(10) },
    reason: `הכניסה לדירה (${formatDate(inDays(70))}) מאוחרת מדי`,
    short: 'כניסה מאוחרת מדי',
  },
  {
    name: 'move_in differLate against a past stored move-in',
    criterion: 'move_in',
    kind: 'differ',
    listing: { available_from: inDays(40) },
    profile: { move_in_date: inDays(-20) },
    reason: `הכניסה לדירה (${formatDate(inDays(40))}) מאוחרת מדי`,
    short: 'כניסה מאוחרת מדי',
  },
  {
    name: 'move_in differEarly: free before the seeker, in the future',
    criterion: 'move_in',
    kind: 'differ',
    listing: { available_from: inDays(10) },
    profile: { move_in_date: inDays(70) },
    reason: `הדירה פנויה כבר מ־${formatDate(inDays(10))}`,
    short: 'כניסה מוקדמת מדי',
  },
  {
    name: 'move_in differNow: free from a past date',
    criterion: 'move_in',
    kind: 'differ',
    listing: { available_from: inDays(-3) },
    profile: { move_in_date: inDays(60) },
    reason: 'הדירה פנויה כבר עכשיו',
    short: 'כניסה מוקדמת מדי',
  },
  {
    name: 'move_in differNow: free from today',
    criterion: 'move_in',
    kind: 'differ',
    listing: { available_from: todayInIsrael() },
    profile: { move_in_date: inDays(60) },
    reason: 'הדירה פנויה כבר עכשיו',
    short: 'כניסה מוקדמת מדי',
  },
  {
    name: 'area agree',
    criterion: 'area',
    kind: 'agree',
    reason: 'באזור שבחרת',
    short: 'באזור שלך',
  },
  {
    name: 'area differ',
    criterion: 'area',
    kind: 'differ',
    reason: 'מחוץ לאזורים שבחרת',
    short: 'מחוץ לאזור המועדף',
  },
  {
    name: 'household agree',
    criterion: 'household',
    kind: 'agree',
    profile: { household: 'couple' },
    reason: 'מתאים לזוג — כמוך',
    short: 'מתאים למשק הבית',
  },
  {
    name: 'household differ, two households',
    criterion: 'household',
    kind: 'differ',
    listing: { accepted_households: ['couple', 'family'] },
    profile: { household: 'roommates' },
    reason: 'בעלי הדירה מחפשים זוג או משפחה',
    short: 'משק בית אחר',
  },
  {
    name: 'household differ, three households',
    criterion: 'household',
    kind: 'differ',
    listing: { accepted_households: ['single', 'couple', 'roommates'] },
    profile: { household: 'family' },
    reason: 'בעלי הדירה מחפשים יחיד/ה, זוג או שותפים',
    short: 'משק בית אחר',
  },
  {
    name: 'contract agree',
    criterion: 'contract',
    kind: 'agree',
    listing: { min_contract_months: 12 },
    profile: { contract_months: 24 },
    reason: 'משך החוזה שביקשת מתאים',
    short: 'חוזה מתאים',
  },
  {
    name: 'contract differ',
    criterion: 'contract',
    kind: 'differ',
    listing: { min_contract_months: 12 },
    profile: { contract_months: 6 },
    reason: 'בעלי הדירה מבקשים חוזה של 12 חודשים לפחות',
    short: 'חוזה קצר מדי',
  },
  {
    name: 'parking (0 needed, no spot) agreeNotNeeded',
    criterion: 'parking',
    kind: 'agree',
    listing: { parking_spots: 0 },
    profile: { parking_needed: 0 },
    reason: 'לא ביקשת חניה',
    short: 'חניה לא נדרשת',
  },
  {
    name: 'parking (0 needed, 2 spots) agreeNotNeeded',
    criterion: 'parking',
    kind: 'agree',
    listing: { parking_spots: 2 },
    profile: { parking_needed: 0 },
    reason: 'לא ביקשת חניה',
    short: 'חניה',
  },
  {
    name: 'parking (1 needed, 1 spot) agree',
    criterion: 'parking',
    kind: 'agree',
    listing: { parking_spots: 1 },
    profile: { parking_needed: 1 },
    reason: 'יש חניה כפי שביקשת',
    short: 'חניה',
  },
  {
    name: 'parking (2 needed, 1 spot) agreePartial',
    criterion: 'parking',
    kind: 'agree',
    listing: { parking_spots: 1 },
    profile: { parking_needed: 2 },
    reason: 'יש מקום חניה אחד מתוך 2 שביקשת',
    short: 'חניה',
  },
  {
    name: 'parking (1 needed, no spot) differNone',
    criterion: 'parking',
    kind: 'differ',
    listing: { parking_spots: 0 },
    profile: { parking_needed: 1 },
    reason: 'ביקשת חניה — בדירה אין חניה',
    short: 'חסרה חניה',
  },
  {
    name: 'parking (2 needed, no spot) differNone',
    criterion: 'parking',
    kind: 'differ',
    listing: { parking_spots: 0 },
    profile: { parking_needed: 2 },
    reason: 'ביקשת חניה — בדירה אין חניה',
    short: 'חסרה חניה',
  },
  {
    name: 'parking (2 needed, 1 spot) differ',
    criterion: 'parking',
    kind: 'differ',
    listing: { parking_spots: 1 },
    profile: { parking_needed: 2 },
    reason: 'ביקשת 2 חניות — בדירה יש מקום אחד',
    short: 'חסרה חניה',
  },
  {
    name: 'smoking agree, the owner asks for non-smokers',
    criterion: 'smoking',
    kind: 'agree',
    listing: { smoking_allowed: false },
    profile: { smoker: false },
    reason: 'ללא מעשנים — ואת/ה לא מעשן/ת',
    short: 'עישון מתאים',
  },
  {
    name: 'smoking agree, smoking allowed',
    criterion: 'smoking',
    kind: 'agree',
    listing: { smoking_allowed: true },
    profile: { smoker: true },
    reason: 'מותר לעשן',
    short: 'עישון מתאים',
  },
  {
    name: 'smoking differ',
    criterion: 'smoking',
    kind: 'differ',
    listing: { smoking_allowed: false },
    profile: { smoker: true },
    reason: 'בעלי הדירה מבקשים ללא מעשנים',
    short: 'ללא מעשנים',
  },
  {
    name: 'pets agree, pets allowed',
    criterion: 'pets',
    kind: 'agree',
    listing: { pets_allowed: true },
    profile: { has_pets: true },
    reason: 'חיות מחמד מותרות',
    short: 'חיות מחמד',
  },
  {
    name: 'pets agree, not allowed and no pets',
    criterion: 'pets',
    kind: 'agree',
    listing: { pets_allowed: false },
    profile: { has_pets: false },
    reason: 'ללא חיות מחמד — ואין לך חיית מחמד',
    short: 'בלי חיות — מתאים',
  },
  {
    name: 'pets differ',
    criterion: 'pets',
    kind: 'differ',
    listing: { pets_allowed: false },
    profile: { has_pets: true },
    reason: 'ללא חיות מחמד',
    short: 'ללא חיות מחמד',
  },
];

// The `lifestyle` criterion (spec 0007f), worded from both sides' answers.
const topics = (names: string[]) =>
  new Intl.ListFormat('he', { type: 'conjunction' }).format(names);
const lifestyleRows: Row[] = [
  {
    name: 'agree with equal answers: the counts',
    criterion: 'lifestyle',
    kind: 'agree',
    listing: { listing_type: 'room', lifestyle: { cleanliness: 3, guests: 1, night: 2 } },
    profile: { lifestyle: { cleanliness: 3, guests: 1, night: 3, kosher: 1 } },
    reason: 'אורח החיים שלך קרוב לזה שבדירה (תשובות זהות: 2 מתוך 3)',
    short: 'אורח חיים דומה',
  },
  {
    name: 'agree one step apart (same 0): no counts',
    criterion: 'lifestyle',
    kind: 'agree',
    listing: { listing_type: 'room', lifestyle: { night: 2 } },
    profile: { lifestyle: { night: 3 } },
    reason: 'אורח החיים שלך קרוב לזה שבדירה',
    short: 'אורח חיים דומה',
  },
  {
    name: 'differ: the first three differing topics',
    criterion: 'lifestyle',
    kind: 'differ',
    listing: {
      listing_type: 'room',
      lifestyle: { cleanliness: 1, guests: 3, night: 1, social: 3 },
    },
    profile: { lifestyle: { cleanliness: 3, guests: 1, night: 3, social: 1 } },
    reason: `אורח החיים שונה: ${topics(['ניקיון', 'אורחים', 'שעת שינה'])}`,
    short: 'אורח חיים שונה',
  },
  {
    name: 'differ with nothing differing now (the profile changed): the short line',
    criterion: 'lifestyle',
    kind: 'differ',
    listing: { listing_type: 'room', lifestyle: { cleanliness: 3 } },
    profile: { lifestyle: { cleanliness: 3 } },
    reason: 'אורח חיים שונה',
    short: 'אורח חיים שונה',
  },
];

// Without the profile (pending or failed), only the `move_in` differ chip is left out.
const withoutProfile: [Criterion, ReasonKind, Partial<ListingPublic>, string | null][] = [
  ['move_in', 'differ', { available_from: inDays(70) }, null],
  ['move_in', 'agree', {}, 'מועד כניסה תואם'],
  ['budget', 'agree', {}, 'בתקציב'],
  ['budget', 'differ', {}, 'מעל התקציב'],
  ['area', 'differ', {}, 'מחוץ לאזור המועדף'],
  ['household', 'differ', {}, 'משק בית אחר'],
  ['contract', 'differ', {}, 'חוזה קצר מדי'],
  ['parking', 'agree', { parking_spots: 1 }, 'חניה'],
  ['parking', 'agree', { parking_spots: 0 }, 'חניה לא נדרשת'],
  ['parking', 'differ', {}, 'חסרה חניה'],
  ['smoking', 'agree', {}, 'עישון מתאים'],
  ['pets', 'agree', { pets_allowed: true }, 'חיות מחמד'],
  ['pets', 'agree', { pets_allowed: false }, 'בלי חיות — מתאים'],
  ['pets', 'differ', {}, 'ללא חיות מחמד'],
  ['lifestyle', 'agree', { listing_type: 'room' }, 'אורח חיים דומה'],
  ['lifestyle', 'differ', { listing_type: 'room' }, 'אורח חיים שונה'],
];

type OwnerRow = {
  name: string;
  criterion: Criterion;
  kind: ReasonKind;
  profile?: Partial<ApplicantProfileOut>;
  /** The listing's `parking_spots`. */
  spots?: number;
  /** The inbox disclosure's line. */
  reason: string;
  /** The inbox card's chip. */
  short: string;
};

// The owner's voice (0006g), about the applicant; the rendered Hebrew, as above.
const ownerRows: OwnerRow[] = [
  {
    name: 'budget agree',
    criterion: 'budget',
    kind: 'agree',
    reason: 'התקציב מתאים למחיר',
    short: 'בתקציב',
  },
  {
    name: 'budget differ',
    criterion: 'budget',
    kind: 'differ',
    reason: 'המחיר מעל התקציב שלהם',
    short: 'מעל התקציב',
  },
  {
    name: 'move_in agree',
    criterion: 'move_in',
    kind: 'agree',
    profile: { move_in_date: inDays(30) },
    reason: `תאריך הכניסה מתאים (${formatDate(inDays(30))})`,
    short: 'כניסה מתאימה',
  },
  {
    name: 'move_in agree, a past stored move-in shown as today',
    criterion: 'move_in',
    kind: 'agree',
    profile: { move_in_date: inDays(-5) },
    reason: `תאריך הכניסה מתאים (${formatDate(todayInIsrael())})`,
    short: 'כניסה מתאימה',
  },
  {
    name: 'move_in differ',
    criterion: 'move_in',
    kind: 'differ',
    profile: { move_in_date: inDays(70) },
    reason: `מבקשים כניסה ב־${formatDate(inDays(70))}`,
    short: `כניסה ${formatDate(inDays(70))}`,
  },
  {
    name: 'move_in differ, a past stored move-in shown as today',
    criterion: 'move_in',
    kind: 'differ',
    profile: { move_in_date: inDays(-20) },
    reason: `מבקשים כניסה ב־${formatDate(todayInIsrael())}`,
    short: `כניסה ${formatDate(todayInIsrael())}`,
  },
  {
    name: 'area agree',
    criterion: 'area',
    kind: 'agree',
    reason: 'מחפשים באזור הזה',
    short: 'באזור',
  },
  {
    name: 'area differ',
    criterion: 'area',
    kind: 'differ',
    reason: 'מחפשים באזור אחר',
    short: 'אזור אחר',
  },
  {
    name: 'household agree',
    criterion: 'household',
    kind: 'agree',
    profile: { household: 'couple' },
    reason: 'זוג — כפי שביקשת',
    short: 'משק בית מתאים',
  },
  {
    name: 'household differ',
    criterion: 'household',
    kind: 'differ',
    profile: { household: 'roommates' },
    reason: 'שותפים — לא ברשימה שלך',
    short: 'משק בית אחר',
  },
  {
    name: 'contract agree, 12 months',
    criterion: 'contract',
    kind: 'agree',
    profile: { contract_months: 12 },
    reason: 'מחפשים חוזה של שנה',
    short: 'חוזה מתאים',
  },
  {
    name: 'contract agree, 24 months agreeLong',
    criterion: 'contract',
    kind: 'agree',
    profile: { contract_months: 24 },
    reason: 'מחפשים חוזה של שנתיים',
    short: 'חוזה ארוך טווח',
  },
  {
    name: 'contract agree, 36 months agreeLong',
    criterion: 'contract',
    kind: 'agree',
    profile: { contract_months: 36 },
    reason: 'מחפשים חוזה של 3 שנים ומעלה',
    short: 'חוזה ארוך טווח',
  },
  {
    name: 'contract differ',
    criterion: 'contract',
    kind: 'differ',
    profile: { contract_months: 6 },
    reason: 'מחפשים חוזה של חצי שנה בלבד',
    short: 'חוזה קצר',
  },
  {
    name: 'parking (1 needed, 1 spot) agree',
    criterion: 'parking',
    kind: 'agree',
    profile: { parking_needed: 1 },
    spots: 1,
    reason: 'צריכים חניה אחת — יש',
    short: 'חניה',
  },
  {
    name: 'parking (2 needed, 2 spots) agree',
    criterion: 'parking',
    kind: 'agree',
    profile: { parking_needed: 2 },
    spots: 2,
    reason: 'צריכים 2 חניות — יש',
    short: 'חניה',
  },
  {
    name: 'parking (0 needed, no spot) agreeNone',
    criterion: 'parking',
    kind: 'agree',
    profile: { parking_needed: 0 },
    spots: 0,
    reason: 'לא צריכים חניה',
    short: 'חניה',
  },
  {
    name: 'parking (2 needed, 1 spot) as agree: the differ wording',
    criterion: 'parking',
    kind: 'agree',
    profile: { parking_needed: 2 },
    spots: 1,
    reason: 'ביקשו 2 חניות, בדירה יש מקום אחד',
    short: 'חניה',
  },
  {
    name: 'parking (2 needed, 1 spot) differ',
    criterion: 'parking',
    kind: 'differ',
    profile: { parking_needed: 2 },
    spots: 1,
    reason: 'ביקשו 2 חניות, בדירה יש מקום אחד',
    short: 'חסרה חניה',
  },
  {
    name: 'parking (1 needed, no spot) differNone',
    criterion: 'parking',
    kind: 'differ',
    profile: { parking_needed: 1 },
    spots: 0,
    reason: 'ביקשו חניה אחת, בדירה אין חניה',
    short: 'חסרה חניה',
  },
  {
    name: 'parking (2 needed, no spot) differNone',
    criterion: 'parking',
    kind: 'differ',
    profile: { parking_needed: 2 },
    spots: 0,
    reason: 'ביקשו 2 חניות, בדירה אין חניה',
    short: 'חסרה חניה',
  },
  {
    name: 'smoking agree, a non-smoker',
    criterion: 'smoking',
    kind: 'agree',
    profile: { smoker: false },
    reason: 'לא מעשנים',
    short: 'לא מעשנים',
  },
  {
    name: 'smoking agree, a smoker where smoking is allowed (agreeSmoker)',
    criterion: 'smoking',
    kind: 'agree',
    profile: { smoker: true },
    reason: 'מעשנים — מותר אצלך',
    short: 'מעשנים, מותר',
  },
  {
    name: 'smoking differ',
    criterion: 'smoking',
    kind: 'differ',
    profile: { smoker: true },
    reason: 'מעשנים',
    short: 'מעשנים',
  },
  {
    name: 'pets agree, no pets',
    criterion: 'pets',
    kind: 'agree',
    profile: { has_pets: false },
    reason: 'בלי חיות מחמד',
    short: 'בלי חיות',
  },
  {
    name: 'pets agree, a pet where pets are allowed (agreePet)',
    criterion: 'pets',
    kind: 'agree',
    profile: { has_pets: true },
    reason: 'עם חיית מחמד — מותר אצלך',
    short: 'חיית מחמד, מותר',
  },
  {
    name: 'pets differ',
    criterion: 'pets',
    kind: 'differ',
    profile: { has_pets: true },
    reason: 'עם חיית מחמד',
    short: 'עם חיית מחמד',
  },
];

describe('reasons', () => {
  it.each(rows)('ac2_reason_copy: $name', (row) => {
    const listing = publicListing(row.listing);
    const seeker = profile(row.profile);
    expect(seekerReason(row.criterion, row.kind, listing, seeker, i18n.t)).toBe(row.reason);
    expect(seekerShort(row.criterion, row.kind, listing, seeker, i18n.t)).toBe(row.short);
  });

  it.each(lifestyleRows)('ac11_lifestyle_copy: $name', (row) => {
    const listing = publicListing(row.listing);
    const seeker = profile(row.profile);
    expect(seekerReason(row.criterion, row.kind, listing, seeker, i18n.t)).toBe(row.reason);
    expect(seekerShort(row.criterion, row.kind, listing, seeker, i18n.t)).toBe(row.short);
  });

  it.each(withoutProfile)(
    'ac2_reason_copy: %s %s chip without a profile',
    (criterion, kind, listing, short) => {
      expect(seekerShort(criterion, kind, publicListing(listing), undefined, i18n.t)).toBe(short);
    },
  );

  it.each(ownerRows)('ac6_owner_copy: $name', (row) => {
    const applicant = applicantProfile(row.profile);
    expect(ownerReason(row.criterion, row.kind, applicant, row.spots ?? 1, i18n.t)).toBe(
      row.reason,
    );
    expect(ownerShort(row.criterion, row.kind, applicant, i18n.t)).toBe(row.short);
  });

  it('ac3_owner_parking_shortfall_one_spot', () => {
    // Two asked and one spot: the spots read `listing.parking`, on both paths (spec 0009b).
    const applicant = applicantProfile({ parking_needed: 2 });
    for (const kind of ['agree', 'differ'] as const) {
      expect(ownerReason('parking', kind, applicant, 1, i18n.t)).toBe(
        '\u05d1\u05d9\u05e7\u05e9\u05d5 2 \u05d7\u05e0\u05d9\u05d5\u05ea, \u05d1\u05d3\u05d9\u05e8\u05d4 \u05d9\u05e9 \u05de\u05e7\u05d5\u05dd \u05d0\u05d7\u05d3',
      );
    }
  });

  it('ac6_owner_copy: every criterion and side has a row', () => {
    const criteria: Criterion[] = [
      'budget',
      'move_in',
      'area',
      'household',
      'contract',
      'parking',
      'smoking',
      'pets',
    ];
    for (const criterion of criteria) {
      for (const kind of ['agree', 'differ'] as const) {
        expect(
          ownerRows.some((r) => r.criterion === criterion && r.kind === kind),
          `${criterion} ${kind}`,
        ).toBe(true);
      }
    }
  });
});

describe('people reasons', () => {
  it('ac1_person_reasons_fact_free', () => {
    const criteria: Criterion[] = [
      'budget',
      'move_in',
      'area',
      'household',
      'contract',
      'parking',
      'smoking',
      'pets',
      'lifestyle',
    ];
    const person = { move_in_date: inDays(30) };
    // Words that state a fact about the person: none may appear on any line.
    const forbidden = [
      'לא מעשנים',
      'מעשנים',
      'בלי חיות',
      'עם חיית מחמד',
      'חוזה קצר',
      'חסרה חניה',
      'חוזה ארוך',
      he.match.owner.short.smoking.agreeSmoker,
      he.match.owner.short.pets.agreePet,
      he.match.owner.short.contract.agreeLong,
    ];
    for (const criterion of criteria) {
      for (const kind of ['agree', 'differ'] as const) {
        const line = personReason(criterion, kind, person, i18n.t);
        expect(personShort(criterion, kind, person, i18n.t)).toBe(line);
        expect(line).not.toBe('');
        expect(line).not.toContain('people.');
        expect(line).not.toContain('match.');
        for (const text of forbidden) expect(line, `${criterion} ${kind}`).not.toContain(text);
      }
    }
    expect(personReason('smoking', 'differ', person, i18n.t)).toBe('עישון: לא מתאים');
    expect(personReason('pets', 'agree', person, i18n.t)).toBe('חיות מחמד: מתאים');
    // A stored move-in that has passed means today, as everywhere.
    expect(personReason('move_in', 'agree', { move_in_date: inDays(-5) }, i18n.t)).toBe(
      i18n.t('match.owner.move_in.agree', { date: formatDate(todayInIsrael()) }),
    );
    expect(personReason('move_in', 'differ', person, i18n.t)).toBe(
      i18n.t('match.owner.move_in.differ', { date: formatDate(inDays(30)) }),
    );
  });
});
