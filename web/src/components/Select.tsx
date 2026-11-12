import { forwardRef, type SelectHTMLAttributes } from 'react';

import { cx } from './cx';
import { useFieldControl } from './Field';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

/**
 * A native `<select>` with the input box and an outline chevron at the inline end. The ref is the
 * `<select>`; `className` (layout only) goes on the wrapper.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, id, disabled, children, 'aria-describedby': ownDescribedBy, ...rest },
  ref,
) {
  const field = useFieldControl({ id, invalid, describedBy: ownDescribedBy });
  return (
    <div className={cx('relative', className)}>
      <select
        ref={ref}
        {...rest}
        id={field.id}
        disabled={disabled}
        aria-invalid={field.invalid ? true : undefined}
        aria-describedby={field.describedBy}
        className={cx(
          'min-h-12 w-full appearance-none rounded-md border ps-3 pe-10 text-body text-ink outline-none focus:ring-2 focus:ring-accent-soft',
          field.invalid ? 'border-danger' : 'border-border-strong focus:border-accent',
          disabled ? 'bg-surface-subtle opacity-60' : 'bg-surface',
        )}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-ink-muted"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
});
