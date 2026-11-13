import { useSyncExternalStore } from 'react';
import { matchPath, useLocation } from 'react-router';

/**
 * The app's two sides (spec 0010a, MARKET-PLAN section 7): דירות (whole apartments) and שוק
 * השותפים (rooms in shared flats). A side page says which side it is on (`sideOf`); a shared page
 * (a listing, chat, the profile) shows the last side stored on this device. The side is a device
 * preference: it survives logout.
 */
export type Side = 'apartments' | 'market';

const STORAGE_KEY = 'homie.side';

const MARKET_PATHS = [
  '/market',
  '/market/*',
  '/me/likes',
  '/me/flats',
  '/flatmates/join',
  '/me/listings/:id/people',
  '/me/listings/:id/flatmates',
] as const;

// `/me/listings` is exact: its edit and applicants pages are shared.
const APARTMENT_PATHS = ['/search', '/me/listings', '/me/applications'] as const;

/** The side a path belongs to, or `null` for a shared path. */
export function sideOf(pathname: string): Side | null {
  if (MARKET_PATHS.some((pattern) => matchPath(pattern, pathname) !== null)) return 'market';
  if (APARTMENT_PATHS.some((pattern) => matchPath(pattern, pathname) !== null)) return 'apartments';
  return null;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The stored side, read on every call (no module cache); storage that throws is "none". */
function readStored(): Side | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'apartments' || value === 'market' ? value : null;
  } catch {
    return null;
  }
}

/** Records `side` on this device and re-renders every `useSide` reader. A storage failure is
 * ignored (the side then follows the path only). */
export function setSide(side: Side): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, side);
  } catch {
    // Private mode or a full quota: nothing to remember.
  }
  for (const listener of listeners) listener();
}

/** The current side: the path's own, else the last one stored, else `apartments`. */
export function useSide(): Side {
  const { pathname } = useLocation();
  const stored = useSyncExternalStore(subscribe, readStored);
  return sideOf(pathname) ?? stored ?? 'apartments';
}
