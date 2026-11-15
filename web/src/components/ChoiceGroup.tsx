import { useId } from 'react';

import { cx } from './cx';

export type ChoiceOption<T extends string | number> = { value: T; label: string };

type Props<T extends string | number> = {
  legend: string;
  /** The radios' `name`; unique per form. */
  name: string;
  options: readonly ChoiceOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** A message shown after the options (`role="alert"`); every radio is then marked invalid. */
  error?: string;
  /** Lets the options wrap onto more rows, each as wide as its label (for many options). */
  wrap?: boolean;
  /** One option per row, each the full width, its text at the inline start (long labels). */
  stacked?: boolean;
  /** The first radio's `id`, for a caller that moves focus to the group (a field error's target). */
  id?: string;
};

/** The shared shape and states of an option's label, with its alignment. */
function segment(justify: string, align: string): string {
  return cx(
    `flex min-h-tap flex-1 cursor-pointer items-center ${justify} rounded-md border border-border-strong bg-surface px-3 ${align} text-body font-medium text-ink`,
    'peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent-strong',
    'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
    'peer-aria-[invalid=true]:border-danger',
  );
}

/**
 * The classes of a ChoiceGroup option's label (the segment), for a look-alike control: it must
 * follow a `peer` input, like here.
 */
export const choiceSegment = segment('justify-center', 'text-center');

/** A stacked option's label: full width, its text at the inline start. */
const stackedSegment = segment('justify-start', 'text-start');

/**
 * Native radios in a fieldset, styled as the segmented buttons of CreateListing.dc.html. Arrow keys
 * and the RTL order (first option at the inline start) come from the browser.
 */
export function ChoiceGroup<T extends string | number>({
  legend,
  name,
  options,
  value,
  onChange,
  error,
  wrap = false,
  stacked = false,
  id: firstId,
}: Props<T>) {
  const id = useId();
  const errorId = `${id}-error`;
  const optionId = (index: number, value: T) =>
    index === 0 && firstId !== undefined ? firstId : `${id}-${String(value)}`;

  return (
    <fieldset className="flex flex-col">
      <legend className="mb-2 text-label text-ink">{legend}</legend>
      <div className={cx('flex gap-2', stacked ? 'flex-col' : wrap && 'flex-wrap')}>
        {options.map((option, index) => (
          <div
            key={option.value}
            className={cx('flex', !stacked && (wrap ? 'flex-auto' : 'flex-1'))}
          >
            <input
              id={optionId(index, option.value)}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              aria-invalid={error !== undefined ? true : undefined}
              aria-describedby={error !== undefined ? errorId : undefined}
              className="peer sr-only"
            />
            <label
              htmlFor={optionId(index, option.value)}
              className={stacked ? stackedSegment : choiceSegment}
            >
              {option.label}
            </label>
          </div>
        ))}
      </div>
      {error !== undefined && (
        <p id={errorId} role="alert" className="mt-1.5 text-body-sm text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
