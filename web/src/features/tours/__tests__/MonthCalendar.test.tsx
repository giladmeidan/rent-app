import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '../../../app/i18n';
import he from '../../../locales/he.json';
import { MonthCalendar, type DayMark } from '../MonthCalendar';

const c = he.tours.calendar;

function setup(
  today: string,
  lastDay: string,
  opts: {
    isEnabled?: (d: string) => boolean;
    mark?: (d: string) => DayMark;
    selected?: string;
  } = {},
) {
  const onSelect = vi.fn();
  render(
    <div dir="rtl">
      <MonthCalendar
        label="יום"
        today={today}
        lastDay={lastDay}
        selected={opts.selected ?? null}
        onSelect={onSelect}
        isEnabled={opts.isEnabled ?? (() => true)}
        mark={opts.mark ?? (() => 'none')}
      />
    </div>,
  );
  return onSelect;
}
const dayButtons = () =>
  screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));
const digit = (b: HTMLElement) => b.textContent;
const byDigit = (n: string) => dayButtons().find((b) => digit(b) === n) as HTMLElement;

describe('MonthCalendar', () => {
  it('ac1_month_grid_range_and_navigation', () => {
    setup('2026-11-17', '2026-12-17');
    expect(screen.getByText('נובמבר 2026')).toBeVisible();
    // 1 Nov 2026 is a Sunday: the first cell in the first row.
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
    expect(byDigit('16')).toBeDisabled();
    expect(byDigit('17')).toBeEnabled();
    expect(byDigit('30')).toBeEnabled();
    const prev = screen.getByRole('button', { name: c.prevMonth });
    const next = screen.getByRole('button', { name: c.nextMonth });
    expect(prev).toBeDisabled();
    fireEvent.click(next);
    expect(screen.getByText('דצמבר 2026')).toBeVisible();
    expect(byDigit('17')).toBeEnabled();
    expect(byDigit('18')).toBeDisabled();
    expect(next).toBeDisabled();
    fireEvent.click(prev);
    expect(screen.getByText('נובמבר 2026')).toBeVisible();
  });

  it('ac1_three_months_when_today_is_the_31st_of_january', () => {
    setup('2026-01-31', '2026-03-02');
    const next = screen.getByRole('button', { name: c.nextMonth });
    fireEvent.click(next);
    fireEvent.click(next);
    expect(screen.getByText('מרץ 2026')).toBeVisible();
    expect(next).toBeDisabled();
  });

  it('ac2_keyboard_grid_rtl', () => {
    // Free days: 17, 18, 20 Nov and 1 Dec.
    const free = ['2026-11-17', '2026-11-18', '2026-11-20', '2026-12-01'];
    const onSelect = setup('2026-11-17', '2026-12-17', { isEnabled: (d) => free.includes(d) });
    const stops = dayButtons().filter((b) => b.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(digit(stops[0] as HTMLElement)).toBe('17');
    fireEvent.keyDown(byDigit('17'), { key: 'ArrowLeft' }); // RTL: next day
    expect(byDigit('18')).toHaveFocus();
    fireEvent.keyDown(byDigit('18'), { key: 'ArrowLeft' }); // 19 is disabled: skips to 20
    expect(byDigit('20')).toHaveFocus();
    fireEvent.keyDown(byDigit('20'), { key: 'ArrowRight' }); // previous day: skips 19
    expect(byDigit('18')).toHaveFocus();
    fireEvent.keyDown(byDigit('18'), { key: 'PageDown' }); // 18 Dec is out of range: stays
    expect(byDigit('18')).toHaveFocus();
    fireEvent.keyDown(byDigit('18'), { key: 'ArrowDown' }); // 25 Nov disabled, steps on to 1 Dec
    expect(screen.getByText('דצמבר 2026')).toBeVisible();
    expect(byDigit('1')).toHaveFocus();
    expect(dayButtons().filter((b) => b.tabIndex === 0)).toEqual([byDigit('1')]);
    fireEvent.click(byDigit('1'));
    expect(onSelect).toHaveBeenCalledWith('2026-12-01');
  });

  it('ac3_marks_and_selection_are_announced', () => {
    setup('2026-11-17', '2026-12-17', {
      selected: '2026-11-18',
      mark: (d) => (d === '2026-11-18' ? 'booked' : d === '2026-11-19' ? 'has' : 'none'),
    });
    expect(byDigit('18')).toHaveAttribute('aria-pressed', 'true');
    expect(byDigit('18')).toHaveAccessibleName(new RegExp(c.hasTours));
    expect(byDigit('19')).toHaveAccessibleName(new RegExp(c.hasTimes));
    expect(byDigit('19')).toHaveAttribute('aria-pressed', 'false');
    expect(byDigit('20')).not.toHaveAccessibleName(new RegExp(c.hasTimes));
  });

  it('ac1_month_bar_arrows_have_hebrew_names', () => {
    setup('2026-11-17', '2026-12-31');
    const prev = screen.getByRole('button', { name: 'החודש הקודם' });
    const next = screen.getByRole('button', { name: 'החודש הבא' });
    const title = document.querySelector('p[aria-live="polite"]') as HTMLElement;
    for (const b of [prev, next]) {
      expect(b.textContent).toBe('');
      expect(b.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
    expect(prev.parentElement).toBe(title.parentElement);
    expect(next.parentElement).toBe(title.parentElement);
    expect(Array.from(title.parentElement?.children ?? [])).toEqual([prev, title, next]);
    expect(title.parentElement).toHaveClass('flex-nowrap');
  });
});
