/**
 * Listings opened on this device (spec 0009v, Gilad decision 2: "seen" is per device). The ids
 * live in `localStorage` under one key as a JSON array, newest last, at most `SEEN_CAP`; re-opening
 * a stored id moves it to the end, so the cap drops the least recently opened. Ids only: no
 * titles, no times.
 *
 * `ListingPage` writes an id when its listing loads; an explicit logout (`useLogout`) clears the
 * store; a 401 (`clearSession`) does not, the person on the device has not changed. Every storage
 * call is guarded as in `app/drafts.ts`: a throwing or missing storage, or a malformed value, reads
 * as empty and writes nothing.
 */
const KEY = 'rent-app:seen';

/** At most this many ids are kept (the oldest dropped). */
export const SEEN_CAP = 300;

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

/** Records that listing `id` was opened on this device. */
export function markSeen(id: string): void {
  const ids = read().filter((stored) => stored !== id);
  ids.push(id);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids.slice(-SEEN_CAP)));
  } catch {
    // Storage is off or full: nothing is stored.
  }
}

/** The listings opened on this device. */
export function readSeen(): Set<string> {
  return new Set(read());
}

/** Forgets every opened listing (an explicit logout). */
export function clearSeen(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Storage is off: nothing was stored.
  }
}
