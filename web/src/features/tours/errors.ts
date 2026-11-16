import type { TFunction } from 'i18next';

import { ApiError } from '../listings/api';

/** The alert text of a failed tour call: offline, a slot taken, a listing not live, 429, else generic. */
export function tourErrorText(t: TFunction, error: unknown, online: boolean): string {
  if (!online) return t('common.offline');
  if (error instanceof ApiError) {
    if (error.detail === 'slot_unavailable') return t('tours.errors.slotUnavailable');
    if (error.detail === 'listing_not_live') return t('tours.errors.listingNotLive');
    if (error.status === 429) return t('tours.errors.rateLimited');
  }
  return t('tours.errors.generic');
}
