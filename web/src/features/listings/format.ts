const ilsFormat = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
// Dates are calendar days (`YYYY-MM-DD`), formatted in UTC so no time zone can shift the day.
const dateFormat = new Intl.DateTimeFormat('he-IL', {
  day: 'numeric',
  month: 'numeric',
  year: '2-digit',
  timeZone: 'UTC',
});
const israelDay = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Jerusalem',
});

/** `7200` → `7,200`. The `₪` sign is the separate `listings.units.ils` key. */
export function formatIls(amount: number): string {
  return ilsFormat.format(amount);
}

/** `2027-01-01` → `1.1.27`. */
export function formatDate(isoDay: string): string {
  return dateFormat.format(new Date(`${isoDay}T00:00:00Z`));
}

/** `3.5` → `3.5`, `3` → `3`. */
export function formatRooms(rooms: number): string {
  return Number.isInteger(rooms) ? String(rooms) : rooms.toFixed(1);
}

/** Today in Israel as `YYYY-MM-DD`. */
export function todayInIsrael(now: Date = new Date()): string {
  return israelDay.format(now);
}

/** `YYYY-MM-DD` plus `days` calendar days. */
export function addDays(isoDay: string, days: number): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
