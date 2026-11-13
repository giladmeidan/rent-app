import type { TFunction } from 'i18next';

import { retryAfterText } from '../../components/retryAfter';
import { ApiError } from '../listings/api';

/** The sentence for a failed photo upload: 413 too large, 415 not an image we take, 409
 * `photo_limit` the listing is full, 429 too many uploads (with when to try again, if the answer
 * said); anything else (503, a network error) "not uploaded". */
export function photoErrorText(t: TFunction, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) return t('photos.errors.size');
    if (error.status === 415) return t('photos.errors.type');
    if (error.status === 409 && error.detail === 'photo_limit') return t('photos.errors.limit');
    if (error.status === 429) {
      return error.retryAfter === null
        ? t('photos.errors.rateLimited')
        : t('photos.errors.rateLimitedIn', { when: retryAfterText(t, error.retryAfter) });
    }
  }
  return t('photos.errors.failed');
}
