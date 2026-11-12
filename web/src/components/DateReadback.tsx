import { useTranslation } from 'react-i18next';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day as `YYYY-MM-DD`. The UTC round trip rejects a day V8 would roll over
 * ("2026-02-30" is 2 March) and an Invalid Date, on which `Intl` throws. */
export function isIsoDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const longDate = new Intl.DateTimeFormat('he-IL', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "12 בנובמבר 2026". `isoDay` must pass `isIsoDay`. */
export function formatLongDate(isoDay: string): string {
  return longDate.format(new Date(`${isoDay}T00:00:00Z`));
}

/** Under a native date input: the chosen day in long Hebrew, so a day/month swap shows at once.
 * Nothing unless `value` is a real day; the input lists `id` in `aria-describedby` only then. */
export function DateReadback({ id, value }: { id: string; value: string }) {
  const { t } = useTranslation();
  if (!isIsoDay(value)) return null;
  return (
    <p id={id} className="text-sm text-ink-muted">
      {t('common.dateChosen', { date: formatLongDate(value) })}
    </p>
  );
}

/** `describedBy` plus the read-back's `id`, only while `value` is a real day (never an idref to a
 * missing element). */
export function withReadback(
  describedBy: string | undefined,
  id: string,
  value: string,
): string | undefined {
  const ids = [describedBy, isIsoDay(value) ? id : undefined].filter(
    (x): x is string => x !== undefined && x !== '',
  );
  return ids.length > 0 ? ids.join(' ') : undefined;
}
