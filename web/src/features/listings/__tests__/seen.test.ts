import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearSeen, markSeen, readSeen, SEEN_CAP } from '../seen';

const KEY = 'rent-app:seen';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const stored = () => JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as unknown;

describe('seen', () => {
  it('ac8_seen_store', () => {
    // Empty to start; a marked id is read back and stored as a JSON array, newest last.
    expect(readSeen()).toEqual(new Set());
    markSeen('L1');
    markSeen('L2');
    expect(readSeen()).toEqual(new Set(['L1', 'L2']));
    expect(stored()).toEqual(['L1', 'L2']);

    // Re-opening a stored id moves it to the end, without a duplicate.
    markSeen('L1');
    expect(stored()).toEqual(['L2', 'L1']);

    // 301 ids keep the newest 300.
    window.localStorage.clear();
    for (let i = 0; i <= SEEN_CAP; i += 1) markSeen(`id-${String(i)}`);
    const ids = stored() as string[];
    expect(SEEN_CAP).toBe(300);
    expect(ids).toHaveLength(300);
    expect(ids[0]).toBe('id-1');
    expect(ids.at(-1)).toBe('id-300');
    expect(readSeen().has('id-0')).toBe(false);
    // The cap drops the least recently opened: re-open id-1, then one more pushes out id-2.
    markSeen('id-1');
    markSeen('id-new');
    expect(readSeen().has('id-1')).toBe(true);
    expect(readSeen().has('id-2')).toBe(false);
    expect(stored()).toHaveLength(300);

    // A malformed value reads as empty.
    window.localStorage.setItem(KEY, '{not json');
    expect(readSeen()).toEqual(new Set());
    window.localStorage.setItem(KEY, JSON.stringify({ L1: true }));
    expect(readSeen()).toEqual(new Set());
    window.localStorage.setItem(KEY, JSON.stringify(['L1', 7, null]));
    expect(readSeen()).toEqual(new Set(['L1']));
    // A write over a malformed value starts again.
    window.localStorage.setItem(KEY, '{not json');
    markSeen('L3');
    expect(stored()).toEqual(['L3']);

    // clearSeen empties it; other storage is untouched.
    window.localStorage.setItem('unrelated', 'kept');
    clearSeen();
    expect(readSeen()).toEqual(new Set());
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem('unrelated')).toBe('kept');

    // A storage that throws: reads are empty, writes do nothing, nothing throws.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(() => markSeen('L4')).not.toThrow();
    expect(readSeen()).toEqual(new Set());
    expect(() => clearSeen()).not.toThrow();
    vi.restoreAllMocks();

    // A missing storage (`localStorage` itself throws on access, as in some private modes).
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(() => markSeen('L5')).not.toThrow();
    expect(readSeen()).toEqual(new Set());
    expect(() => clearSeen()).not.toThrow();
  });
});
