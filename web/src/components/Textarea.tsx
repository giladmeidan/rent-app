import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cx } from './cx';
import { useFieldControl } from './Field';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

/** A native `<textarea>` in the input box. The ref and `className` (layout only) are its own. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, rows = 4, className, id, disabled, 'aria-describedby': ownDescribedBy, ...rest },
  ref,
) {
  const field = useFieldControl({ id, invalid, describedBy: ownDescribedBy });
  return (
    <textarea
      ref={ref}
      rows={rows}
      {...rest}
      id={field.id}
      disabled={disabled}
      aria-invalid={field.invalid ? true : undefined}
      aria-describedby={field.describedBy}
      className={cx(
        'block w-full rounded-md border px-3 py-2.5 text-body text-ink outline-none resize-y placeholder:text-ink-muted focus:ring-2 focus:ring-accent-soft',
        field.invalid ? 'border-danger' : 'border-border-strong focus:border-accent',
        disabled ? 'bg-surface-subtle opacity-60' : 'bg-surface',
        className,
      )}
    />
  );
});
