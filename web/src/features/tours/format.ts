import i18n from '../../app/i18n';
import { addDays, formatDate, todayInIsrael } from '../listings/format';

// Parts, never the joined string: its separators and order depend on the ICU version.
const whenFormat = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const timeFormat = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const weekdayFormat = new Intl.DateTimeFormat('he-IL', { weekday: 'long', timeZone: 'UTC' });

function parts(
  format: Intl.DateTimeFormat,
  date: Date,
): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
  const part: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const { type, value } of format.formatToParts(date)) part[type] = value;
  return part;
}

/** `2026-11-17T16:20:00Z` → `יום ג׳ 18.11 · 18:20`, in Israel. */
export function formatTourWhen(iso: string): string {
  const p = parts(whenFormat, new Date(iso));
  return `${p.weekday ?? ''} ${p.day ?? ''}.${p.month ?? ''} · ${p.hour ?? ''}:${p.minute ?? ''}`;
}

/** `HH:mm` in Israel. */
export function formatTourTime(iso: string): string {
  const p = parts(timeFormat, new Date(iso));
  return `${p.hour ?? ''}:${p.minute ?? ''}`;
}

/** The Israeli calendar day (`YYYY-MM-DD`) of an instant. */
export function tourDay(iso: string): string {
  return todayInIsrael(new Date(iso));
}

/** `today` / `tomorrow` / "weekday, date" for an Israeli day, `today` being today's day there. */
export function formatTourDay(isoDay: string, today: string): string {
  const t = i18n.t.bind(i18n);
  if (isoDay === today) return t('tours.day.today');
  if (isoDay === addDays(today, 1)) return t('tours.day.tomorrow');
  return t('tours.day.other', {
    weekday: weekdayFormat.format(new Date(`${isoDay}T00:00:00Z`)),
    date: formatDate(isoDay),
  });
}
