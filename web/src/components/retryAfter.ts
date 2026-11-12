import type { TFunction } from 'i18next';

/** A response's `Retry-After` as whole seconds (more than 0), else null. The API sends whole
 * seconds, never 0 (`rate_limit.py` floors it at 1), and CORS exposes the header to the web. */
export function parseRetryAfter(headers: Headers): number | null {
  const value = headers.get('Retry-After')?.trim();
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  return seconds > 0 ? seconds : null;
}

/** How long to wait, rounded up to the largest unit below its next one: "בעוד 14 דקות",
 * "בעוד שעה", "בעוד יומיים". */
export function retryAfterText(t: TFunction, seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return t('common.inMinutes', { count: minutes });
  const hours = Math.ceil(seconds / 3600);
  if (hours < 24) return t('common.inHours', { count: hours });
  return t('common.inDays', { count: Math.ceil(seconds / 86400) });
}
