/**
 * Unsent text kept in this tab's `sessionStorage` (spec 0009g): the apply message (`'apply'`, keyed
 * by the listing's id) and a chat message (`'chat'`, keyed by the conversation's id). Each entry is
 * bound to the user who typed it; another user reads nothing. Every storage call is guarded: when
 * storage throws (private modes) or is missing, drafts silently do nothing. With no `userId`,
 * nothing is read or written.
 *
 * `useLogout` clears every draft; a login clears every other user's (`clearDraftsExcept`). A 401
 * (`clearSession`) clears none: that is exactly the trip a draft must survive.
 */
export type DraftKind = 'apply' | 'chat';

const PREFIX = 'rent-app:draft:';

const keyOf = (kind: DraftKind, id: string) => `${PREFIX}${kind}:${id}`;

type Stored = { userId: string; text: string };

function parse(raw: string | null): Stored | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      'userId' in value &&
      'text' in value &&
      typeof value.userId === 'string' &&
      typeof value.text === 'string'
    ) {
      return { userId: value.userId, text: value.text };
    }
  } catch {
    // Malformed: no draft.
  }
  return null;
}

/** The draft `userId` wrote for `kind`/`id`, or `''`. */
export function readDraft(kind: DraftKind, id: string, userId: string | undefined): string {
  if (userId === undefined) return '';
  try {
    const stored = parse(window.sessionStorage.getItem(keyOf(kind, id)));
    return stored !== null && stored.userId === userId ? stored.text : '';
  } catch {
    return '';
  }
}

/** Saves `text` as `userId`'s draft; an empty or all-whitespace `text` removes the entry. */
export function writeDraft(
  kind: DraftKind,
  id: string,
  userId: string | undefined,
  text: string,
): void {
  if (userId === undefined) return;
  try {
    if (text.trim() === '') window.sessionStorage.removeItem(keyOf(kind, id));
    else window.sessionStorage.setItem(keyOf(kind, id), JSON.stringify({ userId, text }));
  } catch {
    // Storage is off or full: no draft.
  }
}

export function clearDraft(kind: DraftKind, id: string): void {
  try {
    window.sessionStorage.removeItem(keyOf(kind, id));
  } catch {
    // Storage is off: nothing was stored.
  }
}

/** Removes the drafts whose entry `keep` (given the stored user id, or null when malformed) rejects. */
function removeDrafts(keep: (userId: string | null) => boolean): void {
  try {
    const storage = window.sessionStorage;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      if (!keep(parse(storage.getItem(key))?.userId ?? null)) storage.removeItem(key);
    }
  } catch {
    // Storage is off: nothing was stored.
  }
}

/** Every draft, of every user (an explicit logout). */
export function clearAllDrafts(): void {
  removeDrafts(() => false);
}

/** Every draft not written by `userId` (a login: the next person never inherits another's text). */
export function clearDraftsExcept(userId: string): void {
  removeDrafts((owner) => owner === userId);
}
