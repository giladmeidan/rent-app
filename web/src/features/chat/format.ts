import { todayInIsrael } from '../listings/format';

// Parts, never the joined string: its separators and order depend on the ICU version.
const partsFormat = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** A message's time in Israel: `HH:mm` when it is from today there, otherwise `dd.MM HH:mm`. */
export function formatMessageTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const part: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const { type, value } of partsFormat.formatToParts(date)) part[type] = value;
  const time = `${part.hour ?? ''}:${part.minute ?? ''}`;
  if (todayInIsrael(date) === todayInIsrael(now)) return time;
  return `${part.day ?? ''}.${part.month ?? ''} ${time}`;
}
