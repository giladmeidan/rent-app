import { describe, expect, it } from 'vitest';

import i18n from '../../app/i18n';
import { parseRetryAfter, retryAfterText } from '../retryAfter';

const IN = '\u05d1\u05e2\u05d5\u05d3 '; // "בעוד "

describe('retryAfter', () => {
  it.each([
    [1, `${IN}\u05d3\u05e7\u05d4`], // בעוד דקה
    [60, `${IN}\u05d3\u05e7\u05d4`],
    [61, `${IN}2 \u05d3\u05e7\u05d5\u05ea`], // בעוד 2 דקות
    [840, `${IN}14 \u05d3\u05e7\u05d5\u05ea`],
    [3599, `${IN}\u05e9\u05e2\u05d4`], // בעוד שעה
    [3600, `${IN}\u05e9\u05e2\u05d4`],
    [3601, `${IN}\u05e9\u05e2\u05ea\u05d9\u05d9\u05dd`], // בעוד שעתיים
    [7200, `${IN}\u05e9\u05e2\u05ea\u05d9\u05d9\u05dd`],
    [10800, `${IN}3 \u05e9\u05e2\u05d5\u05ea`], // בעוד 3 שעות
    [86399, `${IN}\u05d9\u05d5\u05dd`], // בעוד יום
    [86400, `${IN}\u05d9\u05d5\u05dd`],
    [172800, `${IN}\u05d9\u05d5\u05de\u05d9\u05d9\u05dd`], // בעוד יומיים
  ])('ac4_rounds_up_to_minutes_hours_days: %i s', (seconds, text) => {
    expect(retryAfterText(i18n.t, seconds)).toBe(text);
  });

  it('ac4_rounds_up_to_minutes_hours_days: parses whole positive seconds only', () => {
    const parse = (value?: string) =>
      parseRetryAfter(new Headers(value === undefined ? {} : { 'Retry-After': value }));
    expect(parse('840')).toBe(840);
    expect(parse(' 1 ')).toBe(1);
    expect(parse()).toBeNull();
    expect(parse('0')).toBeNull();
    expect(parse('-5')).toBeNull();
    expect(parse('1.5')).toBeNull();
    expect(parse('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull();
  });
});
