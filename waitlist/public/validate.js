// The waitlist's field rules (spec 0017): the one rule set, used by the page (app.js) before it sends
// and by the server (lib/signup.js) before it stores. Plain ES module: no DOM, no Node API.
import { CITY_KEYS } from './cities.js';

export const SIDES = Object.freeze(['seeker', 'lister']);
export const KINDS = Object.freeze(['apartment', 'room']);
export const UNITS = Object.freeze(['1', '2', '3+']);
export const AVAILABLE = Object.freeze(['now', '1-3m', 'later']);
export const LISTER_ONLY = Object.freeze(['phone', 'neighbourhood', 'units', 'available']);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^05\d{8}$/;
// Control and format characters (NUL, tabs, bidi overrides such as U+202E, zero-width marks).
const INVISIBLE_RE = /[\p{Cc}\p{Cf}]/u;

/**
 * Trimmed and lower-cased, or null when it is not a valid address of at most 254 characters or holds a
 * control or format character.
 */
export function normaliseEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) && !INVISIBLE_RE.test(email) ? email : null;
}

/**
 * An Israeli mobile number as `05` + 8 digits. Spaces, `-` and `()` are stripped and a leading `+972`
 * or `972` (with or without the trunk `0` after it, as in `+972 (0)52-…`) becomes `0`. Empty (or missing) → `null`; anything else that does not fit → `undefined`.
 */
export function normalisePhone(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const digits = value.replace(/[\s\-()]/g, '').replace(/^\+?9720?/, '0');
  if (digits === '') return null;
  return PHONE_RE.test(digits) ? digits : undefined;
}

/** Trimmed, at most 60 characters, no control or format characters. Empty (or missing) → `null`; invalid → `undefined`. */
export function normaliseNeighbourhood(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || INVISIBLE_RE.test(value)) return undefined;
  const text = value.trim();
  if (text === '') return null;
  return [...text].length <= 60 ? text : undefined;
}

/**
 * Validates and normalises a signup body. Returns `{ok: true, value}` with every column (the lister
 * columns null for a seeker), or `{ok: false, fields}` with the bad keys in form order. Keys that belong
 * to the other side are rejected, never dropped. The honeypot (`website`) is the caller's to check.
 */
export function validateSignup(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, fields: [] };
  }
  const fields = [];
  const side = SIDES.includes(body.side) ? body.side : null;
  if (side === null) fields.push('side');

  const email = normaliseEmail(body.email);
  if (email === null) fields.push('email');

  let phone = null;
  let neighbourhood = null;
  if (side === 'lister') {
    phone = normalisePhone(body.phone);
    if (phone === undefined) fields.push('phone');
  }

  const kind = KINDS.includes(body.kind) ? body.kind : null;
  if (kind === null) fields.push('kind');
  const city = typeof body.city === 'string' && CITY_KEYS.includes(body.city) ? body.city : null;
  if (city === null) fields.push('city');

  let units = null;
  let available = null;
  if (side === 'lister') {
    neighbourhood = normaliseNeighbourhood(body.neighbourhood);
    if (neighbourhood === undefined) fields.push('neighbourhood');
    units = UNITS.includes(body.units) ? body.units : null;
    if (units === null) fields.push('units');
    available = AVAILABLE.includes(body.available) ? body.available : null;
    if (available === null) fields.push('available');
  }

  if (body.consent !== true) fields.push('consent');

  if (side === 'seeker') {
    for (const key of LISTER_ONLY) if (Object.hasOwn(body, key)) fields.push(key);
  }

  if (fields.length > 0) return { ok: false, fields };
  return {
    ok: true,
    value: { side, email, kind, city, neighbourhood, units, available, phone },
  };
}
