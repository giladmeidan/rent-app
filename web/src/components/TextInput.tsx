import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

import { cx } from './cx';
import { useFieldControl } from './Field';

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  invalid?: boolean;
  /** In-box adornments: a unit ("₪"), an icon, or a second bare input. Not part of the name. */
  start?: ReactNode;
  end?: ReactNode;
  /** `md` 48px; `lg` 52px with `h3` text (the price). */
  size?: 'md' | 'lg';
};

/** A native `<input>` in a box. The ref is the `<input>`; `className` (layout only) is the box's. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  {
    invalid,
    start,
    end,
    size = 'md',
    className,
    id,
    disabled,
    'aria-describedby': ownDescribedBy,
    ...rest
  },
  ref,
) {
  const field = useFieldControl({ id, invalid, describedBy: ownDescribedBy });
  const adornment = cx('shrink-0', size === 'lg' ? 'text-label' : 'text-body-sm');
  return (
    <div
      className={cx(
        'flex items-center gap-1.5 rounded-md border px-3 text-ink-muted focus-within:ring-2 focus-within:ring-accent-soft',
        size === 'lg' ? 'min-h-13' : 'min-h-12',
        field.invalid ? 'border-danger' : 'border-border-strong focus-within:border-accent',
        disabled ? 'bg-surface-subtle opacity-60' : 'bg-surface',
        className,
      )}
    >
      {start !== undefined && start !== null && <span className={adornment}>{start}</span>}
      <input
        ref={ref}
        {...rest}
        id={field.id}
        disabled={disabled}
        aria-invalid={field.invalid ? true : undefined}
        aria-describedby={field.describedBy}
        className={cx(
          'min-w-0 flex-1 bg-transparent py-2 text-ink outline-none placeholder:text-ink-muted',
          size === 'lg' ? 'text-h3' : 'text-body',
        )}
      />
      {end !== undefined && end !== null && <span className={adornment}>{end}</span>}
    </div>
  );
});
