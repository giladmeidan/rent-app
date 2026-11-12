import { describe, expect, it } from 'vitest';

import i18n from '../../app/i18n';
import { parseRetryAfter, retryAfterText } from '../retryAfter';

const IN = 'בעוד '; // "בעוד "

describe('retryAfter', () => {
  it.each([
    [1, `${IN}דקה`], // בעוד דקה
    [60, `${IN}דקה`],
    [61, `${IN}2 דקות`], // בעוד 2 דקות
    [840, `${IN}14 דקות`],
    [3599, `${IN}שעה`], // בעוד שעה
    [3600, `${IN}שעה`],
    [3601, `${IN}שעתיים`], // בעוד שעתיים
    [7200, `${IN}שעתיים`],
    [10800, `${IN}3 שעות`], // בעוד 3 שעות
    [86399, `${IN}יום`], // בעוד יום
    [86400, `${IN}יום`],
    [172800, `${IN}יומיים`], // בעוד יומיים
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
