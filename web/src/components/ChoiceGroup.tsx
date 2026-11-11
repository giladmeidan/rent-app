import { useId } from 'react';

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
      <legend className="mb-2 text-sm font-bold">{legend}</legend>
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
            <label
              htmlFor={`${id}-${String(option.value)}`}
              className="flex min-h-[44px] flex-1 cursor-pointer items-center justify-center rounded-xl border-[1.5px] border-[#D6D3D1] bg-white px-3 text-center text-[15px] font-semibold peer-checked:border-accent peer-checked:bg-accent-tint peer-checked:font-bold peer-checked:text-accent-text peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-aria-[invalid=true]:border-[#B91C1C]"
            >
              {option.label}
            </label>
          </div>
        ))}
      </div>
      {error !== undefined && (
        <p id={errorId} role="alert" className="mt-[6px] text-sm font-semibold text-[#B91C1C]">
          {error}
        </p>
      )}
    </fieldset>
  );
}
