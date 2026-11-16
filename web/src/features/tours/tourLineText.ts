import type { TFunction } from 'i18next';

import type { TourLineOut } from './api';
import { formatTourWhen } from './format';

/** One tour line's text, for the thread and the chat list's preview. `senderName` is who made the
 * change (null = a deleted account); `mine`: I made it. */
export function tourLineText(
  t: TFunction,
  tour: TourLineOut,
  senderName: string | null,
  mine = false,
): string {
  const when = formatTourWhen(tour.starts_at);
  const name = senderName ?? t('account.deletedName');
  switch (tour.change) {
    case 'booked':
      return t('tours.line.booked', { when });
    case 'rescheduled':
      return t('tours.line.rescheduled', { when });
    case 'cancelled_by_system':
      return t('tours.line.cancelledBySystem', { when });
    default:
      return mine
        ? t('tours.line.cancelledMine', { when })
        : t('tours.line.cancelledBy', { when, name });
  }
}
