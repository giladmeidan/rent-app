import { describe, expect, it } from 'vitest';

import i18n from '../../../app/i18n';
import { formatDate, todayInIsrael } from '../../listings/format';
import type { ListingPublic } from '../../listings/api';
import type { SeekerProfileOut } from '../../profile/api';
import { inDays, profile } from '../../profile/__tests__/fixtures';
import { publicListing } from '../../search/__tests__/fixtures';
import { seekerReason, seekerShort } from '../reasons';
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
    reason: 'בעל הדירה מחפש זוג או משפחה',
    short: 'משק בית אחר',
  },
  {
    name: 'household differ, three households',
    criterion: 'household',
    kind: 'differ',
    listing: { accepted_households: ['single', 'couple', 'roommates'] },
    profile: { household: 'family' },
    reason: 'בעל הדירה מחפש יחיד/ה, זוג או שותפים',
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
    reason: 'בעל הדירה מבקש חוזה של 12 חודשים לפחות',
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
    reason: 'בעל הדירה מבקש ללא מעשנים',
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
];

describe('reasons', () => {
  it.each(rows)('ac2_reason_copy: $name', (row) => {
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
});
