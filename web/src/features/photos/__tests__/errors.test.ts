import { describe, expect, it } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { ApiError } from '../../listings/api';
import { photoErrorText } from '../errors';

const apiError = (status: number, detail?: string, retryAfter?: string) =>
  new ApiError(
    'POST',
    '/listings/{listing_id}/photos',
    status,
    detail === undefined ? undefined : { detail },
    new Headers(retryAfter === undefined ? {} : { 'Retry-After': retryAfter }),
  );

describe('photoErrorText', () => {
  it('photoErrorText', () => {
    const e = he.photos.errors;
    const text = (error: unknown) => photoErrorText(i18n.t, error);
    expect(text(apiError(413, 'photo_too_large'))).toBe(e.size);
    expect(text(apiError(415, 'unsupported_image'))).toBe(e.type);
    expect(text(apiError(409, 'photo_limit'))).toBe(e.limit);
    // Another 409 is not "full".
    expect(text(apiError(409, 'something_else'))).toBe(e.failed);
    expect(text(apiError(429, 'rate_limited'))).toBe(e.rateLimited);
    expect(text(apiError(429, 'rate_limited', '840'))).toBe(
      i18n.t('photos.errors.rateLimitedIn', { when: i18n.t('common.inMinutes', { count: 14 }) }),
    );
    expect(text(apiError(503, 'photo_storage_unavailable'))).toBe(e.failed);
    expect(text(new TypeError('Failed to fetch'))).toBe(e.failed);
    expect(text(undefined)).toBe(e.failed);
  });
});
