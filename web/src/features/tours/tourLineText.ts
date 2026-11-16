import type { TFunction } from 'i18next';

import type { TourLineOut } from './api';
import { formatTourWhen } from './format';

/** One tour line's text, for the thread and the chat list's preview. `senderName` must be the
 * sender's name (null = a deleted account); `undefined` when it is me, so my own cancel reads
 * impersonally ("the tour of … was cancelled"), as the brand voice has no second person. */
export function tourLineText(
  t: TFunction,
  tour: TourLineOut,
  senderName: string | null | undefined,
): string {
  const when = formatTourWhen(tour.starts_at);
  switch (tour.change) {
    case 'booked':
      return t('tours.line.booked', { when });
    case 'rescheduled':
      return t('tours.line.rescheduled', { when });
    case 'cancelled_by_system':
      return t('tours.line.cancelledBySystem', { when });
    default:
      return senderName === undefined
        ? t('tours.line.cancelledBySystem', { when })
        : t('tours.line.cancelledBy', { when, name: senderName ?? t('account.deletedName') });
  }
}
