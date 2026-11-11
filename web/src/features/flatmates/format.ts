const dayFormat = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem' });

/** A datetime's calendar day in Israel, e.g. `2026-11-10T23:30:00Z` → `11.11.2026`. */
export function formatDay(iso: string): string {
  return dayFormat.format(new Date(iso));
}
