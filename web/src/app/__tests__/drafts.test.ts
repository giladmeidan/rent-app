import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearAllDrafts, clearDraft, clearDraftsExcept, readDraft, writeDraft } from '../drafts';

// "שלום"
const HELLO = '\u05e9\u05dc\u05d5\u05dd';
const KEY = 'rent-app:draft:apply:L';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('drafts', () => {
  it('ac5_drafts_store', () => {
    writeDraft('apply', 'L', 'U', HELLO);
    expect(readDraft('apply', 'L', 'U')).toBe(HELLO);
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? '')).toEqual({
      userId: 'U',
      text: HELLO,
    });
    // Another user, another kind or id, or no user: nothing.
    expect(readDraft('apply', 'L', 'V')).toBe('');
    expect(readDraft('chat', 'L', 'U')).toBe('');
    expect(readDraft('apply', 'M', 'U')).toBe('');
    expect(readDraft('apply', 'L', undefined)).toBe('');
    writeDraft('apply', 'N', undefined, HELLO);
    expect(window.sessionStorage.getItem('rent-app:draft:apply:N')).toBeNull();

    // An all-whitespace text removes the entry.
    writeDraft('apply', 'L', 'U', '  ');
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(readDraft('apply', 'L', 'U')).toBe('');

    // A malformed entry reads as no draft.
    window.sessionStorage.setItem(KEY, '{not json');
    expect(readDraft('apply', 'L', 'U')).toBe('');
    window.sessionStorage.setItem(KEY, JSON.stringify({ userId: 'U', text: 7 }));
    expect(readDraft('apply', 'L', 'U')).toBe('');

    // `clearDraftsExcept`: V's entries go, U's stay; other storage is untouched.
    window.sessionStorage.setItem('flatmates.inviteToken', 'Tk');
    writeDraft('apply', 'L', 'U', HELLO);
    writeDraft('chat', 'C', 'U', 'hi');
    writeDraft('apply', 'M', 'V', 'other');
    writeDraft('chat', 'D', 'V', 'other');
    clearDraftsExcept('U');
    expect(readDraft('apply', 'L', 'U')).toBe(HELLO);
    expect(readDraft('chat', 'C', 'U')).toBe('hi');
    expect(window.sessionStorage.getItem('rent-app:draft:apply:M')).toBeNull();
    expect(window.sessionStorage.getItem('rent-app:draft:chat:D')).toBeNull();
    expect(window.sessionStorage.getItem('flatmates.inviteToken')).toBe('Tk');

    clearDraft('chat', 'C');
    expect(readDraft('chat', 'C', 'U')).toBe('');
    clearAllDrafts();
    expect(readDraft('apply', 'L', 'U')).toBe('');
    expect(window.sessionStorage.getItem('flatmates.inviteToken')).toBe('Tk');

    // A storage that throws: writes do nothing, reads are empty, nothing throws.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    writeDraft('apply', 'L', 'U', HELLO);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(readDraft('apply', 'L', 'U')).toBe('');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(() => {
      writeDraft('apply', 'L', 'U', '');
      clearDraft('apply', 'L');
      clearAllDrafts();
      clearDraftsExcept('U');
    }).not.toThrow();
  });
});
