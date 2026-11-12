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
};

/**
 * The classes of a ChoiceGroup option's label (the segment), for a look-alike control: it must
 * follow a `peer` input, like here.
 */
export const choiceSegment = cx(
  'flex min-h-tap flex-1 cursor-pointer items-center justify-center rounded-md border border-border-strong bg-surface px-3 text-center text-body font-medium text-ink',
  'peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent-strong',
  'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
  'peer-aria-[invalid=true]:border-danger',
);

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
}: Props<T>) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <fieldset className="flex flex-col">
      <legend className="mb-2 text-label text-ink">{legend}</legend>
      <div className="flex gap-2">
        {options.map((option) => (
          <div key={option.value} className="flex flex-1">
            <input
              id={`${id}-${String(option.value)}`}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              aria-invalid={error !== undefined ? true : undefined}
              aria-describedby={error !== undefined ? errorId : undefined}
              className="peer sr-only"
            />
            <label htmlFor={`${id}-${String(option.value)}`} className={choiceSegment}>
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
