import { describe, expect, it } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import type { TourLineOut } from '../api';
import { formatTourDay, formatTourTime, formatTourWhen, tourDay } from '../format';
import { tourLineText } from '../tourLineText';

describe('tour formats', () => {
  it('ac4_israeli_wall_time_across_both_dst_changes', () => {
    // Winter (+02): 22:30Z is already the next day, 00:30.
    expect(tourDay('2026-11-17T22:30:00Z')).toBe('2026-11-18');
    expect(formatTourTime('2026-11-17T22:30:00Z')).toBe('00:30');
    expect(formatTourWhen('2026-11-17T22:30:00Z')).toBe('יום ד׳ 18.11 · 00:30');
    expect(formatTourWhen('2026-11-17T16:20:00Z')).toBe('יום ג׳ 17.11 · 18:20');
    // Spring forward (27 March 2026): 21:30Z is 23:30 the day before, then 00:30 after it.
    expect(formatTourTime('2026-03-26T21:30:00Z')).toBe('23:30');
    expect(tourDay('2026-03-26T21:30:00Z')).toBe('2026-03-26');
    expect(formatTourTime('2026-03-27T21:30:00Z')).toBe('00:30');
    expect(tourDay('2026-03-27T21:30:00Z')).toBe('2026-03-28');
    // Fall back (25 October 2026): 21:30Z is 00:30 on the 25th (+03), 22:30Z on the 25th is 00:30
    // on the 26th (+02).
    expect(tourDay('2026-10-24T21:30:00Z')).toBe('2026-10-25');
    expect(formatTourTime('2026-10-24T21:30:00Z')).toBe('00:30');
    expect(tourDay('2026-10-25T22:30:00Z')).toBe('2026-10-26');
    expect(formatTourTime('2026-10-25T22:30:00Z')).toBe('00:30');
  });

  it('ac4_tour_day_labels', () => {
    expect(formatTourDay('2026-11-17', '2026-11-17')).toBe(he.tours.day.today);
    expect(formatTourDay('2026-11-18', '2026-11-17')).toBe(he.tours.day.tomorrow);
    // The month end: tomorrow is the 1st.
    expect(formatTourDay('2026-12-01', '2026-11-30')).toBe(he.tours.day.tomorrow);
    expect(formatTourDay('2026-11-20', '2026-11-17')).toBe(
      i18n.t('tours.day.other', { weekday: 'יום שישי', date: '20.11.26' }),
    );
  });
});

describe('tourLineText', () => {
  const line = (change: TourLineOut['change']): TourLineOut => ({
    change,
    starts_at: '2026-11-17T16:20:00Z',
  });
  const when = 'יום ג׳ 17.11 · 18:20';
  const t = i18n.t.bind(i18n);

  it('says each change', () => {
    expect(tourLineText(t, line('booked'), 'מיכל')).toBe(`נקבע סיור: ${when}`);
    expect(tourLineText(t, line('rescheduled'), 'מיכל')).toBe(`הסיור הועבר ל־${when}`);
    expect(tourLineText(t, line('cancelled_by_seeker'), 'מיכל')).toBe(
      `הסיור של ${when} בוטל על ידי מיכל`,
    );
    expect(tourLineText(t, line('cancelled_by_lister'), 'מיכל')).toBe(
      `הסיור של ${when} בוטל על ידי מיכל`,
    );
    expect(tourLineText(t, line('cancelled_by_system'), 'מיכל')).toBe(`הסיור של ${when} בוטל`);
  });

  it('says my own cancel without a name, and a deleted sender by the deleted name', () => {
    expect(tourLineText(t, line('cancelled_by_seeker'), 'דנה', true)).toBe(
      `ביטלת את הסיור של ${when}`,
    );
    expect(tourLineText(t, line('cancelled_by_system'), 'דנה', true)).toBe(`הסיור של ${when} בוטל`);
    expect(tourLineText(t, line('cancelled_by_lister'), null)).toBe(
      `הסיור של ${when} בוטל על ידי ${he.account.deletedName}`,
    );
  });
});
