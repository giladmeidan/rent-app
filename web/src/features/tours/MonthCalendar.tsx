import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { focusRing } from '../../components/focusRing';
import { addDays } from '../listings/format';
import { formatTourDay } from './format';

export type DayMark = 'none' | 'has' | 'booked';

const titleFormat = new Intl.DateTimeFormat('he-IL', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const narrowFormat = new Intl.DateTimeFormat('he-IL', { weekday: 'narrow', timeZone: 'UTC' });
const longFormat = new Intl.DateTimeFormat('he-IL', { weekday: 'long', timeZone: 'UTC' });
// 2026-11-15 is a Sunday: the header row, Sunday first.
const WEEK = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 10, 15 + i)));

const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const weekday = (day: string) => utc(day).getUTCDay();

/** `day` plus `n` months, the day of the month clamped to the target month's length. */
function addMonths(day: string, n: number): string {
  const d = utc(day);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return target.toISOString().slice(0, 10);
}

/** Every `YYYY-MM` from `first`'s month to `last`'s. */
function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  for (let day = `${first.slice(0, 7)}-01`; day.slice(0, 7) <= last.slice(0, 7);) {
    months.push(day.slice(0, 7));
    day = addMonths(day, 1);
  }
  return months;
}

/**
 * A month grid (WAI-ARIA date grid, weeks from Sunday) of the days `today`…`lastDay`. Days are
 * `YYYY-MM-DD`. `isEnabled` narrows the range; `mark` puts a dot on a day. Arrow keys move focus
 * by visual direction; Enter / Space select.
 */
export function MonthCalendar({
  label,
  today,
  lastDay,
  selected,
  onSelect,
  isEnabled,
  mark,
}: {
  label: string;
  today: string;
  lastDay: string;
  selected: string | null;
  onSelect: (day: string) => void;
  isEnabled: (day: string) => boolean;
  mark: (day: string) => DayMark;
}) {
  const { t } = useTranslation();
  const months = monthsBetween(today, lastDay);
  const enabled = (day: string) => day >= today && day <= lastDay && isEnabled(day);
  const [month, setMonth] = useState(
    selected !== null && months.includes(selected.slice(0, 7))
      ? selected.slice(0, 7)
      : (months[0] ?? today.slice(0, 7)),
  );
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const moved = useRef(false);

  const first = `${month}-01`;
  const days: string[] = [];
  for (let d = first; d.slice(0, 7) === month; d = addDays(d, 1)) days.push(d);
  const inMonth = (d: string | null): d is string => d !== null && d.slice(0, 7) === month;
  const tabStop =
    [focusDay, selected].find((d): d is string => inMonth(d) && enabled(d)) ?? days.find(enabled);

  // A selection that moves elsewhere (a refetch) brings its month into view.
  const [seen, setSeen] = useState(selected);
  if (seen !== selected) {
    setSeen(selected);
    if (selected !== null && months.includes(selected.slice(0, 7))) setMonth(selected.slice(0, 7));
  }

  useEffect(() => {
    if (!moved.current || focusDay === null) return;
    moved.current = false;
    buttons.current.get(focusDay)?.focus();
  }, [focusDay, month]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const ltr = event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'ltr';
    const dow = weekday(day);
    let target: string;
    let step = -1;
    switch (event.key) {
      case 'ArrowRight':
        target = addDays(day, ltr ? 1 : -1);
        step = ltr ? 1 : -1;
        break;
      case 'ArrowLeft':
        target = addDays(day, ltr ? -1 : 1);
        step = ltr ? -1 : 1;
        break;
      case 'ArrowDown':
        target = addDays(day, 7);
        step = 1;
        break;
      case 'ArrowUp':
        target = addDays(day, -7);
        break;
      case 'Home':
        target = addDays(day, -dow);
        break;
      case 'End':
        target = addDays(day, 6 - dow);
        step = 1;
        break;
      case 'PageDown':
        target = addMonths(day, 1);
        step = 1;
        break;
      case 'PageUp':
        target = addMonths(day, -1);
        break;
      default:
        return;
    }
    event.preventDefault();
    while (target >= today && target <= lastDay && !enabled(target)) target = addDays(target, step);
    if (target < today || target > lastDay) return;
    moved.current = true;
    setFocusDay(target);
    setMonth(target.slice(0, 7));
  }

  const at = months.indexOf(month);
  const markText = {
    none: '',
    has: t('tours.calendar.hasTimes'),
    booked: t('tours.calendar.hasTours'),
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={at <= 0}
          onClick={() => setMonth(months[at - 1] ?? month)}
        >
          {t('tours.calendar.prevMonth')}
        </Button>
        <p className="text-label" aria-live="polite">
          {titleFormat.format(utc(first))}
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={at >= months.length - 1}
          onClick={() => setMonth(months[at + 1] ?? month)}
        >
          {t('tours.calendar.nextMonth')}
        </Button>
      </div>
      <table role="grid" aria-label={label} className="w-full table-fixed">
        <thead>
          <tr>
            {WEEK.map((d) => (
              <th
                key={d.getTime()}
                scope="col"
                abbr={longFormat.format(d)}
                className="text-label font-medium text-ink-muted"
              >
                {narrowFormat.format(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.ceil((weekday(first) + days.length) / 7) }, (_, w) => (
            <tr key={w}>
              {Array.from({ length: 7 }, (_, col) => {
                const day = days[w * 7 + col - weekday(first)];
                if (day === undefined) return <td key={col} />;
                const on = enabled(day);
                const m = mark(day);
                const chosen = day === selected;
                return (
                  <td key={col} className="p-0.5">
                    <button
                      type="button"
                      ref={(el) => {
                        if (el === null) buttons.current.delete(day);
                        else buttons.current.set(day, el);
                      }}
                      aria-label={
                        m === 'none'
                          ? formatTourDay(day, today)
                          : `${formatTourDay(day, today)}, ${markText[m]}`
                      }
                      aria-pressed={chosen}
                      disabled={!on}
                      tabIndex={day === tabStop ? 0 : -1}
                      onClick={() => onSelect(day)}
                      onKeyDown={(e) => onKeyDown(e, day)}
                      className={cx(
                        'flex min-h-tap w-full flex-col items-center justify-center gap-1 rounded-md text-body font-medium',
                        focusRing,
                        chosen
                          ? 'border border-accent bg-accent-soft text-accent-strong'
                          : on
                            ? 'border border-border text-ink'
                            : 'text-ink-muted',
                      )}
                    >
                      <bdi dir="ltr">{Number(day.slice(8))}</bdi>
                      <span
                        aria-hidden="true"
                        className={cx(
                          'size-1.5 rounded-full',
                          m === 'booked'
                            ? 'bg-accent'
                            : m === 'has'
                              ? 'bg-ink-muted'
                              : 'bg-transparent',
                        )}
                      />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
