/**
 * The invite token between the `/flatmates/join#<token>` link and the join POST (0008e A1): kept in
 * this tab's `sessionStorage` (never a URL), so it survives the in-app trip through login and
 * signup. Every storage call is guarded; when storage throws or is missing, a module variable keeps
 * the token for the same tab.
 */
const KEY = 'flatmates.inviteToken';

/** The shape the API accepts (`InviteTokenIn`): 1-100 URL-safe base64 characters. */
const TOKEN = /^[A-Za-z0-9_-]{1,100}$/;

let memory: string | null = null;

/** True when `value` has the shape of an invite token. */
export function isInviteToken(value: string): boolean {
  return TOKEN.test(value);
}

export function stashInviteToken(token: string): void {
  memory = token;
  try {
    window.sessionStorage.setItem(KEY, token);
  } catch {
    // Storage is off or full: the module variable keeps it.
  }
}

/** The stashed token, or null. A stored value that is not a token is ignored. */
export function readInviteToken(): string | null {
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(KEY);
  } catch {
    // Storage is off: fall back to the module variable.
  }
  const token = stored ?? memory;
  return token !== null && isInviteToken(token) ? token : null;
}

export function clearInviteToken(): void {
  memory = null;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage is off: the module variable is already cleared.
  }
}
