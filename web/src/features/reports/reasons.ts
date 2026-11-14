import type { TFunction } from 'i18next';

import type { ReportReason } from './api';

/** Where a listing is involved (the listing page): every reason. */
export const LISTING_REASONS = [
  'money_before_viewing',
  'broker',
  'misleading',
  'unavailable',
  'offensive',
  'other',
] as const satisfies readonly ReportReason[];

/** A person (a card): no "the listing is no longer relevant". */
export const PERSON_REASONS = LISTING_REASONS.filter(
  (reason) => reason !== 'unavailable',
) satisfies readonly ReportReason[];

/** A literal map, so `i18n-check` sees every key. */
export function reasonLabel(t: TFunction, reason: ReportReason): string {
  return {
    money_before_viewing: t('report.reasons.moneyBeforeViewing'),
    broker: t('report.reasons.broker'),
    misleading: t('report.reasons.misleading'),
    unavailable: t('report.reasons.unavailable'),
    offensive: t('report.reasons.offensive'),
    other: t('report.reasons.other'),
  }[reason];
}
