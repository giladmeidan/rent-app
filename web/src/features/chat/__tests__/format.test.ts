import { describe, expect, it } from 'vitest';

import { formatMessageTime } from '../format';

describe('formatMessageTime', () => {
  it('ac11_message_time', () => {
    // 12:00 in Israel (UTC+2 in November).
    const now = new Date('2026-11-11T10:00:00Z');

    // Earlier today in Israel: the time only.
    expect(formatMessageTime('2026-11-11T07:05:00Z', now)).toBe('09:05');
    // Yesterday: day and month too.
    expect(formatMessageTime('2026-11-10T07:05:00Z', now)).toBe('10.11 09:05');
    expect(formatMessageTime('2026-01-03T21:59:00Z', now)).toBe('03.01 23:59');
    // Still the 10th in UTC, but already 00:30 on the 11th in Israel: today.
    expect(formatMessageTime('2026-11-10T22:30:00Z', new Date('2026-11-11T08:00:00Z'))).toBe(
      '00:30',
    );
  });
});
